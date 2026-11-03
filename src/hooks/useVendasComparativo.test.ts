import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useSessionErrorHandler", () => ({ useSessionErrorHandler: () => () => false }));

import { RELATORIO_VENDAS_PERIODOS } from "@/config/constants";
import {
  fetchVendasComparativo,
  vendasComparativoQueryOptions,
} from "@/hooks/useVendasComparativo";

const ROW = {
  anos_atras: 0,
  data_inicio: "2026-11-01",
  data_fim: "2026-11-19",
  venda_liquida: 22709.16,
  tickets: 29,
  pecas_liquidas: 37,
  ticket_medio: 783.07,
  pa: 1.28,
  pm: 613.76,
  atualizado_em: "2026-11-19T15:00:00Z",
};

describe("fetchVendasComparativo", () => {
  beforeEach(() => rpc.mockReset());

  it("sends only the session token, the period key and the toggle — never a date or a role", async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const rows = await fetchVendasComparativo("tok", "mes", false);
    expect(rpc).toHaveBeenCalledWith("get_vendas_comparativo_periodo", {
      p_session_token: "tok",
      p_periodo: "mes",
      p_incluir_hoje: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].anos_atras).toBe(0);
  });

  it("returns an empty list for a null payload and throws RPC errors as-is", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchVendasComparativo("tok", "hoje", true)).toEqual([]);

    const error = { message: "SEM_PERMISSAO_VENDAS_RELATORIO" };
    rpc.mockResolvedValue({ data: null, error });
    await expect(fetchVendasComparativo("tok", "hoje", true)).rejects.toBe(error);
  });

  it("throws on a malformed row", async () => {
    rpc.mockResolvedValue({ data: [{ ...ROW, venda_liquida: "abc" }], error: null });
    await expect(fetchVendasComparativo("tok", "ano", true)).rejects.toThrow();
  });
});

describe("vendasComparativoQueryOptions", () => {
  beforeEach(() => rpc.mockReset());

  it("requests each period and toggle state exactly as selected", async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const client = new QueryClient();
    for (const { value } of RELATORIO_VENDAS_PERIODOS) {
      for (const incluirHoje of [true, false]) {
        await client.fetchQuery(vendasComparativoQueryOptions("f1", "tok", value, incluirHoje));
      }
    }
    expect(rpc).toHaveBeenCalledTimes(8);
    expect(rpc.mock.calls.map(([, args]) => [args.p_periodo, args.p_incluir_hoje])).toEqual([
      ["hoje", true],
      ["hoje", false],
      ["mes", true],
      ["mes", false],
      ["ano", true],
      ["ano", false],
      ["ultimos_12_meses", true],
      ["ultimos_12_meses", false],
    ]);
  });

  it("keeps a separate cache entry per period and toggle state", () => {
    const keys = RELATORIO_VENDAS_PERIODOS.flatMap((p) =>
      [true, false].map((t) =>
        JSON.stringify(vendasComparativoQueryOptions("f1", "tok", p.value, t).queryKey),
      ),
    );
    expect(new Set(keys).size).toBe(8);
  });

  it("refreshes every 60 seconds like the Equipe view", () => {
    expect(vendasComparativoQueryOptions("f1", "tok", "hoje", true).refetchInterval).toBe(60_000);
  });

  it("makes zero RPC calls without an authorized session (or while the view is hidden)", async () => {
    const client = new QueryClient();
    const options = vendasComparativoQueryOptions(null, null, "hoje", true);
    expect(options.enabled).toBe(false);

    const unsubscribe = new QueryObserver(client, options).subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    expect(rpc).not.toHaveBeenCalled();
  });
});
