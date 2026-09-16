import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  getTermosBuscaHistoricoLabel,
  TERMO_BUSCA_MAX_CHARS,
  TERMOS_BUSCA_ADICIONANDO_LABEL,
  TERMOS_BUSCA_ADICIONAR_LABEL,
  TERMOS_BUSCA_ADICIONAR_PLACEHOLDER,
  TERMOS_BUSCA_DESATIVAR_LABEL,
  TERMOS_BUSCA_ERRO_INVALIDO_MESSAGE,
  TERMOS_BUSCA_GERENCIAR_ERRO_MESSAGE,
  TERMOS_BUSCA_HISTORICO_VAZIO_MESSAGE,
  TERMOS_BUSCA_NENHUM_APROVADO_MESSAGE,
  TERMOS_BUSCA_ORIGEM_ADMIN_LABEL,
  TERMOS_BUSCA_REATIVAR_LABEL,
  TERMOS_BUSCA_STATUS_DESATIVADO_LABEL,
  TERMOS_BUSCA_STATUS_PENDENTE_LABEL,
  TERMOS_BUSCA_STATUS_REJEITADO_LABEL,
  TERMOS_BUSCA_SUGERIDO_POR_PREFIX,
  TERMOS_BUSCA_TERMO_ORIGINAL_PREFIX,
  TERMOS_BUSCA_TERMOS_APROVADOS_LABEL,
} from "@/config/constants";
import { useTermosBuscaAdminActions } from "@/hooks/useTermosBuscaAdminActions";
import { useTermosBuscaProdutoAdmin } from "@/hooks/useTermosBuscaProdutoAdmin";
import type { TermoBuscaAdmin } from "@/integrations/supabase/contracts";
import { formatManaus } from "@/lib/session";
import { canonicalizarTermoBusca } from "@/lib/termosBusca";
import { cn } from "@/lib/utils";

interface TermosBuscaProdutoAdminProps {
  sessionToken: string;
  produto: string;
  descProduto: string | null;
}

const STATUS_LABELS: Record<Exclude<TermoBuscaAdmin["status"], "aprovado">, string> = {
  pendente: TERMOS_BUSCA_STATUS_PENDENTE_LABEL,
  rejeitado: TERMOS_BUSCA_STATUS_REJEITADO_LABEL,
  desativado: TERMOS_BUSCA_STATUS_DESATIVADO_LABEL,
};

/**
 * Management panel for one produto: the approved terms always visible (with
 * Desativar), a direct-add input (approved immediately, attributed to the
 * admin), and the history — pending, rejected and deactivated rows — behind
 * "Ver histórico (N)". Deactivated rows offer Reativar.
 */
export function TermosBuscaProdutoAdmin({
  sessionToken,
  produto,
  descProduto,
}: TermosBuscaProdutoAdminProps) {
  const query = useTermosBuscaProdutoAdmin(sessionToken, produto);
  const { busyId, errorMessage, clearError, moderar, adicionar } =
    useTermosBuscaAdminActions(sessionToken);

  const [novoTermo, setNovoTermo] = useState("");
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  useEffect(() => {
    setNovoTermo("");
    setErroLocal(null);
    setHistoricoAberto(false);
    clearError();
  }, [produto, clearError]);

  const rows = query.data ?? [];
  const aprovados = rows.filter((t) => t.status === "aprovado");
  const historico = rows.filter((t) => t.status !== "aprovado");

  const handleAdicionar = async () => {
    const canonico = canonicalizarTermoBusca(novoTermo);
    if (!canonico) {
      setErroLocal(TERMOS_BUSCA_ERRO_INVALIDO_MESSAGE);
      return;
    }
    setErroLocal(null);
    const ok = await adicionar(produto, canonico);
    if (ok) setNovoTermo("");
  };

  const erro = erroLocal ?? errorMessage;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{produto}</h2>
        {descProduto && <p className="text-sm text-muted-foreground">{descProduto}</p>}
      </header>

      {query.isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : query.isError ? (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <p className="text-sm text-destructive">{TERMOS_BUSCA_GERENCIAR_ERRO_MESSAGE}</p>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {TERMOS_BUSCA_TERMOS_APROVADOS_LABEL}
            </h3>
            {aprovados.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {TERMOS_BUSCA_NENHUM_APROVADO_MESSAGE}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
                {aprovados.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">{t.termo}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.origem === "admin"
                          ? `${TERMOS_BUSCA_ORIGEM_ADMIN_LABEL} · ${t.sugerido_por_nome}`
                          : `${TERMOS_BUSCA_SUGERIDO_POR_PREFIX} ${t.sugerido_por_nome}`}
                        {t.moderado_em && ` · ${formatManaus(t.moderado_em)}`}
                      </span>
                      {t.termo_sugerido !== t.termo && (
                        <span className="text-xs text-muted-foreground">
                          {TERMOS_BUSCA_TERMO_ORIGINAL_PREFIX} {t.termo_sugerido}
                        </span>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-touch shrink-0 text-destructive hover:text-destructive"
                      disabled={busyId !== null}
                      onClick={() => void moderar(t.id, produto, "desativar")}
                    >
                      {busyId === t.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        TERMOS_BUSCA_DESATIVAR_LABEL
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                maxLength={TERMO_BUSCA_MAX_CHARS}
                placeholder={TERMOS_BUSCA_ADICIONAR_PLACEHOLDER}
                aria-label={TERMOS_BUSCA_ADICIONAR_LABEL}
                value={novoTermo}
                disabled={busyId !== null}
                onChange={(event) => {
                  setNovoTermo(event.target.value);
                  if (erroLocal) setErroLocal(null);
                  if (errorMessage) clearError();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleAdicionar();
                  }
                }}
                className="min-touch text-base"
              />
              <Button
                type="button"
                className="min-touch shrink-0"
                disabled={busyId !== null || novoTermo.trim().length === 0}
                onClick={() => void handleAdicionar()}
              >
                {busyId === "novo" ? TERMOS_BUSCA_ADICIONANDO_LABEL : TERMOS_BUSCA_ADICIONAR_LABEL}
              </Button>
            </div>
            {erro && <p className="text-xs text-destructive">{erro}</p>}
          </div>

          <Collapsible open={historicoAberto} onOpenChange={setHistoricoAberto}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-touch -ml-3 w-fit gap-1 text-muted-foreground"
              >
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", historicoAberto && "rotate-180")}
                  aria-hidden
                />
                {getTermosBuscaHistoricoLabel(historico.length)}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1">
              {historico.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {TERMOS_BUSCA_HISTORICO_VAZIO_MESSAGE}
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
                  {historico.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="flex flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {t.termo}{" "}
                          <span className="font-normal text-muted-foreground">
                            · {STATUS_LABELS[t.status as keyof typeof STATUS_LABELS]}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {TERMOS_BUSCA_SUGERIDO_POR_PREFIX} {t.sugerido_por_nome} ·{" "}
                          {formatManaus(t.sugerido_em)}
                        </span>
                        {t.status === "rejeitado" && t.moderado_por_nome && t.moderado_em && (
                          <span className="text-xs text-muted-foreground">
                            {TERMOS_BUSCA_STATUS_REJEITADO_LABEL} por {t.moderado_por_nome} ·{" "}
                            {formatManaus(t.moderado_em)}
                          </span>
                        )}
                        {t.status === "desativado" && t.desativado_por_nome && t.desativado_em && (
                          <span className="text-xs text-muted-foreground">
                            {TERMOS_BUSCA_STATUS_DESATIVADO_LABEL} por {t.desativado_por_nome} ·{" "}
                            {formatManaus(t.desativado_em)}
                          </span>
                        )}
                        {t.termo_sugerido !== t.termo && (
                          <span className="text-xs text-muted-foreground">
                            {TERMOS_BUSCA_TERMO_ORIGINAL_PREFIX} {t.termo_sugerido}
                          </span>
                        )}
                      </div>
                      {t.status === "desativado" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-touch shrink-0"
                          disabled={busyId !== null}
                          onClick={() => void moderar(t.id, produto, "reativar")}
                        >
                          {busyId === t.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            TERMOS_BUSCA_REATIVAR_LABEL
                          )}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </section>
  );
}
