import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  ESTOQUE_IMAGEM_ERRO_MESSAGE,
  ESTOQUE_IMAGEM_PRINCIPAL_LABEL,
  ESTOQUE_IMAGEM_SECUNDARIA_LABEL,
  ESTOQUE_IMAGEM_TENTAR_NOVAMENTE_LABEL,
  ESTOQUE_IMAGEM_VIEWER_TITLE,
} from "@/config/constants";
import { listarImagensDaCor, type ImagensDaCor } from "@/lib/produtoImagensPublicadas";
import { cn } from "@/lib/utils";

interface ProdutoImagemViewerProps {
  produto: string;
  corCodigo: string;
  imagens: ImagensDaCor;
  onClose: () => void;
}

type Estado = "carregando" | "ok" | "erro";

const SLOT_LABEL: Record<string, string> = {
  principal: ESTOQUE_IMAGEM_PRINCIPAL_LABEL,
  secundaria: ESTOQUE_IMAGEM_SECUNDARIA_LABEL,
};

/**
 * Mobile-friendly viewer for the published images of one colour. Mount it
 * with key = colour so the selection and load state start fresh per colour.
 */
export function ProdutoImagemViewer({
  produto,
  corCodigo,
  imagens,
  onClose,
}: ProdutoImagemViewerProps) {
  const lista = listarImagensDaCor(imagens);
  const [indice, setIndice] = useState(0);
  const [estado, setEstado] = useState<Estado>("carregando");
  const [tentativa, setTentativa] = useState(0);
  const atual = lista[indice];

  const selecionar = (novo: number) => {
    if (novo === indice) return;
    setIndice(novo);
    setEstado("carregando");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-md gap-3 overflow-y-auto p-4">
        <DialogTitle className="pr-6 text-base">
          {ESTOQUE_IMAGEM_VIEWER_TITLE} — {produto} / {corCodigo}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Imagens publicadas do produto {produto}, cor {corCodigo}.
        </DialogDescription>

        <div className="relative flex min-h-[16rem] items-center justify-center overflow-hidden rounded-lg bg-muted">
          {estado === "carregando" && (
            <Loader2 className="absolute h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
          )}
          {estado === "erro" ? (
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <p className="text-sm text-destructive">{ESTOQUE_IMAGEM_ERRO_MESSAGE}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEstado("carregando");
                  setTentativa((n) => n + 1);
                }}
              >
                {ESTOQUE_IMAGEM_TENTAR_NOVAMENTE_LABEL}
              </Button>
            </div>
          ) : (
            <img
              key={`${atual.url}-${tentativa}`}
              src={atual.url}
              alt={`${produto} ${corCodigo} — ${SLOT_LABEL[atual.slot]}`}
              className={cn(
                "max-h-[65dvh] w-full object-contain",
                estado === "carregando" && "opacity-0",
              )}
              onLoad={() => setEstado("ok")}
              onError={() => setEstado("erro")}
            />
          )}
        </div>

        {lista.length > 1 && (
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Imagens">
            {lista.map((item, i) => (
              <Button
                key={item.slot}
                type="button"
                variant={i === indice ? "default" : "outline"}
                aria-pressed={i === indice}
                className="min-h-11"
                onClick={() => selecionar(i)}
              >
                {SLOT_LABEL[item.slot]}
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
