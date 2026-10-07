# Portal Benvisi — clean-environment schema baseline

Trello #34, Phase 2, Step 2. Rebuilds the Portal Benvisi `public` schema
(plus the minimum reference/configuration data) in a **blank** Supabase
project from source control, without depending on the project's Lovable
history.

**This is not a migration.** It lives outside `supabase/migrations/` on
purpose and must never be applied to production, QA, or any database that
already has Portal objects. Production keeps its normal append-only
migration flow; this directory never touches it. For recovering
**data**, the nightly logical backup (`scripts/backup-prod/`) remains the
primary mechanism; this baseline is for schema reproducibility, clean
dev/test environments, and as a secondary recovery asset.

## Files

| File                    | Source                                       | Purpose                                                                                                                                                |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `00_prerequisites.sql`  | hand-written                                 | Guard; `citext` (in `public`) and `pgcrypto` (in `extensions`); `postgres` default privileges set to production's posture **before** any object exists |
| `10_schema_public.sql`  | generated from a production schema-only dump | All 49 tables, 124 functions, 47 standalone indexes, constraints/FKs, 4 sequences, 5 triggers, RLS, comments, and every object-level GRANT/REVOKE      |
| `20_reference_data.sql` | generated from a production data-only dump   | 460 rows of reference/configuration data in 8 tables (see below)                                                                                       |

## Watermark

|                                      |                                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Last migration represented           | `20260927_107_fix_estoque_cor_2r3_pink_mismatch.sql`                                                                                                                                                    |
| Production migration history         | max version `20260928020601`, 76 rows                                                                                                                                                                   |
| Production fingerprint at extraction | `app.*` count=1028 `4171b657ab421a414913f535308a00f3`; `platform.*` count=19 `b50998ca286430fdfed4d7c618cd2045` (identical to `scripts/schema-fingerprint/reference/production-2026-10-03.digests.tsv`) |

The fingerprint and the migration-history check were taken immediately
before the dumps, on the backup server, confirming production was still
exactly at this watermark.

### Migrations to apply after the baseline

Every file in `supabase/migrations/` whose name sorts **after**
`20260927_107_fix_estoque_cor_2r3_pink_mismatch.sql`, in sort order, each
applied separately (`psql -X -v ON_ERROR_STOP=1 -f <file>`; migration files
carry their own `begin;`/`commit;`, so do **not** use `--single-transaction`
for them).

- On `main` at the time of writing: **none**.
- Pending: the sales-metrics migrations `20261002_101` – `20261002_105`
  (branch `feature/sales-metrics-feed`, not yet in production). They belong
  **after** this watermark and are deliberately not folded into the
  baseline. Once merged and applied to production they fall under the rule
  above automatically.

The rebuilt project's `supabase_migrations.schema_migrations` table is not
populated by the baseline. Nothing reads it in this project's workflow and
it is not part of the schema fingerprint.

## Source artifacts (not committed)

Generated on the always-on backup server on 2026-10-07 14:05:49 with the
production `pgpass.conf` (read-only), kept outside the repo in
`C:\Users\benvi\PortalBenvisiQA\schema-exports\`:

| Artifact                                            | Bytes   | SHA-256                                                            |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| `portal_benvisi_schema_only_20261007_140549.sql`    | 360,399 | `9f21085352e3875068051f2f27b21a28513448e50104afa8d4bbed86b6a74e8a` |
| `portal_benvisi_reference_data_20261007_140549.sql` | 119,985 | `c65f83773c64652f6e9c82dc96f467d2f77bed93f501f111ae547dbbf5da220f` |

```powershell
pg_dump <prod conn> --schema-only --schema=public --no-owner -f portal_benvisi_schema_only_<ts>.sql
pg_dump <prod conn> --data-only --column-inserts --no-owner `
  --table=public.atendimento_motivos --table=public.atendimento_checklist_itens `
  --table=public.checklist_config --table=public.loja_horario_padrao `
  --table=public.contagem_embalagem_itens --table=public.estoque_cores_mapeamento `
  --table=public.limpeza_cargos_excluidos --table=public.estoque_organizacao_rotacao_estado `
  -f portal_benvisi_reference_data_<ts>.sql
```

## Transformations from the sources

Everything else is byte-identical to the dumps (after line-ending
normalization). Lines changed in `10`/`20` are commented out or edited in
place, never deleted, so `diff` against the source shows exactly these
changes. Each file also gets a header: `\set ON_ERROR_STOP on` plus a guard
block (see "Safety").

`10_schema_public.sql`:

1. **CRLF → LF.** The dump contains 713 CR bytes, all line terminators inside
   the bodies of 25 functions created in July/August from Windows-edited
   files. None is inside a string literal or quoted identifier (verified with
   a comment- and quote-aware scan), so this is semantically neutral; the
   repository's `.gitattributes` (`eol=lf`) would normalize them at commit
   anyway. The fingerprint ignores CR in function sources.
2. **`CREATE SCHEMA public;` commented out** — Supabase provisions the
   `public` schema; creating it again fails.
3. **12 `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin …` lines commented
   out** — platform-owned defaults the `postgres` role cannot set. The new
   project keeps its own (reported as `platform.default_acl` by the
   fingerprint).

Kept unchanged on purpose: pg_dump's `\restrict`/`\unrestrict` lines
(requires psql 17.6+), `COMMENT ON SCHEMA public`, all GRANT/REVOKE
statements (including the residual REFERENCES/TRIGGER/TRUNCATE/MAINTAIN
grants on older tables — reproducing production faithfully; privilege
hardening is a separate decision), the `postgres` default-ACL lines, and the
`atendimentos_pkey1` constraint name.

`20_reference_data.sql`:

4. **`checklist_config.atualizado_por` → `NULL`** — it held an employee id
   (FK to `funcionarios`); the baseline contains no employees.
5. **`estoque_organizacao_rotacao_estado.proximo_numero` 30 → 1** — the
   live shelf-rotation counter is operational state; 1 is the schema default
   and the original seed value. `ativo_a_partir = 2026-10-04` (activation
   date) is kept. The row itself must exist: the sync functions lock it.

## Reference/configuration data included

Only tables that migrations themselves seeded and that Portal functions
depend on to work in an otherwise empty instance:

| Table                                | Rows | Why                                                         |
| ------------------------------------ | ---- | ----------------------------------------------------------- |
| `atendimento_motivos`                | 10   | Outcome reasons; required (FK) to close an atendimento      |
| `atendimento_checklist_itens`        | 6    | Checklist definition (versions 1 and 2)                     |
| `checklist_config`                   | 1    | Checklist policy singleton (`defer_allowed`)                |
| `loja_horario_padrao`                | 7    | Standard store hours; used by escala/limpeza                |
| `contagem_embalagem_itens`           | 14   | Packaging catalog for contagem                              |
| `estoque_cores_mapeamento`           | 419  | Linx color code → Portal name mapping (incl. the `2R3` fix) |
| `limpeza_cargos_excluidos`           | 2    | Roles excluded from the cleaning rotation                   |
| `estoque_organizacao_rotacao_estado` | 1    | Rotation-state singleton (counter reset, see above)         |

**Excluded** (operational or personal): `funcionarios` and everything that
references employees — sessions, PINs, terms acceptance, attendance
(`turno_presenca`), lista da vez, atendimentos/checklists/pendências,
contagens, escala publications/entries, limpeza and estoque-organização
assignments, training content, search-term submissions — plus all
inventory/price/sync tables, holidays and store-hour exceptions (set
operationally, not seeded), and the unused legacy tables (schema only).

## Safety

- **Location:** outside `supabase/migrations/`; the Supabase CLI and the
  normal migration flow never read this directory.
- **psql only:** every file starts with `\set ON_ERROR_STOP on`, which psql
  honours regardless of command-line flags, so a guard failure stops the run.
  Any non-psql runner (e.g. the Supabase SQL editor) rejects that first line
  as a syntax error and executes nothing.
- **Guards** (each file checks state, so running any file on its own is
  also safe):
  - `00` and `10` refuse unless schema `public` contains **no tables**
    (true only in a blank project); `10` also requires `citext` from `00`.
  - `20` refuses unless the schema exists and `funcionarios` and all 8
    reference tables are empty.
- **Atomic:** run all three files in one `psql --single-transaction`
  invocation (below); any failure rolls back everything, including `00`.
- `citext` is created without `IF NOT EXISTS`: if it is already installed
  anywhere, the target is not the expected blank project and the run stops.

## Runbook (blank Supabase project only)

Requires psql **17.6 or newer** (the backup server's EDB 17.11 client is
fine) and a `pgpass.conf` entry for the **target** project. Run from this
directory:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -X -v ON_ERROR_STOP=1 --single-transaction `
  -h <target-host> -p 5432 -d postgres -U postgres.<target-project-ref> `
  -f 00_prerequisites.sql -f 10_schema_public.sql -f 20_reference_data.sql
```

Then apply any post-watermark migrations (see above).

**Restoring production data instead of reference data:** run only
`00_prerequisites.sql` and `10_schema_public.sql`, then load data from the
nightly dump. `20_reference_data.sql` would conflict with the real rows.

## Acceptance gate

A rebuild is accepted only when the committed fingerprint tooling
(`scripts/schema-fingerprint/`) reports it equivalent to production at the
**same watermark**: run `schema-fingerprint.sql` against the rebuilt project
(full `psql` capture, per that README), then

```sh
node scripts/schema-fingerprint/compare.mjs <production-full.tsv> <rebuilt-full.tsv>
```

All `app` categories must match. Expected `platform` differences, to be
reviewed and then recorded in `scripts/schema-fingerprint/allowlist.tsv`
with a reason (none is pre-allowlisted):

- `event_trigger.ensure_rls` — production's Supabase "auto-enable RLS"
  event trigger is not created by the baseline. The `rls_auto_enable()`
  function it calls **is** in `10_schema_public.sql` (inert without the
  trigger). If the new project already has that feature enabled when the
  baseline runs, `CREATE FUNCTION public.rls_auto_enable` fails and the whole
  run rolls back — create the project without it, run the baseline, then
  decide whether to enable it.
- `extension.*` (pg_stat_statements, supabase_vault, uuid-ossp, wrappers,
  plpgsql) — set and versions depend on the project's creation date.
- `default_acl.supabase_admin/*` — may differ on projects created after
  Supabase's 2026-10-30 default-grant change.
- `server.postgres_major_version` — create the test project on the same
  major as production (17), otherwise deparsed definitions may also differ.

An `app.extension` version difference for `citext`/`pgcrypto` would need
review rather than automatic acceptance.

## Verified reconstruction (2026-10-07)

The acceptance gate above was run for real, once, against a disposable,
blank Supabase project created solely for this test (never QA, never
production): `00_prerequisites.sql`, `10_schema_public.sql`, and
`20_reference_data.sql` executed successfully in a single
`psql --single-transaction` run, with immediate structural/reference-data
checks (table/function/RLS counts, `citext`/`pgcrypto` locations, all 8
reference-table row counts, zero `funcionarios` rows) all passing.

Full object-level fingerprint comparison (`compare.mjs`, default empty
allowlist — no entries used, nothing hidden):

- **`app.*`**: production count=1028, digest `4171b657ab421a414913f535308a00f3`;
  rebuild count=1028, **same digest**. **0 app divergences** — every table,
  column, constraint, index, sequence, function (incl. exact source and
  normalized body hash), function grant, table privilege, trigger, policy,
  and default ACL reconstructed identically.
- **`platform.*`**: 2 differences, both the rebuilt project _missing_
  something production has, neither reproducible by (or required of) this
  baseline:
  - `event_trigger.ensure_rls` — Supabase's project-level "auto-enable RLS"
    setting; the `rls_auto_enable()` function it would call is present and
    matched exactly, only the platform event trigger wiring it up is a
    per-project toggle, not a schema object any migration created.
  - `extension.wrappers` — a Supabase-provisioned extension depending on the
    target project's own setup; no Portal function references it.

Both are classified as Supabase-managed/project-provisioning differences,
outside this baseline's application-schema responsibility, and are left
**unallowlisted on purpose** so future comparisons keep surfacing any
platform drift explicitly rather than silently accepting it.

This stands as the reconstruction proof for Trello #34, Phase 2: the
`public` schema and its required reference data are reproducible from
`supabase/baseline/` alone, independent of the project's original Lovable
history.

## Refreshing the baseline

Take new dumps with the two commands above at a new watermark (verify the
production fingerprint and migration history first), re-apply
transformations 1–5, update the watermark, source hashes and counts here,
and re-run the acceptance gate. The post-watermark migration rule then moves
forward with the new watermark.
