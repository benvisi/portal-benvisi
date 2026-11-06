import { describe, expect, it } from "vitest";

import { isProdutoImagemPublicada } from "@/integrations/supabase/contracts";
import { agruparImagensPorCor, listarImagensDaCor } from "@/lib/produtoImagensPublicadas";

const url = (path: string) => `https://cdn.test/${path}`;
const linha = (cor: string, slot: "principal" | "secundaria", path: string) => ({
  cor_codigo: cor,
  slot,
  storage_path: path,
});

describe("agruparImagensPorCor", () => {
  it("returns an entry only for colours with a published primary image", () => {
    const mapa = agruparImagensPorCor(
      [linha("02H", "principal", "a/02H-1.webp"), linha("02H", "secundaria", "a/02H-2.webp")],
      url,
    );
    expect([...mapa.keys()]).toEqual(["02H"]);
    expect(mapa.has("1R5")).toBe(false);
    expect(mapa.get("02H")).toEqual({
      principal: "https://cdn.test/a/02H-1.webp",
      secundaria: "https://cdn.test/a/02H-2.webp",
    });
  });

  it("keeps the secondary optional", () => {
    const mapa = agruparImagensPorCor([linha("02H", "principal", "p.webp")], url);
    expect(mapa.get("02H")?.secundaria).toBeNull();
  });

  it("ignores a colour that only has a secondary image", () => {
    expect(agruparImagensPorCor([linha("02H", "secundaria", "s.webp")], url).size).toBe(0);
  });

  it("returns an empty map when nothing is published", () => {
    expect(agruparImagensPorCor([], url).size).toBe(0);
  });
});

describe("listarImagensDaCor", () => {
  it("lists primary first and the secondary only when present", () => {
    expect(listarImagensDaCor({ principal: "p", secundaria: "s" }).map((i) => i.slot)).toEqual([
      "principal",
      "secundaria",
    ]);
    expect(listarImagensDaCor({ principal: "p", secundaria: null })).toEqual([
      { slot: "principal", url: "p" },
    ]);
  });
});

describe("isProdutoImagemPublicada", () => {
  it("accepts valid rows and rejects malformed ones", () => {
    expect(isProdutoImagemPublicada(linha("02H", "principal", "p"))).toBe(true);
    expect(isProdutoImagemPublicada({ ...linha("02H", "principal", "p"), slot: "x" })).toBe(false);
    expect(isProdutoImagemPublicada(linha("", "principal", "p"))).toBe(false);
    expect(isProdutoImagemPublicada(linha("02H", "principal", ""))).toBe(false);
    expect(isProdutoImagemPublicada(null)).toBe(false);
  });
});
