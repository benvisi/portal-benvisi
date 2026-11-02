import type { SupabaseClient } from "@supabase/supabase-js";

import type { CandidatoImagemPendente } from "@/integrations/supabase/contracts";
import { AuthSession } from "@/lib/session";
import { montarGaleria, selecaoValida } from "@/lib/produtoImagens";

/**
 * Demonstration mode for the product image reviewer (Trello #10, Slice 5B-1).
 *
 * When — and only when — the build sets VITE_IMAGENS_PRODUTO_PREVIEW_MOCK=true,
 * `src/integrations/supabase/client.ts` exports THIS in-memory client instead of
 * a real Supabase client. No real client is ever created in that build, so the
 * browser has no URL, key or network path to the production database: approving
 * or rejecting here only mutates module state and vanishes on reload.
 *
 * Safety layers:
 *  - opt-in build-time flag (unset in production → this code is dead and the
 *    real client is used);
 *  - runtime host allowlist (localhost / *.vercel.app) — the app refuses to
 *    start in mock mode anywhere else, e.g. a custom production domain;
 *  - only the three image-review RPCs are answered; every other RPC is
 *    rejected, so nothing else in the app can appear to work against real data.
 *
 * The candidates below are a read-only snapshot of the seven pending
 * candidates (public Lacoste CDN images; AI notes shortened).
 */
const PREVIEW_SESSION_TOKEN = "preview-mock-session";

export function isPreviewHostAllowed(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".vercel.app");
}

const CDN =
  "//imagesa1.lacoste.com/dw/image/v2/BCWL_PRD/on/demandware.static/-/Sites-master/default";

// [dw hash, file name, has_person, product_only_still] per gallery image.
type Img = readonly [string, string, boolean, boolean];

function candidato(
  id: string,
  produto: string,
  corCodigo: string,
  corLabel: string,
  nome: string,
  resolvedUrl: string,
  imagens: readonly Img[],
  principal: number,
  secundaria: number | null,
  confianca: "high" | "medium" | "low",
  principalReason: string,
  secundariaReason: string | null,
  limitacoes: string[],
  criadoEm: string,
): CandidatoImagemPendente {
  const url = (i: number) => `https:${CDN}/dw${imagens[i][0]}/${imagens[i][1]}`;
  return {
    id,
    produto,
    cor_codigo: corCodigo,
    lacoste_product_name: nome,
    lacoste_color_label: corLabel,
    resolved_url: resolvedUrl,
    galeria: imagens.map((img) => ({
      alt: nome,
      type: "image",
      desktopUrl: `${CDN}/dw${img[0]}/${img[1]}`,
    })),
    primary_candidate_url: url(principal),
    primary_candidate_reason: principalReason,
    secondary_candidate_url: secundaria === null ? null : url(secundaria),
    secondary_candidate_reason: secundariaReason,
    confianca,
    avaliacoes_ia: imagens.map((img, index) => ({
      index,
      has_person: img[2],
      product_only_still: img[3],
    })),
    limitacoes,
    criado_em: criadoEm,
  };
}

const OK = [false, true] as const; // no person, product-only still
const PESSOA = [true, false] as const; // model photo

function img(hash: string, file: string, flags: readonly [boolean, boolean]): Img {
  return [hash, file, flags[0], flags[1]];
}

export function criarCandidatosPreview(): CandidatoImagemPendente[] {
  return [
    candidato(
      "c361f2eb-c7d7-454f-8af0-0f3674999c94",
      "46SMA0045BR",
      "02H",
      "Black",
      "Tênis Masculino Lineset",
      "https://www.lacoste.com/br/lacoste/masculino/calcados/tenis/46SMA0045BR.html?color=02H",
      [
        img("12ab8a32", "46SMA0045BR_02H_01.jpg", OK),
        img("88041c04", "46SMA0045BR_02H_02.jpg", OK),
        img("743cd55c", "46SMA0045BR_02H_03.jpg", OK),
        img("6f02a140", "46SMA0045BR_02H_04.jpg", OK),
        img("5ed74833", "46SMA0045BR_02H_05.jpg", OK),
        img("640375df", "46SMA0045BR_02H_06.jpg", OK),
      ],
      1,
      2,
      "high",
      "Pair shown in a three-quarter front view. It is a product-only still with the whole product visible, uncropped, on a clean background.",
      "Rear three-quarter view of the pair. It shows the heel, collar and side profile, which the primary doesn't, and has no person.",
      [
        "Image 0 is also a strong candidate for primary: it is a clean single-shoe profile.",
        "The all-black shoe has low contrast, so some construction details are hard to judge.",
      ],
      "2026-10-29T19:52:28Z",
    ),
    candidato(
      "b2409727-9119-4056-8580-412b138b74b9",
      "FH2349-23",
      "02S",
      "Sandy Beige",
      "Bermuda Chino em Sarja Stretch",
      "https://www.lacoste.com/br/lacoste/masculino/vestu%C3%A1rio/calcas-bermudas/FH2349-23.html?color=02S",
      [
        img("8487d16d", "FH2349_02S_20.jpg", PESSOA),
        img("5ae7b090", "FH2349_02S_21.jpg", PESSOA),
        img("11d0ea08", "FH2349_02S_22.jpg", PESSOA),
        img("468b024e", "FH2349_02S_24.jpg", OK),
        img("63336633", "FH2349_02S_31.jpg", OK),
        img("8a921ca3", "FH2349_02S_32.jpg", OK),
        img("f56c13f4", "FH2349_02S_33.jpg", OK),
        img("5c99a40a", "FH2349_02S_34.jpg", OK),
      ],
      3,
      null,
      "high",
      "It is the only product-only still that shows the whole garment. There is no person, the shorts are uncropped, the background is clean, and it is the front view.",
      null,
      [
        "There is no product-only full back view, so no secondary view qualifies.",
        "The flat-lay in image 3 has a lot of white space around the shorts.",
      ],
      "2026-10-29T19:52:34Z",
    ),
    candidato(
      "412256e6-0232-4ca2-81f5-0714a2b8f485",
      "NF2142AA",
      "A91",
      "Noir Krema",
      "Bolsa Tote Reversível Anna com Pouch",
      "https://www.lacoste.com/br/lacoste/feminino/acess%C3%B3rios/bolsas/NF2142AA.html?color=A91",
      [
        img("83764cac", "NF2142AA_A91_24.jpg", OK),
        img("273f02e9", "NF2142AA_A91_31.jpg", OK),
        img("2e2e848a", "NF2142AA_A91_32.jpg", OK),
        img("6a6b5df0", "NF2142AA_A91_33.jpg", OK),
        img("5d922dd5", "NF2142AA_A91_34.jpg", OK),
        img("3333c55e", "NF2142AA_A91_35.jpg", OK),
        img("adcc9d3d", "NF2142AA_A91_36.jpg", OK),
        img("f1c3b116", "NF2142AA_A91_37.jpg", OK),
        img("eed9e6d2", "NF2142AA_A91_38.jpg", PESSOA),
      ],
      0,
      4,
      "medium",
      "Product-only still of the black (Noir) side. It shows the full tote and the included pouch, is uncropped, has a clean background and uses a frontal view.",
      "Front view of the reversed beige (Krema) side with the pouch. It shows the reversibility, which the primary does not, and has no person.",
      [
        "I can't confirm which side of the bag the A91 'Noir Krema' colour code refers to.",
        "Image 7 shows an olive-looking pouch, which differs from the beige pouch in the other images.",
        "Image 8 has a person and is excluded from primary and secondary selection.",
      ],
      "2026-10-29T19:52:39Z",
    ),
    candidato(
      "1d02296d-2130-45f4-bf84-c83ac6363e49",
      "DH6771-23",
      "EV0",
      "White / Navy Blue",
      "Camisa Polo Ultra Dry Badge Accent Tennis Heritage",
      "https://www.lacoste.com/br/lacoste/masculino/vestu%C3%A1rio/polos/DH6771-23.html?color=EV0",
      [
        img("82b32b67", "DH6771_EV0_20.jpg", PESSOA),
        img("526dc079", "DH6771_EV0_21.jpg", PESSOA),
        img("b490776d", "DH6771_EV0_22.jpg", PESSOA),
        img("36afdeb9", "DH6771_EV0_23.jpg", PESSOA),
        img("a9b3f245", "DH6771_EV0_24.jpg", OK),
        img("ee2aa446", "DH6771_EV0_31.jpg", OK),
        img("69292210", "DH6771_EV0_32.jpg", OK),
        img("65a8a7eb", "DH6771_EV0_33.jpg", OK),
      ],
      4,
      null,
      "high",
      "Only image that is a product-only still showing the whole polo, uncropped, front view, on a clean background with no person.",
      null,
      [
        "No person-free back or side view of the whole product is available.",
        "Product color appears off-white/cream, so a match to the listed 'White / Navy Blue' variant can't be fully verified.",
      ],
      "2026-10-29T21:59:53Z",
    ),
    candidato(
      "296d8f78-3479-4af1-8c8e-2e4be346b668",
      "PH8184-23",
      "70V",
      "Branco",
      "Polo Regular Fit Paris em Piqué Stretch",
      "https://www.lacoste.com/br/lacoste/masculino/vestu%C3%A1rio/polos/PH8184-23.html?color=70V",
      [
        img("32acbd9e", "PH8184_70V_20.jpg", PESSOA),
        img("45aefec8", "PH8184_70V_21.jpg", PESSOA),
        img("1d52580b", "PH8184_70V_22.jpg", PESSOA),
        img("763ddbbb", "PH8184_70V_24.jpg", OK),
        img("6a00b09e", "PH8184_70V_31.jpg", OK),
        img("45948029", "PH8184_70V_32.jpg", OK),
      ],
      3,
      null,
      "high",
      "It is the only product-only still that shows the whole garment uncropped. The view is front-facing on a clean background and the color and piping details are clear.",
      null,
      [
        "The gallery has no person-free back or side view of the whole product.",
        "Image 3's color looks slightly creamier than the model photos.",
      ],
      "2026-10-29T21:59:55Z",
    ),
    candidato(
      "da6e40b8-bb23-495b-8b17-588b571cc01d",
      "TH3604-23",
      "166",
      "Midnight blue",
      "Camiseta de Algodão com Estampa",
      "https://www.lacoste.com/br/lacoste/masculino/vestu%C3%A1rio/camisetas/TH3604-23.html?color=166",
      [
        img("f5e694af", "TH3604_166_24.jpg", OK),
        img("b3819e52", "TH3604_166_31.jpg", OK),
        img("1761afb1", "TH3604_166_32.jpg", OK),
      ],
      0,
      null,
      "high",
      "It is the only image that shows the whole t-shirt. It is a front view with no person, uncropped, on a clean white background.",
      null,
      [
        "The gallery has no full back or side view of the garment.",
        "The color match to Midnight blue / 166 is judged visually only.",
      ],
      "2026-10-29T21:59:59Z",
    ),
    candidato(
      "79cf60eb-6382-4655-9724-9556838aa04d",
      "HH5019-23",
      "MK9",
      "Azul",
      "Calça Jeans Slim Fit Indigo com 5 Bolsos",
      "https://www.lacoste.com/br/lacoste/masculino/vestu%C3%A1rio/calcas-bermudas/HH5019-23.html?color=MK9",
      [
        img("05a120b9", "HH5019_MK9_20.jpg", PESSOA),
        img("5bfd2b53", "HH5019_MK9_21.jpg", PESSOA),
        img("c52d227f", "HH5019_MK9_22.jpg", PESSOA),
        img("e0ca868a", "HH5019_MK9_24.jpg", OK),
        img("c8ed651a", "HH5019_MK9_31.jpg", OK),
        img("5360689c", "HH5019_MK9_32.jpg", OK),
        img("8856eee6", "HH5019_MK9_33.jpg", OK),
        img("72a69457", "HH5019_MK9_34.jpg", OK),
        img("daf1e76d", "HH5019_MK9_36.jpg", PESSOA),
        // Contradictory AI evaluation (person + product-only still): ineligible.
        img("711d35d3", "HH5019_MK9_37.jpg", [true, true]),
      ],
      3,
      null,
      "high",
      "The only product-only still showing the whole jeans, uncropped, front view, clean white background, with no person.",
      null,
      [
        "The model photos show slightly different washes and fits and may be different variants.",
        "Image 9 is flagged product_only_still=true by mistake: it shows a person, so it does not qualify.",
        "There is no person-free full back view.",
      ],
      "2026-10-29T22:00:02Z",
    ),
  ];
}

// Created on first use so merely importing this module has no side effects.
let pendentesCache: CandidatoImagemPendente[] | null = null;

function pendentes(): CandidatoImagemPendente[] {
  pendentesCache ??= criarCandidatosPreview();
  return pendentesCache;
}

/** Test helper: restores the seven pending candidates. */
export function resetPreviewState(): void {
  pendentesCache = criarCandidatosPreview();
}

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

const ok = (data: unknown): RpcResult => ({ data, error: null });
const fail = (message: string): RpcResult => ({ data: null, error: { message } });

/** Mirrors the SQL rules of aprovar_candidato_imagem / rejeitar_candidato_imagem. */
export function previewRpc(name: string, args: Record<string, unknown> = {}): RpcResult {
  switch (name) {
    case "get_produto_imagens_permissao":
      return ok(true);
    case "get_candidatos_imagem_pendentes":
      return ok(pendentes());
    case "aprovar_candidato_imagem": {
      const alvo = pendentes().find((c) => c.id === args.p_candidato_id);
      if (!alvo) return fail("CANDIDATO_NAO_ENCONTRADO");
      const principal = args.p_indice_principal;
      const secundaria = args.p_indice_secundaria ?? null;
      if (
        typeof principal !== "number" ||
        (secundaria !== null && typeof secundaria !== "number")
      ) {
        return fail("INDICE_INVALIDO");
      }
      const galeria = montarGaleria(alvo.galeria, alvo.avaliacoes_ia);
      if (!selecaoValida(galeria, { principal, secundaria })) return fail("IMAGEM_NAO_ELEGIVEL");
      pendentesCache = pendentes().filter((c) => c.id !== alvo.id);
      return ok(`preview-publicacao-${alvo.id}`);
    }
    case "rejeitar_candidato_imagem": {
      const alvo = pendentes().find((c) => c.id === args.p_candidato_id);
      if (!alvo) return fail("CANDIDATO_NAO_ENCONTRADO");
      const motivo = typeof args.p_observacao === "string" ? args.p_observacao.trim() : "";
      if (motivo.length === 0) return fail("OBSERVACAO_OBRIGATORIA");
      pendentesCache = pendentes().filter((c) => c.id !== alvo.id);
      return ok(null);
    }
    default:
      return fail("PREVIEW_RPC_BLOQUEADA");
  }
}

/**
 * In-memory stand-in for the Supabase client. Only `rpc` exists on purpose:
 * `.from()`, `.auth`, `.storage` etc. are undefined, so any other use throws.
 */
export function createPreviewSupabaseClient(latencyMs = 250): SupabaseClient {
  if (typeof window !== "undefined" && !isPreviewHostAllowed(window.location.hostname)) {
    throw new Error("Image review preview mode is not allowed on this host");
  }
  if (typeof window !== "undefined" && !AuthSession.isAuthenticated()) {
    AuthSession.save({
      funcionario_id: "00000000-0000-0000-0000-000000000000",
      nome: "Revisor de demonstração",
      apelido: "Demonstração",
      cargo: "Gerente",
      timestamp_login: new Date().toISOString(),
      session_token: PREVIEW_SESSION_TOKEN,
    });
  }
  const client = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      return previewRpc(name, args);
    },
  };
  return client as unknown as SupabaseClient;
}
