begin;

-- =============================================================================
-- Consulta de Estoque — Price V1 — current-state price schema
--
-- Depends on 20260911_001/002 (estoque_atual, estoque_sync_execucoes, the V2
-- claim/apply RPCs). Additive only.
--
-- Price grain is produto + cor_codigo (price varies by colour, never by
-- size — see the Price V1 milestone brief), so this is deliberately a
-- SEPARATE current-state table from estoque_atual rather than a new column
-- denormalized onto every size row. It needs no companion "grupos" hash
-- registry the way estoque_atual does: a group's entire content is one
-- numeric value, already compact (~1,367 rows today), so the sync script
-- diffs directly against this table (see estoque-price-diff.mjs).
--
-- Price must be able to change even when inventory quantities do not, so
-- estoque_staging_precos/estoque_precos_atual are diffed and applied
-- independently of the estoque_atual_grupos content hash — never gated on an
-- inventory-side change being detected.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- estoque_precos_atual — ONE authoritative row per produto + cor_codigo, the
-- full/list price (Linx R3, PRODUTOS_PRECO_COR.PRECO1). No sync_id dimension,
-- no tamanho_key — this IS the current price state, mutated only inside
-- estoque_aplicar_sync (extended by 20260914_002). RLS enabled, zero
-- policies, no direct grants to anon/authenticated — reachable only through
-- SECURITY DEFINER functions, same as every other Portal table.
--
-- preco > 0 mirrors the sync's own normalization: PRECO1 = 0 is Linx's way of
-- saying "no price set" for a produto/cor not currently sold here, never a
-- real retail price, and is filtered out before staging (never invented, per
-- the milestone's missing-price rule).
-- -----------------------------------------------------------------------------
create table public.estoque_precos_atual (
  produto text not null,
  cor_codigo text not null,
  preco numeric(10, 2) not null check (preco > 0),
  atualizado_em timestamptz not null default now(),
  ultimo_sync_id uuid references public.estoque_sync_execucoes(id),
  primary key (produto, cor_codigo)
);

alter table public.estoque_precos_atual enable row level security;

-- -----------------------------------------------------------------------------
-- estoque_staging_precos — per-sync manifest+content of NEW/CHANGED/REMOVED
-- prices only. Combines what estoque_staging_grupos and estoque_staging_
-- linhas split in two for inventory, because a price group's content is a
-- single scalar — no separate "lines" table is needed. Disposable: consumed
-- and deleted by estoque_aplicar_sync in the same transaction that applies
-- it, so this table stays near-empty between runs.
--
-- The CHECK enforces the manifest shape at the schema level, mirroring
-- estoque_staging_grupos: novo/alterado rows must declare a price; removido
-- rows must not (there is nothing to stage for a removal — just the key).
-- -----------------------------------------------------------------------------
create table public.estoque_staging_precos (
  sync_id uuid not null references public.estoque_sync_execucoes(id) on delete cascade,
  produto text not null,
  cor_codigo text not null,
  acao text not null check (acao in ('novo', 'alterado', 'removido')),
  preco numeric(10, 2),
  criado_em timestamptz not null default now(),
  primary key (sync_id, produto, cor_codigo),
  check (
    (acao in ('novo', 'alterado') and preco is not null and preco > 0)
    or
    (acao = 'removido' and preco is null)
  )
);

alter table public.estoque_staging_precos enable row level security;

-- -----------------------------------------------------------------------------
-- estoque_sync_execucoes — additive Price V1 audit columns, same idiom as the
-- V2 grupos_*/remocao_percentual columns in 20260911_001: persisted on every
-- run (not just this milestone's one-off validation) so price coverage stays
-- diagnosable over time without re-deriving it from Linx.
--
-- preco_sem_correspondencia = how many of THIS run's incoming inventory
-- produto+cor groups had no matching R3 price (shown as "—" to employees).
-- Never blocks the run — logged/measured only, per the milestone's missing-
-- price rule.
-- -----------------------------------------------------------------------------
alter table public.estoque_sync_execucoes
  add column preco_rows_lidos integer,
  add column preco_produto_cor_count integer,
  add column preco_novos integer,
  add column preco_alterados integer,
  add column preco_removidos integer,
  add column preco_inalterados integer,
  add column preco_sem_correspondencia integer,
  add column preco_linhas_escritas integer;

-- -----------------------------------------------------------------------------
-- Grants — same shape as 20260911_001's estoque_atual_grupos/estoque_staging_*
-- grants: service_role gets exactly what the sync script's Node-side code
-- needs to do directly over PostgREST; every actual mutation of
-- estoque_precos_atual happens only inside estoque_aplicar_sync.
-- -----------------------------------------------------------------------------
grant select on public.estoque_precos_atual to service_role;
grant select, insert, delete on public.estoque_staging_precos to service_role;

commit;
