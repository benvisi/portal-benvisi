import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { ConfirmarRejeicaoDialog } from "@/components/imagensProduto/ImagensProdutoDialogos";
import {
  ImagemLacoste,
  ImagensProdutoGaleria,
} from "@/components/imagensProduto/ImagensProdutoGaleria";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  IMAGENS_PRODUTO_APROVAR_LABEL,
  IMAGENS_PRODUTO_CONFIANCA_PREFIX,
  IMAGENS_PRODUTO_COR_PREFIX,
  IMAGENS_PRODUTO_ENVIANDO_LABEL,
  IMAGENS_PRODUTO_CONFIANCA_LABELS,
  IMAGENS_PRODUTO_LIMITACOES_HINT,
  IMAGENS_PRODUTO_LIMITACOES_TITLE,
  IMAGENS_PRODUTO_LIMPAR_SECUNDARIA_LABEL,
  IMAGENS_PRODUTO_OBSERVACAO_HELP,
  IMAGENS_PRODUTO_OBSERVACAO_LABEL,
  IMAGENS_PRODUTO_PRINCIPAL_LABEL,
  IMAGENS_PRODUTO_REJEITAR_LABEL,
  IMAGENS_PRODUTO_SECUNDARIA_LABEL,
  IMAGENS_PRODUTO_SELECAO_TITLE,
  IMAGENS_PRODUTO_SELECAO_VAZIA_MESSAGE,
  IMAGENS_PRODUTO_SEM_ELEGIVEIS_MESSAGE,
  IMAGENS_PRODUTO_SEM_IMAGENS_MESSAGE,
  IMAGENS_PRODUTO_SEM_NOME_LABEL,
  IMAGENS_PRODUTO_SEM_SECUNDARIA_LABEL,
  IMAGENS_PRODUTO_USAR_RECOMENDACAO_LABEL,
  IMAGENS_PRODUTO_VOLTAR_FILA_LABEL,
} from "@/config/constants";
import { useCandidatoImagemActions } from "@/hooks/useCandidatoImagemActions";
import type { CandidatoImagemPendente } from "@/integrations/supabase/contracts";
import {
  indiceDaRecomendacao,
  montarGaleria,
  selecaoInicial,
  selecaoValida,
  type SelecaoImagens,
} from "@/lib/produtoImagens";

export type DecisaoImagens = "aprovado" | "rejeitado";

interface ImagensProdutoDetalheProps {
  candidato: CandidatoImagemPendente;
  sessionToken: string;
  onVoltar: () => void;
  /** Called only after the RPC confirmed the decision. */
  onDecidido: (decisao: DecisaoImagens) => void;
}

/** Detailed review of one candidate: gallery, selection, approve / reject. */
export function ImagensProdutoDetalhe({
  candidato,
  sessionToken,
  onVoltar,
  onDecidido,
}: ImagensProdutoDetalheProps) {
  const galeria = useMemo(
    () => montarGaleria(candidato.galeria, candidato.avaliacoes_ia),
    [candidato.galeria, candidato.avaliacoes_ia],
  );
  const recomendadas = useMemo<SelecaoImagens>(
    () => ({
      principal: indiceDaRecomendacao(galeria, candidato.primary_candidate_url),
      secundaria: indiceDaRecomendacao(galeria, candidato.secondary_candidate_url),
    }),
    [galeria, candidato.primary_candidate_url, candidato.secondary_candidate_url],
  );
  const inicial = useMemo(
    () =>
      selecaoInicial(galeria, candidato.primary_candidate_url, candidato.secondary_candidate_url),
    [galeria, candidato.primary_candidate_url, candidato.secondary_candidate_url],
  );

  const [selecao, setSelecao] = useState<SelecaoImagens>(inicial);
  const [focada, setFocada] = useState(
    inicial.principal ?? galeria.find((img) => img.elegivel)?.index ?? 0,
  );
  const [observacao, setObservacao] = useState("");
  const [rejeitando, setRejeitando] = useState(false);
  const { busy, errorMessage, aprovar, rejeitar } = useCandidatoImagemActions(sessionToken);

  const temElegivel = galeria.some((img) => img.elegivel);
  const podeAprovar = selecaoValida(galeria, selecao) && !busy;
  const urlDe = (index: number | null) =>
    index === null ? null : (galeria.find((img) => img.index === index)?.url ?? null);

  const definirPrincipal = (index: number) =>
    setSelecao((atual) => ({
      principal: index,
      secundaria: atual.secundaria === index ? null : atual.secundaria,
    }));
  const definirSecundaria = (index: number) =>
    setSelecao((atual) => (atual.principal === index ? atual : { ...atual, secundaria: index }));

  const aprovarAgora = async () => {
    const ok = await aprovar(candidato.id, selecao, observacao);
    if (ok) onDecidido("aprovado");
  };

  const confirmarRejeicao = async (motivo: string) => {
    const ok = await rejeitar(candidato.id, motivo);
    setRejeitando(false);
    if (ok) onDecidido("rejeitado");
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-touch shrink-0"
          onClick={onVoltar}
          disabled={busy}
          aria-label={IMAGENS_PRODUTO_VOLTAR_FILA_LABEL}
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Button>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-foreground">
            {candidato.produto} · {candidato.cor_codigo}
          </h2>
          <span className="text-sm text-foreground">
            {candidato.lacoste_product_name ?? IMAGENS_PRODUTO_SEM_NOME_LABEL}
          </span>
          {candidato.lacoste_color_label && (
            <span className="text-xs text-muted-foreground">
              {IMAGENS_PRODUTO_COR_PREFIX}: {candidato.lacoste_color_label}
            </span>
          )}
          {candidato.confianca && (
            <span className="text-xs text-muted-foreground">
              {IMAGENS_PRODUTO_CONFIANCA_PREFIX}{" "}
              {IMAGENS_PRODUTO_CONFIANCA_LABELS[candidato.confianca] ?? candidato.confianca}
            </span>
          )}
        </div>
      </header>

      {galeria.length === 0 && (
        <p className="text-sm text-muted-foreground">{IMAGENS_PRODUTO_SEM_IMAGENS_MESSAGE}</p>
      )}
      {galeria.length > 0 && !temElegivel && (
        <p className="text-sm text-destructive">{IMAGENS_PRODUTO_SEM_ELEGIVEIS_MESSAGE}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ImagensProdutoGaleria
          galeria={galeria}
          selecao={selecao}
          recomendadas={recomendadas}
          focada={focada}
          disabled={busy}
          onFocar={setFocada}
          onPrincipal={definirPrincipal}
          onSecundaria={definirSecundaria}
        />

        <aside className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">{IMAGENS_PRODUTO_SELECAO_TITLE}</h3>

          <div className="grid grid-cols-2 gap-2">
            <figure className="flex flex-col gap-1">
              <ImagemLacoste
                url={urlDe(selecao.principal)}
                alt={IMAGENS_PRODUTO_PRINCIPAL_LABEL}
                className="aspect-square w-full rounded-lg"
              />
              <figcaption className="text-xs text-muted-foreground">
                {IMAGENS_PRODUTO_PRINCIPAL_LABEL}
              </figcaption>
            </figure>
            <figure className="flex flex-col gap-1">
              <ImagemLacoste
                url={urlDe(selecao.secundaria)}
                alt={IMAGENS_PRODUTO_SECUNDARIA_LABEL}
                className="aspect-square w-full rounded-lg"
              />
              <figcaption className="text-xs text-muted-foreground">
                {selecao.secundaria === null
                  ? IMAGENS_PRODUTO_SEM_SECUNDARIA_LABEL
                  : IMAGENS_PRODUTO_SECUNDARIA_LABEL}
              </figcaption>
            </figure>
          </div>

          {selecao.principal === null && (
            <p className="text-xs text-muted-foreground">{IMAGENS_PRODUTO_SELECAO_VAZIA_MESSAGE}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || selecao.secundaria === null}
              onClick={() => setSelecao((atual) => ({ ...atual, secundaria: null }))}
            >
              {IMAGENS_PRODUTO_LIMPAR_SECUNDARIA_LABEL}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setSelecao(inicial)}
            >
              {IMAGENS_PRODUTO_USAR_RECOMENDACAO_LABEL}
            </Button>
          </div>

          <label htmlFor="imagens-produto-observacao" className="text-xs text-muted-foreground">
            {IMAGENS_PRODUTO_OBSERVACAO_LABEL}
          </label>
          <Textarea
            id="imagens-produto-observacao"
            value={observacao}
            disabled={busy}
            maxLength={500}
            aria-describedby="imagens-produto-observacao-help"
            onChange={(event) => setObservacao(event.target.value)}
          />
          <p id="imagens-produto-observacao-help" className="text-xs text-muted-foreground">
            {IMAGENS_PRODUTO_OBSERVACAO_HELP}
          </p>

          {errorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              className="min-touch"
              disabled={!podeAprovar}
              onClick={() => void aprovarAgora()}
            >
              {busy ? IMAGENS_PRODUTO_ENVIANDO_LABEL : IMAGENS_PRODUTO_APROVAR_LABEL}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-touch text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => setRejeitando(true)}
            >
              {IMAGENS_PRODUTO_REJEITAR_LABEL}
            </Button>
          </div>

          {candidato.limitacoes && candidato.limitacoes.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              <span className="text-xs font-semibold text-foreground">
                {IMAGENS_PRODUTO_LIMITACOES_TITLE}
              </span>
              <span className="text-xs text-muted-foreground">
                {IMAGENS_PRODUTO_LIMITACOES_HINT}
              </span>
              <ul className="list-disc pl-4 text-xs text-muted-foreground">
                {candidato.limitacoes.map((limitacao) => (
                  <li key={limitacao}>{limitacao}</li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      <ConfirmarRejeicaoDialog
        open={rejeitando}
        busy={busy}
        onOpenChange={setRejeitando}
        onConfirmar={(motivo) => void confirmarRejeicao(motivo)}
      />
    </div>
  );
}
