import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getTermosBuscaOutrosProdutosLabel,
  TERMO_BUSCA_MAX_CHARS,
  TERMOS_BUSCA_APROVAR_LABEL,
  TERMOS_BUSCA_CANCELAR_LABEL,
  TERMOS_BUSCA_CONFIRMAR_LABEL,
  TERMOS_BUSCA_EDITAR_APROVAR_LABEL,
  TERMOS_BUSCA_ERRO_INVALIDO_MESSAGE,
  TERMOS_BUSCA_NENHUM_APROVADO_MESSAGE,
  TERMOS_BUSCA_REJEITAR_LABEL,
  TERMOS_BUSCA_SUGERIDO_POR_PREFIX,
  TERMOS_BUSCA_TERMO_PROPOSTO_LABEL,
  TERMOS_BUSCA_TERMOS_APROVADOS_LABEL,
} from "@/config/constants";
import type { TermoBuscaPendente } from "@/integrations/supabase/contracts";
import { formatManaus } from "@/lib/session";
import { canonicalizarTermoBusca } from "@/lib/termosBusca";

interface TermosBuscaPendenteCardProps {
  pendente: TermoBuscaPendente;
  busy: boolean;
  onAprovar: (termoFinal?: string) => Promise<boolean>;
  onRejeitar: () => Promise<boolean>;
}

/**
 * One moderation-queue entry with everything needed to decide in place:
 * produto + description, the proposed term, who/when, the produto's current
 * approved terms and whether the same vocabulary is already approved on
 * other produtos. "Editar e aprovar" swaps in an inline input — the edited
 * value goes through the same validation/duplicate rules server-side.
 */
export function TermosBuscaPendenteCard({
  pendente,
  busy,
  onAprovar,
  onRejeitar,
}: TermosBuscaPendenteCardProps) {
  const [editando, setEditando] = useState(false);
  const [termoEditado, setTermoEditado] = useState(pendente.termo);
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  const confirmarEdicao = async () => {
    const canonico = canonicalizarTermoBusca(termoEditado);
    if (!canonico) {
      setErroLocal(TERMOS_BUSCA_ERRO_INVALIDO_MESSAGE);
      return;
    }
    setErroLocal(null);
    const ok = await onAprovar(canonico);
    if (ok) setEditando(false);
  };

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-base font-semibold text-foreground">{pendente.produto}</span>
        {pendente.desc_produto && (
          <span className="text-xs text-muted-foreground">{pendente.desc_produto}</span>
        )}
      </header>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {TERMOS_BUSCA_TERMO_PROPOSTO_LABEL}
        </span>
        <span className="text-lg font-semibold text-foreground">{pendente.termo}</span>
        <span className="text-xs text-muted-foreground">
          {TERMOS_BUSCA_SUGERIDO_POR_PREFIX} {pendente.sugerido_por_nome} ·{" "}
          {formatManaus(pendente.sugerido_em)}
        </span>
        {pendente.outros_produtos_mesmo_termo > 0 && (
          <span className="text-xs text-muted-foreground">
            {getTermosBuscaOutrosProdutosLabel(pendente.outros_produtos_mesmo_termo)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {TERMOS_BUSCA_TERMOS_APROVADOS_LABEL}
        </span>
        {pendente.termos_aprovados.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {TERMOS_BUSCA_NENHUM_APROVADO_MESSAGE}
          </span>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {pendente.termos_aprovados.map((termo) => (
              <li key={termo}>
                <Badge variant="secondary" className="font-normal">
                  {termo}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editando ? (
        <div className="flex flex-col gap-2">
          <Input
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            maxLength={TERMO_BUSCA_MAX_CHARS}
            aria-label={TERMOS_BUSCA_EDITAR_APROVAR_LABEL}
            value={termoEditado}
            disabled={busy}
            onChange={(event) => {
              setTermoEditado(event.target.value);
              if (erroLocal) setErroLocal(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void confirmarEdicao();
              }
            }}
            className="min-touch text-base"
          />
          {erroLocal && <p className="text-xs text-destructive">{erroLocal}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-touch"
              disabled={busy || termoEditado.trim().length === 0}
              onClick={() => void confirmarEdicao()}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {TERMOS_BUSCA_CONFIRMAR_LABEL}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-touch"
              disabled={busy}
              onClick={() => {
                setEditando(false);
                setTermoEditado(pendente.termo);
                setErroLocal(null);
              }}
            >
              {TERMOS_BUSCA_CANCELAR_LABEL}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="min-touch"
            disabled={busy}
            onClick={() => void onAprovar()}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {TERMOS_BUSCA_APROVAR_LABEL}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-touch"
            disabled={busy}
            onClick={() => setEditando(true)}
          >
            {TERMOS_BUSCA_EDITAR_APROVAR_LABEL}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-touch text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => void onRejeitar()}
          >
            {TERMOS_BUSCA_REJEITAR_LABEL}
          </Button>
        </div>
      )}
    </article>
  );
}
