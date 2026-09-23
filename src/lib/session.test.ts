import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_STORAGE_KEY } from "@/config/constants";

// vitest.config.ts runs this suite under environment: "node", so there is no
// window/localStorage global by default. AuthSession's isBrowser() check
// means it silently no-ops without one — exactly like SSR — so a minimal
// in-memory Storage stand-in is installed as `window.localStorage` for this
// suite only, then removed. This also doubles as the regression check for
// the sessionStorage -> localStorage switch: if AuthSession ever touches
// `sessionStorage` again, `window.sessionStorage` being undefined here would
// throw instead of silently reading/writing the wrong store.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

const validSession = {
  funcionario_id: "11111111-1111-1111-1111-111111111111",
  nome: "Maria das Graças Conceição da Fonseca",
  apelido: "Graça",
  cargo: "Vendedor",
  timestamp_login: "2026-09-23T12:00:00.000Z",
  session_token: "abc123token",
};

// session.ts references the bare `localStorage` global (as browsers expose
// it, same object as `window.localStorage`) — vi.stubGlobal both names so
// they point at the same in-memory Storage the tests inspect.
function installBrowserGlobals(storage: Storage = createMemoryStorage()): Storage {
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
  return storage;
}

describe("AuthSession", () => {
  beforeEach(() => {
    installBrowserGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("save() then get() round-trips through localStorage, not sessionStorage", async () => {
    const { AuthSession } = await import("@/lib/session");

    AuthSession.save(validSession);

    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe(JSON.stringify(validSession));
    expect(AuthSession.get()).toEqual(validSession);
    expect(AuthSession.isAuthenticated()).toBe(true);
  });

  it("persists across a fresh module load (simulates reopening the app in a new tab)", async () => {
    const { AuthSession: firstLoad } = await import("@/lib/session");
    firstLoad.save(validSession);

    vi.resetModules();
    const { AuthSession: secondLoad } = await import("@/lib/session");

    expect(secondLoad.get()).toEqual(validSession);
  });

  it("clear() removes the session (used by logout, revocation, and invalid-session handling)", async () => {
    const { AuthSession } = await import("@/lib/session");
    AuthSession.save(validSession);

    AuthSession.clear();

    expect(AuthSession.get()).toBeNull();
    expect(AuthSession.isAuthenticated()).toBe(false);
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("treats corrupted stored JSON as unauthenticated and clears it", async () => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, "{not-json");
    const { AuthSession } = await import("@/lib/session");

    expect(AuthSession.get()).toBeNull();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("treats a stored object missing required fields as unauthenticated", async () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ funcionario_id: "x", nome: "", apelido: "x", cargo: "x" }),
    );
    const { AuthSession } = await import("@/lib/session");

    expect(AuthSession.get()).toBeNull();
  });

  it("never throws if localStorage.setItem fails (e.g. quota/private-mode restrictions)", async () => {
    installBrowserGlobals({
      ...createMemoryStorage(),
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
    });
    const { AuthSession } = await import("@/lib/session");

    expect(() => AuthSession.save(validSession)).not.toThrow();
  });

  it("is a no-op without a browser environment (SSR safety)", async () => {
    vi.stubGlobal("window", undefined);
    const { AuthSession } = await import("@/lib/session");

    expect(() => AuthSession.save(validSession)).not.toThrow();
    expect(AuthSession.get()).toBeNull();
    expect(AuthSession.isAuthenticated()).toBe(false);
    expect(() => AuthSession.clear()).not.toThrow();
  });
});
