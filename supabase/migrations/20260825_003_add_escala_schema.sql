begin;

-- =============================================================================
-- Escala V1 foundation (Milestone 4C.1) — core schema
--
-- Depends on 20260825_001 (funcionarios metadata). Independent of
-- 20260825_002 (roster seed) — either order is fine relative to that file,
-- but this one is numbered after it since publicado_por below will
-- reference real employee ids once a publication is eventually inserted.
--
-- Architecture: Excel remains the schedule-authoring tool for V1. Portal is
-- the publishing/consumption layer only — this migration creates the
-- destination schema a future structured import/publish step will write
-- into, and the read model the future employee-facing Escala UI will read
-- from. No schedule editor, no Excel upload UI, and no actual September
-- data are part of this migration — see Blueprint section 16.2, Milestone
-- 4C.1, for the full scope boundary.
--
-- Every table below follows the same RLS pattern already established for
-- funcionarios/sessoes_funcionario in this project: RLS enabled, zero
-- policies. All access goes through SECURITY DEFINER RPCs (20260825_004),
-- never direct anon table access — "do not rely on frontend filtering for
-- confidentiality/authorization" applies here the same as everywhere else.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Store operating hours: normal weekly hours + special-date overrides,
-- rather than duplicating hours for every calendar day. dia_semana follows
-- PostgreSQL's own EXTRACT(DOW FROM date) convention: 0 = Sunday .. 6 =
-- Saturday — chosen specifically so callers can join on
-- extract(dow from some_date)::smallint with no translation table.
-- -----------------------------------------------------------------------------
create table public.loja_horario_padrao (
  dia_semana smallint primary key check (dia_semana between 0 and 6),
  abertura time not null,
  fechamento time not null,
  check (fechamento > abertura)
);

alter table public.loja_horario_padrao enable row level security;

insert into public.loja_horario_padrao (dia_semana, abertura, fechamento) values
  (0, time '14:00', time '21:00'), -- domingo
  (1, time '10:00', time '22:00'), -- segunda
  (2, time '10:00', time '22:00'), -- terça
  (3, time '10:00', time '22:00'), -- quarta
  (4, time '10:00', time '22:00'), -- quinta
  (5, time '10:00', time '22:00'), -- sexta
  (6, time '10:00', time '22:00'); -- sábado

-- Holiday/special-date overrides — a null abertura/fechamento with
-- fechada = true means the store is closed all day; non-null hours override
-- the normal weekly hours for that one date (e.g. reduced holiday hours).
create table public.loja_horario_excecao (
  data date primary key,
  abertura time,
  fechamento time,
  fechada boolean not null default false,
  motivo text,
  created_at timestamptz not null default now(),
  check (
    fechada = true
    or (abertura is not null and fechamento is not null and fechamento > abertura)
  )
);

alter table public.loja_horario_excecao enable row level security;

-- Resolves effective operating hours for one date. Internal helper, not
-- anon-granted — always called from within an already-SECURITY DEFINER
-- Escala RPC (20260825_004), which is sufficient for it to read these
-- RLS-enabled/no-policy tables (same pattern hash_session_token already
-- uses from within verify_pin).
create or replace function public.loja_horario_do_dia(p_data date)
returns table (abertura time, fechamento time, fechada boolean)
language sql
stable
set search_path = public
as $$
  select
    coalesce(exc.abertura, pad.abertura) as abertura,
    coalesce(exc.fechamento, pad.fechamento) as fechamento,
    coalesce(exc.fechada, false) as fechada
  from (select p_data as d) base
  left join public.loja_horario_excecao exc on exc.data = base.d
  left join public.loja_horario_padrao pad on pad.dia_semana = extract(dow from base.d)::smallint;
$$;

revoke all on function public.loja_horario_do_dia(date) from public;

-- -----------------------------------------------------------------------------
-- Holidays. Foundation only: no admin-management RPC/UI in this milestone
-- (section 15 of the approved product direction) — future Admin holiday
-- management and employee-facing holiday context (Escala Hoje header) both
-- read from this same table once built.
-- -----------------------------------------------------------------------------
create table public.feriados (
  data date primary key,
  nome text not null,
  abrangencia text not null check (abrangencia in ('nacional', 'estadual', 'municipal')),
  created_at timestamptz not null default now()
);

alter table public.feriados enable row level security;

-- -----------------------------------------------------------------------------
-- Shift classification — pure derivation, no stored labels. Given the
-- employee's actual scheduled start/end time and that date's operating
-- hours, returns the section this shift belongs in. Approved business
-- rules (Blueprint section 16.2, Milestone 4C.1):
--   - MANHÃ:  starts at opening, leaves before closing;
--   - TARDE:  starts after opening, stays until closing;
--   - INTERMEDIÁRIO: neither of the above;
--   - single-shift day (one block spanning the whole operating window,
--     e.g. Sunday/holiday reduced hours): forced to TARDE, not treated as
--     "starts at opening AND stays until closing" falling through to
--     neither MANHÃ nor TARDE — this is an explicit override, checked
--     first, per the approved rule that a single working block is always
--     the TARDE section, never an empty MANHÃ paired with it.
-- Returns lowercase status codes ('manha' | 'tarde' | 'intermediario'),
-- matching this project's established status-enum convention (e.g.
-- atendimentos.status) — PT-BR accented display labels belong in the
-- frontend, not the database.
-- -----------------------------------------------------------------------------
create or replace function public.escala_classificar_turno(
  p_hora_inicio time,
  p_hora_fim time,
  p_abertura time,
  p_fechamento time
)
returns text
language sql
immutable
as $$
  select case
    when p_hora_inicio is null or p_hora_fim is null
      or p_abertura is null or p_fechamento is null then null
    when p_hora_inicio <= p_abertura and p_hora_fim >= p_fechamento then 'tarde'
    when p_hora_inicio <= p_abertura and p_hora_fim < p_fechamento then 'manha'
    when p_hora_inicio > p_abertura and p_hora_fim >= p_fechamento then 'tarde'
    else 'intermediario'
  end;
$$;

revoke all on function public.escala_classificar_turno(time, time, time, time) from public;

-- -----------------------------------------------------------------------------
-- Publication model. "Publishing a revised month replaces the previously
-- published version" is enforced structurally by the partial unique index
-- below (at most one ativa = true row per mes_referencia), while still
-- preserving every prior publication as ativa = false history — satisfying
-- "backend design should not unnecessarily prevent future audit/history"
-- without building any version-management UI now. The actual atomic
-- publish/replace operation (insert new row + flip the previous one to
-- ativa = false in one transaction) is intentionally NOT implemented as an
-- RPC in this migration — that belongs to the next Escala sub-milestone
-- (the structured import/publish step, Blueprint section 16.2) once the
-- Excel → structured-data conversion is designed. This migration only
-- guarantees the schema cannot end up with two simultaneously-active
-- publications for the same month, however that insert eventually happens.
-- -----------------------------------------------------------------------------
create table public.escala_publicacoes (
  id uuid primary key default gen_random_uuid(),
  mes_referencia date not null,
  publicado_em timestamptz not null default now(),
  publicado_por uuid not null references public.funcionarios(id),
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  check (mes_referencia = date_trunc('month', mes_referencia)::date)
);

alter table public.escala_publicacoes enable row level security;

create unique index escala_publicacoes_mes_ativa_key
  on public.escala_publicacoes (mes_referencia)
  where ativa;

create index escala_publicacoes_mes_referencia_idx
  on public.escala_publicacoes (mes_referencia);

-- -----------------------------------------------------------------------------
-- Schedule entries. One row per employee per working/absence day within a
-- publication. A missing (employee, date) combination — no row at all — is
-- the only representation of "A confirmar" (incomplete publication); it is
-- never written as a row with a null/placeholder status, and a missing
-- entry can never be confused with a genuine 'folga' row, which always
-- means an explicit, deliberately-published day off. This is what keeps
-- "blank must never silently mean FOLGA" true by construction rather than
-- by convention — see Blueprint section 16.2 for the full rule.
-- -----------------------------------------------------------------------------
create table public.escala_entradas (
  id uuid primary key default gen_random_uuid(),
  id_publicacao uuid not null references public.escala_publicacoes(id) on delete cascade,
  id_funcionario uuid not null references public.funcionarios(id),
  data date not null,
  status text not null check (status in ('trabalho', 'folga', 'ferias')),
  hora_inicio time,
  hora_fim time,
  created_at timestamptz not null default now(),
  check (
    (status = 'trabalho' and hora_inicio is not null and hora_fim is not null and hora_fim > hora_inicio)
    or (status <> 'trabalho' and hora_inicio is null and hora_fim is null)
  ),
  unique (id_publicacao, id_funcionario, data)
);

alter table public.escala_entradas enable row level security;

create index escala_entradas_funcionario_data_idx
  on public.escala_entradas (id_funcionario, data);

create index escala_entradas_data_idx
  on public.escala_entradas (data);

commit;
