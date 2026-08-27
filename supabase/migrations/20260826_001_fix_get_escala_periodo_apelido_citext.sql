begin;

-- =============================================================================
-- Escala V1 — corrective: get_escala_periodo return-type mismatch (citext)
--
-- STATUS: NOT YET APPLIED — created for review. Apply after product-owner
-- approval (project rule: a new schema migration is created, then confirmed
-- before applying). Migrations 20260825_001–005 are immutable history and are
-- NOT edited by this file.
--
-- Finding (diagnosed live via Supabase MCP against the development database):
-- get_escala_periodo (migration 20260825_004) declares its result column as
--   ... nome text, apelido text, ...
-- but public.funcionarios.apelido is of type `citext`, not `text`
-- (funcionarios predates migration tracking — the same untracked-legacy
-- situation already documented for the `cargo` and `email` columns in
-- 20260824_001 / 20260825_001 / 20260825_005). PL/pgSQL RETURN QUERY enforces
-- exact type equality between the query and the declared TABLE(...) shape and
-- raises:
--   ERROR: 42804: structure of query does not match function result type
--   DETAIL: Returned type citext does not match expected type text in column 4.
--
-- Effect: get_escala_periodo throws on EVERY call, regardless of whether a
-- publication exists. The Escala "Hoje" and "Semana" views (which both call
-- this RPC) therefore always surfaced ESCALA_ERRO_MESSAGE. "Mês"
-- (get_minha_escala_mes) and month-navigation (list_escala_meses_publicados)
-- were unaffected because neither selects nome/apelido.
--
-- Fix: re-create get_escala_periodo with the SELECT list explicitly casting
-- f.apelido (and, defensively, f.nome) to text so the returned row structure
-- matches the declared result type. This is the ONLY change from the
-- 20260825_004 definition — the session/visibility/section logic, grants and
-- revokes are all identical. get_minha_escala_mes and
-- list_escala_meses_publicados are correct as-is and are not touched.
-- =============================================================================

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
    f.nome::text,
    f.apelido::text,
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

commit;
