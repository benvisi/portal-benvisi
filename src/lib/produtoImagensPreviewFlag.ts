/**
 * Build-time opt-in for the product image reviewer demonstration mode (see
 * produtoImagensPreview.ts). Kept in its own tiny module so that, when the
 * flag is off (every normal build), the bundler can drop the demo data.
 */
export const IMAGENS_PRODUTO_PREVIEW_MOCK =
  import.meta.env.VITE_IMAGENS_PRODUTO_PREVIEW_MOCK === "true";

export const PREVIEW_BANNER_TEXT =
  "Pré-visualização de demonstração — dados fictícios. Nenhuma decisão é salva.";
