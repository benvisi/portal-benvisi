## Plano: Configurar variáveis de ambiente do Supabase

Sim, entendi perfeitamente. Vou mover as credenciais do Supabase para o ambiente seguro do projeto, mantendo o `client.ts` dinâmico (lendo de `import.meta.env`), sem valores hardcoded.

### Ações

1. **Registrar as variáveis no ambiente do projeto** via `secrets--set_secret`:
   - `VITE_SUPABASE_URL` = `https://ugfogsseikupsfqqznzi.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `eyJhbGciOi...JF2w` (a chave publishable/anon que você forneceu)

   Como são variáveis com prefixo `VITE_`, elas são injetadas no build pelo Vite e ficam disponíveis via `import.meta.env.VITE_*` — exatamente como o `src/integrations/supabase/client.ts` já espera.

2. **Verificar `client.ts`** — confirmar que continua lendo dinamicamente de `import.meta.env.VITE_SUPABASE_URL` e `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`, sem fallback hardcoded. Nenhuma edição de código deve ser necessária; se houver qualquer literal remanescente da chave, será removido.

3. **Validar** que o preview recarrega e o login continua conectando ao Supabase (RPC `verify_pin` acessível).

### Observações de segurança

- A `VITE_SUPABASE_PUBLISHABLE_KEY` é uma chave `anon` publishable, projetada para ser exposta ao cliente e protegida por RLS no banco — isso é seguro por design do Supabase.
- Nenhum segredo sensível (service role, token_pin, etc.) é tocado.
- Nada será commitado em `.env` no repositório; o armazenamento é gerenciado pelo ambiente do projeto Lovable.
