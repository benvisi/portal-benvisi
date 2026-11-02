import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  IMAGENS_PRODUTO_AVALIACAO_AMBIGUA_LABEL,
  IMAGENS_PRODUTO_ESCOLHER_PRINCIPAL_LABEL,
  IMAGENS_PRODUTO_ESCOLHER_SECUNDARIA_LABEL,
  IMAGENS_PRODUTO_GALERIA_LABEL,
  IMAGENS_PRODUTO_INELEGIVEL_LABEL,
  IMAGENS_PRODUTO_NAO_E_FOTO_LABEL,
  IMAGENS_PRODUTO_ORIGEM_NAO_PERMITIDA_LABEL,
  IMAGENS_PRODUTO_PESSOA_LABEL,
  IMAGENS_PRODUTO_PRINCIPAL_LABEL,
  IMAGENS_PRODUTO_RECOMENDADA_IA_LABEL,
  IMAGENS_PRODUTO_SECUNDARIA_LABEL,
  IMAGENS_PRODUTO_SEM_AVALIACAO_LABEL,
  IMAGENS_PRODUTO_SEM_PESSOA_LABEL,
} from "@/config/constants";
import type { ImagemGaleria, MotivoInelegivel, SelecaoImagens } from "@/lib/produtoImagens";
import { cn } from "@/lib/utils";

const MOTIVO_LABELS: Record<MotivoInelegivel, string> = {
  nao_e_foto: IMAGENS_PRODUTO_NAO_E_FOTO_LABEL,
  origem_nao_permitida: IMAGENS_PRODUTO_ORIGEM_NAO_PERMITIDA_LABEL,
  sem_avaliacao: IMAGENS_PRODUTO_SEM_AVALIACAO_LABEL,
  avaliacao_ambigua: IMAGENS_PRODUTO_AVALIACAO_AMBIGUA_LABEL,
  pessoa: IMAGENS_PRODUTO_PESSOA_LABEL,
};

interface ImagensProdutoGaleriaProps {
  galeria: ImagemGaleria[];
  selecao: SelecaoImagens;
  recomendadas: SelecaoImagens;
  focada: number;
  disabled: boolean;
  onFocar: (index: number) => void;
  onPrincipal: (index: number) => void;
  onSecundaria: (index: number) => void;
}

export function ImagemLacoste({
  url,
  alt,
  className,
}: {
  url: string | null;
  alt: string;
  className?: string;
}) {
  // Loaded straight from the Lacoste CDN; nothing is downloaded or stored.
  if (!url) return <div className={cn("bg-muted", className)} aria-hidden />;
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={cn("bg-muted object-contain", className)}
    />
  );
}

/** Large preview of the focused image plus a thumbnail strip with per-image state. */
export function ImagensProdutoGaleria({
  galeria,
  selecao,
  recomendadas,
  focada,
  disabled,
  onFocar,
  onPrincipal,
  onSecundaria,
}: ImagensProdutoGaleriaProps) {
  const atual = galeria.find((img) => img.index === focada) ?? galeria[0];
  if (!atual) return null;

  return (
    <section className="flex flex-col gap-3" aria-label={IMAGENS_PRODUTO_GALERIA_LABEL}>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
        <ImagemLacoste
          url={atual.url}
          alt={atual.alt || `Imagem ${atual.index + 1}`}
          className="aspect-square w-full rounded-lg"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            Imagem {atual.index + 1} de {galeria.length}
          </span>
          {recomendadas.principal === atual.index && (
            <Badge variant="outline">
              {IMAGENS_PRODUTO_RECOMENDADA_IA_LABEL}: {IMAGENS_PRODUTO_PRINCIPAL_LABEL}
            </Badge>
          )}
          {recomendadas.secundaria === atual.index && (
            <Badge variant="outline">
              {IMAGENS_PRODUTO_RECOMENDADA_IA_LABEL}: {IMAGENS_PRODUTO_SECUNDARIA_LABEL}
            </Badge>
          )}
          {atual.elegivel ? (
            <Badge variant="secondary">{IMAGENS_PRODUTO_SEM_PESSOA_LABEL}</Badge>
          ) : (
            <Badge variant="destructive">
              {IMAGENS_PRODUTO_INELEGIVEL_LABEL}
              {atual.motivo ? `: ${MOTIVO_LABELS[atual.motivo]}` : ""}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="min-touch"
            disabled={disabled || !atual.elegivel || selecao.principal === atual.index}
            onClick={() => onPrincipal(atual.index)}
          >
            {IMAGENS_PRODUTO_ESCOLHER_PRINCIPAL_LABEL}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-touch"
            disabled={
              disabled ||
              !atual.elegivel ||
              selecao.principal === atual.index ||
              selecao.secundaria === atual.index
            }
            onClick={() => onSecundaria(atual.index)}
          >
            {IMAGENS_PRODUTO_ESCOLHER_SECUNDARIA_LABEL}
          </Button>
        </div>
      </div>

      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-6">
        {galeria.map((img) => {
          const ehPrincipal = selecao.principal === img.index;
          const ehSecundaria = selecao.secundaria === img.index;
          return (
            <li key={img.index}>
              <button
                type="button"
                onClick={() => onFocar(img.index)}
                aria-label={`Ver imagem ${img.index + 1}${img.elegivel ? "" : " (não elegível)"}`}
                aria-current={img.index === atual.index}
                className={cn(
                  "relative block w-full overflow-hidden rounded-lg border-2",
                  img.index === atual.index ? "border-primary" : "border-border",
                  ehPrincipal && "ring-2 ring-primary",
                  ehSecundaria && "ring-2 ring-accent-foreground",
                  !img.elegivel && "opacity-50",
                )}
              >
                <ImagemLacoste url={img.url} alt="" className="aspect-square w-full" />
                <span className="absolute left-1 top-1 rounded bg-background/90 px-1 text-[10px] font-semibold">
                  {img.index + 1}
                </span>
                {(ehPrincipal || ehSecundaria) && (
                  <span className="absolute bottom-1 left-1 rounded bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {ehPrincipal ? "P" : "S"}
                  </span>
                )}
                {!img.elegivel && (
                  <span className="absolute bottom-1 right-1 rounded bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                    ✕
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
