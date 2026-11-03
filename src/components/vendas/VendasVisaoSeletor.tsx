import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RELATORIO_VENDAS_VISAO_ARIA_LABEL, RELATORIO_VENDAS_VISOES } from "@/config/constants";
import { isVendasVisao, type VendasVisao } from "@/lib/vendasComparativo";

interface VendasVisaoSeletorProps {
  value: VendasVisao;
  onChange: (visao: VendasVisao) => void;
}

/**
 * Equipe | Comparativo as worksheet-style tabs hanging below the report: a
 * green rule joins them to the table above and the active tab is filled green.
 */
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
        className="h-auto w-full justify-start gap-1 rounded-none border-t-2 border-brand bg-transparent p-0"
      >
        {RELATORIO_VENDAS_VISOES.map((visao) => (
          <TabsTrigger
            key={visao.value}
            value={visao.value}
            className="min-h-11 rounded-b-lg rounded-t-none bg-muted px-5 text-muted-foreground data-[state=active]:bg-brand data-[state=active]:text-brand-foreground data-[state=active]:shadow-none"
          >
            {visao.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
