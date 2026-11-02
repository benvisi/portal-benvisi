#!/usr/bin/env node
// =============================================================================
// Schema fingerprint — offline tests for compare.mjs
//
//   node scripts/schema-fingerprint/test-compare.mjs
//
// No database connection. Includes a cross-implementation parity check: real
// rows and the md5 digests that Postgres computed for them (production,
// 2026-10-03, via schema-fingerprint.sql) must be reproduced exactly by the
// JavaScript digest code, otherwise compare.mjs would report false
// divergences or miss real ones.
// =============================================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareDigests,
  compareFull,
  computeDigests,
  parseAllowlist,
  parseFingerprint,
  validateFingerprint,
} from "./compare.mjs";

let failures = 0;
let passed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function expectThrow(name, fn, pattern) {
  try {
    fn();
    check(name, false, "did not throw");
  } catch (e) {
    check(name, pattern.test(e.message), e.message);
  }
}

const META = ["meta\tformat\tversion\t1", "meta\tsetting\tsearch_path\tpg_catalog"];

// Builds a complete fingerprint TSV (meta + detail + embedded digests).
function fingerprintText(detailLines) {
  const rows = parseFingerprint(detailLines.join("\n"));
  const digests = computeDigests(rows);
  const digestLines = [...digests].map(([k, d]) => `~digest\t${k}\tcount=${d.count}\t${d.md5}`);
  return [...META, ...detailLines, ...digestLines].join("\n");
}

// ---------------------------------------------------------------------------
console.log("cross-implementation parity (Postgres digests from production)");
{
  const fixtures = [
    {
      category: "app.sequence",
      md5: "c50b3f389a89e3e1488668ced1e4a924",
      lines: [
        "app\tsequence\tchecklist_policy_eventos_id_seq\ttype=bigint | start=1 | increment=1 | min=1 | max=9223372036854775807 | cache=1 | cycle=false | owned_by=checklist_policy_eventos.id (identity)",
        "app\tsequence\tlista_vez_eventos_id_seq\ttype=bigint | start=1 | increment=1 | min=1 | max=9223372036854775807 | cache=1 | cycle=false | owned_by=lista_vez_eventos.id (identity)",
        "app\tsequence\tlista_vez_fila_id_seq\ttype=bigint | start=1 | increment=1 | min=1 | max=9223372036854775807 | cache=1 | cycle=false | owned_by=lista_vez_fila.id (identity)",
        "app\tsequence\tlista_vez_posicao_seq\ttype=bigint | start=1 | increment=1 | min=1 | max=9223372036854775807 | cache=1 | cycle=false | owned_by=",
      ],
    },
    {
      category: "app.default_acl",
      md5: "5e422359c14b17dae39b43f5b1435e74",
      lines: [
        "app\tdefault_acl\tpostgres/public/functions\t(none)",
        "app\tdefault_acl\tpostgres/public/sequences\t(none)",
        "app\tdefault_acl\tpostgres/public/tables\t(none)",
      ],
    },
    {
      category: "app.extension",
      md5: "c656aae9a7860865dee277c28e5718ee",
      lines: [
        "app\textension\tcitext\tschema=public | version=1.6 | members=89",
        "app\textension\tpgcrypto\tschema=extensions | version=1.3 | members=36",
      ],
    },
    {
      category: "app.schema_acl",
      md5: "e6e07ada020138f766cb6c8e135de0f8",
      lines: [
        "app\tschema_acl\tpublic\tPUBLIC=USAGE;anon=USAGE;authenticated=USAGE;service_role=USAGE",
      ],
    },
    {
      category: "platform.other_grantee",
      md5: "f5d4894c5c8a28fbc77c1934401f10dc",
      lines: ["platform\tother_grantee\tschema:public:postgres\tUSAGE"],
    },
  ];
  for (const fx of fixtures) {
    // Shuffle input order: the digest must not depend on row order.
    const rows = parseFingerprint([...fx.lines].reverse().join("\n"));
    const d = computeDigests(rows).get(fx.category);
    check(`${fx.category} digest matches Postgres`, d?.md5 === fx.md5, `${d?.md5} vs ${fx.md5}`);
    check(`${fx.category} count matches`, d?.count === fx.lines.length);
  }
  const emptyRows = parseFingerprint(META.join("\n"));
  const d = compareDigests(
    new Map([["app.policy", { count: 0, md5: "d41d8cd98f00b204e9800998ecf8427e" }]]),
    computeDigests(emptyRows),
  );
  check("empty category equals Postgres md5('') with count=0", d.divergent.length === 0);
}

// ---------------------------------------------------------------------------
console.log("parseFingerprint / validateFingerprint");
{
  const text = fingerprintText(["app\ttable\tt1\tkind=r | rls=true"]);
  const crlf = text.replace(/\n/g, "\r\n");
  const rows = parseFingerprint(crlf);
  check("CRLF input parses", rows.length === parseFingerprint(text).length);
  check("valid full fingerprint validates", validateFingerprint(rows).mode === "full");

  expectThrow(
    "rejects a line with the wrong number of fields",
    () => parseFingerprint("app\ttable\tt1"),
    /expected 4 tab-separated fields/,
  );
  expectThrow(
    "rejects output generated with the wrong search_path",
    () =>
      validateFingerprint(
        parseFingerprint(text.replace("search_path\tpg_catalog", 'search_path\t"$user", public')),
      ),
    /SET LOCAL did not take effect/,
  );
  expectThrow(
    "rejects an unknown format version",
    () => validateFingerprint(parseFingerprint(text.replace("version\t1", "version\t2"))),
    /format version/,
  );
  expectThrow(
    "detects detail rows edited after generation (embedded digest mismatch)",
    () => validateFingerprint(parseFingerprint(text.replace("rls=true", "rls=false"))),
    /does not match its detail rows/,
  );
  const digestOnly = [
    ...META,
    "~digest\tapp.table\tcount=1\t0123456789abcdef0123456789abcdef",
  ].join("\n");
  check(
    "digest-only file is recognised",
    validateFingerprint(parseFingerprint(digestOnly)).mode === "digest-only",
  );
}

// ---------------------------------------------------------------------------
console.log("compareFull");
{
  const base = [
    "app\ttable\tt1\tkind=r | rls=true",
    "app\tcolumn\tt1.id\tpos=1 | type=uuid",
    "app\tfunction\tf()\tsecdef=true | body_norm_md5=aaa",
    "platform\textension\twrappers\tschema=extensions | version=0.6.2 | members=69",
    "info\tfunction_source_exact\tf()\texact1",
  ];
  const ref = parseFingerprint(fingerprintText(base));

  const same = compareFull(ref, parseFingerprint(fingerprintText([...base].reverse())));
  check("identical schemas (any row order) -> no divergence", same.divergent.length === 0);

  const changed = [
    "app\ttable\tt1\tkind=r | rls=false", // CHANGED
    // t1.id column MISSING
    "app\tcolumn\tt1.extra\tpos=2 | type=text", // EXTRA
    "app\tfunction\tf()\tsecdef=true | body_norm_md5=aaa",
    "platform\textension\twrappers\tschema=extensions | version=0.7.0 | members=69", // CHANGED
    "info\tfunction_source_exact\tf()\texact2", // info only
  ];
  const r = compareFull(ref, parseFingerprint(fingerprintText(changed)));
  const kinds = (k) => r.divergent.filter((d) => d.kind === k).map((d) => d.object_key);
  check("detects CHANGED app row", kinds("CHANGED").includes("t1"));
  check("detects MISSING row", kinds("MISSING").includes("t1.id"));
  check("detects EXTRA row", kinds("EXTRA").includes("t1.extra"));
  check("platform differences also diverge by default", kinds("CHANGED").includes("wrappers"));
  check(
    "info differences never diverge",
    r.info.length === 1 && !r.divergent.some((d) => d.section === "info"),
  );

  const allow = parseAllowlist(
    [
      "platform\textension\twrappers\tSupabase-managed version differs",
      "app\tindex\tnot_present_idx\tstale example",
    ].join("\n"),
  );
  const ra = compareFull(ref, parseFingerprint(fingerprintText(changed)), allow);
  check(
    "allowlisted exact key is accepted, not divergent",
    ra.allowed.some((d) => d.object_key === "wrappers") &&
      !ra.divergent.some((d) => d.object_key === "wrappers"),
  );
  check("non-allowlisted differences still diverge", ra.divergent.length === 3);
  check(
    "unused allowlist entry is reported as stale",
    ra.staleAllowlist.length === 1 && ra.staleAllowlist[0].object_key === "not_present_idx",
  );
}

// ---------------------------------------------------------------------------
console.log("parseAllowlist");
{
  expectThrow(
    "rejects an entry without a reason",
    () => parseAllowlist("platform\textension\twrappers"),
    /4 non-empty/,
  );
  expectThrow(
    "rejects allowlisting the info section",
    () => parseAllowlist("info\tcomment\tx\treason"),
    /section must be one of/,
  );
  expectThrow(
    "rejects duplicate entries",
    () => parseAllowlist("app\tindex\ti\tr1\napp\tindex\ti\tr2"),
    /duplicate entry/,
  );
  const here = dirname(fileURLToPath(import.meta.url));
  const shipped = parseAllowlist(readFileSync(join(here, "allowlist.tsv"), "utf8"));
  check("shipped allowlist.tsv parses and has no active entries", shipped.size === 0);
}

// ---------------------------------------------------------------------------
console.log("compareDigests");
{
  const a = new Map([
    ["app.table", { count: 49, md5: "x" }],
    ["app.index", { count: 47, md5: "y" }],
    ["info.comment", { count: 1, md5: "z" }],
  ]);
  const b = new Map([
    ["app.table", { count: 49, md5: "x" }],
    ["app.index", { count: 46, md5: "w" }],
    ["info.comment", { count: 2, md5: "q" }],
  ]);
  const r = compareDigests(a, b);
  check("unchanged category not reported", !r.divergent.some((d) => d.category === "table"));
  check(
    "changed category reported",
    r.divergent.some((d) => d.category === "index"),
  );
  check("info category difference is informational", r.info.length === 1);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
