begin;

-- =============================================================================
-- Consulta de Estoque — Price V1 — RPC integration
--
-- Depends on 20260914_001 (estoque_precos_atual, estoque_staging_precos).
--
-- Three changes, all preserving the existing V2 atomic/current-state
-- behavior (V2 brief) rather than regressing it:
--
--   1. estoque_claim_sync / estoque_marcar_erro — CREATE OR REPLACE, same
--      signature, only their staging-purge cleanup now also covers
--      estoque_staging_precos, so a recovered/failed execution never leaves
--      orphaned staged price rows behind.
--   2. estoque_aplicar_sync — signature/return type change (new params +
--      new preco_* output columns), so DROP + CREATE. Applies the staged
--      price delta in the SAME transaction as the inventory delta — a
--      genuinely unexpected error rolls both back together, and every
--      already-existing inventory-only failure path now also purges
--      estoque_staging_precos before returning.
--   3. get_produto_estoque_detalhe — signature/return type change (new
--      `preco` column), so DROP + CREATE. LEFT JOIN on estoque_precos_atual
--      by (produto, cor_codigo), same precedent already used for
--      estoque_cores_mapeamento (cor_nome_portal/cor_familia) — a missing
--      price comes back as SQL NULL, never invented, and the UI renders it
--      as "—".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- estoque_claim_sync — unchanged behavior, stale-recovery cleanup extended.
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

    delete from public.estoque_staging_linhas l where l.sync_id = v_stale.id;
    delete from public.estoque_staging_grupos g where g.sync_id = v_stale.id;
    delete from public.estoque_staging_precos p where p.sync_id = v_stale.id;

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
-- estoque_marcar_erro — unchanged behavior, staging purge extended.
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
  delete from public.estoque_staging_precos where sync_id = p_sync_id;

  return query select (v_rows > 0);
end;
$$;

revoke all on function public.estoque_marcar_erro(uuid, text, text) from public;
grant execute on function public.estoque_marcar_erro(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- estoque_aplicar_sync — extended with the price apply step. Return type
-- changes (new preco_* output columns) so this must be DROP + CREATE, not
-- CREATE OR REPLACE (Postgres rejects a RETURNS TABLE change otherwise).
-- -----------------------------------------------------------------------------
drop function if exists public.estoque_aplicar_sync(uuid, integer, integer, integer, integer, jsonb, boolean, text);

create function public.estoque_aplicar_sync(
  p_sync_id uuid,
  p_raw_rows integer,
  p_canonical_rows integer,
  p_produto_count integer,
  p_produto_cor_count integer,
  p_avisos jsonb default '[]'::jsonb,
  p_allow_large_removal boolean default false,
  p_override_reason text default null,
  p_preco_rows_lidos integer default null,
  p_preco_produto_cor_count integer default null,
  p_preco_sem_correspondencia integer default null
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
  preco_novos integer,
  preco_alterados integer,
  preco_removidos integer,
  preco_inalterados integer,
  preco_linhas_escritas integer,
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
  v_preco_current_count integer;
  v_preco_novos integer;
  v_preco_alterados integer;
  v_preco_removidos integer;
  v_preco_inalterados integer;
  v_preco_escritos integer := 0;
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
    delete from public.estoque_staging_precos where sync_id = p_sync_id;

    return query select 'erro'::text, 'MANIFEST_ROW_COUNT_MISMATCH'::text,
      format('produto=%s cor_codigo=%s expected=%s actual=%s',
             v_bad.produto, v_bad.cor_codigo, v_bad.row_count_esperado, v_bad.real_count),
      null::integer, null::integer, null::integer, null::integer, 0, null::numeric,
      null::integer, null::integer, null::integer, null::integer, 0, now();
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
    delete from public.estoque_staging_precos where sync_id = p_sync_id;

    return query select 'erro'::text, 'REMOVED_GROUP_HAS_STAGED_ROWS'::text,
      'A group marked removido has staged inventory rows.'::text,
      null::integer, null::integer, null::integer, null::integer, 0, null::numeric,
      null::integer, null::integer, null::integer, null::integer, 0, now();
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
    delete from public.estoque_staging_precos where sync_id = p_sync_id;

    return query select 'erro'::text, 'STAGED_ROWS_WITHOUT_MANIFEST'::text,
      'Staged inventory rows exist with no matching novo/alterado manifest entry.'::text,
      null::integer, null::integer, null::integer, null::integer, 0, null::numeric,
      null::integer, null::integer, null::integer, null::integer, 0, now();
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
    delete from public.estoque_staging_precos where sync_id = p_sync_id;

    return query select 'erro'::text, 'LARGE_REMOVAL_GUARD'::text,
      format('Removal %s%% (%s of %s groups) exceeds the 10%% guard without --allow-large-removal',
             v_removal_pct, v_removed_count, v_current_group_count),
      v_new_count, v_changed_count, v_removed_count, v_unchanged_count, 0, v_removal_pct,
      null::integer, null::integer, null::integer, null::integer, 0, now();
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- Atomic apply. Any unexpected error from here raises and rolls back
  -- everything in this function, including the row lock taken above —
  -- inventory AND price together, never a partial publish.
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

  -- Price apply — independent of the inventory delta above (may touch a
  -- completely different set of produto+cor keys, e.g. a price-only change
  -- on an otherwise-unchanged inventory group).
  select count(*) into v_preco_current_count from public.estoque_precos_atual;
  select count(*) into v_preco_novos from public.estoque_staging_precos where sync_id = p_sync_id and acao = 'novo';
  select count(*) into v_preco_alterados from public.estoque_staging_precos where sync_id = p_sync_id and acao = 'alterado';
  select count(*) into v_preco_removidos from public.estoque_staging_precos where sync_id = p_sync_id and acao = 'removido';
  v_preco_inalterados := greatest(v_preco_current_count - v_preco_alterados - v_preco_removidos, 0);

  delete from public.estoque_precos_atual pa
  using public.estoque_staging_precos sp
  where sp.sync_id = p_sync_id
    and sp.acao in ('alterado', 'removido')
    and pa.produto = sp.produto
    and pa.cor_codigo = sp.cor_codigo;

  insert into public.estoque_precos_atual (produto, cor_codigo, preco, atualizado_em, ultimo_sync_id)
  select sp.produto, sp.cor_codigo, sp.preco, now(), p_sync_id
  from public.estoque_staging_precos sp
  where sp.sync_id = p_sync_id and sp.acao in ('novo', 'alterado');

  get diagnostics v_preco_escritos = row_count;

  delete from public.estoque_staging_precos where sync_id = p_sync_id;

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
    erro = null,
    preco_rows_lidos = p_preco_rows_lidos,
    preco_produto_cor_count = p_preco_produto_cor_count,
    preco_novos = v_preco_novos,
    preco_alterados = v_preco_alterados,
    preco_removidos = v_preco_removidos,
    preco_inalterados = v_preco_inalterados,
    preco_sem_correspondencia = p_preco_sem_correspondencia,
    preco_linhas_escritas = v_preco_escritos
  where id = p_sync_id;

  return query select 'sucesso'::text, null::text, null::text,
    v_new_count, v_changed_count, v_removed_count, v_unchanged_count,
    v_rows_written, v_removal_pct,
    v_preco_novos, v_preco_alterados, v_preco_removidos, v_preco_inalterados, v_preco_escritos,
    now();
end;
$$;

revoke all on function public.estoque_aplicar_sync(uuid, integer, integer, integer, integer, jsonb, boolean, text, integer, integer, integer) from public;
grant execute on function public.estoque_aplicar_sync(uuid, integer, integer, integer, integer, jsonb, boolean, text, integer, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- get_produto_estoque_detalhe — adds `preco` (nullable) via LEFT JOIN on
-- estoque_precos_atual. Return type changes so this must be DROP + CREATE.
-- Every other column/behavior is identical to 20260911_003 — the UI needs no
-- other RPC change, and a missing price is SQL NULL, never a manufactured 0.
-- -----------------------------------------------------------------------------
drop function if exists public.get_produto_estoque_detalhe(text, text);

create function public.get_produto_estoque_detalhe(
  p_session_token text,
  p_produto text
)
returns table (
  produto text,
  desc_produto text,
  tipo_produto text,
  linha text,
  cor_codigo text,
  cor_nome_portal text,
  cor_familia text,
  tamanho_key integer,
  tamanho_venda text,
  quantidade_estoque integer,
  preco numeric(10, 2),
  sync_concluido_em timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_produto text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_produto := upper(trim(coalesce(p_produto, '')));
  if length(v_produto) = 0 then
    return;
  end if;

  return query
  select
    s.produto,
    s.desc_produto,
    s.tipo_produto,
    s.linha,
    s.cor_codigo,
    m.cor_nome_portal,
    m.cor_familia,
    s.tamanho_key,
    s.tamanho_venda,
    s.quantidade_estoque,
    pr.preco,
    f.concluido_em as sync_concluido_em
  from public.estoque_atual s
  cross join public.estoque_freshness_atual() f
  left join public.estoque_cores_mapeamento m
    on m.cor_codigo = s.cor_codigo
   and m.cor_descricao_linx = s.cor_descricao_linx
  left join public.estoque_precos_atual pr
    on pr.produto = s.produto
   and pr.cor_codigo = s.cor_codigo
  where s.produto = v_produto
    and s.tamanho_venda is not null
  order by s.cor_codigo, s.tamanho_key;
end;
$$;

revoke all on function public.get_produto_estoque_detalhe(text, text) from public;
grant execute on function public.get_produto_estoque_detalhe(text, text) to anon;

commit;
