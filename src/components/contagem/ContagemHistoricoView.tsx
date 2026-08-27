import { useState } from "react";
import { Loader2 } from "lucide-react";

import { ContagemDetalhe } from "@/components/contagem/ContagemDetalhe";
import { ContagemRegistroCard } from "@/components/contagem/ContagemRegistroCard";
import { Button } from "@/components/ui/button";
import { CONTAGEM_HISTORICO_VAZIO_MESSAGE, CONTAGEM_LISTA_ERRO_MESSAGE } from "@/config/constants";
import { useContagemHistorico } from "@/hooks/useContagemHistorico";

interface ContagemHistoricoViewProps {
  sessionToken: string;
  active: boolean;
}

/** Administrador: submissions already reviewed. Read-only detail on select. */
export function ContagemHistoricoView({ sessionToken, active }: ContagemHistoricoViewProps) {
  const query = useContagemHistorico(sessionToken, active);
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);

  if (selecionadaId) {
    return (
      <ContagemDetalhe
        sessionToken={sessionToken}
        contagemId={selecionadaId}
        permitirRevisar={false}
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

  const historico = query.data ?? [];

  if (historico.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {CONTAGEM_HISTORICO_VAZIO_MESSAGE}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {historico.map((contagem) => (
        <li key={contagem.id}>
          <ContagemRegistroCard
            status="revisada"
            submetidoEm={contagem.submetido_em}
            submetidoPorNome={contagem.submetido_por_nome}
            revisadoPorNome={contagem.revisada_por_nome}
            totalItens={contagem.total_itens}
            onClick={() => setSelecionadaId(contagem.id)}
          />
        </li>
      ))}
    </ul>
  );
}
