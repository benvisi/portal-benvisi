import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { EmployeeList } from "@/components/auth/EmployeeList";
import { EmployeeSearch } from "@/components/auth/EmployeeSearch";
import { LoginError } from "@/components/auth/LoginError";
import { NumericKeypad } from "@/components/auth/NumericKeypad";
import { PinDisplay } from "@/components/auth/PinDisplay";
import { VerifyingOverlay } from "@/components/auth/VerifyingOverlay";
import { PIN_LENGTH } from "@/config/constants";
import { useLogin } from "@/hooks/useLogin";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Entrar — Portal Benvisi" },
      {
        name: "description",
        content: "Acesso rápido por PIN para colaboradores das lojas Benvisi.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const login = useLogin();
  const showKeypad = login.stage !== "selecting";

  return (
    <main className="min-h-screen bg-background">
      <VerifyingOverlay visible={login.stage === "verifying"} />

      {/* Desktop / tablet split-screen */}
      <div className="mx-auto hidden min-h-screen max-w-6xl grid-cols-2 gap-8 px-8 py-10 md:grid">
        <section className="flex flex-col gap-4">
          <Header />
          <EmployeeSearch value={login.query} onChange={login.setQuery} />
          <div className="flex-1 overflow-y-auto pr-2">
            {login.isLoading ? (
              <LoadingState />
            ) : login.loadError ? (
              <ErrorState />
            ) : (
              <EmployeeList
                employees={login.employees}
                selectedId={login.selectedId}
                onSelect={login.onSelectEmployee}
              />
            )}
          </div>
        </section>

        <section className="flex flex-col items-center justify-center gap-8 rounded-2xl bg-card p-8 shadow-card">
          <PinPanel
            title={
              login.selectedEmployee
                ? `Olá, ${login.selectedEmployee.nome}`
                : "Selecione seu perfil"
            }
            subtitle={
              login.selectedEmployee
                ? "Digite seu PIN de 4 dígitos"
                : "Escolha um funcionário na lista ao lado"
            }
            pinLength={login.pin.length}
            hasError={login.hasError}
            disabled={!login.selectedEmployee || login.stage === "verifying"}
            errorMessage={login.errorMessage}
            onDigit={login.onDigit}
            onBackspace={login.onBackspace}
          />
        </section>
      </div>

      {/* Mobile: two-step flow */}
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-5 py-6 md:hidden">
        <Header />
        {!showKeypad ? (
          <>
            <EmployeeSearch value={login.query} onChange={login.setQuery} />
            <div className="flex-1 overflow-y-auto">
              {login.isLoading ? (
                <LoadingState />
              ) : login.loadError ? (
                <ErrorState />
              ) : (
                <EmployeeList
                  employees={login.employees}
                  selectedId={login.selectedId}
                  onSelect={login.onSelectEmployee}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col gap-6">
            <button
              type="button"
              onClick={login.onBack}
              disabled={login.stage === "verifying"}
              className="min-touch flex items-center gap-2 self-start rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Voltar
            </button>
            <PinPanel
              title={login.selectedEmployee ? `Olá, ${login.selectedEmployee.nome}` : ""}
              subtitle="Digite seu PIN de 4 dígitos"
              pinLength={login.pin.length}
              hasError={login.hasError}
              disabled={login.stage === "verifying"}
              errorMessage={login.errorMessage}
              onDigit={login.onDigit}
              onBackspace={login.onBackspace}
            />
          </div>
        )}
      </div>
    </main>
  );
}

function Header() {
  return (
    <header className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-widest text-brand">
        Benvisi
      </span>
      <h1 className="text-2xl font-semibold text-foreground">Portal Benvisi</h1>
      <p className="text-sm text-muted-foreground">
        Acesse com seu apelido e PIN para iniciar o turno.
      </p>
    </header>
  );
}

interface PinPanelProps {
  title: string;
  subtitle: string;
  pinLength: number;
  hasError: boolean;
  disabled: boolean;
  errorMessage: string | null;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
}

function PinPanel({
  title,
  subtitle,
  pinLength,
  hasError,
  disabled,
  errorMessage,
  onDigit,
  onBackspace,
}: PinPanelProps) {
  return (
    <div
      role="dialog"
      aria-label="Entrada de PIN"
      className="flex w-full max-w-xs flex-col items-center gap-6"
    >
      <div className="flex flex-col items-center gap-1 text-center">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <PinDisplay length={PIN_LENGTH} filled={pinLength} hasError={hasError} />
      <LoginError message={errorMessage} />
      <NumericKeypad onDigit={onDigit} onBackspace={onBackspace} disabled={disabled} />
    </div>
  );
}

function LoadingState() {
  return (
    <p className="px-2 py-8 text-center text-sm text-muted-foreground">
      Carregando funcionários...
    </p>
  );
}

function ErrorState() {
  return (
    <p className="px-2 py-8 text-center text-sm text-destructive">
      Não foi possível carregar a lista de funcionários. Verifique sua conexão e tente novamente.
    </p>
  );
}
