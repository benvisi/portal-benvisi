import { useMemo, useState } from "react";

import { EstoqueBuscaField } from "@/components/estoque/EstoqueBuscaField";
import { TermosBuscaProdutoAdmin } from "@/components/termosBusca/TermosBuscaProdutoAdmin";
import {
  ESTOQUE_BUSCA_DEBOUNCE_MS,
  ESTOQUE_BUSCA_MAX_SUGESTOES,
  ESTOQUE_BUSCA_MIN_CHARS,
  TERMOS_BUSCA_GERENCIAR_DICA_MESSAGE,
} from "@/config/constants";
import { useBuscarProdutosEstoque } from "@/hooks/useBuscarProdutosEstoque";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

interface TermosBuscaGerenciarViewProps {
  sessionToken: string;
}

interface ProdutoSelecionado {
  produto: string;
  descProduto: string | null;
}

/**
 * Management: the same search -> pick one produto flow as Consulta de
 * Estoque (same field, same RPC, same debounce), then the produto's term
 * management panel instead of the stock matrix.
 */
export function TermosBuscaGerenciarView({ sessionToken }: TermosBuscaGerenciarViewProps) {
  const [termo, setTermo] = useState("");
  const [selecionado, setSelecionado] = useState<ProdutoSelecionado | null>(null);

  const termoDebounced = useDebouncedValue(termo, ESTOQUE_BUSCA_DEBOUNCE_MS);
  const busca = useBuscarProdutosEstoque(sessionToken, termoDebounced);

  const sugestoes = useMemo(
    () => (busca.data ?? []).slice(0, ESTOQUE_BUSCA_MAX_SUGESTOES),
    [busca.data],
  );

  const termoLimpo = termo.trim();
  const aguardandoDebounce =
    termoLimpo.length >= ESTOQUE_BUSCA_MIN_CHARS &&
    termoLimpo.toLowerCase() !== termoDebounced.trim().toLowerCase();

  const handleSelect = (produto: string) => {
    const sugestao = sugestoes.find((s) => s.produto === produto);
    setSelecionado({
      produto: produto.trim().toUpperCase(),
      descProduto: sugestao?.desc_produto ?? null,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{TERMOS_BUSCA_GERENCIAR_DICA_MESSAGE}</p>

      <EstoqueBuscaField
        value={termo}
        onChange={setTermo}
        onSelect={handleSelect}
        suggestions={sugestoes}
        isLoading={busca.isFetching || aguardandoDebounce}
        isError={busca.isError}
        hasQueried={busca.isSuccess}
      />

      {selecionado && (
        <TermosBuscaProdutoAdmin
          sessionToken={sessionToken}
          produto={selecionado.produto}
          descProduto={selecionado.descProduto}
        />
      )}
    </div>
  );
}
