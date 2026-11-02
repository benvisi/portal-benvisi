import { useQuery } from "@tanstack/react-query";

import { getVendasMetricasMtdMock } from "@/lib/vendasRelatorioMock";

// Mock-backed for Slice B UI work. Swap `queryFn` for the
// `get_vendas_metricas_mtd` RPC call when wiring live data.
export function useVendasMetricasMtd() {
  return useQuery({
    queryKey: ["vendas-metricas-mtd", "mock"],
    queryFn: getVendasMetricasMtdMock,
  });
}
