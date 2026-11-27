import { Loader2, ScanBarcode } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  ProdutoEstoqueCabecalho,
  ProdutoEstoqueView,
} from "@/components/estoque/ProdutoEstoqueView";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ESTOQUE_CODIGO_BARRA_CARREGANDO_MESSAGE,
  ESTOQUE_CODIGO_BARRA_ERRO_MESSAGE,
  ESTOQUE_CODIGO_BARRA_NAO_ENCONTRADO_DICA,
  ESTOQUE_CODIGO_BARRA_NAO_ENCONTRADO_MESSAGE,
  ESTOQUE_CODIGO_LIDO_LABEL,
  ESTOQUE_COR_ESGOTADA_MESSAGE,
  ESTOQUE_ESCOPO_COR_ARIA_LABEL,
  ESTOQUE_ESCOPO_ESTA_COR_LABEL,
  ESTOQUE_ESCOPO_TODAS_CORES_LABEL,
  ESTOQUE_PRODUTO_SEM_ESTOQUE_MESSAGE,
  ESTOQUE_VER_OUTRAS_CORES_LABEL,
  getEstoqueOutrasCoresLabel,
  getEstoqueTamanhoDisponivelLabel,
  getEstoqueTamanhoEsgotadoLabel,
} from "@/config/constants";
import { useEstoqueCodigoBarra } from "@/hooks/useEstoqueCodigoBarra";
import type { EstoqueCodigoBarraResultado } from "@/integrations/supabase/contracts";
import { corNomeExibicao } from "@/lib/estoque";
import { cn } from "@/lib/utils";

type Escopo = "esta" | "todas";

interface CodigoBarraResultadoViewProps {
  sessionToken: string;
  codigo: string;
  /**
   * For an alphanumeric code that turns out not to be a barcode: the produto
   * the ordinary search would have opened (Enter's old behaviour). null for a
   * digits-only code, which shows "Código de barras não encontrado".
   */
  produtoFallback: string | null;
}

/**
 * Barcode Slice 2: resolves one submitted barcode and shows the outcome,
 * reusing the existing detail view / matrix. Mount with key={submission} so
 * the colour toggle resets for every new scan.
 */
export function CodigoBarraResultadoView({
  sessionToken,
  codigo,
  produtoFallback,
}: CodigoBarraResultadoViewProps) {
  const query = useEstoqueCodigoBarra(sessionToken, codigo);
  const [escopo, setEscopo] = useState<Escopo>("esta");

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {ESTOQUE_CODIGO_BARRA_CARREGANDO_MESSAGE}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm text-destructive">{ESTOQUE_CODIGO_BARRA_ERRO_MESSAGE}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const r = query.data ?? null;

  if (r === null || r.resultado === "NAO_ENCONTRADO" || r.produto === null) {
    if (produtoFallback) {
      return <ProdutoEstoqueView sessionToken={sessionToken} produto={produtoFallback} />;
    }
    return (
      <div role="status" className="flex flex-col items-center gap-2 py-10 text-center">
        <ScanBarcode className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-base font-semibold text-foreground">
          {ESTOQUE_CODIGO_BARRA_NAO_ENCONTRADO_MESSAGE}
        </p>
        <p className="text-sm text-muted-foreground">{ESTOQUE_CODIGO_BARRA_NAO_ENCONTRADO_DICA}</p>
        <CodigoLido codigo={codigo} />
      </div>
    );
  }

  const produto = r.produto;
  const corCodigo = r.cor_codigo as string;
  const tamanhoKey = r.tamanho_key as number;
  const corNome = corNomeExibicao(r.cor_nome_portal);
  const tamanho = r.tamanho_venda ?? "";

  if (r.resultado === "REFERENCIA_ESGOTADA") {
    return (
      <section className="flex flex-col gap-4">
        <ProdutoEstoqueCabecalho produto={produto} descProduto={r.desc_produto} />
        <Aviso tom="esgotado">
          <p className="font-semibold">{ESTOQUE_PRODUTO_SEM_ESTOQUE_MESSAGE}</p>
          <p className="text-xs">
            Cor {corCodigo} — {corNome}
            {tamanho && ` · Tamanho ${tamanho}`}
          </p>
        </Aviso>
        <CodigoLido codigo={r.codigo_barra} />
      </section>
    );
  }

  const outras = r.outras_cores_disponiveis ?? 0;
  const seletor = <EscopoCorSeletor value={escopo} onChange={setEscopo} />;

  if (r.resultado === "COR_ESGOTADA") {
    const avisoCor = (
      <div className="flex flex-col gap-3">
        <Aviso tom="esgotado">
          <p className="font-semibold">{ESTOQUE_COR_ESGOTADA_MESSAGE}</p>
          <p className="text-xs">
            Cor {corCodigo} — {corNome}
            {outras > 0 && ` · ${getEstoqueOutrasCoresLabel(outras)}`}
          </p>
        </Aviso>
        {seletor}
      </div>
    );

    if (escopo === "todas") {
      return <ProdutoEstoqueView sessionToken={sessionToken} produto={produto} aviso={avisoCor} />;
    }

    return (
      <section className="flex flex-col gap-4">
        <ProdutoEstoqueCabecalho produto={produto} descProduto={r.desc_produto} />
        {avisoCor}
        {outras > 0 && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-fit"
            onClick={() => setEscopo("todas")}
          >
            {ESTOQUE_VER_OUTRAS_CORES_LABEL}
          </Button>
        )}
        <CodigoLido codigo={r.codigo_barra} />
      </section>
    );
  }

  // DISPONIVEL / TAMANHO_ESGOTADO: the colour has stock, so the detail RPC has
  // its full applicable grade (zero-stock sizes included).
  const aviso = (
    <div className="flex flex-col gap-3">
      <AvisoTamanho resultado={r} tamanho={tamanho} corCodigo={corCodigo} corNome={corNome} />
      {seletor}
    </div>
  );

  return (
    <ProdutoEstoqueView
      sessionToken={sessionToken}
      produto={produto}
      filtroCor={escopo === "esta" ? corCodigo : null}
      destaque={{ corCodigo, tamanhoKey }}
      aviso={aviso}
    />
  );
}

function AvisoTamanho({
  resultado,
  tamanho,
  corCodigo,
  corNome,
}: {
  resultado: EstoqueCodigoBarraResultado;
  tamanho: string;
  corCodigo: string;
  corNome: string;
}) {
  const disponivel = resultado.resultado === "DISPONIVEL";
  return (
    <Aviso tom={disponivel ? "disponivel" : "esgotado"}>
      <p className="font-semibold">
        {disponivel
          ? getEstoqueTamanhoDisponivelLabel(tamanho, resultado.quantidade_estoque ?? 0)
          : getEstoqueTamanhoEsgotadoLabel(tamanho)}
      </p>
      <p className="text-xs">
        Cor {corCodigo} — {corNome} · {ESTOQUE_CODIGO_LIDO_LABEL.toLowerCase()}{" "}
        <span className="font-mono">{resultado.codigo_barra}</span>
      </p>
    </Aviso>
  );
}

function Aviso({ tom, children }: { tom: "disponivel" | "esgotado"; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-0.5 rounded-xl border px-3 py-2 text-sm",
        tom === "disponivel"
          ? "border-brand/25 bg-brand/5 text-foreground"
          : "border-destructive/30 bg-destructive/5 text-destructive",
      )}
    >
      {children}
    </div>
  );
}

function CodigoLido({ codigo }: { codigo: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {ESTOQUE_CODIGO_LIDO_LABEL}: <span className="font-mono">{codigo}</span>
    </p>
  );
}

function EscopoCorSeletor({
  value,
  onChange,
}: {
  value: Escopo;
  onChange: (escopo: Escopo) => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (next === "esta" || next === "todas") onChange(next);
      }}
    >
      <TabsList
        aria-label={ESTOQUE_ESCOPO_COR_ARIA_LABEL}
        className="h-auto gap-1 rounded-none bg-transparent p-0"
      >
        {(
          [
            ["esta", ESTOQUE_ESCOPO_ESTA_COR_LABEL],
            ["todas", ESTOQUE_ESCOPO_TODAS_CORES_LABEL],
          ] as const
        ).map(([valor, label]) => (
          <TabsTrigger
            key={valor}
            value={valor}
            className="min-h-11 rounded-none border-b-2 border-transparent px-3 text-muted-foreground data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
