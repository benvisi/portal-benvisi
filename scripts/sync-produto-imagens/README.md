# Lacoste product-image worker (Trello #10)

Acquires and publishes Lacoste product images for Portal Benvisi's Consulta
de Estoque. Standalone nested npm project, deliberately isolated from the
Portal root dependency graph — `package.json` here is independent of the
repo root `package.json`, and none of this worker's dependencies are added
there.

## Why isolated

Playwright (bundles a full Chromium download), Sharp (per-platform native
bindings), and `@tensorflow/tfjs-node` (also native bindings) are heavy,
platform-specific, ops-only dependencies with no reason to exist in Portal's
browser bundle, Vercel build, or the root lockfile every contributor
installs. This repo's existing ops-script precedent
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

This imports every worker dependency (Playwright, Sharp, `tfjs-node` +
`coco-ssd`, the Anthropic SDK) and reports pass/fail per library, plus
confirms a Chromium browser binary is installed for Playwright. It makes
**no network calls** — no Lacoste navigation, no Anthropic API call, no
Supabase connection. See the script's own output for exact results on this
machine.

## Dependencies (current versions, pinned loosely via `^`)

| package | role | tier |
| --- | --- | --- |
| `playwright` | headed Chromium automation against lacoste.com.br | acquisition |
| `sharp` | image resize/optimize (webp) before publish | publish |
| `@tensorflow-models/coco-ssd` + `@tensorflow/tfjs-node` | local, offline person detection (Tier 1 candidate scoring — zero cost, zero external data) | scoring |
| `@anthropic-ai/sdk` | bounded vision calls for complete-vs-crop and front/back materiality judgments only (Tier 2 — the narrow cases Tier 1 and structured metadata can't answer) | scoring |

## What's next (not this slice)

Slice 1 adds the minimal Supabase schema (capability column,
`produto_imagem_execucoes`, `produto_imagem_candidatos` — no Storage, no
publish-side tables yet). Slice 2 is the real bounded-run acquisition
worker. See the project blueprint for the full slice sequence.
