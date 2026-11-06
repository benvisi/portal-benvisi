import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { ROUTES } from "@/config/routes";
import { useImagensProdutoPermissao } from "@/hooks/useImagensProdutoPermissao";

interface ImagensProdutoAcessoProps {
  sessionToken: string;
  /** Rendered only after the server confirmed the capability. */
  children: ReactNode;
}

/**
 * Route guard for the image review area. Children (and therefore the review
 * RPCs) are mounted only once get_produto_imagens_permissao returns true;
 * a confirmed "false" redirects to the dashboard. A failed permission check
 * renders nothing: access is never granted by default. This is UX only —
 * every review RPC re-checks the capability server-side.
 */
export function ImagensProdutoAcesso({ sessionToken, children }: ImagensProdutoAcessoProps) {
  const navigate = useNavigate();
  const permissao = useImagensProdutoPermissao(sessionToken);

  useEffect(() => {
    if (permissao.isSuccess && !permissao.podeGerenciar) {
      void navigate({ to: ROUTES.DASHBOARD, replace: true });
    }
  }, [permissao.isSuccess, permissao.podeGerenciar, navigate]);

  if (permissao.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" />
      </div>
    );
  }

  if (!permissao.isSuccess || !permissao.podeGerenciar) return null;

  return <>{children}</>;
}
