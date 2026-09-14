begin;

-- =============================================================================
-- Escala Admin upload — dedicated spreadsheet-identity field (QA round 1 fix)
--
-- Reverses the original decision to match spreadsheet rows against
-- funcionarios.apelido directly. apelido is a display/nickname field —
-- coupling it to a machine-import identity means renaming someone's nickname
-- would silently break future Escala imports, and nothing guaranteed apelido
-- would stay a stable, workbook-safe token forever. escala_nome_planilha is
-- a dedicated, independently-editable field for exactly one purpose: the
-- canonical spreadsheet identity the importer matches against. It happens to
-- start equal to today's apelido (verified against the real September 2026
-- workbook — see the backfill below) but the two can now diverge safely.
--
-- citext (case-insensitive, same as apelido) so "AMANDA" in the sheet keeps
-- matching regardless of how it's capitalized. Nullable: an employee with no
-- spreadsheet identity configured simply can never be matched — if their row
-- in a workbook has real schedule data, that surfaces as the existing
-- FUNCIONARIO_NAO_MAPEADO block, exactly as it does for interpreting a
-- currently-unmapped name.
-- =============================================================================

alter table public.funcionarios
  add column escala_nome_planilha citext;

create unique index funcionarios_escala_nome_planilha_key
  on public.funcionarios (escala_nome_planilha)
  where escala_nome_planilha is not null;

-- Backfill for the 8 currently active, non-Administrador employees.
-- Verified directly against the real September 2026 workbook (both the
-- provisional tmp/ file and the final one referenced in this milestone's
-- discovery/QA) — every one of these names appears as an exact,
-- case-insensitive match with no surrounding whitespace.
update public.funcionarios set escala_nome_planilha = 'AMANDA' where apelido = 'Amanda';
update public.funcionarios set escala_nome_planilha = 'GRAÇA' where apelido = 'Graça';
update public.funcionarios set escala_nome_planilha = 'RENAN' where apelido = 'Renan';
update public.funcionarios set escala_nome_planilha = 'ELISIETH' where apelido = 'Elisieth';
update public.funcionarios set escala_nome_planilha = 'VITOR' where apelido = 'Vitor';
update public.funcionarios set escala_nome_planilha = 'DAYANNA' where apelido = 'Dayanna';
update public.funcionarios set escala_nome_planilha = 'SARA' where apelido = 'Sara';
update public.funcionarios set escala_nome_planilha = 'FAVACHO' where apelido = 'Favacho';

commit;
