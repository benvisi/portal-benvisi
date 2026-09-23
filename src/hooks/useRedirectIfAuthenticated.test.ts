// @vitest-environment jsdom
//
// Regression coverage for the production incident where a fully persisted,
// locally-valid session (AuthSession, backed by localStorage) was silently
// ignored on app startup: the Login route ("/") never checked it and always
// rendered PIN entry, so reopening the Portal (new tab, browser restart)
// forced a returning employee through login again even though their session
// was still good. src/lib/session.test.ts already proves the storage layer
// (localStorage read/write/clear) works in isolation — that suite passed
// even while this bug shipped, because it never exercised anything that
// consumes AuthSession at the routing/component level. This suite tests
// exactly that consumption: does the app act on a persisted session, not
// just store one. Needs a real DOM (jsdom), unlike the rest of this repo's
// node-environment suites, because it renders an actual hook via
// @testing-library/react.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_STORAGE_KEY } from "@/config/constants";
import { ROUTES } from "@/config/routes";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

const validSession = {
  funcionario_id: "11111111-1111-1111-1111-111111111111",
  nome: "Maria das Graças Conceição da Fonseca",
  apelido: "Graça",
  cargo: "Vendedor",
  timestamp_login: "2026-09-23T12:00:00.000Z",
  session_token: "abc123token",
};

describe("useRedirectIfAuthenticated (Login route guard)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    navigateMock.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("redirects straight to Dashboard when a persisted session already exists", async () => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(validSession));
    const { useRedirectIfAuthenticated } = await import("./useRedirectIfAuthenticated");

    const { result } = renderHook(() => useRedirectIfAuthenticated());

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: ROUTES.DASHBOARD, replace: true });
    });
    // Never flips to ready=true / renders the PIN screen once it has
    // decided to redirect away from Login.
    expect(result.current.ready).toBe(false);
  });

  it("renders Login normally (ready=true, no redirect) with no persisted session", async () => {
    const { useRedirectIfAuthenticated } = await import("./useRedirectIfAuthenticated");

    const { result } = renderHook(() => useRedirectIfAuthenticated());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("renders Login normally when the stored session is corrupted/invalid", async () => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, "{not-json");
    const { useRedirectIfAuthenticated } = await import("./useRedirectIfAuthenticated");

    const { result } = renderHook(() => useRedirectIfAuthenticated());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("does not act as an independent authority: a session cleared by logout is not redirected", async () => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(validSession));
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    const { useRedirectIfAuthenticated } = await import("./useRedirectIfAuthenticated");

    const { result } = renderHook(() => useRedirectIfAuthenticated());

    await act(async () => {});
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
