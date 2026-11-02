import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useSessionErrorHandler", () => ({ useSessionErrorHandler: () => () => false }));

import { fetchVendasMetricasMtd } from "@/hooks/useVendasMetricasMtd";

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

describe("fetchVendasMetricasMtd", () => {
  beforeEach(() => rpc.mockReset());

  it("calls the RPC with only the session token and returns parsed rows", async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const rows = await fetchVendasMetricasMtd("tok");
    expect(rpc).toHaveBeenCalledWith("get_vendas_metricas_mtd", { p_session_token: "tok" });
    expect(rows).toHaveLength(1);
    expect(rows[0].eh_total).toBe(true);
  });

  it("returns an empty list for a null payload", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchVendasMetricasMtd("tok")).toEqual([]);
  });

  it("throws the RPC error", async () => {
    const error = { message: "INVALID_SESSION" };
    rpc.mockResolvedValue({ data: null, error });
    await expect(fetchVendasMetricasMtd("tok")).rejects.toBe(error);
  });

  it("throws on a malformed row", async () => {
    rpc.mockResolvedValue({ data: [{ ...ROW, venda_liquida: "abc" }], error: null });
    await expect(fetchVendasMetricasMtd("tok")).rejects.toThrow();
  });
});
