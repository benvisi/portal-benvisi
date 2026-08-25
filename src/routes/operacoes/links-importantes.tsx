import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Link2, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  APP_STORE_LABEL,
  EXTERNAL_LINK_INDICATOR_LABEL,
  GOOGLE_PLAY_LABEL,
  LINKS_IMPORTANTES_PAGE_SUBTITLE,
  LINKS_IMPORTANTES_TITLE,
  VOLTAR_A_OPERACOES_LABEL,
} from "@/config/constants";
import { IMPORTANT_RESOURCES } from "@/config/links-importantes";
import { ROUTES } from "@/config/routes";
import { useRequireSession } from "@/hooks/useRequireSession";

export const Route = createFileRoute("/operacoes/links-importantes")({
  head: () => ({
    meta: [{ title: "Links Importantes — Portal Benvisi" }, { name: "robots", content: "noindex" }],
  }),
  component: LinksImportantesPage,
});

// Milestone 4A: renders generically from IMPORTANT_RESOURCES (typed by
// `type`) rather than one hardcoded card per resource — adding/editing a
// resource later means editing that config file, not this page.
function LinksImportantesPage() {
  const navigate = useNavigate();
  const { session, ready } = useRequireSession();

  if (!ready || !session) return null;

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <header className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-touch shrink-0"
            onClick={() => void navigate({ to: ROUTES.OPERACOES })}
            aria-label={VOLTAR_A_OPERACOES_LABEL}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="text-xl font-semibold text-foreground">{LINKS_IMPORTANTES_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{LINKS_IMPORTANTES_PAGE_SUBTITLE}</p>

        <div className="flex flex-col gap-4">
          {IMPORTANT_RESOURCES.map((resource) => (
            <Card key={resource.id} className="flex flex-col gap-3 p-5 shadow-card">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  {resource.type === "external_link" ? (
                    <Link2 className="h-5 w-5" aria-hidden />
                  ) : (
                    <Smartphone className="h-5 w-5" aria-hidden />
                  )}
                </span>
                <h2 className="text-base font-semibold text-foreground">{resource.titulo}</h2>
              </div>

              <p className="text-sm text-muted-foreground">{resource.descricao}</p>

              {resource.type === "external_link" ? (
                <>
                  {resource.supportingText && (
                    <p className="text-sm text-muted-foreground">{resource.supportingText}</p>
                  )}
                  <Button type="button" asChild className="min-touch w-fit gap-2">
                    <a href={resource.url} target="_blank" rel="noopener noreferrer">
                      {resource.actionLabel}
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </a>
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {resource.externalNote} {EXTERNAL_LINK_INDICATOR_LABEL}.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{resource.instrucao}</p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      asChild
                      className="min-touch w-fit gap-2"
                    >
                      <a href={resource.appStoreUrl} target="_blank" rel="noopener noreferrer">
                        {APP_STORE_LABEL}
                        <ExternalLink className="h-4 w-4" aria-hidden />
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      asChild
                      className="min-touch w-fit gap-2"
                    >
                      <a href={resource.playStoreUrl} target="_blank" rel="noopener noreferrer">
                        {GOOGLE_PLAY_LABEL}
                        <ExternalLink className="h-4 w-4" aria-hidden />
                      </a>
                    </Button>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
