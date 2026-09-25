begin;

-- =============================================================================
-- Limpeza UX fixes from manual QA on PR #14 (2026-09-25):
--
-- 1. get_limpeza_mes: replaces the "pendentes" column (misleadingly implied
--    every not-yet-completed assignment, including future ones, was overdue)
--    with "nao_concluidos" — strictly: data < today (Manaus) AND status <>
--    'concluida'. Future assignments and today's still-open assignments
--    never count. This is a RETURNS TABLE signature change (drop + recreate
--    is required because Postgres cannot change a table function's output
--    column list with a bare CREATE OR REPLACE).
--
-- 2. get_limpeza_atribuicoes_mes (new): Gerente/Administrador only — every
--    assignment for the month (not just exceptions), so the Gerenciar tab
--    can offer "Alterar" on any assignment, not only the ones already
--    flagged as an exception. Uses the exact same manual-override backend
--    (limpeza_definir_atribuicao_manual) already shipped and tested —
--    no new write path.
--
-- No change to eligibility, fairness, or synchronization logic.
-- =============================================================================

drop function public.get_limpeza_mes(text, date);

create function public.get_limpeza_mes(p_session_token text, p_mes date)
returns table (
  funcionario_id uuid,
  funcionario_nome text,
  funcionario_apelido text,
  varrer_atribuidos bigint,
  passar_pano_atribuidos bigint,
  total bigint,
  concluidos bigint,
  nao_concluidos bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_mes_ref date;
  v_mes_fim date;
  v_hoje date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_mes_ref := date_trunc('month', p_mes)::date;
  v_mes_fim := (v_mes_ref + interval '1 month' - interval '1 day')::date;
  v_hoje := (now() at time zone 'America/Manaus')::date;

  return query
  select
    f.id, f.nome::text, f.apelido::text,
    count(*) filter (where a.tarefa = 'varrer') as varrer_atribuidos,
    count(*) filter (where a.tarefa = 'passar_pano') as passar_pano_atribuidos,
    count(*) as total,
    count(*) filter (where a.status = 'concluida') as concluidos,
    count(*) filter (where a.data < v_hoje and a.status <> 'concluida') as nao_concluidos
  from public.funcionarios f
  join public.limpeza_atribuicoes a
    on a.funcionario_id = f.id and a.data between v_mes_ref and v_mes_fim
  where f.is_active = true
    and f.escala_grupo_gestao = false
    and not exists (select 1 from public.limpeza_cargos_excluidos x where x.cargo = f.cargo)
  group by f.id, f.nome, f.apelido
  order by f.apelido;
end;
$$;

revoke all on function public.get_limpeza_mes(text, date) from public;
grant execute on function public.get_limpeza_mes(text, date) to anon;

-- ---------------------------------------------------------------------------
-- get_limpeza_atribuicoes_mes — Gerente/Administrador only: every assignment
-- for the month, for the Gerenciar tab's "Atribuições do mês" management
-- list (distinct from get_limpeza_gerencial_mes's exceptions-only list).
-- ---------------------------------------------------------------------------
create or replace function public.get_limpeza_atribuicoes_mes(p_session_token text, p_mes date)
returns table (
  id uuid,
  data date,
  turno text,
  tarefa text,
  funcionario_id uuid,
  funcionario_apelido text,
  origem text,
  bloqueada boolean,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_mes_ref date;
  v_mes_fim date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_LIMPEZA';
  end if;

  v_mes_ref := date_trunc('month', p_mes)::date;
  v_mes_fim := (v_mes_ref + interval '1 month' - interval '1 day')::date;

  return query
  select
    a.id, a.data, a.turno, a.tarefa,
    a.funcionario_id, f.apelido::text,
    a.origem, a.bloqueada, a.status
  from public.limpeza_atribuicoes a
  left join public.funcionarios f on f.id = a.funcionario_id
  where a.data between v_mes_ref and v_mes_fim
  order by a.data, case a.turno when 'manha' then 0 else 1 end, a.tarefa;
end;
$$;

revoke all on function public.get_limpeza_atribuicoes_mes(text, date) from public;
grant execute on function public.get_limpeza_atribuicoes_mes(text, date) to anon;

commit;
