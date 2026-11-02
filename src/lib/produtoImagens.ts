import {
  IMAGENS_PRODUTO_ERRO_GENERICO_MESSAGE,
  IMAGENS_PRODUTO_ERRO_IDENTIDADE_MESSAGE,
  IMAGENS_PRODUTO_ERRO_INELEGIVEL_MESSAGE,
  IMAGENS_PRODUTO_ERRO_MOTIVO_MESSAGE,
  IMAGENS_PRODUTO_ERRO_SEM_PERMISSAO_MESSAGE,
  IMAGENS_PRODUTO_ERRO_TRANSICAO_MESSAGE,
} from "@/config/constants";

/**
 * Product image review (Trello #10, Slice 5A) — pure helpers.
 *
 * The database is the authority: aprovar_candidato_imagem re-validates every
 * index through produto_imagem_url_galeria + produto_imagem_elegivel and has
 * no override. The eligibility mirror below only decides what the reviewer
 * can click, and is deliberately at least as strict as the SQL rule: anything
 * missing, contradictory or oddly typed is "not eligible".
 */

export type MotivoInelegivel =
  "nao_e_foto" | "origem_nao_permitida" | "sem_avaliacao" | "avaliacao_ambigua" | "pessoa";

export interface ImagemGaleria {
  /** 0-based position in the stored gallery — the value the RPC expects. */
  index: number;
  /** Normalized https URL, or null when the entry has no usable URL. */
  url: string | null;
  alt: string;
  elegivel: boolean;
  motivo: MotivoInelegivel | null;
}

// Same host rule as produto_imagem_url_galeria (SQL) and normalizeGallery
// (worker): lacoste.com or a subdomain, https only, no credentials.
const LACOSTE_URL_PATTERN = /^(https:)?\/\/([a-z0-9-]+\.)*lacoste\.com\/[^@\s]+$/i;

function normalizarUrlGaleria(raw: unknown): string | null {
  if (typeof raw !== "string" || !LACOSTE_URL_PATTERN.test(raw)) return null;
  return raw.startsWith("//") ? `https:${raw}` : raw;
}

interface Avaliacao {
  has_person?: unknown;
  product_only_still?: unknown;
  index?: unknown;
}

function avaliacoesDoIndice(avaliacoes: unknown, index: number): Avaliacao[] {
  if (!Array.isArray(avaliacoes)) return [];
  return avaliacoes.filter(
    (item): item is Avaliacao =>
      typeof item === "object" && item !== null && (item as Avaliacao).index === index,
  );
}

function classificarIndice(
  entry: unknown,
  avaliacoes: unknown,
  index: number,
): { url: string | null; motivo: MotivoInelegivel | null } {
  const item =
    typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
  const url = normalizarUrlGaleria(item.desktopUrl);

  if (item.type !== "image") return { url, motivo: "nao_e_foto" };
  if (url === null) return { url, motivo: "origem_nao_permitida" };

  const doIndice = avaliacoesDoIndice(avaliacoes, index);
  if (doIndice.length === 0) return { url, motivo: "sem_avaliacao" };

  let ambigua = false;
  let pessoa = false;
  for (const av of doIndice) {
    if (typeof av.has_person !== "boolean" || typeof av.product_only_still !== "boolean") {
      ambigua = true;
    } else if (av.has_person) {
      pessoa = true;
      // has_person=true with product_only_still=true contradicts itself.
      if (av.product_only_still) ambigua = true;
    } else if (!av.product_only_still) {
      ambigua = true;
    }
  }
  if (ambigua) return { url, motivo: "avaliacao_ambigua" };
  if (pessoa) return { url, motivo: "pessoa" };
  return { url, motivo: null };
}

/** Builds the reviewer's view of the retained gallery with per-image eligibility. */
export function montarGaleria(galeria: unknown, avaliacoes: unknown): ImagemGaleria[] {
  if (!Array.isArray(galeria)) return [];
  return galeria.map((entry, index) => {
    const { url, motivo } = classificarIndice(entry, avaliacoes, index);
    const alt =
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { alt?: unknown }).alt === "string"
        ? (entry as { alt: string }).alt
        : "";
    return { index, url, alt, elegivel: motivo === null, motivo };
  });
}

/** Gallery index of an AI-recommended URL, or null when absent/unknown. */
export function indiceDaRecomendacao(
  galeria: readonly ImagemGaleria[],
  url: string | null,
): number | null {
  if (!url) return null;
  return galeria.find((img) => img.url === url)?.index ?? null;
}

export interface SelecaoImagens {
  principal: number | null;
  secundaria: number | null;
}

/** True only when every selected index exists in the gallery and is eligible. */
export function selecaoValida(galeria: readonly ImagemGaleria[], selecao: SelecaoImagens): boolean {
  const { principal, secundaria } = selecao;
  if (principal === null) return false;
  if (secundaria !== null && secundaria === principal) return false;
  const elegivel = (index: number) => galeria.find((img) => img.index === index)?.elegivel === true;
  return elegivel(principal) && (secundaria === null || elegivel(secundaria));
}

/** Initial selection: the AI recommendation, kept only where it is eligible. */
export function selecaoInicial(
  galeria: readonly ImagemGaleria[],
  principalUrl: string | null,
  secundariaUrl: string | null,
): SelecaoImagens {
  const keep = (index: number | null) =>
    index !== null && galeria.find((img) => img.index === index)?.elegivel === true ? index : null;
  const principal = keep(indiceDaRecomendacao(galeria, principalUrl));
  const secundaria = keep(indiceDaRecomendacao(galeria, secundariaUrl));
  return { principal, secundaria: secundaria === principal ? null : secundaria };
}

const RPC_ERROR_MESSAGES: Record<string, string> = {
  SEM_PERMISSAO_IMAGENS_PRODUTO: IMAGENS_PRODUTO_ERRO_SEM_PERMISSAO_MESSAGE,
  TRANSICAO_INVALIDA: IMAGENS_PRODUTO_ERRO_TRANSICAO_MESSAGE,
  CANDIDATO_NAO_ENCONTRADO: IMAGENS_PRODUTO_ERRO_TRANSICAO_MESSAGE,
  IMAGEM_NAO_ELEGIVEL_PESSOA_OU_AVALIACAO_AUSENTE: IMAGENS_PRODUTO_ERRO_INELEGIVEL_MESSAGE,
  IMAGEM_NAO_ELEGIVEL: IMAGENS_PRODUTO_ERRO_INELEGIVEL_MESSAGE,
  URL_NAO_PERMITIDA: IMAGENS_PRODUTO_ERRO_INELEGIVEL_MESSAGE,
  INDICE_INVALIDO: IMAGENS_PRODUTO_ERRO_INELEGIVEL_MESSAGE,
  IDENTIDADE_NAO_VERIFICADA: IMAGENS_PRODUTO_ERRO_IDENTIDADE_MESSAGE,
  IDENTIDADE_INVALIDA: IMAGENS_PRODUTO_ERRO_IDENTIDADE_MESSAGE,
  OBSERVACAO_OBRIGATORIA: IMAGENS_PRODUTO_ERRO_MOTIVO_MESSAGE,
};

/**
 * Maps the `raise exception ... message = '<CODE>'` codes of the image review
 * RPCs to employee-facing copy. Session errors are handled upstream by
 * useSessionErrorHandler and never reach here.
 */
export function getImagensProdutoErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string") return IMAGENS_PRODUTO_ERRO_GENERICO_MESSAGE;
  return RPC_ERROR_MESSAGES[message] ?? IMAGENS_PRODUTO_ERRO_GENERICO_MESSAGE;
}
