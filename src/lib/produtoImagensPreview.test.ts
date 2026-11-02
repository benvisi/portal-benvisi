import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { isCandidatoImagemPendente } from "@/integrations/supabase/contracts";
import { montarGaleria } from "@/lib/produtoImagens";
import { IMAGENS_PRODUTO_PREVIEW_MOCK } from "@/lib/produtoImagensPreviewFlag";
import {
  criarCandidatosPreview,
  createPreviewSupabaseClient,
  isPreviewHostAllowed,
  previewRpc,
  resetPreviewState,
} from "@/lib/produtoImagensPreview";

beforeEach(() => resetPreviewState());

describe("preview mode safety", () => {
  it("is off unless the build explicitly opts in", () => {
    expect(IMAGENS_PRODUTO_PREVIEW_MOCK).toBe(false);
    const client = readFileSync(
      new URL("../integrations/supabase/client.ts", import.meta.url),
      "utf8",
    );
    expect(client).toMatch(
      /if \(import\.meta\.env\.VITE_IMAGENS_PRODUTO_PREVIEW_MOCK === "true"\)\s+return createPreviewSupabaseClient\(\)/,
    );
    expect(client).toContain("createClient(supabaseUrl, supabasePublishableKey)");
  });

  it("only allows localhost and *.vercel.app hosts", () => {
    expect(isPreviewHostAllowed("localhost")).toBe(true);
    expect(isPreviewHostAllowed("portal-benvisi-git-x-benvisi.vercel.app")).toBe(true);
    expect(isPreviewHostAllowed("portal.benvisi.com.br")).toBe(false);
    expect(isPreviewHostAllowed("evilvercel.app")).toBe(false);
  });

  it("exposes nothing but rpc on the mock client", () => {
    const client = createPreviewSupabaseClient(0) as unknown as Record<string, unknown>;
    expect(Object.keys(client)).toEqual(["rpc"]);
  });

  it("rejects every RPC outside the three image-review ones", () => {
    for (const name of ["verify_pin", "get_vendas_metricas_periodo", "iniciar_atendimento"]) {
      expect(previewRpc(name, { p_session_token: "x" }).error?.message).toBe(
        "PREVIEW_RPC_BLOQUEADA",
      );
    }
  });
});

describe("preview data", () => {
  const candidatos = criarCandidatosPreview();

  it("has the seven pending product/color candidates in the production row shape", () => {
    expect(candidatos).toHaveLength(7);
    expect(candidatos.every(isCandidatoImagemPendente)).toBe(true);
    expect(new Set(candidatos.map((c) => `${c.produto}/${c.cor_codigo}`)).size).toBe(7);
  });

  it("recommends only eligible images that exist in each gallery", () => {
    for (const c of candidatos) {
      const galeria = montarGaleria(c.galeria, c.avaliacoes_ia);
      for (const url of [c.primary_candidate_url, c.secondary_candidate_url]) {
        if (url === null) continue;
        const imagem = galeria.find((g) => g.url === url);
        expect(imagem?.elegivel, `${c.produto} ${url}`).toBe(true);
      }
    }
  });

  it("covers person, contradictory-evaluation and single-recommendation cases", () => {
    const motivos = candidatos.flatMap((c) =>
      montarGaleria(c.galeria, c.avaliacoes_ia).map((g) => g.motivo),
    );
    expect(motivos).toContain("pessoa");
    expect(motivos).toContain("avaliacao_ambigua");
    expect(candidatos.some((c) => c.secondary_candidate_url !== null)).toBe(true);
    expect(candidatos.some((c) => c.secondary_candidate_url === null)).toBe(true);
  });
});

describe("mocked review outcomes (in memory only)", () => {
  const listar = () => previewRpc("get_candidatos_imagem_pendentes").data as { id: string }[];

  it("approves an eligible selection and removes the candidate from the queue", () => {
    const alvo = criarCandidatosPreview()[0];
    const result = previewRpc("aprovar_candidato_imagem", {
      p_candidato_id: alvo.id,
      p_indice_principal: 1,
      p_indice_secundaria: 2,
    });
    expect(result.error).toBeNull();
    expect(typeof result.data).toBe("string");
    expect(listar()).toHaveLength(6);
  });

  it("refuses an ineligible (person) image like the database does", () => {
    const alvo = criarCandidatosPreview()[1];
    const result = previewRpc("aprovar_candidato_imagem", {
      p_candidato_id: alvo.id,
      p_indice_principal: 0,
      p_indice_secundaria: null,
    });
    expect(result.error?.message).toBe("IMAGEM_NAO_ELEGIVEL");
    expect(listar()).toHaveLength(7);
  });

  it("requires a reason to reject, then removes the candidate", () => {
    const alvo = criarCandidatosPreview()[2];
    expect(
      previewRpc("rejeitar_candidato_imagem", { p_candidato_id: alvo.id, p_observacao: "  " }).error
        ?.message,
    ).toBe("OBSERVACAO_OBRIGATORIA");
    expect(
      previewRpc("rejeitar_candidato_imagem", {
        p_candidato_id: alvo.id,
        p_observacao: "Cor errada",
      }).error,
    ).toBeNull();
    expect(listar()).toHaveLength(6);
  });

  it("reports an already-reviewed candidate as not found", () => {
    const alvo = criarCandidatosPreview()[0];
    previewRpc("rejeitar_candidato_imagem", { p_candidato_id: alvo.id, p_observacao: "x" });
    expect(
      previewRpc("rejeitar_candidato_imagem", { p_candidato_id: alvo.id, p_observacao: "x" }).error
        ?.message,
    ).toBe("CANDIDATO_NAO_ENCONTRADO");
  });
});
