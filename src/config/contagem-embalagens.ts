/**
 * Milestone 4D: presentation-only config for the Contagem de Embalagens
 * form. The authoritative catalog (items, package sizes, order, active
 * flag) lives in the database table `contagem_embalagem_itens` and is
 * fetched via `get_contagem_catalogo` — nothing here affects any
 * calculation. This module only maps the stable `familia` codes returned
 * by the RPC to the PT-BR group headings shown above each block of items,
 * and defines the order those groups appear in.
 *
 * A `familia` with no entry here still renders (its raw code is used as the
 * heading and it sorts last), so adding a new family in the DB does not
 * require a frontend change to be usable — only to look polished.
 */
export const CONTAGEM_FAMILIA_LABELS: Record<string, string> = {
  sacola_boutique: "Sacola Boutique",
  envelope: "Envelope",
  seda: "Seda",
  etiqueta: "Etiqueta",
  de_para: "De/Para",
  outlet: "Outlet",
};

export const CONTAGEM_FAMILIA_ORDEM: readonly string[] = [
  "sacola_boutique",
  "envelope",
  "seda",
  "etiqueta",
  "de_para",
  "outlet",
];

export function familiaLabel(familia: string): string {
  return CONTAGEM_FAMILIA_LABELS[familia] ?? familia;
}

export function familiaOrdem(familia: string): number {
  const index = CONTAGEM_FAMILIA_ORDEM.indexOf(familia);
  return index === -1 ? CONTAGEM_FAMILIA_ORDEM.length : index;
}
