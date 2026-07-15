
# Portal Benvisi — Fundação, Design System e Módulo 1 (Login) — v6 (Final para Build de Produção)

## Escopo
1. Conectar o Supabase externo (`https://ugfogsseikupsfqqznzi.supabase.co`).
2. Configurar o Design System global Benvisi.
3. Construir a Tela de Login (`/`), mobile-first + split-screen em tablet/desktop.
4. Criar o Dashboard Temporário em `/dashboard` (protegido por guard client-side).

**Fora do escopo desta fase**: sincronização SQL Server ⇄ Supabase, infraestrutura de testes automatizados (Vitest, Playwright, Storybook), CI/CD, demais módulos táticos, área autenticada real final.

---

## Padrões Transversais de Engenharia de Software

**Idiomas**
- Código 100% em inglês (pastas, arquivos, variáveis, funções, hooks, componentes, tipos, chaves de query). Ex.: `auth/`, `EmployeeSearch.tsx`, `useEmployeeQuery`, `AuthSession`, `verifyPin`.
- UI 100% em português brasileiro de alta qualidade (labels, placeholders, mensagens de erro, textos do dashboard, `aria-label`s).

**Restrições técnicas estritas**
- **Zero alterações no banco**: nenhuma migration, nenhuma sugestão de alterar RPC/schema, nenhum SQL de descoberta solicitado ao usuário.
- **Proibido `any`**: usar tipos explícitos ou `unknown` + type guards.
- **Sem código morto**: nada de trechos comentados, `// TODO`, imports não usados.
- **Sem `console.*` solto**: permitido apenas em blocos explícitos e estruturados de tratamento de erro (`catch` com contexto).
- **Limite ~200 linhas por arquivo**: componentes/hooks maiores são refatorados em subcomponentes ou utilitários locais.
- **Árvore de arquivos enxuta**: nada é criado além do listado em "Arquivos criados/alterados" sem necessidade real.

**Arquiteturais**
- **Componentes puros**: os componentes de UI são puramente declarativos. **Não conhecem** Supabase, `sessionStorage`, `fetch` ou APIs externas. Toda comunicação com dados passa por hooks (`useLogin`, `useEmployeeQuery`) ou serviços (`AuthSession`, `HapticService`).
- **Sem Context Provider global de auth** nesta fase — sessão fica encapsulada em `AuthSession` + hooks.
- **Rotas e constantes centralizadas** em `src/config/`. Nenhum literal `'/'`/`'/dashboard'` ou número mágico (4, 400, 180, 44, 64, 10) aparece fora de `src/config/`.

---

## 1. Conexão com Supabase externo

- `add_secret` para `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`.
- `src/integrations/supabase/client.ts` — `createClient` com `persistSession: false`, `autoRefreshToken: false` (autenticação por PIN customizada via RPC, **não** Supabase Auth).
- Instalar `@supabase/supabase-js`.

Segurança:
- `token_pin` **nunca** é exposto, consultado ou armazenado localmente. SELECTs restritos a `id, apelido, nome, cargo`.
- Validação exclusivamente via `supabase.rpc('verify_pin', ...)`.
- PIN nunca persistido, nunca logado.

## 2. Contrato da RPC — adaptar ao existente

Sem SQL de descoberta, sem chamadas de teste com dados fictícios, sem inspeção OpenAPI.

- Se `src/integrations/supabase/types.ts` gerado pelo Supabase existir, uso `Database['public']['Functions']['verify_pin']['Returns']` diretamente.
- Caso contrário, defino contrato local estrito em `src/integrations/supabase/types.ts`:
  ```ts
  export interface VerifyPinSuccess {
    success: true;
    funcionario_id: string;
    nome: string;
    cargo: string;
  }
  export interface VerifyPinFailure { success: false }
  export type VerifyPinResult = VerifyPinSuccess | VerifyPinFailure;
  ```
- Guard `isVerifyPinSuccess(result: unknown): result is VerifyPinSuccess` valida shape em runtime; só aceita sucesso após passar.
- Se `nome`/`cargo` não vierem da RPC, `useLogin` faz SELECT seguro complementar em `funcionarios` pelo `funcionario_id` retornado. Nenhuma sugestão de alterar a RPC.

## 3. Rotas centralizadas — `src/config/routes.ts`

```ts
export const ROUTES = {
  LOGIN: '/',
  DASHBOARD: '/dashboard',
} as const;
export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
```

Todo `navigate`/`Link`/redirect consome `ROUTES.*`.

## 4. Constantes centralizadas — `src/config/constants.ts`

```ts
export const PIN_LENGTH = 4;
export const PIN_SHAKE_DURATION_MS = 400;
export const LOGIN_TRANSITION_MS = 180;
export const MOTION_FAST_MS = 180;

export const HAPTIC_TAP_MS = 10;
export const HAPTIC_SUCCESS_PATTERN = [30, 40, 30] as const;
export const HAPTIC_ERROR_PATTERN = [60, 40, 60] as const;

export const TOUCH_TARGET_MIN_PX = 44;
export const KEYPAD_BUTTON_MIN_PX = 64;

export const SESSION_STORAGE_KEY = 'benvisi.session';
export const EMPLOYEES_QUERY_KEY = ['employees'] as const;

export const MANAUS_TIMEZONE = 'America/Manaus';
export const LOCALE_PT_BR = 'pt-BR';

export const LOGIN_ERROR_MESSAGE = 'PIN ou usuário incorreto. Tente novamente.';
export const VERIFYING_MESSAGE = 'Validando PIN...';
export const SEARCH_PLACEHOLDER = 'Buscar por apelido...';
```

## 5. Design System global (`src/styles.css` + `__root.tsx`)

Tokens Benvisi em oklch, mapeados via `@theme inline`, com tokens semânticos de feedback já prontos para módulos futuros:

| Token | Origem hex | Uso |
|---|---|---|
| `--background` | `#f9fafb` | Fundo principal |
| `--foreground` | `#1f2937` | Texto/títulos |
| `--primary` | `#2563eb` | Ações, foco, seleções |
| `--primary-hover` | `#3b82f6` | Hover/ativo |
| `--brand` | `#064e3b` | Marca institucional |
| `--destructive` | `#ef4444` | Erros, botão Sair |
| **`--success`** | `#16a34a` | Sucesso (uso futuro) |
| **`--warning`** | `#f59e0b` | Alertas (uso futuro) |
| **`--info`** | `#0ea5e9` | Informativos (uso futuro) |
| `--radius` | `12px` | Cartões, inputs, botões |

Cada token vira utilitário Tailwind via `@theme inline` (inclusive `*-foreground`).

Também:
- Sombras `--shadow-soft`, `--shadow-card`.
- Fonte **Inter** carregada via `<link>` no `head()` do `__root.tsx` (preconnect + stylesheet do Google Fonts). **Nunca** `@import` remoto em `styles.css`. Família registrada em `--font-sans`.
- `@utility min-touch { min-height: 44px; min-width: 44px; }` (WCAG).
- `--motion-fast: 180ms` e `@utility animate-shake` (keyframes 400ms ease-out).
- Metadata Benvisi ("Portal Benvisi — Assistente Operacional") + favicon no `__root.tsx`.

## 6. Módulo 01 — Tela de Login (`ROUTES.LOGIN`)

Reescreve `src/routes/index.tsx` (remove placeholder).

- **Mobile (`< md`)**: duas etapas (busca+lista → teclado+PIN), transição `LOGIN_TRANSITION_MS`.
- **Tablet/Desktop (`≥ md`)**: split-screen 50/50 — lista à esquerda, teclado+display à direita.

### Componentes puros (`src/components/auth/`)

Todos recebem dados/handlers via props; nenhum toca infraestrutura.

1. **`EmployeeSearch.tsx`** — props `value`, `onChange`; `placeholder={SEARCH_PLACEHOLDER}`; foco automático.
2. **`EmployeeList.tsx`** — props `employees`, `selectedId`, `onSelect`; cartões `min-touch`; selecionado em `--primary`.
3. **`NumericKeypad.tsx`** — props `onDigit`, `onBackspace`, `disabled`; grid 3×4 (`1 2 3 / 4 5 6 / 7 8 9 / ← 0`); botões ≥ `KEYPAD_BUTTON_MIN_PX`; usa `<button>` (jamais aciona teclado nativo). Feedback tátil disparado pelo hook.
4. **`PinDisplay.tsx`** — props `length`, `filled`, `hasError`; círculos + `animate-shake`.
5. **`LoginError.tsx`** — props `message`; `aria-live="polite"`, cor `--destructive`.
6. **`VerifyingOverlay.tsx`** — props `visible`; `fixed inset-0 z-50 bg-background/70 backdrop-blur-sm`, spinner `Loader2` em `--primary`, texto `VERIFYING_MESSAGE`, `role="status" aria-live="assertive"`, bloqueia pointer-events.

### Busca case-insensitive resiliente (aplicada no hook)

Independe de `citext`/`text`/`varchar`:

```ts
const normalize = (s: string) =>
  s.toLocaleLowerCase(LOCALE_PT_BR).normalize('NFD').replace(/\p{Diacritic}/gu, '');
```

### Query com ordenação determinística (em `useEmployeeQuery`)

```ts
supabase
  .from('funcionarios')
  .select('id, apelido, nome, cargo')
  .eq('is_active', true)
  .order('apelido', { ascending: true })
  .order('nome',    { ascending: true });
```

### Hooks (`src/hooks/`)

- **`useEmployeeQuery.ts`** — TanStack Query, `queryKey: EMPLOYEES_QUERY_KEY`, retorna `Employee[]` tipado.
- **`useLogin.ts`** — máquina de estados:
  ```text
  selecting → entering-pin → verifying → success  (→ ROUTES.DASHBOARD, HapticService.vibrate('success'))
                                      ↘ failure (→ shake, clear PIN, HapticService.vibrate('error'))
  ```
  - `pin.length === PIN_LENGTH` → chama `verifyPin(apelido, pin)` **uma única vez**; overlay bloqueia UI.
  - Listeners `visibilitychange` + `window.blur` limpam PIN parcial imediatamente.
  - Cada dígito dispara `HapticService.vibrate('tap')`.
  - Sucesso → `AuthSession.save(...)` → `navigate({ to: ROUTES.DASHBOARD, replace: true })`.
  - Falha → `clearPin()`, `hasError=true` por `PIN_SHAKE_DURATION_MS`, funcionário mantido.

Se algum arquivo se aproximar de ~200 linhas, extraio responsabilidades para utilitários locais.

### Haptic Service (`src/lib/haptic-service.ts`)

```ts
export type HapticPattern = 'tap' | 'success' | 'error';
export const HapticService = {
  vibrate(pattern: HapticPattern = 'tap'): void { /* consome constantes; no-op se indisponível */ },
};
```

## 7. AuthSession — arquitetura desacoplada (`src/lib/session.ts`)

**Nota de arquitetura (Fase 1)**: `sessionStorage` é decisão de infraestrutura desta fase. Componentes e hooks consomem exclusivamente `AuthSession`. A Fase 2 pode migrar para sessão validada no servidor (cookie httpOnly, JWT, etc.) **sem alterar componentes visuais**.

API pública estável:

```ts
export interface AuthSessionData {
  funcionario_id: string;
  nome: string;
  cargo: string;
  timestamp_login: string; // ISO
}

export const AuthSession = {
  get(): AuthSessionData | null,
  save(data: AuthSessionData): void,
  clear(): void,
  isAuthenticated(): boolean,   // guards de rota consomem isso, sem checar null
};
```

Implementação Fase 1: `sessionStorage` via `SESSION_STORAGE_KEY`, SSR-safe (`typeof window !== 'undefined'`). Sem Context Provider, sem `subscribe`. Helper `formatManaus(date)` usa `MANAUS_TIMEZONE` + `LOCALE_PT_BR`.

## 8. Dashboard Temporário (`ROUTES.DASHBOARD`)

- `src/routes/dashboard.tsx` — em `useEffect`, se `!AuthSession.isAuthenticated()` → `navigate({ to: ROUTES.LOGIN, replace: true })`.
- Conteúdo:
  - Headline: **"Bem-vindo, {nome}"**
  - Subtítulo: **{cargo}**
  - Sutil: **"Sessão iniciada em {formatManaus(timestamp_login)}"**
  - Botão **"Sair"** em `--destructive`, `min-touch` → `AuthSession.clear()` → `ROUTES.LOGIN`.

## 9. Arquivos criados/alterados

**Criados**
- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts` (usa gerados se existirem; caso contrário, contrato local + guard)
- `src/config/routes.ts`
- `src/config/constants.ts`
- `src/components/auth/EmployeeSearch.tsx`
- `src/components/auth/EmployeeList.tsx`
- `src/components/auth/NumericKeypad.tsx`
- `src/components/auth/PinDisplay.tsx`
- `src/components/auth/LoginError.tsx`
- `src/components/auth/VerifyingOverlay.tsx`
- `src/hooks/useLogin.ts`
- `src/hooks/useEmployeeQuery.ts`
- `src/lib/session.ts` (`AuthSession` + `formatManaus`)
- `src/lib/haptic-service.ts`
- `src/routes/dashboard.tsx`

**Alterados**
- `src/styles.css` — paleta Benvisi + `--success`/`--warning`/`--info`, tokens, utilitários.
- `src/routes/__root.tsx` — `<link>` Inter, metadata Benvisi.
- `src/routes/index.tsx` — Tela de Login (remove placeholder).
- `package.json` — `@supabase/supabase-js`.

## 10. Validação após build

- `/` renderiza lista+busca (mobile) e split-screen (desktop).
- Filtro funciona com/sem acento, ignorando caixa.
- Digitar 4 dígitos → overlay "Validando PIN..." → **uma única** chamada RPC.
- Sucesso → sessão em `sessionStorage`, redireciona `ROUTES.DASHBOARD`.
- Falha → shake + PIN limpo + funcionário mantido + haptic erro.
- Sair da aba/minimizar → PIN parcial desaparece.
- `/dashboard` sem sessão → volta para `ROUTES.LOGIN` (via `AuthSession.isAuthenticated()`).
- Sair no dashboard → limpa sessão, volta para `ROUTES.LOGIN`.
- Fechar aba e reabrir → sessão perdida (esperado do `sessionStorage`).
- Grep confirma: nenhum componente em `src/components/auth/` importa `@/integrations/supabase/*` ou toca `sessionStorage`/`navigator.vibrate`.
- Grep confirma: nenhum literal `'/'`/`'/dashboard'` ou número mágico fora de `src/config/`.

## 11. Definition of Done

O módulo é considerado concluído **apenas quando**:
1. **Zero** erros de compilação/tipagem TypeScript.
2. **Zero** warnings críticos do ESLint.
3. Build de produção compila sem falhas.
4. Fluxo completo de login e proteção de rotas funciona em mobile e desktop (validado via preview em ambos viewports).
5. **Todos** os itens da seção "Validação após build" testados e aprovados.

## 12. Refatoração pós-build

Após o fluxo estar funcional, faço uma passagem final de revisão:
- Simplificar lógicas condicionais complexas.
- Remover duplicações remanescentes.
- Extrair utilitários repetidos.
- Garantir nomes descritivos e legíveis.
- Confirmar aderência a todas as restrições da seção "Padrões Transversais".

## 13. O que preciso de você para começar

- **Chave publishable/anon** do Supabase via formulário seguro (`add_secret`). Nada mais.
