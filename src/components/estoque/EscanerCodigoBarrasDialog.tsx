import { Camera, Keyboard, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ESTOQUE_ESCANEAR_CANCELAR_LABEL,
  ESTOQUE_ESCANEAR_DIGITAR_LABEL,
  ESTOQUE_ESCANEAR_FALHA_MESSAGE,
  ESTOQUE_ESCANEAR_INICIANDO_MESSAGE,
  ESTOQUE_ESCANEAR_INSTRUCAO,
  ESTOQUE_ESCANEAR_LEITURA_FALHOU_MESSAGE,
  ESTOQUE_ESCANEAR_NAO_SUPORTADO_MESSAGE,
  ESTOQUE_ESCANEAR_PERMISSAO_NEGADA_MESSAGE,
  ESTOQUE_ESCANEAR_SEM_CAMERA_MESSAGE,
  ESTOQUE_ESCANEAR_TENTAR_NOVAMENTE_LABEL,
  ESTOQUE_ESCANEAR_TITULO,
} from "@/config/constants";
import {
  cameraDisponivelNoNavegador,
  classificarErroCamera,
  criarLeitorCodigoBarras,
  pararStream,
  RESTRICOES_CAMERA,
  type ErroCamera,
  type LeitorCodigoBarras,
} from "@/lib/leitorCodigoBarras";

type Estado =
  { tipo: "iniciando" } | { tipo: "lendo" } | { tipo: "erro"; erro: ErroCamera | "leitura_falhou" };

const MENSAGENS_ERRO: Record<ErroCamera | "leitura_falhou", string> = {
  permissao_negada: ESTOQUE_ESCANEAR_PERMISSAO_NEGADA_MESSAGE,
  sem_camera: ESTOQUE_ESCANEAR_SEM_CAMERA_MESSAGE,
  nao_suportado: ESTOQUE_ESCANEAR_NAO_SUPORTADO_MESSAGE,
  falha: ESTOQUE_ESCANEAR_FALHA_MESSAGE,
  leitura_falhou: ESTOQUE_ESCANEAR_LEITURA_FALHOU_MESSAGE,
};

/** Pause between decode passes; keeps phones cool while staying responsive. */
const INTERVALO_LEITURA_MS = 120;
/** Consecutive decoder exceptions (not "no code in frame") before giving up. */
const MAX_FALHAS_DECODIFICACAO = 5;

export interface EscanerCodigoBarrasDialogProps {
  /** Called at most once per opening, after the camera has been stopped. */
  onDetectado: (codigo: string) => void;
  /** Cancel / dismiss. The camera is already stopped. */
  onFechar: () => void;
  /** Manual-entry fallback: close and focus the search field. */
  onDigitar: () => void;
  /** Injectable for tests. */
  criarLeitor?: () => Promise<LeitorCodigoBarras>;
  obterStream?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  cameraDisponivel?: () => boolean;
}

function obterStreamPadrao(constraints: MediaStreamConstraints): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(constraints);
}

/**
 * Barcode Slice 2 camera scanner. Lazy-loaded (React.lazy) by the search page
 * and mounted only while open, so neither this component nor the decoder is
 * part of an ordinary inventory search.
 *
 * Lifecycle guarantees — every MediaStreamTrack is stopped on: a successful
 * read, Cancelar / Digitar código / dismiss, the page becoming hidden,
 * navigation (unmount), and a camera grant that arrives after the dialog was
 * already closed. A read is delivered at most once.
 */
export default function EscanerCodigoBarrasDialog({
  onDetectado,
  onFechar,
  onDigitar,
  criarLeitor = criarLeitorCodigoBarras,
  obterStream = obterStreamPadrao,
  cameraDisponivel = cameraDisponivelNoNavegador,
}: EscanerCodigoBarrasDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [estado, setEstado] = useState<Estado>({ tipo: "iniciando" });
  const [tentativa, setTentativa] = useState(0);
  const pararRef = useRef<() => void>(() => {});

  // Latest callbacks without restarting the camera when the parent re-renders.
  const callbacks = useRef({ onDetectado, onFechar, criarLeitor, obterStream, cameraDisponivel });
  callbacks.current = { onDetectado, onFechar, criarLeitor, obterStream, cameraDisponivel };

  useEffect(() => {
    let ativo = true;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const parar = () => {
      ativo = false;
      if (timer !== undefined) clearTimeout(timer);
      pararStream(stream);
      stream = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
    pararRef.current = parar;

    const iniciar = async () => {
      const cb = callbacks.current;
      if (!cb.cameraDisponivel()) {
        setEstado({ tipo: "erro", erro: "nao_suportado" });
        return;
      }
      setEstado({ tipo: "iniciando" });

      // Start loading the decoder while the permission prompt is up.
      const leitorPromise = cb.criarLeitor();
      leitorPromise.catch(() => {});

      let obtido: MediaStream;
      try {
        obtido = await cb.obterStream(RESTRICOES_CAMERA);
      } catch (error) {
        if (ativo) setEstado({ tipo: "erro", erro: classificarErroCamera(error) });
        return;
      }
      if (!ativo) {
        // Closed/unmounted while the permission prompt was open.
        pararStream(obtido);
        return;
      }
      stream = obtido;

      const video = videoRef.current;
      if (!video) {
        parar();
        return;
      }
      video.srcObject = obtido;
      try {
        await video.play();
      } catch {
        // autoplay+muted+playsInline normally suffice; frames are still read.
      }

      let leitor: LeitorCodigoBarras;
      try {
        leitor = await leitorPromise;
      } catch {
        if (ativo) {
          parar();
          setEstado({ tipo: "erro", erro: "nao_suportado" });
        }
        return;
      }
      if (!ativo) return;
      setEstado({ tipo: "lendo" });

      let falhas = 0;
      const ciclo = async () => {
        if (!ativo) return;
        try {
          const codigo = await leitor.ler(video);
          falhas = 0;
          if (codigo && ativo) {
            parar();
            callbacks.current.onDetectado(codigo);
            return;
          }
        } catch {
          falhas += 1;
          if (falhas >= MAX_FALHAS_DECODIFICACAO) {
            if (ativo) {
              parar();
              setEstado({ tipo: "erro", erro: "leitura_falhou" });
            }
            return;
          }
        }
        if (ativo) timer = setTimeout(() => void ciclo(), INTERVALO_LEITURA_MS);
      };
      void ciclo();
    };

    void iniciar();
    return parar;
  }, [tentativa]);

  // Leaving the app / locking the phone releases the camera and closes.
  useEffect(() => {
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === "hidden") {
        pararRef.current();
        callbacks.current.onFechar();
      }
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  }, []);

  const fechar = () => {
    pararRef.current();
    onFechar();
  };

  const digitar = () => {
    pararRef.current();
    onDigitar();
  };

  const erro = estado.tipo === "erro" ? estado.erro : null;
  const podeTentarNovamente = erro !== null && erro !== "nao_suportado" && erro !== "sem_camera";

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) fechar();
      }}
    >
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>{ESTOQUE_ESCANEAR_TITULO}</DialogTitle>
          <DialogDescription>{ESTOQUE_ESCANEAR_INSTRUCAO}</DialogDescription>
        </DialogHeader>

        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            autoPlay
            muted
            playsInline
            aria-hidden
          />
          {estado.tipo === "lendo" && (
            // Aiming guide for a horizontal (1D) barcode.
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/80"
            />
          )}
          {estado.tipo === "iniciando" && (
            <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {ESTOQUE_ESCANEAR_INICIANDO_MESSAGE}
            </p>
          )}
          {erro !== null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card p-4 text-center">
              <Camera className="h-6 w-6 text-muted-foreground" aria-hidden />
              <p role="alert" className="text-sm text-foreground">
                {MENSAGENS_ERRO[erro]}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row flex-wrap justify-end gap-2 sm:space-x-0">
          {podeTentarNovamente && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => setTentativa((t) => t + 1)}
            >
              {ESTOQUE_ESCANEAR_TENTAR_NOVAMENTE_LABEL}
            </Button>
          )}
          <Button type="button" variant="outline" className="min-h-11" onClick={digitar}>
            <Keyboard className="mr-1.5 h-4 w-4" aria-hidden />
            {ESTOQUE_ESCANEAR_DIGITAR_LABEL}
          </Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={fechar}>
            {ESTOQUE_ESCANEAR_CANCELAR_LABEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
