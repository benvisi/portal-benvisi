import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";

import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ADMINISTRATIVO_PAGE_TITLE,
  ADMINISTRATOR_CARGO,
  CHECKLIST_POLICY_CONFIRM_ACCEPT_LABEL,
  CHECKLIST_POLICY_CONFIRM_CANCEL_LABEL,
  CHECKLIST_POLICY_CONFIRM_TITLE,
  CHECKLIST_POLICY_DEFER_ALLOWED_DESCRIPTION,
  CHECKLIST_POLICY_DEFER_ALLOWED_LABEL,
  CHECKLIST_POLICY_LOADING_MESSAGE,
  CHECKLIST_POLICY_PERIODIC_DESCRIPTION,
  CHECKLIST_POLICY_PERIODIC_LABEL,
  CHECKLIST_POLICY_REQUIRED_DESCRIPTION,
  CHECKLIST_POLICY_REQUIRED_LABEL,
  CHECKLIST_POLICY_SECTION_SUBTITLE,
  CHECKLIST_POLICY_SECTION_TITLE,
  VOLTAR_AO_PAINEL_LABEL,
  getChecklistPolicyConfirmDescription,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import type { ChecklistPolicy } from "@/integrations/supabase/contracts";
import { useChecklistPolicy } from "@/hooks/useChecklistPolicy";
import { useRequireSession } from "@/hooks/useRequireSession";
import { useSetChecklistPolicy } from "@/hooks/useSetChecklistPolicy";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/administrativo")({
  head: () => ({
    meta: [{ title: "Administrativo — Portal Benvisi" }, { name: "robots", content: "noindex" }],
  }),
  component: AdministrativoPage,
});

const POLICY_OPTIONS: {
  value: ChecklistPolicy;
  label: string;
  description: string;
}[] = [
  {
    value: "required",
    label: CHECKLIST_POLICY_REQUIRED_LABEL,
    description: CHECKLIST_POLICY_REQUIRED_DESCRIPTION,
  },
  {
    value: "defer_allowed",
    label: CHECKLIST_POLICY_DEFER_ALLOWED_LABEL,
    description: CHECKLIST_POLICY_DEFER_ALLOWED_DESCRIPTION,
  },
  {
    value: "periodic_verification",
    label: CHECKLIST_POLICY_PERIODIC_LABEL,
    description: CHECKLIST_POLICY_PERIODIC_DESCRIPTION,
  },
];

function AdministrativoPage() {
  const navigate = useNavigate();
  const { session, ready } = useRequireSession();
  const sessionToken = session?.session_token ?? null;
  const isAdmin = session?.cargo === ADMINISTRATOR_CARGO;

  const policyQuery = useChecklistPolicy(isAdmin ? sessionToken : null);
  const setPolicy = useSetChecklistPolicy(sessionToken);

  const [pendingPolicy, setPendingPolicy] = useState<ChecklistPolicy | null>(null);

  // Milestone 2C.1, section 3: this control is Administrador-only, matching
  // the existing convention already established by the dashboard's
  // Administrativo module itself (visible only to cargo = 'Administrador',
  // not Gerente). Client-side redirect is UX only — set_checklist_policy
  // independently re-enforces this server-side regardless of how this page
  // is reached.
  useEffect(() => {
    if (ready && session && !isAdmin) {
      void navigate({ to: ROUTES.DASHBOARD, replace: true });
    }
  }, [ready, session, isAdmin, navigate]);

  if (!ready || !session || !isAdmin) return null;

  const currentPolicy = policyQuery.data ?? null;
  const pendingOption = POLICY_OPTIONS.find((option) => option.value === pendingPolicy) ?? null;

  const handleSelect = (policy: ChecklistPolicy) => {
    if (policy === currentPolicy || setPolicy.submitting) return;
    setPendingPolicy(policy);
  };

  const handleConfirm = () => {
    if (!pendingPolicy) return;
    void setPolicy.setPolicy(pendingPolicy);
    setPendingPolicy(null);
  };

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <header className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-touch shrink-0"
            onClick={() => void navigate({ to: ROUTES.DASHBOARD })}
            aria-label={VOLTAR_AO_PAINEL_LABEL}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="text-xl font-semibold text-foreground">{ADMINISTRATIVO_PAGE_TITLE}</h1>
        </header>

        <Card className="flex flex-col gap-4 p-6 shadow-card">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-foreground">
              {CHECKLIST_POLICY_SECTION_TITLE}
            </h2>
            <p className="text-sm text-muted-foreground">{CHECKLIST_POLICY_SECTION_SUBTITLE}</p>
          </div>

          {policyQuery.isLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {CHECKLIST_POLICY_LOADING_MESSAGE}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {POLICY_OPTIONS.map((option) => {
                const selected = currentPolicy === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    disabled={setPolicy.submitting}
                    aria-pressed={selected}
                    className={cn(
                      "min-touch flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:opacity-60",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background",
                      )}
                      aria-hidden
                    >
                      {selected && <Check className="h-4 w-4" />}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-foreground">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {setPolicy.errorMessage && (
            <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
              {setPolicy.errorMessage}
            </p>
          )}
        </Card>
      </div>

      <AlertDialog
        open={pendingPolicy !== null}
        onOpenChange={(open) => !open && setPendingPolicy(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{CHECKLIST_POLICY_CONFIRM_TITLE}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOption ? getChecklistPolicyConfirmDescription(pendingOption.label) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{CHECKLIST_POLICY_CONFIRM_CANCEL_LABEL}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              {CHECKLIST_POLICY_CONFIRM_ACCEPT_LABEL}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AuthUtilityBar />
    </main>
  );
}
