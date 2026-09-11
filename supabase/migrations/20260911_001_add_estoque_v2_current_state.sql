begin;

-- =============================================================================
-- Consulta de Estoque — Sync V2 — current-state schema
--
-- Depends on 20260909_001 (estoque_sync_execucoes, estoque_snapshot,
-- estoque_cores_mapeamento). Additive only — estoque_snapshot and its data are
-- left completely untouched by this migration; V1 remains fully intact and
-- rollback-able until Joshua explicitly approves its cleanup.
--
-- V2 replaces "insert a full new ~15k-row snapshot every run" with a single
-- current-state table (estoque_atual) that a deterministic, Node-computed
-- group hash lets the sync script update by exception: unchanged
-- produto+cor_codigo groups generate zero DML. See the V2 architecture memo
-- for the full design; this migration creates the schema only.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- estoque_atual — ONE authoritative row per produto + cor_codigo + tamanho_key.
-- No sync_id dimension: this table IS the current state, mutated only inside
-- the single-transaction estoque_aplicar_sync RPC (20260911_002). RLS
-- enabled, zero policies, no direct grants to any role — reachable only
-- through SECURITY DEFINER functions, same as every other Portal table.
--
-- Column meanings mirror estoque_snapshot exactly (V1 data contract
-- preserved): cor_descricao_linx is internal Linx source metadata kept only
-- to join estoque_cores_mapeamento, never returned to employees.
-- -----------------------------------------------------------------------------
create table public.estoque_atual (
  produto text not null,
  desc_produto text,
  tipo_produto text,
  linha text,
  cor_codigo text not null,
  cor_descricao_linx text,
  grade text,
  tamanho_key integer not null check (tamanho_key between 1 and 48),
  tamanho_venda text not null,
  quantidade_estoque integer not null check (quantidade_estoque >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (produto, cor_codigo, tamanho_key)
);

alter table public.estoque_atual enable row level security;

-- The primary key already starts with produto, so it serves buscar_produtos_
-- estoque's prefix scan (produto LIKE 'PH4%') and get_produto_estoque_
-- detalhe's exact-produto lookup without a secondary index, mirroring
-- estoque_snapshot_sync_produto_idx's role in V1.

-- -----------------------------------------------------------------------------
-- estoque_atual_grupos — compact registry, one row per produto + cor_codigo,
-- holding the deterministic Node-computed content hash for that group. This
-- is what a sync run reads (cheaply, ~1,371 rows) to diff against a fresh
-- Linx extraction without ever fetching the full current inventory.
--
-- Granted plain SELECT to service_role (read-only reference data, same
-- precedent as estoque_cores_mapeamento in 20260909_005) — writes only via
-- estoque_aplicar_sync. The inventory rows and this group's hash record MUST
-- always change in the same transaction; only estoque_aplicar_sync does that.
-- -----------------------------------------------------------------------------
create table public.estoque_atual_grupos (
  produto text not null,
  cor_codigo text not null,
  hash_conteudo text not null,
  row_count integer not null check (row_count > 0),
  ultimo_sync_id uuid references public.estoque_sync_execucoes(id),
  atualizado_em timestamptz not null default now(),
  primary key (produto, cor_codigo)
);

alter table public.estoque_atual_grupos enable row level security;

-- -----------------------------------------------------------------------------
-- estoque_staging_grupos — per-sync manifest of NEW/CHANGED/REMOVED groups
-- only (never the full ~1,371-group extraction). estoque_aplicar_sync
-- verifies this manifest before touching estoque_atual.
--
-- The CHECK enforces the manifest shape at the schema level: novo/alterado
-- rows must declare a hash + expected row count; removido rows must not
-- (there is nothing to stage for a removal — just the key).
-- -----------------------------------------------------------------------------
create table public.estoque_staging_grupos (
  sync_id uuid not null references public.estoque_sync_execucoes(id) on delete cascade,
  produto text not null,
  cor_codigo text not null,
  acao text not null check (acao in ('novo', 'alterado', 'removido')),
  hash_conteudo text,
  row_count_esperado integer,
  criado_em timestamptz not null default now(),
  primary key (sync_id, produto, cor_codigo),
  check (
    (acao in ('novo', 'alterado')
      and hash_conteudo is not null
      and row_count_esperado is not null
      and row_count_esperado > 0)
    or
    (acao = 'removido'
      and hash_conteudo is null
      and row_count_esperado is null)
  )
);

alter table public.estoque_staging_grupos enable row level security;

-- -----------------------------------------------------------------------------
-- estoque_staging_linhas — the actual size rows for NEW/CHANGED groups only.
-- A REMOVED group never has rows here (enforced again, cross-table, inside
-- estoque_aplicar_sync — a CHECK constraint cannot express that by itself).
-- Disposable: consumed and deleted by estoque_aplicar_sync in the same
-- transaction that applies it, so this table stays near-empty between runs.
-- -----------------------------------------------------------------------------
create table public.estoque_staging_linhas (
  sync_id uuid not null references public.estoque_sync_execucoes(id) on delete cascade,
  produto text not null,
  cor_codigo text not null,
  tamanho_key integer not null check (tamanho_key between 1 and 48),
  desc_produto text,
  tipo_produto text,
  linha text,
  cor_descricao_linx text,
  grade text,
  tamanho_venda text not null,
  quantidade_estoque integer not null check (quantidade_estoque >= 0),
  primary key (sync_id, produto, cor_codigo, tamanho_key)
);

alter table public.estoque_staging_linhas enable row level security;

create index estoque_staging_linhas_grupo_idx
  on public.estoque_staging_linhas (sync_id, produto, cor_codigo);

-- -----------------------------------------------------------------------------
-- estoque_sync_execucoes — additive V2 audit columns. Existing columns keep
-- their meaning (status/iniciado_em/concluido_em/erro unchanged); linhas_
-- extraidas continues to mean "canonical (post-normalization) row count" and
-- linhas_publicadas now means "rows actually written to estoque_atual this
-- run" (typically far smaller than linhas_extraidas — that shift IS the
-- point of V2). No new status value: an abandoned-stale or guardrail-blocked
-- run is still recorded as status='erro', distinguished by error_code.
-- -----------------------------------------------------------------------------
alter table public.estoque_sync_execucoes
  add column raw_rows integer,
  add column produto_count integer,
  add column produto_cor_count integer,
  add column grupos_novos integer,
  add column grupos_alterados integer,
  add column grupos_removidos integer,
  add column grupos_inalterados integer,
  add column remocao_percentual numeric(6, 3),
  add column avisos jsonb not null default '[]'::jsonb,
  add column avisos_count integer not null default 0,
  add column large_removal_override_used boolean not null default false,
  add column override_reason text,
  add column error_code text;

-- Concurrency guard (research memo Q9 / V2 brief section 5-6): at most one
-- 'executando' row can exist at any time. This is the actual enforcement
-- mechanism for the claim RPC in 20260911_002 — the RPC's INSERT either
-- succeeds (claim granted) or hits this constraint (claim refused), which is
-- safe under real concurrent claim attempts because Postgres enforces unique
-- indexes at the statement level regardless of which transaction started
-- first. A future execution host change (desktop -> server) does not weaken
-- this, since it is enforced by the database, not the calling process.
create unique index estoque_sync_execucoes_unica_executando_idx
  on public.estoque_sync_execucoes ((true))
  where status = 'executando';

-- -----------------------------------------------------------------------------
-- Grants
--
-- estoque_atual and estoque_staging_* are NOT reachable directly by anon/
-- authenticated (RLS enabled, zero policies, matching every other Portal
-- table). service_role gets exactly what the sync script's Node-side code
-- needs to do directly over PostgREST; every actual mutation of estoque_atual
-- happens only inside the SECURITY DEFINER functions added in 20260911_002.
--
-- Tightening vs V1: service_role's direct insert/update on
-- estoque_sync_execucoes (granted in 20260909_005) is revoked here. In V2 the
-- script never writes that table directly — claiming, applying, and marking
-- failure all go through SECURITY DEFINER RPCs, so service_role no longer
-- needs raw DML on it. SELECT is kept for the script's own post-run logging/
-- verification reads (research memo Q10's security-tightening note).
-- -----------------------------------------------------------------------------
revoke insert, update on public.estoque_sync_execucoes from service_role;

grant select on public.estoque_atual_grupos to service_role;
grant select, insert, delete on public.estoque_staging_grupos to service_role;
grant select, insert, delete on public.estoque_staging_linhas to service_role;

commit;
