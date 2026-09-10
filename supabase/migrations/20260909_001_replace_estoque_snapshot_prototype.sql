begin;

-- =============================================================================
-- Consulta de Estoque backend V1 (Inventory Backend V1) — core schema
--
-- Scope: bounded backend milestone for Consulta de Estoque. This migration
-- creates the destination schema a manual Linx -> Supabase inventory sync
-- writes into, and that the future employee-facing Consulta UI will read from
-- via SECURITY DEFINER RPCs (20260909_003). No Consulta frontend, no barcode
-- work, and no scheduled sync are part of this milestone.
--
-- -----------------------------------------------------------------------------
-- Prototype replacement
-- -----------------------------------------------------------------------------
-- An out-of-band public.estoque_snapshot prototype existed with an obsolete
-- barcode-centric schema (columns: barcode, referencia_sku, referencia_pai,
-- nome_produto, cor, tamanho_consumidor, grupo_grade, ordem_tamanho,
-- quantidade_estoque, updated_at). Pre-flight inspection on the production
-- project confirmed it was:
--   * absent from the migration ledger (supabase_migrations.schema_migrations);
--   * empty (0 rows);
--   * RLS enabled with 0 policies;
--   * referenced by no view, rule, function, or foreign key.
-- It is therefore dropped and replaced here through this tracked migration.
-- No historical applied migration is edited.
-- -----------------------------------------------------------------------------
drop table if exists public.estoque_snapshot;

-- Every table below follows the RLS pattern already established across this
-- project (funcionarios / sessoes_funcionario / escala_* / contagem_*): RLS
-- enabled, ZERO policies. anon/authenticated get no direct table access; all
-- reads happen through the SECURITY DEFINER RPCs in 20260909_003, and all
-- writes happen through the server-side sync running with a privileged key.

-- -----------------------------------------------------------------------------
-- Sync execution ledger. Portal inventory freshness is defined ONLY by the
-- most recent row with status = 'sucesso' and a non-null concluido_em. An
-- in-progress ('executando') or failed ('erro') execution can never become
-- the visible snapshot, and a failed new run never invalidates the previous
-- successful one (its rows simply stay attached to the older sync_id).
-- -----------------------------------------------------------------------------
create table public.estoque_sync_execucoes (
  id uuid primary key default gen_random_uuid(),
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz,
  status text not null default 'executando'
    check (status in ('executando', 'sucesso', 'erro')),
  linhas_extraidas integer,
  linhas_publicadas integer,
  erro text,
  created_at timestamptz not null default now(),
  check (
    (status = 'sucesso' and concluido_em is not null)
    or status <> 'sucesso'
  )
);

alter table public.estoque_sync_execucoes enable row level security;

-- Latest-successful lookup is the single hot path against this table.
create index estoque_sync_execucoes_sucesso_idx
  on public.estoque_sync_execucoes (concluido_em desc)
  where status = 'sucesso';

-- -----------------------------------------------------------------------------
-- Inventory snapshot. One row per sync + produto + cor_codigo + tamanho_key.
--
-- Canonical grain and source fields are locked (see milestone brief):
--   * a product/color qualifies for a sync when, in Linx,
--       ep.FILIAL = 'LACOSTE SHOPPING  MANAUS' AND ep.ESTOQUE > 0;
--   * once it qualifies, its ENTIRE valid size grade is retained, including
--     sizes whose quantidade_estoque = 0 (valid positions in the grade);
--   * the size grain is derived dynamically from PRODUTOS_TAMANHOS — PP/P/M/
--     G/GG are never hard-coded;
--   * tamanho_key is the deterministic source ordering position (1..48) and
--     is retained as the grade sort key.
--
-- cor_descricao_linx is internal source metadata kept here only to join the
-- color dictionary on (cor_codigo, cor_descricao_linx). It must never be
-- returned to the employee-facing Consulta contract.
-- -----------------------------------------------------------------------------
create table public.estoque_snapshot (
  id uuid primary key default gen_random_uuid(),
  sync_id uuid not null references public.estoque_sync_execucoes(id) on delete cascade,
  produto text not null,
  desc_produto text,
  tipo_produto text,
  linha text,
  cor_codigo text not null,
  cor_descricao_linx text,
  grade text,
  tamanho_key integer not null,
  tamanho_venda text,
  quantidade_estoque integer not null,
  created_at timestamptz not null default now(),
  unique (sync_id, produto, cor_codigo, tamanho_key)
);

alter table public.estoque_snapshot enable row level security;

-- Modest indexes only, sized for "latest successful sync, then by produto"
-- retrieval. pg_trgm / fuzzy search is intentionally NOT introduced yet.
-- The (sync_id, produto) btree also serves case-sensitive prefix scans
-- (produto LIKE 'PH4%') used by the search RPC, since Linx produto codes are
-- upper-case and the RPC upper-cases the search term before matching.
create index estoque_snapshot_sync_produto_idx
  on public.estoque_snapshot (sync_id, produto);

-- -----------------------------------------------------------------------------
-- Color dictionary. Mapping key is (cor_codigo, cor_descricao_linx). Seeded
-- by 20260909_002 from the curated cores_portal_final.csv (419 rows). Only
-- these four business columns are persisted; the source file's current-stock
-- count columns are prioritization metadata and are not stored.
--
-- cor_familia is stored now for future search / filter / recommendation use.
-- -----------------------------------------------------------------------------
create table public.estoque_cores_mapeamento (
  id uuid primary key default gen_random_uuid(),
  cor_codigo text not null,
  cor_descricao_linx text not null,
  cor_nome_portal text not null,
  cor_familia text not null,
  updated_at timestamptz not null default now(),
  unique (cor_codigo, cor_descricao_linx)
);

alter table public.estoque_cores_mapeamento enable row level security;

commit;
