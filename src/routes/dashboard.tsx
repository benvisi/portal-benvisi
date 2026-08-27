import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BookOpen, ClipboardCheck, Loader2, Package, Settings, Users } from "lucide-react";

import { PendingChecklistIndicator } from "@/components/checklist/PendingChecklistIndicator";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import { ModuleCard } from "@/components/dashboard/ModuleCard";
import { ModuleInProgressDialog } from "@/components/dashboard/ModuleInProgressDialog";
import { ShiftStartCard } from "@/components/dashboard/ShiftStartCard";
import {
  ADMINISTRATOR_CARGO,
  CONHECIMENTO_CULTURA_DASHBOARD_SUBTITLE,
  CONHECIMENTO_CULTURA_TITLE,
  DASHBOARD_WELCOME_MESSAGE,
  OPERACOES_DASHBOARD_SUBTITLE,
  OPERACOES_TITLE,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { getManausGreeting } from "@/lib/datetime";
import { useAtendimentoAtivo } from "@/hooks/useAtendimentoAtivo";
import { useRequireSession } from "@/hooks/useRequireSession";
import { useTermoStatus } from "@/hooks/useTermoStatus";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [{ title: "Dashboard — Portal Benvisi" }, { name: "robots", content: "noindex" }],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();
  const { session, ready } = useRequireSession();
  const funcionarioId = session?.funcionario_id ?? null;
  const sessionToken = session?.session_token ?? null;
  const termoStatus = useTermoStatus(funcionarioId, sessionToken);
  const accepted = termoStatus.data === true;
  // Milestone 2D: a previous-day pendente_fechamento Atendimento takes
  // precedence over normal dashboard/operational activity (section 9/10) —
  // same blocking-redirect pattern already used for Termo acceptance below,
  // reused rather than duplicated. Only queried once Termo is already
  // accepted (mirrors ShiftStartCard/PendingChecklistIndicator's existing
  // gating further down), since there is nothing meaningful to check before
  // that.
  const ativoQuery = useAtendimentoAtivo(accepted ? funcionarioId : null, sessionToken);
  const hasPendingRecovery = ativoQuery.data?.status === "pendente_fechamento";
  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);

  useEffect(() => {
    if (ready && termoStatus.isSuccess && !accepted) {
      void navigate({ to: ROUTES.TERMS, replace: true });
    }
  }, [ready, termoStatus.isSuccess, accepted, navigate]);

  useEffect(() => {
    if (ready && accepted && hasPendingRecovery) {
      void navigate({ to: ROUTES.ATENDIMENTO, replace: true });
    }
  }, [ready, accepted, hasPendingRecovery, navigate]);

  if (!ready || !session) return null;

  // A query that previously errored (e.g. from a prior session for this same
  // employee) keeps status "error" while it silently refetches in the
  // background. Only treat it as a real, user-facing failure once nothing is
  // in flight — otherwise this branch would flash a transient error page
  // during the normal post-login routing decision below.
  if (termoStatus.isError && !termoStatus.isFetching) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <p className="text-sm text-destructive">
            Não foi possível carregar o painel. Tente novamente.
          </p>
          <Button type="button" onClick={() => void termoStatus.refetch()}>
            Tentar novamente
          </Button>
        </div>
      </main>
    );
  }

  // Covers the initial status check, a background refetch recovering from a
  // stale error, and the brief gap between a successful "not accepted"
  // result and the redirect effect above firing — all normal transitions,
  // never an error.
  if (!accepted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
      </main>
    );
  }

  // Milestone 2D: covers the initial pending-Atendimento check and the brief
  // gap before the redirect effect above fires — same treatment as the
  // Termo loading state, so the dashboard's normal modules are never
  // flashed before a pending-recovery redirect.
  if (ativoQuery.isLoading || hasPendingRecovery) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
      </main>
    );
  }

  const isAdmin = session.cargo === ADMINISTRATOR_CARGO;

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-widest text-brand">
            Benvisi
          </span>
          <h1 className="text-2xl font-semibold text-foreground">
            {/* Employee-facing informal identity (apelido); nome is the server-side fallback. */}
            {getManausGreeting()}, {session.apelido || session.nome}!
          </h1>
          <p className="text-sm text-muted-foreground">{DASHBOARD_WELCOME_MESSAGE}</p>
        </header>

        <PendingChecklistIndicator
          funcionarioId={session.funcionario_id}
          sessionToken={sessionToken}
        />

        <div className="flex flex-col gap-4">
          {!isAdmin && (
            <ShiftStartCard funcionarioId={session.funcionario_id} sessionToken={sessionToken} />
          )}

          <ModuleCard
            icon={Users}
            title="Atendimento"
            description="Atendimento ao cliente e apoio às vendas."
            variant="brand"
            onClick={() => void navigate({ to: ROUTES.ATENDIMENTO })}
          />
          <ModuleCard
            icon={Package}
            title="Estoque"
            description="Consulte a disponibilidade de produtos e tamanhos."
            variant="brand"
            onClick={() => setModuleDialogOpen(true)}
          />
          <ModuleCard
            icon={ClipboardCheck}
            title={OPERACOES_TITLE}
            description={OPERACOES_DASHBOARD_SUBTITLE}
            variant="brand"
            onClick={() => void navigate({ to: ROUTES.OPERACOES })}
          />
          <ModuleCard
            icon={BookOpen}
            title={CONHECIMENTO_CULTURA_TITLE}
            description={CONHECIMENTO_CULTURA_DASHBOARD_SUBTITLE}
            variant="brand"
            onClick={() => void navigate({ to: ROUTES.CONHECIMENTO_CULTURA })}
          />

          {isAdmin && (
            <ModuleCard
              icon={Settings}
              title="Administrativo"
              description="Gestão, configurações e recursos administrativos."
              variant="secondary"
              onClick={() => void navigate({ to: ROUTES.ADMINISTRATIVO })}
            />
          )}
        </div>
      </div>

      {/*
        Shared authenticated utility area (Texto maior + Sair) — same
        component, same bottom placement on every authenticated route.
      */}
      <AuthUtilityBar />

      <ModuleInProgressDialog open={moduleDialogOpen} onOpenChange={setModuleDialogOpen} />
    </main>
  );
}
