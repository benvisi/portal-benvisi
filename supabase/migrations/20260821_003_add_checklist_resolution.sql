begin;

-- =============================================================================
-- Epic 2 — Atendimento, Milestone 2C.2: Deferred Checklist Resolution
--
-- Core rule: one genuine, backend-validated checklist completion — whether
-- performed during a later Atendimento's normal closing, or performed
-- standalone with no Atendimento at all — resolves EVERY obligation that is
-- currently `pending` for that employee at the authoritative moment of
-- resolution, not just one. Every original obligation (created in
-- 20260821_002) remains individually auditable: this migration never
-- deletes, merges, or rewrites a `checklist_pendencias` row's original
-- `id_atendimento` / `checklist_versao` / `politica_no_momento` /
-- `adiado_em` — it only flips `status` to 'resolved' and records how.
--
-- Two new tables:
--
-- - checklist_conclusoes_avulsas: standalone checklist completions, fully
--   independent of atendimentos (no Atendimento is created or required —
--   section 7/12/42). Mirrors atendimento_checklists' shape but explicitly
--   also carries id_funcionario_ator alongside id_funcionario: unlike
--   atendimento_checklists (which has an owning Atendimento row to anchor
--   "responsible employee" and never needed a separate actor column),
--   a standalone completion has no such anchor, so both concepts are
--   recorded directly here even though they are always the same value
--   under this milestone's permissions (section 13) — this keeps the
--   architecture already compatible with a future privileged/manager
--   completion-on-behalf-of workflow without another schema change.
--
-- - checklist_pendencia_resolucoes: the resolution relationship (section 3).
--   20260821_002 already reserved resolvido_em/tipo_resolucao/id_resolucao
--   directly on checklist_pendencias specifically for this migration, and
--   those remain the cheap, single-table answer to "is this pendencia
--   resolved, and roughly how/when" (get_checklist_pendencias_count keeps
--   working completely unmodified, still a single-table `status = 'pending'`
--   count). But a resolution can come from exactly one of two different
--   completion tables (atendimento_checklists OR
--   checklist_conclusoes_avulsas), and putting two independently-nullable
--   foreign keys directly on checklist_pendencias for that would be the
--   awkward polymorphic-row pattern explicitly worth avoiding. Instead this
--   dedicated table holds the exclusive-arc relationship (exactly one of
--   id_atendimento_checklist / id_checklist_avulso populated, enforced by a
--   check constraint, both real foreign keys with full referential
--   integrity to their respective completion table) plus its own
--   versao_resolucao/resolvido_em. checklist_pendencias.id_resolucao is
--   given a proper foreign key to this table by this migration (it already
--   existed as a bare nullable uuid column from 20260821_002, which
--   anticipated exactly this).
--
-- resolver_checklist_pendencias is a small internal (never anon-granted)
-- helper shared by both resolution call sites below, so the "resolve every
-- currently-pending row for this employee, atomically, exactly once" logic
-- exists in exactly one place — same non-duplication convention as every
-- other internal-only helper in this schema (e.g. issue_employee_session).
--
-- Concurrency: a single per-employee transaction-scoped advisory lock,
-- `pg_advisory_xact_lock(hashtext('checklist_pendencias:' || id::text))`,
-- is acquired by every operation that mutates that employee's pending set —
-- deferral creation (concluir_atendimento's p_adiar_checklist branch, added
-- here) and both resolution paths (via resolver_checklist_pendencias,
-- called from concluir_atendimento's complete-now branch and from the new
-- concluir_checklist_avulso). This makes deferral-vs-resolution and
-- resolution-vs-resolution races for the SAME employee fully serialized
-- against each other — see the lock-ordering note above
-- resolver_checklist_pendencias below for the full deadlock analysis
-- against the existing atendimentos/checklist_config/lista_vez locks.
--
-- concluir_atendimento's signature is unchanged (still 4 args) — this is a
-- behavior-only redefinition (create or replace over the exact same
-- signature), no drop/recreate needed this time.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- checklist_conclusoes_avulsas — standalone checklist completions.
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_conclusoes_avulsas (
  id uuid primary key default gen_random_uuid(),
  id_funcionario uuid not null references public.funcionarios(id) on delete cascade,
  id_funcionario_ator uuid not null references public.funcionarios(id) on delete cascade,
  versao int not null,
  respostas jsonb not null,
  completado_em timestamptz not null default now()
);

create index if not exists checklist_conclusoes_avulsas_id_funcionario_idx
  on public.checklist_conclusoes_avulsas (id_funcionario);

alter table public.checklist_conclusoes_avulsas enable row level security;
-- No policies: written exclusively by concluir_checklist_avulso (SECURITY
-- DEFINER) below, same convention as every other table in this schema.

-- -----------------------------------------------------------------------------
-- checklist_pendencia_resolucoes — the resolution relationship. Exactly one
-- row per resolved pendencia (unique (id_pendencia)); exactly one of the two
-- completion-table references is populated, enforced by the check
-- constraint below, so both are real, referentially-intact foreign keys
-- rather than an unconstrained polymorphic pointer.
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_pendencia_resolucoes (
  id uuid primary key default gen_random_uuid(),
  id_pendencia uuid not null references public.checklist_pendencias(id) on delete cascade,
  tipo_resolucao text not null check (tipo_resolucao in ('fechamento_atendimento', 'checklist_avulso')),
  id_atendimento_checklist uuid references public.atendimento_checklists(id),
  id_checklist_avulso uuid references public.checklist_conclusoes_avulsas(id),
  versao_resolucao int not null,
  resolvido_em timestamptz not null default now(),
  unique (id_pendencia),
  constraint checklist_pendencia_resolucoes_fonte_exclusiva check (
    (tipo_resolucao = 'fechamento_atendimento'
      and id_atendimento_checklist is not null and id_checklist_avulso is null)
    or
    (tipo_resolucao = 'checklist_avulso'
      and id_checklist_avulso is not null and id_atendimento_checklist is null)
  )
);

create index if not exists checklist_pendencia_resolucoes_atendimento_checklist_idx
  on public.checklist_pendencia_resolucoes (id_atendimento_checklist);

create index if not exists checklist_pendencia_resolucoes_checklist_avulso_idx
  on public.checklist_pendencia_resolucoes (id_checklist_avulso);

alter table public.checklist_pendencia_resolucoes enable row level security;
-- No policies: written exclusively by resolver_checklist_pendencias
-- (SECURITY DEFINER, internal-only) below.

-- checklist_pendencias.id_resolucao already exists (nullable uuid, from
-- 20260821_002) but was never given a foreign key — add one now that its
-- target table exists. Guarded so this migration stays safely re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.checklist_pendencias'::regclass
      and conname = 'checklist_pendencias_id_resolucao_fkey'
  ) then
    alter table public.checklist_pendencias
      add constraint checklist_pendencias_id_resolucao_fkey
      foreign key (id_resolucao) references public.checklist_pendencia_resolucoes(id);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- resolver_checklist_pendencias — internal helper (never granted to anon):
-- resolves every currently-pending checklist_pendencias row for one
-- employee, atomically, under that employee's advisory lock. Trusts
-- p_id_funcionario as given — callers must have already resolved that
-- identity from a validated opaque session themselves, exactly like
-- issue_employee_session's existing internal-only convention. Returns the
-- number of obligations actually resolved (0 is a valid, non-error result
-- for this helper itself; callers decide whether 0 is worth surfacing as
-- SEM_CHECKLIST_PENDENTE).
--
-- Lock ordering (full picture, for deadlock analysis): every code path that
-- can hold more than one of these locks acquires them in the same order —
-- atendimentos(employee) -> [checklist_config, defer path only] ->
-- checklist_pendencias(employee) -> lista_vez(day). concluir_checklist_avulso
-- only ever acquires checklist_pendencias(employee) and nothing else, so it
-- can never participate in a wait cycle (a transaction that only ever holds
-- a single lock cannot be part of a deadlock). checklist_pendencias(employee)
-- is scoped per employee, so two different employees' transactions never
-- contend on it at all. pg_advisory_xact_lock is safely re-entrant within
-- one transaction, so a caller that already holds this lock and calls this
-- helper (which acquires it again) is a fast no-op, not a self-deadlock.
-- -----------------------------------------------------------------------------
create or replace function public.resolver_checklist_pendencias(
  p_id_funcionario uuid,
  p_tipo_resolucao text,
  p_id_atendimento_checklist uuid,
  p_id_checklist_avulso uuid,
  p_versao_resolucao int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resolvido_em timestamptz := now();
  v_count int := 0;
  v_pendencia record;
  v_id_resolucao uuid;
begin
  perform pg_advisory_xact_lock(
    hashtext('checklist_pendencias:' || p_id_funcionario::text)::bigint
  );

  for v_pendencia in
    select cp.id
    from public.checklist_pendencias cp
    where cp.id_funcionario = p_id_funcionario and cp.status = 'pending'
    for update
  loop
    insert into public.checklist_pendencia_resolucoes (
      id_pendencia, tipo_resolucao, id_atendimento_checklist, id_checklist_avulso,
      versao_resolucao, resolvido_em
    ) values (
      v_pendencia.id, p_tipo_resolucao, p_id_atendimento_checklist, p_id_checklist_avulso,
      p_versao_resolucao, v_resolvido_em
    )
    returning id into v_id_resolucao;

    update public.checklist_pendencias
    set status = 'resolved',
        resolvido_em = v_resolvido_em,
        tipo_resolucao = p_tipo_resolucao,
        id_resolucao = v_id_resolucao
    where id = v_pendencia.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.resolver_checklist_pendencias(uuid, text, uuid, uuid, int) from public;
-- Deliberately NOT granted to anon — see the header comment above.

-- -----------------------------------------------------------------------------
-- concluir_checklist_avulso — standalone checklist completion (section 7).
-- No Atendimento is created, read, or modified; Lista da Vez / queue state
-- is never touched (section 42). Unavailable while the employee has an
-- active or finalizing Atendimento (section 43) — enforced here, not only
-- by hiding the UI action. Returns the number of obligations resolved
-- (always >= 1 on success); if there is nothing currently pending, this
-- fails cleanly with SEM_CHECKLIST_PENDENTE rather than "succeeding" with 0,
-- so a stale UI (e.g. another device already resolved the backlog) gets an
-- explicit, distinguishable signal to refresh rather than silently doing
-- nothing.
-- -----------------------------------------------------------------------------
create or replace function public.concluir_checklist_avulso(
  p_session_token text,
  p_checklist jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_versao_ativa int;
  v_codigos_confirmados text[];
  v_respostas jsonb;
  v_conclusao_id uuid;
  v_resolved_count int;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if exists (
    select 1 from public.atendimentos
    where id_funcionario = v_ctx.id_funcionario and status in ('ativo', 'finalizando')
  ) then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_ATIVO_IMPEDE_CHECKLIST_AVULSO';
  end if;

  if not exists (
    select 1 from public.checklist_pendencias
    where id_funcionario = v_ctx.id_funcionario and status = 'pending'
  ) then
    raise exception using errcode = 'P0001', message = 'SEM_CHECKLIST_PENDENTE';
  end if;

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

  -- Note: the "at least one pending" check above happens before this
  -- employee's advisory lock is held (resolver_checklist_pendencias
  -- acquires it). A concurrent resolution racing this one may still empty
  -- the backlog between that check and the lock being acquired below —
  -- resolver_checklist_pendencias simply resolves 0 rows in that case
  -- (its FOR UPDATE loop just finds nothing), which this function still
  -- reports as a successful completion (the standalone completion record
  -- itself is genuine either way) rather than a false SEM_CHECKLIST_PENDENTE
  -- after the employee already submitted a valid checklist.
  insert into public.checklist_conclusoes_avulsas (
    id_funcionario, id_funcionario_ator, versao, respostas
  ) values (
    v_ctx.id_funcionario, v_ctx.id_funcionario, v_versao_ativa, v_respostas
  )
  returning id into v_conclusao_id;

  v_resolved_count := public.resolver_checklist_pendencias(
    v_ctx.id_funcionario, 'checklist_avulso', null, v_conclusao_id, v_versao_ativa
  );

  return v_resolved_count;
end;
$$;

revoke all on function public.concluir_checklist_avulso(text, jsonb) from public;
grant execute on function public.concluir_checklist_avulso(text, jsonb) to anon;

-- -----------------------------------------------------------------------------
-- concluir_atendimento — same 4-arg signature as 20260821_002, extended so
-- the complete-now branch resolves prior backlog and the deferral branch
-- takes the same per-employee advisory lock as every other backlog
-- mutation before inserting a new pending row. Everything else (customer
-- validation, active-version resolution, the FOR SHARE policy read, queue
-- return) is unchanged from 20260821_002.
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

  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = v_ctx.id_funcionario and status = 'finalizando'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

  -- Customer outcomes — unchanged since 20260821_001.
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

  -- Active checklist version — always resolved fresh, shared by both
  -- branches below.
  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_adiar_checklist then
    -- Deferral path (Milestone 2C.1) — unchanged policy check, plus the
    -- same per-employee advisory lock every backlog mutation now takes
    -- (Milestone 2C.2), so a deferral can never race a concurrent
    -- resolution into inconsistent state for this employee.
    select cc.policy into v_politica from public.checklist_config cc where cc.id = 1 for share;

    if v_politica is distinct from 'defer_allowed' then
      raise exception using errcode = 'P0001', message = 'ADIAMENTO_NAO_PERMITIDO';
    end if;

    perform pg_advisory_xact_lock(
      hashtext('checklist_pendencias:' || v_ctx.id_funcionario::text)::bigint
    );

    insert into public.checklist_pendencias (
      id_atendimento, id_funcionario, checklist_versao, politica_no_momento, status
    ) values (
      v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_politica, 'pending'
    );
  else
    -- Complete-now path — validation/persistence unchanged since
    -- 20260821_001/002. New in 2C.2: after this Atendimento's own checklist
    -- completion is persisted, resolve every obligation currently pending
    -- for this employee (Milestone 2C.2 section 5/24) — a normal
    -- Atendimento closing with a genuinely completed checklist is one of
    -- the two approved ways to clear backlog, regardless of the store's
    -- current policy value.
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
      concluido_em = now()
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

commit;
