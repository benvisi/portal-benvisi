begin;

-- =============================================================================
-- Epic 2 — Atendimento: Conclusão Gerencial (management completion on behalf
-- of a salesperson who cannot access the Portal)
--
-- Real-world trigger: a salesperson had an active Atendimento but lost
-- Portal access mid-shift, so their Finalizando timer kept running with no
-- way for anyone to conclude it until access was restored. Gerente/
-- Administrador need a way to complete that Atendimento themselves, from
-- their own device, while keeping every ownership/attribution/queue rule
-- identical to an ordinary self-completion.
--
-- Design (mirrors two existing, already-established patterns rather than
-- inventing new ones):
--
--   1. cancelar_atendimento_provisorio's shape (20260819_003) — an explicit
--      p_id_atendimento identifies the target row instead of "the caller's
--      own row", plus a permission check against the row's own columns.
--   2. remover_funcionario_lista_da_vez's shape (20260820_001) — server-side
--      authorization via `v_ctx.cargo not in ('Administrador', 'Gerente')`,
--      the established cargo-gate convention for every other Atendimento/
--      Lista da Vez management action. No pode_* capability column exists
--      for this area of the app yet (unlike Termos de busca's
--      pode_gerenciar_termos_busca), so this reuses the cargo convention
--      already governing the sibling action (remover_funcionario_lista_da_vez)
--      on this exact screen, rather than introducing a new, unused-elsewhere
--      capability column for a single action.
--
-- Ownership/attribution (required behavior 3): concluir_atendimento_gerencial
-- never touches atendimentos.id_funcionario — the Atendimento stays owned by
-- and attributed to the original salesperson throughout. Only a new,
-- nullable audit column records who actually performed the completion.
--
-- Audit (required behavior 4): atendimentos.id_funcionario_concluiu is a new
-- column, following the exact id_funcionario_cancelou precedent
-- (20260819_003) — "who actually performed this terminal action", separate
-- from id_funcionario (owner) and id_funcionario_iniciador (who started it).
-- Populated from the server-validated session (v_ctx.id_funcionario) on every
-- completion path — including ordinary self-completion and previous-day
-- recovery — never from a client-supplied value. A null value after this
-- migration means "completed before this column existed"; every completion
-- from this point on always populates it, self-service included, so
-- "completed by someone other than the owner" is simply
-- `id_funcionario_concluiu is distinct from id_funcionario`.
--
-- Lista da Vez (required behavior 5): the new RPC's final queue upsert uses
-- v_atendimento.id_funcionario (the subject/owner) — never v_ctx.id_funcionario
-- (the acting manager) — so the original salesperson returns to the back of
-- today's queue exactly as concluir_atendimento already does for a normal
-- self-completion. Uses the same nextval('lista_vez_posicao_seq') "back of
-- queue" mechanism and the same per-day advisory lock.
--
-- Concurrency (required behavior 7): identical `for update` + status = 'finalizando'
-- match as every existing closing RPC. If the salesperson (or anyone else)
-- already completed it, the row no longer matches and this raises the same
-- ATENDIMENTO_NAO_ESTA_FINALIZANDO error the frontend already knows how to
-- show — no double-completion, no second queue insert, no overwritten
-- outcome is possible.
--
-- Scope decision — pendente_fechamento is intentionally NOT reachable through
-- this RPC: concluir_atendimento_pendente already restricts recovery
-- completion to the responsible employee only ("section 8" in
-- 20260822_001), by design — a day-boundary recovery is a different,
-- already-scoped-out concern (V1 exclusion: "unrelated Lista da Vez
-- redesign"). If the target's Atendimento has aged into
-- pendente_fechamento by the time a manager acts (transicionar_atendimento_
-- pendente is still called first, so this is caught rather than silently
-- misbehaving), this RPC raises the same ATENDIMENTO_NAO_ESTA_FINALIZANDO
-- error; only the salesperson's own later login can resolve it via
-- concluir_atendimento_pendente. This is a deliberate, narrow V1 boundary,
-- not an oversight.
--
-- No p_adiar_checklist parameter — mirrors concluir_atendimento_pendente's
-- precedent for a completion variant that always requires the full
-- checklist. checklist_pendencias (the "Farei depois" deferred-checklist
-- backlog) is owned per-employee (id_funcionario); offering deferral here
-- would require deciding whose backlog a manager's deferral becomes, which
-- is exactly the kind of new ambiguity V1 should avoid. The frontend simply
-- never offers Farei depois in the management flow.
-- =============================================================================

alter table public.atendimentos
  add column if not exists id_funcionario_concluiu uuid references public.funcionarios(id);

-- -----------------------------------------------------------------------------
-- get_lista_vez_estado: same signature/return shape as 20260820_001. Only
-- change: id_atendimento is now also populated for 'finalizando' rows (was
-- 'ativo' only) — a manager/admin needs this Atendimento's id to target
-- concluir_atendimento_gerencial from Lista da Vez, without a second lookup.
-- iniciado_em and prazo_provisorio_em are deliberately left untouched (still
-- 'ativo'-only) — this does not reveal any new timer/countdown information
-- for a 'finalizando' row, only its opaque id.
-- -----------------------------------------------------------------------------
create or replace function public.get_lista_vez_estado(
  p_session_token text
)
returns table (
  id_funcionario uuid,
  nome text,
  status text,
  ordem int,
  iniciado_em timestamptz,
  id_atendimento uuid,
  id_funcionario_iniciador uuid,
  prazo_provisorio_em timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_dia date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  return query
    select
      f.id_funcionario,
      fu.nome::text,
      case
        when f.disponivel then 'disponivel'
        when a.status = 'finalizando' then 'finalizando'
        else 'em_atendimento'
      end as status,
      case
        when f.disponivel then
          row_number() over (partition by f.disponivel order by f.posicao asc)::int
        else null
      end as ordem,
      case when a.status = 'ativo' then a.iniciado_em else null end as iniciado_em,
      case when a.status in ('ativo', 'finalizando') then a.id else null end as id_atendimento,
      case when a.status = 'ativo' then a.id_funcionario_iniciador else null end
        as id_funcionario_iniciador,
      case
        when a.status = 'ativo' then
          a.iniciado_em + make_interval(
            secs => case when a.id_funcionario_iniciador <> a.id_funcionario then 60 else 20 end
          )
        else null
      end as prazo_provisorio_em
    from public.lista_vez_fila f
    join public.funcionarios fu on fu.id = f.id_funcionario
    left join public.atendimentos a
      on a.id_funcionario = f.id_funcionario and a.status in ('ativo', 'finalizando')
    where f.dia_manaus = v_dia
      and f.na_fila = true
    order by f.disponivel desc, f.posicao asc;
end;
$$;

revoke all on function public.get_lista_vez_estado(text) from public;
grant execute on function public.get_lista_vez_estado(text) to anon;

-- -----------------------------------------------------------------------------
-- concluir_atendimento: same 4-arg signature as 20260822_001. Only addition
-- is populating the new id_funcionario_concluiu audit column on every
-- self-completion (always v_ctx.id_funcionario here, since this RPC only
-- ever matches the caller's own row) — everything else is byte-for-byte
-- unchanged.
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

    insert into public.atendimento_checklists (id_atendimento, id_funcionario, versao, respostas)
    values (v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_respostas)
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
-- concluir_atendimento_pendente: same 3-arg signature as 20260822_001. Only
-- addition is populating id_funcionario_concluiu (always v_ctx.id_funcionario,
-- since this RPC only ever matches the caller's own row — section 8's
-- owner-only recovery restriction is unchanged) — everything else is
-- byte-for-byte unchanged.
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

  insert into public.atendimento_checklists (id_atendimento, id_funcionario, versao, respostas)
  values (v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_respostas)
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
-- concluir_atendimento_gerencial — NEW. Management completion on behalf of
-- another employee's Atendimento, currently in 'finalizando'. See header
-- note above for the full design rationale.
--
-- Authorization: v_ctx.cargo not in ('Administrador', 'Gerente') — same
-- literal cargo gate as remover_funcionario_lista_da_vez, this screen's
-- existing manager/admin-only action.
--
-- Target resolution: explicit p_id_atendimento (never "my own row" —
-- mirrors cancelar_atendimento_provisorio's precedent), locked with
-- `for update` and matched against status = 'finalizando'. A stale/already-
-- resolved target (completed by the salesperson themselves, or otherwise no
-- longer in 'finalizando') fails cleanly with ATENDIMENTO_NAO_ESTA_
-- FINALIZANDO — the same error the frontend already renders a friendly
-- message for — rather than double-completing or silently doing nothing.
--
-- Ownership/audit: id_funcionario (owner) is never written by this
-- function. id_funcionario_concluiu is set to v_ctx.id_funcionario (the
-- manager/admin who performed the action) — together with the already-
-- existing id_funcionario column this fully distinguishes "whose
-- Atendimento this is" from "who actually completed it", satisfying
-- required behavior 4 with no additional schema.
--
-- Lista da Vez: the closing upsert uses v_atendimento.id_funcionario (the
-- original salesperson), not v_ctx.id_funcionario — they return to the back
-- of today's queue exactly as an ordinary self-completion would (required
-- behavior 5), using the same nextval('lista_vez_posicao_seq') mechanism and
-- the same per-day advisory lock as concluir_atendimento.
-- -----------------------------------------------------------------------------
create or replace function public.concluir_atendimento_gerencial(
  p_session_token text,
  p_id_atendimento uuid,
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

  -- Closes the same day-boundary race concluir_atendimento already guards
  -- against for a self-completion (20260822_001) — a stale 'finalizando'
  -- page for an Atendimento that has since aged into 'pendente_fechamento'
  -- is caught by the status match below instead of being completed with
  -- today's date.
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

  -- id_funcionario here is the responsible employee (the salesperson),
  -- matching atendimento_checklists' established column meaning
  -- (20260821_001) — never the acting manager.
  insert into public.atendimento_checklists (id_atendimento, id_funcionario, versao, respostas)
  values (v_atendimento.id, v_atendimento.id_funcionario, v_versao_ativa, v_respostas)
  returning id into v_checklist_id;

  perform public.resolver_checklist_pendencias(
    v_atendimento.id_funcionario, 'fechamento_atendimento', v_checklist_id, null, v_versao_ativa
  );

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

revoke all on function public.concluir_atendimento_gerencial(text, uuid, jsonb, jsonb) from public;
grant execute on function public.concluir_atendimento_gerencial(text, uuid, jsonb, jsonb) to anon;

commit;
