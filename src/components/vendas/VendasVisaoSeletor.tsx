import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RELATORIO_VENDAS_VISAO_ARIA_LABEL, RELATORIO_VENDAS_VISOES } from "@/config/constants";
import { isVendasVisao, type VendasVisao } from "@/lib/vendasComparativo";

interface VendasVisaoSeletorProps {
  value: VendasVisao;
  onChange: (visao: VendasVisao) => void;
}

/** Equipe (salesperson table) | Comparativo (store-level multi-year comparison). */
export function VendasVisaoSeletor({ value, onChange }: VendasVisaoSeletorProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (isVendasVisao(next)) onChange(next);
      }}
      className="px-2.5"
    >
      <TabsList
        aria-label={RELATORIO_VENDAS_VISAO_ARIA_LABEL}
        className="grid h-auto w-full grid-cols-2 gap-1"
      >
        {RELATORIO_VENDAS_VISOES.map((visao) => (
          <TabsTrigger key={visao.value} value={visao.value} className="min-h-11">
            {visao.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
