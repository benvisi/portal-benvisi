import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RELATORIO_VENDAS_INCLUIR_HOJE_LABEL,
  RELATORIO_VENDAS_INCLUIR_HOJE_OPCOES,
} from "@/config/constants";

interface VendasIncluirHojeToggleProps {
  value: boolean;
  onChange: (incluirHoje: boolean) => void;
}

/** "Incluir hoje?" Sim | Não — the active option is the filled segment. */
export function VendasIncluirHojeToggle({ value, onChange }: VendasIncluirHojeToggleProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-2.5">
      <span id="vendas-incluir-hoje-label" className="text-sm font-medium text-foreground">
        {RELATORIO_VENDAS_INCLUIR_HOJE_LABEL}
      </span>
      <Tabs
        value={value ? "sim" : "nao"}
        onValueChange={(next) => {
          if (next === "sim" || next === "nao") onChange(next === "sim");
        }}
      >
        <TabsList
          aria-labelledby="vendas-incluir-hoje-label"
          className="grid h-auto grid-cols-2 gap-1"
        >
          {RELATORIO_VENDAS_INCLUIR_HOJE_OPCOES.map((opcao) => (
            <TabsTrigger key={opcao.value} value={opcao.value} className="min-h-11 min-w-16">
              {opcao.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
