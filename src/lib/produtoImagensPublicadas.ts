import type { ProdutoImagemPublicada } from "@/integrations/supabase/contracts";

export interface ImagensDaCor {
  principal: string;
  secundaria: string | null;
}

/**
 * Groups the active published files by colour. A colour only appears when it
 * has a primary image (the secondary alone is never shown), so the stock
 * matrix shows no icon for unpublished or incomplete colours.
 */
export function agruparImagensPorCor(
  linhas: readonly ProdutoImagemPublicada[],
  buildUrl: (storagePath: string) => string,
): Map<string, ImagensDaCor> {
  const principais = new Map<string, string>();
  const secundarias = new Map<string, string>();
  for (const linha of linhas) {
    const alvo = linha.slot === "principal" ? principais : secundarias;
    if (!alvo.has(linha.cor_codigo)) alvo.set(linha.cor_codigo, buildUrl(linha.storage_path));
  }

  const porCor = new Map<string, ImagensDaCor>();
  for (const [cor, principal] of principais) {
    porCor.set(cor, { principal, secundaria: secundarias.get(cor) ?? null });
  }
  return porCor;
}

/** Ordered list of the images a colour can show in the viewer. */
export function listarImagensDaCor(imagens: ImagensDaCor): { slot: string; url: string }[] {
  const lista = [{ slot: "principal", url: imagens.principal }];
  if (imagens.secundaria !== null) lista.push({ slot: "secundaria", url: imagens.secundaria });
  return lista;
}
