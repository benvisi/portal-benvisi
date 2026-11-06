begin;

-- =============================================================================
-- Trello #10 — Product images: Slice 1 — minimal database foundation.
--
-- Capability column + the two tables the Lacoste acquisition worker needs to
-- exist before it can write anything: an auditable execution ledger
-- (mirrors estoque_sync_execucoes) and durable candidate staging/audit data
-- (mirrors estoque_termos_busca's single-table status-lifecycle pattern).
--
-- Deliberately NOT in this migration: produto_imagem_publicadas (publish
-- queue / current-state table), Storage buckets, any browser-facing RPC,
-- and any acquisition/scoring logic. Those are later slices.
--
-- Identity: produto + cor_codigo is free-standing, exact, and keyed with NO
-- foreign key to estoque_atual / estoque_snapshot — both are transient and
-- replaced wholesale by every inventory sync (the same reasoning
-- estoque_termos_busca's own header documents for its own produto key).
-- No normalization/fuzzy-matching logic belongs here; the worker is
-- responsible for passing exact Lacoste-verified values.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Capability: funcionarios.pode_gerenciar_imagens_produto, mirroring
-- pode_gerenciar_termos_busca exactly (20260915_001) — an explicit boolean,
-- NOT cargo = 'Administrador'. Nobody holds it after this migration; it is
-- granted per employee by an explicit data change, same precedent. No
-- initial administrator assignment: the termos_busca migration this mirrors
-- performed none either (confirmed — no later migration updates it, the
-- capability is granted out-of-band), so there is no established convention
-- requiring one here.
-- -----------------------------------------------------------------------------
alter table public.funcionarios
  add column pode_gerenciar_imagens_produto boolean not null default false;

-- -----------------------------------------------------------------------------
-- produto_imagem_execucoes — acquisition/publish run ledger. Mirrors
-- estoque_sync_execucoes (20260909_001) field-for-field, plus a `modo`
-- column distinguishing the two worker modes the approved architecture
-- defines (acquisition now, publish in a later slice). Same guarantee: a
-- failed run is recorded as 'erro' and never corrupts or retroactively
-- invalidates any prior state — later slices' read paths only ever consult
-- the latest row(s) they care about, never assume this table trends upward
-- cleanly.
-- -----------------------------------------------------------------------------
create table public.produto_imagem_execucoes (
  id uuid primary key default gen_random_uuid(),
  modo text not null check (modo in ('aquisicao', 'publicacao')),
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz,
  status text not null default 'executando'
    check (status in ('executando', 'sucesso', 'erro')),
  produtos_processados integer,
  candidatos_novos integer,
  erro text,
  created_at timestamptz not null default now(),
  check (
    (status = 'sucesso' and concluido_em is not null)
    or status <> 'sucesso'
  )
);

alter table public.produto_imagem_execucoes enable row level security;

-- -----------------------------------------------------------------------------
-- produto_imagem_candidatos — one row per (produto, cor_codigo) per
-- acquisition attempt. Durable staging/audit data: this row IS the audit
-- record once a human acts on it (revisado_por/revisado_em), mirroring how
-- estoque_termos_busca's single table carries both the moderation queue and
-- its own history rather than a separate event log.
--
-- Lacoste verification/provenance columns exist so later slices never have
-- to trust that the requested URL happened to return 200 — see the
-- discovery-POC history in project docs for why that check is load-bearing
-- (color/ref must be independently confirmed from Lacoste's own response).
--
-- gallery_json / scoring_notes / limitacoes are jsonb/array rather than
-- normalized child tables: this is small, low-volume, human-reviewed data
-- (never more than a handful of candidate images per row), and a relational
-- gallery table would be exactly the kind of abstraction the brief asks not
-- to add speculatively.
-- -----------------------------------------------------------------------------
create table public.produto_imagem_candidatos (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid not null references public.produto_imagem_execucoes(id),
  produto text not null,
  cor_codigo text not null,
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'rejeitado')),

  -- Lacoste verification/provenance — never trust URL success alone.
  lacoste_pid text not null,
  lacoste_color_id text not null,
  lacoste_color_label text not null,
  lacoste_product_name text not null,
  resolved_url text not null,
  verification_ok boolean not null,

  -- Candidate/gallery data (post structured-filtering: type:"look" already
  -- excluded by the worker before this row is written).
  gallery_json jsonb not null,
  primary_candidate_url text,
  primary_candidate_reason text,
  secondary_candidate_url text,
  secondary_candidate_reason text,
  scoring_notes jsonb,
  limitacoes text[] not null default '{}',

  -- Human-review audit. A 'pendente' row has neither; an 'aprovado'/
  -- 'rejeitado' row must have both — mirrors estoque_termos_busca's
  -- (status = 'pendente') = (moderado_por is null) pattern exactly.
  revisado_por uuid references public.funcionarios(id),
  revisado_em timestamptz,

  criado_em timestamptz not null default now(),

  check ((status = 'pendente') = (revisado_por is null)),
  check ((status = 'pendente') = (revisado_em is null))
);

alter table public.produto_imagem_candidatos enable row level security;

-- At most one live pending candidate set per (produto, cor_codigo) — the
-- approved architecture's slot rule. Approved/rejected rows are excluded on
-- purpose: they remain full history for audit and never block a later
-- re-acquisition attempt, mirroring estoque_termos_busca_slot_uidx's
-- "rejection never blocks resubmission" reasoning.
create unique index produto_imagem_candidatos_pendente_uidx
  on public.produto_imagem_candidatos (produto, cor_codigo)
  where status = 'pendente';

-- -----------------------------------------------------------------------------
-- service_role grants — the standard Supabase "backend service" pattern
-- already established by 20260909_005_grant_service_role_estoque_sync_dml.sql
-- and reaffirmed as the baseline by 20260924_003 (new tables get NO
-- SELECT/INSERT/UPDATE/DELETE to anon/authenticated/service_role by
-- default; every grant below is additive and explicit, never a policy, never
-- exposed to anon/authenticated/the browser).
--
-- produto_imagem_execucoes: the worker inserts a row at start and updates it
-- at completion (status/concluido_em/counts/erro) — select, insert, update,
-- same shape as estoque_sync_execucoes.
--
-- produto_imagem_candidatos: the worker only ever inserts new candidate
-- rows in this and the next slice; status transitions (aprovado/rejeitado)
-- belong to a future SECURITY DEFINER RPC running as its own owner, not to
-- service_role directly — so no update/delete grant here, matching
-- estoque_snapshot's own select+insert-only precedent.
-- -----------------------------------------------------------------------------
grant select, insert, update on public.produto_imagem_execucoes to service_role;
grant select, insert            on public.produto_imagem_candidatos to service_role;

commit;
