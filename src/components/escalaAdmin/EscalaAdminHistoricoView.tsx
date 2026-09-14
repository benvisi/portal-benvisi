import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ESCALA_ADMIN_HISTORICO_ATIVA_LABEL,
  ESCALA_ADMIN_HISTORICO_ERRO_MESSAGE,
  ESCALA_ADMIN_HISTORICO_SUBSTITUIDA_LABEL,
  ESCALA_ADMIN_HISTORICO_VAZIO_MESSAGE,
  getEscalaAdminPublicadoPorLabel,
  getEscalaAdminVersaoLabel,
} from "@/config/constants";
import { useEscalaPublicacoesHistorico } from "@/hooks/useEscalaPublicacoesHistorico";
import { formatMesAno } from "@/lib/escala";
import { formatManaus } from "@/lib/session";

interface EscalaAdminHistoricoViewProps {
  sessionToken: string;
  /** Only fetch while this tab is actually shown. */
  active: boolean;
}

/** Administrador: minimal, read-only publication history. No rollback. */
export function EscalaAdminHistoricoView({ sessionToken, active }: EscalaAdminHistoricoViewProps) {
  const query = useEscalaPublicacoesHistorico(sessionToken, active);

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
        <p className="text-sm text-destructive">{ESCALA_ADMIN_HISTORICO_ERRO_MESSAGE}</p>
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
        {ESCALA_ADMIN_HISTORICO_VAZIO_MESSAGE}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {historico.map((publicacao) => (
        <li key={publicacao.id}>
          <Card className="flex flex-col gap-1 p-4 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-foreground">
                {formatMesAno(publicacao.mes_referencia)} ·{" "}
                {getEscalaAdminVersaoLabel(publicacao.versao)}
              </p>
              <Badge variant={publicacao.ativa ? "default" : "secondary"}>
                {publicacao.ativa
                  ? ESCALA_ADMIN_HISTORICO_ATIVA_LABEL
                  : ESCALA_ADMIN_HISTORICO_SUBSTITUIDA_LABEL}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {formatManaus(publicacao.publicado_em)} ·{" "}
              {getEscalaAdminPublicadoPorLabel(publicacao.publicado_por_nome)}
            </p>
            {publicacao.nome_arquivo && (
              <p className="text-xs text-muted-foreground">{publicacao.nome_arquivo}</p>
            )}
            <p className="text-xs text-muted-foreground">{publicacao.total_registros} registros</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
