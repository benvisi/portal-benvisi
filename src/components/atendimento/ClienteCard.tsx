import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CLIENTE_CARD_TITLE,
  DETALHE_LABEL,
  DETALHE_PLACEHOLDER,
  MOTIVO_LABEL,
  MOTIVOS_LOADING_MESSAGE,
  OUTCOME_CONVERTIDO_LABEL,
  OUTCOME_NAO_CONVERTIDO_LABEL,
  REMOVER_CLIENTE_LABEL,
} from "@/config/constants";
import type { AtendimentoMotivo } from "@/integrations/supabase/contracts";
import type { ClienteRascunho } from "@/hooks/useFechamentoDraft";
import { cn } from "@/lib/utils";

interface ClienteCardProps {
  index: number;
  cliente: ClienteRascunho;
  motivos: AtendimentoMotivo[];
  motivosLoading: boolean;
  podeRemover: boolean;
  onAtualizar: (patch: Partial<ClienteRascunho>) => void;
  onRemover: () => void;
}

/**
 * Convertido/Não convertido use restrained semantic tints (green/rose) at
 * two intensity levels — light for unselected, stronger for selected —
 * rather than a punitive full-saturation destructive fill for Não
 * convertido: section 8.15.2 of the Blueprint warns against treating
 * non-conversion as employee failure, so the color communicates "outcome
 * type", not "good/bad employee". Selection also changes border weight and
 * font weight, not color alone.
 */
export function ClienteCard({
  index,
  cliente,
  motivos,
  motivosLoading,
  podeRemover,
  onAtualizar,
  onRemover,
}: ClienteCardProps) {
  const motivosDaCategoria = cliente.categoria
    ? motivos.filter((m) => m.categoria === cliente.categoria)
    : [];
  const motivoSelecionado = motivos.find((m) => m.id === cliente.idMotivo) ?? null;
  const precisaDetalhe = motivoSelecionado?.detalhe_obrigatorio ?? false;

  return (
    <Card className="flex flex-col gap-3 border border-border p-4 shadow-none">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">
          {CLIENTE_CARD_TITLE} {index + 1}
        </span>
        {podeRemover && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-touch text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onRemover}
            aria-label={REMOVER_CLIENTE_LABEL}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="lg"
          variant="outline"
          className={cn(
            "min-touch font-medium",
            cliente.categoria === "convertido"
              ? "border-2 border-success bg-success text-success-foreground font-semibold"
              : "border border-success/30 bg-success/10 text-foreground hover:bg-success/15",
          )}
          onClick={() => onAtualizar({ categoria: "convertido", idMotivo: null })}
        >
          {OUTCOME_CONVERTIDO_LABEL}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className={cn(
            "min-touch font-medium",
            cliente.categoria === "nao_convertido"
              ? "border-2 border-destructive bg-destructive/25 text-foreground font-semibold"
              : "border border-destructive/20 bg-destructive/5 text-foreground hover:bg-destructive/10",
          )}
          onClick={() => onAtualizar({ categoria: "nao_convertido", idMotivo: null })}
        >
          {OUTCOME_NAO_CONVERTIDO_LABEL}
        </Button>
      </div>

      {cliente.categoria && (
        <div className="flex flex-col gap-2">
          <Label>{MOTIVO_LABEL}</Label>
          {motivosLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {MOTIVOS_LOADING_MESSAGE}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {motivosDaCategoria.map((m) => {
                const selecionado = cliente.idMotivo === m.id;
                return (
                  <Button
                    key={m.id}
                    type="button"
                    size="lg"
                    variant={selecionado ? "default" : "outline"}
                    className={cn(
                      "min-touch h-auto min-h-11 whitespace-normal py-2 text-center leading-snug",
                      selecionado && "border-2 font-semibold",
                    )}
                    onClick={() => onAtualizar({ idMotivo: m.id })}
                  >
                    {m.rotulo}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {precisaDetalhe && (
        <div className="flex flex-col gap-2">
          <Label>{DETALHE_LABEL}</Label>
          <Textarea
            value={cliente.detalhe}
            onChange={(event) => onAtualizar({ detalhe: event.target.value })}
            placeholder={DETALHE_PLACEHOLDER}
            className="min-h-20"
          />
        </div>
      )}
    </Card>
  );
}
