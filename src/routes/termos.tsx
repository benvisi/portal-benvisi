import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  TERMS_ACCEPT_BUTTON_LABEL,
  TERMS_BODY_PARAGRAPHS,
  TERMS_CHECKBOX_LABEL,
  TERMS_LOADING_MESSAGE,
  TERMS_STATUS_ERROR_MESSAGE,
  TERMS_TITLE,
  SIGN_OUT_BUTTON_LABEL,
} from "@/config/constants";
import { useTermos } from "@/hooks/useTermos";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [{ title: "Termo de Uso — Portal Benvisi" }, { name: "robots", content: "noindex" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  const terms = useTermos();

  if (!terms.ready) return null;

  if (terms.isCheckingStatus) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
          <p className="text-sm text-muted-foreground">{TERMS_LOADING_MESSAGE}</p>
        </div>
      </main>
    );
  }

  if (terms.statusError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <p className="text-sm text-destructive">{TERMS_STATUS_ERROR_MESSAGE}</p>
          <Button type="button" onClick={() => void terms.onRetryStatus()}>
            Tentar novamente
          </Button>
        </div>
      </main>
    );
  }

  if (!terms.showTerms) return null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <Card className="flex w-full max-w-lg flex-col gap-6 p-8 shadow-card">
        <div className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold text-foreground">{TERMS_TITLE}</h1>
          <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
            {TERMS_BODY_PARAGRAPHS.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>

        <label className="min-touch flex items-start gap-3 text-sm text-foreground">
          <Checkbox
            checked={terms.checked}
            onCheckedChange={(value) => terms.setChecked(value === true)}
            disabled={terms.submitting}
            className="mt-0.5"
          />
          <span>{TERMS_CHECKBOX_LABEL}</span>
        </label>

        {terms.errorMessage && (
          <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
            {terms.errorMessage}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <Button
            type="button"
            size="lg"
            className="min-touch w-full"
            disabled={!terms.checked || terms.submitting}
            onClick={() => void terms.onAccept()}
          >
            {terms.submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {TERMS_ACCEPT_BUTTON_LABEL}
              </>
            ) : (
              TERMS_ACCEPT_BUTTON_LABEL
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-touch w-full"
            disabled={terms.submitting}
            onClick={() => void terms.onSignOut()}
          >
            {SIGN_OUT_BUTTON_LABEL}
          </Button>
        </div>
      </Card>

      {/* Terms provides its own accept/decline (Sair) pair — only the text-size control here. */}
      <AuthUtilityBar showSignOut={false} />
    </main>
  );
}
