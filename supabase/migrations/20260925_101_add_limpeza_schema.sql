begin;

-- =============================================================================
-- Limpeza V1 — Varrer / Passar pano automated cleaning assignments, driven by
-- Escala (source of truth for who is working each date/turno). See
-- 20260925_102_add_limpeza_rpcs.sql for the generation/sync/completion logic
-- that operates on these tables. No RLS policies (matches every other table
-- in this schema) — all access is through SECURITY DEFINER RPCs.
-- =============================================================================

-- Eligibility is exclusion-based (product decision 2026-09-25): every cargo
-- participates in the Varrer/Passar pano rotation except the ones listed
-- here, so newly hired cargos (anything beyond Vendedor/Caixa) become
-- eligible automatically with no migration required. Only Gerente and
-- Administrador are excluded at launch. Edited directly as a data change —
-- like feriados, there is no admin UI for this table in V1.
create table public.limpeza_cargos_excluidos (
  cargo text primary key,
  criado_em timestamptz not null default now()
);

insert into public.limpeza_cargos_excluidos (cargo) values ('Gerente'), ('Administrador');

alter table public.limpeza_cargos_excluidos enable row level security;

-- One row per (data, turno, tarefa) slot. funcionario_id is nullable to
-- represent "generation ran but found no eligible candidate that shift"
-- (status = 'sem_candidato'), which is surfaced to management rather than
-- silently skipped. origem/bloqueada track manual overrides (Gerente or
-- Administrador changed the assignment); a bloqueada row is protected from
-- ordinary automatic recalculation — see limpeza_sincronizar_dia.
create table public.limpeza_atribuicoes (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  turno text not null check (turno in ('manha', 'tarde')),
  tarefa text not null check (tarefa in ('varrer', 'passar_pano')),
  funcionario_id uuid references public.funcionarios(id),
  origem text not null default 'automatica' check (origem in ('automatica', 'manual')),
  bloqueada boolean not null default false,
  status text not null default 'pendente'
    check (status in ('pendente', 'concluida', 'conflito', 'sem_candidato')),
  conflito_motivo text,
  concluido_por uuid references public.funcionarios(id),
  concluido_em timestamptz,
  criado_por uuid references public.funcionarios(id),
  atualizado_por uuid references public.funcionarios(id),
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (data, turno, tarefa),
  check (funcionario_id is not null or status = 'sem_candidato'),
  check (status <> 'concluida' or (concluido_por is not null and concluido_em is not null))
);

create index limpeza_atribuicoes_data_idx on public.limpeza_atribuicoes (data);
create index limpeza_atribuicoes_funcionario_data_idx
  on public.limpeza_atribuicoes (funcionario_id, data);

alter table public.limpeza_atribuicoes enable row level security;

commit;
