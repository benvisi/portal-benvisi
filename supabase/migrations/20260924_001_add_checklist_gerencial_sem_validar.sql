begin;

-- =============================================================================
-- Epic 2 — Atendimento: Conclusão Gerencial — checklist validation exception
--
-- Browser QA on 37db5e2 raised a real usability/audit gap: FechamentoAtendimento's
-- Concluir button (reused as-is by concluir_atendimento_gerencial) requires
-- every obrigatorio checklist item checked before it enables — correct for
-- normal self-completion (the employee is attesting to their own actions),
-- but wrong for the management recovery flow, whose entire purpose is
-- releasing an Atendimento the responsible employee cannot personally
-- finish. Forcing a manager to tick boxes for tasks they cannot verify
-- would silently fabricate a false "checklist completed" record.
--
-- Current data model (as found before this migration):
--
-- atendimento_checklists — one row per Atendimento's completed checklist.
--   id, id_atendimento (unique), id_funcionario, versao, respostas jsonb
--   (array of {codigo, concluido}), completado_em. id_funcionario has
--   always meant "the responsible employee" (20260821_001's own comment:
--   "under this milestone's closing permissions the responsible employee
--   always completes their own checklist... a future privileged-completion
--   workflow (out of scope here) can add an actor column then without
--   touching this row shape" — that future workflow is this one). There
--   was no actor column and no "was this genuinely validated" column: a
--   row's mere existence has always meant "every obrigatorio item was
--   confirmed true", because concluir_atendimento/concluir_atendimento_pendente
--   only ever insert one after enforcing exactly that. concluir_atendimento_gerencial
--   (38d7495) inherited that same all-or-nothing enforcement unchanged.
--
-- checklist_pendencias — the separate "Farei depois" deferred-checklist
--   backlog (Milestone 2C.1/2C.2), one row per Atendimento whose checklist
--   was deferred entirely (no atendimento_checklists row at all for that
--   Atendimento). Distinct concept from "completed, but not fully
--   validated" — this migration does not touch it, and the new exception
--   path never creates a checklist_pendencias row (explicit requirement:
--   no Farei depois backlog merely because management used the exception).
--
-- How the three cases will be distinguished going forward, all within the
-- existing atendimento_checklists row shape plus two new nullable/defaulted
-- columns:
--
--   1. Employee completed required checklist normally:
--      id_funcionario = employee, id_funcionario_ator = employee,
--      checklist_validado = true, respostas has every obrigatorio item
--      concluido = true (enforced, unchanged).
--   2. Manager completed on behalf and genuinely checked all items:
--      id_funcionario = employee (owner, unchanged), id_funcionario_ator =
--      manager, checklist_validado = true, respostas has every obrigatorio
--      item concluido = true (still enforced on this path — this is NOT
--      the exception, just management using the normal path).
--   3. Manager completed on behalf WITHOUT validating the remaining items:
--      id_funcionario = employee (owner, unchanged), id_funcionario_ator =
--      manager, checklist_validado = false, respostas reflects only what
--      the manager actually ticked (never synthesized as true) — some
--      obrigatorio items may show concluido = false. This is the new
--      p_ignorar_checklist = true path on concluir_atendimento_gerencial.
--
-- checklist_validado defaults to true, so every historical row (all
-- self-completions, by construction) and every future genuinely-validated
-- completion needs no special-casing — only the new exception path ever
-- writes false. id_funcionario_ator is left null on historical rows
-- (same "null means completed before this column existed" precedent as
-- id_funcionario_concluiu in 20260922_001) and populated on every
-- completion from this point on, self-service included, for the same
-- "uniform going forward" reasoning.
--
-- Smallest additive change: two nullable/defaulted columns on the existing
-- table, no new table, no change to checklist_pendencias, no change to
-- Farei depois. Nothing here reinterprets a validado = false row as "all
-- items complete" anywhere — no reporting code reads atendimento_checklists
-- today (grep confirms zero frontend references), so there is nothing
-- existing to break, and any future reporting has the explicit flag to
-- filter/label on rather than needing to infer intent from partial
-- respostas.
-- =============================================================================

alter table public.atendimento_checklists
  add column if not exists id_funcionario_ator uuid references public.funcionarios(id),
  add column if not exists checklist_validado boolean not null default true;

-- -----------------------------------------------------------------------------
-- concluir_atendimento: same 4-arg signature as 20260922_001. Only addition
-- is populating id_funcionario_ator (= v_ctx.id_funcionario, since this RPC
-- only ever matches the caller's own row) and checklist_validado (= true,
-- explicit rather than relying on the column default, for the same "every
-- audit column visibly and deliberately set" reasoning as every other
-- change in this epic) on the checklist-completion insert. Everything else,
-- including the p_adiar_checklist branch (which never touches
-- atendimento_checklists at all), is byte-for-byte unchanged.
-- -----------------------------------------------------------------------------
create or replace function public.concluir_atendimento(
  p_session_token text,
  p_clientes jsonb,
  p_checklist jsonb,
  p_adiar_checklist boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_atendimento record;
  v_dia date;
  v_cliente jsonb;
  v_id_motivo uuid;
  v_detalhe text;
  v_motivo record;
  v_versao_ativa int;
  v_codigos_confirmados text[];
  v_respostas jsonb;
  v_politica text;
  v_checklist_id uuid;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  perform public.transicionar_atendimento_pendente(v_ctx.id_funcionario);

  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = v_ctx.id_funcionario and status = 'finalizando'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

  if p_clientes is null
     or jsonb_typeof(p_clientes) <> 'array'
     or jsonb_array_length(p_clientes) = 0 then
    raise exception using errcode = 'P0001', message = 'NENHUM_CLIENTE_INFORMADO';
  end if;

  for v_cliente in select * from jsonb_array_elements(p_clientes)
  loop
    if v_cliente ->> 'id_motivo' is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_OBRIGATORIO';
    end if;

    begin
      v_id_motivo := (v_cliente ->> 'id_motivo')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end;

    select * into v_motivo
    from public.atendimento_motivos
    where id = v_id_motivo and ativo = true;

    if v_motivo.id is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end if;

    v_detalhe := nullif(trim(both from (v_cliente ->> 'detalhe')), '');

    if v_motivo.detalhe_obrigatorio and v_detalhe is null then
      raise exception using errcode = 'P0001', message = 'DETALHE_OBRIGATORIO';
    end if;

    insert into public.atendimento_clientes (
      id_atendimento, id_motivo, categoria, motivo_rotulo, detalhe
    ) values (
      v_atendimento.id, v_motivo.id, v_motivo.categoria, v_motivo.rotulo, v_detalhe
    );
  end loop;

  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_adiar_checklist then
    if v_atendimento.checklist_obrigatorio is not null then
      if v_atendimento.checklist_obrigatorio then
        raise exception using errcode = 'P0001', message = 'ADIAMENTO_NAO_PERMITIDO';
      end if;
    else
      select cc.policy into v_politica from public.checklist_config cc where cc.id = 1 for share;

      if v_politica is distinct from 'defer_allowed' then
        raise exception using errcode = 'P0001', message = 'ADIAMENTO_NAO_PERMITIDO';
      end if;
    end if;

    perform pg_advisory_xact_lock(
      hashtext('checklist_pendencias:' || v_ctx.id_funcionario::text)::bigint
    );

    insert into public.checklist_pendencias (
      id_atendimento, id_funcionario, checklist_versao, politica_no_momento, status
    ) values (
      v_atendimento.id,
      v_ctx.id_funcionario,
      v_versao_ativa,
      coalesce(v_atendimento.checklist_politica_no_momento, v_politica),
      'pending'
    );
  else
    if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
      raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
    end if;

    select array_agg(elem ->> 'codigo')
    into v_codigos_confirmados
    from jsonb_array_elements(p_checklist) as elem
    where jsonb_typeof(elem) = 'object'
      and jsonb_typeof(elem -> 'concluido') = 'boolean'
      and (elem ->> 'concluido')::boolean is true
      and elem ->> 'codigo' is not null;

    if exists (
      select 1
      from public.atendimento_checklist_itens ci
      where ci.versao = v_versao_ativa
        and ci.ativo = true
        and ci.obrigatorio = true
        and not (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
    ) then
      raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
    end if;

    select jsonb_agg(
      jsonb_build_object(
        'codigo', ci.codigo,
        'concluido', (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
      )
      order by ci.ordem_exibicao
    )
    into v_respostas
    from public.atendimento_checklist_itens ci
    where ci.versao = v_versao_ativa and ci.ativo = true;

    insert into public.atendimento_checklists (
      id_atendimento, id_funcionario, versao, respostas, id_funcionario_ator, checklist_validado
    )
    values (v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_respostas, v_ctx.id_funcionario, true)
    returning id into v_checklist_id;

    perform public.resolver_checklist_pendencias(
      v_ctx.id_funcionario, 'fechamento_atendimento', v_checklist_id, null, v_versao_ativa
    );
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  update public.atendimentos
  set status = 'concluido',
      concluido_em = now(),
      id_funcionario_concluiu = v_ctx.id_funcionario
  where id = v_atendimento.id;

  insert into public.lista_vez_fila (id_funcionario, dia_manaus, na_fila, disponivel, posicao)
  values (v_ctx.id_funcionario, v_dia, true, true, nextval('public.lista_vez_posicao_seq'))
  on conflict (id_funcionario, dia_manaus)
  do update set
    na_fila = true,
    disponivel = true,
    posicao = excluded.posicao,
    atualizado_em = now();

  return true;
end;
$$;

revoke all on function public.concluir_atendimento(text, jsonb, jsonb, boolean) from public;
grant execute on function public.concluir_atendimento(text, jsonb, jsonb, boolean) to anon;

-- -----------------------------------------------------------------------------
-- concluir_atendimento_pendente: same 3-arg signature as 20260922_001. Only
-- addition is populating id_funcionario_ator/checklist_validado on its
-- checklist-completion insert, same reasoning as concluir_atendimento above
-- — recovery completion is always fully validated (no exception path
-- exists for pendente_fechamento, unchanged from 20260922_001's documented
-- scope boundary). Everything else unchanged.
-- -----------------------------------------------------------------------------
create or replace function public.concluir_atendimento_pendente(
  p_session_token text,
  p_clientes jsonb,
  p_checklist jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_atendimento record;
  v_cliente jsonb;
  v_id_motivo uuid;
  v_detalhe text;
  v_motivo record;
  v_versao_ativa int;
  v_codigos_confirmados text[];
  v_respostas jsonb;
  v_checklist_id uuid;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = v_ctx.id_funcionario and status = 'pendente_fechamento'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'NENHUM_ATENDIMENTO_PENDENTE';
  end if;

  if p_clientes is null
     or jsonb_typeof(p_clientes) <> 'array'
     or jsonb_array_length(p_clientes) = 0 then
    raise exception using errcode = 'P0001', message = 'NENHUM_CLIENTE_INFORMADO';
  end if;

  for v_cliente in select * from jsonb_array_elements(p_clientes)
  loop
    if v_cliente ->> 'id_motivo' is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_OBRIGATORIO';
    end if;

    begin
      v_id_motivo := (v_cliente ->> 'id_motivo')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end;

    select * into v_motivo
    from public.atendimento_motivos
    where id = v_id_motivo and ativo = true;

    if v_motivo.id is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end if;

    v_detalhe := nullif(trim(both from (v_cliente ->> 'detalhe')), '');

    if v_motivo.detalhe_obrigatorio and v_detalhe is null then
      raise exception using errcode = 'P0001', message = 'DETALHE_OBRIGATORIO';
    end if;

    insert into public.atendimento_clientes (
      id_atendimento, id_motivo, categoria, motivo_rotulo, detalhe
    ) values (
      v_atendimento.id, v_motivo.id, v_motivo.categoria, v_motivo.rotulo, v_detalhe
    );
  end loop;

  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  select array_agg(elem ->> 'codigo')
  into v_codigos_confirmados
  from jsonb_array_elements(p_checklist) as elem
  where jsonb_typeof(elem) = 'object'
    and jsonb_typeof(elem -> 'concluido') = 'boolean'
    and (elem ->> 'concluido')::boolean is true
    and elem ->> 'codigo' is not null;

  if exists (
    select 1
    from public.atendimento_checklist_itens ci
    where ci.versao = v_versao_ativa
      and ci.ativo = true
      and ci.obrigatorio = true
      and not (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
  ) then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'codigo', ci.codigo,
      'concluido', (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
    )
    order by ci.ordem_exibicao
  )
  into v_respostas
  from public.atendimento_checklist_itens ci
  where ci.versao = v_versao_ativa and ci.ativo = true;

  insert into public.atendimento_checklists (
    id_atendimento, id_funcionario, versao, respostas, id_funcionario_ator, checklist_validado
  )
  values (v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_respostas, v_ctx.id_funcionario, true)
  returning id into v_checklist_id;

  perform public.resolver_checklist_pendencias(
    v_ctx.id_funcionario, 'fechamento_atendimento', v_checklist_id, null, v_versao_ativa
  );

  update public.atendimentos
  set status = 'concluido',
      concluido_em = now(),
      id_funcionario_concluiu = v_ctx.id_funcionario
  where id = v_atendimento.id;

  return true;
end;
$$;

revoke all on function public.concluir_atendimento_pendente(text, jsonb, jsonb) from public;
grant execute on function public.concluir_atendimento_pendente(text, jsonb, jsonb) to anon;

-- -----------------------------------------------------------------------------
-- concluir_atendimento_gerencial — gains a 5th parameter, p_ignorar_checklist
-- boolean default false. Signature change (not just a body edit), so the
-- old 4-arg overload is dropped first, same convention as every prior
-- argument-list evolution in this epic (see 20260819_001/20260821_002).
--
-- p_ignorar_checklist = false (default): completely unchanged from
-- 38d7495/20260923_001 — every obrigatorio item must be confirmed, exactly
-- like the normal path (case 2 in the header note above: a manager who CAN
-- genuinely confirm everything uses this, no different from today).
--
-- p_ignorar_checklist = true (the new exception, case 3): the
-- CHECKLIST_INCOMPLETO enforcement is skipped entirely — respostas is still
-- built the same way from whatever p_checklist actually contains (never
-- synthesized), so unconfirmed items simply show concluido = false, an
-- honest record rather than a fabricated one. checklist_validado is set to
-- false. resolver_checklist_pendencias is deliberately NOT called on this
-- path — required behavior: using the exception must never auto-resolve an
-- unrelated genuine Farei depois backlog entry for this employee, since
-- this submission was explicitly not validated. No checklist_pendencias row
-- is written either (required behavior: no new backlog is created by using
-- the exception — that table is untouched by this whole function, same as
-- before).
--
-- id_funcionario_ator = v_ctx.id_funcionario (the acting manager) on both
-- branches — id_funcionario (the owner/responsible employee) is still never
-- written by this function, unchanged from 38d7495.
-- -----------------------------------------------------------------------------
drop function if exists public.concluir_atendimento_gerencial(text, uuid, jsonb, jsonb);

create or replace function public.concluir_atendimento_gerencial(
  p_session_token text,
  p_id_atendimento uuid,
  p_clientes jsonb,
  p_checklist jsonb,
  p_ignorar_checklist boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_id_alvo uuid;
  v_atendimento record;
  v_dia date;
  v_cliente jsonb;
  v_id_motivo uuid;
  v_detalhe text;
  v_motivo record;
  v_versao_ativa int;
  v_codigos_confirmados text[];
  v_respostas jsonb;
  v_checklist_id uuid;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if v_ctx.cargo not in ('Administrador', 'Gerente') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_CONCLUIR_GERENCIAL';
  end if;

  select id_funcionario into v_id_alvo
  from public.atendimentos
  where id = p_id_atendimento;

  if v_id_alvo is null then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

  -- Restored from 38d7495/20260923_001 — closes the same day-boundary race
  -- concluir_atendimento already guards against for a self-completion: a
  -- stale 'finalizando' page for an Atendimento that has since aged into
  -- 'pendente_fechamento' is caught by the status match below instead of
  -- being completed with today's date.
  perform public.transicionar_atendimento_pendente(v_id_alvo);

  select * into v_atendimento
  from public.atendimentos
  where id = p_id_atendimento and status = 'finalizando'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

  if p_clientes is null
     or jsonb_typeof(p_clientes) <> 'array'
     or jsonb_array_length(p_clientes) = 0 then
    raise exception using errcode = 'P0001', message = 'NENHUM_CLIENTE_INFORMADO';
  end if;

  for v_cliente in select * from jsonb_array_elements(p_clientes)
  loop
    if v_cliente ->> 'id_motivo' is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_OBRIGATORIO';
    end if;

    begin
      v_id_motivo := (v_cliente ->> 'id_motivo')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end;

    select * into v_motivo
    from public.atendimento_motivos
    where id = v_id_motivo and ativo = true;

    if v_motivo.id is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end if;

    v_detalhe := nullif(trim(both from (v_cliente ->> 'detalhe')), '');

    if v_motivo.detalhe_obrigatorio and v_detalhe is null then
      raise exception using errcode = 'P0001', message = 'DETALHE_OBRIGATORIO';
    end if;

    insert into public.atendimento_clientes (
      id_atendimento, id_motivo, categoria, motivo_rotulo, detalhe
    ) values (
      v_atendimento.id, v_motivo.id, v_motivo.categoria, v_motivo.rotulo, v_detalhe
    );
  end loop;

  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  select array_agg(elem ->> 'codigo')
  into v_codigos_confirmados
  from jsonb_array_elements(p_checklist) as elem
  where jsonb_typeof(elem) = 'object'
    and jsonb_typeof(elem -> 'concluido') = 'boolean'
    and (elem ->> 'concluido')::boolean is true
    and elem ->> 'codigo' is not null;

  if not p_ignorar_checklist and exists (
    select 1
    from public.atendimento_checklist_itens ci
    where ci.versao = v_versao_ativa
      and ci.ativo = true
      and ci.obrigatorio = true
      and not (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
  ) then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'codigo', ci.codigo,
      'concluido', (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
    )
    order by ci.ordem_exibicao
  )
  into v_respostas
  from public.atendimento_checklist_itens ci
  where ci.versao = v_versao_ativa and ci.ativo = true;

  insert into public.atendimento_checklists (
    id_atendimento, id_funcionario, versao, respostas, id_funcionario_ator, checklist_validado
  )
  values (
    v_atendimento.id,
    v_atendimento.id_funcionario,
    v_versao_ativa,
    v_respostas,
    v_ctx.id_funcionario,
    not p_ignorar_checklist
  )
  returning id into v_checklist_id;

  if not p_ignorar_checklist then
    perform public.resolver_checklist_pendencias(
      v_atendimento.id_funcionario, 'fechamento_atendimento', v_checklist_id, null, v_versao_ativa
    );
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  update public.atendimentos
  set status = 'concluido',
      concluido_em = now(),
      id_funcionario_concluiu = v_ctx.id_funcionario
  where id = v_atendimento.id;

  insert into public.lista_vez_fila (id_funcionario, dia_manaus, na_fila, disponivel, posicao)
  values (v_atendimento.id_funcionario, v_dia, true, true, nextval('public.lista_vez_posicao_seq'))
  on conflict (id_funcionario, dia_manaus)
  do update set
    na_fila = true,
    disponivel = true,
    posicao = excluded.posicao,
    atualizado_em = now();

  return true;
end;
$$;

revoke all on function public.concluir_atendimento_gerencial(text, uuid, jsonb, jsonb, boolean) from public;
grant execute on function public.concluir_atendimento_gerencial(text, uuid, jsonb, jsonb, boolean) to anon;

commit;
