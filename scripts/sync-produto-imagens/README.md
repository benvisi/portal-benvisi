# Lacoste product-image worker (Trello #10)

Acquires and publishes Lacoste product images for Portal Benvisi's Consulta
de Estoque. Standalone nested npm project, deliberately isolated from the
Portal root dependency graph — `package.json` here is independent of the
repo root `package.json`, and none of this worker's dependencies are added
there.

## Why isolated

Playwright (bundles a full Chromium download) and Sharp (per-platform
native bindings) are heavy, platform-specific, ops-only dependencies with no
reason to exist in Portal's browser bundle, Vercel build, or the root
lockfile every contributor installs. This repo's existing ops-script
precedent
([`scripts/sync-estoque`](../sync-estoque)) puts its one dependency
(`mssql`) in the root `package.json` as a devDependency — acceptable for a
slim SQL driver, not for this set. This worker gets its own `node_modules`
instead.

## Why headed Chromium, why Windows

Lacoste's site (and its image CDN) sits behind Akamai Bot Manager. Across
this engagement's discovery POCs: plain HTTP, the default Playwright
headless shell, and both `channel: 'chromium'` and `channel: 'chrome'`
headless modes were all confirmed blocked (some only after initially
working, then regressing mid-session — see project history). **Headed
Chromium (`headless: false`) is the only mode proven reliable**, which
means this worker needs to render into an active, logged-in Windows desktop
session — it cannot run as a typical unattended background/SYSTEM service
today. The exact deployment/scheduling answer for that constraint is a
separate decision, not resolved by this slice.

## What this slice is

Foundation only: the nested project, its dependencies, and a dependency
health-check script that validates each library loads/imports correctly in
this environment. No Lacoste acquisition, no AI calls, no Supabase access,
no Storage, no Portal UI changes.

## Setup

```sh
cd scripts/sync-produto-imagens
npm install
cp .env.example .env
# .env is not required to pass `npm run check` in this slice — it exists
# now so later slices don't need a setup-order change.
```

## Validate the dependency foundation

```sh
npm run check
```

This imports every worker dependency (Playwright, Sharp, the Anthropic SDK)
and reports pass/fail per library, plus confirms a Chromium browser binary
is installed for Playwright. It makes **no network calls** — no Lacoste
navigation, no Anthropic API call, no Supabase connection. See the script's
own output for exact results on this machine.

## Dependencies (current versions, pinned loosely via `^`)

| package | role | tier |
| --- | --- | --- |
| `playwright` | headed Chromium automation against lacoste.com.br | acquisition |
| `sharp` | image resize/optimize (webp) before publish | publish |
| `@anthropic-ai/sdk` | bounded vision calls for ALL candidate visual judgments structured metadata can't answer — person/model present, complete-vs-crop, likely front/back/other view, and whether a plausible secondary view is materially useful — advisory candidate scoring only, never auto-publishing | scoring |

A local TensorFlow (`tfjs-node` + `coco-ssd`) person-detection tier was
evaluated and dropped before this dependency set was finalized: `tfjs-node`
requires a native build toolchain (Visual Studio "Desktop development with
C++") that isn't present on the target Windows worker machine, and
installing it was explicitly ruled out rather than pursued. The bounded
Anthropic vision step now covers person/model detection too, not just the
front/back materiality judgment it was always going to handle — still
advisory-only, still gated by mandatory human approval.

## Slice 2 — bounded deterministic acquisition worker

```sh
npm run acquire -- --produtos=46SMA0045BR:02H,FH2349-23:02S,NF2142AA:A91 --dry-run
```

- `--produtos=REF:COR,REF:COR,...` — explicit bounded input. This slice has
  **no full-catalog path**: omitting `--produtos` is a usage error, not a
  silent whole-catalog scan.
- `--limit N` — caps how many parsed `--produtos` items are processed
  (default hard cap: 5, applied even without `--limit`).
- `--dry-run` — performs real acquisition/verification against Lacoste but
  skips all Supabase writes (no `produto_imagem_execucoes` row, no
  `produto_imagem_candidatos` row).

### How resolution works

One headed Chromium page visits the BRECOM homepage once per run to
establish an Akamai-trusted session, then every `PRODUTO:COR` is resolved
via the same-origin `Product-PartialsData` endpoint, called with `fetch()`
from that page's JS context — never via `page.goto()` to the endpoint
itself (confirmed: direct top-level navigation to
`/on/demandware.store/...` controller URLs gets silently bounced back to
the homepage; in-page `fetch()` from an already-trusted session does not
have this problem, and no per-item page navigation is needed at all — the
same homepage-established session serves every item's `fetch()` call).

**Confirmed, load-bearing fact:** an invalid/unavailable color on a valid
master PID does **not** error. The endpoint silently falls back to a
default color variant and still returns HTTP 200 with a fully-formed
`product` object whose `color.id` differs from what was requested. HTTP
200 is therefore never sufficient — `product.masterProductId` and
`product.color.id` are checked exactly against the request on every call.
See `src/lacoste.mjs` for the full `EXACT_MATCH` /
`PRODUCT_FOUND_COLOR_NOT_FOUND` / `AMBIGUOUS` / `NOT_FOUND` classification.

Gallery images of `type: "look"` (styling/outfit shots) are excluded
before any row is written — only `type: "image"` entries reach
`gallery_json`.

### What this slice does not do

No AI/vision calls, no primary/secondary candidate selection, no image
downloads/Storage, no `produto_imagem_publicadas`, no approval/rejection
RPCs. Those are later slices.

## Slice 4B — human approval and publication

Approval and publication are separate stages with separate actors:

1. **Approval (employee, browser).** `aprovar_candidato_imagem(token, candidato, indice_principal, indice_secundaria?, observacao?, confirmar_divergencia?)`
   and `rejeitar_candidato_imagem(token, candidato, observacao)`. The reviewer
   comes only from the session token and must have
   `funcionarios.pode_gerenciar_imagens_produto`. Indices refer to the stored
   gallery and may differ from the AI recommendation. Choosing an image the AI
   flagged (person / not product-only) needs `confirmar_divergencia = true`
   and a note. `scoring_notes.human_reviewed` is never read.
   Approval creates a `pendente` publication with DB-assigned immutable paths:
   `{produto}/{cor}/{publicacao_id}/{principal|secundaria}.webp`.
2. **Publication (this worker, service_role).**

   ```bash
   npm run publicar                  # dry-run: list + validate, no writes
   npm run publicar -- --persist     # download, convert, upload, activate
   npm run publicar -- --persist --limit=3
   ```

   Each approved image is fetched through the headed browser, converted to
   WebP (longest edge 1200 px, quality 82) and uploaded to the public bucket
   `produto-imagens-publicadas` with `upsert: false`. The set goes live in one
   transaction (`ativar_publicacao_imagem`), superseding the previous set for
   that product/colour.

**Integrity.** The approved URL must carry Salesforce Commerce Cloud's
content-version token (`/dw<hex>/`) and the approved colour code in its file
name, so the published bytes are the asset version the reviewer saw. Source
and WebP SHA-256 are recorded per file.

**Retries.** Files already recorded are skipped. An object that already exists
is accepted only if byte-identical (crash after upload); otherwise the run
refuses and never overwrites. Failures increment `tentativas`/`ultimo_erro`
and the set stays `pendente` for the next run.

**Revocation / replacement.** `revogar_publicacao_imagem(token, publicacao, motivo)`
hides a set from Consulta immediately. A newer approval replaces the active
set only when it is activated. Rows are never deleted.

**Manual cleanup (~30 days).** Superseded/revoked/cancelled files stay in the
bucket. Paths eligible for manual deletion:

```sql
select a.storage_path, p.status, p.encerrado_em
  from produto_imagem_publicacoes p
  join produto_imagem_publicacao_arquivos a on a.publicacao_id = p.id
 where p.status in ('substituida', 'revogada', 'cancelada')
   and a.enviado_em is not null
   and p.encerrado_em < now() - interval '30 days'
 order by p.encerrado_em;
```

**Reviewer previews.** Lacoste CDN gallery URLs load directly in a normal
browser `<img>` (verified from a cookieless browser on a foreign origin), so
the review UI can show them without storing unapproved images anywhere.
