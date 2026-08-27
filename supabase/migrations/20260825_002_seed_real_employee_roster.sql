begin;

-- =============================================================================
-- Escala V1 foundation (Milestone 4C.1) — real employee roster
--
-- Depends on 20260825_001 (funcionarios.aniversario_dia/aniversario_mes/
-- data_admissao/escala_grupo_gestao + widened cargo check) — apply that
-- migration first.
--
-- Inserts the 8 real active employees supplied by the product owner.
-- Existing development/test employees (Administrador/Gerente/Vendedor
-- fixtures) are left completely untouched — this migration only adds rows,
-- it never deletes or modifies any existing funcionarios row.
--
-- id: intentionally omitted from the insert column list — the column's own
-- default (gen_random_uuid(), matching every other Supabase-generated id in
-- this project) produces it. No UUID is invented here.
--
-- email: intentionally NULL for all eight rows — not yet supplied by the
-- product owner. Do not invent addresses.
--
-- nome: transcribed from the supplied "Nome completo" column in standard
-- Portuguese title case (matching normal name-writing convention and this
-- project's PT-BR employee-facing UI rule) rather than the source
-- spreadsheet's ALL CAPS formatting — funcionarios.nome is what the
-- Dashboard greeting displays verbatim, and the source list's own "Apelido"
-- column already establishes normal casing as the intended display form.
-- No name's meaning/spelling was altered, only capitalization.
--
-- cargo: DAYANNA MOTA CAVALVANTE is inserted as cargo = 'Vendedor' per the
-- product owner's explicit instruction, even though the historical
-- schedule workbook labels her as an operator/cashier in places — Portal
-- does not reproduce that old Excel classification.
--
-- token_pin: seeded as the approved provisional '1111' for every new
-- employee, consistent with this project's *current* plaintext-PIN
-- authentication architecture (see verify_pin,
-- 20260722_001_add_employee_sessions_and_verify_pin_token.sql). This is
-- not a new decision made here — it matches how every existing employee
-- row already authenticates. A future "Minha Conta / Alterar PIN" +
-- hashed-PIN milestone is documented in the Blueprint (section 16.2) and
-- explicitly NOT implemented by this migration.
--
-- Idempotency: this INSERT is guarded per-row by NOT EXISTS on nome, so
-- accidentally re-running this migration does not create duplicate
-- employee rows. Project convention still treats an already-applied
-- migration as immutable history — this guard is defense in depth, not a
-- substitute for that discipline.
-- =============================================================================

insert into public.funcionarios (
  nome,
  apelido,
  email,
  token_pin,
  cargo,
  is_active,
  aniversario_dia,
  aniversario_mes,
  data_admissao,
  escala_grupo_gestao
)
select v.nome, v.apelido, null, v.token_pin, v.cargo, true,
       v.aniversario_dia, v.aniversario_mes, v.data_admissao, v.escala_grupo_gestao
from (
  values
    ('Dayanna Mota Cavalvante', 'Dayanna', '1111', 'Vendedor', 7::smallint, 7::smallint, date '2024-03-04', false),
    ('Sara Santos da Silva', 'Sara', '1111', 'Caixa', 22::smallint, 9::smallint, date '2022-10-20', false),
    ('Amanda Pereira Chaves', 'Amanda', '1111', 'Vendedor', 7::smallint, 3::smallint, date '2021-07-06', false),
    ('Elisieth de Souza Viana', 'Elisieth', '1111', 'Vendedor', 15::smallint, 8::smallint, date '2010-01-09', false),
    ('Maria das Graças Conceição da Fonseca', 'Graça', '1111', 'Vendedor', 5::smallint, 3::smallint, date '2014-01-10', false),
    ('Renan Gentil de Souza', 'Renan', '1111', 'Vendedor', 31::smallint, 12::smallint, date '2021-08-10', false),
    ('Vitor Holanda Muniz de Lima', 'Vitor', '1111', 'Vendedor', 24::smallint, 9::smallint, date '2024-07-16', false),
    ('Wilson Monteiro Favacho', 'Favacho', '1111', 'Gerente', 26::smallint, 7::smallint, date '2024-01-11', true)
) as v(nome, apelido, token_pin, cargo, aniversario_dia, aniversario_mes, data_admissao, escala_grupo_gestao)
where not exists (
  select 1 from public.funcionarios f where f.nome = v.nome
);

commit;
