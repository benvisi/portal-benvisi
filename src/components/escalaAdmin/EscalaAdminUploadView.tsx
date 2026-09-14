import { useRef, useState } from "react";
import type ExcelJS from "exceljs";
import { CheckCircle2, Loader2, Upload } from "lucide-react";

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
  ESCALA_ADMIN_ARQUIVO_INVALIDO_MESSAGE,
  ESCALA_ADMIN_ARQUIVO_SELECIONADO_PREFIX,
  ESCALA_ADMIN_BLOQUEIOS_TITLE,
  ESCALA_ADMIN_CORRIJA_E_REENVIE_MESSAGE,
  ESCALA_ADMIN_DIFF_A_CONFIRMAR_LABEL,
  ESCALA_ADMIN_DIFF_SETA,
  ESCALA_ADMIN_DIFF_STATUS_LABELS,
  ESCALA_ADMIN_ENVIAR_OUTRA_LABEL,
  ESCALA_ADMIN_ESCALAS_ENCONTRADAS_LABEL,
  ESCALA_ADMIN_ESCOLHER_ARQUIVO_LABEL,
  ESCALA_ADMIN_MES_A_PUBLICAR_LABEL,
  ESCALA_ADMIN_NENHUMA_ESCALA_ENCONTRADA_MESSAGE,
  ESCALA_ADMIN_NENHUM_PROBLEMA_MESSAGE,
  ESCALA_ADMIN_OCULTAR_ALTERACOES_LABEL,
  ESCALA_ADMIN_PROCESSANDO_MESSAGE,
  ESCALA_ADMIN_PUBLICANDO_LABEL,
  ESCALA_ADMIN_PUBLICAR_LABEL,
  ESCALA_ADMIN_PUBLICAR_MESMO_ASSIM_LABEL,
  ESCALA_ADMIN_SELECIONE_MES_MESSAGE,
  ESCALA_ADMIN_SEM_ALTERACOES_MESSAGE,
  ESCALA_ADMIN_SEM_ALTERACOES_TITLE,
  ESCALA_ADMIN_SUCESSO_MESSAGE,
  ESCALA_ADMIN_SUCESSO_TITLE,
  ESCALA_ADMIN_TROCAR_ARQUIVO_LABEL,
  ESCALA_ADMIN_VER_ALTERACOES_LABEL,
  getEscalaAdminAlteracoesLabel,
  getEscalaAdminAvisoLabel,
  getEscalaAdminProntaTitle,
  getEscalaAdminRevisaoTitle,
} from "@/config/constants";
import type {
  EscalaEntradaStatus,
  EscalaImportacaoResultado,
} from "@/integrations/supabase/contracts";
import { useEscalaProcessarImportacao } from "@/hooks/useEscalaProcessarImportacao";
import { formatHora } from "@/lib/escala";
import { possuiAlteracoesParaPublicar } from "@/lib/escalaImportacaoEstado";
import {
  buildImportPayload,
  escolherCandidataPreselecionada,
  findCandidateSheets,
  readWorkbookFromFile,
  type EscalaFolhaCandidata,
  type EscalaImportPayload,
} from "@/lib/escalaXlsx";

interface EscalaAdminUploadViewProps {
  sessionToken: string;
}

function formatDiaMes(dataISO: string): string {
  const [, mes, dia] = dataISO.split("-");
  return `${dia}/${mes}`;
}

function formatDiffLado(
  status: EscalaEntradaStatus | null,
  horaInicio: string | null,
  horaFim: string | null,
): string {
  if (status === null) return ESCALA_ADMIN_DIFF_A_CONFIRMAR_LABEL;
  if (status === "trabalho") return `${formatHora(horaInicio)}–${formatHora(horaFim)}`;
  return ESCALA_ADMIN_DIFF_STATUS_LABELS[status];
}

function mesReferenciaDeCandidata(candidata: EscalaFolhaCandidata): string {
  return `${candidata.ano}-${String(candidata.mes).padStart(2, "0")}-01`;
}

/**
 * Administrador: upload .xlsx -> pick the target monthly sheet -> preview
 * (validation + diff, via a dry-run call) -> publish (same call, publicar
 * = true). The client only does structural extraction (finding weekly
 * blocks/employee rows/raw cell strings); escala_processar_importacao is the
 * single authoritative place every value is normalized, validated, diffed,
 * and published.
 */
export function EscalaAdminUploadView({ sessionToken }: EscalaAdminUploadViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { processando, errorMessage, processar } = useEscalaProcessarImportacao(sessionToken);

  const [carregandoArquivo, setCarregandoArquivo] = useState(false);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<ExcelJS.Workbook | null>(null);
  const [candidatas, setCandidatas] = useState<EscalaFolhaCandidata[]>([]);
  const [sheetSelecionada, setSheetSelecionada] = useState<string | null>(null);
  const [payloadAtual, setPayloadAtual] = useState<EscalaImportPayload | null>(null);
  const [resultado, setResultado] = useState<EscalaImportacaoResultado | null>(null);
  const [mostrarDiff, setMostrarDiff] = useState(false);

  const candidataAtual = candidatas.find((c) => c.sheetName === sheetSelecionada) ?? null;
  const carregando = carregandoArquivo || processando;

  async function executarPreview(
    wb: ExcelJS.Workbook,
    candidata: EscalaFolhaCandidata,
    arquivo: string,
  ) {
    const payload = buildImportPayload(wb, candidata.sheetName, candidata.ano, candidata.mes);
    setPayloadAtual(payload);
    setMostrarDiff(false);

    const resposta = await processar({
      mesReferencia: mesReferenciaDeCandidata(candidata),
      nomeArquivo: arquivo,
      funcionariosPlanilha: payload.funcionariosPlanilha,
      entradas: payload.entradas,
      publicar: false,
    });
    if (resposta) setResultado(resposta);
  }

  async function handleFileChange(file: File) {
    setCarregandoArquivo(true);
    setErroArquivo(null);
    setResultado(null);
    setPayloadAtual(null);
    setCandidatas([]);
    setSheetSelecionada(null);

    try {
      const wb = await readWorkbookFromFile(file);
      const cands = findCandidateSheets(wb);

      setWorkbook(wb);
      setNomeArquivo(file.name);
      setCandidatas(cands);

      if (cands.length === 0) return;

      // Preselect only when it is safe to do so: a single valid monthly
      // sheet, or the file name reliably identifying exactly one of several
      // candidates. Sheet visibility and how much data a sheet contains are
      // never part of this decision. Anything else (multiple valid sheets,
      // file name absent/ambiguous) leaves the selection blank — the Admin
      // must choose the target month explicitly before anything is parsed.
      const preselecionada = escolherCandidataPreselecionada(cands, file.name);
      if (preselecionada) {
        setSheetSelecionada(preselecionada.sheetName);
        await executarPreview(wb, preselecionada, file.name);
      }
    } catch (error) {
      console.error("[EscalaAdminUploadView] failed to read workbook:", error);
      setErroArquivo(ESCALA_ADMIN_ARQUIVO_INVALIDO_MESSAGE);
      setWorkbook(null);
      setNomeArquivo(null);
    } finally {
      setCarregandoArquivo(false);
    }
  }

  async function handleSelecionarSheet(sheetName: string) {
    setSheetSelecionada(sheetName);
    const candidata = candidatas.find((c) => c.sheetName === sheetName);
    if (!candidata || !workbook || !nomeArquivo) return;
    setResultado(null);
    await executarPreview(workbook, candidata, nomeArquivo);
  }

  async function handlePublicar() {
    if (!resultado || !payloadAtual || !nomeArquivo) return;
    const resposta = await processar({
      mesReferencia: resultado.mes_referencia,
      nomeArquivo,
      funcionariosPlanilha: payloadAtual.funcionariosPlanilha,
      entradas: payloadAtual.entradas,
      publicar: true,
    });
    if (resposta) setResultado(resposta);
  }

  function handleReiniciar() {
    setWorkbook(null);
    setNomeArquivo(null);
    setCandidatas([]);
    setSheetSelecionada(null);
    setPayloadAtual(null);
    setResultado(null);
    setErroArquivo(null);
    setMostrarDiff(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (resultado?.status === "publicado") {
    return (
      <Card className="flex flex-col items-center gap-4 p-6 text-center shadow-card">
        <CheckCircle2 className="h-10 w-10 text-brand" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold text-foreground">{ESCALA_ADMIN_SUCESSO_TITLE}</p>
          <p className="text-sm text-muted-foreground">{ESCALA_ADMIN_SUCESSO_MESSAGE}</p>
        </div>
        <Button type="button" className="min-touch" onClick={handleReiniciar}>
          {ESCALA_ADMIN_ENVIAR_OUTRA_LABEL}
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-6 shadow-card">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFileChange(file);
          }}
        />

        <Button
          type="button"
          variant="outline"
          className="min-touch justify-center gap-2"
          disabled={carregando}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4" aria-hidden />
          {nomeArquivo ? ESCALA_ADMIN_TROCAR_ARQUIVO_LABEL : ESCALA_ADMIN_ESCOLHER_ARQUIVO_LABEL}
        </Button>

        {nomeArquivo && (
          <p className="text-sm text-muted-foreground">
            {ESCALA_ADMIN_ARQUIVO_SELECIONADO_PREFIX}:{" "}
            <span className="font-medium text-foreground">{nomeArquivo}</span>
          </p>
        )}

        {erroArquivo && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {erroArquivo}
          </p>
        )}

        {carregando && (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {carregandoArquivo ? "Lendo arquivo..." : ESCALA_ADMIN_PROCESSANDO_MESSAGE}
          </div>
        )}

        {!carregando && nomeArquivo && candidatas.length === 0 && !erroArquivo && (
          <p className="text-sm text-muted-foreground">
            {ESCALA_ADMIN_NENHUMA_ESCALA_ENCONTRADA_MESSAGE}
          </p>
        )}

        {candidatas.length > 0 && (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">
              {ESCALA_ADMIN_ESCALAS_ENCONTRADAS_LABEL}
            </label>

            {candidatas.length > 1 && !sheetSelecionada && (
              <p className="text-sm text-muted-foreground">{ESCALA_ADMIN_SELECIONE_MES_MESSAGE}</p>
            )}

            <Select
              value={sheetSelecionada ?? undefined}
              onValueChange={(value) => void handleSelecionarSheet(value)}
              disabled={carregando}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {candidatas.map((c) => (
                  <SelectItem key={c.sheetName} value={c.sheetName}>
                    {c.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {candidataAtual && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {ESCALA_ADMIN_MES_A_PUBLICAR_LABEL}
                </p>
                <p className="text-base font-semibold text-foreground">{candidataAtual.rotulo}</p>
              </div>
            )}
          </div>
        )}

        {errorMessage && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage}
          </p>
        )}
      </Card>

      {resultado?.status === "bloqueado" && (
        <Card className="flex flex-col gap-3 border-destructive/40 p-6 shadow-card">
          <p className="text-base font-semibold text-destructive">{ESCALA_ADMIN_BLOQUEIOS_TITLE}</p>
          <ul className="flex flex-col gap-2 text-sm text-foreground">
            {resultado.bloqueios.map((bloqueio, index) => (
              <li key={index}>• {bloqueio.mensagem}</li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{ESCALA_ADMIN_CORRIJA_E_REENVIE_MESSAGE}</p>
        </Card>
      )}

      {resultado?.status === "pronto" && !possuiAlteracoesParaPublicar(resultado) && (
        <Card className="flex flex-col gap-1 p-6 shadow-card">
          <p className="text-base font-semibold text-foreground">
            {ESCALA_ADMIN_SEM_ALTERACOES_TITLE}
          </p>
          <p className="text-sm text-muted-foreground">{ESCALA_ADMIN_SEM_ALTERACOES_MESSAGE}</p>
        </Card>
      )}

      {resultado?.status === "pronto" &&
        possuiAlteracoesParaPublicar(resultado) &&
        candidataAtual && (
          <Card className="flex flex-col gap-4 p-6 shadow-card">
            <div className="flex flex-col gap-1">
              <p className="text-base font-semibold text-foreground">
                {resultado.is_revisao
                  ? getEscalaAdminRevisaoTitle(candidataAtual.rotulo)
                  : getEscalaAdminProntaTitle(candidataAtual.rotulo)}
              </p>
              {resultado.is_revisao && (
                <p className="text-sm text-muted-foreground">
                  {getEscalaAdminAlteracoesLabel(resultado.diff.length)}
                </p>
              )}
            </div>

            <dl className="grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-xs text-muted-foreground">Funcionários</dt>
                <dd className="text-lg font-semibold text-foreground">
                  {resultado.contadores.funcionarios}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Dias</dt>
                <dd className="text-lg font-semibold text-foreground">
                  {resultado.contadores.dias}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Registros</dt>
                <dd className="text-lg font-semibold text-foreground">
                  {resultado.contadores.registros}
                </dd>
              </div>
            </dl>

            {resultado.avisos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {ESCALA_ADMIN_NENHUM_PROBLEMA_MESSAGE}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-foreground">
                  {getEscalaAdminAvisoLabel(resultado.avisos.length)}
                </p>
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {resultado.avisos.map((aviso, index) => (
                    <li key={index}>• {aviso.mensagem}</li>
                  ))}
                </ul>
              </div>
            )}

            {resultado.is_revisao && resultado.diff.length > 0 && (
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-touch self-start"
                  onClick={() => setMostrarDiff((atual) => !atual)}
                >
                  {mostrarDiff
                    ? ESCALA_ADMIN_OCULTAR_ALTERACOES_LABEL
                    : ESCALA_ADMIN_VER_ALTERACOES_LABEL}
                </Button>
                {mostrarDiff && (
                  <ul className="flex flex-col gap-3 rounded-lg border border-border p-3">
                    {resultado.diff.map((item, index) => (
                      <li key={index} className="text-sm">
                        <p className="font-medium text-foreground">
                          {item.apelido} — {formatDiaMes(item.data)}
                        </p>
                        <p className="text-muted-foreground">
                          {formatDiffLado(item.de_status, item.de_hora_inicio, item.de_hora_fim)}{" "}
                          {ESCALA_ADMIN_DIFF_SETA}{" "}
                          {formatDiffLado(
                            item.para_status,
                            item.para_hora_inicio,
                            item.para_hora_fim,
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <Button
              type="button"
              className="min-touch"
              disabled={processando}
              onClick={() => void handlePublicar()}
            >
              {processando
                ? ESCALA_ADMIN_PUBLICANDO_LABEL
                : resultado.avisos.length > 0
                  ? ESCALA_ADMIN_PUBLICAR_MESMO_ASSIM_LABEL
                  : ESCALA_ADMIN_PUBLICAR_LABEL}
            </Button>
          </Card>
        )}
    </div>
  );
}
