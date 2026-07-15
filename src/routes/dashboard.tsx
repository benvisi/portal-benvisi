import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";

import { ROUTES } from "@/config/routes";
import { AuthSession, formatManaus, type AuthSessionData } from "@/lib/session";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Portal Benvisi" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<AuthSessionData | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!AuthSession.isAuthenticated()) {
      void navigate({ to: ROUTES.LOGIN, replace: true });
      return;
    }
    setSession(AuthSession.get());
    setReady(true);
  }, [navigate]);

  const handleSignOut = () => {
    AuthSession.clear();
    void navigate({ to: ROUTES.LOGIN, replace: true });
  };

  if (!ready || !session) return null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-card">
        <span className="text-xs font-semibold uppercase tracking-widest text-brand">
          Benvisi
        </span>
        <h1 className="mt-2 text-3xl font-semibold text-foreground">
          Bem-vindo, {session.nome}
        </h1>
        <p className="mt-1 text-base text-muted-foreground">{session.cargo}</p>
        <p className="mt-6 text-xs text-muted-foreground">
          Sessão iniciada em {formatManaus(session.timestamp_login)}
        </p>

        <button
          type="button"
          onClick={handleSignOut}
          className="min-touch mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-destructive px-4 py-3 text-base font-semibold text-destructive-foreground shadow-soft transition-colors hover:opacity-90"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sair
        </button>
      </div>
    </main>
  );
}
