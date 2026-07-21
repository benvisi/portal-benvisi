# Portal Benvisi

Portal Benvisi is an internal retail operations platform for Benvisi's retail stores.

## Technology Stack

- React
- TypeScript
- TanStack Start
- TanStack Router
- TanStack Query
- Vite
- Tailwind CSS
- Supabase
- GitHub
- Vercel

## Primary Goals

Maintain a clean, secure, production-quality codebase.

Favor maintainability over cleverness.

Avoid unnecessary abstractions.

## Language

- Source code: English
- Comments: English
- Employee-facing UI: Brazilian Portuguese

## Security Rules

Never expose employee PINs.

Never log PINs.

Never weaken RLS policies.

Never expose Supabase service_role keys.

Browser code may only use the publishable/anon key.

Employee roles (cargo) always come from the database.

Never trust client-submitted authorization.

## Database Rules

Every schema change must have a migration.

Never modify production data without explicit approval.

Prefer RPCs over exposing tables directly.

## Coding Standards

Prefer existing project patterns.

Keep components small.

Avoid duplication.

Prefer explicit typing.

Do not introduce unnecessary dependencies.

## Git Rules

Never commit automatically.

Never push automatically.

Never merge automatically.

Never rewrite Git history.

Always explain proposed changes before applying them.

## Before Completing Any Task

Run:

- build
- lint
- type-check (if available)

Report:

- files changed
- reasoning
- potential risks