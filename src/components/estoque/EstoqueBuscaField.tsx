import { Loader2, ScanBarcode, Search } from "lucide-react";
import { useRef, useState, type Ref } from "react";

import {
  ESTOQUE_BUSCA_CARREGANDO_MESSAGE,
  ESTOQUE_BUSCA_DICA_MESSAGE,
  ESTOQUE_BUSCA_ERRO_MESSAGE,
  ESTOQUE_BUSCA_MIN_CHARS,
  ESTOQUE_BUSCA_PLACEHOLDER,
  ESTOQUE_BUSCA_VAZIO_MESSAGE,
  ESTOQUE_ESCANEAR_LABEL,
  getEstoqueCoresDisponiveisLabel,
} from "@/config/constants";
import type { EstoqueProdutoBusca } from "@/integrations/supabase/contracts";
import {
  isCandidatoCodigoBarra,
  isCodigoBarraSomenteDigitos,
  normalizarCodigoBarra,
} from "@/lib/codigoBarras";
import { cn } from "@/lib/utils";

interface EstoqueBuscaFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** A suggestion was tapped, or Enter resolved to a produto. */
  onSelect: (produto: string) => void;
  /**
   * Barcode Slice 2: Enter (keyboard or USB scanner) on a term that looks like
   * a barcode and is not an exact produto. `produtoFallback` is what Enter
   * used to open (alphanumeric terms only; null for digits-only codes).
   */
  onCodigoBarra?: (codigo: string, produtoFallback: string | null) => void;
  /** Barcode Slice 2: renders the camera button (mobile/tablet only). */
  onEscanear?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  /** Already trimmed, prefix-ranked and capped to the visible maximum. */
  suggestions: EstoqueProdutoBusca[];
  isLoading: boolean;
  isError: boolean;
  /** True once the debounced term is long enough to have triggered a search. */
  hasQueried: boolean;
}

function ponteiroToque(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

export function EstoqueBuscaField({
  value,
  onChange,
  onSelect,
  onCodigoBarra,
  onEscanear,
  inputRef: inputRefExterno,
  suggestions,
  isLoading,
  isError,
  hasQueried,
}: EstoqueBuscaFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  // Closes the list after a barcode submit while keeping focus in the field,
  // so a USB scanner's next read lands here; typing reopens it.
  const [fechado, setFechado] = useState(false);

  const trimmed = value.trim();
  const meetsMin = trimmed.length >= ESTOQUE_BUSCA_MIN_CHARS;
  const open = focused && !fechado && trimmed.length > 0;

  const setRefs = (el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (typeof inputRefExterno === "function") inputRefExterno(el);
    else if (inputRefExterno) inputRefExterno.current = el;
  };

  const commit = (produto: string) => {
    onSelect(produto);
    setFocused(false);
    inputRef.current?.blur();
  };

  const handleSubmit = () => {
    if (!meetsMin) return;
    // Exact produto match wins; otherwise the top-ranked suggestion (prefix
    // hits already sort first); otherwise open the typed term as-is so the
    // detail view can show its own "não encontrado" state.
    const exact = suggestions.find((s) => s.produto.toLowerCase() === trimmed.toLowerCase());
    if (exact) {
      commit(exact.produto);
      return;
    }
    const fallback = suggestions[0]?.produto ?? trimmed;
    if (onCodigoBarra && isCandidatoCodigoBarra(trimmed)) {
      const codigo = normalizarCodigoBarra(value);
      onCodigoBarra(codigo, isCodigoBarraSomenteDigitos(codigo) ? null : fallback);
      setFechado(true);
      if (ponteiroToque()) {
        setFocused(false);
        inputRef.current?.blur();
      } else {
        // Desktop / USB scanner: stay focused, select the code so the next
        // scan or keystroke replaces it.
        inputRef.current?.select();
      }
      return;
    }
    commit(fallback);
  };

  // z-40 creates a local stacking context so the dropdown clears the matrix sticky headers (z-20/30).
  return (
    <div className="relative z-40">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={setRefs}
        type="text"
        inputMode="search"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-label={ESTOQUE_BUSCA_PLACEHOLDER}
        placeholder={ESTOQUE_BUSCA_PLACEHOLDER}
        value={value}
        onChange={(event) => {
          setFechado(false);
          onChange(event.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            // A USB scanner may send Enter while a previous submit is still
            // settling; repeats are idempotent (same code -> same query).
            handleSubmit();
          } else if (event.key === "Escape") {
            setFocused(false);
          }
        }}
        className={cn(
          "min-touch w-full rounded-xl border border-input bg-card pl-10 py-3 text-base text-foreground shadow-soft outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20",
          onEscanear ? "pr-14" : "pr-4",
        )}
      />

      {onEscanear && (
        <button
          type="button"
          onClick={onEscanear}
          aria-label={ESTOQUE_ESCANEAR_LABEL}
          title={ESTOQUE_ESCANEAR_LABEL}
          className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-brand hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ScanBarcode className="h-5 w-5" aria-hidden />
        </button>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-border bg-popover shadow-card">
          {!meetsMin ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">{ESTOQUE_BUSCA_DICA_MESSAGE}</p>
          ) : isLoading ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {ESTOQUE_BUSCA_CARREGANDO_MESSAGE}
            </p>
          ) : isError ? (
            <p className="px-3 py-3 text-sm text-destructive">{ESTOQUE_BUSCA_ERRO_MESSAGE}</p>
          ) : suggestions.length === 0 ? (
            hasQueried ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                {ESTOQUE_BUSCA_VAZIO_MESSAGE}
              </p>
            ) : null
          ) : (
            <ul className="max-h-[19rem] overflow-y-auto">
              {suggestions.map((sugestao, index) => (
                <li key={sugestao.produto}>
                  <button
                    type="button"
                    // onMouseDown (not onClick): fire before the input's
                    // blur-close timer removes this list.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      commit(sugestao.produto);
                    }}
                    className={cn(
                      "flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                      index > 0 && "border-t border-border",
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{sugestao.produto}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {getEstoqueCoresDisponiveisLabel(sugestao.cores_disponiveis)}
                      </span>
                    </span>
                    {sugestao.desc_produto && (
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {sugestao.desc_produto}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
