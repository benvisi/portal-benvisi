# Schema fingerprint — read-only drift detector

Trello #34, Phase 2 (schema drift / reproducibility), Step 1. A deterministic,
read-only fingerprint of the Portal Benvisi database schema, plus an offline
comparison tool. It is the acceptance gate for any future reconstructed
environment (the planned `supabase/baseline/` + post-watermark migrations):
"production and the rebuilt database are equivalent" means **`compare.mjs`
reports EQUIVALENT**, not "it looks right".

It is also usable on its own as a periodic drift check: capture production
now, capture it again later, compare.

| File                                          | Purpose                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `schema-fingerprint.sql`                      | The fingerprint. One `SET LOCAL` + one `SELECT` over `pg_catalog`.                            |
| `compare.mjs`                                 | Offline comparison of two fingerprint outputs (Node, no dependencies, no DB access).          |
| `allowlist.tsv`                               | Explicit, exact-match list of tolerated differences, each with a reason. Ships **empty**.     |
| `test-compare.mjs`                            | Offline tests, incl. a parity check that the JS digests reproduce Postgres's digests exactly. |
| `reference/production-2026-10-03.digests.tsv` | Production reference fingerprint (digest level), see below.                                   |

## Safety

- **Read-only.** The SQL is a single `SELECT` over system catalogs. The only
  other statement, `SET LOCAL search_path TO pg_catalog`, lasts for that one
  transaction and changes nothing in the database.
- **No application data.** Only schema metadata. Function bodies and object
  comments are represented by md5 hashes, never by their text.
- **No secrets.** Nothing in the output is a credential. Connection details
  stay in `pgpass.conf` exactly as for `scripts/backup-prod/` — never put a
  password on the command line or in this directory.

## What is captured

Rows are `section <TAB> category <TAB> object_key <TAB> value`.

**`app` — Portal-owned state (all differences diverge unless allowlisted):**

| Category           | Key                                                | Value                                                                                                                                                                              |
| ------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extension`        | name (only `citext`, `pgcrypto`)                   | schema, version, member-object count                                                                                                                                               |
| `schema_acl`       | `public`                                           | grants to app roles                                                                                                                                                                |
| `table`            | table/view name                                    | kind, persistence, RLS enabled, RLS forced, partition flag, view definition hash                                                                                                   |
| `column`           | `table.column`                                     | ordinal position (among live columns), type, NOT NULL, default expression, identity, generated, non-default collation                                                              |
| `constraint`       | `table.constraint`                                 | type, validated flag, full definition (PK/FK/unique/check/exclusion)                                                                                                               |
| `index`            | index name (only indexes not backing a constraint) | valid flag, full definition                                                                                                                                                        |
| `sequence`         | name                                               | type, start, increment, min, max, cache, cycle, owning column (no current value)                                                                                                   |
| `type`             | name (enums, domains, standalone composites)       | definition                                                                                                                                                                         |
| `function`         | `name(identity args)`                              | kind, language, full argument list incl. defaults, result type, SECURITY DEFINER, volatility, strict, leakproof, parallel, `SET` config (e.g. `search_path`), normalized body hash |
| `function_execute` | `name(identity args)`                              | EXECUTE grants to app roles, or `(none)`                                                                                                                                           |
| `table_privilege`  | table/sequence name                                | privileges (incl. `MAINTAIN`) per app role, or `(none)`                                                                                                                            |
| `trigger`          | `table.trigger`                                    | enabled state, full definition                                                                                                                                                     |
| `event_trigger`    | name (any not listed as platform)                  | event, function, tags, enabled                                                                                                                                                     |
| `policy`           | `table.policy`                                     | permissive, command, roles, USING, WITH CHECK                                                                                                                                      |
| `default_acl`      | `postgres/<schema>/<objtype>`                      | default privileges for objects created by `postgres` (i.e. by migrations)                                                                                                          |

**`platform` — Supabase platform-managed state visible in this database.**
Compared exactly like `app` (differences need an allowlist entry), but kept
separate so it is clear what Portal owns and what Supabase owns:
non-Portal extensions, Supabase's event triggers, the `rls_auto_enable`
function behind Supabase's "auto-enable RLS" feature (which lives in
`public`), `supabase_admin` default ACLs, Postgres major version, and
`other_grantee` — every grant to a role that is not an app role, so no grant
is ever silently dropped.

**`info` — never fails a comparison:** exact (non-normalized) function source
hashes and object-comment hashes. Useful to notice cosmetic differences.

**`meta`** — format version and the effective `search_path`; validated, not
compared. **`~digest`** — md5 per `section.category` and per section.

### What decides app vs platform

Four short lists at the top of `schema-fingerprint.sql` are the only
classification rules: `app_roles` (anon, authenticated, service_role,
PUBLIC), `portal_extensions`, `platform_public_functions`,
`platform_event_triggers`. Anything not listed counts as **app** state, so an
unexpected object is never hidden by a broad exclusion.

### Deliberately ignored (normalization, not allowlisting)

- OIDs, owners, timestamps, statistics, storage parameters, sequence current
  values, and all table data.
- Grants to an object's own owner.
- Individual members of an extension (e.g. the citext functions in `public`):
  they are represented by the extension's row and its member count.
- Within function bodies: `\r`, `--` and `/* */` comments, and whitespace
  (collapsed, and removed next to `( ) , ;`). This is what lets a function
  whose comments were stripped when it was applied (as found in the Phase 2
  audit) compare equal to the commented original. The exact source hash is
  still reported under `info`.
- Tabs/newlines inside deparsed definitions are collapsed to a space (keeps
  the TSV format intact; applied identically on both sides).

Not covered at all (out of scope, consistent with the backup scope in
`scripts/backup-prod/README.md` §12): Supabase `auth`/`storage`/`realtime`/
`vault` schemas, publications, cron jobs, and any data, including reference
data.

## How to run

### Full fingerprint (recommended) — psql

Produces every row, which is what object-level comparison needs. The
always-on backup server already has the EDB PostgreSQL 17 client and a
`pgpass.conf` for production (see `scripts/backup-prod/README.md` §3):

```powershell
$env:PGPASSFILE = "C:\Users\joshua\PortalBenvisiSecrets\pgpass.conf"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -X -q -A -t -F "`t" `
  --single-transaction -v ON_ERROR_STOP=1 `
  -h aws-1-sa-east-1.pooler.supabase.com -p 5432 -d postgres `
  -U postgres.ugfogsseikupsfqqznzi `
  -f schema-fingerprint.sql -o production-YYYY-MM-DD.tsv
```

(bash: `-F $'\t'`.) The flags matter:

- `--single-transaction` is **required** — without it `SET LOCAL` has no
  effect, and `compare.mjs` rejects the output.
- `-A -t -F <tab>` gives plain tab-separated rows; `-q` suppresses the `SET`
  status line; `-X` ignores any `~/.psqlrc`.

For another target (a disposable rebuilt environment), change only host,
user and the matching `pgpass.conf` entry.

### Digest-level fingerprint — Supabase SQL editor (or any read-only SQL runner)

Paste `schema-fingerprint.sql`, then add
`where section in ('~digest', 'meta')` between the closing `) fingerprint`
line and the final `order by`. Run it, then save the rows as a 4-column TSV
file. The editor executes the script in one transaction, so `SET LOCAL`
works. A digest-level file tells you **which categories** differ, not which
objects.

## How to compare

```sh
node scripts/schema-fingerprint/compare.mjs <reference.tsv> <candidate.tsv>
node scripts/schema-fingerprint/compare.mjs --summary <fingerprint.tsv>
```

`compare.mjs` first validates each file: format version, `search_path` must
be `pg_catalog`, and in full files every embedded digest must match the rows
(so a truncated or hand-edited file is rejected rather than compared).

| Exit code                  | Meaning                                                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0` — `RESULT: EQUIVALENT` | No unallowlisted difference in `app` or `platform`. `info` differences and allowlisted differences may still be listed.                                                                                                 |
| `1` — `RESULT: DIVERGENT`  | At least one difference. Each is listed as `MISSING` (in reference only), `EXTRA` (in candidate only) or `CHANGED` (both values shown), per section. In digest-level mode, differing categories are listed as `DIGEST`. |
| `2` — `ERROR`              | Invalid input (wrong format version, wrong `search_path`, file inconsistent with its own digests, malformed allowlist).                                                                                                 |

Reading a divergent result: an `app` difference is a real schema difference
between the two databases and must be explained (wrong baseline, missing
migration, out-of-band change). A `platform` difference usually means the two
Supabase projects differ in platform-managed state (e.g. a newer extension
version); after review, record it in `allowlist.tsv` with a reason rather
than ignoring it. A stale allowlist entry (it matched nothing) should be
removed.

### Allowlist

`allowlist.tsv`: `section<TAB>category<TAB>object_key<TAB>reason`. Exact key
match only — no wildcards, no whole-category entries, reason mandatory,
`app`/`platform` sections only. It ships empty on purpose: entries are added
only after a real comparison shows a difference and someone has reviewed it.

## Production reference (2026-10-03)

`reference/production-2026-10-03.digests.tsv` — production
(`ugfogsseikupsfqqznzi`) at migration watermark `20260927_107`, i.e.
production history version `20260928020601`. Captured with read-only SQL
through the Supabase SQL runner (digest level: meta + 27 digest rows), so it
is used in digest-level comparisons. Checks performed:

- the full query ran three times; every category that the tool itself did
  not change between runs produced byte-identical digests, so the output is
  deterministic;
- the transcribed file was verified against production with a digest over
  all 27 digest rows (`a089ae7df29c45ed3ac1142091c1c87a`, computed both by
  Postgres and from the file);
- five categories also have their full rows embedded in
  `test-compare.mjs`, proving the JS and Postgres digests are byte-identical.

Counts at the watermark: app — 49 tables, 395 columns, 223 constraints, 47
standalone indexes, 4 sequences, 123 functions, 5 triggers, 0 policies, 0
types, 0 app event triggers, 53 table/sequence privilege rows, 3 default ACLs,
2 Portal extensions; platform — 5 extensions, 7 event triggers, 1 function
(`rls_auto_enable`), 3 `supabase_admin` default ACLs, 1 other grantee.

### Full object-level capture performed (2026-10-03)

A full fingerprint (1,201 lines: all `app`/`platform`/`info` detail rows,
`meta`, and the 27 `~digest` rows) was captured on the always-on backup
server with the `psql` command in "How to run" above, using the same
`pgpass.conf` the nightly backup already uses
(`production-fingerprint-20261003_183747.tsv`, 194,448 bytes). Validated
there before trusting it: psql exit 0, 0 malformed lines (every line has
exactly 4 tab-separated fields), exactly one `search_path=pg_catalog` row,
exactly one `format version=1` row, exactly 27 `~digest` rows.

Its `meta` and all 27 `~digest` rows were compared field-by-field against
`reference/production-2026-10-03.digests.tsv` (captured independently,
through the Supabase SQL editor) — **every value is byte-for-byte
identical**. This confirms: the `psql`/`--single-transaction` capture path
and the SQL-editor capture path produce the same result, production's
schema had not changed between the two captures, and a full object-level
capture of production is now proven to work end-to-end on the
infrastructure that will actually be used for it.

The full 1,201-line file itself was not committed — the 27-row digest file
above already serves as the lightweight reference, the full file is
reproducible on demand from this same command, and committing a full
object-level schema dump (every table/column/constraint/function signature)
to the public-facing repo was judged to add exposure without adding
capability. It stays on the server
(`C:\PortalBenvisi\SchemaFingerprint\output\`), alongside the nightly backup
artifacts, until it's needed for an actual object-level comparison (e.g.
against a rebuilt baseline environment in a later phase).

For object-level comparisons, capture a **full** production fingerprint with
the psql command above at the time of the comparison.

## Changing the tool

Any change to the output shape (new category, different value format) must
bump the `version` meta row in the SQL and `FORMAT_VERSION` in `compare.mjs`
together; `compare.mjs` refuses to compare files with a different version,
so a fresh reference must be captured afterwards. Keep the digest algorithm in
`compare.mjs` identical to the `digests` CTE (the parity tests enforce this).

```sh
node scripts/schema-fingerprint/test-compare.mjs
```
