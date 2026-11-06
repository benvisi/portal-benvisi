import { useState } from "react";

import {
  ImagensProdutoDetalhe,
  type DecisaoImagens,
} from "@/components/imagensProduto/ImagensProdutoDetalhe";
import { ImagensProdutoFila } from "@/components/imagensProduto/ImagensProdutoFila";
import {
  IMAGENS_PRODUTO_APROVADO_MESSAGE,
  IMAGENS_PRODUTO_ERRO_TRANSICAO_MESSAGE,
  IMAGENS_PRODUTO_FILA_TITLE,
  IMAGENS_PRODUTO_REJEITADO_MESSAGE,
} from "@/config/constants";
import { useCandidatosImagemPendentes } from "@/hooks/useCandidatosImagemPendentes";

const AVISOS: Record<DecisaoImagens, string> = {
  aprovado: IMAGENS_PRODUTO_APROVADO_MESSAGE,
  rejeitado: IMAGENS_PRODUTO_REJEITADO_MESSAGE,
};

/** Queue ↔ detail container. Mounted only after the permission was confirmed. */
export function ImagensProdutoRevisaoView({ sessionToken }: { sessionToken: string }) {
  const query = useCandidatosImagemPendentes(sessionToken);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const selecionado = query.data?.find((candidato) => candidato.id === selecionadoId) ?? null;
  // The open candidate disappeared from a fresh queue: someone else already
  // reviewed it (or a failed action refetched it away).
  const sumiu = selecionadoId !== null && query.data !== undefined && selecionado === null;
  const avisoVisivel = aviso ?? (sumiu ? IMAGENS_PRODUTO_ERRO_TRANSICAO_MESSAGE : null);

  if (selecionado) {
    return (
      <ImagensProdutoDetalhe
        key={selecionado.id}
        candidato={selecionado}
        sessionToken={sessionToken}
        onVoltar={() => setSelecionadoId(null)}
        onDecidido={(decisao) => {
          setAviso(AVISOS[decisao]);
          setSelecionadoId(null);
        }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">{IMAGENS_PRODUTO_FILA_TITLE}</h2>
      {avisoVisivel && (
        <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm">
          {avisoVisivel}
        </p>
      )}
      <ImagensProdutoFila
        candidatos={query.data}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        onSelecionar={(id) => {
          setAviso(null);
          setSelecionadoId(id);
        }}
      />
    </section>
  );
}
