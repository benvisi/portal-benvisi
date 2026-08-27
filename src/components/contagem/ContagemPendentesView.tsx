import { useState } from "react";
import { Loader2 } from "lucide-react";

import { ContagemDetalhe } from "@/components/contagem/ContagemDetalhe";
import { ContagemRegistroCard } from "@/components/contagem/ContagemRegistroCard";
import { Button } from "@/components/ui/button";
import { CONTAGEM_LISTA_ERRO_MESSAGE, CONTAGEM_PENDENTES_VAZIO_MESSAGE } from "@/config/constants";
import { useContagensPendentes } from "@/hooks/useContagensPendentes";

interface ContagemPendentesViewProps {
  sessionToken: string;
  /** Only fetch while this tab is actually shown. */
  active: boolean;
}

/** Administrador: the review queue. Select a card to inspect and review it. */
export function ContagemPendentesView({ sessionToken, active }: ContagemPendentesViewProps) {
  const query = useContagensPendentes(sessionToken, active);
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);

  if (selecionadaId) {
    return (
      <ContagemDetalhe
        sessionToken={sessionToken}
        contagemId={selecionadaId}
        permitirRevisar
        onVoltar={() => setSelecionadaId(null)}
      />
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm text-destructive">{CONTAGEM_LISTA_ERRO_MESSAGE}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const pendentes = query.data ?? [];

  if (pendentes.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {CONTAGEM_PENDENTES_VAZIO_MESSAGE}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {pendentes.map((contagem) => (
        <li key={contagem.id}>
          <ContagemRegistroCard
            status="pendente_revisao"
            submetidoEm={contagem.submetido_em}
            submetidoPorNome={contagem.submetido_por_nome}
            totalItens={contagem.total_itens}
            onClick={() => setSelecionadaId(contagem.id)}
          />
        </li>
      ))}
    </ul>
  );
}
