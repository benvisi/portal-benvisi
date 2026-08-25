begin;

-- =============================================================================
-- Epic 2 Stabilization — Gerente / Administrador and Lista da Vez
--
-- Approved business rule change:
--
--   Vendedor    — Iniciar atividades still auto-enters Lista da Vez
--                 (unchanged).
--   Gerente     — Iniciar atividades records operational readiness only; it
--                 no longer auto-enters Lista da Vez. A Gerente may still
--                 manually Entrar na Lista da Vez afterward (unchanged
--                 function, normal back-of-queue behavior), and keeps Sair
--                 da Lista da Vez / re-entry / delegated / management
--                 actions exactly as before.
--   Administrador — never personally participates in Lista da Vez, neither
--                 automatically nor manually, under the current role model.
--
-- This is intentionally NOT a configurable setting (see the Blueprint's new
-- roadmap entry for a possible future "Gerentes entram automaticamente"
-- toggle) — for now, the rule is a fixed cargo check.
--
-- Two functions change, both via plain CREATE OR REPLACE (signatures
-- unchanged):
--
-- 1. registrar_turno_presenca — the turno_presenca insert (operational
--    readiness) stays completely unconditional for every cargo; only the
--    lista_vez_fila auto-join insert gains a cargo guard. Vendedor
--    self-starting an Atendimento, timers, and every other Iniciar
--    Atividades behavior are untouched.
--
-- 2. entrar_lista_da_vez — gains an explicit Administrador rejection at the
--    top, before any other check. The frontend already never shows this
--    action to an Administrador (Epic 2 stabilization Atendimento UX fix);
--    this is the backend-authoritative enforcement of the same rule,
--    consistent with this project's "hiding a button is UX, not
--    authorization" principle. Gerente is deliberately NOT blocked here —
--    manual participation is exactly what remains approved for them.
--
-- No change to sair_lista_da_vez, remover_funcionario_lista_da_vez, or
-- iniciar_atendimento: an Administrador who is never a lista_vez_fila
-- member (blocked from both auto-join and manual join) can never satisfy
-- iniciar_atendimento's existing `disponivel = true` eligibility check
-- either — as a self-start or as a delegate-start target — so no additional
-- guard is needed there for this rule to be fully closed off end to end.
-- =============================================================================

create or replace function public.registrar_turno_presenca(
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
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  insert into public.turno_presenca (id_funcionario)
  values (v_ctx.id_funcionario)
  on conflict (id_funcionario, ((checked_in_at at time zone 'America/Manaus')::date))
  do nothing;

  v_dia := (now() at time zone 'America/Manaus')::date;

  -- Stabilization: only auto-join Lista da Vez for cargos other than
  -- Gerente/Administrador (i.e. Vendedor today). Gerente may still join
  -- manually via entrar_lista_da_vez; Administrador may not join at all
  -- (see that function).
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    insert into public.lista_vez_fila (id_funcionario, dia_manaus)
    values (v_ctx.id_funcionario, v_dia)
    on conflict (id_funcionario, dia_manaus) do nothing;
  end if;

  return true;
end;
$$;

revoke all on function public.registrar_turno_presenca(text) from public;
grant execute on function public.registrar_turno_presenca(text) to anon;

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

  -- Stabilization: Administrador never personally participates in Lista da
  -- Vez, manual join included. Gerente is deliberately allowed past this
  -- check — manual participation is exactly what remains approved.
  if v_ctx.cargo = 'Administrador' then
    raise exception using errcode = 'P0001', message = 'SEM_PARTICIPACAO_ADMINISTRADOR';
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

commit;
