begin;

-- =============================================================================
-- Consulta de Estoque — Sync V2 — internal sync RPCs
--
-- Depends on 20260911_001. Four SECURITY DEFINER functions, none anon-granted
-- (sync-internal surface, matching estoque_sync_atual()'s pattern in V1 — not
-- anon-granted either, called only from within other SECURITY DEFINER
-- functions or, for the three below, by service_role over PostgREST from the
-- Node sync script). No V2 write capability is browser-accessible.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- estoque_freshness_atual — internal helper, the V2 analogue of
-- estoque_sync_atual() (which returns sync_id + concluido_em because V1 reads
-- were sync_id-scoped). estoque_atual has no sync_id dimension, so this
-- returns only concluido_em of the latest successful run. Not anon-granted;
-- called from inside the read RPCs added by a later migration once Phase B
-- cutover happens.
-- -----------------------------------------------------------------------------
create or replace function public.estoque_freshness_atual()
returns table (concluido_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select e.concluido_em
  from public.estoque_sync_execucoes e
  where e.status = 'sucesso' and e.concluido_em is not null
  order by e.concluido_em desc
  limit 1;
$$;

revoke all on function public.estoque_freshness_atual() from public;

-- -----------------------------------------------------------------------------
-- estoque_claim_sync — the concurrency gate (V2 brief sections 5-6). Must be
-- called before any Linx work for a real (non-dry-run) invocation.
--
-- Behavior:
--   * an existing 'executando' row younger than 30 minutes -> BUSY, no claim;
--   * an existing 'executando' row 30+ minutes old -> treated as abandoned:
--     marked 'erro' (error_code ABANDONED_STALE_TIMEOUT), its staging purged,
--     then this call proceeds to claim normally;
--   * otherwise -> inserts a new 'executando' row and returns it as claimed.
--
-- The FOR UPDATE lock on an existing row serializes the stale-recovery
-- branch; the final INSERT's exception handler is the actual safety net for
-- two truly concurrent claim attempts (both racing to insert with none
-- found) — Postgres's partial unique index on estoque_sync_execucoes allows
-- only one to succeed, and the loser is told BUSY rather than erroring out,
-- without discarding any stale-recovery work this call already committed to
-- its own sub-block.
-- -----------------------------------------------------------------------------
create or replace function public.estoque_claim_sync()
returns table (
  sync_id uuid,
  claimed boolean,
  motivo text,
  execucao_anterior_recuperada uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stale record;
  v_recovered uuid := null;
  v_new_id uuid;
begin
  select e.id, e.iniciado_em into v_stale
  from public.estoque_sync_execucoes e
  where e.status = 'executando'
  order by e.iniciado_em desc
  limit 1
  for update;

  if found then
    if v_stale.iniciado_em > now() - interval '30 minutes' then
      return query select null::uuid, false, 'BUSY'::text, null::uuid;
      return;
    end if;

    update public.estoque_sync_execucoes
    set status = 'erro',
        concluido_em = now(),
        error_code = 'ABANDONED_STALE_TIMEOUT',
        erro = 'No apply/failure signal received within 30 minutes of claim; assumed crashed and superseded by a newer run.'
    where id = v_stale.id;

    delete from public.estoque_staging_linhas where sync_id = v_stale.id;
    delete from public.estoque_staging_grupos where sync_id = v_stale.id;

    v_recovered := v_stale.id;
  end if;

  begin
    insert into public.estoque_sync_execucoes (status)
    values ('executando')
    returning id into v_new_id;
  exception when unique_violation then
    return query select null::uuid, false, 'BUSY'::text, v_recovered;
    return;
  end;

  return query select v_new_id, true, 'CLAIMED'::text, v_recovered;
end;
$$;

revoke all on function public.estoque_claim_sync() from public;
grant execute on function public.estoque_claim_sync() to service_role;

-- -----------------------------------------------------------------------------
-- estoque_marcar_erro — small failure/finalization RPC (V2 brief section 15)
-- for the cases estoque_aplicar_sync itself cannot self-record: a fatal local
-- validation failure before staging is even uploaded, or an unexpected error
-- that made estoque_aplicar_sync's own transaction roll back (which undoes
-- any self-marking it might have attempted). Idempotent-safe: only touches a
-- row that is still 'executando', so it cannot clobber a row some other call
-- already finalized.
-- -----------------------------------------------------------------------------
create or replace function public.estoque_marcar_erro(
  p_sync_id uuid,
  p_mensagem text,
  p_error_code text default null
)
returns table (marcado boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.estoque_sync_execucoes
  set status = 'erro',
      concluido_em = now(),
      erro = left(coalesce(p_mensagem, 'erro desconhecido'), 4000),
      error_code = p_error_code
  where id = p_sync_id
    and status = 'executando';

  get diagnostics v_rows = row_count;

  delete from public.estoque_staging_linhas where sync_id = p_sync_id;
  delete from public.estoque_staging_grupos where sync_id = p_sync_id;

  return query select (v_rows > 0);
end;
$$;

revoke all on function public.estoque_marcar_erro(uuid, text, text) from public;
grant execute on function public.estoque_marcar_erro(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- estoque_aplicar_sync — the ONE atomic apply transaction (V2 brief section
-- 13). Every detectable-in-SQL failure mode (manifest integrity, the >10%
-- removal guardrail) is handled WITHOUT raising: this function marks its own
-- execution 'erro' with a specific error_code, purges its staging, and
-- RETURNs normally with status='erro' — raising here would roll back that
-- self-marking UPDATE along with everything else, leaving the execution
-- stuck at 'executando' with no audit trail. Only a genuinely unexpected
-- error during the mutation section is allowed to RAISE and roll the whole
-- transaction back (leaving estoque_atual AND this execution row exactly as
-- they were); Node's outer catch then calls estoque_marcar_erro separately.
-- -----------------------------------------------------------------------------
create or replace function public.estoque_aplicar_sync(
  p_sync_id uuid,
  p_raw_rows integer,
  p_canonical_rows integer,
  p_produto_count integer,
  p_produto_cor_count integer,
  p_avisos jsonb default '[]'::jsonb,
  p_allow_large_removal boolean default false,
  p_override_reason text default null
)
returns table (
  status text,
  error_code text,
  mensagem text,
  grupos_novos integer,
  grupos_alterados integer,
  grupos_removidos integer,
  grupos_inalterados integer,
  linhas_escritas integer,
  remocao_percentual numeric,
  concluido_em timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exec record;
  v_current_group_count integer;
  v_new_count integer;
  v_changed_count integer;
  v_removed_count integer;
  v_unchanged_count integer;
  v_removal_pct numeric(6, 3);
  v_rows_written integer := 0;
  v_bad record;
  v_override_applied boolean := false;
begin
  select * into v_exec
  from public.estoque_sync_execucoes
  where id = p_sync_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ESTOQUE_APLICAR_SYNC_NOT_FOUND';
  end if;

  if v_exec.status <> 'executando' then
    raise exception using errcode = 'P0001',
      message = format('ESTOQUE_APLICAR_SYNC_NOT_ACTIVE status=%s', v_exec.status);
  end if;

  -- a) every novo/alterado manifest group's actual staged row count must
  --    match its declared expected count.
  for v_bad in
    select g.produto, g.cor_codigo, g.row_count_esperado, count(l.tamanho_key) as real_count
    from public.estoque_staging_grupos g
    left join public.estoque_staging_linhas l
      on l.sync_id = g.sync_id and l.produto = g.produto and l.cor_codigo = g.cor_codigo
    where g.sync_id = p_sync_id and g.acao in ('novo', 'alterado')
    group by g.produto, g.cor_codigo, g.row_count_esperado
    having count(l.tamanho_key) <> g.row_count_esperado
    limit 1
  loop
    update public.estoque_sync_execucoes set
      status = 'erro', concluido_em = now(), error_code = 'MANIFEST_ROW_COUNT_MISMATCH',
      erro = format('produto=%s cor_codigo=%s expected=%s actual=%s',
                     v_bad.produto, v_bad.cor_codigo, v_bad.row_count_esperado, v_bad.real_count),
      raw_rows = p_raw_rows, linhas_extraidas = p_canonical_rows,
      produto_count = p_produto_count, produto_cor_count = p_produto_cor_count
    where id = p_sync_id;

    delete from public.estoque_staging_linhas where sync_id = p_sync_id;
    delete from public.estoque_staging_grupos where sync_id = p_sync_id;

    return query select 'erro'::text, 'MANIFEST_ROW_COUNT_MISMATCH'::text,
      format('produto=%s cor_codigo=%s expected=%s actual=%s',
             v_bad.produto, v_bad.cor_codigo, v_bad.row_count_esperado, v_bad.real_count),
      null::integer, null::integer, null::integer, null::integer, 0, null::numeric, now();
    return;
  end loop;

  -- b) a 'removido' group must have no staged rows.
  if exists (
    select 1
    from public.estoque_staging_grupos g
    join public.estoque_staging_linhas l
      on l.sync_id = g.sync_id and l.produto = g.produto and l.cor_codigo = g.cor_codigo
    where g.sync_id = p_sync_id and g.acao = 'removido'
  ) then
    update public.estoque_sync_execucoes set
      status = 'erro', concluido_em = now(), error_code = 'REMOVED_GROUP_HAS_STAGED_ROWS',
      erro = 'A group marked removido has staged inventory rows.',
      raw_rows = p_raw_rows, linhas_extraidas = p_canonical_rows,
      produto_count = p_produto_count, produto_cor_count = p_produto_cor_count
    where id = p_sync_id;

    delete from public.estoque_staging_linhas where sync_id = p_sync_id;
    delete from public.estoque_staging_grupos where sync_id = p_sync_id;

    return query select 'erro'::text, 'REMOVED_GROUP_HAS_STAGED_ROWS'::text,
      'A group marked removido has staged inventory rows.'::text,
      null::integer, null::integer, null::integer, null::integer, 0, null::numeric, now();
    return;
  end if;

  -- c) every staged row must belong to a novo/alterado manifest group of
  --    this sync (no orphan staged rows).
  if exists (
    select 1
    from public.estoque_staging_linhas l
    where l.sync_id = p_sync_id
      and not exists (
        select 1 from public.estoque_staging_grupos g
        where g.sync_id = l.sync_id and g.produto = l.produto and g.cor_codigo = l.cor_codigo
          and g.acao in ('novo', 'alterado')
      )
  ) then
    update public.estoque_sync_execucoes set
      status = 'erro', concluido_em = now(), error_code = 'STAGED_ROWS_WITHOUT_MANIFEST',
      erro = 'Staged inventory rows exist with no matching novo/alterado manifest entry.',
      raw_rows = p_raw_rows, linhas_extraidas = p_canonical_rows,
      produto_count = p_produto_count, produto_cor_count = p_produto_cor_count
    where id = p_sync_id;

    delete from public.estoque_staging_linhas where sync_id = p_sync_id;
    delete from public.estoque_staging_grupos where sync_id = p_sync_id;

    return query select 'erro'::text, 'STAGED_ROWS_WITHOUT_MANIFEST'::text,
      'Staged inventory rows exist with no matching novo/alterado manifest entry.'::text,
      null::integer, null::integer, null::integer, null::integer, 0, null::numeric, now();
    return;
  end if;

  select count(*) into v_new_count from public.estoque_staging_grupos where sync_id = p_sync_id and acao = 'novo';
  select count(*) into v_changed_count from public.estoque_staging_grupos where sync_id = p_sync_id and acao = 'alterado';
  select count(*) into v_removed_count from public.estoque_staging_grupos where sync_id = p_sync_id and acao = 'removido';
  select count(*) into v_current_group_count from public.estoque_atual_grupos;
  v_unchanged_count := greatest(v_current_group_count - v_changed_count - v_removed_count, 0);

  v_removal_pct := case when v_current_group_count > 0
    then round(100.0 * v_removed_count / v_current_group_count, 3)
    else 0 end;

  v_override_applied := (p_allow_large_removal and v_removal_pct > 10);

  if v_removal_pct > 10 and not p_allow_large_removal then
    update public.estoque_sync_execucoes set
      status = 'erro', concluido_em = now(), error_code = 'LARGE_REMOVAL_GUARD',
      erro = format('Removal %s%% (%s of %s groups) exceeds the 10%% guard without --allow-large-removal',
                     v_removal_pct, v_removed_count, v_current_group_count),
      raw_rows = p_raw_rows, linhas_extraidas = p_canonical_rows,
      produto_count = p_produto_count, produto_cor_count = p_produto_cor_count,
      grupos_novos = v_new_count, grupos_alterados = v_changed_count,
      grupos_removidos = v_removed_count, grupos_inalterados = v_unchanged_count,
      remocao_percentual = v_removal_pct, avisos = p_avisos,
      avisos_count = jsonb_array_length(coalesce(p_avisos, '[]'::jsonb))
    where id = p_sync_id;

    delete from public.estoque_staging_linhas where sync_id = p_sync_id;
    delete from public.estoque_staging_grupos where sync_id = p_sync_id;

    return query select 'erro'::text, 'LARGE_REMOVAL_GUARD'::text,
      format('Removal %s%% (%s of %s groups) exceeds the 10%% guard without --allow-large-removal',
             v_removal_pct, v_removed_count, v_current_group_count),
      v_new_count, v_changed_count, v_removed_count, v_unchanged_count, 0, v_removal_pct, now();
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- Atomic apply. Any unexpected error from here raises and rolls back
  -- everything in this function, including the row lock taken above.
  -- ---------------------------------------------------------------------
  delete from public.estoque_atual a
  using public.estoque_staging_grupos g
  where g.sync_id = p_sync_id
    and g.acao in ('alterado', 'removido')
    and a.produto = g.produto
    and a.cor_codigo = g.cor_codigo;

  insert into public.estoque_atual (
    produto, desc_produto, tipo_produto, linha, cor_codigo, cor_descricao_linx,
    grade, tamanho_key, tamanho_venda, quantidade_estoque, atualizado_em
  )
  select
    l.produto, l.desc_produto, l.tipo_produto, l.linha, l.cor_codigo, l.cor_descricao_linx,
    l.grade, l.tamanho_key, l.tamanho_venda, l.quantidade_estoque, now()
  from public.estoque_staging_linhas l
  where l.sync_id = p_sync_id;

  get diagnostics v_rows_written = row_count;

  delete from public.estoque_atual_grupos gr
  using public.estoque_staging_grupos g
  where g.sync_id = p_sync_id
    and g.acao = 'removido'
    and gr.produto = g.produto
    and gr.cor_codigo = g.cor_codigo;

  insert into public.estoque_atual_grupos (produto, cor_codigo, hash_conteudo, row_count, ultimo_sync_id, atualizado_em)
  select g.produto, g.cor_codigo, g.hash_conteudo, g.row_count_esperado, p_sync_id, now()
  from public.estoque_staging_grupos g
  where g.sync_id = p_sync_id and g.acao in ('novo', 'alterado')
  on conflict (produto, cor_codigo) do update set
    hash_conteudo = excluded.hash_conteudo,
    row_count = excluded.row_count,
    ultimo_sync_id = excluded.ultimo_sync_id,
    atualizado_em = excluded.atualizado_em;

  delete from public.estoque_staging_linhas where sync_id = p_sync_id;
  delete from public.estoque_staging_grupos where sync_id = p_sync_id;

  update public.estoque_sync_execucoes set
    status = 'sucesso',
    concluido_em = now(),
    raw_rows = p_raw_rows,
    linhas_extraidas = p_canonical_rows,
    linhas_publicadas = v_rows_written,
    produto_count = p_produto_count,
    produto_cor_count = p_produto_cor_count,
    grupos_novos = v_new_count,
    grupos_alterados = v_changed_count,
    grupos_removidos = v_removed_count,
    grupos_inalterados = v_unchanged_count,
    remocao_percentual = v_removal_pct,
    avisos = p_avisos,
    avisos_count = jsonb_array_length(coalesce(p_avisos, '[]'::jsonb)),
    large_removal_override_used = v_override_applied,
    override_reason = case when v_override_applied then p_override_reason else null end,
    error_code = null,
    erro = null
  where id = p_sync_id;

  return query select 'sucesso'::text, null::text, null::text,
    v_new_count, v_changed_count, v_removed_count, v_unchanged_count,
    v_rows_written, v_removal_pct, now();
end;
$$;

revoke all on function public.estoque_aplicar_sync(uuid, integer, integer, integer, integer, jsonb, boolean, text) from public;
grant execute on function public.estoque_aplicar_sync(uuid, integer, integer, integer, integer, jsonb, boolean, text) to service_role;

commit;
