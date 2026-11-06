// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/config/routes";

const rpc = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const handleSessionError = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/hooks/useSessionErrorHandler", () => ({
  useSessionErrorHandler: () => handleSessionError,
}));

import { ImagensProdutoAcesso } from "@/components/imagensProduto/ImagensProdutoAcesso";

function renderGuard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ImagensProdutoAcesso, {
        sessionToken: "tok",
        children: createElement("div", null, "area de revisao"),
      }),
    ),
  );
}

beforeEach(() => {
  rpc.mockReset();
  navigate.mockReset();
  handleSessionError.mockReset();
  handleSessionError.mockReturnValue(false);
});
afterEach(cleanup);

describe("ImagensProdutoAcesso (route gating)", () => {
  it("renders the review area only for a confirmed capability holder", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    renderGuard();
    expect(await screen.findByText("area de revisao")).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("get_produto_imagens_permissao", { p_session_token: "tok" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("hides the area and redirects an employee without the capability", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    renderGuard();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: ROUTES.DASHBOARD, replace: true }),
    );
    expect(screen.queryByText("area de revisao")).toBeNull();
  });

  it("treats anything other than literal true as no permission", async () => {
    rpc.mockResolvedValue({ data: "true", error: null });
    renderGuard();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(screen.queryByText("area de revisao")).toBeNull();
  });

  it("does not render the area while the permission is still loading", () => {
    rpc.mockReturnValue(new Promise(() => {}));
    renderGuard();
    expect(screen.queryByText("area de revisao")).toBeNull();
  });

  it("hands an expired session to the session handler and never shows the area", async () => {
    const error = { message: "INVALID_SESSION", code: "P0001" };
    rpc.mockResolvedValue({ data: null, error });
    renderGuard();
    await waitFor(() => expect(handleSessionError).toHaveBeenCalledWith(error));
    expect(screen.queryByText("area de revisao")).toBeNull();
  });

  it("denies access by default when the permission check fails for another reason", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "network down" } });
    renderGuard();
    await waitFor(() => expect(handleSessionError).toHaveBeenCalled());
    expect(screen.queryByText("area de revisao")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
