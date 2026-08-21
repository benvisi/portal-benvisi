begin;

-- =============================================================================
-- Epic 2 — Atendimento, Milestone 2A.2: Lista da Vez Membership Management
--
-- Scope (see docs/portal-benvisi-blueprint.md section 8.5 / Milestone 2A.2):
-- an employee who has already completed Iniciar Atividades may voluntarily
-- leave Lista da Vez (one action covers any real-world reason — bathroom,
-- meal, stock room, end of day — no reason is captured) and rejoin later at
-- the back of the queue, any number of times per business day. A
-- manager/admin may also remove another currently-available employee from
-- Lista da Vez (e.g. someone who forgot to leave before going home).
--
-- Iniciar Atividades (turno_presenca) and Lista da Vez membership remain
-- distinct concepts (section 1): leaving/rejoining never touches
-- turno_presenca, and rejoining never requires a fresh Iniciar Atividades
-- call for the same Manaus business day.
--
-- Design:
--
-- - lista_vez_fila gains `na_fila boolean not null default true` —
--   "currently a Lista da Vez participant today" (available OR mid-
--   Atendimento), distinct from the existing `disponivel` ("available to
--   receive the next customer right now"). Leaving/removal sets both
--   na_fila and disponivel to false in the same statement; rejoining sets
--   both back to true and reassigns posicao to the back of the queue
--   (nextval, same "back of queue" mechanism concluir_atendimento already
--   uses). get_lista_vez_estado is redefined (same signature, `create or
--   replace`) to additionally filter `na_fila = true`, so an employee who
--   left or was removed disappears entirely from Lista da Vez — no visible
--   position number, remaining employees' relative order and posicao
--   values are completely untouched (no renumbering).
--
-- - iniciar_atendimento is intentionally NOT modified by this migration.
--   Milestone 2A.1 already added an explicit
--   `exists (... lista_vez_fila where id_funcionario = v_id_alvo and
--   dia_manaus = v_dia and disponivel = true)` guard that applies uniformly
--   to both self-starts and delegated starts (v_id_alvo covers both). Since
--   leaving/removal sets disponivel = false, that existing check already
--   correctly rejects starting (or being delegated-started into) an
--   Atendimento while outside Lista da Vez, satisfying section 16 for free.
--
-- - lista_vez_eventos is a new append-only audit table (section 12):
--   who left/rejoined/was removed (id_funcionario, the responsible/target
--   employee), when (criado_em), which authenticated actor performed the
--   action (id_funcionario_ator — equal to id_funcionario for a voluntary
--   leave/rejoin, different for an admin removal per section 13), and which
--   kind of event it was (tipo). This preserves the full historical
--   leave/rejoin/removal sequence — including cycle counts — in a way a
--   single mutable na_fila flag on lista_vez_fila cannot, per section 12's
--   explicit requirement not to rely on mutable-only state for
--   auditability. lista_vez_fila keeps representing current truth;
--   lista_vez_eventos preserves history. No reporting UI is built on top of
--   it in this milestone.
--
-- - Three new SECURITY DEFINER RPCs, following the exact same conventions
--   as every other Atendimento/Lista da Vez RPC (opaque session token,
--   server-resolved identity, the existing per-Manaus-day advisory lock
--   shared with iniciar_atendimento/cancelar_atendimento_provisorio/
--   concluir_atendimento so leave/rejoin/removal fully serialize against
--   every other queue mutation for the same day, P0001 business-rule
--   errors, revoke-all-then-grant-to-anon):
--
--     sair_lista_da_vez(p_session_token)
--       — voluntary leave. Responsible employee = actor = caller.
--     entrar_lista_da_vez(p_session_token)
--       — voluntary rejoin, to the back of the queue. Responsible employee
--         = actor = caller.
--     remover_funcionario_lista_da_vez(p_session_token, p_id_funcionario_alvo)
--       — manager/admin removal. Responsible employee = target;
--         authenticated actor = caller. Requires the caller's cargo
--         (server-resolved via get_valid_employee_session_context, never
--         client-supplied) to be 'Administrador' or 'Gerente' — the two
--         cargo values confirmed in use for manager/admin test accounts.
--         Does not touch the actor's own lista_vez_fila row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- lista_vez_fila.na_fila — see design note above. Defaulting to true means
-- every existing row (every employee already queued today, in whichever
-- state) is correctly treated as still being a full participant — no
-- backfill statement is needed beyond the column default itself.
-- -----------------------------------------------------------------------------
alter table public.lista_vez_fila
  add column if not exists na_fila boolean not null default true;

-- -----------------------------------------------------------------------------
-- lista_vez_eventos — append-only membership-change audit log (section 12).
-- -----------------------------------------------------------------------------
create table if not exists public.lista_vez_eventos (
  id bigint generated always as identity primary key,
  id_funcionario uuid not null references public.funcionarios(id) on delete cascade,
  dia_manaus date not null,
  tipo text not null,
  id_funcionario_ator uuid not null references public.funcionarios(id) on delete cascade,
  criado_em timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lista_vez_eventos'::regclass
      and conname = 'lista_vez_eventos_tipo_check'
  ) then
    alter table public.lista_vez_eventos
      add constraint lista_vez_eventos_tipo_check
      check (tipo in ('saida_voluntaria', 'reingresso', 'remocao_admin'));
  end if;
end $$;

create index if not exists lista_vez_eventos_funcionario_dia_idx
  on public.lista_vez_eventos (id_funcionario, dia_manaus);

alter table public.lista_vez_eventos enable row level security;
-- No policies: anon/authenticated have no direct table access, same
-- convention as atendimentos/lista_vez_fila — SECURITY DEFINER RPCs only.

-- -----------------------------------------------------------------------------
-- get_lista_vez_estado: unchanged signature/return shape from 20260819_003 —
-- only the WHERE clause gains `and f.na_fila = true`, so an employee who
-- left or was removed no longer appears in Lista da Vez at all (not as
-- available, not as busy). Ordem is still computed by row_number() over the
-- remaining disponivel = true rows only, so it stays consecutive with no
-- gaps and no effect on anyone else's posicao/order.
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
      case when a.status = 'ativo' then a.id else null end as id_atendimento,
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
-- sair_lista_da_vez — voluntary leave (section 2/3/4). Only valid from
-- na_fila = true and disponivel = true (currently available); rejects with a
-- distinct, understandable error if the employee never joined today, already
-- left, or is currently Em atendimento/Finalizando (must resolve that
-- Atendimento through the normal flow first — this RPC never touches
-- atendimentos).
-- -----------------------------------------------------------------------------
create or replace function public.sair_lista_da_vez(
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_dia date;
  v_fila record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  select * into v_fila
  from public.lista_vez_fila
  where id_funcionario = v_ctx.id_funcionario and dia_manaus = v_dia
  for update;

  if v_fila.id is null then
    raise exception using errcode = 'P0001', message = 'ATIVIDADES_NAO_INICIADAS';
  end if;

  if not v_fila.na_fila then
    raise exception using errcode = 'P0001', message = 'JA_FORA_DA_LISTA';
  end if;

  if not v_fila.disponivel then
    raise exception using errcode = 'P0001', message = 'EM_ATENDIMENTO_NAO_PODE_SAIR';
  end if;

  update public.lista_vez_fila
  set na_fila = false, disponivel = false, atualizado_em = now()
  where id = v_fila.id;

  insert into public.lista_vez_eventos (id_funcionario, dia_manaus, tipo, id_funcionario_ator)
  values (v_ctx.id_funcionario, v_dia, 'saida_voluntaria', v_ctx.id_funcionario);

  return true;
end;
$$;

revoke all on function public.sair_lista_da_vez(text) from public;
grant execute on function public.sair_lista_da_vez(text) to anon;

-- -----------------------------------------------------------------------------
-- entrar_lista_da_vez — voluntary rejoin (section 5), to the back of today's
-- available queue. Requires today's Iniciar Atividades to already be
-- complete (checked directly against turno_presenca, the same source
-- registrar_turno_presenca itself checks/writes — never requires a fresh
-- Iniciar Atividades call). Upserts on (id_funcionario, dia_manaus): the row
-- normally already exists (created by registrar_turno_presenca), but the
-- insert branch defensively covers the same row missing outright.
-- -----------------------------------------------------------------------------
create or replace function public.entrar_lista_da_vez(
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_dia date;
  v_fila record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  if not exists (
    select 1 from public.turno_presenca
    where id_funcionario = v_ctx.id_funcionario
      and (checked_in_at at time zone 'America/Manaus')::date = v_dia
  ) then
    raise exception using errcode = 'P0001', message = 'ATIVIDADES_NAO_INICIADAS';
  end if;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  select * into v_fila
  from public.lista_vez_fila
  where id_funcionario = v_ctx.id_funcionario and dia_manaus = v_dia
  for update;

  if v_fila.id is not null and v_fila.na_fila then
    raise exception using errcode = 'P0001', message = 'JA_NA_LISTA';
  end if;

  insert into public.lista_vez_fila (id_funcionario, dia_manaus, na_fila, disponivel, posicao)
  values (v_ctx.id_funcionario, v_dia, true, true, nextval('public.lista_vez_posicao_seq'))
  on conflict (id_funcionario, dia_manaus)
  do update set
    na_fila = true,
    disponivel = true,
    posicao = excluded.posicao,
    atualizado_em = now();

  insert into public.lista_vez_eventos (id_funcionario, dia_manaus, tipo, id_funcionario_ator)
  values (v_ctx.id_funcionario, v_dia, 'reingresso', v_ctx.id_funcionario);

  return true;
end;
$$;

revoke all on function public.entrar_lista_da_vez(text) from public;
grant execute on function public.entrar_lista_da_vez(text) to anon;

-- -----------------------------------------------------------------------------
-- remover_funcionario_lista_da_vez — manager/admin removal (section 7/8/9).
-- Authorization is enforced here, server-side, against the caller's cargo as
-- resolved by get_valid_employee_session_context — never against anything
-- client-supplied, and never satisfied merely by the frontend hiding the
-- button. The target must currently be na_fila = true and disponivel = true
-- (available); a target who already left/was removed, or who is Em
-- atendimento/Finalizando, is rejected with a distinct, understandable
-- error rather than silently doing nothing. Never touches the actor's own
-- lista_vez_fila row.
-- -----------------------------------------------------------------------------
create or replace function public.remover_funcionario_lista_da_vez(
  p_session_token text,
  p_id_funcionario_alvo uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_dia date;
  v_fila record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if v_ctx.cargo not in ('Administrador', 'Gerente') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_REMOVER';
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  select * into v_fila
  from public.lista_vez_fila
  where id_funcionario = p_id_funcionario_alvo and dia_manaus = v_dia
  for update;

  if v_fila.id is null or not v_fila.na_fila then
    raise exception using errcode = 'P0001', message = 'FUNCIONARIO_ALVO_INDISPONIVEL';
  end if;

  if not v_fila.disponivel then
    raise exception using errcode = 'P0001', message = 'FUNCIONARIO_EM_ATENDIMENTO';
  end if;

  update public.lista_vez_fila
  set na_fila = false, disponivel = false, atualizado_em = now()
  where id = v_fila.id;

  insert into public.lista_vez_eventos (id_funcionario, dia_manaus, tipo, id_funcionario_ator)
  values (p_id_funcionario_alvo, v_dia, 'remocao_admin', v_ctx.id_funcionario);

  return true;
end;
$$;

revoke all on function public.remover_funcionario_lista_da_vez(text, uuid) from public;
grant execute on function public.remover_funcionario_lista_da_vez(text, uuid) to anon;

commit;
