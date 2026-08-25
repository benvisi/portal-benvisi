begin;

-- =============================================================================
-- Epic 2 — Atendimento, Milestone 2C.1: Checklist Policy + Deferral Backlog
-- Creation
--
-- Scope (docs/portal-benvisi-blueprint.md, Milestone 2C.1): an authoritative
-- server-side checklist policy (`required` | `defer_allowed`, default
-- `required`) that an Administrador may change; a durable append-only
-- history of policy changes; and, when policy = `defer_allowed`, a
-- `Farei depois` path through the existing `concluir_atendimento` that
-- still concludes the Atendimento and returns the employee to Lista da Vez,
-- but creates exactly one durable pending checklist obligation instead of a
-- completed-checklist row. Resolution of that obligation (Milestone 2C.2)
-- is explicitly NOT built here — obligations simply remain `pending`.
--
-- Three new tables:
--
-- - checklist_config: a single mutable current-policy row (singleton via
--   `id int primary key default 1 check (id = 1)` — the same "exactly one
--   row, enforced by the primary key itself" idiom used nowhere else yet in
--   this schema but standard for global config, and simpler than adding a
--   partial unique index for a table that only ever has one conceptual
--   scope). No per-employee/per-role/date-scoped policy — section 2
--   explicitly asks for a single current store/global policy only.
--
-- - checklist_policy_eventos: append-only audit trail (section 4) —
--   politica_anterior/politica_nova/actor/timestamp for every actual
--   transition. A no-op "change" to the same policy does not write a new
--   event (see set_checklist_policy below), keeping the history meaningful
--   ("policy changed from required -> defer_allowed") rather than noisy.
--
-- - checklist_pendencias: one durable row per deferred Atendimento (section
--   12/13/15). `unique (id_atendimento)` is the database-level guarantee
--   that a single Atendimento can never accidentally create two pending
--   obligations (section 15), the same pattern already used by
--   atendimento_checklists in 20260821_001. Nullable resolvido_em/
--   tipo_resolucao/id_resolucao columns are added now, per section 13's
--   explicit invitation to do so, purely so Milestone 2C.2 can populate
--   them without another schema change — no resolution logic reads or
--   writes them in this migration.
--
-- concluir_atendimento gains a fourth parameter, p_adiar_checklist boolean
-- default false — an explicit, unambiguous statement of intent from the
-- client (section 30/31: deferral must never be inferred from an
-- incomplete p_checklist payload). Argument list change -> new overload ->
-- the old 3-arg version is explicitly dropped first, same convention as
-- every previous concluir_atendimento/iniciar_atendimento evolution in this
-- epic.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- checklist_config — current authoritative policy. Singleton enforced by the
-- primary key itself (id is always 1).
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_config (
  id int primary key default 1,
  policy text not null default 'required' check (policy in ('required', 'defer_allowed')),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.funcionarios(id),
  constraint checklist_config_singleton check (id = 1)
);

insert into public.checklist_config (id, policy)
values (1, 'required')
on conflict (id) do nothing;

alter table public.checklist_config enable row level security;
-- No policies: read via get_checklist_policy, write via set_checklist_policy
-- (both SECURITY DEFINER), same convention as every other table here.

-- -----------------------------------------------------------------------------
-- checklist_policy_eventos — append-only policy-change audit (section 4).
-- politica_anterior is nullable only in principle (there is always a row in
-- checklist_config from the seed above, so in practice every event has a
-- real prior value); left nullable rather than forced not-null so a future
-- from-scratch environment without the seed row does not need a special
-- case here.
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_policy_eventos (
  id bigint generated always as identity primary key,
  politica_anterior text,
  politica_nova text not null check (politica_nova in ('required', 'defer_allowed')),
  id_funcionario_ator uuid not null references public.funcionarios(id) on delete cascade,
  criado_em timestamptz not null default now()
);

create index if not exists checklist_policy_eventos_criado_em_idx
  on public.checklist_policy_eventos (criado_em desc);

alter table public.checklist_policy_eventos enable row level security;
-- No policies: written exclusively by set_checklist_policy (SECURITY
-- DEFINER) below.

-- -----------------------------------------------------------------------------
-- checklist_pendencias — one durable row per deferred Atendimento (section
-- 12/13/14/15). status stays 'pending' throughout this milestone; the
-- resolved-* columns exist now (nullable) so 2C.2 can populate them without
-- a schema change, but nothing in this migration ever sets them.
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_pendencias (
  id uuid primary key default gen_random_uuid(),
  id_atendimento uuid not null references public.atendimentos(id) on delete cascade,
  id_funcionario uuid not null references public.funcionarios(id) on delete cascade,
  checklist_versao int not null,
  politica_no_momento text not null,
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  adiado_em timestamptz not null default now(),
  resolvido_em timestamptz,
  tipo_resolucao text,
  id_resolucao uuid,
  unique (id_atendimento),
  constraint checklist_pendencias_status_resolucao_consistente check (
    (status = 'pending' and resolvido_em is null)
    or (status = 'resolved' and resolvido_em is not null)
  )
);

create index if not exists checklist_pendencias_funcionario_status_idx
  on public.checklist_pendencias (id_funcionario, status);

alter table public.checklist_pendencias enable row level security;
-- No policies: written exclusively by concluir_atendimento (SECURITY
-- DEFINER) below; read via get_checklist_pendencias_count.

-- -----------------------------------------------------------------------------
-- get_checklist_policy — read-only, any authenticated employee. Needed by
-- the closing UI to decide whether to offer Farei depois at all, and to
-- refresh that decision if an admin changes policy mid-session (section 6).
-- -----------------------------------------------------------------------------
create or replace function public.get_checklist_policy(
  p_session_token text
)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_policy text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select cc.policy into v_policy from public.checklist_config cc where cc.id = 1;

  return v_policy;
end;
$$;

revoke all on function public.get_checklist_policy(text) from public;
grant execute on function public.get_checklist_policy(text) to anon;

-- -----------------------------------------------------------------------------
-- set_checklist_policy — Administrador only (section 3). Gerente is NOT
-- authorized here: the existing role model already draws this exact line —
-- the dashboard's "Administrativo" module/settings surface is gated to
-- cargo = 'Administrador' only (Gerente sees it no more than a Vendedor
-- does), while Gerente's existing extra privilege (Milestone 2A.2's Lista
-- da Vez removal) is a day-to-day operational action, not a store-wide
-- configuration change. A global checklist policy is configuration, so it
-- follows the Administrativo precedent rather than the queue-removal one —
-- see the Blueprint note alongside this migration for the full reasoning.
-- Idempotent with respect to auditability: setting the policy to its
-- current value succeeds (returns true) but writes no new history row,
-- since nothing actually changed.
-- -----------------------------------------------------------------------------
create or replace function public.set_checklist_policy(
  p_session_token text,
  p_policy text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_politica_atual text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if v_ctx.cargo <> 'Administrador' then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_POLITICA';
  end if;

  if p_policy not in ('required', 'defer_allowed') then
    raise exception using errcode = 'P0001', message = 'POLITICA_INVALIDA';
  end if;

  select cc.policy into v_politica_atual from public.checklist_config cc where cc.id = 1 for update;

  if v_politica_atual is distinct from p_policy then
    insert into public.checklist_policy_eventos (politica_anterior, politica_nova, id_funcionario_ator)
    values (v_politica_atual, p_policy, v_ctx.id_funcionario);

    update public.checklist_config
    set policy = p_policy, atualizado_em = now(), atualizado_por = v_ctx.id_funcionario
    where id = 1;
  end if;

  return true;
end;
$$;

revoke all on function public.set_checklist_policy(text, text) from public;
grant execute on function public.set_checklist_policy(text, text) to anon;

-- -----------------------------------------------------------------------------
-- get_checklist_pendencias_count — the caller's own pending-obligation
-- count only (section 16). No target-employee parameter: an employee never
-- needs to see anyone else's backlog in this milestone, and no admin
-- cross-employee view is in scope either.
-- -----------------------------------------------------------------------------
create or replace function public.get_checklist_pendencias_count(
  p_session_token text
)
returns int
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_count int;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select count(*) into v_count
  from public.checklist_pendencias cp
  where cp.id_funcionario = v_ctx.id_funcionario and cp.status = 'pending';

  return v_count;
end;
$$;

revoke all on function public.get_checklist_pendencias_count(text) from public;
grant execute on function public.get_checklist_pendencias_count(text) to anon;

-- -----------------------------------------------------------------------------
-- concluir_atendimento — extended with p_adiar_checklist (section 10/11/27).
--
-- Customer-outcome validation/persistence is byte-for-byte unchanged from
-- 20260821_001. The checklist-active-version lookup is also unchanged and
-- now shared by both branches below. What differs is only what happens
-- with that version once resolved:
--
-- - p_adiar_checklist = false (default; both policies): identical to
--   20260821_001's required-completion path — full server-side validation
--   against the authoritative item set, atendimento_checklists insert. This
--   is always available regardless of policy — "the employee should still
--   be encouraged to complete the checklist immediately" even under
--   defer_allowed.
--
-- - p_adiar_checklist = true: only reachable when the authoritative policy
--   is currently 'defer_allowed' — otherwise ADIAMENTO_NAO_PERMITIDO. The
--   policy row is read with `for share` (below), not a plain SELECT: a
--   plain unlocked read under READ COMMITTED does not serialize against
--   set_checklist_policy's `for update` + UPDATE at all — it would just
--   read whatever was last committed at that statement's start, letting
--   this transaction commit a deferral based on a policy value an admin
--   had already superseded before this transaction's own commit. `for
--   share` makes the two transactions mutually exclusive on this one row:
--   whichever of set_checklist_policy's `for update` or this `for share`
--   actually acquires the row lock first forces the other to block until
--   it commits or rolls back, and a blocked locking read that unblocks
--   afterward re-fetches the row's latest committed value rather than an
--   earlier snapshot — so the loser always observes the winner's outcome,
--   never a stale pre-commit value. `for share` (not `for update`) is
--   deliberate: this function only ever reads checklist_config, so
--   multiple concurrent deferrals must not block each other, only block
--   against/be blocked by an in-flight policy change. p_checklist is
--   deliberately never inspected on this path — deferral intent is
--   unconditional once authorized, never silently upgraded to "complete"
--   even if the client happened to have every item checked locally
--   (section 9) — and no atendimento_checklists row is written at all, so
--   there is no partial/incomplete historical completion record.
--
-- Both branches insert into or skip these tables before the same shared
-- Atendimento-conclusion + Lista da Vez return logic — still one atomic
-- transaction, still gated by the same `for update` + status = 'finalizando'
-- lock that has protected every closing path since Milestone 2A, so
-- Race B (double-click) and Race C (two devices) are handled exactly as
-- before: the second call sees status = 'concluido' and is rejected with
-- ATENDIMENTO_NAO_ESTA_FINALIZANDO before it can write anything, and
-- checklist_pendencias' unique (id_atendimento) is an additional
-- database-level guarantee even if that were ever somehow bypassed.
-- -----------------------------------------------------------------------------
drop function if exists public.concluir_atendimento(text, jsonb, jsonb);

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

  -- Customer outcomes — unchanged from 20260821_001.
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
    -- Deferral path (Milestone 2C.1) — authoritative policy re-read fresh,
    -- never trusted from an earlier page load, and locked `for share` so
    -- this read is mutually exclusive with set_checklist_policy's
    -- `for update` (see the note above this function for the full
    -- reasoning) rather than racing it via an unlocked snapshot read.
    select cc.policy into v_politica from public.checklist_config cc where cc.id = 1 for share;

    if v_politica is distinct from 'defer_allowed' then
      raise exception using errcode = 'P0001', message = 'ADIAMENTO_NAO_PERMITIDO';
    end if;

    insert into public.checklist_pendencias (
      id_atendimento, id_funcionario, checklist_versao, politica_no_momento, status
    ) values (
      v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_politica, 'pending'
    );
  else
    -- Complete-now path — identical validation/persistence to
    -- 20260821_001, available under either policy.
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
    values (v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_respostas);
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
