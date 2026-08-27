import { useMemo, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { ContagemItemField } from "@/components/contagem/ContagemItemField";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTAGEM_CARREGANDO_MESSAGE,
  CONTAGEM_CATALOGO_ERRO_MESSAGE,
  CONTAGEM_ENVIADA_TITLE,
  CONTAGEM_ENVIANDO_LABEL,
  CONTAGEM_NOVA_CONTAGEM_LABEL,
  CONTAGEM_OBSERVACAO_HINT,
  CONTAGEM_OBSERVACAO_LABEL,
  CONTAGEM_OBSERVACAO_PLACEHOLDER,
  CONTAGEM_SUBMIT_LABEL,
  getContagemEnviadaDescription,
  getContagemItensFaltandoMessage,
} from "@/config/constants";
import { useContagemCatalogo } from "@/hooks/useContagemCatalogo";
import { useSubmeterContagem, type SubmeterContagemItem } from "@/hooks/useSubmeterContagem";
import { agruparCatalogoPorFamilia, parseContagemInteiro } from "@/lib/contagem";
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
 * Milestone 4D: the counting form. Loads the active catalog, renders one
 * field group per item grouped by family, computes each total live, and
 * validates required Pacotes fechados only on submit — untouched fields
 * stay visually neutral until then. The submitter and timestamp are added
 * server-side; nothing here asks the employee for identity or date/time.
 */
export function NovaContagemView({ sessionToken, apelido }: NovaContagemViewProps) {
  const catalogoQuery = useContagemCatalogo(sessionToken);
  const { submitting, errorMessage, submeter, clearError } = useSubmeterContagem(sessionToken);

  const [valores, setValores] = useState<Record<string, CampoValor>>({});
  const [observacao, setObservacao] = useState("");
  const [tentouEnviar, setTentouEnviar] = useState(false);
  const [enviadaEm, setEnviadaEm] = useState<string | null>(null);

  const itens = useMemo(() => catalogoQuery.data ?? [], [catalogoQuery.data]);
  const grupos = useMemo(() => agruparCatalogoPorFamilia(itens), [itens]);

  const idsFaltando = useMemo(
    () => itens.filter((item) => parseContagemInteiro(valores[item.id]?.pacotes ?? "") === null),
    [itens, valores],
  );

  function setCampo(itemId: string, campo: keyof CampoValor, value: string) {
    setValores((atual) => ({
      ...atual,
      [itemId]: {
        pacotes: campo === "pacotes" ? value : (atual[itemId]?.pacotes ?? ""),
        avulsas: campo === "avulsas" ? value : (atual[itemId]?.avulsas ?? ""),
      },
    }));
  }

  function resetForm() {
    setValores({});
    setObservacao("");
    setTentouEnviar(false);
    setEnviadaEm(null);
    clearError();
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

    const payload: SubmeterContagemItem[] = itens.map((item) => ({
      id_item: item.id,
      pacotes_fechados: parseContagemInteiro(valores[item.id]?.pacotes ?? "") ?? 0,
      unidades_avulsas: parseContagemInteiro(valores[item.id]?.avulsas ?? "") ?? 0,
    }));

    const novoId = await submeter(payload, observacao.trim() || null);
    if (novoId) setEnviadaEm(formatManaus(new Date()));
  }

  if (catalogoQuery.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {CONTAGEM_CARREGANDO_MESSAGE}
      </div>
    );
  }

  if (catalogoQuery.isError || itens.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm text-destructive">{CONTAGEM_CATALOGO_ERRO_MESSAGE}</p>
        <Button type="button" variant="outline" onClick={() => void catalogoQuery.refetch()}>
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

      <Button type="submit" className="min-touch w-full" disabled={submitting}>
        {submitting ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {CONTAGEM_ENVIANDO_LABEL}
          </span>
        ) : (
          CONTAGEM_SUBMIT_LABEL
        )}
      </Button>
    </form>
  );
}
