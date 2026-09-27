begin;

-- =============================================================================
-- Card #36 — Atendimento: resumo dos atendimentos de hoje.
--
-- One read-only RPC, get_atendimento_resumo_hoje, returns a flat, repeated-
-- header row set: one row per (vendedor ativo, atendimento concluído hoje,
-- resultado de cliente) — same idiom as get_contagem_detalhe_linha /
-- get_escala_periodo (header columns repeated on every detail row). The
-- frontend derives BOTH the "Por vendedor" and "Por atendimento" views from
-- this single payload; no second RPC, no ranking, no historical dates.
--
-- Vendedor eligibility mirrors the existing Lista da Vez auto-join rule
-- (20260824_001_restrict_lista_vez_auto_join_to_vendedor.sql): cargo =
-- 'Vendedor' and is_active = true, evaluated at query time (today's current
-- roster) — the same self-consistent scope used for both the store-wide
-- headline and the per-vendedor breakdown, so the two never disagree. A
-- vendedor with zero concluded atendimentos today still gets exactly one
-- row (every atendimento/outcome column null) via the left joins below.
--
-- "Hoje" is the Manaus calendar day of concluido_em, matching the project's
-- established (now() at time zone 'America/Manaus')::date idiom used
-- throughout every other Atendimento/Lista da Vez RPC — there is no shared
-- helper function for this, only the repeated inline expression.
--
-- Store-wide, no role restriction (product decision): any valid session may
-- call this — the only requirement is get_valid_employee_session_context
-- succeeding, same as get_lista_vez_estado.
--
-- One atendimento may legitimately carry more than one atendimento_clientes
-- outcome row (multiple customers served in one Atendimento session,
-- confirmed in concluir_atendimento's p_clientes array loop) — this RPC
-- repeats the atendimento's own id/iniciado_em/concluido_em on each of its
-- outcome rows rather than collapsing them, so the frontend can group by
-- id_atendimento and still see every outcome.
-- =============================================================================

create or replace function public.get_atendimento_resumo_hoje(
  p_session_token text
)
returns table (
  funcionario_id uuid,
  funcionario_nome text,
  id_atendimento uuid,
  iniciado_em timestamptz,
  concluido_em timestamptz,
  id_atendimento_cliente uuid,
  categoria text,
  motivo_rotulo text,
  detalhe text
)
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

  v_dia := (now() at time zone 'America/Manaus')::date;

  return query
    select
      f.id,
      f.nome::text,
      a.id,
      a.iniciado_em,
      a.concluido_em,
      ac.id,
      ac.categoria::text,
      ac.motivo_rotulo::text,
      ac.detalhe::text
    from public.funcionarios f
    left join public.atendimentos a
      on a.id_funcionario = f.id
      and a.status = 'concluido'
      and (a.concluido_em at time zone 'America/Manaus')::date = v_dia
    left join public.atendimento_clientes ac
      on ac.id_atendimento = a.id
    where f.is_active = true
      and f.cargo = 'Vendedor'
    order by f.apelido, a.iniciado_em desc, ac.criado_em asc;
end;
$$;

revoke all on function public.get_atendimento_resumo_hoje(text) from public;
grant execute on function public.get_atendimento_resumo_hoje(text) to anon;

commit;
