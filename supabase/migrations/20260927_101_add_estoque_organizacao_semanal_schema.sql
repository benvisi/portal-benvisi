begin;

-- =============================================================================
-- Estoque — Organização Semanal (V1, Slice 1) — database foundation.
--
-- One estante (1-41; estantes 42-46 are out of scope for this feature) is
-- assigned per week (Sunday-Saturday, identified by its Sunday) to every
-- employee (any cargo except Administrador) who is scheduled to work at
-- least one 'trabalho' day that week, per the currently-active Escala
-- publication(s) covering that week (see 20260927_102 for the
-- generation/sync logic that reads this data). No RLS policies (matches
-- every other table in this schema) — all access is through SECURITY
-- DEFINER RPCs.
--
-- ROTATION — a single globally-advancing counter (1-41, wrapping 41->1),
-- NOT reset per week and NOT reset per employee. Estante numbers are handed
-- out in the order assignments are actually generated (product decision,
-- see 20260927_102's header for the concurrency/ordering rationale) — this
-- is a literal reading of the product spec's own example ("this week's
-- rotation begins at 20 ... the next assignment continues at 28"), and it
-- is also the only design compatible with the hard "existing assignments
-- are never reshuffled" rule together with weeks that only become fully
-- known once a later month's Escala is published.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- estoque_organizacao_rotacao_estado — singleton row holding the next estante
-- number to hand out. `id` is pinned to 1 by the check constraint so the
-- table can never hold more than one row. Every sync call locks this row
-- `for update` before allocating any estante numbers, which is what makes
-- concurrent/repeated synchronization calls safe (see 20260927_102).
-- ---------------------------------------------------------------------------
create table public.estoque_organizacao_rotacao_estado (
  id smallint primary key default 1 check (id = 1),
  proximo_numero smallint not null default 1 check (proximo_numero between 1 and 41),
  atualizado_em timestamptz not null default now()
);

insert into public.estoque_organizacao_rotacao_estado (id, proximo_numero) values (1, 1);

alter table public.estoque_organizacao_rotacao_estado enable row level security;

-- ---------------------------------------------------------------------------
-- estoque_organizacao_atribuicoes — one row per (semana_inicio, funcionario)
-- assignment. semana_inicio is always a Sunday (enforced below). Rows are
-- never updated to reassign the employee or renumber the estante once
-- created — the only in-place updates this feature makes are to
-- prateleiras_concluidas/concluido_por/concluido_em (progress, added in a
-- later slice) and atualizado_por/atualizado_em. origem distinguishes
-- automatic generation from a future lightweight manual reassignment (V1
-- management feature, not built in this slice).
--
-- concluido_por/concluido_em are included now (per the agreed V1 column
-- footprint) but are not yet written by any RPC in this slice — no
-- progress/completion RPC exists until the next slice. The paired check
-- below only guarantees the two columns are set/cleared together; it does
-- not yet encode "5/5 = concluído", since that rule belongs to the
-- progress RPC to be added later.
-- ---------------------------------------------------------------------------
create table public.estoque_organizacao_atribuicoes (
  id uuid primary key default gen_random_uuid(),
  semana_inicio date not null check (extract(dow from semana_inicio) = 0),
  funcionario_id uuid not null references public.funcionarios(id),
  numero_estante smallint not null check (numero_estante between 1 and 41),
  prateleiras_concluidas smallint not null default 0 check (prateleiras_concluidas between 0 and 5),
  origem text not null default 'automatica' check (origem in ('automatica', 'manual')),
  criado_por uuid references public.funcionarios(id),
  atualizado_por uuid references public.funcionarios(id),
  atualizado_em timestamptz not null default now(),
  concluido_por uuid references public.funcionarios(id),
  concluido_em timestamptz,
  created_at timestamptz not null default now(),
  unique (semana_inicio, funcionario_id),
  unique (semana_inicio, numero_estante),
  check ((concluido_por is null) = (concluido_em is null))
);

create index estoque_organizacao_atribuicoes_semana_idx
  on public.estoque_organizacao_atribuicoes (semana_inicio);
create index estoque_organizacao_atribuicoes_funcionario_semana_idx
  on public.estoque_organizacao_atribuicoes (funcionario_id, semana_inicio);

alter table public.estoque_organizacao_atribuicoes enable row level security;

-- ---------------------------------------------------------------------------
-- estoque_organizacao_sync_falhas — mirrors limpeza_sync_falhas exactly (see
-- 20260925_104): one row per failed weekly-sync attempt, keyed by
-- semana_inicio instead of a calendar date. A week whose latest row still
-- has resolvido_em null is "unresolved". Populated/cleared only by
-- 20260927_102's estoque_organizacao_sincronizar_semana_com_registro.
-- ---------------------------------------------------------------------------
create table public.estoque_organizacao_sync_falhas (
  id uuid primary key default gen_random_uuid(),
  semana_inicio date not null,
  falhou_em timestamptz not null default now(),
  motivo text,
  resolvido_em timestamptz
);

create index estoque_organizacao_sync_falhas_semana_idx
  on public.estoque_organizacao_sync_falhas (semana_inicio);
create index estoque_organizacao_sync_falhas_nao_resolvida_idx
  on public.estoque_organizacao_sync_falhas (semana_inicio)
  where resolvido_em is null;

alter table public.estoque_organizacao_sync_falhas enable row level security;

commit;
