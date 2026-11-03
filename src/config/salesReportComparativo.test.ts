import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Structural checks (the repo's test setup has no database or router harness):
// they read the migration/route sources so a regression in the window rules,
// authorization or the "ratios from summed bases" guarantee fails loudly. The
// date rules themselves are executed against Postgres by
// scripts/sales-metrics-sync/verify-comparativo.sql.
function read(relativeFromRepoRoot: string): string {
  return readFileSync(new URL(`../../${relativeFromRepoRoot}`, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

const m = read("supabase/migrations/20261102_102_add_vendas_comparativo_periodo_rpc.sql");
const base = read("supabase/migrations/20261102_101_add_vendas_metricas_periodo_rpc.sql");

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const end = sql.indexOf("\n$$;", start);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, end);
}

describe("resolver_janelas_comparativo (window resolution)", () => {
  const body = functionBody(m, "resolver_janelas_comparativo");

  it("validates period, toggle and year count before resolving anything", () => {
    expect(body).toContain("p_periodo not in ('hoje', 'mes', 'ano', 'ultimos_12_meses')");
    expect(body).toContain("PERIODO_INVALIDO");
    expect(body).toContain("p_incluir_hoje is null");
    expect(body).toContain("INCLUIR_HOJE_INVALIDO");
    expect(body).toContain("ANOS_INVALIDO");
  });

  it("anchors on the Manaus date, or yesterday when Incluir hoje = Não", () => {
    expect(m).toContain("p_hoje date default (now() at time zone 'America/Manaus')::date");
    expect(body).toContain("case when p_incluir_hoje then p_hoje else p_hoje - 1 end");
  });

  it("shifts by calendar years (Feb 29 clamps), oldest window first, four by default", () => {
    expect(body).toContain("p_anos integer default 4");
    expect(body).toContain("v_ancora - make_interval(years => v_k)");
    expect(body).toContain("for v_k in reverse (p_anos - 1)..0 loop");
  });

  it("Hoje uses the nearest same weekday (-3..+3 days), not the blind calendar date", () => {
    expect(body).toContain("extract(isodow from v_ancora)");
    expect(body).toContain("((v_diff + 3) % 7) - 3");
  });

  it("Mês / Ano / 12 meses reuse the V1.1 cutoff rules on the shifted end date", () => {
    expect(body).toContain("date_trunc('month', v_deslocada)::date");
    expect(body).toContain("date_trunc('year', v_deslocada)::date");
    expect(body).toContain("((v_deslocada - interval '12 months') + interval '1 day')::date");
    // identical to resolver_periodo_vendas' rolling rule
    expect(base).toContain("((p_hoje - interval '12 months') + interval '1 day')::date");
  });

  it("reads no table and is not reachable from the browser", () => {
    expect(body).not.toMatch(/\bfrom\s+public\./);
    expect(m).toContain(
      "revoke all on function public.resolver_janelas_comparativo(text, boolean, date, integer) from public, anon, authenticated, service_role;",
    );
    expect(m).not.toMatch(/grant execute[^;]*resolver_janelas_comparativo/);
  });
});

describe("get_vendas_comparativo_periodo (browser RPC)", () => {
  const body = functionBody(m, "get_vendas_comparativo_periodo");

  it("validates the session, then the server-side cargo, then reads data", () => {
    const order = [
      "INVALID_SESSION",
      "v_ctx.cargo not in ('Gerente', 'Administrador')",
      "SEM_PERMISSAO_VENDAS_RELATORIO",
      "resolver_janelas_comparativo(p_periodo, p_incluir_hoje)",
      "vendas_metricas_intervalo(",
    ].map((needle) => body.indexOf(needle));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("takes no date, role or cargo from the client", () => {
    expect(body).toContain(
      "p_session_token text,\n  p_periodo text,\n  p_incluir_hoje boolean default true,\n  p_codigo_filial text default '060420'",
    );
    expect(body).not.toMatch(/p_(cargo|role|data|inicio|fim|hoje\b)/);
    // today stays server-side: the resolver is called without p_hoje
    expect(body).not.toContain("resolver_janelas_comparativo(p_periodo, p_incluir_hoje,");
  });

  it("is SECURITY DEFINER with a fixed search_path and anon-only EXECUTE", () => {
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public");
    expect(m).toContain(
      "revoke all on function public.get_vendas_comparativo_periodo(text, text, boolean, text) from public;",
    );
    expect(m).toContain(
      "grant execute on function public.get_vendas_comparativo_periodo(text, text, boolean, text) to anon;",
    );
    expect(m).not.toMatch(/grant execute[^;]*(authenticated|service_role)/);
  });

  it("returns store totals from the validated aggregation, never salesperson rows", () => {
    expect(body).toContain(
      "from public.vendas_metricas_intervalo(p_codigo_filial, j.data_inicio, j.data_fim) m",
    );
    expect(body).toContain("where m.eh_total");
    expect(body).not.toContain("vendas_diarias_vendedor");
  });

  it("derives ratios from the summed bases (no averaging of daily ratios)", () => {
    expect(body).not.toMatch(/avg\(/i);
    // the ratios come straight from the aggregation, whose definition is pinned in V1.1's tests
    expect(body).toContain("t.ticket_medio");
    expect(body).toContain("t.pa");
    expect(body).toContain("t.pm");
  });

  it("orders windows oldest first and excludes gross pieces / exchanges", () => {
    expect(body).toContain("order by j.anos_atras desc");
    expect(body).not.toContain("pecas_brutas");
    expect(body).not.toContain("pecas_troca");
  });

  it("leaves V1.1 untouched", () => {
    expect(m).not.toContain("create or replace function public.get_vendas_metricas_periodo(");
    expect(m).not.toContain("create or replace function public.vendas_metricas_intervalo(");
    expect(m).not.toContain("create or replace function public.resolver_periodo_vendas(");
  });
});

describe("Relatório de vendas route wiring", () => {
  const route = read("src/routes/vendas/relatorio.tsx");

  it("defaults to Equipe and Incluir hoje = Sim without persisting either", () => {
    expect(route).toContain("useState<VendasVisao>(RELATORIO_VENDAS_VISAO_PADRAO)");
    expect(route).toContain("useState(true)");
    expect(route).not.toMatch(/localStorage|sessionStorage/);
  });

  it("only the visible view fetches, and unauthorized cargos fetch nothing", () => {
    expect(route).toContain('visao === "equipe" ? funcionarioId : null');
    expect(route).toContain('visao === "comparativo" ? funcionarioId : null');
    expect(route).toContain("allowed ? (session?.session_token ?? null) : null");
  });

  it("shows the Incluir hoje chip only in Comparativo, next to the period tabs", () => {
    expect(route).toContain('{visao === "comparativo" && (');
    expect(route.match(/<VendasIncluirHojeToggle/g)).toHaveLength(1);
    expect(route.indexOf("<VendasPeriodoSeletor")).toBeLessThan(
      route.indexOf("<VendasIncluirHojeToggle"),
    );
  });

  it("has no subtitle, puts the view tabs under the report and freshness at the bottom", () => {
    expect(route).not.toContain("SUBTITLE");
    const conteudo = route.indexOf("<VendasRelatorioConteudo");
    const visao = route.indexOf("<VendasVisaoSeletor");
    const atualizado = route.indexOf("formatVendasAtualizadoEm(atualizadoEm)");
    const periodo = route.indexOf("<VendasPeriodoSeletor");
    const barra = route.indexOf("<AuthUtilityBar");
    expect(periodo).toBeLessThan(conteudo);
    expect(conteudo).toBeLessThan(visao);
    expect(visao).toBeLessThan(atualizado);
    expect(atualizado).toBeLessThan(barra);
  });
});
