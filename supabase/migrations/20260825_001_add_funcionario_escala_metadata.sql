begin;

-- =============================================================================
-- Escala V1 foundation (Milestone 4C.1) — funcionarios metadata + cargo
-- constraint widening
--
-- Adds the smallest durable funcionarios columns needed for Escala V1:
--   - aniversario_dia / aniversario_mes (birthday celebrations — day/month
--     only, no year: the product requirement explicitly excludes age/birth
--     year from Portal's data model);
--   - data_admissao (work-anniversary celebrations — "X anos de Benvisi" is
--     always derived from this date, never stored redundantly);
--   - escala_grupo_gestao (Gestão schedule-block membership — see below).
--
-- Also widens the (previously unconstrained, per the audit trail in
-- 20260824_001) cargo column to a proper CHECK constraint that includes the
-- new 'Caixa' cargo required by the real employee roster (20260825_002).
--
-- Gestão modeling decision (documented per product requirement):
-- escala_grupo_gestao is a schedule-membership flag, deliberately separate
-- from `cargo`. Two distinct concerns exist here and must not be conflated:
--   1. MEMBERSHIP — which employees are scheduled as part of the Gestão
--      block (today: only Favacho, cargo = 'Gerente'). This is what
--      escala_grupo_gestao represents. cargo = 'Gerente' is not used
--      directly for this because a future Gestão group may include more
--      than one employee, possibly with different cargos (e.g. a future
--      Supervisor role) — coupling schedule membership to a specific job
--      title would break the moment that stops being 1:1.
--   2. VISIBILITY — who is *allowed to view* the Gestão block. This is
--      never stored: it is a server-side rule (cargo = 'Administrador' OR
--      escala_grupo_gestao = true) computed at query time inside the
--      Escala read RPCs (20260825_004), consistent with "authorization
--      must remain server-owned" and avoiding a second flag that could
--      drift out of sync with the first. Administrador is not itself a
--      Gestão *member* (mirrors the existing precedent that Administrador
--      never personally participates in Lista da Vez/Atendimento — see
--      20260823_002) — Administrador only *views* the block.
-- =============================================================================

alter table public.funcionarios
  add column if not exists aniversario_dia smallint,
  add column if not exists aniversario_mes smallint,
  add column if not exists data_admissao date,
  add column if not exists escala_grupo_gestao boolean not null default false;

-- Both-or-neither, and a day valid for the given month (without needing a
-- birth year — Fev is capped at 29 so a leap-year-only date is still
-- accepted; there is no way to fully validate Feb 29 without a year, and
-- that imprecision is accepted here rather than storing one).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.funcionarios'::regclass
      and conname = 'funcionarios_aniversario_check'
  ) then
    alter table public.funcionarios
      add constraint funcionarios_aniversario_check
      check (
        (aniversario_dia is null) = (aniversario_mes is null)
        and (
          aniversario_mes is null
          or aniversario_dia between 1 and (case aniversario_mes
            when 2 then 29
            when 4 then 30
            when 6 then 30
            when 9 then 30
            when 11 then 30
            else 31
          end)
        )
        and (aniversario_mes is null or aniversario_mes between 1 and 12)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- cargo: widen to an explicit CHECK constraint that includes 'Caixa'.
--
-- No cargo CHECK constraint exists anywhere in tracked migration history
-- (confirmed again here, dynamically, rather than assumed) — this was
-- previously flagged as a real gap (20260824_001's audit note). Detected
-- dynamically by inspecting pg_constraint rather than guessing a name, so
-- this migration is safe whether or not a constraint already exists under
-- an unknown name.
--
-- Adding a new cargo later (per section 2.3's anticipated future roles)
-- requires its own additive migration widening this same constraint —
-- documented here so a future implementer knows the pattern to follow.
-- ---------------------------------------------------------------------------
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'funcionarios'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%cargo%'
  loop
    execute format('alter table public.funcionarios drop constraint %I', v_constraint.conname);
  end loop;
end $$;

alter table public.funcionarios
  add constraint funcionarios_cargo_check
  check (cargo in ('Vendedor', 'Caixa', 'Gerente', 'Administrador'));

commit;
