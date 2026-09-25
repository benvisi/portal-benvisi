import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import {
  ESTOQUE_TAMANHO_BR_LABEL,
  ESTOQUE_TAMANHO_UK_LABEL,
  TAMANHOS_CALCADOS_INFANTIL_AVISO,
  TAMANHOS_CALCADOS_PAGE_SUBTITLE,
  TAMANHOS_CALCADOS_TITLE,
  VOLTAR_A_CONHECIMENTO_CULTURA_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import {
  SEGMENTO_CALCADO_LABEL,
  SEGMENTOS_CALCADO,
  getTabelaConversaoCalcado,
} from "@/lib/conversaoTamanhoCalcado";
import { cn } from "@/lib/utils";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";

export const Route = createFileRoute("/conhecimento-cultura/tamanhos-calcados")({
  head: () => ({
    meta: [
      { title: "Tamanhos de calçados — Portal Benvisi" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TamanhosCalcadosPage,
});

// Footwear UK/BR size conversion (20260925): static reference tables, one
// per segmento, reading the SAME shared mapping
// (src/lib/conversaoTamanhoCalcado) that Consulta de Estoque converts
// against — never a separately hard-coded copy of these values. Infantil is
// intentionally partial (business-supplied); no guessed/interpolated size
// is ever shown.
function TamanhosCalcadosPage() {
  const goBack = useGoBack(ROUTES.CONHECIMENTO_CULTURA);
  const { session, ready } = useRequireSession();

  if (!ready || !session) return null;

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <header className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-touch shrink-0"
            onClick={goBack}
            aria-label={VOLTAR_A_CONHECIMENTO_CULTURA_LABEL}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="text-xl font-semibold text-foreground">{TAMANHOS_CALCADOS_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{TAMANHOS_CALCADOS_PAGE_SUBTITLE}</p>

        <div className="flex flex-col gap-4">
          {SEGMENTOS_CALCADO.map((segmento) => {
            const tabela = getTabelaConversaoCalcado(segmento);
            return (
              <section
                key={segmento}
                className="rounded-2xl border border-border bg-card p-4 shadow-card"
              >
                <h2 className="mb-3 text-base font-semibold text-foreground">
                  {SEGMENTO_CALCADO_LABEL[segmento]}
                </h2>
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="border-b-2 border-r-2 border-brand-foreground/15 bg-brand px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-brand-foreground first:rounded-tl-lg"
                      >
                        {ESTOQUE_TAMANHO_UK_LABEL}
                      </th>
                      <th
                        scope="col"
                        className="border-b-2 border-brand/20 bg-brand/10 px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-brand last:rounded-tr-lg"
                      >
                        {ESTOQUE_TAMANHO_BR_LABEL}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tabela.map(([tamanhoUk, tamanhoBr], index) => {
                      const stripe = index % 2 === 1 ? "bg-zebra" : "bg-card";
                      return (
                        <tr key={tamanhoUk}>
                          <td
                            className={cn(
                              "border-b border-r-2 border-border px-2 py-1.5 text-center tabular-nums text-foreground",
                              stripe,
                            )}
                          >
                            {tamanhoUk}
                          </td>
                          <td
                            className={cn(
                              "border-b border-border px-2 py-1.5 text-center tabular-nums font-semibold text-foreground",
                              stripe,
                            )}
                          >
                            {tamanhoBr}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {segmento === "infantil" && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {TAMANHOS_CALCADOS_INFANTIL_AVISO}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <AuthUtilityBar />
    </main>
  );
}
