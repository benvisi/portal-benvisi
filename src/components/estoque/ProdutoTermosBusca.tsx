import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  TERMO_BUSCA_MAX_CHARS,
  TERMOS_BUSCA_ERRO_CARREGAR_MESSAGE,
  TERMOS_BUSCA_ERRO_INVALIDO_MESSAGE,
  TERMOS_BUSCA_MINHA_PENDENTE_PREFIX,
  TERMOS_BUSCA_NENHUM_APROVADO_MESSAGE,
  TERMOS_BUSCA_SECAO_LABEL,
  TERMOS_BUSCA_SUGERIR_CANCELAR_LABEL,
  TERMOS_BUSCA_SUGERIR_ENVIANDO_LABEL,
  TERMOS_BUSCA_SUGERIR_ENVIAR_LABEL,
  TERMOS_BUSCA_SUGERIR_GUIA_MESSAGE,
  TERMOS_BUSCA_SUGERIR_LABEL,
  TERMOS_BUSCA_SUGERIR_PLACEHOLDER,
  TERMOS_BUSCA_SUGERIR_SUCESSO_MESSAGE,
} from "@/config/constants";
import { useProdutoTermosBusca } from "@/hooks/useProdutoTermosBusca";
import { useSugerirTermoBusca } from "@/hooks/useSugerirTermoBusca";
import { canonicalizarTermoBusca } from "@/lib/termosBusca";
import { cn } from "@/lib/utils";

interface ProdutoTermosBuscaProps {
  sessionToken: string;
  produto: string;
}

/**
 * Termos de busca V1, employee side. Sits under the stock matrix, visually
 * subordinate to it: the approved terms as small chips, the caller's own
 * pending suggestion(s) read-only, and a collapsed "Sugerir termo de busca"
 * action (one term per submission, admin approval required before it
 * affects search). Never shows other employees' pending/rejected history.
 */
export function ProdutoTermosBusca({ sessionToken, produto }: ProdutoTermosBuscaProps) {
  const query = useProdutoTermosBusca(sessionToken, produto);
  const { sending, errorMessage, clearError, sugerir } = useSugerirTermoBusca(sessionToken);

  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  // A new produto means a fresh form: no stale draft, error or confirmation.
  useEffect(() => {
    setAberto(false);
    setTermo("");
    setErroLocal(null);
    setSucesso(false);
    clearError();
  }, [produto, clearError]);

  const termos = query.data ?? [];
  const aprovados = termos.filter((t) => t.status === "aprovado");
  const minhasPendentes = termos.filter((t) => t.status === "pendente");

  const handleSubmit = async () => {
    const canonico = canonicalizarTermoBusca(termo);
    if (!canonico) {
      setErroLocal(TERMOS_BUSCA_ERRO_INVALIDO_MESSAGE);
      return;
    }
    setErroLocal(null);
    const ok = await sugerir(produto, canonico);
    if (ok) {
      setTermo("");
      setAberto(false);
      setSucesso(true);
    }
  };

  const erro = erroLocal ?? errorMessage;

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {TERMOS_BUSCA_SECAO_LABEL}
      </h3>

      {query.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
      ) : query.isError ? (
        <p className="text-xs text-destructive">{TERMOS_BUSCA_ERRO_CARREGAR_MESSAGE}</p>
      ) : aprovados.length === 0 ? (
        <p className="text-xs text-muted-foreground">{TERMOS_BUSCA_NENHUM_APROVADO_MESSAGE}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {aprovados.map((t) => (
            <li key={t.id}>
              <Badge variant="secondary" className="font-normal">
                {t.termo}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {minhasPendentes.map((t) => (
        <p key={t.id} className="text-xs text-muted-foreground">
          {TERMOS_BUSCA_MINHA_PENDENTE_PREFIX}{" "}
          <span className="font-medium text-foreground">{t.termo}</span>
        </p>
      ))}

      {sucesso && !aberto && (
        <p className="text-xs font-medium text-foreground">
          {TERMOS_BUSCA_SUGERIR_SUCESSO_MESSAGE}
        </p>
      )}

      <Collapsible
        open={aberto}
        onOpenChange={(open) => {
          setAberto(open);
          if (open) setSucesso(false);
        }}
      >
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-touch -ml-3 w-fit gap-1 text-muted-foreground"
          >
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", aberto && "rotate-180")}
              aria-hidden
            />
            {TERMOS_BUSCA_SUGERIR_LABEL}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="flex flex-col gap-3 pt-1">
          <p className="text-xs text-muted-foreground">{TERMOS_BUSCA_SUGERIR_GUIA_MESSAGE}</p>

          <Input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="none"
            maxLength={TERMO_BUSCA_MAX_CHARS}
            placeholder={TERMOS_BUSCA_SUGERIR_PLACEHOLDER}
            aria-label={TERMOS_BUSCA_SUGERIR_LABEL}
            value={termo}
            disabled={sending}
            onChange={(event) => {
              setTermo(event.target.value);
              if (erroLocal) setErroLocal(null);
              if (errorMessage) clearError();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            className="min-touch text-base"
          />

          {erro && <p className="text-xs text-destructive">{erro}</p>}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-touch"
              disabled={sending || termo.trim().length === 0}
              onClick={() => void handleSubmit()}
            >
              {sending ? TERMOS_BUSCA_SUGERIR_ENVIANDO_LABEL : TERMOS_BUSCA_SUGERIR_ENVIAR_LABEL}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-touch"
              disabled={sending}
              onClick={() => {
                setAberto(false);
                setTermo("");
                setErroLocal(null);
                clearError();
              }}
            >
              {TERMOS_BUSCA_SUGERIR_CANCELAR_LABEL}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
