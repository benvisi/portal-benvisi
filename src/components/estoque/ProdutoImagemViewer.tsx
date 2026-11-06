import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  ESTOQUE_IMAGEM_ANTERIOR_LABEL,
  ESTOQUE_IMAGEM_COMPARTILHAR_LABEL,
  ESTOQUE_IMAGEM_COMPARTILHADA_MESSAGE,
  ESTOQUE_IMAGEM_COPIAR_LABEL,
  ESTOQUE_IMAGEM_COPIADA_MESSAGE,
  ESTOQUE_IMAGEM_COPIA_FALHOU_MESSAGE,
  ESTOQUE_IMAGEM_COMPARTILHAR_FALHOU_MESSAGE,
  ESTOQUE_IMAGEM_ERRO_MESSAGE,
  ESTOQUE_IMAGEM_PROXIMA_LABEL,
  ESTOQUE_IMAGEM_PRINCIPAL_LABEL,
  ESTOQUE_IMAGEM_SECUNDARIA_LABEL,
  ESTOQUE_IMAGEM_TENTAR_NOVAMENTE_LABEL,
  ESTOQUE_IMAGEM_VIEWER_TITLE,
} from "@/config/constants";
import {
  buscarImagemPng,
  compartilhamentoSuportado,
  compartilharImagem,
  copiarImagem,
  criarArquivoPng,
} from "@/lib/imagemClipboard";
import { listarImagensDaCor, type ImagensDaCor } from "@/lib/produtoImagensPublicadas";
import { cn } from "@/lib/utils";

interface ProdutoImagemViewerProps {
  produto: string;
  corCodigo: string;
  imagens: ImagensDaCor;
  onClose: () => void;
}

type Estado = "carregando" | "ok" | "erro";
type Aviso = { tipo: "sucesso" | "erro"; texto: string } | null;

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

  const [aviso, setAviso] = useState<Aviso>(null);
  const [copiaIndisponivel, setCopiaIndisponivel] = useState(false);
  const pngPorUrl = useRef(new Map<string, Promise<Blob>>());

  const selecionar = (novo: number) => {
    if (novo === indice) return;
    setIndice(novo);
    setEstado("carregando");
    setAviso(null);
    setCopiaIndisponivel(false);
  };
  const navegar = (passo: number) => selecionar((indice + passo + lista.length) % lista.length);

  // One download + PNG conversion per image, reused by copy and share.
  const obterPng = (url: string) => {
    let png = pngPorUrl.current.get(url);
    if (!png) {
      png = buscarImagemPng(url);
      png.catch(() => pngPorUrl.current.delete(url));
      pngPorUrl.current.set(url, png);
    }
    return png;
  };

  // Called straight from the tap: the blob is passed as a promise so Safari
  // keeps the user activation while it downloads and converts.
  const copiar = async () => {
    setAviso(null);
    const resultado = await copiarImagem(obterPng(atual.url));
    if (resultado === "ok") {
      setCopiaIndisponivel(false);
      setAviso({ tipo: "sucesso", texto: ESTOQUE_IMAGEM_COPIADA_MESSAGE });
    } else {
      setCopiaIndisponivel(true);
      setAviso({ tipo: "erro", texto: ESTOQUE_IMAGEM_COPIA_FALHOU_MESSAGE });
    }
  };

  const compartilhar = async () => {
    setAviso(null);
    try {
      const arquivo = criarArquivoPng(await obterPng(atual.url), `${produto}-${corCodigo}`);
      const resultado = await compartilharImagem(arquivo, `${produto} ${corCodigo}`);
      if (resultado === "ok") {
        setAviso({ tipo: "sucesso", texto: ESTOQUE_IMAGEM_COMPARTILHADA_MESSAGE });
      } else if (resultado !== "cancelado") {
        setAviso({ tipo: "erro", texto: ESTOQUE_IMAGEM_COMPARTILHAR_FALHOU_MESSAGE });
      }
    } catch {
      setAviso({ tipo: "erro", texto: ESTOQUE_IMAGEM_COMPARTILHAR_FALHOU_MESSAGE });
    }
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
          {lista.length > 1 && (
            <>
              <button
                type="button"
                aria-label={ESTOQUE_IMAGEM_ANTERIOR_LABEL}
                onClick={() => navegar(-1)}
                className="absolute left-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 text-foreground shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="h-6 w-6" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={ESTOQUE_IMAGEM_PROXIMA_LABEL}
                onClick={() => navegar(1)}
                className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 text-foreground shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className="h-6 w-6" aria-hidden />
              </button>
            </>
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

        {estado === "ok" && (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void copiar()}
            >
              {ESTOQUE_IMAGEM_COPIAR_LABEL}
            </Button>
            {copiaIndisponivel && compartilhamentoSuportado() && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => void compartilhar()}
              >
                {ESTOQUE_IMAGEM_COMPARTILHAR_LABEL}
              </Button>
            )}
          </div>
        )}
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "min-h-5 text-center text-sm",
            aviso?.tipo === "erro" ? "text-destructive" : "text-foreground",
          )}
        >
          {aviso?.texto}
        </p>
      </DialogContent>
    </Dialog>
  );
}
