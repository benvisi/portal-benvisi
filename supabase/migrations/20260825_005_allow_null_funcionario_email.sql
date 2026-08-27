begin;

-- =============================================================================
-- Escala V1 foundation (Milestone 4C.1) — correction: allow null email
--
-- Finding: applying 20260825_002_seed_real_employee_roster.sql failed with
--   ERROR: 23502: null value in column "email" of relation "funcionarios"
--   violates not-null constraint
-- funcionarios.email carries a NOT NULL constraint that is not visible
-- anywhere in tracked migration history (the table predates migration
-- tracking, same gap already documented for the cargo column in
-- 20260824_001/20260825_001) — this is the first time it was possible to
-- observe it directly, via this apply-time error.
--
-- The product owner does not yet have real email addresses for the new
-- roster and was explicitly instructed not to invent them ("use NULL where
-- appropriate rather than inventing email addresses" — Milestone 4C.1
-- scope). NULL is therefore the only correct value here; the schema must
-- accommodate it, not the other way around.
--
-- Because 20260825_002's INSERT failed inside its own transaction, it was
-- never partially applied (Postgres rolls back an entire failed INSERT
-- statement, not just the offending row) — zero rows were written. That
-- file itself needs no changes and should simply be re-run, unmodified,
-- after this migration. This migration only widens the email column.
--
-- ALTER COLUMN ... DROP NOT NULL is a no-op if the column is already
-- nullable, so this is safe to apply even if re-run.
-- =============================================================================

alter table public.funcionarios
  alter column email drop not null;

commit;
