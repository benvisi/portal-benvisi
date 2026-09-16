import { Loader2 } from "lucide-react";

import { TermosBuscaPendenteCard } from "@/components/termosBusca/TermosBuscaPendenteCard";
import { Button } from "@/components/ui/button";
import {
  TERMOS_BUSCA_PENDENTES_ERRO_MESSAGE,
  TERMOS_BUSCA_PENDENTES_VAZIO_MESSAGE,
} from "@/config/constants";
import { useTermosBuscaAdminActions } from "@/hooks/useTermosBuscaAdminActions";
import { useTermosBuscaPendentes } from "@/hooks/useTermosBuscaPendentes";

interface TermosBuscaPendentesViewProps {
  sessionToken: string;
  /** Only fetch while this tab is actually shown. */
  active: boolean;
}

/** Management: the moderation queue, oldest first, decided in place. */
export function TermosBuscaPendentesView({ sessionToken, active }: TermosBuscaPendentesViewProps) {
  const query = useTermosBuscaPendentes(sessionToken, active);
  const { busyId, errorMessage, moderar } = useTermosBuscaAdminActions(sessionToken);

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
        <p className="text-sm text-destructive">{TERMOS_BUSCA_PENDENTES_ERRO_MESSAGE}</p>
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
        {TERMOS_BUSCA_PENDENTES_VAZIO_MESSAGE}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
      <ul className="flex flex-col gap-3">
        {pendentes.map((pendente) => (
          <li key={pendente.id}>
            <TermosBuscaPendenteCard
              pendente={pendente}
              busy={busyId === pendente.id}
              onAprovar={(termoFinal) =>
                moderar(pendente.id, pendente.produto, "aprovar", termoFinal)
              }
              onRejeitar={() => moderar(pendente.id, pendente.produto, "rejeitar")}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
