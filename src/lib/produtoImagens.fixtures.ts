import type { CandidatoImagemPendente } from "@/integrations/supabase/contracts";

// Shared test fixtures for the product image review (Slice 5A). Mirrors the
// shapes returned by get_candidatos_imagem_pendentes; no real product data.
export const CDN = "//imagesa1.lacoste.com/dw/image/v2/X";

export const GALERIA = [
  { desktopUrl: `${CDN}/dwaaaa1111/TST_24.jpg`, type: "image", alt: "frente" }, // 0 eligible
  { desktopUrl: `${CDN}/dwbbbb2222/TST_20.jpg`, type: "image" }, // 1 person
  { desktopUrl: `${CDN}/dwcccc3333/TST_31.jpg`, type: "image" }, // 2 eligible
  { desktopUrl: "//evil.example.com/x.jpg", type: "image" }, // 3 foreign host
  { desktopUrl: `${CDN}/dwdddd4444/TST_L1.jpg`, type: "look" }, // 4 not a product photo
  { desktopUrl: `${CDN}/dweeee5555/TST_32.jpg`, type: "image" }, // 5 contradictory
  { desktopUrl: `${CDN}/dwffff6666/TST_33.jpg`, type: "image" }, // 6 no evaluation
  { desktopUrl: `${CDN}/dwgggg7777/TST_34.jpg`, type: "image" }, // 7 has_person=false, not product-only
];

export const AVALIACOES = [
  { index: 0, has_person: false, product_only_still: true },
  { index: 1, has_person: true, product_only_still: false },
  { index: 2, has_person: false, product_only_still: true },
  { index: 3, has_person: false, product_only_still: true },
  { index: 4, has_person: false, product_only_still: true },
  { index: 5, has_person: true, product_only_still: true },
  { index: 7, has_person: false, product_only_still: false },
];

export function candidatoFixture(
  overrides: Partial<CandidatoImagemPendente> = {},
): CandidatoImagemPendente {
  return {
    id: "c1",
    produto: "TST-001",
    cor_codigo: "T01",
    lacoste_product_name: "Polo de teste",
    lacoste_color_label: "Azul",
    resolved_url: "https://www.lacoste.com/x",
    galeria: GALERIA,
    primary_candidate_url: `https:${CDN}/dwaaaa1111/TST_24.jpg`,
    primary_candidate_reason: "frente completa",
    secondary_candidate_url: `https:${CDN}/dwcccc3333/TST_31.jpg`,
    secondary_candidate_reason: "outra vista",
    confianca: "high",
    avaliacoes_ia: AVALIACOES,
    limitacoes: ["Poucas vistas"],
    criado_em: "2026-10-30T12:00:00Z",
    ...overrides,
  };
}
