// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IMAGENS_PRODUTO_ERRO_GENERICO_MESSAGE,
  IMAGENS_PRODUTO_ERRO_INELEGIVEL_MESSAGE,
  IMAGENS_PRODUTO_ERRO_MOTIVO_MESSAGE,
} from "@/config/constants";

const rpc = vi.hoisted(() => vi.fn());
const handleSessionError = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useSessionErrorHandler", () => ({
  useSessionErrorHandler: () => handleSessionError,
}));

import { useCandidatoImagemActions } from "@/hooks/useCandidatoImagemActions";
import {
  CANDIDATOS_IMAGEM_PENDENTES_QUERY_KEY,
  fetchCandidatosImagemPendentes,
} from "@/hooks/useCandidatosImagemPendentes";
import { candidatoFixture } from "@/lib/produtoImagens.fixtures";

function setup(sessionToken: string | null = "tok") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const hook = renderHook(() => useCandidatoImagemActions(sessionToken), { wrapper });
  return { ...hook, invalidate };
}

beforeEach(() => {
  rpc.mockReset();
  handleSessionError.mockReset();
  handleSessionError.mockReturnValue(false);
});
afterEach(cleanup);

describe("aprovar", () => {
  it("sends only the session token, ids and indices (never a divergence override)", async () => {
    rpc.mockResolvedValue({ data: "pub-1", error: null });
    const { result, invalidate } = setup();

    let ok = false;
    await act(async () => {
      ok = await result.current.aprovar("c1", { principal: 2, secundaria: 0 }, "  ok  ");
    });

    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("aprovar_candidato_imagem", {
      p_session_token: "tok",
      p_candidato_id: "c1",
      p_indice_principal: 2,
      p_indice_secundaria: 0,
      p_observacao: "ok",
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: CANDIDATOS_IMAGEM_PENDENTES_QUERY_KEY });
    expect(result.current.errorMessage).toBeNull();
  });

  it("sends null for an empty note and for no secondary image", async () => {
    rpc.mockResolvedValue({ data: "pub-1", error: null });
    const { result } = setup();
    await act(async () => {
      await result.current.aprovar("c1", { principal: 0, secundaria: null }, "   ");
    });
    expect(rpc).toHaveBeenCalledWith(
      "aprovar_candidato_imagem",
      expect.objectContaining({ p_indice_secundaria: null, p_observacao: null }),
    );
  });

  it("blocks double submission: concurrent calls reach the RPC once", async () => {
    let resolve: (value: unknown) => void = () => {};
    rpc.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = setup();

    let first: Promise<boolean> = Promise.resolve(false);
    let second: Promise<boolean> = Promise.resolve(true);
    await act(async () => {
      first = result.current.aprovar("c1", { principal: 0, secundaria: null }, "");
      second = result.current.aprovar("c1", { principal: 0, secundaria: null }, "");
      resolve({ data: "pub-1", error: null });
      await Promise.all([first, second]);
    });

    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("reports failure with a friendly message and still refreshes the queue", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "IMAGEM_NAO_ELEGIVEL_PESSOA_OU_AVALIACAO_AUSENTE", code: "P0001" },
    });
    const { result, invalidate } = setup();

    let ok = true;
    await act(async () => {
      ok = await result.current.aprovar("c1", { principal: 1, secundaria: null }, "");
    });

    expect(ok).toBe(false);
    expect(result.current.errorMessage).toBe(IMAGENS_PRODUTO_ERRO_INELEGIVEL_MESSAGE);
    expect(invalidate).toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("does not claim success when the RPC returns no publication id", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { result } = setup();
    let ok = true;
    await act(async () => {
      ok = await result.current.aprovar("c1", { principal: 0, secundaria: null }, "");
    });
    expect(ok).toBe(false);
    expect(result.current.errorMessage).toBe(IMAGENS_PRODUTO_ERRO_GENERICO_MESSAGE);
  });

  it("never calls the RPC without a primary image or without a session token", async () => {
    const withoutPrimary = setup();
    await act(async () => {
      await withoutPrimary.result.current.aprovar("c1", { principal: null, secundaria: 1 }, "");
    });
    const withoutToken = setup(null);
    await act(async () => {
      await withoutToken.result.current.aprovar("c1", { principal: 0, secundaria: null }, "");
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("delegates an expired session to the session handler without a form error", async () => {
    const error = { message: "INVALID_SESSION", code: "P0001" };
    rpc.mockResolvedValue({ data: null, error });
    handleSessionError.mockReturnValue(true);
    const { result } = setup();

    let ok = true;
    await act(async () => {
      ok = await result.current.aprovar("c1", { principal: 0, secundaria: null }, "");
    });

    expect(ok).toBe(false);
    expect(handleSessionError).toHaveBeenCalledWith(error);
    expect(result.current.errorMessage).toBeNull();
  });
});

describe("rejeitar", () => {
  it("sends the trimmed reason and refreshes the queue on success", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { result, invalidate } = setup();

    let ok = false;
    await act(async () => {
      ok = await result.current.rejeitar("c1", "  fotos ruins ");
    });

    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("rejeitar_candidato_imagem", {
      p_session_token: "tok",
      p_candidato_id: "c1",
      p_observacao: "fotos ruins",
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: CANDIDATOS_IMAGEM_PENDENTES_QUERY_KEY });
  });

  it("maps a server-side missing-reason error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "OBSERVACAO_OBRIGATORIA" } });
    const { result } = setup();
    await act(async () => {
      await result.current.rejeitar("c1", "x");
    });
    expect(result.current.errorMessage).toBe(IMAGENS_PRODUTO_ERRO_MOTIVO_MESSAGE);
  });

  it("allows a new action after the previous one finished", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { result } = setup();
    await act(async () => {
      await result.current.rejeitar("c1", "a");
    });
    await act(async () => {
      await result.current.rejeitar("c2", "b");
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("fetchCandidatosImagemPendentes", () => {
  it("calls the queue RPC with only the session token and returns parsed rows", async () => {
    rpc.mockResolvedValue({ data: [candidatoFixture()], error: null });
    const rows = await fetchCandidatosImagemPendentes("tok");
    expect(rpc).toHaveBeenCalledWith("get_candidatos_imagem_pendentes", {
      p_session_token: "tok",
    });
    expect(rows).toHaveLength(1);
  });

  it("returns an empty queue for a null payload", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchCandidatosImagemPendentes("tok")).toEqual([]);
  });

  it("throws the RPC error (permission or session) instead of hiding it", async () => {
    const error = { message: "SEM_PERMISSAO_IMAGENS_PRODUTO", code: "P0001" };
    rpc.mockResolvedValue({ data: null, error });
    await expect(fetchCandidatosImagemPendentes("tok")).rejects.toBe(error);
  });

  it("throws on a malformed row", async () => {
    rpc.mockResolvedValue({ data: [{ id: "c1" }], error: null });
    await expect(fetchCandidatosImagemPendentes("tok")).rejects.toThrow();
  });
});
