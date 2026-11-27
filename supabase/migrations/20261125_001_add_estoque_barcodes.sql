begin;

-- =============================================================================
-- Consulta de Estoque — Barcode Slice 1 — barcode mapping + sync + lookup RPC
--
-- Depends on 20260911_001/002 and 20260914_001/002 (estoque_atual, the V2
-- claim/apply RPCs, estoque_precos_atual) and 20260925_001 (detalhe RPC, left
-- UNTOUCHED here).
--
-- Adds:
--   1. estoque_barcodes            — current-state barcode -> SKU mapping.
--   2. estoque_staging_barcodes    — disposable per-sync delta (novo/alterado/removido).
--   3. estoque_barcode_sync_estado — singleton: barcode CHECK state (last
--      successful check, pending retry) kept separate from PUBLICATION state
--      (published mapping hash / count).
--   4. estoque_sync_execucoes      — additive barcode_* audit columns.
--   5. estoque_claim_sync / estoque_marcar_erro — same behavior; staging purge
--      extended to the new staging table (+ orphaned barcode staging rows).
--   6. estoque_barcode_estado / estoque_barcode_produto_cores_sem_mapeamento —
--      service_role read RPCs the sync uses to decide whether a barcode check
--      is due, without reading the full mapping.
--   7. estoque_aplicar_sync        — applies the barcode outcome in the SAME
--      transaction as inventory + price, but ISOLATED: any barcode problem
--      (removal guard, incomplete staging, count drift, unexpected error)
--      rolls back only the barcode changes, keeps the previous mapping, marks
--      the check pending for retry and lets inventory/price commit.
--      All new params default to NULL/no-op, so the currently deployed sync
--      script keeps working and never touches barcode state.
--   8. get_estoque_por_codigo_barra — session-validated lookup RPC.
--
-- SKU grain: (produto, cor_codigo, tamanho_key). One barcode maps to exactly
-- one SKU (PK on codigo_barra); several barcodes (aliases) may map to the
-- same SKU.
--
-- Scope: barcodes of every produto+cor with ANY Linx ESTOQUE_PRODUTOS row for
-- the store (zero/negative stock included), so a sold-out reference is
-- recognized instead of looking unknown. Ambiguous barcodes (one code -> more
-- than one SKU in Linx) are EXCLUDED by the sync script and therefore look
-- unknown (NAO_ENCONTRADO); they are never published with an arbitrary SKU.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- estoque_barcodes — RLS enabled, zero policies, no grants to anon/authenticated.
-- Reachable only through SECURITY DEFINER functions (+ service_role SELECT for
-- the sync script's full-reconciliation diff read). Descriptive columns exist
-- so a sold-out SKU — absent from estoque_atual — can still be named;
-- cor_descricao_linx is internal and never returned to employees.
-- -----------------------------------------------------------------------------
create table public.estoque_barcodes (
  codigo_barra text primary key
    check (length(codigo_barra) between 1 and 64 and codigo_barra = btrim(codigo_barra)),
  produto text not null,
  cor_codigo text not null,
  tamanho_key integer not null check (tamanho_key between 1 and 48),
  tamanho_venda text not null,
  desc_produto text,
  cor_descricao_linx text,
  atualizado_em timestamptz not null default now(),
  ultimo_sync_id uuid references public.estoque_sync_execucoes(id)
);

alter table public.estoque_barcodes enable row level security;

create index estoque_barcodes_sku_idx
  on public.estoque_barcodes (produto, cor_codigo, tamanho_key);

create table public.estoque_staging_barcodes (
  sync_id uuid not null references public.estoque_sync_execucoes(id) on delete cascade,
  codigo_barra text not null,
  acao text not null check (acao in ('novo', 'alterado', 'removido')),
  produto text,
  cor_codigo text,
  tamanho_key integer,
  tamanho_venda text,
  desc_produto text,
  cor_descricao_linx text,
  criado_em timestamptz not null default now(),
  primary key (sync_id, codigo_barra),
  check (
    (acao in ('novo', 'alterado')
      and produto is not null and cor_codigo is not null
      and tamanho_key between 1 and 48 and tamanho_venda is not null)
    or
    (acao = 'removido')
  )
);

alter table public.estoque_staging_barcodes enable row level security;

-- -----------------------------------------------------------------------------
-- estoque_barcode_sync_estado — singleton (id = true). No table grants: read
-- through estoque_barcode_estado(), written only by estoque_aplicar_sync.
--
--   publication state: hash_publicado / publicado_em / publicado_sync_id /
--     barcodes_publicados — advanced ONLY after a barcode delta was applied
--     successfully in the same transaction.
--   check state: ultimo_check_ok_* — any successful check (unchanged hash or
--     published delta). check_pendente — a required check failed or was
--     blocked; the next hourly run retries it. Durable, so it survives
--     inventory commits and process restarts.
-- -----------------------------------------------------------------------------
create table public.estoque_barcode_sync_estado (
  id boolean primary key default true check (id),
  hash_publicado text,
  publicado_em timestamptz,
  publicado_sync_id uuid references public.estoque_sync_execucoes(id),
  barcodes_publicados integer,
  ultimo_check_ok_em timestamptz,
  ultimo_check_ok_sync_id uuid references public.estoque_sync_execucoes(id),
  ultimo_check_ok_motivos text,
  check_pendente boolean not null default false,
  check_pendente_motivos text,
  check_pendente_desde timestamptz,
  ultima_falha_em timestamptz,
  ultima_falha_erro text,
  falhas_consecutivas integer not null default 0,
  atualizado_em timestamptz not null default now()
);

alter table public.estoque_barcode_sync_estado enable row level security;

insert into public.estoque_barcode_sync_estado (id) values (true);

alter table public.estoque_sync_execucoes
  add column barcode_check_status text
    check (barcode_check_status in ('nao_devido', 'inalterado', 'publicado', 'falha', 'bloqueado')),
  add column barcode_check_motivos text,
  add column barcode_hash text,
  add column barcode_erro text,
  add column barcode_rows_lidos integer,
  add column barcode_novos integer,
  add column barcode_alterados integer,
  add column barcode_removidos integer,
  add column barcode_inalterados integer,
  add column barcode_ambiguos integer,
  add column barcode_linhas_escritas integer;

-- Latest attempted barcode check (durable retry fallback, see estoque_barcode_estado).
create index estoque_sync_execucoes_barcode_check_idx
  on public.estoque_sync_execucoes (concluido_em desc)
  where status = 'sucesso'
    and barcode_check_status in ('inalterado', 'publicado', 'falha', 'bloqueado');

-- Explicit, least-privilege table grants (no anon/authenticated access).
grant select on public.estoque_barcodes to service_role;
grant select, insert, delete on public.estoque_staging_barcodes to service_role;

-- -----------------------------------------------------------------------------
-- estoque_purgar_staging_barcodes — barcode staging cleanup that can never
-- abort its caller. p_sync_id NULL purges rows of every execution that is no
-- longer running. Returns false (instead of raising) on a recoverable failure;
-- leftover rows are harmless (apply only ever reads its own, still-running
-- sync_id) and are purged again at the next claim. Internal: no grants.
-- -----------------------------------------------------------------------------
create function public.estoque_purgar_staging_barcodes(p_sync_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_sync_id is null then
    delete from public.estoque_staging_barcodes b
    where not exists (
      select 1 from public.estoque_sync_execucoes e
      where e.id = b.sync_id and e.status = 'executando'
    );
  else
    delete from public.estoque_staging_barcodes where sync_id = p_sync_id;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.estoque_purgar_staging_barcodes(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- estoque_claim_sync / estoque_marcar_erro — unchanged, purge extended.
-- The claim also drops barcode staging rows left by any execution that is no
-- longer running, so a crashed partial staging can never leak into a later run.
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
    perform public.estoque_purgar_staging_barcodes(v_stale.id);

    v_recovered := v_stale.id;
  end if;

  perform public.estoque_purgar_staging_barcodes(null);

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

revoke all on function public.estoque_claim_sync() from public, anon, authenticated;
grant execute on function public.estoque_claim_sync() to service_role;

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
  perform public.estoque_purgar_staging_barcodes(p_sync_id);

  return query select (v_rows > 0);
end;
$$;

revoke all on function public.estoque_marcar_erro(uuid, text, text) from public, anon, authenticated;
grant execute on function public.estoque_marcar_erro(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- Read RPCs for the sync script's cadence decision (service_role only).
-- -----------------------------------------------------------------------------
create function public.estoque_barcode_estado()
returns table (
  hash_publicado text,
  publicado_em timestamptz,
  barcodes_publicados integer,
  ultimo_check_ok_em timestamptz,
  check_pendente boolean,
  check_pendente_motivos text,
  check_pendente_desde timestamptz,
  ultima_falha_em timestamptz,
  ultima_falha_erro text,
  falhas_consecutivas integer
)
language sql
stable
security definer
set search_path = public
as $$
  -- check_pendente is also derived from the sync audit: if the most recent
  -- committed barcode check failed or was blocked, a retry is pending even if
  -- the state row itself could not be updated in that run.
  select s.hash_publicado, s.publicado_em, s.barcodes_publicados, s.ultimo_check_ok_em,
         (s.check_pendente or coalesce((
            select e.barcode_check_status in ('falha', 'bloqueado')
            from public.estoque_sync_execucoes e
            where e.status = 'sucesso'
              and e.barcode_check_status in ('inalterado', 'publicado', 'falha', 'bloqueado')
            order by e.concluido_em desc
            limit 1
          ), false)) as check_pendente,
         s.check_pendente_motivos, s.check_pendente_desde,
         s.ultima_falha_em, s.ultima_falha_erro, s.falhas_consecutivas
  from public.estoque_barcode_sync_estado s
  where s.id;
$$;

revoke all on function public.estoque_barcode_estado() from public, anon, authenticated;
grant execute on function public.estoque_barcode_estado() to service_role;

-- Given the produto+cor pairs that are NEW to inventory this run, returns the
-- ones with no barcode in the mapping (a genuinely new product/colour). A
-- sold-out colour coming back into stock already has its barcodes and is not
-- returned, so restocking never triggers a reconciliation.
create function public.estoque_barcode_produto_cores_sem_mapeamento(p_pares jsonb)
returns table (produto text, cor_codigo text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct x.produto, x.cor_codigo
  from jsonb_to_recordset(coalesce(p_pares, '[]'::jsonb)) as x(produto text, cor_codigo text)
  where x.produto is not null and x.cor_codigo is not null
    and not exists (
      select 1 from public.estoque_barcodes b
      where b.produto = x.produto and b.cor_codigo = x.cor_codigo
    );
$$;

revoke all on function public.estoque_barcode_produto_cores_sem_mapeamento(jsonb) from public, anon, authenticated;
grant execute on function public.estoque_barcode_produto_cores_sem_mapeamento(jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- estoque_aplicar_sync — inventory and price logic carried over verbatim from
-- 20260914_002; the barcode step is new and isolated (see header).
--
-- p_barcode_resultado (decided by the sync script):
--   NULL         no barcode check this run (not due / old script) — state untouched
--   'inalterado' mapping hash equals hash_publicado — record a successful check
--                (verified here: same hash AND same row count, else drift ->
--                failure + forced full reconciliation next run)
--   'publicar'   delta staged — validated against the expected counts, guarded
--                (10% removal), applied, total verified, hash advanced
--   'falha' / 'bloqueado'  the script could not complete the check — record it,
--                keep the previous mapping, mark the check pending (retry)
-- -----------------------------------------------------------------------------
drop function if exists public.estoque_aplicar_sync(uuid, integer, integer, integer, integer, jsonb, boolean, text, integer, integer, integer);

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
  p_preco_sem_correspondencia integer default null,
  p_barcode_resultado text default null,
  p_barcode_motivos text default null,
  p_barcode_hash text default null,
  p_barcode_total integer default null,
  p_barcode_novos_esperados integer default null,
  p_barcode_alterados_esperados integer default null,
  p_barcode_removidos_esperados integer default null,
  p_barcode_rows_lidos integer default null,
  p_barcode_ambiguos integer default null,
  p_barcode_erro text default null,
  p_barcode_allow_large_removal boolean default false
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
  barcode_check_status text,
  barcode_erro text,
  barcode_novos integer,
  barcode_alterados integer,
  barcode_removidos integer,
  barcode_inalterados integer,
  barcode_linhas_escritas integer,
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
  v_avisos jsonb := coalesce(p_avisos, '[]'::jsonb);
  v_estado record;
  v_bc_status text;
  v_bc_erro text;
  v_bc_current_count integer;
  v_bc_final_count integer;
  v_bc_novos integer;
  v_bc_alterados integer;
  v_bc_removidos integer;
  v_bc_inalterados integer;
  v_bc_escritos integer;
  v_bc_removal_pct numeric(6, 3);
  v_bc_override_applied boolean := false;
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
    perform public.estoque_purgar_staging_barcodes(p_sync_id);

    return query select 'erro'::text, 'MANIFEST_ROW_COUNT_MISMATCH'::text,
      format('produto=%s cor_codigo=%s expected=%s actual=%s',
             v_bad.produto, v_bad.cor_codigo, v_bad.row_count_esperado, v_bad.real_count),
      null::integer, null::integer, null::integer, null::integer, 0, null::numeric,
      null::integer, null::integer, null::integer, null::integer, 0,
      null::text, null::text, null::integer, null::integer, null::integer, null::integer, 0, now();
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
    perform public.estoque_purgar_staging_barcodes(p_sync_id);

    return query select 'erro'::text, 'REMOVED_GROUP_HAS_STAGED_ROWS'::text,
      'A group marked removido has staged inventory rows.'::text,
      null::integer, null::integer, null::integer, null::integer, 0, null::numeric,
      null::integer, null::integer, null::integer, null::integer, 0,
      null::text, null::text, null::integer, null::integer, null::integer, null::integer, 0, now();
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
    perform public.estoque_purgar_staging_barcodes(p_sync_id);

    return query select 'erro'::text, 'STAGED_ROWS_WITHOUT_MANIFEST'::text,
      'Staged inventory rows exist with no matching novo/alterado manifest entry.'::text,
      null::integer, null::integer, null::integer, null::integer, 0, null::numeric,
      null::integer, null::integer, null::integer, null::integer, 0,
      null::text, null::text, null::integer, null::integer, null::integer, null::integer, 0, now();
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

  -- Inventory guard: unchanged — still aborts the whole run (inventory, price
  -- and barcodes) exactly as before this migration.
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
    perform public.estoque_purgar_staging_barcodes(p_sync_id);

    return query select 'erro'::text, 'LARGE_REMOVAL_GUARD'::text,
      format('Removal %s%% (%s of %s groups) exceeds the 10%% guard without --allow-large-removal',
             v_removal_pct, v_removed_count, v_current_group_count),
      v_new_count, v_changed_count, v_removed_count, v_unchanged_count, 0, v_removal_pct,
      null::integer, null::integer, null::integer, null::integer, 0,
      null::text, null::text, null::integer, null::integer, null::integer, null::integer, 0, now();
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- Inventory apply (unchanged).
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

  -- Price apply (unchanged from 20260914_002).
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

  -- ---------------------------------------------------------------------
  -- Barcode step — isolated. Nothing here can abort the inventory/price
  -- apply above: failures are caught in a subtransaction (the inner BEGIN
  -- ... EXCEPTION block), which undoes only the barcode writes.
  -- ---------------------------------------------------------------------
  if p_barcode_resultado is null then
    v_bc_status := 'nao_devido';
  else
    -- One subtransaction for every barcode write: state lock, mapping
    -- publication and state advancement. A recoverable failure anywhere in it
    -- (including the state update after a successful publication) rolls back
    -- ALL barcode changes — previous mapping and hash kept — while the
    -- inventory/price changes above stay intact.
    begin
      select * into v_estado from public.estoque_barcode_sync_estado where id for update;

      if p_barcode_resultado = 'inalterado' then
        select count(*) into v_bc_current_count from public.estoque_barcodes;
        if p_barcode_hash is null or v_estado.hash_publicado is distinct from p_barcode_hash then
          v_bc_status := 'falha';
          v_bc_erro := 'BARCODE_HASH_MISMATCH: reported hash does not match the published hash';
        elsif p_barcode_total is distinct from v_bc_current_count then
          -- Mapping table drifted from what was published: clear the published
          -- hash so the retry performs a full reconciliation.
          v_bc_status := 'falha';
          v_bc_erro := format('BARCODE_STATE_DRIFT: estoque_barcodes has %s rows, expected %s',
                              v_bc_current_count, p_barcode_total);
          update public.estoque_barcode_sync_estado set hash_publicado = null where id;
        else
          v_bc_status := 'inalterado';
          v_bc_inalterados := v_bc_current_count;
        end if;

      elsif p_barcode_resultado = 'publicar' then
        begin
          select count(*) filter (where acao = 'novo'),
                 count(*) filter (where acao = 'alterado'),
                 count(*) filter (where acao = 'removido')
            into v_bc_novos, v_bc_alterados, v_bc_removidos
          from public.estoque_staging_barcodes where sync_id = p_sync_id;

          if p_barcode_hash is null or p_barcode_total is null
             or v_bc_novos is distinct from p_barcode_novos_esperados
             or v_bc_alterados is distinct from p_barcode_alterados_esperados
             or v_bc_removidos is distinct from p_barcode_removidos_esperados then
            raise exception using errcode = 'P0001', message = format(
              'BARCODE_STAGING_INCOMPLETE: staged novo=%s alterado=%s removido=%s, expected novo=%s alterado=%s removido=%s',
              v_bc_novos, v_bc_alterados, v_bc_removidos,
              p_barcode_novos_esperados, p_barcode_alterados_esperados, p_barcode_removidos_esperados);
          end if;

          select count(*) into v_bc_current_count from public.estoque_barcodes;
          v_bc_removal_pct := case when v_bc_current_count > 0
            then round(100.0 * v_bc_removidos / v_bc_current_count, 3) else 0 end;

          if v_bc_removal_pct > 10 and not p_barcode_allow_large_removal then
            v_bc_status := 'bloqueado';
            v_bc_erro := format(
              'BARCODE_LARGE_REMOVAL_GUARD: removal %s%% (%s of %s) exceeds 10%% without --allow-large-barcode-removal; previous mapping kept',
              v_bc_removal_pct, v_bc_removidos, v_bc_current_count);
          else
            v_bc_override_applied := (p_barcode_allow_large_removal and v_bc_removal_pct > 10);

            delete from public.estoque_barcodes b
            using public.estoque_staging_barcodes sb
            where sb.sync_id = p_sync_id
              and sb.acao in ('alterado', 'removido')
              and b.codigo_barra = sb.codigo_barra;

            insert into public.estoque_barcodes (
              codigo_barra, produto, cor_codigo, tamanho_key, tamanho_venda,
              desc_produto, cor_descricao_linx, atualizado_em, ultimo_sync_id
            )
            select
              sb.codigo_barra, sb.produto, sb.cor_codigo, sb.tamanho_key, sb.tamanho_venda,
              sb.desc_produto, sb.cor_descricao_linx, now(), p_sync_id
            from public.estoque_staging_barcodes sb
            where sb.sync_id = p_sync_id and sb.acao in ('novo', 'alterado');

            get diagnostics v_bc_escritos = row_count;

            select count(*) into v_bc_final_count from public.estoque_barcodes;
            if v_bc_final_count <> p_barcode_total then
              raise exception using errcode = 'P0001', message = format(
                'BARCODE_TOTAL_MISMATCH: mapping would have %s rows, expected %s',
                v_bc_final_count, p_barcode_total);
            end if;

            v_bc_status := 'publicado';
            v_bc_inalterados := greatest(v_bc_current_count - v_bc_alterados - v_bc_removidos, 0);
          end if;
        exception when others then
          v_bc_status := 'falha';
          v_bc_erro := left(sqlerrm, 2000);
          v_bc_escritos := null;
          v_bc_override_applied := false;
        end;

      elsif p_barcode_resultado = 'bloqueado' then
        v_bc_status := 'bloqueado';
        v_bc_erro := coalesce(p_barcode_erro, 'BARCODE_LARGE_REMOVAL_GUARD');
      else
        v_bc_status := 'falha';
        v_bc_erro := coalesce(p_barcode_erro,
          format('BARCODE_RESULTADO_INVALIDO: %s', p_barcode_resultado));
      end if;

      if v_bc_status in ('inalterado', 'publicado') then
        update public.estoque_barcode_sync_estado set
          hash_publicado = case when v_bc_status = 'publicado' then p_barcode_hash else hash_publicado end,
          publicado_em = case when v_bc_status = 'publicado' then now() else publicado_em end,
          publicado_sync_id = case when v_bc_status = 'publicado' then p_sync_id else publicado_sync_id end,
          barcodes_publicados = case when v_bc_status = 'publicado' then p_barcode_total else barcodes_publicados end,
          ultimo_check_ok_em = now(),
          ultimo_check_ok_sync_id = p_sync_id,
          ultimo_check_ok_motivos = p_barcode_motivos,
          check_pendente = false,
          check_pendente_motivos = null,
          check_pendente_desde = null,
          falhas_consecutivas = 0,
          atualizado_em = now()
        where id;
      else
        update public.estoque_barcode_sync_estado set
          check_pendente = true,
          check_pendente_motivos = p_barcode_motivos,
          check_pendente_desde = coalesce(check_pendente_desde, now()),
          ultima_falha_em = now(),
          ultima_falha_erro = v_bc_erro,
          falhas_consecutivas = falhas_consecutivas + 1,
          atualizado_em = now()
        where id;
      end if;
    exception when others then
      v_bc_status := 'falha';
      v_bc_erro := left(format(
        'BARCODE_DB_FAILURE: %s (barcode changes rolled back; previous mapping kept)', sqlerrm), 2000);
      v_bc_novos := null; v_bc_alterados := null; v_bc_removidos := null;
      v_bc_inalterados := null; v_bc_escritos := null; v_bc_override_applied := false;
      begin
        update public.estoque_barcode_sync_estado set
          check_pendente = true,
          check_pendente_motivos = p_barcode_motivos,
          check_pendente_desde = coalesce(check_pendente_desde, now()),
          ultima_falha_em = now(),
          ultima_falha_erro = v_bc_erro,
          falhas_consecutivas = falhas_consecutivas + 1,
          atualizado_em = now()
        where id;
      exception when others then
        -- Durable fallback: this run's audit row (barcode_check_status =
        -- 'falha') makes estoque_barcode_estado() report the check pending.
        v_bc_erro := left(v_bc_erro || format('; state row not updated (%s) — retry derived from sync audit', sqlerrm), 2000);
      end;
    end;

    if v_bc_status in ('falha', 'bloqueado') then
      v_avisos := v_avisos || jsonb_build_array(
        format('BARCODE_CHECK_%s: %s (previous mapping kept; retried next run)', upper(v_bc_status), v_bc_erro));
    end if;
  end if;

  if not public.estoque_purgar_staging_barcodes(p_sync_id) then
    v_avisos := v_avisos || jsonb_build_array(
      'BARCODE_STAGING_CLEANUP_FAILED: staged barcode rows of this run were not deleted; they are never applied and are purged at the next claim');
  end if;

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
    avisos = v_avisos,
    avisos_count = jsonb_array_length(v_avisos),
    large_removal_override_used = (v_override_applied or v_bc_override_applied),
    override_reason = case when (v_override_applied or v_bc_override_applied) then p_override_reason else null end,
    error_code = null,
    erro = null,
    preco_rows_lidos = p_preco_rows_lidos,
    preco_produto_cor_count = p_preco_produto_cor_count,
    preco_novos = v_preco_novos,
    preco_alterados = v_preco_alterados,
    preco_removidos = v_preco_removidos,
    preco_inalterados = v_preco_inalterados,
    preco_sem_correspondencia = p_preco_sem_correspondencia,
    preco_linhas_escritas = v_preco_escritos,
    barcode_check_status = v_bc_status,
    barcode_check_motivos = p_barcode_motivos,
    barcode_hash = p_barcode_hash,
    barcode_erro = v_bc_erro,
    barcode_rows_lidos = p_barcode_rows_lidos,
    barcode_novos = case when v_bc_status = 'publicado' then v_bc_novos end,
    barcode_alterados = case when v_bc_status = 'publicado' then v_bc_alterados end,
    barcode_removidos = case when v_bc_status = 'publicado' then v_bc_removidos end,
    barcode_inalterados = v_bc_inalterados,
    barcode_ambiguos = p_barcode_ambiguos,
    barcode_linhas_escritas = case when v_bc_status = 'publicado' then v_bc_escritos else 0 end
  where id = p_sync_id;

  return query select 'sucesso'::text, null::text, null::text,
    v_new_count, v_changed_count, v_removed_count, v_unchanged_count,
    v_rows_written, v_removal_pct,
    v_preco_novos, v_preco_alterados, v_preco_removidos, v_preco_inalterados, v_preco_escritos,
    v_bc_status, v_bc_erro,
    case when v_bc_status = 'publicado' then v_bc_novos end,
    case when v_bc_status = 'publicado' then v_bc_alterados end,
    case when v_bc_status = 'publicado' then v_bc_removidos end,
    v_bc_inalterados,
    case when v_bc_status = 'publicado' then v_bc_escritos else 0 end,
    now();
end;
$$;

revoke all on function public.estoque_aplicar_sync(uuid, integer, integer, integer, integer, jsonb, boolean, text, integer, integer, integer, text, text, text, integer, integer, integer, integer, integer, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.estoque_aplicar_sync(uuid, integer, integer, integer, integer, jsonb, boolean, text, integer, integer, integer, text, text, text, integer, integer, integer, integer, integer, integer, text, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- get_estoque_por_codigo_barra — authenticated (employee-session) lookup.
--
-- Returns exactly one row for a non-blank code. `resultado`:
--   NAO_ENCONTRADO      barcode not in the mapping (unknown / never carried /
--                       inactive / ambiguous-excluded)
--   DISPONIVEL          recognized SKU, this size has stock
--   TAMANHO_ESGOTADO    this size has none, other sizes of the colour do
--   COR_ESGOTADA        the colour has none, another colour of the reference
--                       does (outras_cores_disponiveis > 0)
--   REFERENCIA_ESGOTADA recognized product, no colour has stock (including a
--                       reference absent from estoque_atual altogether)
-- Availability only ever counts POSITIVE quantities (greatest(q, 0)): the sync
-- already normalizes negative size-level Linx values to 0, and this guards the
-- lookup against a residual negative offsetting a positive in a sum.
-- Barcode is matched exactly as text (leading zeros preserved); only
-- surrounding whitespace is trimmed. cor_descricao_linx is never returned.
-- -----------------------------------------------------------------------------
create function public.get_estoque_por_codigo_barra(
  p_session_token text,
  p_codigo_barra text
)
returns table (
  resultado text,
  codigo_barra text,
  produto text,
  desc_produto text,
  cor_codigo text,
  cor_nome_portal text,
  cor_familia text,
  tamanho_key integer,
  tamanho_venda text,
  quantidade_estoque integer,
  outras_cores_disponiveis integer,
  sync_concluido_em timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_codigo text;
  v_b record;
  v_desc text;
  v_label text;
  v_qty integer;
  v_cor_total bigint;
  v_prod_total bigint;
  v_outras integer;
  v_resultado text;
  v_fresh timestamptz;
  v_nome text;
  v_familia text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_codigo := btrim(coalesce(p_codigo_barra, ''));
  if length(v_codigo) = 0 then
    return;
  end if;

  select f.concluido_em into v_fresh from public.estoque_freshness_atual() f;

  select * into v_b from public.estoque_barcodes eb where eb.codigo_barra = v_codigo;
  if not found then
    return query select 'NAO_ENCONTRADO'::text, v_codigo, null::text, null::text, null::text,
      null::text, null::text, null::integer, null::text, null::integer, null::integer, v_fresh;
    return;
  end if;

  select coalesce(sum(greatest(a.quantidade_estoque, 0)), 0) into v_cor_total
  from public.estoque_atual a
  where a.produto = v_b.produto and a.cor_codigo = v_b.cor_codigo;

  select coalesce(sum(greatest(a.quantidade_estoque, 0)), 0) into v_prod_total
  from public.estoque_atual a
  where a.produto = v_b.produto;

  select count(*)::integer into v_outras
  from (
    select a.cor_codigo
    from public.estoque_atual a
    where a.produto = v_b.produto and a.cor_codigo <> v_b.cor_codigo
    group by a.cor_codigo
    having sum(greatest(a.quantidade_estoque, 0)) > 0
  ) o;

  -- Live inventory row for this exact size (absent when the colour is sold out).
  select a.tamanho_venda, greatest(a.quantidade_estoque, 0) into v_label, v_qty
  from public.estoque_atual a
  where a.produto = v_b.produto and a.cor_codigo = v_b.cor_codigo
    and a.tamanho_key = v_b.tamanho_key;
  v_qty := coalesce(v_qty, 0);

  select a.desc_produto into v_desc
  from public.estoque_atual a
  where a.produto = v_b.produto
  order by (a.cor_codigo = v_b.cor_codigo) desc, a.cor_codigo
  limit 1;

  v_resultado := case
    when v_qty > 0 then 'DISPONIVEL'
    when v_cor_total > 0 then 'TAMANHO_ESGOTADO'
    when v_prod_total > 0 then 'COR_ESGOTADA'
    else 'REFERENCIA_ESGOTADA'
  end;

  select m.cor_nome_portal, m.cor_familia into v_nome, v_familia
  from public.estoque_cores_mapeamento m
  where m.cor_codigo = v_b.cor_codigo
    and m.cor_descricao_linx = coalesce(
      (select a.cor_descricao_linx from public.estoque_atual a
        where a.produto = v_b.produto and a.cor_codigo = v_b.cor_codigo limit 1),
      v_b.cor_descricao_linx)
  limit 1;

  return query select
    v_resultado, v_b.codigo_barra, v_b.produto,
    coalesce(v_desc, v_b.desc_produto),
    v_b.cor_codigo, v_nome, v_familia,
    v_b.tamanho_key, coalesce(v_label, v_b.tamanho_venda),
    v_qty, v_outras, v_fresh;
end;
$$;

revoke all on function public.get_estoque_por_codigo_barra(text, text) from public, authenticated;
grant execute on function public.get_estoque_por_codigo_barra(text, text) to anon;

commit;
