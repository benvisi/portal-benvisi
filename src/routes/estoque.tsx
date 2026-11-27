import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Settings2 } from "lucide-react";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";

import { CodigoBarraResultadoView } from "@/components/estoque/CodigoBarraResultadoView";
import { EstoqueBuscaField } from "@/components/estoque/EstoqueBuscaField";
import { ProdutoEstoqueView } from "@/components/estoque/ProdutoEstoqueView";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import {
  CONSULTA_ESTOQUE_PAGE_SUBTITLE,
  CONSULTA_ESTOQUE_TITLE,
  ESTOQUE_BUSCA_DEBOUNCE_MS,
  ESTOQUE_BUSCA_MAX_SUGESTOES,
  ESTOQUE_BUSCA_MIN_CHARS,
  ESTOQUE_FRESHNESS_ERRO_MESSAGE,
  ESTOQUE_LEMBRETE_OPERACIONAL_MESSAGE,
  ESTOQUE_SEM_SNAPSHOT_MESSAGE,
  getEstoqueAtualizadoLabel,
  TERMOS_BUSCA_ADMIN_LINK_LABEL,
  VOLTAR_AO_PAINEL_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useBuscarProdutosEstoque } from "@/hooks/useBuscarProdutosEstoque";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useEstoqueFreshness } from "@/hooks/useEstoqueFreshness";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";
import { useTermosBuscaPermissao } from "@/hooks/useTermosBuscaPermissao";
import { usePonteiroToque } from "@/hooks/usePonteiroToque";
import { isCodigoBarraSomenteDigitos } from "@/lib/codigoBarras";
import { formatEstoqueFreshness } from "@/lib/estoque";

const EscanerCodigoBarrasDialog = lazy(
  () => import("@/components/estoque/EscanerCodigoBarrasDialog"),
);

type Selecao =
  | { tipo: "produto"; produto: string }
  | { tipo: "codigo"; codigo: string; produtoFallback: string | null; id: number };

export const Route = createFileRoute("/estoque")({
  head: () => ({
    meta: [
      { title: "Consulta de Estoque — Portal Benvisi" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConsultaEstoquePage,
});

// Milestone 4E: Consulta de Estoque UI V1 — a dedicated Dashboard module
// available to every authenticated active employee. It is a general
// sales-floor utility, deliberately independent of "Iniciar atividades" and
// Lista da Vez (useRequireSession is the only gate). All ordering, colours,
// applicable sizes, quantities and freshness come from the backend RPCs.
function ConsultaEstoquePage() {
  const goBack = useGoBack(ROUTES.DASHBOARD);
  const { session, ready } = useRequireSession();
  const sessionToken = session?.session_token ?? null;

  const [termo, setTermo] = useState("");
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const [escaneando, setEscaneando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const touch = usePonteiroToque();

  const selecionarProduto = useCallback((produto: string) => {
    setSelecao({ tipo: "produto", produto });
  }, []);

  // Barcode Slice 2: an identical code already on screen is not re-submitted
  // (scanner double-Enter, repeated camera read); a new code replaces it.
  const selecionarCodigo = useCallback((codigo: string, produtoFallback: string | null) => {
    setSelecao((atual) =>
      atual?.tipo === "codigo" && atual.codigo === codigo
        ? atual
        : {
            tipo: "codigo",
            codigo,
            produtoFallback,
            id: (atual?.tipo === "codigo" ? atual.id : 0) + 1,
          },
    );
  }, []);

  const aoDetectarCamera = useCallback(
    (codigo: string) => {
      setEscaneando(false);
      setTermo(codigo);
      selecionarCodigo(codigo, isCodigoBarraSomenteDigitos(codigo) ? null : codigo);
    },
    [selecionarCodigo],
  );

  const termoDebounced = useDebouncedValue(termo, ESTOQUE_BUSCA_DEBOUNCE_MS);
  const freshness = useEstoqueFreshness(sessionToken);
  const busca = useBuscarProdutosEstoque(sessionToken, termoDebounced);
  const permissaoTermos = useTermosBuscaPermissao(sessionToken);

  const sugestoes = useMemo(
    () => (busca.data ?? []).slice(0, ESTOQUE_BUSCA_MAX_SUGESTOES),
    [busca.data],
  );

  if (!ready || !session || sessionToken === null) return null;

  const termoLimpo = termo.trim();
  const aguardandoDebounce =
    termoLimpo.length >= ESTOQUE_BUSCA_MIN_CHARS &&
    termoLimpo.toLowerCase() !== termoDebounced.trim().toLowerCase();

  const renderConteudo = () => {
    if (freshness.isLoading) {
      return (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
        </div>
      );
    }

    if (freshness.isError) {
      return (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-sm text-destructive">{ESTOQUE_FRESHNESS_ERRO_MESSAGE}</p>
          <Button type="button" variant="outline" onClick={() => void freshness.refetch()}>
            Tentar novamente
          </Button>
        </div>
      );
    }

    if (!freshness.data) {
      return (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {ESTOQUE_SEM_SNAPSHOT_MESSAGE}
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-6">
        <EstoqueBuscaField
          value={termo}
          onChange={setTermo}
          onSelect={selecionarProduto}
          onCodigoBarra={selecionarCodigo}
          onEscanear={touch ? () => setEscaneando(true) : undefined}
          inputRef={inputRef}
          suggestions={sugestoes}
          isLoading={busca.isFetching || aguardandoDebounce}
          isError={busca.isError}
          hasQueried={busca.isSuccess}
        />

        {/*
          No "voltar à busca" control: the search field above stays visible and
          editable, so the employee just types another produto to replace the
          detail; the header back arrow already exits Consulta de Estoque.
        */}
        {selecao?.tipo === "produto" && (
          <ProdutoEstoqueView sessionToken={sessionToken} produto={selecao.produto} />
        )}
        {selecao?.tipo === "codigo" && (
          <CodigoBarraResultadoView
            key={selecao.id}
            sessionToken={sessionToken}
            codigo={selecao.codigo}
            produtoFallback={selecao.produtoFallback}
          />
        )}

        {/* Lazy: the scanner and its decoder load only when the camera opens. */}
        {escaneando && (
          <Suspense fallback={null}>
            <EscanerCodigoBarrasDialog
              onDetectado={aoDetectarCamera}
              onFechar={() => setEscaneando(false)}
              onDigitar={() => {
                setEscaneando(false);
                window.setTimeout(() => inputRef.current?.focus(), 0);
              }}
            />
          </Suspense>
        )}

        <footer className="flex flex-col gap-1 border-t border-border pt-4 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {getEstoqueAtualizadoLabel(formatEstoqueFreshness(freshness.data))}
          </span>
          <span>{ESTOQUE_LEMBRETE_OPERACIONAL_MESSAGE}</span>
          {/*
            Termos de busca V1: entry to the management area, shown only to
            holders of the pode_gerenciar_termos_busca capability (the route
            and every RPC re-check it server-side).
          */}
          {permissaoTermos.podeGerenciar && (
            <Link
              to={ROUTES.ADMINISTRATIVO_TERMOS_BUSCA}
              className="mt-2 inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
              {TERMOS_BUSCA_ADMIN_LINK_LABEL}
            </Link>
          )}
        </footer>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <header className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-touch shrink-0"
            onClick={goBack}
            aria-label={VOLTAR_AO_PAINEL_LABEL}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="text-xl font-semibold text-foreground">{CONSULTA_ESTOQUE_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{CONSULTA_ESTOQUE_PAGE_SUBTITLE}</p>

        {renderConteudo()}
      </div>

      <AuthUtilityBar />
    </main>
  );
}
