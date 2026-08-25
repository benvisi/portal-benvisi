begin;

-- =============================================================================
-- Epic 2 Stabilization — Correction: Lista da Vez auto-join must be an
-- inclusion rule, not an exclusion rule
--
-- Audit finding: 20260823_002_restrict_gerente_admin_lista_auto_join.sql
-- (already applied, left untouched — this is a new additive correction,
-- not an edit of that file) gated registrar_turno_presenca's Lista da Vez
-- auto-join on:
--
--   if v_ctx.cargo not in ('Gerente', 'Administrador') then ...
--
-- This is an EXCLUSION check. It is only equivalent to "Vendedor only" if
-- cargo is provably restricted to exactly {Vendedor, Gerente,
-- Administrador} — and nothing in this codebase guarantees that:
--
--   - no funcionarios table definition or cargo CHECK constraint appears
--     anywhere in tracked migration history (the table predates migration
--     tracking);
--   - the frontend treats cargo as an open `string` everywhere (no union
--     type, no enum, no VENDEDOR_CARGO constant — every check is written
--     as `=== ADMINISTRATOR_CARGO` / `=== MANAGER_CARGO`, same open
--     exclusion pattern);
--   - docs/portal-benvisi-blueprint.md's own "Primary Users" section
--     explicitly anticipates future role expansion ("operations, regional
--     management, HR, franchise ownership, specialized support roles");
--   - no other RPC (iniciar_atendimento included) checks cargo for Lista da
--     Vez / Atendimento eligibility at all, so this auto-join gate is the
--     only place this distinction is enforced — there is no secondary
--     guard that would catch a mis-scoped cargo here.
--
-- Net effect of the applied SQL: any cargo that is neither 'Gerente' nor
-- 'Administrador' — e.g. a future/non-selling Caixa, Estoque, or
-- Operacional role — would auto-join Lista da Vez, contradicting the
-- intended rule that only Vendedor (the actual selling role) auto-joins.
--
-- Fix: change the gate from an exclusion check to an inclusion check.
-- Since no authoritative role field/helper exists to derive this from,
-- 'Vendedor' is used directly — the narrowest rule expressible against the
-- actual current role model (docs/portal-benvisi-blueprint.md sections 2.3,
-- 6, 8.5.5), and the same literal this project's own product documentation
-- already names as the one auto-joining role.
--
-- registrar_turno_presenca's turno_presenca insert (operational readiness)
-- remains completely unconditional for every cargo — unchanged, exactly as
-- in 20260823_002. entrar_lista_da_vez is untouched by this correction:
-- its `cargo = 'Administrador'` rejection is a broad-allow/narrow-deny
-- check (manual join stays available to anyone except Administrador,
-- Gerente explicitly included) — the opposite shape from the auto-join
-- case, and was already correct.
--
-- Same signature (text) as the applied version — plain CREATE OR REPLACE,
-- no DROP needed, no PostgREST schema reload required.
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

  -- Correction: inclusion check, not exclusion — only Vendedor auto-joins.
  -- Gerente participates manually only (entrar_lista_da_vez); Administrador
  -- does not participate at all; any other/future cargo does not auto-join
  -- either, preserving its pre-existing (non-participating-by-default)
  -- semantics rather than newly becoming eligible by omission.
  if v_ctx.cargo = 'Vendedor' then
    insert into public.lista_vez_fila (id_funcionario, dia_manaus)
    values (v_ctx.id_funcionario, v_dia)
    on conflict (id_funcionario, dia_manaus) do nothing;
  end if;

  return true;
end;
$$;

revoke all on function public.registrar_turno_presenca(text) from public;
grant execute on function public.registrar_turno_presenca(text) to anon;

commit;
