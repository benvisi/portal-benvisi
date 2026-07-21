# Portal Benvisi
## Milestone: Foundation Complete
**Date:** 2026-07-21  
**Branch:** `feature/terms-dashboard`  
**Status:** 🟢 Ready for Migration Review & Application

---

# Executive Summary

Portal Benvisi is an internal operational platform for Benvisi retail stores.

Employees authenticate with a **4-digit PIN**, acknowledge the current Terms of Use once per version, and access operational modules such as:

- Início de Turno
- Atendimento & Vendas
- Consulta de Estoque
- Logística & Tarefas
- Painel Administrativo (Administrators only)

> **Important**
>
> Portal Benvisi is **NOT** an attendance or payroll system.
>
> It records operational readiness only.
>
> There is:
>
> - ❌ no clock-out
> - ❌ no hours worked
> - ❌ no payroll calculations
> - ❌ no lateness tracking

---

# Technology Stack

| Layer | Technology |
|--------|------------|
| Frontend | React 19 + TanStack Start |
| Routing | TanStack Router |
| Data | TanStack Query |
| UI | Tailwind CSS v4 + shadcn/ui |
| Backend | Supabase Postgres |
| Authentication | Custom PIN RPC |
| Deployment | Nitro (Cloudflare / Vercel compatible) |

---

# Current Application Flow

```text
Employee

      │

      ▼

4-digit PIN

      │

      ▼

verify_pin()

      │

      ▼

session token

      │

      ▼

Terms (if needed)

      │

      ▼

Dashboard

      │

      ├── Início de Turno
      ├── Atendimento
      ├── Estoque
      ├── Operações
      └── Administrativo
```

---

# Authentication Architecture

## Why not Supabase Auth?

Portal Benvisi employees do not use email/password accounts.

Authentication is intentionally based on:

- employee selection
- 4-digit PIN
- server-side validation

No JWTs.

No cookies.

No Supabase Auth.

---

## Session Model

After successful login:

```
verify_pin()

↓

creates opaque token

↓

stores SHA-256 hash

↓

returns raw token once

↓

browser stores token in sessionStorage
```

Every protected RPC receives:

```
session_token
```

—not—

```
employee_id
```

The backend always determines employee identity itself.

This prevents impersonation attacks.

---

# Database

## Existing Tables

### funcionarios

Employee master table.

Important fields:

- id
- nome
- cargo
- token_pin
- is_active

---

### turno_presenca

Records operational shift start.

One row per employee per Manaus calendar day.

Used only for:

> "Atividades iniciadas"

Never payroll.

---

### termos_aceite

Stores acceptance history.

One row:

Employee × Terms Version

---

### sessoes_funcionario (new)

Stores hashed session tokens.

Features:

- SHA-256 hash
- 12-hour expiry
- revoke support
- multiple concurrent sessions

---

# Security Principles

The backend owns identity.

The browser never tells the server:

> "I am employee X."

Instead it says:

> "Here is my session token."

The backend validates:

- session exists
- not revoked
- not expired
- employee active

Only then is employee identity resolved.

---

# Completed Features

## Authentication

✅ PIN validation

✅ Session tokens

✅ Session revocation

---

## Terms

✅ Versioned terms

✅ Acceptance tracking

✅ Skip once accepted

---

## Dashboard

✅ Manaus greeting

✅ Logout

✅ Administrator visibility

---

## Início de Turno

✅ Uses existing turno_presenca

✅ One start per Manaus day

✅ No timestamps shown

---

# Database Improvements

Implemented:

- duplicate protection
- fail-safe migration checks
- session hashing
- unique shift-per-day enforcement
- unique terms-per-version enforcement

---

# Migrations

Apply in this order:

```
001

↓

002

↓

003
```

None have been applied yet.

---

# Browser Test Checklist

After migrations:

- [ ] Login succeeds
- [ ] Session persists refresh
- [ ] Terms appear only when required
- [ ] Dashboard loads
- [ ] Iniciar atividades works
- [ ] Refresh keeps shift started
- [ ] Logout revokes session
- [ ] Invalid session redirects to login

---

# Remaining Work

Current placeholders:

- Atendimento
- Estoque
- Operações
- Administrativo

Only Início de Turno is fully functional.

---

# Important Conventions

## Naming

Database:

Portuguese

```
funcionarios

termos_aceite

id_funcionario
```

RPCs:

English

```
verify_pin()

issue_employee_session()
```

Keep this convention.

---

## Hard Rules

Never:

- trust employee IDs from the browser
- recreate `inicio_turno`
- build payroll logic
- guess SQL function bodies
- apply migrations without approval
- commit or deploy without approval

---

# Files Added

## Migrations

```
20260722_001_add_employee_sessions_and_verify_pin_token.sql

20260722_002_add_termo_acceptance_rpcs.sql

20260722_003_add_turno_presenca_rpcs.sql
```

## Frontend

```
routes/termos.tsx

hooks/useShiftStart.ts

hooks/useSignOut.ts

hooks/useTermos.ts

hooks/useRequireSession.ts

...
```

---

# Next Milestone

After successful migration:

1. Complete browser validation

2. Begin building:

- Atendimento
- Consulta de Estoque
- Operações

3. Implement first real administrator-only feature

---

**Milestone Status**

🟢 Foundation complete.

Ready to transition from infrastructure work to feature development.