import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Copy } from "lucide-react";
import { toast } from "sonner";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  COPIAR_MENSAGEM_LABEL,
  MENSAGEM_COPIA_ERRO_MESSAGE,
  MENSAGEM_COPIADA_LABEL,
  MENSAGENS_WHATSAPP_PAGE_SUBTITLE,
  MENSAGENS_WHATSAPP_TITLE,
  VOLTAR_A_OPERACOES_LABEL,
} from "@/config/constants";
import { WHATSAPP_MESSAGE_GROUPS } from "@/config/mensagens-whatsapp";
import { ROUTES } from "@/config/routes";
import { useRequireSession } from "@/hooks/useRequireSession";

export const Route = createFileRoute("/operacoes/mensagens-whatsapp")({
  head: () => ({
    meta: [
      { title: "Mensagens para WhatsApp — Portal Benvisi" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MensagensWhatsAppPage,
});

async function handleCopy(texto: string) {
  try {
    // The stored/displayed text already uses real `\n` line breaks that
    // match the approved formatting exactly (verified directly against
    // src/config/mensagens-whatsapp.ts — no flattening, no stripping
    // happens between config, display, and this call). CRLF is normalized
    // here only for the clipboard payload — never for the on-screen
    // string — as a defensive, zero-downside measure for paste targets
    // that expect CRLF for multi-line plain text; it does not change what
    // is shown on the page.
    await navigator.clipboard.writeText(texto.replace(/\n/g, "\r\n"));
    toast(MENSAGEM_COPIADA_LABEL);
  } catch {
    // Clipboard access can fail (permissions, insecure context, older
    // browsers) — the message text stays visible either way so the
    // employee can select/copy it manually. Never crash the page over this.
    toast(MENSAGEM_COPIA_ERRO_MESSAGE);
  }
}

// Milestone 4B: nested accordion — outer level groups (Blueprint section
// 10), inner level individual situations — so employees see titles first
// and only expand the specific situation they need, rather than scrolling
// a wall of text. Portal never sends/personalizes the message itself; it
// only helps employees find and copy the approved wording quickly.
function MensagensWhatsAppPage() {
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
          <h1 className="text-xl font-semibold text-foreground">{MENSAGENS_WHATSAPP_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{MENSAGENS_WHATSAPP_PAGE_SUBTITLE}</p>

        <Accordion type="single" collapsible className="flex flex-col gap-3">
          {WHATSAPP_MESSAGE_GROUPS.map((group) => (
            <AccordionItem
              key={group.id}
              value={group.id}
              className="rounded-2xl border border-border bg-card px-4 shadow-card"
            >
              <AccordionTrigger className="hover:no-underline">
                <span className="text-base font-semibold text-foreground">{group.titulo}</span>
              </AccordionTrigger>
              <AccordionContent>
                <Accordion type="single" collapsible className="flex flex-col gap-2">
                  {group.mensagens.map((mensagem) => (
                    <AccordionItem
                      key={mensagem.id}
                      value={mensagem.id}
                      className="rounded-xl border border-border bg-secondary/40 px-3"
                    >
                      <AccordionTrigger className="py-3 text-sm hover:no-underline">
                        <span className="text-sm font-medium text-foreground">
                          {mensagem.titulo}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="flex flex-col gap-3">
                        <p className="whitespace-pre-line text-sm text-foreground">
                          {mensagem.texto}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-touch w-fit gap-2"
                          onClick={() => void handleCopy(mensagem.texto)}
                        >
                          <Copy className="h-4 w-4" aria-hidden />
                          {COPIAR_MENSAGEM_LABEL}
                        </Button>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </main>
  );
}
