begin;

-- =============================================================================
-- Escala V1 foundation (Milestone 4C.1) — read RPCs
--
-- Depends on 20260825_001 (funcionarios metadata) and 20260825_003 (Escala
-- schema + escala_classificar_turno + loja_horario_do_dia).
--
-- Three anon-facing SECURITY DEFINER read RPCs, matching this project's
-- established RPC pattern exactly (session resolved server-side via
-- get_valid_employee_session_context, cargo/visibility never trusted from
-- the client). No write/publish RPC is introduced here — publishing
-- remains a future sub-milestone (see 20260825_003's header note).
--
-- Gestão visibility is enforced here, not in the frontend: a regular
-- employee calling get_escala_periodo simply never receives Gestão rows in
-- the payload — there is no flag for the client to "hide", because the
-- rows themselves are never returned.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- get_escala_periodo: team schedule for a date range (max 31 days), powering
-- both the future "Hoje" view (p_data_inicio = p_data_fim) and "Semana"
-- view (7-day range) with one RPC rather than two near-duplicates.
--
-- A missing (employee, date) row is never treated as folga — it produces
-- secao = 'a_confirmar', matching the "blank must never silently mean
-- FOLGA" rule. This is true whether the whole month is unpublished or only
-- a specific employee/date is missing from an otherwise-published month —
-- same code path either way, by construction.
-- -----------------------------------------------------------------------------
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

  -- Server-owned visibility rule (Blueprint section 16.2): Administrador
  -- can view the Gestão block without personally being a Gestão member;
  -- a Gestão member can view it because they are one. Nobody else can.
  v_pode_ver_gestao := (v_ctx.cargo = 'Administrador' or coalesce(v_caller_gestao, false));

  return query
  select
    d.dia::date,
    f.id,
    f.nome,
    f.apelido,
    case
      when e.status = 'folga' then 'folga'
      when e.status = 'ferias' then 'ferias'
      when e.status = 'trabalho' and f.escala_grupo_gestao then 'gestao'
      when e.status = 'trabalho'
        then public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento)
      else 'a_confirmar'
    end as secao,
    e.hora_inicio,
    e.hora_fim,
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
  -- Administrador never personally participates in the schedule (mirrors
  -- the existing Lista da Vez/Atendimento precedent — 20260823_002) — it
  -- is excluded from the roster entirely, not merely hidden.
  where f.is_active = true
    and f.cargo <> 'Administrador'
    and (v_pode_ver_gestao or f.escala_grupo_gestao = false)
  order by d.dia, f.nome;
end;
$$;

revoke all on function public.get_escala_periodo(text, date, date) from public;
grant execute on function public.get_escala_periodo(text, date, date) to anon;

-- -----------------------------------------------------------------------------
-- get_minha_escala_mes: the caller's own schedule for one calendar month
-- (any date within the target month may be passed; normalized internally
-- to the first of that month). No Gestão-visibility check is needed here —
-- every employee may always see their own schedule regardless of Gestão
-- membership.
-- -----------------------------------------------------------------------------
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
      when e.status = 'trabalho' and coalesce(v_gestao, false) then 'gestao'
      when e.status = 'trabalho'
        then public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento)
      else 'a_confirmar'
    end as secao,
    e.hora_inicio,
    e.hora_fim,
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

-- -----------------------------------------------------------------------------
-- list_escala_meses_publicados: which months currently have an active
-- publication, and when it was published. Lets the future UI decide which
-- months are navigable ("previous/current always; a future month only if
-- explicitly published") without duplicating that check ad hoc in the
-- frontend for every navigation control.
-- -----------------------------------------------------------------------------
create or replace function public.list_escala_meses_publicados(p_session_token text)
returns table (
  mes_referencia date,
  publicado_em timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  return query
  select ep.mes_referencia, ep.publicado_em
  from public.escala_publicacoes ep
  where ep.ativa = true
  order by ep.mes_referencia;
end;
$$;

revoke all on function public.list_escala_meses_publicados(text) from public;
grant execute on function public.list_escala_meses_publicados(text) to anon;

commit;
