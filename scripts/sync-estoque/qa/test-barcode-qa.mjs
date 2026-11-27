#!/usr/bin/env node
// =============================================================================
// Barcode Slice 1 — QA integration test (QA Supabase project ONLY).
//
// Drives the REAL sync orchestration (runReal / runDryRun from
// sync-estoque.mjs) against the QA database, with fixture rows standing in for
// Linx, through a psql-backed client acting as service_role. Then checks the
// lookup RPC, sessions and grants with plain SQL.
//
// DESTRUCTIVE ON THE TARGET: it resets the estoque inventory/price/barcode
// current-state tables before running. It refuses to run unless the connected
// server's system_identifier equals QA_EXPECTED_SYSTEM_IDENTIFIER, and it
// requires the synthetic QA employee "QA Teste Vendedor".
//
//   QA_PSQL=<path to psql.exe> QA_EXPECTED_SYSTEM_IDENTIFIER=<id> \
//   PGHOST=... PGUSER=... PGPASSFILE=... PGSSLMODE=verify-full PGSSLROOTCERT=... \
//   node scripts/sync-estoque/qa/test-barcode-qa.mjs
//
// See scripts/sync-estoque/README.md ("Barcode QA tests").
// =============================================================================

import process from "node:process";
import { runDryRun, runReal } from "../sync-estoque.mjs";
import { weeklyBarcodeBoundary } from "../estoque-barcode-diff.mjs";
import { createPsqlSupabaseClient, runPsql } from "./psql-supabase-client.mjs";

const PSQL = process.env.QA_PSQL;
const EXPECTED_ID = process.env.QA_EXPECTED_SYSTEM_IDENTIFIER;
const VERBOSE = process.env.QA_VERBOSE === "1";
const PRODUCTION_SYSTEM_IDENTIFIER = "7656983981618135123";

if (!PSQL || !EXPECTED_ID) {
  console.error("QA_PSQL and QA_EXPECTED_SYSTEM_IDENTIFIER are required.");
  process.exit(2);
}
if (EXPECTED_ID === PRODUCTION_SYSTEM_IDENTIFIER) {
  console.error("Refusing: the expected identifier is PRODUCTION's.");
  process.exit(2);
}

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

/** Runs SQL returning one json value (as postgres unless a role is given). */
async function q(sqlText, role = null) {
  const { code, out, err } = await runPsql(PSQL, sqlText, { role });
  if (code !== 0) throw new Error(`SQL failed: ${err.trim()}`);
  const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
  return line === undefined ? null : JSON.parse(line);
}

/** Like q, but resolves to the error message instead of throwing. */
async function qErr(sqlText, role = null) {
  const { code, err } = await runPsql(PSQL, sqlText, { role });
  return code === 0 ? null : err.trim();
}

// -----------------------------------------------------------------------------
// Fixture "Linx"
// -----------------------------------------------------------------------------
const PRODUTOS = {
  "QA-TESTE-001": { desc: "POLO TESTE QA", grade: "QA-PMG", sizes: ["P", "M", "G"] },
  "QA-TESTE-002": { desc: "BERMUDA TESTE QA", grade: "QA-NUM", sizes: ["38", "40", "42"] },
  "QA-TESTE-003": { desc: "BONE TESTE QA", grade: "QA-PMG", sizes: ["P", "M", "G"] },
  "QA-TESTE-004": { desc: "CAMISETA TESTE QA", grade: "QA-PMG", sizes: ["P", "M", "G"] },
};
const COR_DESC = { "001": "BLANC", "003": "NAVY", "1HY": "VERT", "2ZZ": "ROUGE" };
const PRECOS = { "QA-TESTE-001": 399.9, "QA-TESTE-002": 299.9, "QA-TESTE-004": 199.9 };

const fixture = {
  // produto|cor -> quantities per size key 1..3 (only colours with stock exist in Linx inventory)
  estoque: new Map([
    ["QA-TESTE-001|001", [2, 0, 1]],
    ["QA-TESTE-001|003", [0, 3, 0]],
    ["QA-TESTE-002|001", [1, 0, 0]],
  ]),
  // codigo_barra -> [produto, cor, tamanho_key] (+ optional label override)
  barras: [],
  failBarcodeExtraction: false,
  barcodeExtractions: 0,
};

const B = (codigo, produto, cor, key, label) => ({ codigo, produto, cor, key, label });
fixture.barras = [
  B("0007890000011", "QA-TESTE-001", "001", 1), // P, stock 2
  B("7890000011", "QA-TESTE-001", "001", 1), // alias of the same SKU, no leading zeros
  B("0007890000028", "QA-TESTE-001", "001", 2), // M, stock 0 (colour has stock)
  B("0007890000035", "QA-TESTE-001", "001", 3),
  B("0007890000042", "QA-TESTE-001", "003", 1),
  B("0007890000059", "QA-TESTE-001", "003", 2), // M, stock 3
  B("0007890000066", "QA-TESTE-001", "003", 3),
  B("0007890000073", "QA-TESTE-001", "1HY", 2), // colour sold out (restocked later)
  B("0007890000074", "QA-TESTE-001", "2ZZ", 2), // colour always sold out
  B("0007890000080", "QA-TESTE-002", "001", 1),
  B("0007890000097", "QA-TESTE-002", "001", 2),
  B("0007890000103", "QA-TESTE-002", "001", 3),
  B("0007890000110", "QA-TESTE-003", "001", 2), // reference absent from estoque_atual
  B("0007890000127", "QA-TESTE-001", "001", 1), // ambiguous: also below
  B("0007890000127", "QA-TESTE-002", "001", 1),
  B("0007890000134", "QA-TESTE-002", "001", 2, "-"), // placeholder size -> excluded
  B("0007890000080", "QA-TESTE-002", "001", 1), // harmless duplicate row
  ...Array.from({ length: 8 }, (_, i) => B(`000789000100${i}`, "QA-TESTE-002", "001", (i % 3) + 1)), // filler aliases (removal-guard scenarios)
];
const PUBLISHABLE_INITIAL = 13 + 8; // distinct, non-ambiguous, non-placeholder

const sources = {
  async extractInventory() {
    const rows = [];
    for (const [k, qtys] of fixture.estoque) {
      const [produto, cor] = k.split("|");
      const p = PRODUTOS[produto];
      qtys.forEach((qtd, i) =>
        rows.push({
          produto,
          desc_produto: p.desc,
          tipo_produto: "TESTE QA",
          linha: "QA",
          grade: p.grade,
          cor_codigo: cor,
          cor_descricao_linx: COR_DESC[cor],
          tamanho_key: i + 1,
          tamanho_venda: p.sizes[i],
          quantidade_estoque: qtd,
        }),
      );
    }
    return rows;
  },
  async extractPrices() {
    return [...fixture.estoque.keys()].map((k) => {
      const [produto, cor] = k.split("|");
      return { produto, cor_codigo: cor, preco: PRECOS[produto] };
    });
  },
  async extractBarcodes() {
    fixture.barcodeExtractions += 1;
    if (fixture.failBarcodeExtraction) throw new Error("simulated Linx barcode read failure");
    return fixture.barras.map((b) => ({
      codigo_barra: b.codigo,
      produto: b.produto,
      cor_codigo: b.cor,
      tamanho_key: b.key,
      tamanho_venda: b.label ?? PRODUTOS[b.produto].sizes[b.key - 1],
      desc_produto: PRODUTOS[b.produto].desc,
      cor_descricao_linx: COR_DESC[b.cor],
    }));
  },
};

// -----------------------------------------------------------------------------
const client = createPsqlSupabaseClient({ psqlPath: PSQL });
// The database stamps check times with its own now(), so runs use the real
// clock; "a week passing" is simulated by back-dating the last successful
// check before this week's Monday 00:00 (Manaus) boundary. The boundary
// arithmetic itself is covered offline (test-diff-engine.mjs).
const backdateLastCheck = () =>
  q(`update public.estoque_barcode_sync_estado set ultimo_check_ok_em =
       '${new Date(weeklyBarcodeBoundary(new Date()).getTime() - 3600_000).toISOString()}'::timestamptz
     where id; select to_json(true);`);

async function sync(name, opts = {}) {
  client.resetCalls();
  fixture.barcodeExtractions = 0;
  const origLog = console.log;
  const lines = [];
  if (!VERBOSE) console.log = (...a) => lines.push(a.join(" "));
  let res;
  try {
    const runner = opts.dryRun ? runDryRun : runReal;
    res = await runner(client, sources, {
      dryRun: !!opts.dryRun,
      allowLargeRemoval: false,
      overrideReason: opts.overrideReason ?? null,
      forceBarcodeCheck: !!opts.force,
      allowLargeBarcodeRemoval: !!opts.allowLargeBarcodeRemoval,
      stagingChunkSize: opts.chunkSize,
    });
  } finally {
    console.log = origLog;
  }
  process.exitCode = 0;
  res.logs = lines;
  res.fullMappingRead = client.calls.some(
    (c) => c.kind === "select" && c.table === "estoque_barcodes",
  );
  res.barcodeStagingInserts = client.calls.filter(
    (c) => c.kind === "insert" && c.table === "estoque_staging_barcodes",
  ).length;
  res.barcodeExtractions = fixture.barcodeExtractions;
  if (VERBOSE) console.log(`[${name}]`, JSON.stringify(res.result ?? res.status));
  return res;
}

const estado = () => q("select to_jsonb(s) from public.estoque_barcode_sync_estado s;");
const exec = (id) =>
  q(`select to_jsonb(e) from public.estoque_sync_execucoes e where id = '${id}';`);
const mapping = () =>
  q(
    "select coalesce(jsonb_object_agg(codigo_barra, produto||'|'||cor_codigo||'|'||tamanho_key), '{}') from public.estoque_barcodes;",
  );
const mappingStamp = () =>
  q(
    "select json_build_object('n', count(*), 'max', max(atualizado_em), 'ids', count(distinct ultimo_sync_id)) from public.estoque_barcodes;",
  );
const stagingCount = () => q("select to_json(count(*)) from public.estoque_staging_barcodes;");
const invQty = (produto, cor, key) =>
  q(
    `select to_json(quantidade_estoque) from public.estoque_atual where produto='${produto}' and cor_codigo='${cor}' and tamanho_key=${key};`,
  );

// QA-only fault injection: triggers that raise while a flag row exists.
// Created by the harness and always dropped again (finally block).
const FAULT_TEARDOWN = `
  drop trigger if exists qa_fault on public.estoque_barcode_sync_estado;
  drop trigger if exists qa_fault on public.estoque_staging_barcodes;
  drop schema if exists qa_test cascade;
  select to_json(true);`;
const FAULT_SETUP = `
  create schema qa_test;
  revoke all on schema qa_test from public;
  create table qa_test.faults (nome text primary key);
  create function qa_test.fault() returns trigger language plpgsql as $f$
  begin
    if tg_table_name = 'estoque_barcode_sync_estado' then
      if exists (select 1 from qa_test.faults where nome = 'estado_any') then
        raise exception 'QA_FAULT: % update', tg_table_name;
      end if;
      if exists (select 1 from qa_test.faults where nome = 'estado_success') and not new.check_pendente then
        raise exception 'QA_FAULT: % update', tg_table_name;
      end if;
      return new;
    end if;
    if exists (select 1 from qa_test.faults where nome = 'staging_cleanup') then
      raise exception 'QA_FAULT: % delete', tg_table_name;
    end if;
    return old;
  end $f$;
  create trigger qa_fault before update on public.estoque_barcode_sync_estado
    for each row execute function qa_test.fault();
  create trigger qa_fault before delete on public.estoque_staging_barcodes
    for each row execute function qa_test.fault();
  select to_json(true);`;
const setFault = (nome) =>
  q(
    nome
      ? `delete from qa_test.faults; insert into qa_test.faults values ('${nome}'); select to_json(true);`
      : "delete from qa_test.faults; select to_json(true);",
  );
const stagingRows = () => q("select to_json(count(*)) from public.estoque_staging_barcodes;");

// -----------------------------------------------------------------------------
async function main() {
  const sysid = await q(
    "select to_json((select system_identifier from pg_control_system())::text);",
  );
  if (sysid !== EXPECTED_ID) {
    console.error(
      `Refusing: connected system_identifier ${sysid} is not the expected QA ${EXPECTED_ID}`,
    );
    process.exit(2);
  }
  const hasMigration = await q(
    "select to_json(to_regclass('public.estoque_barcodes') is not null);",
  );
  if (!hasMigration) {
    console.error("Refusing: barcode migration (20261125_001) not applied on the target.");
    process.exit(2);
  }
  console.log(`target OK (QA system_identifier ${sysid})`);

  // Reset synthetic current state (QA only) so the test is repeatable.
  await q(`
    delete from public.estoque_staging_barcodes; delete from public.estoque_staging_linhas;
    delete from public.estoque_staging_grupos; delete from public.estoque_staging_precos;
    delete from public.estoque_barcodes; delete from public.estoque_atual;
    delete from public.estoque_atual_grupos; delete from public.estoque_precos_atual;
    update public.estoque_barcode_sync_estado set hash_publicado=null, publicado_em=null,
      publicado_sync_id=null, barcodes_publicados=null, ultimo_check_ok_em=null,
      ultimo_check_ok_sync_id=null, ultimo_check_ok_motivos=null, check_pendente=false,
      check_pendente_motivos=null, check_pendente_desde=null, ultima_falha_em=null,
      ultima_falha_erro=null, falhas_consecutivas=0;
    select to_json(true);`);

  // --- 0. backward compatibility: legacy 11-argument caller -------------------
  console.log("\n[0] backward compatibility");
  {
    const claim = (await client.rpc("estoque_claim_sync")).data[0];
    const legacy = await client.rpc("estoque_aplicar_sync", {
      p_sync_id: claim.sync_id,
      p_raw_rows: 0,
      p_canonical_rows: 0,
      p_produto_count: 0,
      p_produto_cor_count: 0,
      p_avisos: [],
      p_allow_large_removal: false,
      p_override_reason: null,
      p_preco_rows_lidos: 0,
      p_preco_produto_cor_count: 0,
      p_preco_sem_correspondencia: 0,
    });
    const r = legacy.data?.[0];
    const e = await estado();
    check(
      "legacy 11-arg estoque_aplicar_sync call succeeds",
      r?.status === "sucesso" && r.barcode_check_status === "nao_devido",
      legacy.error ?? r,
    );
    check(
      "legacy call leaves barcode state untouched",
      e.hash_publicado === null && !e.check_pendente,
    );
  }

  // --- 1. dry run never advances state -----------------------------------------
  console.log("\n[1] dry run");
  {
    const before = await q("select to_json(count(*)) from public.estoque_sync_execucoes;");
    const r = await sync("dry", { dryRun: true });
    const after = await q("select to_json(count(*)) from public.estoque_sync_execucoes;");
    const e = await estado();
    check(
      "dry run plans an initial publication",
      r.barcodePlan.resultado === "publicar" && r.barcodePlan.motivos.includes("inicial"),
    );
    check(
      "dry run creates no execution and stages nothing",
      before === after && r.barcodeStagingInserts === 0 && (await stagingCount()) === 0,
    );
    check(
      "dry run does not advance barcode state",
      e.hash_publicado === null && e.ultimo_check_ok_em === null,
    );
  }

  // --- 2. initial load -----------------------------------------------------------
  console.log("\n[2] initial load");
  let initialHash;
  {
    const r = await sync("initial");
    const x = r.result;
    const e = await estado();
    const m = await mapping();
    initialHash = r.barcodePlan.hash;
    check(
      "initial load publishes",
      x.barcode_check_status === "publicado" && r.barcodePlan.motivos.includes("inicial"),
      x,
    );
    check(
      "initial delta = all publishable barcodes",
      x.barcode_novos === PUBLISHABLE_INITIAL && Object.keys(m).length === PUBLISHABLE_INITIAL,
      { novos: x.barcode_novos, n: Object.keys(m).length },
    );
    check(
      "published hash/count advanced",
      e.hash_publicado === initialHash &&
        e.barcodes_publicados === PUBLISHABLE_INITIAL &&
        e.check_pendente === false,
    );
    check(
      "inventory applied in the same run",
      x.grupos_novos === 3 && (await invQty("QA-TESTE-001", "001", 1)) === 2,
    );
    check("ambiguous barcode not published", !("0007890000127" in m));
    check("placeholder-size barcode not published", !("0007890000134" in m));
    check(
      "alias + leading zeros kept as distinct text keys",
      m["0007890000011"] === "QA-TESTE-001|001|1" && m["7890000011"] === "QA-TESTE-001|001|1",
    );
    const ex = await exec(r.syncId);
    check(
      "execution audit has barcode fields",
      ex.barcode_check_status === "publicado" &&
        ex.barcode_hash === initialHash &&
        ex.barcode_ambiguos === 1 &&
        ex.barcode_rows_lidos === fixture.barras.length,
    );
    check(
      "ambiguity audit warning recorded",
      ex.avisos.some((a) => a.includes("0007890000127")),
    );
  }

  // --- 3. not due: no barcode work at all --------------------------------------
  console.log("\n[3] not due");
  {
    const stamp = await mappingStamp();
    const r = await sync("not-due");
    check(
      "not due: no Linx barcode read, no mapping read, no staging",
      r.barcodeExtractions === 0 && !r.fullMappingRead && r.barcodeStagingInserts === 0,
    );
    check("not due: status nao_devido", r.result.barcode_check_status === "nao_devido");
    check(
      "not due: mapping untouched",
      JSON.stringify(await mappingStamp()) === JSON.stringify(stamp),
    );
  }

  // --- 4. quantity-only change never triggers ----------------------------------
  console.log("\n[4] quantity-only change");
  {
    fixture.estoque.set("QA-TESTE-001|001", [1, 0, 1]);
    const r = await sync("qty-only");
    check(
      "quantity change applied",
      r.result.grupos_alterados === 1 && (await invQty("QA-TESTE-001", "001", 1)) === 1,
    );
    check(
      "quantity change does not trigger barcode check",
      r.barcodeExtractions === 0 && r.result.barcode_check_status === "nao_devido",
    );
  }

  // --- 5. restocked colour that already has barcodes does not trigger -------------
  console.log("\n[5] restock of a known colour");
  {
    fixture.estoque.set("QA-TESTE-001|1HY", [0, 1, 0]);
    const r = await sync("restock");
    check("restocked colour is a new inventory group", r.result.grupos_novos === 1);
    check(
      "restock does not trigger (colour already mapped)",
      r.barcodePlan.unmappedNewPairs === 0 && r.barcodeExtractions === 0,
    );
  }

  // --- 6. weekly: unchanged hash skips the full mapping read and all writes -------
  console.log("\n[6] weekly reconciliation, unchanged");
  {
    await backdateLastCheck();
    const stamp = await mappingStamp();
    const r = await sync("weekly");
    const e = await estado();
    check(
      "weekly check due once the week boundary passed",
      r.barcodePlan.motivos.join() === "semanal",
    );
    check(
      "unchanged hash -> inalterado",
      r.result.barcode_check_status === "inalterado" && r.barcodePlan.hash === initialHash,
    );
    check(
      "unchanged hash: no full estoque_barcodes read, no staging",
      !r.fullMappingRead && r.barcodeStagingInserts === 0,
    );
    check(
      "unchanged hash: no mapping row written",
      JSON.stringify(await mappingStamp()) === JSON.stringify(stamp),
    );
    check(
      "successful check recorded, hash unchanged",
      e.ultimo_check_ok_sync_id === r.syncId && e.hash_publicado === initialHash,
    );
    const r2 = await sync("after-weekly");
    check("weekly check not repeated within the week", r2.barcodeExtractions === 0);
  }

  // --- 7. manual force ---------------------------------------------------------
  console.log("\n[7] manual force");
  {
    const r = await sync("force", { force: true });
    check(
      "force bypasses cadence",
      r.barcodePlan.motivos.join() === "manual" && r.result.barcode_check_status === "inalterado",
    );
  }

  // --- 8. genuinely new product/colour ----------------------------------------
  console.log("\n[8] new product/colour");
  {
    fixture.estoque.set("QA-TESTE-004|001", [2, 0, 0]);
    fixture.barras.push(
      B("0007890000400", "QA-TESTE-004", "001", 1),
      B("0007890000401", "QA-TESTE-004", "001", 2),
    );
    const r = await sync("new-product");
    const m = await mapping();
    check(
      "new unmapped produto+cor triggers the check",
      r.barcodePlan.motivos.join() === "novo_produto_cor" && r.barcodePlan.unmappedNewPairs === 1,
    );
    check(
      "changed mapping publishes exact delta",
      r.result.barcode_check_status === "publicado" &&
        r.result.barcode_novos === 2 &&
        r.result.barcode_alterados === 0 &&
        r.result.barcode_removidos === 0,
      r.result,
    );
    check("new barcodes mapped", m["0007890000400"] === "QA-TESTE-004|001|1");
    check(
      "hash advanced after successful publication",
      (await estado()).hash_publicado === r.barcodePlan.hash && r.barcodePlan.hash !== initialHash,
    );
  }

  // --- 9. changed mapping: re-point + removal (small) --------------------------
  console.log("\n[9] re-point + small removal");
  {
    fixture.barras = fixture.barras.filter((b) => b.codigo !== "0007890001007");
    const moved = fixture.barras.find((b) => b.codigo === "0007890000103");
    moved.key = 2;
    const r = await sync("repoint", { force: true });
    const m = await mapping();
    check(
      "delta: 1 alterado + 1 removido",
      r.result.barcode_check_status === "publicado" &&
        r.result.barcode_alterados === 1 &&
        r.result.barcode_removidos === 1 &&
        r.result.barcode_novos === 0,
      r.result,
    );
    check(
      "re-pointed barcode updated, removed barcode gone",
      m["0007890000103"] === "QA-TESTE-002|001|2" && !("0007890001007" in m),
    );
  }

  // --- 10. removal guard: barcode publication skipped, inventory still applied --
  console.log("\n[10] barcode removal guard");
  let hashBeforeGuard;
  {
    hashBeforeGuard = (await estado()).hash_publicado;
    const before = await mapping();
    const removed = ["0007890001000", "0007890001001", "0007890001002", "0007890001003"];
    fixture.barras = fixture.barras.filter((b) => !removed.includes(b.codigo));
    fixture.estoque.set("QA-TESTE-002|001", [2, 0, 0]);
    const r = await sync("guard", { force: true });
    const e = await estado();
    const ex = await exec(r.syncId);
    check("run still succeeds", r.result.status === "sucesso");
    check("barcode publication blocked", r.result.barcode_check_status === "bloqueado");
    check(
      "inventory change applied despite barcode block",
      (await invQty("QA-TESTE-002", "001", 1)) === 2,
    );
    check("previous mapping preserved", JSON.stringify(await mapping()) === JSON.stringify(before));
    check(
      "hash not advanced, check pending",
      e.hash_publicado === hashBeforeGuard && e.check_pendente && e.falhas_consecutivas === 1,
    );
    check(
      "guard warning in execution audit",
      ex.avisos.some((a) => a.includes("BARCODE_CHECK_BLOQUEADO")) &&
        ex.barcode_check_status === "bloqueado",
    );
    const r2 = await sync("guard-retry");
    check(
      "pending check retried next hourly run",
      r2.barcodePlan.motivos.join() === "retry" &&
        r2.result.barcode_check_status === "bloqueado" &&
        (await estado()).falhas_consecutivas === 2,
    );
    const r3 = await sync("guard-override", { allowLargeBarcodeRemoval: true });
    const e3 = await estado();
    check(
      "explicit barcode override publishes",
      r3.result.barcode_check_status === "publicado" && r3.result.barcode_removidos === 4,
    );
    check(
      "pending cleared after success",
      !e3.check_pendente &&
        e3.falhas_consecutivas === 0 &&
        e3.hash_publicado === r3.barcodePlan.hash,
    );
  }

  // --- 11. Linx barcode extraction failure isolated ---------------------------
  console.log("\n[11] extraction failure");
  {
    fixture.failBarcodeExtraction = true;
    fixture.estoque.set("QA-TESTE-002|001", [3, 0, 0]);
    const r = await sync("extract-fail", { force: true });
    const e = await estado();
    check(
      "extraction failure -> falha, run succeeds",
      r.result.status === "sucesso" && r.result.barcode_check_status === "falha",
    );
    check(
      "inventory applied despite barcode failure",
      (await invQty("QA-TESTE-002", "001", 1)) === 3,
    );
    check(
      "failure marked pending",
      e.check_pendente && e.ultima_falha_erro.includes("simulated Linx"),
    );
    fixture.failBarcodeExtraction = false;
    const r2 = await sync("extract-retry");
    check(
      "retry after failure succeeds (unchanged -> inalterado)",
      r2.barcodePlan.motivos.join() === "retry" &&
        r2.result.barcode_check_status === "inalterado" &&
        !(await estado()).check_pendente,
    );
  }

  // --- 12. state read failure isolated ---------------------------------------
  console.log("\n[12] state read failure");
  {
    client.faults.rpc = (name) =>
      name === "estoque_barcode_estado" ? "simulated state read failure" : null;
    const r = await sync("state-fail");
    client.faults.rpc = null;
    check(
      "state read failure -> falha, inventory run succeeds",
      r.result.status === "sucesso" && r.result.barcode_check_status === "falha",
    );
    check("state read failure marked pending", (await estado()).check_pendente);
    const r2 = await sync("state-retry");
    check(
      "retry clears it",
      r2.result.barcode_check_status === "inalterado" && !(await estado()).check_pendente,
    );
  }

  // --- 13. partial staging failure cannot publish or leak ----------------------
  console.log("\n[13] partial staging failure");
  {
    const before = await mapping();
    const hashBefore = (await estado()).hash_publicado;
    fixture.barras.push(
      B("0007890000500", "QA-TESTE-004", "001", 3),
      B("0007890000501", "QA-TESTE-001", "003", 3),
      B("0007890000502", "QA-TESTE-001", "003", 1),
    );
    client.faults.insert = (table, n) =>
      table === "estoque_staging_barcodes" && n === 2 ? "simulated staging failure" : null;
    const r = await sync("stage-fail", { force: true, chunkSize: 2 });
    client.faults.insert = null;
    const e = await estado();
    check("first chunk was staged before the failure", r.barcodeStagingInserts === 2);
    check(
      "partial staging -> falha, run succeeds",
      r.result.status === "sucesso" && r.result.barcode_check_status === "falha",
    );
    check(
      "partial staging not published, staging purged",
      JSON.stringify(await mapping()) === JSON.stringify(before) && (await stagingCount()) === 0,
    );
    check("hash not advanced, pending", e.hash_publicado === hashBefore && e.check_pendente);
    const r2 = await sync("stage-retry", { chunkSize: 2 });
    check(
      "retry publishes the full delta",
      r2.barcodePlan.motivos.join() === "retry" &&
        r2.result.barcode_check_status === "publicado" &&
        r2.result.barcode_novos === 3,
      r2.result,
    );
  }

  // --- 14. DB-side guards: incomplete staging, total mismatch, drift ------------
  console.log("\n[14] database-side barcode guards");
  {
    const before = await mapping();
    const st = await estado();
    const claim = (await client.rpc("estoque_claim_sync")).data[0];
    await client.from("estoque_staging_barcodes").insert([
      {
        sync_id: claim.sync_id,
        codigo_barra: "QA-INCOMPLETE-1",
        acao: "novo",
        produto: "QA-TESTE-001",
        cor_codigo: "001",
        tamanho_key: 1,
        tamanho_venda: "P",
      },
    ]);
    const res = await client.rpc("estoque_aplicar_sync", {
      p_sync_id: claim.sync_id,
      p_raw_rows: 0,
      p_canonical_rows: 0,
      p_produto_count: 0,
      p_produto_cor_count: 0,
      p_barcode_resultado: "publicar",
      p_barcode_motivos: "manual",
      p_barcode_hash: "x".repeat(64),
      p_barcode_total: st.barcodes_publicados + 2,
      p_barcode_novos_esperados: 2,
      p_barcode_alterados_esperados: 0,
      p_barcode_removidos_esperados: 0,
    });
    const r = res.data?.[0];
    check(
      "incomplete staging rejected by apply",
      r?.status === "sucesso" &&
        r.barcode_check_status === "falha" &&
        r.barcode_erro.includes("BARCODE_STAGING_INCOMPLETE"),
      res.error ?? r,
    );
    check(
      "nothing published from incomplete staging",
      JSON.stringify(await mapping()) === JSON.stringify(before) && (await stagingCount()) === 0,
    );

    const claim2 = (await client.rpc("estoque_claim_sync")).data[0];
    await client.from("estoque_staging_barcodes").insert([
      {
        sync_id: claim2.sync_id,
        codigo_barra: "QA-TOTAL-1",
        acao: "novo",
        produto: "QA-TESTE-001",
        cor_codigo: "001",
        tamanho_key: 1,
        tamanho_venda: "P",
      },
    ]);
    const res2 = await client.rpc("estoque_aplicar_sync", {
      p_sync_id: claim2.sync_id,
      p_raw_rows: 0,
      p_canonical_rows: 0,
      p_produto_count: 0,
      p_produto_cor_count: 0,
      p_barcode_resultado: "publicar",
      p_barcode_motivos: "manual",
      p_barcode_hash: "y".repeat(64),
      p_barcode_total: 999,
      p_barcode_novos_esperados: 1,
      p_barcode_alterados_esperados: 0,
      p_barcode_removidos_esperados: 0,
    });
    const r2 = res2.data?.[0];
    const e2 = await estado();
    check(
      "total mismatch rolls back barcode writes only",
      r2?.status === "sucesso" &&
        r2.barcode_check_status === "falha" &&
        r2.barcode_erro.includes("BARCODE_TOTAL_MISMATCH"),
      res2.error ?? r2,
    );
    check(
      "hash not advanced on failed apply (atomic)",
      e2.hash_publicado === st.hash_publicado && !("QA-TOTAL-1" in (await mapping())),
    );

    // drift: a mapping row disappears out of band -> unchanged-hash check detects it
    await q(
      "delete from public.estoque_barcodes where codigo_barra = '0007890000066'; select to_json(true);",
    );
    const r3 = await sync("drift", { force: true });
    check(
      "drift detected on unchanged hash",
      r3.result.barcode_check_status === "falha" &&
        r3.result.barcode_erro.includes("BARCODE_STATE_DRIFT"),
    );
    check("drift clears the published hash", (await estado()).hash_publicado === null);
    const r4 = await sync("drift-repair");
    check(
      "next run fully reconciles and restores the row",
      r4.result.barcode_check_status === "publicado" &&
        r4.result.barcode_novos === 1 &&
        "0007890000066" in (await mapping()),
    );
  }

  // --- 15. inventory guard still aborts the whole run (unchanged) --------------
  console.log("\n[15] inventory safeguards unchanged");
  {
    const before = await mapping();
    const saved = new Map(fixture.estoque);
    fixture.estoque.delete("QA-TESTE-004|001");
    fixture.estoque.delete("QA-TESTE-001|1HY");
    fixture.barras.push(B("0007890000600", "QA-TESTE-001", "001", 2));
    const r = await sync("inv-guard", { force: true });
    check(
      "inventory LARGE_REMOVAL_GUARD still blocks the run",
      r.result?.status === "erro" && r.result.error_code === "LARGE_REMOVAL_GUARD",
      r.result,
    );
    check(
      "blocked run publishes no barcodes and leaves no staging",
      JSON.stringify(await mapping()) === JSON.stringify(before) && (await stagingCount()) === 0,
    );
    fixture.estoque = saved;
    fixture.barras.pop();
  }

  // --- 16. lookup RPC outcomes -----------------------------------------------
  console.log("\n[16] lookup RPC");
  {
    // Final fixture inventory: 001/001 [1,0,1], 001/003 [0,3,0], 001/1HY [0,1,0],
    // 002/001 [3,0,0], 004/001 [2,0,0]; 2ZZ and QA-TESTE-003 have no stock rows.
    const lookups = [
      ["0007890000011", "DISPONIVEL", 1],
      ["7890000011", "DISPONIVEL", 1],
      [" 0007890000011 ", "DISPONIVEL", 1],
      ["0007890000028", "TAMANHO_ESGOTADO", 0],
      ["0007890000074", "COR_ESGOTADA", 0],
      ["0007890000110", "REFERENCIA_ESGOTADA", 0],
      ["0007890000127", "NAO_ENCONTRADO", null],
      ["0007890000134", "NAO_ENCONTRADO", null],
      ["7890000028", "NAO_ENCONTRADO", null],
      ["9999999999999", "NAO_ENCONTRADO", null],
    ];
    const values = lookups.map(([c]) => `(${JSON.stringify(c).replace(/"/g, "'")})`).join(",");
    const rows = await q(`
      \\set QUIET on
      select public.issue_employee_session(id) as tok from public.funcionarios where nome = 'QA Teste Vendedor' \\gset
      set role anon;
      select coalesce(jsonb_agg(jsonb_build_object('in', v.c, 'r', to_jsonb(r))), '[]') from (values ${values}) v(c)
        cross join lateral public.get_estoque_por_codigo_barra(:'tok', v.c) r;`);
    for (const [codigo, esperado, qtd] of lookups) {
      const hit = rows.find((x) => x.in === codigo)?.r;
      check(
        `lookup ${JSON.stringify(codigo)} -> ${esperado}`,
        hit?.resultado === esperado && (qtd === null || hit.quantidade_estoque === qtd),
        hit,
      );
    }
    const cor = rows.find((x) => x.in === "0007890000074").r;
    check(
      "COR_ESGOTADA reports other colours with stock",
      cor.outras_cores_disponiveis === 3 && cor.desc_produto === "POLO TESTE QA",
    );
    const ref = rows.find((x) => x.in === "0007890000110").r;
    check(
      "REFERENCIA_ESGOTADA named from the mapping (absent from estoque_atual)",
      ref.desc_produto === "BONE TESTE QA" &&
        ref.tamanho_venda === "M" &&
        ref.cor_nome_portal === "Branco",
    );
    check(
      "cor_descricao_linx never returned",
      rows.every((x) => !("cor_descricao_linx" in x.r)),
    );

    // negative quantities: estoque_atual rejects them outright (the sync
    // normalizes Linx negatives to 0 first; the lookup also clamps with greatest()).
    const negErr = await qErr(
      "update public.estoque_atual set quantidade_estoque = -5 where produto='QA-TESTE-001' and cor_codigo='003' and tamanho_key=2;",
    );
    check(
      "negative quantity cannot be stored in estoque_atual",
      negErr?.includes("estoque_atual_quantidade_estoque_check"),
      negErr,
    );
  }

  // --- 17. sessions and access control ---------------------------------------
  console.log("\n[17] sessions and access control");
  {
    const invalid = await qErr(
      "set role anon; select * from public.get_estoque_por_codigo_barra('not-a-token', '0007890000011');",
    );
    check("invalid session rejected", invalid?.includes("INVALID_SESSION"), invalid);
    const revoked = await qErr(`
      \\set QUIET on
      select public.issue_employee_session(id) as tok from public.funcionarios where nome = 'QA Teste Vendedor' \\gset
      select public.revoke_employee_session(:'tok');
      set role anon;
      select * from public.get_estoque_por_codigo_barra(:'tok', '0007890000011');`);
    check("revoked session rejected", revoked?.includes("INVALID_SESSION"), revoked);
    for (const role of ["anon", "authenticated"]) {
      for (const t of [
        "estoque_barcodes",
        "estoque_staging_barcodes",
        "estoque_barcode_sync_estado",
      ]) {
        const err = await qErr(`select count(*) from public.${t};`, role);
        check(`${role} cannot read ${t}`, err?.includes("permission denied"), err);
      }
      for (const fn of [
        "estoque_barcode_estado()",
        "estoque_barcode_produto_cores_sem_mapeamento('[]'::jsonb)",
      ]) {
        const err = await qErr(`select * from public.${fn};`, role);
        check(
          `${role} cannot execute ${fn.split("(")[0]}`,
          err?.includes("permission denied"),
          err,
        );
      }
    }
    const errAuth = await qErr(
      "select * from public.get_estoque_por_codigo_barra('x','1');",
      "authenticated",
    );
    check(
      "authenticated cannot execute lookup RPC",
      errAuth?.includes("permission denied"),
      errAuth,
    );
    const srEstado = await qErr(
      "select * from public.estoque_barcode_sync_estado;",
      "service_role",
    );
    check(
      "service_role has no direct access to the state table",
      srEstado?.includes("permission denied"),
      srEstado,
    );
    const srWrite = await qErr("delete from public.estoque_barcodes;", "service_role");
    check(
      "service_role cannot write the mapping directly",
      srWrite?.includes("permission denied"),
      srWrite,
    );
  }

  // --- 18. existing inventory/price RPCs unchanged ----------------------------
  console.log("\n[18] existing Consulta RPCs");
  {
    const res = await q(`
      \\set QUIET on
      select public.issue_employee_session(id) as tok from public.funcionarios where nome = 'QA Teste Vendedor' \\gset
      set role anon;
      select json_build_object(
        'busca', (select count(*) from public.buscar_produtos_estoque(:'tok', 'QA-TESTE')),
        'detalhe', (select count(*) from public.get_produto_estoque_detalhe(:'tok', 'QA-TESTE-001')),
        'preco', (select max(preco) from public.get_produto_estoque_detalhe(:'tok', 'QA-TESTE-001')),
        'fresh', (select count(*) from public.get_estoque_freshness(:'tok')));`);
    check(
      "buscar/detalhe/freshness still work",
      res.busca === 3 && res.detalhe === 9 && Number(res.preco) === 399.9 && res.fresh === 1,
      res,
    );
  }

  // --- 19. database-side barcode isolation (fault injection) -----------------
  console.log("\n[19] barcode DB failure isolation");
  await q(FAULT_TEARDOWN);
  await q(FAULT_SETUP);
  try {
    // a) state update fails AFTER the mapping writes -> whole barcode step rolled back
    {
      const before = await mapping();
      const hashBefore = (await estado()).hash_publicado;
      fixture.barras.push(B("0007890000700", "QA-TESTE-004", "001", 2));
      fixture.estoque.set("QA-TESTE-002|001", [4, 0, 0]);
      await setFault("estado_success");
      const r = await sync("state-fail-after-publish", { force: true });
      await setFault(null);
      const raw = await estado();
      check(
        "state failure after mapping writes -> falha, run committed",
        r.result.status === "sucesso" &&
          r.result.barcode_check_status === "falha" &&
          r.result.barcode_erro.includes("BARCODE_DB_FAILURE") &&
          r.result.barcode_erro.includes("QA_FAULT"),
        r.result,
      );
      check(
        "mapping writes rolled back, previous mapping kept",
        JSON.stringify(await mapping()) === JSON.stringify(before),
      );
      check("published hash not advanced", raw.hash_publicado === hashBefore);
      check(
        "inventory/price committed despite barcode rollback",
        (await invQty("QA-TESTE-002", "001", 1)) === 4,
      );
      check(
        "failure recorded in state (fallback update)",
        raw.check_pendente === true && raw.ultima_falha_erro.includes("BARCODE_DB_FAILURE"),
      );
      check("no staging left behind", (await stagingRows()) === 0);
      const r2 = await sync("state-fail-retry");
      check(
        "retry publishes the delta",
        r2.barcodePlan.motivos.join() === "retry" &&
          r2.result.barcode_check_status === "publicado" &&
          r2.result.barcode_novos === 1 &&
          "0007890000700" in (await mapping()),
        r2.result,
      );
    }

    // b) state row cannot be updated at all -> retry derived from the sync audit
    {
      fixture.estoque.set("QA-TESTE-002|001", [5, 0, 0]);
      await setFault("estado_any");
      const r = await sync("state-unwritable", { force: true });
      await setFault(null);
      const raw = await estado();
      const viaRpc = (await client.rpc("estoque_barcode_estado")).data[0];
      const ex = await exec(r.syncId);
      check(
        "unwritable state -> falha, run committed",
        r.result.status === "sucesso" &&
          r.result.barcode_check_status === "falha" &&
          r.result.barcode_erro.includes("retry derived from sync audit"),
        r.result,
      );
      check("inventory committed", (await invQty("QA-TESTE-002", "001", 1)) === 5);
      check("state row itself unchanged (not pending)", raw.check_pendente === false);
      check(
        "estoque_barcode_estado() reports pending from the audit",
        viaRpc.check_pendente === true && ex.barcode_check_status === "falha",
      );
      const r2 = await sync("audit-retry");
      const viaRpc2 = (await client.rpc("estoque_barcode_estado")).data[0];
      check(
        "derived pending triggers retry, which clears it",
        r2.barcodePlan.motivos.join() === "retry" &&
          r2.result.barcode_check_status === "inalterado" &&
          viaRpc2.check_pendente === false,
        r2.result,
      );
    }

    // c) staging cleanup fails -> publication stands, leftovers never applied, purged at next claim
    {
      fixture.barras.push(B("0007890000701", "QA-TESTE-004", "001", 3));
      await setFault("staging_cleanup");
      const r = await sync("cleanup-fail", { force: true });
      const left = await stagingRows();
      const ex = await exec(r.syncId);
      check(
        "cleanup failure does not undo a successful publication",
        r.result.status === "sucesso" &&
          r.result.barcode_check_status === "publicado" &&
          "0007890000701" in (await mapping()),
        r.result,
      );
      check(
        "cleanup failure recorded as a warning",
        ex.avisos.some((a) => a.includes("BARCODE_STAGING_CLEANUP_FAILED")) && left > 0,
      );
      // estoque_marcar_erro must also survive a cleanup failure
      const claim = (await client.rpc("estoque_claim_sync")).data[0];
      await client
        .from("estoque_staging_barcodes")
        .insert([{ sync_id: claim.sync_id, codigo_barra: "QA-ERR-1", acao: "removido" }]);
      const me = await client.rpc("estoque_marcar_erro", {
        p_sync_id: claim.sync_id,
        p_mensagem: "qa",
        p_error_code: "QA",
      });
      check(
        "estoque_marcar_erro still marks erro despite cleanup failure",
        me.data?.[0]?.marcado === true,
        me.error ?? me.data,
      );
      // a claim while cleanup still fails must still succeed
      const r1 = await sync("cleanup-still-failing");
      check(
        "claim/apply still work while cleanup fails",
        r1.result?.status === "sucesso",
        r1.result ?? r1.status,
      );
      await setFault(null);
      const stamp = await mappingStamp();
      const r2 = await sync("cleanup-recovered");
      check(
        "next claim purges leftovers; nothing applied from them",
        r2.result.status === "sucesso" &&
          (await stagingRows()) === 0 &&
          JSON.stringify(await mappingStamp()) === JSON.stringify(stamp),
        r2.result,
      );
    }

    // d) barcode-only removal override keeps its audit reason
    {
      const removed = ["0007890001004", "0007890001005", "0007890001006"];
      fixture.barras = fixture.barras.filter((b) => !removed.includes(b.codigo));
      const r = await sync("barcode-override", {
        force: true,
        allowLargeBarcodeRemoval: true,
        overrideReason: "QA: reviewed barcode removal",
      });
      const ex = await exec(r.syncId);
      check(
        "barcode-only override publishes the >10% removal",
        r.result.barcode_check_status === "publicado" &&
          r.result.barcode_removidos === 3 &&
          r.barcodePlan.removalPct > 10,
        r.result,
      );
      check(
        "override reason audited with barcode-only override",
        ex.large_removal_override_used === true &&
          ex.override_reason === "QA: reviewed barcode removal",
        { used: ex.large_removal_override_used, reason: ex.override_reason },
      );
    }
  } finally {
    await q(FAULT_TEARDOWN);
  }
  check(
    "fault-injection objects removed",
    (await q(
      "select to_json(to_regnamespace('qa_test') is null and not exists (select 1 from pg_trigger where tgname = 'qa_fault'));",
    )) === true,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
