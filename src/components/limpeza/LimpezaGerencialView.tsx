import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

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
import {
  LIMPEZA_CARREGANDO_MESSAGE,
  LIMPEZA_GERENCIAL_ALTERAR_LABEL,
  LIMPEZA_GERENCIAL_ATRASADA_LABEL,
  LIMPEZA_GERENCIAL_CANCELAR_LABEL,
  LIMPEZA_GERENCIAL_ERRO_MESSAGE,
  LIMPEZA_GERENCIAL_SALVANDO_LABEL,
  LIMPEZA_GERENCIAL_SALVAR_LABEL,
  LIMPEZA_GERENCIAL_SELECIONE_FUNCIONARIO_LABEL,
  LIMPEZA_GERENCIAL_VAZIO_MESSAGE,
  LIMPEZA_MANUAL_LABEL,
  LIMPEZA_SEM_CANDIDATO_LABEL,
  LIMPEZA_SINCRONIZANDO_LABEL,
  LIMPEZA_SINCRONIZAR_LABEL,
  LIMPEZA_TAREFA_LABELS,
  LIMPEZA_TURNO_LABELS,
} from "@/config/constants";
import type { LimpezaGerencialItem } from "@/integrations/supabase/contracts";
import { formatEscalaDiaCompacto } from "@/lib/escala";
import { useLimpezaAtribuirManual } from "@/hooks/useLimpezaAtribuirManual";
import { useLimpezaCandidatosTurno } from "@/hooks/useLimpezaCandidatosTurno";
import { useLimpezaGerencialMes } from "@/hooks/useLimpezaGerencialMes";
import { useLimpezaSincronizarManual } from "@/hooks/useLimpezaSincronizarManual";

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
  const query = useLimpezaGerencialMes(sessionToken, mesSelecionado, ativo);
  const itens = query.data ?? [];
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const {
    syncing,
    errorMessage: syncErrorMessage,
    sincronizar,
  } = useLimpezaSincronizarManual(sessionToken, mesSelecionado);

  return (
    <div className="flex flex-col gap-3">
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

      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {LIMPEZA_CARREGANDO_MESSAGE}
        </div>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-destructive">
          {LIMPEZA_GERENCIAL_ERRO_MESSAGE}
        </p>
      ) : itens.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {LIMPEZA_GERENCIAL_VAZIO_MESSAGE}
        </p>
      ) : (
        <Card className="divide-y divide-border">
          {itens.map((item) => (
            <LimpezaGerencialLinha
              key={item.id}
              item={item}
              sessionToken={sessionToken}
              mesSelecionado={mesSelecionado}
              editando={editandoId === item.id}
              onEditar={() => setEditandoId(item.id)}
              onFechar={() => setEditandoId(null)}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

interface LimpezaGerencialLinhaProps {
  item: LimpezaGerencialItem;
  sessionToken: string | null;
  mesSelecionado: string;
  editando: boolean;
  onEditar: () => void;
  onFechar: () => void;
}

function LimpezaGerencialLinha({
  item,
  sessionToken,
  mesSelecionado,
  editando,
  onEditar,
  onFechar,
}: LimpezaGerencialLinhaProps) {
  const candidatosQuery = useLimpezaCandidatosTurno(sessionToken, item.data, item.turno, editando);
  const { saving, errorMessage, atribuir, clearError } = useLimpezaAtribuirManual(
    sessionToken,
    mesSelecionado,
  );
  const [selecionado, setSelecionado] = useState<string>("");

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">
          {formatEscalaDiaCompacto(item.data)} · {LIMPEZA_TURNO_LABELS[item.turno]} ·{" "}
          {LIMPEZA_TAREFA_LABELS[item.tarefa]}
        </span>
        {item.atrasada && (
          <Badge variant="destructive" className="shrink-0 text-xs">
            {LIMPEZA_GERENCIAL_ATRASADA_LABEL}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{item.funcionario_apelido ?? LIMPEZA_SEM_CANDIDATO_LABEL}</span>
        {item.bloqueada && <Badge variant="outline">{LIMPEZA_MANUAL_LABEL}</Badge>}
        {item.status === "conflito" && item.conflito_motivo && (
          <span className="text-destructive">{item.conflito_motivo}</span>
        )}
      </div>

      {!editando ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-touch w-fit"
          onClick={onEditar}
        >
          {LIMPEZA_GERENCIAL_ALTERAR_LABEL}
        </Button>
      ) : (
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
                const ok = await atribuir(item.data, item.turno, item.tarefa, selecionado);
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
      )}
    </div>
  );
}
