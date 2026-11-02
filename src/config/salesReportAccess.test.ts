import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ROUTES } from "@/config/routes";
import { canViewRelatorioVendas } from "@/lib/vendasRelatorio";

// Structural checks (the repo's test setup has no router/DOM harness for
// route components): they read the source of the navigation/route files and
// the migrations, so a regression in the information architecture or in the
// authorization wiring fails loudly.
function read(relativeFromRepoRoot: string): string {
  return readFileSync(new URL(`../../${relativeFromRepoRoot}`, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

describe("Dashboard information architecture", () => {
  const dashboard = read("src/routes/dashboard.tsx");

  it("links Lista da Vez and Consulta de Estoque directly from the Dashboard", () => {
    expect(dashboard).toContain("ROUTES.ATENDIMENTO");
    expect(dashboard).toContain("ROUTES.ESTOQUE");
    expect(dashboard).toContain("CONSULTA_ESTOQUE_TITLE");
  });

  it("no longer has the Vendas hub", () => {
    expect(dashboard).not.toContain("VENDAS");
    expect(Object.keys(ROUTES)).not.toContain("VENDAS");
    expect(existsSync(new URL("../routes/vendas/index.tsx", import.meta.url))).toBe(false);
  });

  it("does not link the sales report from the Dashboard", () => {
    expect(dashboard).not.toContain("RELATORIO_VENDAS");
  });
});

describe("Operações information architecture", () => {
  const operacoes = read("src/routes/operacoes/index.tsx");

  it("contains Mensagens para WhatsApp for every employee", () => {
    expect(operacoes).toContain("ROUTES.OPERACOES_MENSAGENS_WHATSAPP");
    // The WhatsApp card is rendered before, and outside, the role-gated block.
    expect(operacoes.indexOf("icon={MessageCircle}")).toBeGreaterThan(-1);
    expect(operacoes.indexOf("icon={MessageCircle}")).toBeLessThan(
      operacoes.indexOf("canViewRelatorioVendas(session.cargo) &&"),
    );
  });

  it("shows Relatório de vendas only behind the Gerente/Administrador check", () => {
    expect(operacoes).toMatch(
      /canViewRelatorioVendas\(session\.cargo\) && \(\s*<ModuleCard[^>]*icon=\{BarChart3\}/,
    );
  });

  it("keeps the WhatsApp and stock pages' own back navigation consistent", () => {
    expect(read("src/routes/operacoes/mensagens-whatsapp.tsx")).toContain(
      "useGoBack(ROUTES.OPERACOES)",
    );
    expect(read("src/routes/estoque.tsx")).toContain("useGoBack(ROUTES.DASHBOARD)");
  });
});

describe("Relatório de vendas route guard", () => {
  const route = read("src/routes/vendas/relatorio.tsx");

  it("redirects unauthorized cargos and never renders or fetches for them", () => {
    expect(route).toContain("canViewRelatorioVendas(session?.cargo)");
    expect(route).toContain("ROUTES.DASHBOARD");
    expect(route).toContain("if (!ready || !session || !allowed) return null;");
    // The RPC hook only receives credentials when allowed.
    expect(route).toContain("allowed ? (session?.session_token ?? null) : null");
  });

  it("goes back to Operações", () => {
    expect(route).toContain("useGoBack(ROUTES.OPERACOES)");
  });
});

describe("canViewRelatorioVendas", () => {
  it("allows Administrador and Gerente only", () => {
    expect(canViewRelatorioVendas("Administrador")).toBe(true);
    expect(canViewRelatorioVendas("Gerente")).toBe(true);
    expect(canViewRelatorioVendas("Vendedor")).toBe(false);
    expect(canViewRelatorioVendas("Caixa")).toBe(false);
    expect(canViewRelatorioVendas("")).toBe(false);
    expect(canViewRelatorioVendas(null)).toBe(false);
    expect(canViewRelatorioVendas(undefined)).toBe(false);
  });
});

describe("get_vendas_metricas_mtd server-side authorization (migration 106)", () => {
  const m105 = read("supabase/migrations/20261002_105_add_vendas_metricas_mtd_rpc.sql");
  const m106 = read(
    "supabase/migrations/20261002_106_restrict_vendas_metricas_mtd_to_gerente_admin.sql",
  );

  function functionBody(sql: string): string {
    const start = sql.indexOf("create or replace function public.get_vendas_metricas_mtd(");
    const end = sql.indexOf("\n$$;", start);
    return sql.slice(start, end);
  }

  const CHECK = [
    "  -- V1 interim policy: Relatório de vendas is Gerente/Administrador only.",
    "  -- The cargo comes from the validated server-side session context (the",
    "  -- database row), never from anything the browser sends.",
    "  if v_ctx.cargo is null or v_ctx.cargo not in ('Gerente', 'Administrador') then",
    "    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_VENDAS_RELATORIO';",
    "  end if;",
    "",
  ].join("\n");

  it("rejects non-Gerente/Administrador sessions using the server-side cargo", () => {
    const body = functionBody(m106);
    expect(body).toContain("v_ctx.cargo not in ('Gerente', 'Administrador')");
    expect(body).toContain("SEM_PERMISSAO_VENDAS_RELATORIO");
    // The check runs after session validation and before any data is read.
    expect(body.indexOf("INVALID_SESSION")).toBeLessThan(
      body.indexOf("SEM_PERMISSAO_VENDAS_RELATORIO"),
    );
    expect(body.indexOf("SEM_PERMISSAO_VENDAS_RELATORIO")).toBeLessThan(
      body.indexOf("vendas_diarias_vendedor"),
    );
    // No client-supplied role parameter was introduced.
    expect(body).toContain("p_session_token text,\n  p_codigo_filial text default '060420'");
  });

  it("changes nothing else in the function: calculations are identical to 105", () => {
    expect(functionBody(m106).replace(CHECK, "")).toBe(functionBody(m105));
  });

  it("keeps SECURITY DEFINER, search_path and the anon-only grant", () => {
    expect(m106).toContain("security definer");
    expect(m106).toContain("set search_path = public");
    expect(m106).toContain(
      "revoke all on function public.get_vendas_metricas_mtd(text, text) from public;",
    );
    expect(m106).toContain(
      "grant execute on function public.get_vendas_metricas_mtd(text, text) to anon;",
    );
    expect(m106).not.toMatch(/grant execute[^;]*(authenticated|service_role)/);
  });

  it("does not edit the deployed migration 105 in place", () => {
    expect(m105).not.toContain("SEM_PERMISSAO_VENDAS_RELATORIO");
  });
});
