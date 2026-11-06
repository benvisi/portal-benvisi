import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { ImagensProdutoAcesso } from "@/components/imagensProduto/ImagensProdutoAcesso";
import { ImagensProdutoRevisaoView } from "@/components/imagensProduto/ImagensProdutoRevisaoView";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import {
  IMAGENS_PRODUTO_PAGE_SUBTITLE,
  IMAGENS_PRODUTO_TITLE,
  VOLTAR_AO_PAINEL_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";
import { IMAGENS_PRODUTO_PREVIEW_MOCK, PREVIEW_BANNER_TEXT } from "@/lib/produtoImagensPreviewFlag";

export const Route = createFileRoute("/administrativo/imagens-produto")({
  head: () => ({
    meta: [
      { title: "Imagens de produto — Administrativo — Portal Benvisi" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ImagensProdutoPage,
});

// Product image review (Trello #10, Slice 5A). Access is the explicit
// funcionarios.pode_gerenciar_imagens_produto capability — NOT cargo — so the
// gate is the permission RPC (ImagensProdutoAcesso). The client-side redirect
// is UX only: every review RPC re-checks the capability server-side.
function ImagensProdutoPage() {
  const goBack = useGoBack(ROUTES.ADMINISTRATIVO);
  const { session, ready } = useRequireSession();
  const sessionToken = session?.session_token ?? null;

  if (!ready || !session || sessionToken === null) return null;

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-touch shrink-0"
            onClick={goBack}
            aria-label={VOLTAR_AO_PAINEL_LABEL}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="text-xl font-semibold text-foreground">{IMAGENS_PRODUTO_TITLE}</h1>
        </header>

        {IMAGENS_PRODUTO_PREVIEW_MOCK && (
          <p
            role="note"
            className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm font-medium text-amber-900"
          >
            {PREVIEW_BANNER_TEXT}
          </p>
        )}

        <p className="text-sm text-muted-foreground">{IMAGENS_PRODUTO_PAGE_SUBTITLE}</p>

        <ImagensProdutoAcesso sessionToken={sessionToken}>
          <ImagensProdutoRevisaoView sessionToken={sessionToken} />
        </ImagensProdutoAcesso>
      </div>

      <AuthUtilityBar />
    </main>
  );
}
