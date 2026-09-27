import { Loader2 } from "lucide-react";

import { AtendimentoResumoAtendimentoRow } from "@/components/atendimento/AtendimentoResumoAtendimentoRow";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ATENDIMENTO_RESUMO_HOJE_EMPTY_MESSAGE,
  ATENDIMENTO_RESUMO_HOJE_LOADING_MESSAGE,
  ATENDIMENTO_RESUMO_HOJE_POR_ATENDIMENTO_LABEL,
  ATENDIMENTO_RESUMO_HOJE_POR_ATENDIMENTO_VAZIO_MESSAGE,
  ATENDIMENTO_RESUMO_HOJE_POR_VENDEDOR_LABEL,
  ATENDIMENTO_RESUMO_HOJE_TITLE,
  getAtendimentoResumoHojeHeadline,
} from "@/config/constants";
import type { AtendimentoResumoHojeLinha } from "@/integrations/supabase/contracts";
import {
  agruparAtendimentoResumoHoje,
  calcularConversaoPercentual,
} from "@/lib/atendimentoResumoHoje";

interface AtendimentoResumoHojeCardProps {
  linhas: AtendimentoResumoHojeLinha[];
  isLoading: boolean;
}

/**
 * Card #36 — read-only, store-wide "Atendimentos de hoje" accordion, placed
 * directly below Lista da Vez. Everyone sees the same data (no role-based
 * gating): the collapsed header already shows the store headline; expanding
 * reveals "Por vendedor" (default) and "Por atendimento". Both views are
 * derived client-side from the one flat RPC payload — see
 * src/lib/atendimentoResumoHoje.ts.
 */
export function AtendimentoResumoHojeCard({ linhas, isLoading }: AtendimentoResumoHojeCardProps) {
  const resumo = agruparAtendimentoResumoHoje(linhas);
  const conversaoPercentual = calcularConversaoPercentual(
    resumo.totalConvertidos,
    resumo.totalOutcomes,
  );
  const headline =
    resumo.totalAtendimentos === 0
      ? ATENDIMENTO_RESUMO_HOJE_EMPTY_MESSAGE
      : getAtendimentoResumoHojeHeadline(
          resumo.totalAtendimentos,
          resumo.totalConvertidos,
          conversaoPercentual,
        );

  return (
    <Card className="p-6 shadow-card">
      <Accordion type="single" collapsible>
        <AccordionItem value="resumo-hoje" className="border-none">
          <AccordionTrigger className="items-start gap-3 py-0 hover:no-underline">
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-base font-semibold text-foreground">
                {ATENDIMENTO_RESUMO_HOJE_TITLE}
              </span>
              <span className="text-sm font-normal text-muted-foreground">{headline}</span>
            </span>
          </AccordionTrigger>

          <AccordionContent className="pt-4">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {ATENDIMENTO_RESUMO_HOJE_LOADING_MESSAGE}
              </div>
            ) : (
              <Tabs defaultValue="vendedor">
                <TabsList className="grid h-auto w-full grid-cols-2 gap-1">
                  <TabsTrigger value="vendedor" className="min-h-11">
                    {ATENDIMENTO_RESUMO_HOJE_POR_VENDEDOR_LABEL}
                  </TabsTrigger>
                  <TabsTrigger value="atendimento" className="min-h-11">
                    {ATENDIMENTO_RESUMO_HOJE_POR_ATENDIMENTO_LABEL}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="vendedor" className="mt-4">
                  <Accordion type="multiple" className="flex flex-col gap-2">
                    {resumo.porVendedor.map((vendedor) => {
                      const vendedorConversao = calcularConversaoPercentual(
                        vendedor.totalConvertidos,
                        vendedor.totalOutcomes,
                      );
                      const vendedorHeadline =
                        vendedor.totalAtendimentos === 0
                          ? ATENDIMENTO_RESUMO_HOJE_EMPTY_MESSAGE
                          : getAtendimentoResumoHojeHeadline(
                              vendedor.totalAtendimentos,
                              vendedor.totalConvertidos,
                              vendedorConversao,
                            );

                      // A vendedor with nothing to show today gets a plain,
                      // non-expandable row — only vendedores with at least
                      // one atendimento are independently expandable.
                      if (vendedor.atendimentos.length === 0) {
                        return (
                          <div
                            key={vendedor.funcionarioId}
                            className="flex flex-col gap-0.5 rounded-lg border border-border px-3 py-3"
                          >
                            <span className="text-sm font-semibold text-foreground">
                              {vendedor.nome}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {vendedorHeadline}
                            </span>
                          </div>
                        );
                      }

                      return (
                        <AccordionItem
                          key={vendedor.funcionarioId}
                          value={vendedor.funcionarioId}
                          className="rounded-lg border border-border px-3"
                        >
                          <AccordionTrigger className="items-start gap-3 py-3 hover:no-underline">
                            <span className="flex flex-col gap-0.5 text-left">
                              <span className="text-sm font-semibold text-foreground">
                                {vendedor.nome}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {vendedorHeadline}
                              </span>
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="pb-3">
                            <ul className="flex flex-col gap-2">
                              {vendedor.atendimentos.map((item) => (
                                <AtendimentoResumoAtendimentoRow
                                  key={item.idAtendimento}
                                  item={item}
                                />
                              ))}
                            </ul>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </TabsContent>

                <TabsContent value="atendimento" className="mt-4">
                  {resumo.porAtendimento.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {ATENDIMENTO_RESUMO_HOJE_POR_ATENDIMENTO_VAZIO_MESSAGE}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {resumo.porAtendimento.map((item) => (
                        <AtendimentoResumoAtendimentoRow
                          key={item.idAtendimento}
                          item={item}
                          funcionarioNome={item.funcionarioNome}
                        />
                      ))}
                    </ul>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
