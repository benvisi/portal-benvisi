// =============================================================================
// QA-only stand-in for the subset of the supabase-js client used by
// sync-estoque.mjs (rpc, from().select().order().range(), from().insert()).
//
// Every call runs through psql as `SET ROLE service_role`, so the real grants,
// RLS posture and RPCs of the target database are exercised exactly as the
// production sync (PostgREST + service_role key) would hit them — without
// needing the service_role key on this machine.
//
// Connection settings come from the standard libpq environment (PGHOST,
// PGUSER, PGPASSFILE, PGSSLMODE, ...). The harness refuses to run unless the
// connected server's system_identifier equals the expected QA identifier.
//
// `calls` records every operation (for assertions such as "no full
// estoque_barcodes read"); `faults` lets a test inject failures.
// =============================================================================

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

function dollarQuote(text) {
  let tag;
  do {
    tag = `q${randomBytes(4).toString("hex")}`;
  } while (text.includes(`$${tag}$`));
  return `$${tag}$${text}$${tag}$`;
}

function literal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return dollarQuote(JSON.stringify(v));
  return dollarQuote(String(v));
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(name) {
  if (!IDENT.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return name;
}

export function runPsql(psqlPath, sqlText, { role = null } = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      psqlPath,
      ["-X", "-w", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
      {
        env: { ...process.env, PGCLIENTENCODING: "UTF8" },
        windowsHide: true,
      },
    );
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
    const prefix = role ? `set role ${ident(role)};\n` : "";
    child.stdin.end(prefix + sqlText, "utf8");
  });
}

/** Runs one statement returning a single json value; resolves { data, error }. */
async function jsonQuery(psqlPath, sqlText, role) {
  const { code, out, err } = await runPsql(psqlPath, sqlText, { role });
  if (code !== 0) {
    const message = err.replace(/^psql:[^:]*:\d+: /gm, "").trim() || `psql exited ${code}`;
    return { data: null, error: { message } };
  }
  const line = out.trim().split(/\r?\n/).filter(Boolean).pop() ?? "null";
  return { data: JSON.parse(line), error: null };
}

export function createPsqlSupabaseClient({ psqlPath, role = "service_role" }) {
  const calls = [];
  const faults = {
    // (fnName, args) => message | null
    rpc: null,
    // (table, insertCallIndexForTable, rows) => message | null
    insert: null,
  };
  const insertCounters = new Map();

  async function rpc(name, args = {}) {
    calls.push({ kind: "rpc", name, args });
    const injected = faults.rpc?.(name, args);
    if (injected) return { data: null, error: { message: injected } };
    const parts = Object.entries(args)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${ident(k)} => ${literal(v)}`);
    return jsonQuery(
      psqlPath,
      `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (select * from public.${ident(name)}(${parts.join(", ")})) x;`,
      role,
    );
  }

  function from(table) {
    ident(table);
    const state = { columns: "*", orders: [], range: null };

    const selectBuilder = {
      order(col, { ascending = true } = {}) {
        state.orders.push(`${ident(col)} ${ascending ? "asc" : "desc"}`);
        return selectBuilder;
      },
      range(a, b) {
        state.range = [a, b];
        return selectBuilder;
      },
      then(resolve, reject) {
        calls.push({ kind: "select", table, range: state.range });
        const cols = state.columns
          .split(",")
          .map((c) => c.trim())
          .map((c) => (c === "*" ? c : ident(c)))
          .join(", ");
        const order = state.orders.length ? ` order by ${state.orders.join(", ")}` : "";
        const page = state.range
          ? ` offset ${Number(state.range[0])} limit ${Number(state.range[1]) - Number(state.range[0]) + 1}`
          : "";
        return jsonQuery(
          psqlPath,
          `select coalesce(jsonb_agg(t), '[]'::jsonb) from (select ${cols} from public.${table}${order}${page}) t;`,
          role,
        ).then(resolve, reject);
      },
    };

    return {
      select(columns = "*") {
        state.columns = columns;
        return selectBuilder;
      },
      async insert(rows) {
        const n = (insertCounters.get(table) ?? 0) + 1;
        insertCounters.set(table, n);
        calls.push({ kind: "insert", table, rows: rows.length, index: n });
        const injected = faults.insert?.(table, n, rows);
        if (injected) return { data: null, error: { message: injected } };
        if (rows.length === 0) return { data: null, error: null };
        const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].map(ident).join(", ");
        const res = await jsonQuery(
          psqlPath,
          `with ins as (insert into public.${table} (${cols}) select ${cols} from ` +
            `json_populate_recordset(null::public.${table}, ${literal(rows)}) returning 1) ` +
            `select to_json(count(*)) from ins;`,
          role,
        );
        return { data: null, error: res.error };
      },
    };
  }

  return {
    rpc,
    from,
    calls,
    faults,
    resetCalls() {
      calls.length = 0;
      insertCounters.clear();
    },
  };
}
