begin;

-- =============================================================================
-- Escala V1 — drop the dedicated GESTÃO section; bucket gerência employees
-- into the normal shift sections
--
-- Product decision (browser QA, Milestone 4C.2): the standalone "GESTÃO"
-- section is removed. An employee with escala_grupo_gestao = true is now
-- classified into the same buckets as everyone else — manha / intermediario /
-- tarde / folga / ferias / a_confirmar — via escala_classificar_turno, using
-- their stored hours.
--
-- Two things are deliberately preserved:
--   1. VISIBILITY is unchanged. A caller who is neither Administrador nor a
--      Gestão member still never receives any row for a gerência employee —
--      same WHERE clause as before (20260825_004 / 20260826_001).
--   2. The gerência employee's individual hours are still NOT surfaced. The
--      manager sets their own hours flexibly, so hora_inicio / hora_fim are
--      returned as NULL for their trabalho rows (in both RPCs). The real
--      stored hours are still used to *classify* the row into a section; only
--      the displayed times are withheld. The frontend already renders a
--      shift row with null times as name-only.
--
-- Only change vs 20260826_001: the section CASE no longer has a 'gestao'
-- branch, and the two hora_* output columns are wrapped so gerência trabalho
-- rows come back with null times. Session/visibility logic, grants, and the
-- f.apelido::text / f.nome::text casts from 20260826_001 are untouched.
-- Migrations 20260825_001–005 and 20260826_001 remain immutable history.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- get_escala_periodo — team schedule for a date range (Hoje / Semana)
-- ---------------------------------------------------------------------------
create or replace function public.get_escala_periodo(
  p_session_token text,
  p_data_inicio date,
  p_data_fim date
)
returns table (
  data date,
  id_funcionario uuid,
  nome text,
  apelido text,
  secao text,
  hora_inicio time,
  hora_fim time,
  feriado_nome text,
  feriado_abrangencia text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_caller_gestao boolean;
  v_pode_ver_gestao boolean;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if p_data_fim < p_data_inicio or p_data_fim - p_data_inicio > 31 then
    raise exception using errcode = 'P0001', message = 'INTERVALO_INVALIDO';
  end if;

  select f.escala_grupo_gestao into v_caller_gestao
  from public.funcionarios f
  where f.id = v_ctx.id_funcionario;

  -- Server-owned visibility rule (Blueprint section 16.2): Administrador can
  -- view gerência rows without personally being a Gestão member; a Gestão
  -- member can view them because they are one. Nobody else can. Unchanged.
  v_pode_ver_gestao := (v_ctx.cargo = 'Administrador' or coalesce(v_caller_gestao, false));

  return query
  select
    d.dia::date,
    f.id,
    f.nome::text,
    f.apelido::text,
    case
      when e.status = 'folga' then 'folga'
      when e.status = 'ferias' then 'ferias'
      when e.status = 'trabalho'
        then public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento)
      else 'a_confirmar'
    end as secao,
    -- Gerência hours are withheld (manager defines them flexibly); the real
    -- stored times are still used above to classify the section.
    case when e.status = 'trabalho' and f.escala_grupo_gestao then null else e.hora_inicio end as hora_inicio,
    case when e.status = 'trabalho' and f.escala_grupo_gestao then null else e.hora_fim end as hora_fim,
    fer.nome as feriado_nome,
    fer.abrangencia as feriado_abrangencia
  from generate_series(p_data_inicio, p_data_fim, interval '1 day') as d(dia)
  cross join public.funcionarios f
  cross join lateral public.loja_horario_do_dia(d.dia::date) h
  left join public.feriados fer on fer.data = d.dia::date
  left join public.escala_publicacoes ep
    on ep.mes_referencia = date_trunc('month', d.dia)::date and ep.ativa = true
  left join public.escala_entradas e
    on e.id_publicacao = ep.id and e.id_funcionario = f.id and e.data = d.dia::date
  where f.is_active = true
    and f.cargo <> 'Administrador'
    and (v_pode_ver_gestao or f.escala_grupo_gestao = false)
  order by d.dia, f.nome;
end;
$$;

revoke all on function public.get_escala_periodo(text, date, date) from public;
grant execute on function public.get_escala_periodo(text, date, date) to anon;

-- ---------------------------------------------------------------------------
-- get_minha_escala_mes — the caller's own schedule for one month (Mês)
-- ---------------------------------------------------------------------------
create or replace function public.get_minha_escala_mes(
  p_session_token text,
  p_mes date
)
returns table (
  data date,
  secao text,
  hora_inicio time,
  hora_fim time,
  feriado_nome text,
  feriado_abrangencia text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_mes_ref date;
  v_gestao boolean;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_mes_ref := date_trunc('month', p_mes)::date;

  select f.escala_grupo_gestao into v_gestao
  from public.funcionarios f
  where f.id = v_ctx.id_funcionario;

  return query
  select
    d.dia::date,
    case
      when e.status = 'folga' then 'folga'
      when e.status = 'ferias' then 'ferias'
      when e.status = 'trabalho'
        then public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento)
      else 'a_confirmar'
    end as secao,
    -- A gerência caller's own hours are withheld here too, for consistency
    -- with the team view; the section label still reflects the real shift.
    case when e.status = 'trabalho' and coalesce(v_gestao, false) then null else e.hora_inicio end,
    case when e.status = 'trabalho' and coalesce(v_gestao, false) then null else e.hora_fim end,
    fer.nome as feriado_nome,
    fer.abrangencia as feriado_abrangencia
  from generate_series(
    v_mes_ref,
    (v_mes_ref + interval '1 month' - interval '1 day')::date,
    interval '1 day'
  ) as d(dia)
  cross join lateral public.loja_horario_do_dia(d.dia::date) h
  left join public.feriados fer on fer.data = d.dia::date
  left join public.escala_publicacoes ep
    on ep.mes_referencia = v_mes_ref and ep.ativa = true
  left join public.escala_entradas e
    on e.id_publicacao = ep.id and e.id_funcionario = v_ctx.id_funcionario and e.data = d.dia::date
  order by d.dia;
end;
$$;

revoke all on function public.get_minha_escala_mes(text, date) from public;
grant execute on function public.get_minha_escala_mes(text, date) to anon;

commit;
