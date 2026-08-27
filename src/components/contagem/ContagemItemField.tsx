import {
  CONTAGEM_PACOTES_FECHADOS_LABEL,
  CONTAGEM_TOTAL_LABEL,
  CONTAGEM_UNIDADE_SUFFIX,
  CONTAGEM_UNIDADES_AVULSAS_LABEL,
} from "@/config/constants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ContagemCatalogoItem } from "@/integrations/supabase/contracts";
import {
  calcularTotalUnidades,
  formatUnidades,
  parseContagemInteiro,
  sanitizeContagemInput,
} from "@/lib/contagem";
import { cn } from "@/lib/utils";

interface ContagemItemFieldProps {
  item: ContagemCatalogoItem;
  pacotes: string;
  avulsas: string;
  /** Flagged only after a submit attempt while Pacotes fechados is still blank. */
  faltando: boolean;
  onPacotesChange: (value: string) => void;
  onAvulsasChange: (value: string) => void;
}

/**
 * One catalog item on the counting form: required Pacotes fechados,
 * optional Unidades avulsas, and a live Total. Both inputs open the native
 * numeric keypad (type=text + inputMode=numeric + pattern) and accept only
 * nonnegative whole digits. Blank stays blank — it is never shown or sent
 * as 0; the parent decides what missing means.
 */
export function ContagemItemField({
  item,
  pacotes,
  avulsas,
  faltando,
  onPacotesChange,
  onAvulsasChange,
}: ContagemItemFieldProps) {
  const pacotesId = `contagem-${item.id}-pacotes`;
  const avulsasId = `contagem-${item.id}-avulsas`;

  const pacotesNum = parseContagemInteiro(pacotes) ?? 0;
  const avulsasNum = parseContagemInteiro(avulsas) ?? 0;
  const total = calcularTotalUnidades(pacotesNum, avulsasNum, item.unidades_por_pacote);

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4",
        faltando ? "border-destructive/60 bg-destructive/5" : "border-border bg-card",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{item.rotulo}</span>
        <span className="text-xs text-muted-foreground">
          {formatUnidades(item.unidades_por_pacote)} {CONTAGEM_UNIDADE_SUFFIX} por pacote
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={pacotesId} className="text-xs text-muted-foreground">
            {CONTAGEM_PACOTES_FECHADOS_LABEL}
          </Label>
          <Input
            id={pacotesId}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="next"
            value={pacotes}
            onChange={(event) => onPacotesChange(sanitizeContagemInput(event.target.value))}
            aria-invalid={faltando || undefined}
            className={cn(
              "h-11 text-base",
              faltando && "border-destructive focus-visible:ring-destructive",
            )}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={avulsasId} className="text-xs text-muted-foreground">
            {CONTAGEM_UNIDADES_AVULSAS_LABEL}
          </Label>
          <Input
            id={avulsasId}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="next"
            value={avulsas}
            onChange={(event) => onAvulsasChange(sanitizeContagemInput(event.target.value))}
            className="h-11 text-base"
          />
        </div>
      </div>

      <div className="flex items-baseline justify-between border-t border-border/60 pt-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {CONTAGEM_TOTAL_LABEL}
        </span>
        <span className="text-sm font-semibold text-foreground">
          {formatUnidades(total)} {CONTAGEM_UNIDADE_SUFFIX}
        </span>
      </div>
    </li>
  );
}
