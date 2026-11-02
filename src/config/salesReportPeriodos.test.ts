import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Structural checks (the repo's test setup has no database or router harness):
// they read the migration/route sources so a regression in period resolution,
// authorization or the "same calculations as 106" guarantee fails loudly. The
// date rules themselves are executed against Postgres by
// scripts/sales-metrics-sync/verify-periodos.sql.
function read(relativeFromRepoRoot: string): string {
  return readFileSync(new URL(`../../${relativeFromRepoRoot}`, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

const m106 = read(
  "supabase/migrations/20261002_106_restrict_vendas_metricas_mtd_to_gerente_admin.sql",
);
const m = read("supabase/migrations/20261102_101_add_vendas_metricas_periodo_rpc.sql");

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const end = sql.indexOf("\n$$;", start);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, end);
}

function returnQuery(body: string): string {
  return body.slice(body.indexOf("return query"));
}

describe("period resolution (resolver_periodo_vendas)", () => {
  const body = functionBody(m, "resolver_periodo_vendas");

  it("accepts only the four period keys and rejects anything else", () => {
    expect(body).toContain("p_periodo not in ('hoje', 'mes', 'ano', 'ultimos_12_meses')");
    expect(body).toContain("PERIODO_INVALIDO");
    expect(body).toContain("p_periodo is null");
  });

  it("derives 'today' from the Manaus business date", () => {
    expect(m).toContain("p_hoje date default (now() at time zone 'America/Manaus')::date");
  });

  it("resolves each period as an inclusive range ending today", () => {
    expect(body).toContain("data_fim := p_hoje;");
    expect(body).toContain("when 'hoje' then p_hoje");
    expect(body).toContain("when 'mes' then date_trunc('month', p_hoje)::date");
    expect(body).toContain("when 'ano' then date_trunc('year', p_hoje)::date");
    expect(body).toContain(
      "when 'ultimos_12_meses' then ((p_hoje - interval '12 months') + interval '1 day')::date",
    );
  });

  it("does not read any table (resolution is isolated from aggregation)", () => {
    expect(body).not.toMatch(/\bfrom\s+public\./);
  });
});

describe("metric aggregation (vendas_metricas_intervalo)", () => {
  it("is exactly the migration-106 calculation, over parameterized bounds", () => {
    const aggregation = returnQuery(functionBody(m, "vendas_metricas_intervalo"));
    const reference = returnQuery(functionBody(m106, "get_vendas_metricas_mtd"))
      .replaceAll("v_inicio", "p_data_inicio")
      .replaceAll("v_fim", "p_data_fim");
    expect(aggregation).toBe(reference);
  });

  it("derives ratios from summed totals, never from daily ratios", () => {
    const body = functionBody(m, "vendas_metricas_intervalo");
    expect(body).toContain("c.venda_liquida / c.tickets");
    expect(body).toContain("c.pecas_liquidas::numeric / c.tickets");
    expect(body).toContain("c.venda_liquida / c.pecas_liquidas");
    expect(body).not.toMatch(/avg\(/i);
    expect(body).not.toContain("ticket_medio)");
  });

  it("keeps Total da loja and Outros", () => {
    const body = functionBody(m, "vendas_metricas_intervalo");
    expect(body).toContain("'Total da loja'::text as vendedor_nome");
    expect(body).toContain("'Outros'::text as vendedor_nome");
  });
});

describe("get_vendas_metricas_periodo authorization", () => {
  const body = functionBody(m, "get_vendas_metricas_periodo");

  it("validates the session, then the server-side cargo, then the period, then reads data", () => {
    const order = [
      "INVALID_SESSION",
      "v_ctx.cargo not in ('Gerente', 'Administrador')",
      "SEM_PERMISSAO_VENDAS_RELATORIO",
      "resolver_periodo_vendas(p_periodo)",
      "vendas_metricas_intervalo(",
    ].map((needle) => body.indexOf(needle));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("takes no role/cargo or date input from the client", () => {
    expect(body).toContain(
      "p_session_token text,\n  p_periodo text,\n  p_codigo_filial text default '060420'",
    );
    expect(body).not.toMatch(/p_(cargo|role|data|inicio|fim)/);
    // the resolver is always called with the period only (today stays server-side)
    expect(body).not.toContain("resolver_periodo_vendas(p_periodo,");
  });

  it("is SECURITY DEFINER with a fixed search_path and anon-only EXECUTE", () => {
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public");
    expect(m).toContain(
      "revoke all on function public.get_vendas_metricas_periodo(text, text, text) from public;",
    );
    expect(m).toContain(
      "grant execute on function public.get_vendas_metricas_periodo(text, text, text) to anon;",
    );
  });

  it("keeps the internal helpers unreachable from the browser", () => {
    expect(m).toContain(
      "revoke all on function public.resolver_periodo_vendas(text, date) from public, anon, authenticated, service_role;",
    );
    expect(m).toContain(
      "revoke all on function public.vendas_metricas_intervalo(text, date, date) from public, anon, authenticated, service_role;",
    );
    expect(m).not.toMatch(/grant execute[^;]*(resolver_periodo_vendas|vendas_metricas_intervalo)/);
    expect(m).not.toMatch(/grant execute[^;]*(authenticated|service_role)/);
  });

  it("leaves the deployed MTD RPC and migration 106 untouched", () => {
    expect(m).not.toContain("create or replace function public.get_vendas_metricas_mtd(");
  });
});

describe("Relatório de vendas route period wiring", () => {
  const route = read("src/routes/vendas/relatorio.tsx");

  it("starts every visit on the default period without persisting the choice", () => {
    expect(route).toContain("useState<VendasPeriodo>(VENDAS_PERIODO_PADRAO)");
    expect(route).not.toMatch(/localStorage|sessionStorage/);
  });

  it("feeds the selected period to the query and keeps the access guard", () => {
    expect(route).toContain("periodo,\n  );");
    expect(route).toContain("<VendasPeriodoSeletor value={periodo} onChange={setPeriodo} />");
    expect(route).toContain("allowed ? (session?.session_token ?? null) : null");
  });
});
