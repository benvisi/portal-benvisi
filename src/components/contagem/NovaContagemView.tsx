import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ContagemItemField } from "@/components/contagem/ContagemItemField";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTAGEM_CANCELANDO_LABEL,
  CONTAGEM_CANCELAR_CONFIRM_ACCEPT_LABEL,
  CONTAGEM_CANCELAR_CONFIRM_CANCEL_LABEL,
  CONTAGEM_CANCELAR_CONFIRM_DESCRIPTION,
  CONTAGEM_CANCELAR_CONFIRM_TITLE,
  CONTAGEM_CANCELAR_LABEL,
  CONTAGEM_CARREGANDO_MESSAGE,
  CONTAGEM_CATALOGO_ERRO_MESSAGE,
  CONTAGEM_ENVIADA_TITLE,
  CONTAGEM_ENVIANDO_LABEL,
  CONTAGEM_NOVA_CONTAGEM_LABEL,
  CONTAGEM_OBSERVACAO_HINT,
  CONTAGEM_OBSERVACAO_LABEL,
  CONTAGEM_OBSERVACAO_PLACEHOLDER,
  CONTAGEM_PROGRESSO_SALVO_LABEL,
  CONTAGEM_SALVANDO_LABEL,
  CONTAGEM_SALVAR_LABEL,
  CONTAGEM_SUBMIT_LABEL,
  getContagemEnviadaDescription,
  getContagemIniciadaDescription,
  getContagemItensFaltandoMessage,
} from "@/config/constants";
import { useCancelarContagem } from "@/hooks/useCancelarContagem";
import { useContagemAtiva } from "@/hooks/useContagemAtiva";
import { useContagemCatalogo } from "@/hooks/useContagemCatalogo";
import { useFinalizarContagem, type ContagemItemPayload } from "@/hooks/useFinalizarContagem";
import { useSalvarProgressoContagem } from "@/hooks/useSalvarProgressoContagem";
import {
  agruparCatalogoPorFamilia,
  formatContagemDataHora,
  parseContagemInteiro,
} from "@/lib/contagem";
import { formatManaus } from "@/lib/session";

interface NovaContagemViewProps {
  sessionToken: string;
  /** Employee-facing display name, for the post-submit confirmation. */
  apelido: string;
}

interface CampoValor {
  pacotes: string;
  avulsas: string;
}

/**
 * Milestone 4D.1: the counting form, now resumable. On load it fetches (or
 * starts) the single active em_andamento draft — any authorized employee
 * gets back the same draft and whatever progress was last saved into it via
 * the explicit Salvar button (an earlier autosave attempt proved unreliable
 * across steady field-to-field data entry and was dropped). Finalizar
 * contagem still validates completeness client- and server-side before
 * locking the draft into pendente_revisao.
 */
export function NovaContagemView({ sessionToken, apelido }: NovaContagemViewProps) {
  const catalogoQuery = useContagemCatalogo(sessionToken);
  const ativaQuery = useContagemAtiva(sessionToken);
  const {
    saving,
    errorMessage: salvarErrorMessage,
    salvar,
    clearError: clearSalvarError,
  } = useSalvarProgressoContagem(sessionToken);
  const { submitting, errorMessage, finalizar, clearError } = useFinalizarContagem(sessionToken);
  const {
    cancelling,
    errorMessage: cancelErrorMessage,
    cancelar,
    clearError: clearCancelError,
  } = useCancelarContagem(sessionToken);

  const [valores, setValores] = useState<Record<string, CampoValor>>({});
  const [observacao, setObservacao] = useState("");
  const [tentouEnviar, setTentouEnviar] = useState(false);
  const [enviadaEm, setEnviadaEm] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const idContagem = ativaQuery.data?.idContagem;
  const hydratedIdRef = useRef<string | null>(null);

  const itens = useMemo(() => catalogoQuery.data ?? [], [catalogoQuery.data]);
  const grupos = useMemo(() => agruparCatalogoPorFamilia(itens), [itens]);

  const idsFaltando = useMemo(
    () => itens.filter((item) => parseContagemInteiro(valores[item.id]?.pacotes ?? "") === null),
    [itens, valores],
  );

  // Seed local field state from the active draft's last-saved values — once
  // per draft identity, so it never clobbers edits already in progress.
  useEffect(() => {
    const ativa = ativaQuery.data;
    if (!ativa || hydratedIdRef.current === ativa.idContagem) return;

    const seeded: Record<string, CampoValor> = {};
    for (const [itemId, valor] of Object.entries(ativa.valores)) {
      seeded[itemId] = {
        pacotes: String(valor.pacotes_fechados),
        avulsas: valor.unidades_avulsas > 0 ? String(valor.unidades_avulsas) : "",
      };
    }

    setValores(seeded);
    hydratedIdRef.current = ativa.idContagem;
  }, [ativaQuery.data]);

  function setCampo(itemId: string, campo: keyof CampoValor, value: string) {
    setValores((atual) => ({
      ...atual,
      [itemId]: {
        pacotes: campo === "pacotes" ? value : (atual[itemId]?.pacotes ?? ""),
        avulsas: campo === "avulsas" ? value : (atual[itemId]?.avulsas ?? ""),
      },
    }));
    setSalvo(false);
  }

  function resetForm() {
    setValores({});
    setObservacao("");
    setTentouEnviar(false);
    setEnviadaEm(null);
    setSalvo(false);
    clearError();
    hydratedIdRef.current = null;
    void ativaQuery.refetch();
  }

  async function handleSalvar() {
    if (!idContagem) return;
    clearSalvarError();

    const payload: ContagemItemPayload[] = [];
    for (const item of itens) {
      const pacotes = parseContagemInteiro(valores[item.id]?.pacotes ?? "");
      if (pacotes === null) continue;
      payload.push({
        id_item: item.id,
        pacotes_fechados: pacotes,
        unidades_avulsas: parseContagemInteiro(valores[item.id]?.avulsas ?? "") ?? 0,
      });
    }
    if (payload.length === 0) return;

    const ok = await salvar(idContagem, payload);
    if (ok) setSalvo(true);
  }

  async function handleSubmit() {
    setTentouEnviar(true);
    clearError();

    if (idsFaltando.length > 0) {
      document
        .getElementById(`contagem-${idsFaltando[0].id}-pacotes`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (!idContagem) return;

    const payload: ContagemItemPayload[] = itens.map((item) => ({
      id_item: item.id,
      pacotes_fechados: parseContagemInteiro(valores[item.id]?.pacotes ?? "") ?? 0,
      unidades_avulsas: parseContagemInteiro(valores[item.id]?.avulsas ?? "") ?? 0,
    }));

    const novoId = await finalizar(idContagem, payload, observacao.trim() || null);
    if (novoId) setEnviadaEm(formatManaus(new Date()));
  }

  async function handleCancelarConfirm() {
    if (!idContagem) return;

    const ok = await cancelar(idContagem);
    if (!ok) return;

    hydratedIdRef.current = null;
    setValores({});
    setObservacao("");
    setTentouEnviar(false);
    setSalvo(false);
    setCancelDialogOpen(false);
    void ativaQuery.refetch();
  }

  if (catalogoQuery.isLoading || ativaQuery.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {CONTAGEM_CARREGANDO_MESSAGE}
      </div>
    );
  }

  if (catalogoQuery.isError || ativaQuery.isError || itens.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm text-destructive">{CONTAGEM_CATALOGO_ERRO_MESSAGE}</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void catalogoQuery.refetch();
            void ativaQuery.refetch();
          }}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (enviadaEm) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card px-4 py-10 text-center">
        <CheckCircle2 className="h-10 w-10 text-brand" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-foreground">{CONTAGEM_ENVIADA_TITLE}</p>
          <p className="text-sm text-muted-foreground">
            {getContagemEnviadaDescription(apelido, enviadaEm)}
          </p>
        </div>
        <Button type="button" className="min-touch" onClick={resetForm}>
          {CONTAGEM_NOVA_CONTAGEM_LABEL}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      {ativaQuery.data && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {getContagemIniciadaDescription(
            ativaQuery.data.iniciadoPorNome,
            formatContagemDataHora(ativaQuery.data.iniciadoEm),
          )}
        </p>
      )}

      <div className="sticky top-0 z-10 bg-background py-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            className="min-touch"
            disabled={saving || submitting || cancelling}
            onClick={() => void handleSalvar()}
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {CONTAGEM_SALVANDO_LABEL}
              </span>
            ) : (
              CONTAGEM_SALVAR_LABEL
            )}
          </Button>
          {salvo && !saving && (
            <span className="text-xs text-muted-foreground">{CONTAGEM_PROGRESSO_SALVO_LABEL}</span>
          )}
        </div>

        {salvarErrorMessage && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {salvarErrorMessage}
          </p>
        )}
      </div>

      {grupos.map((grupo) => (
        <section key={grupo.familia} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {grupo.label}
          </h2>
          <ul className="flex flex-col gap-3">
            {grupo.itens.map((item) => (
              <ContagemItemField
                key={item.id}
                item={item}
                pacotes={valores[item.id]?.pacotes ?? ""}
                avulsas={valores[item.id]?.avulsas ?? ""}
                faltando={
                  tentouEnviar && parseContagemInteiro(valores[item.id]?.pacotes ?? "") === null
                }
                onPacotesChange={(value) => setCampo(item.id, "pacotes", value)}
                onAvulsasChange={(value) => setCampo(item.id, "avulsas", value)}
              />
            ))}
          </ul>
        </section>
      ))}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contagem-observacao" className="text-sm text-foreground">
          {CONTAGEM_OBSERVACAO_LABEL}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {CONTAGEM_OBSERVACAO_HINT}
          </span>
        </Label>
        <Textarea
          id="contagem-observacao"
          value={observacao}
          onChange={(event) => setObservacao(event.target.value)}
          placeholder={CONTAGEM_OBSERVACAO_PLACEHOLDER}
          rows={3}
        />
      </div>

      {tentouEnviar && idsFaltando.length > 0 && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {getContagemItensFaltandoMessage(idsFaltando.length)}
        </p>
      )}

      {errorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      <Button type="submit" className="min-touch w-full" disabled={submitting || cancelling}>
        {submitting ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {CONTAGEM_ENVIANDO_LABEL}
          </span>
        ) : (
          CONTAGEM_SUBMIT_LABEL
        )}
      </Button>

      <AlertDialog
        open={cancelDialogOpen}
        onOpenChange={(open) => {
          setCancelDialogOpen(open);
          if (!open) clearCancelError();
        }}
      >
        <Button
          type="button"
          variant="ghost"
          className="min-touch w-full text-muted-foreground"
          disabled={submitting || cancelling}
          onClick={() => setCancelDialogOpen(true)}
        >
          {CONTAGEM_CANCELAR_LABEL}
        </Button>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{CONTAGEM_CANCELAR_CONFIRM_TITLE}</AlertDialogTitle>
            <AlertDialogDescription>{CONTAGEM_CANCELAR_CONFIRM_DESCRIPTION}</AlertDialogDescription>
          </AlertDialogHeader>
          {cancelErrorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {cancelErrorMessage}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="border-0 bg-primary text-primary-foreground shadow hover:bg-primary/90">
              {CONTAGEM_CANCELAR_CONFIRM_CANCEL_LABEL}
            </AlertDialogCancel>
            <AlertDialogAction
              className="border border-destructive/40 bg-transparent text-destructive shadow-none hover:bg-destructive/10"
              disabled={cancelling}
              onClick={(event) => {
                event.preventDefault();
                void handleCancelarConfirm();
              }}
            >
              {cancelling ? CONTAGEM_CANCELANDO_LABEL : CONTAGEM_CANCELAR_CONFIRM_ACCEPT_LABEL}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
