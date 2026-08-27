import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import {
  ATRIBUTOS_PESSOAIS_LABEL,
  NOSSOS_PRINCIPIOS_PAGE_SUBTITLE,
  NOSSOS_PRINCIPIOS_TITLE,
  VALORES_CULTURAIS_LABEL,
  VOLTAR_A_CONHECIMENTO_CULTURA_LABEL,
} from "@/config/constants";
import { PRINCIPIOS } from "@/config/principios";
import { ROUTES } from "@/config/routes";
import { useRequireSession } from "@/hooks/useRequireSession";

export const Route = createFileRoute("/conhecimento-cultura/principios")({
  head: () => ({
    meta: [{ title: "Nossos Princípios — Portal Benvisi" }, { name: "robots", content: "noindex" }],
  }),
  component: PrincipiosPage,
});

// Milestone 3A: an accordion (one open at a time) lets all five principles
// stay visible as distinct rows while keeping their attribute/value detail
// out of view until requested — no separate detail page/route needed, and
// nothing depends on hover, so it works identically on touch and desktop.
function PrincipiosPage() {
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
            onClick={() => void navigate({ to: ROUTES.CONHECIMENTO_CULTURA })}
            aria-label={VOLTAR_A_CONHECIMENTO_CULTURA_LABEL}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="text-xl font-semibold text-foreground">{NOSSOS_PRINCIPIOS_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{NOSSOS_PRINCIPIOS_PAGE_SUBTITLE}</p>

        <Accordion type="single" collapsible className="flex flex-col gap-3">
          {PRINCIPIOS.map((principio) => (
            <AccordionItem
              key={principio.id}
              value={principio.id}
              className="rounded-2xl border border-border bg-card px-4 shadow-card"
            >
              <AccordionTrigger className="hover:no-underline">
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <principio.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-base font-semibold text-foreground">
                    {principio.titulo}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="flex flex-col gap-4 pl-[3.25rem]">
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {ATRIBUTOS_PESSOAIS_LABEL}
                  </span>
                  <ul className="flex flex-col gap-1 text-sm text-foreground">
                    {principio.atributosPessoais.map((item) => (
                      <li key={item} className="ml-4 list-disc marker:text-brand">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {VALORES_CULTURAIS_LABEL}
                  </span>
                  <ul className="flex flex-col gap-1 text-sm text-foreground">
                    {principio.valoresCulturais.map((item) => (
                      <li key={item} className="ml-4 list-disc marker:text-brand">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      <AuthUtilityBar />
    </main>
  );
}
