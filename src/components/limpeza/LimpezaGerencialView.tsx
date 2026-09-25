import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LimpezaTarefaChip } from "@/components/limpeza/LimpezaTarefaChip";
import {
  LIMPEZA_CARREGANDO_MESSAGE,
  LIMPEZA_GERENCIAL_ALTERAR_LABEL,
  LIMPEZA_GERENCIAL_ATRASADA_LABEL,
  LIMPEZA_GERENCIAL_ATRIBUICOES_ERRO_MESSAGE,
  LIMPEZA_GERENCIAL_ATRIBUICOES_TITLE,
  LIMPEZA_GERENCIAL_ATRIBUICOES_VAZIO_MESSAGE,
  LIMPEZA_GERENCIAL_CANCELAR_LABEL,
  LIMPEZA_GERENCIAL_ERRO_MESSAGE,
  LIMPEZA_GERENCIAL_SALVANDO_LABEL,
  LIMPEZA_GERENCIAL_SALVAR_LABEL,
  LIMPEZA_GERENCIAL_SELECIONE_FUNCIONARIO_LABEL,
  LIMPEZA_GERENCIAL_TITLE,
  LIMPEZA_GERENCIAL_VAZIO_MESSAGE,
  LIMPEZA_MANUAL_LABEL,
  LIMPEZA_SEM_CANDIDATO_LABEL,
  LIMPEZA_SINCRONIZANDO_LABEL,
  LIMPEZA_SINCRONIZAR_LABEL,
  LIMPEZA_TURNO_LABELS,
  getLimpezaGerencialDataTurnoLabel,
  getLimpezaSyncPendenciaMessage,
} from "@/config/constants";
import type { LimpezaTarefa, LimpezaTurno } from "@/integrations/supabase/contracts";
import { formatDiaCurto } from "@/lib/datetime";
import { formatEscalaDiaCompacto } from "@/lib/escala";
import { LIMPEZA_TAREFA_ORDEM, LIMPEZA_TURNO_ORDEM } from "@/lib/limpeza";
import { useLimpezaAtribuicoesMes } from "@/hooks/useLimpezaAtribuicoesMes";
import { useLimpezaAtribuirManual } from "@/hooks/useLimpezaAtribuirManual";
import { useLimpezaCandidatosTurno } from "@/hooks/useLimpezaCandidatosTurno";
import { useLimpezaGerencialMes } from "@/hooks/useLimpezaGerencialMes";
import { useLimpezaSincronizarManual } from "@/hooks/useLimpezaSincronizarManual";
import { useLimpezaSyncPendencias } from "@/hooks/useLimpezaSyncPendencias";

interface LimpezaGerencialViewProps {
  sessionToken: string | null;
  mesSelecionado: string;
  ativo: boolean;
}

export function LimpezaGerencialView({
  sessionToken,
  mesSelecionado,
  ativo,
}: LimpezaGerencialViewProps) {
  const {
    syncing,
    errorMessage: syncErrorMessage,
    sincronizar,
  } = useLimpezaSincronizarManual(sessionToken, mesSelecionado);
  const pendenciasQuery = useLimpezaSyncPendencias(sessionToken, ativo);
  const pendencias = pendenciasQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      {pendencias.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          {pendencias.map((pendencia) => (
            <div key={pendencia.data} className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{getLimpezaSyncPendenciaMessage(formatDiaCurto(pendencia.data))}</span>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-touch w-fit gap-2 self-end"
        disabled={syncing}
        onClick={() => void sincronizar()}
      >
        <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden />
        {syncing ? LIMPEZA_SINCRONIZANDO_LABEL : LIMPEZA_SINCRONIZAR_LABEL}
      </Button>
      {syncErrorMessage && <p className="text-xs text-destructive">{syncErrorMessage}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {LIMPEZA_GERENCIAL_ATRIBUICOES_TITLE}
        </h2>
        <LimpezaAtribuicoesMesSecao
          sessionToken={sessionToken}
          mesSelecionado={mesSelecionado}
          ativo={ativo}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">{LIMPEZA_GERENCIAL_TITLE}</h2>
        <LimpezaExcecoesSecao
          sessionToken={sessionToken}
          mesSelecionado={mesSelecionado}
          ativo={ativo}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atribuições do mês — every assignment, grouped by data/turno, each with an
// Alterar control. The primary management surface (distinct from Exceções
// below, which only lists items needing attention).
// ---------------------------------------------------------------------------
interface LimpezaAtribuicoesMesSecaoProps {
  sessionToken: string | null;
  mesSelecionado: string;
  ativo: boolean;
}

function LimpezaAtribuicoesMesSecao({
  sessionToken,
  mesSelecionado,
  ativo,
}: LimpezaAtribuicoesMesSecaoProps) {
  const query = useLimpezaAtribuicoesMes(sessionToken, mesSelecionado, ativo);
  const itens = query.data ?? [];
  const [editandoId, setEditandoId] = useState<string | null>(null);

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {LIMPEZA_CARREGANDO_MESSAGE}
      </div>
    );
  }
  if (query.isError) {
    return (
      <p className="py-8 text-center text-sm text-destructive">
        {LIMPEZA_GERENCIAL_ATRIBUICOES_ERRO_MESSAGE}
      </p>
    );
  }
  if (itens.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {LIMPEZA_GERENCIAL_ATRIBUICOES_VAZIO_MESSAGE}
      </p>
    );
  }

  const grupos = new Map<string, typeof itens>();
  for (const data of Array.from(new Set(itens.map((i) => i.data)))) {
    for (const turno of LIMPEZA_TURNO_ORDEM) {
      const doGrupo = itens.filter((i) => i.data === data && i.turno === turno);
      if (doGrupo.length > 0) grupos.set(`${data}|${turno}`, doGrupo);
    }
  }

  return (
    <Card className="divide-y divide-border">
      {Array.from(grupos.entries()).map(([chave, doGrupo]) => {
        const [data, turno] = chave.split("|") as [string, LimpezaTurno];
        const linhas = LIMPEZA_TAREFA_ORDEM.map((tarefa) =>
          doGrupo.find((i) => i.tarefa === tarefa),
        ).filter((i): i is NonNullable<typeof i> => i !== undefined);

        return (
          <div key={chave} className="flex flex-col gap-2 p-3">
            <span className="text-xs font-semibold text-muted-foreground">
              {getLimpezaGerencialDataTurnoLabel(
                formatEscalaDiaCompacto(data),
                LIMPEZA_TURNO_LABELS[turno],
              )}
            </span>
            {linhas.map((item) => (
              <div key={item.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <LimpezaTarefaChip tarefa={item.tarefa} />
                    <span className="text-sm text-foreground">
                      {item.funcionario_apelido ?? LIMPEZA_SEM_CANDIDATO_LABEL}
                    </span>
                    {item.bloqueada && (
                      <Badge variant="outline" className="text-xs">
                        {LIMPEZA_MANUAL_LABEL}
                      </Badge>
                    )}
                  </div>
                  {editandoId !== item.id && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-touch shrink-0"
                      onClick={() => setEditandoId(item.id)}
                    >
                      {LIMPEZA_GERENCIAL_ALTERAR_LABEL}
                    </Button>
                  )}
                </div>
                {editandoId === item.id && (
                  <LimpezaAlterarForm
                    sessionToken={sessionToken}
                    mesSelecionado={mesSelecionado}
                    data={item.data}
                    turno={item.turno}
                    tarefa={item.tarefa}
                    onFechar={() => setEditandoId(null)}
                  />
                )}
              </div>
            ))}
          </div>
        );
      })}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Exceções — conflicts, manual overrides, sem_candidato, missed. Secondary
// to Atribuições do mês; can legitimately be empty most months.
// ---------------------------------------------------------------------------
interface LimpezaExcecoesSecaoProps {
  sessionToken: string | null;
  mesSelecionado: string;
  ativo: boolean;
}

function LimpezaExcecoesSecao({ sessionToken, mesSelecionado, ativo }: LimpezaExcecoesSecaoProps) {
  const query = useLimpezaGerencialMes(sessionToken, mesSelecionado, ativo);
  const itens = query.data ?? [];
  const [editandoId, setEditandoId] = useState<string | null>(null);

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {LIMPEZA_CARREGANDO_MESSAGE}
      </div>
    );
  }
  if (query.isError) {
    return (
      <p className="py-8 text-center text-sm text-destructive">{LIMPEZA_GERENCIAL_ERRO_MESSAGE}</p>
    );
  }
  if (itens.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {LIMPEZA_GERENCIAL_VAZIO_MESSAGE}
      </p>
    );
  }

  return (
    <Card className="divide-y divide-border">
      {itens.map((item) => (
        <div key={item.id} className="flex flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">
              {getLimpezaGerencialDataTurnoLabel(
                formatEscalaDiaCompacto(item.data),
                LIMPEZA_TURNO_LABELS[item.turno],
              )}
            </span>
            {item.atrasada && (
              <Badge variant="destructive" className="shrink-0 text-xs">
                {LIMPEZA_GERENCIAL_ATRASADA_LABEL}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <LimpezaTarefaChip tarefa={item.tarefa} />
            <span className="text-xs text-muted-foreground">
              {item.funcionario_apelido ?? LIMPEZA_SEM_CANDIDATO_LABEL}
            </span>
            {item.bloqueada && (
              <Badge variant="outline" className="text-xs">
                {LIMPEZA_MANUAL_LABEL}
              </Badge>
            )}
            {item.status === "conflito" && item.conflito_motivo && (
              <span className="text-xs text-destructive">{item.conflito_motivo}</span>
            )}
          </div>

          {editandoId !== item.id ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-touch w-fit"
              onClick={() => setEditandoId(item.id)}
            >
              {LIMPEZA_GERENCIAL_ALTERAR_LABEL}
            </Button>
          ) : (
            <LimpezaAlterarForm
              sessionToken={sessionToken}
              mesSelecionado={mesSelecionado}
              data={item.data}
              turno={item.turno}
              tarefa={item.tarefa}
              onFechar={() => setEditandoId(null)}
            />
          )}
        </div>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// LimpezaAlterarForm — shared candidate-select + save/cancel, used by both
// sections above. Always goes through the existing manual-override backend
// (limpeza_definir_atribuicao_manual) — no second write path.
// ---------------------------------------------------------------------------
interface LimpezaAlterarFormProps {
  sessionToken: string | null;
  mesSelecionado: string;
  data: string;
  turno: LimpezaTurno;
  tarefa: LimpezaTarefa;
  onFechar: () => void;
}

function LimpezaAlterarForm({
  sessionToken,
  mesSelecionado,
  data,
  turno,
  tarefa,
  onFechar,
}: LimpezaAlterarFormProps) {
  const candidatosQuery = useLimpezaCandidatosTurno(sessionToken, data, turno, true);
  const { saving, errorMessage, atribuir, clearError } = useLimpezaAtribuirManual(
    sessionToken,
    mesSelecionado,
  );
  const [selecionado, setSelecionado] = useState<string>("");

  return (
    <div className="flex flex-col gap-2">
      <Select value={selecionado} onValueChange={setSelecionado}>
        <SelectTrigger className="min-touch">
          <SelectValue placeholder={LIMPEZA_GERENCIAL_SELECIONE_FUNCIONARIO_LABEL} />
        </SelectTrigger>
        <SelectContent>
          {(candidatosQuery.data ?? []).map((candidato) => (
            <SelectItem key={candidato.id} value={candidato.id}>
              {candidato.apelido}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="min-touch"
          disabled={!selecionado || saving}
          onClick={async () => {
            const ok = await atribuir(data, turno, tarefa, selecionado);
            if (ok) {
              setSelecionado("");
              onFechar();
            }
          }}
        >
          {saving ? LIMPEZA_GERENCIAL_SALVANDO_LABEL : LIMPEZA_GERENCIAL_SALVAR_LABEL}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-touch"
          onClick={() => {
            clearError();
            setSelecionado("");
            onFechar();
          }}
        >
          {LIMPEZA_GERENCIAL_CANCELAR_LABEL}
        </Button>
      </div>
    </div>
  );
}
