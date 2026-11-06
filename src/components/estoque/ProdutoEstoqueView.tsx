import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { EstoqueMatrix } from "@/components/estoque/EstoqueMatrix";
import { ProdutoImagemViewer } from "@/components/estoque/ProdutoImagemViewer";
import { ProdutoTermosBusca } from "@/components/estoque/ProdutoTermosBusca";
import { Button } from "@/components/ui/button";
import {
  ESTOQUE_PRODUTO_CARREGANDO_MESSAGE,
  ESTOQUE_PRODUTO_ERRO_MESSAGE,
  ESTOQUE_PRODUTO_NAO_ENCONTRADO_MESSAGE,
} from "@/config/constants";
import { useProdutoEstoqueDetalhe } from "@/hooks/useProdutoEstoqueDetalhe";
import { useProdutoImagensPublicadas } from "@/hooks/useProdutoImagensPublicadas";
import { buildEstoqueMatriz } from "@/lib/estoque";
import type { ImagensDaCor } from "@/lib/produtoImagensPublicadas";

interface ProdutoEstoqueViewProps {
  sessionToken: string;
  produto: string;
}

/**
 * Stock detail for one selected produto: a prominent produto header followed
 * by the single colour x applicable-size matrix. Owns its own loading /
 * not-found / error states so the search page stays simple. Session errors
 * are handled inside the hook (redirect to login); a transient failure shows
 * a retry here.
 */
export function ProdutoEstoqueView({ sessionToken, produto }: ProdutoEstoqueViewProps) {
  const query = useProdutoEstoqueDetalhe(sessionToken, produto);
  const linhas = useMemo(() => query.data ?? [], [query.data]);
  const matriz = useMemo(() => buildEstoqueMatriz(linhas), [linhas]);
  const imagens = useProdutoImagensPublicadas(sessionToken, produto);
  const [corAberta, setCorAberta] = useState<string | null>(null);

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {ESTOQUE_PRODUTO_CARREGANDO_MESSAGE}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm text-destructive">{ESTOQUE_PRODUTO_ERRO_MESSAGE}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!matriz) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {ESTOQUE_PRODUTO_NAO_ENCONTRADO_MESSAGE}
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{matriz.produto}</h2>
        {matriz.descProduto && (
          <p className="text-sm text-muted-foreground">{matriz.descProduto}</p>
        )}
        {matriz.linha && (
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {matriz.linha}
          </p>
        )}
      </header>

      <EstoqueMatrix matriz={matriz} imagens={imagens} onVerImagens={setCorAberta} />

      {corAberta !== null && imagens.has(corAberta) && (
        <ProdutoImagemViewer
          key={corAberta}
          produto={matriz.produto}
          corCodigo={corAberta}
          imagens={imagens.get(corAberta) as ImagensDaCor}
          onClose={() => setCorAberta(null)}
        />
      )}

      <ProdutoTermosBusca sessionToken={sessionToken} produto={matriz.produto} />
    </section>
  );
}
