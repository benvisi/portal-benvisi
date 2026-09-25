begin;

-- =============================================================================
-- Limpeza sync failure visibility (product decision 2026-09-25)
--
-- The existing architecture decision stands: a Limpeza synchronization
-- failure must never fail or roll back a successful Escala publication
-- (20260925_103's exception guard around limpeza_sincronizar_datas_afetadas
-- is unchanged). What was missing is that a swallowed failure was also
-- invisible — nobody could tell the fallback "Sincronizar" button was
-- actually needed. This migration adds a small persistent log, a
-- Gerente/Administrador-only read RPC over it, and routes every sync
-- entry point (publish hook AND the manual fallback) through one wrapper
-- that records failures and clears them again on a later success.
--
-- Also fixes the "prefer not assigned yesterday" ranking in
-- limpeza_proximo_candidato to use an explicitly-named, self-evidently
-- correctly-ordered expression instead of relying on implicit
-- boolean-ascending-sorts-false-first knowledge (the old expression was
-- correct, but not obviously so at a glance).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- limpeza_sync_falhas — one row per failed sync attempt for one date. A date
-- with its latest row's resolvido_em still null is "unresolved" (needs
-- attention); resolvido_em is set the next time that date syncs
-- successfully, by whichever path (Escala publish hook or manual
-- Sincronizar). Not a generalized monitoring/audit framework — just enough
-- to answer "which dates, when, why, and is it still a problem."
-- ---------------------------------------------------------------------------
create table public.limpeza_sync_falhas (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  falhou_em timestamptz not null default now(),
  motivo text,
  resolvido_em timestamptz
);

create index limpeza_sync_falhas_data_idx on public.limpeza_sync_falhas (data);
create index limpeza_sync_falhas_nao_resolvida_idx
  on public.limpeza_sync_falhas (data)
  where resolvido_em is null;

alter table public.limpeza_sync_falhas enable row level security;

-- ---------------------------------------------------------------------------
-- limpeza_sincronizar_dia_com_registro — the ONE place that calls
-- limpeza_sincronizar_dia from now on. On success, resolves any previously
-- unresolved failures for that date. On failure, records one (never
-- raises — this function itself is the failure boundary, so callers no
-- longer need their own try/catch around a sync attempt).
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_sincronizar_dia_com_registro(p_data date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.limpeza_sincronizar_dia(p_data);

    update public.limpeza_sync_falhas
    set resolvido_em = now()
    where data = p_data and resolvido_em is null;
  exception when others then
    insert into public.limpeza_sync_falhas (data, motivo)
    values (p_data, sqlerrm);
  end;
end;
$$;

revoke all on function public.limpeza_sincronizar_dia_com_registro(date) from public;

-- ---------------------------------------------------------------------------
-- limpeza_sincronizar_periodo — unchanged behavior, now routes through the
-- registering wrapper so the manual "Sincronizar" fallback (and anything
-- else using this function) also records/clears failures.
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_sincronizar_periodo(p_data_inicio date, p_data_fim date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Manaus')::date;
  v_dia date;
begin
  v_dia := greatest(p_data_inicio, v_hoje);
  while v_dia <= p_data_fim loop
    perform public.limpeza_sincronizar_dia_com_registro(v_dia);
    v_dia := v_dia + 1;
  end loop;
end;
$$;

revoke all on function public.limpeza_sincronizar_periodo(date, date) from public;

-- ---------------------------------------------------------------------------
-- limpeza_sincronizar_datas_afetadas — same per-date filtering as before;
-- each date's sync attempt is now made via the registering wrapper, which is
-- itself the failure boundary, so the outer per-iteration begin/exception is
-- no longer needed here (kept impossible to reintroduce a silent failure by
-- construction: the wrapper never raises).
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_sincronizar_datas_afetadas(p_datas date[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Manaus')::date;
  v_data date;
begin
  foreach v_data in array coalesce(p_datas, array[]::date[]) loop
    if v_data >= v_hoje then
      perform public.limpeza_sincronizar_dia_com_registro(v_data);
    end if;
  end loop;
end;
$$;

revoke all on function public.limpeza_sincronizar_datas_afetadas(date[]) from public;

-- ---------------------------------------------------------------------------
-- get_limpeza_sync_pendencias — Gerente/Administrador only: every date whose
-- most recent sync attempt is still unresolved. Ordinary employees never see
-- this (no technical error details belong in their view).
-- ---------------------------------------------------------------------------
create or replace function public.get_limpeza_sync_pendencias(p_session_token text)
returns table (
  data date,
  falhou_em timestamptz,
  motivo text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_LIMPEZA';
  end if;

  return query
  select f.data, f.falhou_em, f.motivo
  from public.limpeza_sync_falhas f
  where f.resolvido_em is null
  order by f.data;
end;
$$;

revoke all on function public.get_limpeza_sync_pendencias(text) from public;
grant execute on function public.get_limpeza_sync_pendencias(text) to anon;

-- ---------------------------------------------------------------------------
-- limpeza_proximo_candidato — same ranking, rewritten so "prefer not
-- assigned yesterday" is unambiguous at a glance instead of relying on
-- ascending-boolean-sorts-false-first. nao_atribuido_ontem is true when the
-- candidate is FREE of a limpeza assignment on data - 1; ordering it `desc`
-- puts true (the preferred, unencumbered candidates) first — the exact
-- opposite construction from before (was: atribuido_ontem asc), same
-- result, no longer subtle.
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_proximo_candidato(
  p_data date,
  p_turno text,
  p_tarefa text,
  p_reservados uuid[] default array[]::uuid[]
)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  with elegiveis as (
    select f.id, f.apelido
    from public.funcionarios f
    join public.escala_publicacoes ep
      on ep.mes_referencia = date_trunc('month', p_data)::date and ep.ativa = true
    join public.escala_entradas e
      on e.id_publicacao = ep.id and e.id_funcionario = f.id and e.data = p_data
    cross join lateral public.loja_horario_do_dia(p_data) h
    where f.is_active = true
      and e.status = 'trabalho'
      and f.escala_grupo_gestao = false
      and not exists (select 1 from public.limpeza_cargos_excluidos x where x.cargo = f.cargo)
      and public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento)
        in (p_turno, 'intermediario')
      and not (f.id = any(coalesce(p_reservados, array[]::uuid[])))
  ),
  contagens as (
    select
      el.id,
      el.apelido,
      (
        select count(*) from public.limpeza_atribuicoes a
        where a.funcionario_id = el.id
          and a.data >= date_trunc('month', p_data)::date
          and a.data < (date_trunc('month', p_data) + interval '1 month')::date
      ) as total_mes,
      (
        select count(*) from public.limpeza_atribuicoes a
        where a.funcionario_id = el.id
          and a.tarefa = p_tarefa
          and a.data >= date_trunc('month', p_data)::date
          and a.data < (date_trunc('month', p_data) + interval '1 month')::date
      ) as tarefa_mes,
      -- true = candidate has NO limpeza assignment on the previous day, i.e.
      -- is free to prefer. Preferred candidates must sort FIRST.
      not exists (
        select 1 from public.limpeza_atribuicoes a
        where a.funcionario_id = el.id and a.data = p_data - 1
      ) as nao_atribuido_ontem
    from elegiveis el
  )
  select id
  from contagens
  -- nao_atribuido_ontem desc: true (preferred/free) before false (was
  -- assigned yesterday) — reads correctly without knowing Postgres's
  -- boolean sort order.
  order by nao_atribuido_ontem desc, tarefa_mes asc, total_mes asc, apelido asc, id asc
  limit 1;
$$;

revoke all on function public.limpeza_proximo_candidato(date, text, text, uuid[]) from public;

commit;
