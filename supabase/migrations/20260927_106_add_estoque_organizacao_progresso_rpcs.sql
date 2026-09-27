begin;

-- =============================================================================
-- Estoque — Organização Semanal — team visibility, employee progress, and the
-- Gerente/Administrador week-selector read, completing V1 on top of the
-- Slice 1 foundation (generation) and its past-week/activation guards.
--
-- VISIBILITY, BY CONSTRUCTION RATHER THAN A ROLE CHECK: get_estoque_organi-
-- zacao_semana takes NO date/week parameter — it always returns the current
-- week, computed server-side from the database's own clock (Manaus), never
-- from client input. This is the one deliberate departure from this
-- codebase's usual convention of the client passing an explicit date/period
-- (get_limpeza_dia, get_escala_periodo, ...): here, allowing the client to
-- request an arbitrary week would let any employee read past assignment
-- history, which is reserved for Gerente/Administrador. Making that
-- impossible by never accepting the parameter is simpler and safer than a
-- conditional role check inside a shared RPC. Past/previous weeks are
-- exposed only through the separate get_estoque_organizacao_gerencial_semana
-- RPC below, which does take an explicit week and is role-gated.
--
-- OWNERSHIP: estoque_organizacao_atualizar_progresso only ever allows the
-- assigned employee to update their own row (v_row.funcionario_id must equal
-- the caller) — per the agreed V1 boundaries, there is no manager-completes-
-- on-behalf in this feature (unlike Limpeza's limpeza_concluir_atribuicao).
--
-- HISTORICAL IMMUTABILITY: the same estoque_organizacao_semana_inicio
-- comparison used by the generation guards (20260927_104/105) is applied
-- here too — a progress update is rejected once the assignment's week is no
-- longer the current week, so a week's final state is frozen the moment it
-- ends, for both generation and progress alike.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- estoque_organizacao_linhas_semana — shared row shape for one week, used by
-- both public read RPCs below so the join/shape is defined exactly once.
-- Internal only.
-- ---------------------------------------------------------------------------
create or replace function public.estoque_organizacao_linhas_semana(p_semana_inicio date)
returns table (
  id uuid,
  funcionario_id uuid,
  funcionario_nome text,
  funcionario_apelido text,
  numero_estante smallint,
  prateleiras_concluidas smallint,
  concluido_por_apelido text,
  concluido_em timestamptz,
  atualizado_em timestamptz,
  semana_inicio date
)
language sql
set search_path = public
stable
as $$
  select
    a.id, f.id, f.nome::text, f.apelido::text,
    a.numero_estante, a.prateleiras_concluidas,
    fc.apelido::text, a.concluido_em, a.atualizado_em, a.semana_inicio
  from public.estoque_organizacao_atribuicoes a
  join public.funcionarios f on f.id = a.funcionario_id
  left join public.funcionarios fc on fc.id = a.concluido_por
  where a.semana_inicio = p_semana_inicio
  order by a.numero_estante;
$$;

revoke all on function public.estoque_organizacao_linhas_semana(date) from public;

-- ---------------------------------------------------------------------------
-- get_estoque_organizacao_semana — the current week's team table. Everyone
-- sees it (team transparency, same as Limpeza/Escala). Always the current
-- week — see header comment for why this RPC intentionally takes no week
-- parameter.
-- ---------------------------------------------------------------------------
create or replace function public.get_estoque_organizacao_semana(p_session_token text)
returns table (
  id uuid,
  funcionario_id uuid,
  funcionario_nome text,
  funcionario_apelido text,
  numero_estante smallint,
  prateleiras_concluidas smallint,
  concluido_por_apelido text,
  concluido_em timestamptz,
  atualizado_em timestamptz,
  semana_inicio date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_semana date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_semana := public.estoque_organizacao_semana_inicio((now() at time zone 'America/Manaus')::date);

  return query
  select * from public.estoque_organizacao_linhas_semana(v_semana);
end;
$$;

revoke all on function public.get_estoque_organizacao_semana(text) from public;
grant execute on function public.get_estoque_organizacao_semana(text) to anon;

-- ---------------------------------------------------------------------------
-- get_estoque_organizacao_gerencial_semana — Gerente/Administrador only: any
-- week (current or previous), for the Gerenciar tab's week selector. Counts
-- (assigned/completed/pending, or completed/not-completed for a closed
-- week) are derived client-side from this same row set — no separate
-- aggregation RPC, per the agreed "no analytics in this slice" boundary.
-- ---------------------------------------------------------------------------
create or replace function public.get_estoque_organizacao_gerencial_semana(
  p_session_token text,
  p_semana_inicio date
)
returns table (
  id uuid,
  funcionario_id uuid,
  funcionario_nome text,
  funcionario_apelido text,
  numero_estante smallint,
  prateleiras_concluidas smallint,
  concluido_por_apelido text,
  concluido_em timestamptz,
  atualizado_em timestamptz,
  semana_inicio date
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
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_ESTOQUE_ORGANIZACAO';
  end if;
  if extract(dow from p_semana_inicio) <> 0 then
    raise exception using errcode = 'P0001', message = 'SEMANA_INICIO_DEVE_SER_DOMINGO';
  end if;

  return query
  select * from public.estoque_organizacao_linhas_semana(p_semana_inicio);
end;
$$;

revoke all on function public.get_estoque_organizacao_gerencial_semana(text, date) from public;
grant execute on function public.get_estoque_organizacao_gerencial_semana(text, date) to anon;

-- ---------------------------------------------------------------------------
-- estoque_organizacao_atualizar_progresso — autosave. Sets an absolute
-- prateleiras_concluidas count (0-5), not an increment, so a slow/duplicate
-- request is naturally idempotent. concluido_por/concluido_em are set the
-- first time the count reaches 5 (coalesce — a repeated save at 5 does not
-- keep bumping concluido_em), and cleared whenever the count drops back
-- below 5, so "5/5 = Concluído" and its attribution are always in sync with
-- the count, including when a completed estante is reopened.
--
-- Every `where ... id = ...` below is qualified with the table name
-- (public.estoque_organizacao_atribuicoes.id), never a bare `id` — this
-- function's own `returns table (id uuid, ...)` implicitly declares a
-- plpgsql OUT-parameter variable named `id` in scope for the whole body, so
-- an unqualified `id` is ambiguous between that variable and the table
-- column. This exact hazard already caused a runtime-only bug in
-- limpeza_concluir_atribuicao (20260925_105_fix_limpeza_concluir_ambiguous_id.sql,
-- only caught in database-backed QA, not static review) — avoided here from
-- the start rather than repeated.
-- ---------------------------------------------------------------------------
create or replace function public.estoque_organizacao_atualizar_progresso(
  p_session_token text,
  p_atribuicao_id uuid,
  p_prateleiras_concluidas smallint
)
returns table (
  id uuid,
  prateleiras_concluidas smallint,
  concluido_por_apelido text,
  concluido_em timestamptz,
  atualizado_em timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_row record;
  v_semana_atual date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if p_prateleiras_concluidas is null
     or p_prateleiras_concluidas < 0
     or p_prateleiras_concluidas > 5 then
    raise exception using errcode = 'P0001', message = 'PROGRESSO_INVALIDO';
  end if;

  select * into v_row
  from public.estoque_organizacao_atribuicoes
  where public.estoque_organizacao_atribuicoes.id = p_atribuicao_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_NAO_ENCONTRADA';
  end if;

  -- No manager-completes-on-behalf in V1: only the assigned employee may
  -- update their own progress.
  if v_row.funcionario_id <> v_ctx.id_funcionario then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_ESTOQUE_ORGANIZACAO';
  end if;

  v_semana_atual := public.estoque_organizacao_semana_inicio((now() at time zone 'America/Manaus')::date);
  if v_row.semana_inicio <> v_semana_atual then
    raise exception using errcode = 'P0001', message = 'SEMANA_ENCERRADA';
  end if;

  -- Reads the pre-update value from v_row (already locked and fetched
  -- above), not a bare `concluido_por`/`concluido_em` column reference:
  -- concluido_em is also one of this function's RETURNS TABLE column names,
  -- so an unqualified reference to it here would hit the exact same
  -- OUT-parameter-shadowing ambiguity as the `id` hazard noted above.
  -- v_row.x is a plpgsql record field access, never ambiguous with a table
  -- column, and is guaranteed current since no other statement can have
  -- touched this row between the earlier `for update` lock and here.
  update public.estoque_organizacao_atribuicoes
  set prateleiras_concluidas = p_prateleiras_concluidas,
      concluido_por = case
        when p_prateleiras_concluidas = 5 then coalesce(v_row.concluido_por, v_ctx.id_funcionario)
        else null
      end,
      concluido_em = case
        when p_prateleiras_concluidas = 5 then coalesce(v_row.concluido_em, now())
        else null
      end,
      atualizado_por = v_ctx.id_funcionario,
      atualizado_em = now()
  where public.estoque_organizacao_atribuicoes.id = p_atribuicao_id;

  return query
  select a.id, a.prateleiras_concluidas, fc.apelido::text, a.concluido_em, a.atualizado_em
  from public.estoque_organizacao_atribuicoes a
  left join public.funcionarios fc on fc.id = a.concluido_por
  where a.id = p_atribuicao_id;
end;
$$;

revoke all on function public.estoque_organizacao_atualizar_progresso(text, uuid, smallint) from public;
grant execute on function public.estoque_organizacao_atualizar_progresso(text, uuid, smallint) to anon;

-- ---------------------------------------------------------------------------
-- estoque_organizacao_concluir_estante — one-click "Concluir estante". Pure
-- convenience wrapper (sets the count to 5) so completion/reopening logic
-- exists in exactly one place.
-- ---------------------------------------------------------------------------
create or replace function public.estoque_organizacao_concluir_estante(
  p_session_token text,
  p_atribuicao_id uuid
)
returns table (
  id uuid,
  prateleiras_concluidas smallint,
  concluido_por_apelido text,
  concluido_em timestamptz,
  atualizado_em timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select * from public.estoque_organizacao_atualizar_progresso(p_session_token, p_atribuicao_id, 5::smallint);
end;
$$;

revoke all on function public.estoque_organizacao_concluir_estante(text, uuid) from public;
grant execute on function public.estoque_organizacao_concluir_estante(text, uuid) to anon;

commit;
