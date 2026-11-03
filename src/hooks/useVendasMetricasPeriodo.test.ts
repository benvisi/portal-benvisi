import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useSessionErrorHandler", () => ({ useSessionErrorHandler: () => () => false }));

import {
  fetchVendasMetricasPeriodo,
  vendasMetricasPeriodoQueryOptions,
} from "@/hooks/useVendasMetricasPeriodo";
import { RELATORIO_VENDAS_PERIODOS } from "@/config/constants";

const ROW = {
  funcionario_id: null,
  vendedor_nome: "Total da loja",
  eh_outros: false,
  eh_total: true,
  venda_liquida: 16646.44,
  tickets: 22,
  pecas_brutas: 31,
  pecas_troca: 5,
  pecas_liquidas: 26,
  ticket_medio: 756.66,
  pa: 1.18,
  pm: 640.25,
  atualizado_em: "2026-11-02T02:57:21Z",
};

describe("fetchVendasMetricasPeriodo", () => {
  beforeEach(() => rpc.mockReset());

  it("calls the RPC with only the session token and the period key, and returns parsed rows", async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const rows = await fetchVendasMetricasPeriodo("tok", "mes");
    expect(rpc).toHaveBeenCalledWith("get_vendas_metricas_periodo", {
      p_session_token: "tok",
      p_periodo: "mes",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].eh_total).toBe(true);
  });

  it("returns an empty list for a null payload", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchVendasMetricasPeriodo("tok", "hoje")).toEqual([]);
  });

  it("throws the RPC error", async () => {
    const error = { message: "INVALID_SESSION" };
    rpc.mockResolvedValue({ data: null, error });
    await expect(fetchVendasMetricasPeriodo("tok", "hoje")).rejects.toBe(error);
  });

  it("throws on a malformed row", async () => {
    rpc.mockResolvedValue({ data: [{ ...ROW, venda_liquida: "abc" }], error: null });
    await expect(fetchVendasMetricasPeriodo("tok", "ano")).rejects.toThrow();
  });
});

describe("vendasMetricasPeriodoQueryOptions", () => {
  beforeEach(() => rpc.mockReset());

  it("requests exactly the selected period for each of the four periods", async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const client = new QueryClient();
    const periodos = ["hoje", "mes", "ano", "ultimos_12_meses"] as const;

    for (const periodo of periodos) {
      await client.fetchQuery(vendasMetricasPeriodoQueryOptions("f1", "tok", periodo));
    }

    expect(rpc.mock.calls.map(([name, args]) => [name, args.p_periodo])).toEqual(
      periodos.map((periodo) => ["get_vendas_metricas_periodo", periodo]),
    );
  });

  it("keeps a separate cache entry per period (the period is in the query key)", () => {
    const keys = RELATORIO_VENDAS_PERIODOS.map(
      (p) => vendasMetricasPeriodoQueryOptions("f1", "tok", p.value).queryKey,
    );
    expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(4);
    for (const [i, p] of RELATORIO_VENDAS_PERIODOS.entries()) expect(keys[i]).toContain(p.value);
  });

  it("keeps the 60-second automatic refresh", () => {
    expect(vendasMetricasPeriodoQueryOptions("f1", "tok", "hoje").refetchInterval).toBe(60_000);
  });

  it("makes zero RPC calls when there is no authorized session (unauthorized cargo)", async () => {
    const client = new QueryClient();
    // The route passes null/null for a cargo that cannot view the report.
    const options = vendasMetricasPeriodoQueryOptions(null, null, "hoje");
    expect(options.enabled).toBe(false);

    const unsubscribe = new QueryObserver(client, options).subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    expect(rpc).not.toHaveBeenCalled();
  });
});
