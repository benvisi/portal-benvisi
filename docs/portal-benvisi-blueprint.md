# Portal Benvisi Blueprint

**Version:** 0.1  
**Status:** Draft / Living Document  
**Last updated:** 2026-08-19  
**Owner:** Benvisi Comércio de Confecções Ltda.  
**Current deployment context:** Lacoste franchise operation — Manauara Shopping, Manaus, Amazonas, Brazil

---

# 0. How to Use This Document

## 0.1 Purpose

This document is the authoritative product and architecture reference for Portal Benvisi.

It exists to preserve:

- approved business rules;
- product and UX principles;
- architectural constraints;
- implemented functionality;
- current priorities;
- future roadmap ideas;
- the reasoning behind important decisions.

It is intended for three audiences:

1. **Product owner / business leadership** — to preserve decisions and rationale.
2. **Implementation agents and developers** — especially Claude Code — to reduce repeated prompting and avoid re-litigating settled decisions.
3. **Future maintainers** — to understand what Portal Benvisi is, why it works the way it does, and which behaviors are intentional.

This document should describe product behavior and architectural invariants without duplicating implementation details that are easily discoverable from the repository.

Source code, migrations, and runtime behavior remain authoritative for the **currently implemented technical state**.

If this Blueprint and the implementation appear to conflict, do not silently change either one. Identify the discrepancy and request clarification when it could materially affect business behavior, security, data integrity, employee workflow, reporting, or backward compatibility.

## 0.2 Status Labels

- **IMPLEMENTED** — exists in the codebase and has been tested or otherwise validated.
- **APPROVED** — product or architecture decision is settled; implementation may still be pending.
- **FUTURE** — retained for the roadmap but not part of current MVP scope.
- **OPEN** — a meaningful decision still requires resolution.

---

# 1. Product Vision

## 1.1 Purpose

Portal Benvisi is the internal operational platform for Benvisi Comércio de Confecções Ltda.

Its purpose is to simplify retail operations, improve customer service, increase sales productivity, improve consistency, and generate useful operational intelligence without creating unnecessary administrative burden for store employees.

Portal Benvisi is not intended to replace the ERP. The ERP remains the transactional system of record.

Portal Benvisi is the operational layer that connects employees, store processes, management rules, operational data, ERP/POS information, and future training, communication, and intelligence tools.

## 1.2 Vision

Portal Benvisi should become the first operational tool employees open when beginning their workday and a natural companion throughout the day.

It should feel like a helpful retail assistant rather than an administrative system.

Every feature should contribute meaningfully to one or more of the following:

- improve the customer experience;
- increase sales productivity and conversion;
- improve operational consistency;
- reduce employee friction;
- improve inventory visibility;
- produce useful, trustworthy operational data;
- support coaching and management decisions;
- improve employee engagement.

## 1.3 Long-Term Direction

Portal Benvisi is being designed as a platform rather than a collection of isolated utilities.

The first deployment supports a single Lacoste franchise location, but the architecture should avoid assumptions that would make future expansion unnecessarily difficult.

Potential long-term expansion may include multiple stores, multiple brands, additional operational workflows, knowledge management, employee training, AI-assisted coaching, inventory intelligence, internal communication, employee suggestions and voting, customer communication tools, richer analytics, and deeper ERP/POS integration.

---

# 2. Business Context

## 2.1 Company and Store

Portal Benvisi is currently being developed for **Benvisi Comércio de Confecções Ltda.**

Initial deployment context:

- Brand: Lacoste
- Store: Manauara Shopping
- City: Manaus
- State: Amazonas
- Country: Brazil

The store is a high-volume premium retail environment in which sales-floor speed and customer experience are more important than perfect administrative neatness.

## 2.2 Existing Technology Environment

Portal Benvisi complements existing business systems.

Current ecosystem includes:

- Linx ERP / POS environment;
- Microsoft SQL Server on-premises;
- Supabase / PostgreSQL;
- React;
- TypeScript;
- Vite;
- TanStack Query;
- Power BI;
- Python automation;
- GitHub;
- Vercel as the intended web-hosting platform.

Portal Benvisi should integrate with existing systems rather than unnecessarily duplicate them.

## 2.3 Primary Users

Initial user groups include:

- sales associates / vendedores;
- managers;
- administrators.

Future user groups may include operations, regional management, HR, franchise ownership, specialized support roles, and AI assistants acting within explicitly defined permissions.

---

# 3. Product and UX Principles

## 3.1 Customer First

Customer service takes priority over internal process.

The application must not create unnecessary interruptions while an employee is assisting a customer.

When a trade-off exists between perfect data capture and the quality of the customer interaction, the customer interaction generally wins.

## 3.2 Mobile First

Portal Benvisi is primarily designed for employees using phones on the sales floor.

Desktop support is important, but secondary for employee-facing workflows.

Common actions should be easy to perform quickly, with minimal typing and unnecessary navigation.

## 3.3 Speed Matters

Every unnecessary tap, confirmation, or field reduces adoption.

Common workflows should require the minimum reasonable number of interactions.

The application should never feel slower than the manual workaround it replaces.

## 3.4 Guide Instead of Police

Portal Benvisi should encourage good operational behavior rather than impose rigid restrictions whenever flexibility is operationally safe.

Example: Lista da Vez indicates who should normally serve the next customer, but it must not prevent another salesperson from starting an atendimento when the real-world situation requires it.

The application may warn, confirm, record, and report. It should avoid blocking legitimate retail activity unless the business rule truly requires a hard restriction.

## 3.5 Record Data After the Selling Moment

Selling comes first.

Whenever practical, administrative recording should occur after the customer interaction rather than during it.

For Atendimento, customer outcomes are recorded at closing rather than requiring the salesperson to manipulate the application repeatedly while actively serving customers.

## 3.6 Simple on the Surface

Portal Benvisi may contain sophisticated logic behind the scenes. Employees should not have to understand that complexity.

Complexity belongs in backend rules, database constraints, RPC transactions, and automated inference.

## 3.7 Do Not Ask for What the System Can Infer

The application should not require employees to manually provide information that can be derived reliably from authenticated session, current time/date, existing system state, ERP/POS data, queue state, or configuration.

## 3.8 Collect Data With Purpose

Required fields must have a clear operational, coaching, analytical, or compliance purpose.

## 3.9 Resilient to Human Mistakes

The system should expect accidental taps, interrupted workflows, navigation away from a page, device refreshes, and similar real-world behavior.

Where feasible, mistakes should be recoverable without corrupting operational metrics.

## 3.10 Coaching Over Punishment

Operational data should primarily help the company understand behavior, improve processes, and coach employees.

Portal Benvisi should not be designed as a surveillance or punishment system.

---

# 4. Technical Architecture

## 4.1 Current Stack

### Frontend

- React
- TypeScript
- Vite
- TanStack Query

### Backend / Database

- Supabase
- PostgreSQL
- PostgreSQL RPC functions

### Deployment / Infrastructure

- GitHub for version control
- Vercel as target web deployment
- SQL Server / Linx remains the ERP/POS source for relevant business data
- Python and SQL-based synchronization/automation may be used where appropriate

## 4.2 Development Workflow

### APPROVED

Primary working model:

- **ChatGPT** — product design, UX, business rules, architecture discussion, review of difficult trade-offs, documentation.
- **VS Code** — primary editor and local development environment.
- **Claude Code** — primary implementation agent.
- **GitHub** — source control and milestone history.

Claude Code should increasingly work from this Blueprint plus the repository itself rather than receiving large repeated prompts.

Preferred workflow:

1. make product/business decision;
2. add durable decision to this Blueprint when appropriate;
3. Claude Code reads the Blueprint and repository;
4. Claude implements an approved milestone;
5. build/typecheck/tests run as appropriate;
6. product owner performs browser validation;
7. bugs are corrected;
8. successful milestone is committed and pushed.

Use a dedicated feature branch per epic or substantial feature.

## 4.3 Lovable

### HISTORICAL / NOT PRIMARY WORKFLOW

Lovable was used during early prototyping.

It is not currently the preferred implementation workflow for core Portal Benvisi development.

Rapid prototyping tools may be considered later for low-risk UI/CRUD modules, but core business logic should preserve Portal Benvisi architecture and security conventions.

## 4.4 Environments — Test/Demo Data vs Production

### APPROVED

Portal Benvisi is **not yet** declared operational production. The current Supabase project contains development/demo/test data and is currently the only database (a longer-term separate dev/test vs production Supabase environment split remains advisable, but is not required before merging Epic 2).

- `main` means stable/approved code — merging a feature branch into `main` is a code-readiness signal, not an operational rollout decision;
- the current environment may continue to be used for product demos and controlled exploration after a merge;
- transactional test/demo data will be cleaned in a deliberate pre-production cleanup pass before real operational launch — no cleanup tooling exists or is scoped yet, and none should be built speculatively ahead of that decision.

---

# 5. Security and Trust Model

## 5.1 Core Principle

### IMPLEMENTED

The client must not be treated as a trusted source of employee identity.

Authenticated server operations derive employee identity from an opaque session token.

A client-supplied employee UUID must never be accepted as authoritative authenticated identity for privileged actions.

## 5.2 Authentication Model

### IMPLEMENTED

Portal Benvisi uses custom employee authentication rather than Supabase Auth.

Existing login architecture includes active employee listing, PIN verification, opaque employee session token, server-side session validation, session expiration/revocation handling, and employee context resolution on the backend.

## 5.3 SECURITY DEFINER RPC Pattern

### IMPLEMENTED / ARCHITECTURAL STANDARD

Sensitive database operations should be exposed through controlled RPCs rather than direct client table access.

Privileged RPCs should:

1. accept the opaque session token;
2. resolve the employee server-side;
3. verify required role/business conditions;
4. execute the business transaction;
5. return only the data required by the client.

RLS should remain enabled where applicable.

## 5.4 Responsible Employee vs Authenticated Actor

### APPROVED

Portal Benvisi must distinguish between:

- **Responsible employee / subject** — the employee whose operational record is being affected;
- **Authenticated actor** — the logged-in employee who actually performed the system action.

This distinction applies whenever an action may legitimately be performed on behalf of another employee.

Rules:

- the authenticated actor identity must never be accepted from the client as authoritative;
- the authenticated actor must always be resolved server-side from the opaque authenticated session;
- when the client supplies a target employee, that employee must be validated server-side against the rules of the requested action;
- permissions and restrictions must be evaluated against the authenticated actor;
- the operational record continues to belong to the responsible employee;
- where relevant for auditability, security, or future analysis, the system must preserve who actually performed the action;
- delegated workflows must not require impersonation, login switching, or session switching.

Example:

```text
Responsible employee: Ana
Authenticated actor: Bruno
Action: iniciar Atendimento
```

This is a reusable Portal Benvisi architecture principle and is not limited to Atendimento.

---

# 6. Users, Roles and Permissions

## 6.1 Employees

Employee records currently include concepts such as employee ID, name, nickname, email, PIN/token field, role, and active/inactive status.

## 6.2 Role-Aware UI

### IMPLEMENTED

The dashboard adapts to the employee's role. Administrative functionality is not presented in the same way to every employee.

## 6.3 Permission Principle

### APPROVED

Role restrictions that matter for security or business integrity must be enforced on the backend.

Hiding a button is UX, not authorization.

---

# 7. Core Application Foundation

## 7.1 Login

### IMPLEMENTED

Login flow:

1. employee selects their name;
2. employee enters PIN;
3. backend verifies PIN;
4. backend creates/returns an opaque employee session;
5. frontend stores session information for the browser session;
6. privileged operations use the opaque token.

## 7.2 Employee Session

### IMPLEMENTED

The application uses an opaque session-token architecture.

Session-related errors should be handled consistently across data hooks.

## 7.3 Termo de Ciência / Acceptance

### IMPLEMENTED

Terms acceptance is mandatory, versioned, recorded per employee, and intended to be accepted once per applicable version.

## 7.4 Iniciar Atividades

### IMPLEMENTED

Portal Benvisi includes an **Iniciar atividades** concept backed by `turno_presenca`.

Purpose:

- indicate operational readiness for the day;
- serve as a prerequisite for certain operational modules.

It is **not** intended to become payroll attendance, a legal time clock, punch-in/punch-out, or a replacement for HR timekeeping.

The dashboard changes from a start CTA to a completed/ready state once activities have been started.

There is no employee-facing **Encerrar turno** requirement in the current design.

### APPROVED

Atendimento must enforce Iniciar atividades server-side before a new atendimento can begin.

## 7.5 Dashboard

### IMPLEMENTED

The dashboard is the employee's main operational landing page.

Known behavior includes:

- greeting based on Manaus local time;
- employee-specific greeting;
- role-aware module presentation;
- Iniciar atividades card/status;
- placeholder treatment for modules still in development.

---

# 8. Atendimento

## 8.1 Status

### APPROVED — CURRENT EPIC

Atendimento is the current primary development epic.

## 8.2 Purpose

Atendimento tracks a salesperson's continuous customer-service interaction.

One Atendimento session may contain **multiple customers**.

Customer outcomes are recorded only when the Atendimento is being closed.

## 8.3 One Active Atendimento per Salesperson

### APPROVED

A salesperson may have only one active Atendimento session at a time.

This rule must be enforced at the database/backend level.

Different salespeople may have simultaneous active atendimentos.

## 8.4 Prerequisite: Iniciar Atividades

### APPROVED

An employee must have started activities for the current Manaus business day before starting a new Atendimento.

## 8.5 Lista da Vez

Lista da Vez provides a fair, visible guide to the order in which available salespeople should normally receive the next customer.

It is guidance, not a hard permission system.

### 8.5.1 Advisory, Not Blocking

### APPROVED

A salesperson may start an Atendimento even if they are not currently first in the Lista da Vez.

If they are not first, show a confirmation such as:

> Você não é o próximo da Lista da Vez.  
> Deseja iniciar este atendimento mesmo assim?

Buttons:

- Iniciar atendimento
- Cancelar

No reason is required for an out-of-turn start in the MVP.

Record whether the Atendimento began in queue order or out of queue order.

### 8.5.2 Queue Example

### APPROVED

Initial state:

1. Ana
2. Bruno
3. Carla

Bruno starts out of turn.

While Bruno is serving:

1. Ana
2. Carla

Bruno — Em atendimento

If Bruno cancels the accidental start within the 20-second grace period:

1. Ana
2. Bruno
3. Carla

If Bruno completes the Atendimento:

1. Ana
2. Carla
3. Bruno

The original first person keeps priority.

### 8.5.3 Simultaneous Atendimento

### APPROVED

Multiple employees may have active Atendimentos simultaneously.

When an employee begins an Atendimento, they are removed from the currently available Lista da Vez and shown as **Em atendimento**.

When an employee completes an Atendimento, they immediately return to the **back of the currently available queue**.

When multiple employees are simultaneously serving customers, their relative return order is determined by the order in which their Atendimentos are **completed**, not the order in which they began.

Example:

Initial state:

1. Ana
2. Bruno
3. Carla

Bruno begins an Atendimento out of turn.

Ana then begins an Atendimento.

Available queue:

1. Carla

Active:

- Ana — Em atendimento
- Bruno — Em atendimento

If Ana completes first:

1. Carla
2. Ana

Bruno remains **Em atendimento**.

When Bruno later completes:

1. Carla
2. Ana
3. Bruno

If Bruno had completed before Ana, the resulting order would instead be:

1. Carla
2. Bruno
3. Ana

This behavior must remain correct when starts and completions occur close together or concurrently.


### 8.5.4 Queue Persistence Model

### APPROVED

Lista da Vez will use a **persistent queue-state table**.

The database should explicitly preserve the current ordering/state of employees participating in the queue rather than reconstructing the active queue exclusively from Atendimento history.

The queue must be updated transactionally when an employee:

- begins an Atendimento;
- cancels an accidental start during the 20-second provisional window;
- completes an Atendimento;
- returns to the available queue.

An accidental cancellation during the 20-second grace period must restore the employee to the same queue position they occupied immediately before starting the provisional Atendimento.

A legitimately completed Atendimento moves the employee to the back of the currently available queue.

The implementation must protect against:

- duplicate queue membership;
- position drift;
- inconsistent ordering;
- simultaneous starts;
- simultaneous completions;
- partial queue updates if an Atendimento transaction fails.

The exact table name, columns, indexing strategy, and transactional implementation are technical implementation decisions for the developer, provided the approved queue behavior is preserved.

### 8.5.5 Role-Based Queue Participation

### APPROVED — Epic 2 Stabilization

Whether Iniciar Atividades automatically enters an employee into Lista da Vez depends on cargo:

- **Vendedor** — Iniciar Atividades auto-enters Lista da Vez, unchanged since Milestone 1.
- **Gerente** — Iniciar Atividades records operational readiness only; it does **not** auto-enter Lista da Vez. A Gerente may still manually **Entrar na Lista da Vez** afterward (normal back-of-queue behavior, same action Vendedor already uses to rejoin after voluntarily leaving), and keeps **Sair da Lista da Vez**, re-entry, and every existing delegated/management action.
- **Administrador** — does not personally participate in Lista da Vez at all, neither automatically nor manually. The Administrador's role in Atendimento is observation and management: viewing Lista da Vez, delegating a start on behalf of an eligible employee, removing an available employee, and administering checklist policy — never personally starting, joining, or being expected to join the selling rotation.

This is a fixed cargo rule, not a configurable setting — see "Future — Configurable Gerente Auto-Join" below for a possible later refinement that would not change this section's Administrador behavior.

### 8.5.6 Administrador Atendimento UX

### APPROVED — Epic 2 Stabilization

Because the Administrador does not personally participate in Lista da Vez, the Atendimento page must not show them personal participation prompts: no "Iniciar atividades" requirement framed as blocking their own Atendimento, no personal "Iniciar atendimento" button, and no personal Sair/Entrar na Lista da Vez controls. Lista da Vez itself, and every existing management action already authorized for Administrador (delegated start, removal, checklist policy administration), remain fully visible and functional.

## 8.6 Starting an Atendimento

### APPROVED

When the user presses **Iniciar atendimento**:

1. validate opaque session;
2. resolve employee identity;
3. confirm today's activities were started;
4. verify no existing active/pending Atendimento;
5. determine whether start is in or out of queue order;
6. if out of turn, frontend confirmation is required;
7. a provisional Atendimento begins.

### 8.6.1 Starting an Atendimento on Behalf of Another Employee

### APPROVED

An authenticated employee may initiate an Atendimento on behalf of another employee who is currently available in Lista da Vez.

Purpose: support a common sales-floor situation in which the responsible salesperson has already begun assisting a customer but forgot, or did not have time, to start the Atendimento timer in Portal Benvisi.

Rules:

- the target employee must already have completed **Iniciar atividades** for the current Manaus business day;
- the target employee must currently be available in Lista da Vez;
- the Atendimento belongs to the **target employee**, not to the authenticated employee who performed the system action;
- the initiating employee's own queue position and state remain unchanged;
- normal Lista da Vez rules continue to apply to the target employee;
- if the target employee is not currently first among available employees, the normal out-of-turn warning and confirmation must still apply;
- no impersonation, login switching, or session switching is permitted;
- the backend must preserve both the responsible employee and the authenticated actor who initiated the Atendimento.

Example:

```text
Responsible salesperson: Ana
Atendimento initiated by: Bruno
```

In most Atendimentos, the responsible employee and authenticated actor will be the same person.

### 8.6.2 Auditability of Atendimento Lifecycle Actions

### APPROVED

Atendimento records and/or related audit records must preserve authorship of significant lifecycle actions whenever the authenticated actor may differ from the employee responsible for the Atendimento.

The architecture must support, at minimum:

- the employee responsible for the Atendimento;
- the employee who initiated the Atendimento;
- whether the Atendimento was started out of turn, when applicable;
- in future privileged workflows, the authorized employee who performed an administrative intervention;
- in future privileged workflows, the authorized employee who finalized an Atendimento on behalf of the responsible employee.

This Blueprint does not prescribe the exact physical persistence model.

Implementation may use:

- dedicated columns on the Atendimento record;
- an event/audit table;
- or another appropriate relational model.

The chosen model must preserve:

- historical integrity;
- traceability;
- future queryability;
- clear separation between the employee receiving operational attribution for the Atendimento and the actor who performed the system action.

## 8.7 20-Second Accidental-Start Grace Period

### APPROVED

Starting an Atendimento creates a 20-second provisional period.

The purpose of this period is to provide an **undo window for an accidental start**.

It is **not** a minimum Atendimento duration.

During the first 20 seconds, the employee may choose either:

- **Cancelar início**
- **Concluir atendimento**

If the employee selects **Cancelar início** within the grace period:

- the Atendimento is treated as an accidental start;
- conversion metrics are unaffected;
- queue state is restored exactly;
- the employee returns to the same Lista da Vez position they occupied immediately before starting the provisional Atendimento.

If the employee selects **Concluir atendimento** within the grace period:

- the Atendimento is treated as a legitimate Atendimento;
- the normal closing flow begins immediately;
- the employee does not need to wait for the 20-second deadline to expire;
- after successful completion, the employee returns to the back of the currently available Lista da Vez.

After the 20-second deadline passes:

- **Cancelar início** is no longer available;
- the Atendimento is official by definition;
- the employee must eventually complete the normal Atendimento closing flow.

### APPROVED ARCHITECTURE

There should not be a required client-side "confirm after 20 seconds" RPC.

The server-defined deadline is authoritative.

A provisional Atendimento whose deadline has elapsed should be treated as official even if the frontend is refreshed, closed, loses connectivity, or never sends another call.

The backend must independently enforce the 20-second cancellation deadline using server/database time.

### 8.7.1 Accidental-Cancellation Action Treatment

### APPROVED UX DIRECTION

During the 20-second accidental-start window, **Concluir atendimento** should remain the primary action.

**Cancelar início** should be visually secondary but clearly distinguishable from normal completion.

A restrained destructive/red accent may be used for **Cancelar início**, for example:

- red/destructive text;
- red/destructive border;
- secondary outlined treatment.

The action should not use an unnecessarily dominant solid-red treatment if that competes with the primary completion action.

Although the cancel action may appear visually smaller or less prominent, it must retain an appropriately sized mobile touch target.

## 8.8 Navigation During an Active Atendimento

### APPROVED

Leaving the Atendimento page does **not** end the Atendimento.

The employee may use **Voltar ao painel** without closing the session.

Returning to Atendimento should resume the existing session.

# 8.9 Shared Active Atendimento Status and Elapsed Time

### APPROVED

Lista da Vez should function not only as an ordering mechanism, but also as a lightweight shared view of who is currently serving customers.

When an employee is in an active Atendimento, every user who can see Lista da Vez should be able to see how long that Atendimento has been in progress.

This is especially useful for:

- managers;
- administrators;
- other sales employees;
- general sales-floor awareness.

The purpose is operational visibility, not surveillance.

## 8.9.1 Active Employee Row

An employee who is currently in Atendimento should remain visible in Lista da Vez but should be visually distinct from employees who are currently available.

The entire row should use a restrained active-state treatment, such as:

- subtle background tint;
- subtle border treatment;
- another consistent semantic cue.

The visual state should make it clear at a glance that the employee is currently serving a customer.

The employee should not display a normal available queue-position number while actively serving.

## 8.9.2 Elapsed Atendimento Time

For each active employee, Lista da Vez should display the elapsed duration of their current Atendimento.

Conceptual example:

`Colaborador Teste 2        ⏱ 12 min`

The elapsed time may replace the separate **Em atendimento** pill if the combination of the active-row visual treatment and timer makes the status sufficiently clear.

For very recent Atendimentos, display:

`< 1 min`

rather than:

`0 min`

After the first minute, display elapsed whole minutes.

Second-by-second precision is not required for the shared Lista da Vez view.

## 8.9.3 Shared Visibility

Elapsed Atendimento time should be visible to all authorized users viewing Lista da Vez, not only to the employee currently handling that Atendimento.

The same server-authoritative Atendimento start time should be used for every viewer.

## 8.9.4 Time Source and Client Updates

The backend should expose the authoritative `iniciado_em` timestamp for an active Atendimento.

Each client may calculate and update the visible elapsed duration locally using that timestamp.

The application should not continuously query Supabase every second merely to increment the displayed timer.

Normal queue/server-state synchronization should continue to determine whether an employee is active, available, or completed.

## 8.9.5 Current Employee's Active Atendimento Card

The current employee's active Atendimento card should focus primarily on actions.

If elapsed duration is already clearly visible in Lista da Vez, the same elapsed-minutes display does not need to be duplicated prominently in the active Atendimento card.

The active card should continue to identify that an Atendimento is in progress and provide the appropriate actions, including:

- **Concluir atendimento**
- **Cancelar início**, during the applicable 20-second accidental-start window.

## 8.9.6 Finalizando Time and Atendimento Duration

### APPROVED — supersedes any earlier description of Finalizando time as always excluded

Time spent in `Finalizando` is excluded from customer-facing Atendimento duration **only when that closing attempt successfully completes the Atendimento**.

If the employee enters `Finalizando` and then chooses **Voltar ao atendimento**, the Atendimento never actually ended — that time counts as ordinary Atendimento time, exactly as if the employee had never opened the closing form.

Example:

- 10:00 — Atendimento starts.
- 10:02 — employee taps **Concluir atendimento**.
- 10:05 — employee taps **Voltar ao atendimento**.
- Displayed duration on return: approximately **5 minutes** (not 2, not `< 1 min`).
- 10:08 — employee taps **Concluir atendimento** again.
- 10:10 — closing submission succeeds.
- Final customer-facing duration: approximately **8 minutes** — the 10:08–10:10 successful closing period is excluded; the earlier 10:02–10:05 abandoned attempt is not.

The original `iniciado_em` and the 20-second accidental-start deadline are never affected by any Finalizando cycle, successful or abandoned.

## 8.10 Customer Recording

### APPROVED

Customers are entered when the Atendimento is being closed.

One Atendimento may contain many customer records.

There is no configured maximum number of customers.

Each customer is independently recorded as converted or not converted.

## 8.11 Non-Conversion Reasons

### APPROVED

A non-converted customer requires a reason.

Examples discussed:

- Produto indisponível;
- Atendimento interrompido;
- Outro.

Some motives require additional explanation.

The detail requirement should be data-driven, not hardcoded only in frontend logic.

Backend validation must enforce mandatory detail when applicable.

## 8.12 Reset / Operational Checklist

### APPROVED

Exactly one reset checklist is associated with an Atendimento.

Purpose: restore the store/sales-floor environment after the interaction.

Closing order:

1. record customers;
2. record conversion/non-conversion outcomes;
3. reset the store;
4. complete checklist;
5. submit;
6. queue updates.

Checklist configuration must support versioning from the beginning.

Checklist editor/admin management is deferred.

### 8.12.1 Checklist Storage Model

### APPROVED

Completed Atendimento checklist responses will use **versioned JSONB storage**.

Each completed checklist must preserve:

- the associated Atendimento;
- the checklist version that was presented;
- the employee's responses;
- the completion timestamp.

The checklist version and recorded responses must remain historically interpretable even if the active checklist changes in the future.

Using JSONB allows checklist items to evolve without requiring a database-schema migration every time the checklist content changes.

The application must validate responses against the applicable checklist version before accepting final Atendimento completion.

Exactly one completed checklist is associated with each Atendimento.

## 8.13 Closing an Atendimento

### APPROVED

Closing should be one coherent business transaction.

Backend should atomically:

- validate active Atendimento;
- persist all customer outcomes;
- validate non-conversion details;
- persist checklist completion;
- mark Atendimento completed;
- return/reposition employee in Lista da Vez.

A partial failure must not leave a half-completed Atendimento.

## 8.14 Previous-Day Pending Atendimento

### APPROVED

If an Atendimento crosses into the next Manaus business day without completion:

- it becomes `pendente_fechamento`;
- it is **not** automatically converted or non-converted;
- timer should no longer continue as if actively occurring.

At next login, show a blocking flow requiring:

**Concluir atendimento**

The employee must complete it before starting another Atendimento.

No employee bypass in MVP.

# 8.15 Positive Reinforcement After Atendimento

### APPROVED

After an Atendimento is successfully completed, Portal Benvisi should provide the employee with a brief positive reinforcement message.

The purpose is to:

- recognize successful sales;
- reinforce good customer-service behavior;
- make repetitive operational data entry feel more rewarding;
- avoid creating a punitive experience around non-converted customers.

This interaction should be lightweight and should not unnecessarily delay the employee from returning to the Lista da Vez or continuing work.

A short toast, card, or brief transition is preferable to a separate mandatory screen.

## 8.15.1 Atendimento With Conversion

If one or more customers within the Atendimento converted, the message should celebrate the successful result.

Tone should be:

- energetic;
- concise;
- positive;
- varied;
- appropriate for a professional retail environment.

Conceptual examples:

> 🎉 Excelente! Mais uma venda concluída.

> 🐊 Mandou bem! Ótimo atendimento.

The final application should draw from a larger approved content library so employees do not repeatedly see the same message.

## 8.15.2 Atendimento Without Conversion

If no customer within the Atendimento converted, the employee should still receive positive encouragement.

A non-converted Atendimento must not automatically be treated as employee failure.

Messages should reinforce:

- quality of service;
- persistence;
- the value of each customer interaction;
- readiness for the next opportunity.

Conceptual examples:

> 💪 Nem todo atendimento vira venda. Continue fazendo um ótimo trabalho.

> 🌟 Cada atendimento é uma nova oportunidade. Vamos para o próximo!

Messages must not:

- shame the employee;
- imply poor performance merely because the customer did not purchase;
- use discouraging or punitive language.

## 8.15.3 Mixed Customer Outcomes

An Atendimento may contain multiple customers with different outcomes.

### APPROVED — supersedes this section's earlier "collapse into converted" wording (see Milestone 2E)

A mixed Atendimento (at least one Convertido **and** at least one Não convertido customer) uses its own dedicated third message category rather than being collapsed into the converted category — see Milestone 2E for the final approved three-category model (converted / non_converted / mixed) and its curated message pools.

The application should not highlight individual non-converted customers in the celebratory feedback.

Detailed conversion results remain available for reporting and coaching separately.

## 8.15.4 Message Variety

### APPROVED

The final application should support a sufficiently large library of short feedback messages.

The system should avoid unnecessary immediate repetition.

The exact content library does not need to live inside this Blueprint and may be maintained separately in application content/configuration.

Emoji may be used when appropriate, but messages should remain concise and professional.

---

# 8.16 Administrator Intervention

### APPROVED DIRECTION — FUTURE

Ordinary employees should not be able to finalize another salesperson's Atendimento.

A future manager/admin assistance capability may allow authorized users to act on another employee's Atendimento.

This must be treated as an exception/assistance workflow rather than the normal closing workflow.

## 8.16.1 Move Another Employee's Atendimento to Finalizando

A future authorized manager/admin action may:

- end the active customer-service phase;
- stop the active customer-facing timer;
- move the Atendimento to `finalizando`;
- keep the Atendimento attributed to the responsible salesperson;
- allow the responsible salesperson to complete the closing information later.

## 8.16.2 Finalize on Behalf of the Responsible Employee

A future authorized manager/admin action may:

- complete the required closing information;
- finalize the Atendimento;
- keep the Atendimento attributed to the responsible salesperson;
- preserve the authenticated actor who actually performed the administrative finalization.

Example:

```text
Responsible salesperson: Ana
Finalized by: Maria (manager)
```

This capability should not be implemented until the complete Atendimento closing flow, including checklist behavior, is stabilized.

Other admin correction, exceptional closure, and pending-Atendimento intervention workflows remain future scope unless specifically approved.

---

# 8.17 Long-Duration Reminder

### FUTURE

A configurable long-duration threshold may later trigger a reminder requiring acknowledgment.

This is distinct from the normal persistent active Atendimento indicator.

Do not add it to the MVP unless specifically approved.

---

# 9. Consulta de Estoque

## 9.1 Status

### APPROVED / PLANNED MODULE

**Consulta de Estoque** is a dedicated employee-facing module.

It is distinct from inventory organization, stock-room management, receiving, and other operational/logistics workflows.

Its purpose is fast product availability lookup while the employee remains focused on serving the customer.

---

## 9.2 Purpose

Consulta de Estoque should allow a salesperson to quickly answer common customer questions such as:

- "Tem esse modelo no meu tamanho?"
- "Tem outro tamanho dessa cor?"
- "Tem esse modelo em outra cor?"
- "Quais tamanhos ainda temos?"
- "Quais outras cores desse produto estão disponíveis?"

The employee should be able to begin with a very specific product and quickly broaden the view without performing a completely new search.

---

## 9.3 Product Hierarchy

### APPROVED

Inventory presentation should recognize that an exact SKU represents a combination of:

- product reference;
- color;
- size.

The application should allow the employee to move between different levels of that hierarchy.

Conceptually:

**Reference**

→ Color

→ Size / exact SKU

An exact barcode or SKU lookup should therefore not restrict the employee to seeing only that individual SKU.

---

## 9.4 Search Inputs

### APPROVED

The module should support fast lookup using:

- exact SKU;
- barcode;
- camera barcode scanning;
- product reference;
- partial product name.

Additional search methods may be added later if they meaningfully improve sales-floor usability.

---

## 9.5 Exact SKU / Barcode Result

### APPROVED

When an employee searches or scans an exact SKU, Portal Benvisi should clearly identify:

- the matching product;
- reference;
- color;
- size;
- current available quantity according to the latest inventory snapshot.

The exact scanned/searched SKU should remain visually identifiable when broader product-family results are displayed.

---

## 9.6 Same Reference + Same Color View

### APPROVED

From an exact SKU result, the employee should be able to immediately see **all sizes available for the same reference and color**.

Example:

**Reference:** PH4012-23  
**Color:** Verde

| Tamanho | Quantidade |
|---|---:|
| PP | 1 |
| P | 2 |
| M | 0 |
| G | 3 |
| GG | 1 |

This view answers the common sales-floor question:

> "Tem essa mesma peça em outro tamanho?"

The employee should not need to perform another search.

---

## 9.7 All Colors View

### APPROVED

The employee should also be able to expand the result to view **all colors available for the same product reference**.

A toggle or similarly simple control is preferred.

Conceptual states might be:

- **Esta cor**
- **Todas as cores**

When viewing all colors, the interface should make both **color and size availability** easy to understand at the same time.

A matrix-style presentation may be appropriate where the product data supports it.

Example:

| Cor | PP | P | M | G | GG |
|---|---:|---:|---:|---:|---:|
| Verde | 1 | 2 | 0 | 3 | 1 |
| Azul | 0 | 1 | 2 | 1 | 0 |
| Branco | 2 | 0 | 1 | 1 | 1 |

The final mobile UX does not have to use a literal table if another presentation is easier to read on a phone.

The product requirement is the ability to understand available **colors and sizes of the same reference** without repeatedly searching.

---

## 9.8 Data Source

### APPROVED

Primary Portal Benvisi inventory source:

`estoque_snapshot`

This table is populated through periodic synchronization from the main ERP/POS environment.

The snapshot should contain or make it possible to derive the data necessary to group products by:

- reference;
- color;
- size;
- SKU;
- barcode;
- product description/name;
- available quantity.

The exact synchronization schema will be defined when this module is implemented.

---

## 9.9 Inventory Freshness

### APPROVED

Portal Benvisi should not imply that inventory data is real-time when the underlying data is periodically synchronized.

Where useful, the UI should communicate inventory freshness in a simple way.

Example:

> Estoque atualizado às 14:32

The freshness indicator should inform the employee without creating visual clutter.

---

## 9.10 Physical Stock Location

### APPROVED — OUT OF SCOPE

Consulta de Estoque will **not** attempt to maintain detailed physical item locations within the sales floor or stock room.

Examples intentionally excluded include:

- rack number;
- shelf number;
- drawer;
- exact stock-room position.

These locations change frequently and would be difficult to maintain with sufficient fidelity.

Low-confidence location information could reduce employee trust in the entire inventory tool.

The priority is reliable availability information rather than potentially stale location information.

---

## 9.11 Availability Presentation

### APPROVED

Availability should be visually easy to understand.

The interface may use semantic status treatments such as:

- green — available;
- yellow — limited availability;
- red — unavailable.

Where quantity information is reliable, actual quantity should also be displayed.

The employee should be able to understand product-family availability within seconds.

---

# 10. Operações / Logística & Tarefas

### PLANNED / PARTIALLY DEFINED — THREE RESOURCES IMPLEMENTED

**Links Importantes**, **Mensagens para WhatsApp**, and **Escala V1** are implemented and QA-passed — see Epic 4, Milestones 4A, 4B, and 4C (section 16.2) for their full scope. Every other workflow below remains unimplemented future/planned scope, distinct from the fast read-only Consulta de Estoque experience (section 9). Sequencing/priority among them is tracked in section 16.2's Epic 4 near-term sequence, not here.

**Operações hub tile order.** Reordered in the Milestone 4C.3 polish tranche, per explicit product-owner approval, to **Escala, Mensagens para WhatsApp, Links Importantes** (previously Links, Mensagens, Escala — where Escala had simply been appended). See Milestone 4C.3 (section 16.2).

**Escala / horários de trabalho — IMPLEMENTED / QA COMPLETE (Milestone 4C, section 16.2)**

- V1: employee-readable schedule — **Dia** (default, whole-team single-date view, sections shown only when applicable: MANHÃ / INTERMEDIÁRIO / TARDE / FOLGA / FÉRIAS / A CONFIRMAR — colour-coded), **Semana** (7 stacked day cards), **Mês** (personal "Minha Escala", each day tappable through to Dia) — all implemented at `/operacoes/escala` (Milestones 4C.2/4C.3), on top of the applied data model/RPCs (Milestone 4C.1). Browser QA is complete and **PASS**. Provisional September 2026 data has been imported to the (production) Supabase project as test data and will be replaced by the real workbook before rollout. Still not done: the real Excel-based publish/import flow (V1.1) — see 16.2 for the full scope boundary;
- V2: shift-swap request + approval + schedule update.

**Organização de estoque**

- sector assignment by employee;
- employee completion confirmation;
- future photo evidence.

**Tarefas operacionais recorrentes**

- training opportunities/reminders;
- CRM-use reminders;
- checklists/tasks for non-sales roles such as Caixa/Gerente.

**Coordenação de manutenção**

- lightweight maintenance-ticket workflow;
- form + photo evidence + status/history.

**Organização da loja**

- shop-floor cabinets/drawers/replenishment/organization checks.

**Checklists de processos**

- guided reference/checklists for infrequent/error-prone procedures;
- includes **Entrada de Mercadoria** — a step-by-step guided reference for executing the Linx Manager merchandise-entry process correctly. This is primarily a procedural reference, not a replacement for Linx. Future Portal content may include NF verification steps, discount-specific checks, import-by-file workflow, discrepancy handling, reconciliation checks, manager escalation/finalization points, and screenshots/examples. Not built yet — this replaces the earlier, vaguer "Recebimento / controles de movimentação" label with this more precise concept;
- potential future examples such as CNPJ POS sales.

**Limpeza**

- future replacement for the manually-maintained monthly spreadsheet.

**Contagem de sacolas e embalagens**

- submit current quantities;
- identify/order replenishment need;
- future admin notification.

**Sugestões**

- replace the current improvement Google Form;
- operational / marketing / other categories;
- future voting/upvoting remains a roadmap possibility.

**Links Importantes — IMPLEMENTED (Milestone 4A)**

- curated links to external tools/forms Portal should not own yet: the confidential external Canal de Denúncia Segura e Sigilosa Google Form, and official app-store links for the YOOBIC ONE and CRM360 mobile apps. Portal is a front door to these systems, not an owner or replacement of them — it stores no complaint content and integrates with neither app.

**Mensagens para WhatsApp — IMPLEMENTED (Milestone 4B)**

- a static, grouped library of approved WhatsApp customer-service message templates employees can find and copy quickly, with placeholders left for manual personalization. No WhatsApp API integration, no message sending, no conversation storage.

**Tarefas / Pendências da Gerência**

- V1: simple shared to-do/check-off list;
- V2: deadlines/comments/priority/etc.

---

# 11. Administrativo

### PLANNED

Administrative functionality is intended for authorized roles.

Future capabilities may include configuration, operational corrections, checklist management, employee-related controls, reporting, and audit/review tools.

Exact permissions must be defined per capability.

---

# 12. Conhecimento & Cultura

### PLANNED / PARTIALLY IMPLEMENTED

Conhecimento & Cultura is the employee-facing home for company principles, brand/product knowledge, sales knowledge, operational learning, quizzes, training content, and other approved material intended to reinforce knowledge and company culture without creating unnecessary friction during normal sales-floor work.

Intended future content categories:

- Nossos Princípios;
- Lacoste / brand knowledge;
- product knowledge;
- selling / customer-service knowledge;
- **Técnica CVB** (Característica-Vantagem-Benefício) — sales/product training examples (e.g. Conforto e uso diário, Variedade de cores, Durabilidade, Polo Paris). Considered for Milestone 4B's Mensagens para WhatsApp and deliberately removed from there during that milestone's closeout: these are training/technique examples, not ready-to-send customer message templates, so they belong here as training content once this category is built, not in a copy-to-clipboard message library;
- operational training;
- short knowledge checks / quizzes;
- AI-generated training material based on approved source content.

**Only Nossos Princípios is implemented, as Epic 3 Milestone 3A** (section 16.2) — the Dashboard tile, the `/conhecimento-cultura` content hub, and the `/conhecimento-cultura/principios` page. Every other category above, including Técnica CVB, remains future scope: not implemented, not scaffolded, and not implied as available by the hub page's architecture (which anticipates additional cards later without pre-building disabled placeholders for them now).

Training/knowledge content should avoid excessive friction in the employee's normal sales workflow.

## Princípios em Ação

### FUTURE

Not implemented, not scaffolded, no schema or backend work done in anticipation of it. Documented here as approved product direction for a future milestone under Conhecimento & Cultura.

**Concept — Reconhecer uma atitude.** Employees would be able to submit examples of company principles (section — the five approved principles above) being demonstrated in practice. A submission would capture: the authenticated observer (derived automatically from the logged-in session — never a manually-entered, self-declared identity); the employee being recognized (an employee may recognize themselves); one or more principles — a single behavior may naturally demonstrate more than one, so this must not be forced to a single choice; a brief comment describing what happened; and a submission timestamp. Example:

```text
Pessoa reconhecida: João
Princípios: Colaboração · Foco no Cliente
Comentário: "Percebeu que eu precisava de ajuda com um cliente e veio apoiar sem eu precisar pedir."
```

**Shared positive feed.** Recognitions may feed a shared employee-facing recognition stream, e.g.:

```text
Maria reconheceu João
Colaboração · Foco no Cliente
"João percebeu que eu precisava de ajuda..."
```

For self-observation, the wording must make that clear naturally rather than implying someone else submitted it, e.g. "João compartilhou um exemplo próprio." The feed must remain positive, culturally reinforcing, non-competitive, and non-punitive — explicitly **no** scores, rankings, badges, leaderboards, "employee with most principles," or gamified principle points, consistent with section 3.10 (Coaching Over Punishment). Future moderation before public publication may remain a design option; the moderation mechanism itself is not decided or implemented here.

**Concerns — Compartilhar uma preocupação (or similarly neutral/supportive wording).** A negative or corrective observation must never be presented as a public "negative rating" or public principle violation, and must be a separate flow from the public recognition feed above. Potential fields: employee involved; one or more relevant principles; a brief description/context; authenticated submitter identity; timestamp.

**Privacy model for concerns — approved direction, explicit distinction:**

```text
Public recognition → shared employee feed
Confidential concern → Admin-only
```

A concern does not appear in the employee-facing public feed; the employee being discussed does not see the reporter's identity through Portal; only appropriately authorized Administrador users may access the concern content and reporter identity. This must not be described as technically or fully anonymous — it is confidential/restricted-access, a meaningfully different guarantee. A future concern form must clearly tell the submitter, before submission, that the content is confidential and visible only to administration.

**Sensitive HR issues remain out of scope for this flow.** Portal Benvisi should not become the company's homemade anonymous whistleblowing/HR complaint system at this stage. For serious/sensitive matters — harassment, discrimination, serious ethics complaints, other sensitive HR allegations — employees should continue to be directed to the existing external anonymous HR channel/form. A future concern flow may include a prominent link/reminder to that external resource, preserving the product principle that Portal can act as a trusted doorway to external systems without unnecessarily owning sensitive workflows.

**Architecture constraints for whenever this is built** (documentation only — no tables/RPCs designed here, no migration):

- observer identity must come from the authenticated session/server-side identity, never a client-submitted value treated as authoritative (section 5.1);
- the target employee must be validated server-side;
- public vs. confidential visibility must be explicit in the data model, not inferred by the frontend;
- concern data must never leak into the public recognition feed;
- confidentiality/authorization must not rely on frontend hiding alone — backend permissions must protect confidential concern access (this project's existing "hiding a button is UX, not authorization" principle);
- both recognition and concern workflows should remain auditable;
- no punitive scoring may be automatically derived from concern submissions.

---

# 13. Data and Analytics Philosophy

## 13.1 Data Must Serve a Decision

### APPROVED PRINCIPLE

Operational data should be collected because it enables a useful action or insight.

Examples:

- conversion analysis;
- unavailable-product analysis;
- queue behavior;
- coaching;
- operational bottlenecks;
- inventory lookup patterns.

## 13.2 Operational Truth vs ERP Truth

ERP/POS remains authoritative for transactional facts such as finalized sales and core inventory/accounting records.

Portal Benvisi may be authoritative for operational facts that ERP does not represent well, including Atendimento sessions, Lista da Vez state/history, operational checklists, shift-readiness state, and employee workflow events.

## 13.3 Auditability

Important state changes should be understandable after the fact.

The backend should preserve enough information to explain important operational outcomes when necessary.

---

# 14. UI and Design System

## 14.1 General Direction

### APPROVED PRINCIPLES

The UI should be:

- mobile-first;
- professional;
- high-contrast where action/status matters;
- fast to scan;
- low in visual clutter;
- consistent across modules.

## 14.2 Status Communication

Prefer clear, direct status indicators.

Examples:

- green completion state after starting activities;
- red/yellow/green inventory states;
- compact active Atendimento indicator.

Avoid decorative animation or persistent alarm states unless operationally justified.

## 14.3 Confirmation Dialogs

Use confirmation dialogs for meaningful exceptions, not routine behavior.

Example: starting Atendimento out of turn.

## 14.4 Detailed Design System

### PLANNED

This Blueprint defines product-level visual and UX principles.

Detailed visual specifications may be maintained separately in:

`docs/portal-benvisi-design-system.md`

That document may eventually define:

- exact color values;
- semantic colors;
- typography;
- spacing;
- border radius;
- button hierarchy;
- card patterns;
- dialogs;
- responsive behavior;
- icon conventions;
- reusable component patterns.

Where possible, exact visual values should ultimately be implemented as shared design tokens rather than repeated as one-off values throughout the application.

The absence of a completed Design System document should **not** block implementation of approved product functionality when the existing application already provides an established visual language.

## 14.5 Accessibility

### Small Accessibility MVP — Larger Text

**Status:** IMPLEMENTED / QA COMPLETE

A deliberately small, first accessibility capability: a user-controlled **Texto maior** (larger text) preference, offered alongside the default **Padrão** sizing. This is not a full accessibility overhaul — it is scoped to readability only.

**QA status:** toggle behavior, persistence, Login/PIN mobile layout, notice/indicator layouts, the reinforcement toast, desktop, and the final Aa-trigger interaction (Padrão/Texto maior hidden until tapped) — all **PASS**. The ~13% increase is confirmed intentional and kept as-is (not increased on a subjective "feels subtle" observation alone — pending real employee feedback). Placement and presentation went through three polish rounds: first collapsed into the header on mobile only; then moved out of the header entirely into a Dashboard utility area near the bottom, using the same placement and interaction model on mobile, tablet, and desktop (no per-device placement rules); then, per final product direction, the always-visible Padrão/Texto maior options within that area were tucked behind a compact **Aa** trigger to keep the row subtle. All three rounds are now browser-verified. In the Milestone 4C.3 polish tranche this utility area was extracted into a shared `AuthUtilityBar` component and now renders in the same bottom position on **every** authenticated employee-facing route, not only the Dashboard (Termos shows only the Aa control there — it has its own accept/decline pair).

**What it is:**

- the bottom utility area (shared `AuthUtilityBar`, present on every authenticated route) contains a compact **Aa** accessibility trigger that opens the Padrão / Texto maior options, alongside the always-visible **Sair** action — the same location and interaction model on every viewport (normal document flow, not fixed/sticky/overlay), separated from the header and from the operational modules by a subtle divider; Sair always shows its text label, never icon-only;
- a device/browser presentation preference, stored in `localStorage` under a Portal-Benvisi-namespaced key — **never** sent to Supabase, never employee-account data, never read by any backend RPC;
- applied by toggling a `data-text-size` attribute on `<html>`, which a small, unlayered CSS rule uses to override Tailwind's own `--text-*` typography-scale custom properties by approximately 13% (within the approved 12–15% range) — every component already using Tailwind's ordinary `text-*` utilities picks up the larger scale automatically, with no per-component `if (larger) ... else ...` branching anywhere;
- deliberately scoped to typography only — spacing, padding, gaps, widths, icon sizes, and touch targets are untouched, so this cannot become an accidental "zoom the whole interface." Line-heights are not separately overridden either: Tailwind's line-height values are unitless ratios that already scale proportionally with whatever font-size is applied;
- applied as early as practical via a tiny inline script in `<head>` (before first paint) reading the stored preference, so a returning employee does not see a flash of normal-size text before it enlarges — the same standard technique used for dark-mode-before-hydration, not new SSR/hydration infrastructure;
- the Milestone 2E reinforcement toast's font size now also derives from the same shared `--text-sm` variable (previously a fixed pixel value) so it participates in the same scale consistently rather than being a fixed-size exception.

**What it deliberately is not (yet):** contrast options, color-vision-safe alternatives, additional text-size levels beyond the two, reduced motion, or a broader accessibility audit. Do not treat this section as implying any of those already exist.

**Future accessibility roadmap** (not approved for implementation, listed for context only): stronger contrast options; color-vision-safe alternatives; additional text-size levels; reduced motion; a broader accessibility review across the whole application.

---

# 15. Engineering Principles

## 15.1 Backend Owns Business Rules

### APPROVED

Frontend validation improves UX. Backend validation protects truth.

Critical rules must be enforced server-side.

## 15.2 Prefer Database Guarantees for Invariants

### APPROVED

Where safely expressible, use database constraints/uniqueness for business invariants rather than relying only on application code.

## 15.3 Transactions for Multi-Step Business Actions

### APPROVED

Operations that logically succeed or fail as one business event should be atomic.

Atendimento finalization is the clearest current example.

## 15.4 Timezone

### APPROVED

Business-day logic must use **America/Manaus** rather than assuming UTC or browser-local time.

## 15.5 Avoid Unnecessary Global Client State

### CURRENT ARCHITECTURAL DIRECTION

Use TanStack Query for server state.

Use local component state for temporary UI state where practical.

Do not add a global state-management library without demonstrated need.

## 15.6 Browser Validation Before Commit

### APPROVED DEVELOPMENT PRACTICE

A milestone should be browser-tested before being considered complete and committed.

Implementation agents should also run relevant build, typecheck, lint, and automated tests when meaningful.

---

# 16. Roadmap

## 16.1 Implemented Foundation

### IMPLEMENTED

- employee login;
- PIN validation;
- opaque employee sessions;
- session validation;
- versioned terms acceptance;
- Iniciar atividades / `turno_presenca`;
- role-aware dashboard foundation;
- mobile/desktop login UX foundation;
- shared placeholder module dialog;
- Git/GitHub feature-branch workflow.

## 16.2 Epics

### Epic 2 — IMPLEMENTED / MERGED TO MAIN

**Epic 2 — Atendimento**

Development complete for the approved scope; product-owner practical QA (section-by-section, see the Epic 2 Stabilization subsection below) is complete; `feature/epic-2-atendimento` has been merged into `main`. This marks the code as stable and part of `main`, not the system as operational production — see section 4.4, Environments — Test/Demo Data vs Production.

### Milestone 1 — Lista da Vez + Atendimento Foundation

**Status:** IMPLEMENTED

Includes:

- persistent Lista da Vez;
- queue entry based on **Iniciar atividades** order;
- one active Atendimento per employee;
- simultaneous Atendimentos for different employees;
- out-of-turn start with confirmation;
- 20-second accidental-start undo window;
- exact restoration of prior queue position after accidental cancellation;
- return to the back of the available queue after legitimate completion;
- shared active Atendimento timers;
- active Atendimento resume after navigation;
- concurrency-safe queue behavior.

### Milestone 2A — Real Closing Flow + Customer Outcomes + Motives

**Status:** IMPLEMENTED

Includes:

- `finalizando` state;
- **Voltar ao atendimento**;
- one or more customers per Atendimento;
- `Convertido` / `Não convertido` outcome for each customer;
- data-driven motive catalog with short employee-facing labels;
- direct motive-selection buttons (no dropdown);
- required motive detail when applicable;
- transactional customer-outcome finalization;
- duplicate-submission protection;
- Finalizando time excluded from Atendimento duration only when that closing attempt succeeds (see section 8.9.6 / ADR-021);
- reporting-friendly persistence.

### Milestone 2A.1 — Start Atendimento on Behalf of Another Employee

**Status:** IMPLEMENTED

Scope:

- allow an authenticated employee (the authenticated actor, section 5.4 / ADR-019) to initiate Atendimento for another available employee in Lista da Vez, who remains the responsible employee of record;
- keep the Atendimento attributed to the target (responsible) employee — normal out-of-turn rules for the target are preserved, and the initiating actor's own queue position/state is left unchanged (ADR-020);
- record the responsible employee and the authenticated actor separately on every Atendimento (`id_funcionario`, `id_funcionario_iniciador`), so audit/history queries can always distinguish a self-start from a delegated one;
- 20-second accidental-start grace period for self-starts; 60-second grace period for delegated starts, computed from the same server-authoritative `iniciado_em`/`prazo_provisorio_em` deadline in both cases;
- during the delegated grace period, either the responsible employee (via their own active card's **Cancelar início**) or the initiating actor (via a **Desfazer · XXs** action shown on the target's Lista da Vez row, with a live server-authoritative countdown, no extra confirmation dialog, and no disabled/stale state after expiry) may cancel the provisional Atendimento; permission and the deadline are both re-validated entirely server-side regardless of what the client shows;
- `id_funcionario_cancelou` records who actually cancelled a provisional Atendimento, alongside the existing responsible/initiator attribution, giving full auditability of who started, who was responsible for, and who cancelled each Atendimento;
- do not use impersonation or session switching — the authenticated actor is always resolved server-side from the opaque session, never accepted from the client.

**Implementation-neutral clarification discovered during this work:** once an employee can simultaneously be the responsible employee of their own Atendimento and the initiator of delegated Atendimentos for others, "the caller's own active Atendimento" is no longer a unique concept — the same employee can legitimately be linked to several simultaneously-active rows in different roles. `cancelar_atendimento_provisorio` therefore identifies its target by an explicit Atendimento id rather than implicit resolution from the session alone; permission (responsible employee, or initiator within the delegated grace window) is still validated entirely server-side against the fetched row.

Validated in browser QA: basic and out-of-turn delegated starts, cross-device pickup via polling, the 60-second delegated grace period, initiator cancel and cancel-after-expiry UI behavior, responsible-employee cancel, ineligible-target visibility, an actor and a responsible employee each simultaneously having their own active Atendimento, an initiator cancelling a delegated target while also having their own active Atendimento, self-start and out-of-turn self-start regressions, the closing-flow regression, and an audit SQL spot-check confirming responsible employee, initiator, canceller, self-vs-delegated, out-of-turn status, and completed/cancelled state are all recorded correctly. The same-target simultaneous-start race was not practically browser-testable; the backend's advisory lock and unique-active-Atendimento constraint remain the enforcement mechanism.

### Milestone 2A.2 — Lista da Vez Membership Management

**Status:** IMPLEMENTED

Scope:

- an employee who has already completed **Iniciar Atividades** may voluntarily leave Lista da Vez (**Sair da Lista da Vez**) and later rejoin (**Entrar na Lista da Vez**), any number of times during the same Manaus business day — one action covers every real-world reason (bathroom, meal, stock-room work, leaving the sales floor, end of day); no reason is captured or asked for;
- Iniciar Atividades / `turno_presenca` and Lista da Vez membership remain distinct concepts (section 7.4): leaving/rejoining never touches `turno_presenca`, and rejoining never requires a fresh Iniciar Atividades call for the same business day;
- an employee may only leave while currently **available** — not while `Em atendimento` or `Finalizando`; an unresolved Atendimento must be resolved through the normal closing flow first, enforced server-side;
- leaving removes the employee from the currently available queue with no visible position number; remaining employees keep their exact relative order and posicao — nothing is renumbered;
- rejoining always places the employee at the **back** of the currently available queue — never their previous position;
- a manager or admin (cargo `Administrador` or `Gerente`, resolved server-side from the opaque session, never client-supplied) may remove another currently-available employee from Lista da Vez (**Remover da Lista da Vez**) — e.g. someone who forgot to leave before going home. The same availability restriction applies: an employee who is `Em atendimento` or `Finalizando` cannot be removed by this action. Removal never alters the removing manager/admin's own queue state, and never touches the target's Iniciar Atividades;
- no reason is required or captured for either voluntary leave or manager/admin removal in this milestone;
- an employee outside Lista da Vez is not eligible as a self-start or delegated-start target (Milestone 2A.1) — enforced by the same server-side availability check 2A.1 already added to `iniciar_atendimento`, requiring no changes to that function;
- durable auditability (section 12/13): every leave, rejoin, and removal is recorded in an append-only event log (`lista_vez_eventos`) preserving the responsible/target employee, the authenticated actor who performed the action (equal to the target for a voluntary leave/rejoin, the manager/admin for a removal), the event type, and the timestamp — sufficient to reconstruct the full history and cycle count of a business day's queue membership changes later, without relying on a mutable current-state flag alone. No reporting UI is built on this in this milestone.

**Explicitly out of scope for this milestone:** pause/break reason capture, separate lunch/bathroom/end-of-day statuses, legal timekeeping, an employee-facing **Encerrar turno**, manager/admin forcing another employee *into* Lista da Vez, and any manager/admin action on another employee's *active* Atendimento (ending it, moving it to `Finalizando`, or closing it) — those remain future scope under "Manager/Admin Atendimento Exception Handling" below.

**Final UX polish:** the manager/admin removal control uses a `UserMinus` icon in a destructive-red treatment — deliberately distinct from the delegated-start `UserPlus` icon it sits beside on the same row, since the two looked too similar at mobile icon sizes. The "outside Lista da Vez" state uses an amber/warning-toned card and CTA (**Você está fora da Lista da Vez.** / **Entre novamente para voltar à fila.**) rather than the normal blue ready-to-serve treatment, so an employee returning from a break — or one removed by a manager/admin — cannot mistake it for being back in line at a glance.

Validated in browser QA: voluntary leave, rejoin at the back of the queue, repeated leave/rejoin cycles, leave blocked while `Em atendimento`/`Finalizando`, manager/admin removal, non-manager permission/UI behavior, busy employees protected from removal, an employee outside Lista da Vez correctly ineligible as a delegated-start target, the full existing Atendimento regression sweep, and the final icon/color UX polish (distinct removal icon, removal confirmation, amber outside-the-queue state clearly distinct from the normal available state, rejoin still returns to the back). The stale-tab/direct-RPC rejection path and mobile-width layout were not manually exercised in browser QA; server-side validation, queue locking, and the responsive layout classes used elsewhere in this page remain the safeguard, and this is non-blocking for milestone completion.

## Milestone 2B — Checklist Operacional V1

**Status: IMPLEMENTED**

**Nota (Epic 2 Stabilization):** o conteúdo do item 2 abaixo descreve fielmente a V1, histórica e imutável. Uma **Checklist V2** foi introduzida posteriormente apenas para adicionar orientações ao item 2 — mesmos três itens, mesma obrigatoriedade, nenhuma nova confirmação — e é hoje a versão ativa. Ver a entrada "Epic 2 Stabilization" no roadmap para o detalhe completo e o motivo de V1 nunca ter sido editada em vez de criar V2.

O fechamento de um Atendimento inclui um checklist operacional obrigatório, destinado a restaurar rapidamente o ambiente de venda após o atendimento ao cliente.

O checklist faz parte do mesmo fluxo de `Finalizando` já utilizado para registrar clientes, conversão e motivos.

### Fluxo de fechamento

O fluxo aprovado é:

1. O funcionário seleciona `Concluir atendimento`.
2. O Atendimento entra em `Finalizando`.
3. O funcionário registra um ou mais clientes.
4. Para cada cliente, registra:
   - Convertido / Não convertido;
   - motivo correspondente;
   - detalhe quando exigido pelo motivo.
5. O funcionário completa o Checklist Operacional aplicável.
6. O fechamento é enviado.
7. O backend valida e persiste atomicamente:
   - clientes;
   - resultados e motivos;
   - checklist;
   - conclusão do Atendimento;
   - retorno do funcionário ao final da Lista da Vez.
8. O Atendimento passa para `concluido`.

Se qualquer parte da validação falhar, nenhuma parte do fechamento é parcialmente persistida e o funcionário continua indisponível em `Finalizando`.

---

### Checklist V1

A versão 1 possui exatamente três confirmações principais:

#### 1. Conferir o provador

Orientações:

- verificar se o cliente esqueceu ou perdeu algum item pessoal;
- recolher peças que precisam ser arrumadas e/ou devolvidas;
- retirar qualquer lixo;
- deixar a cortina aberta para o lado direito.

#### 2. Arrumar e/ou devolver as peças do atendimento

Confirmar que as peças relacionadas ao Atendimento foram organizadas e/ou devolvidas adequadamente.

#### 3. Verificar a loja toda

Orientações:

- organizar as peças e a exposição, incluindo pilhas;
- repor peças quando necessário;
- retirar qualquer lixo ou sujeira.

As orientações são textos explicativos e **não representam controles ou confirmações individuais adicionais**.

O funcionário realiza somente as três confirmações principais acima.

---

### Política no Milestone 2B

No Milestone 2B, o checklist é obrigatório.

Todas as confirmações obrigatórias da versão ativa precisam ser concluídas antes que o Atendimento possa ser finalizado.

A obrigatoriedade é validada tanto:

- na interface;
- quanto no backend.

A interface não é considerada a autoridade da regra de negócio.

O Milestone 2B **não permite adiar o checklist**.

Não existem ainda:

- `Farei depois`;
- obrigações pendentes de checklist;
- contador de pendências;
- resolução posterior;
- política administrativa `defer_allowed`.

Esses comportamentos pertencem ao **Milestone 2C**.

---

### Versionamento

O checklist é versionado.

A definição de cada versão possui itens com conceitos equivalentes a:

- `versao`;
- `codigo` estável;
- título;
- orientações;
- ordem de exibição;
- obrigatoriedade;
- estado ativo.

As respostas do Atendimento são armazenadas de forma versionada em JSONB.

Exemplo conceitual:

```json
[
  {
    "codigo": "conferir_provador",
    "concluido": true
  },
  {
    "codigo": "arrumar_devolver_pecas",
    "concluido": true
  },
  {
    "codigo": "verificar_loja",
    "concluido": true
  }
]
```

O backend determina qual é a versão aplicável e reconstrói o registro persistido a partir da definição autoritativa do checklist.

O cliente não pode escolher arbitrariamente:

- a versão;
- os códigos válidos;
- quais itens são obrigatórios;
- ou declarar que o checklist está completo sem validação do servidor.

---

### Imutabilidade das versões utilizadas

Depois que uma versão de checklist tiver sido utilizada em produção, sua definição deve ser considerada **imutável**.

Não alterar retroativamente em uma versão já utilizada:

- códigos;
- títulos;
- orientações;
- significado dos itens;
- conjunto de itens;
- obrigatoriedade de forma que mude o significado histórico.

Se houver uma mudança material no conteúdo ou significado do checklist, deverá ser criada uma **nova versão**.

Exemplo:

```text
Checklist V1
→ utilizado historicamente
→ permanece intacto

Nova necessidade operacional
→ criar Checklist V2
```

Essa regra garante que um registro histórico continue representando exatamente o checklist que o funcionário visualizou e confirmou naquele momento.

---

### Persistência e auditabilidade

Cada Atendimento concluído normalmente possui um único registro de conclusão de checklist.

O registro preserva, no mínimo:

- Atendimento;
- funcionário responsável;
- versão do checklist;
- respostas;
- momento da conclusão.

Existe proteção de unicidade para impedir múltiplos registros normais de checklist para o mesmo Atendimento.

No fluxo atual, o funcionário responsável também é quem conclui o próprio checklist.

Conclusão por gerente/admin em nome de outro funcionário não faz parte deste milestone.

A arquitetura deve permanecer compatível com o princípio global de:

**Funcionário Responsável ≠ necessariamente Ator Autenticado**

para futuras funções privilegiadas.

---

### Proteção de dados não salvos

As respostas do checklist fazem parte do mesmo rascunho local do fechamento.

Se o funcionário já tiver preenchido qualquer informação do checklist e tentar:

- `Voltar ao atendimento`;
- `Voltar ao painel`;

a proteção contra perda de dados não salvos deve funcionar da mesma forma utilizada para clientes, motivos e detalhes.

O rascunho não é persistido no servidor.

Refresh do navegador ou fechamento da aba continuam fora do escopo atual.

---

### Relação com Lista da Vez

Enquanto o Atendimento estiver em `Finalizando`, o funcionário continua indisponível.

Ele não pode:

- usar `Sair da Lista da Vez`;
- ser removido da Lista da Vez por gerente/admin através do mecanismo normal de gerenciamento de participação.

Após a conclusão válida do Atendimento e do checklist, o funcionário retorna ao **final da Lista da Vez**, preservando a regra existente.

---

### Milestone 2C — Admin Checklist Policy + Deferred Checklist Backlog

Milestone 2C is split into two parts:

- **2C.1 — Checklist Policy + Deferral Backlog Creation** (below): how deferred checklist work gets created, authorized, and audited.
- **2C.2 — Deferred Checklist Resolution** (below): how that backlog actually gets cleared. Not yet implemented.

### Milestone 2C.1 — Checklist Policy + Deferral Backlog Creation

**Status:** IMPLEMENTED

Scope:

- an authoritative, server-side checklist policy with exactly two values, `required` and `defer_allowed`, defaulting to `required` — a single current store/global policy, not per-employee/per-role/date-scoped;
- only cargo `Administrador` may change the policy (server-enforced, actor resolved from the opaque session) — `Gerente` does **not** have policy-edit permission. This follows the existing convention already established by the dashboard's Administrativo module itself, which is likewise visible only to `Administrador`; `Gerente`'s existing extra privilege (Milestone 2A.2's Lista da Vez removal) is a day-to-day operational action, not store-wide configuration, so it is not treated as a comparable precedent here;
- every actual policy transition is recorded in an append-only history (`checklist_policy_eventos`: prior value, new value, authenticated actor, timestamp) — a no-op "change" to the same value writes no new history row;
- a lightweight admin screen (`/administrativo`, reached from the dashboard's existing Administrativo module) shows the current policy and lets the admin pick between **Obrigatório** and **Permitir fazer depois**, with a short lightweight confirmation before applying an actual change — no policy scheduling, no history UI, no broader settings subsystem;
- under `required`: Milestone 2B behavior is preserved exactly — all required checklist confirmations must be completed, no `Farei depois` option exists at all, and normal checklist completion remains atomic with customer outcomes, Atendimento completion, and return to Lista da Vez;
- under `defer_allowed`: Checklist V1 remains the preferred/default completion path; the employee may intentionally choose a visually secondary **Farei depois** action, with supportive copy ("Você poderá concluir este checklist depois.") that avoids language implying the checklist is waived, ignored, forgiven, or permanently skipped — deferred ≠ waived;
- choosing **Farei depois** is an explicit, separate client intent — never inferred from an incomplete checklist submission — and is folded into the same atomic `concluir_atendimento` transaction as customer-outcome finalization. Any partial local checklist progress is discarded, not persisted: no `atendimento_checklists` completion row is ever written on the deferred path, regardless of how many items the employee had locally checked before choosing to defer;
- a successful deferral creates exactly one durable pending obligation (`checklist_pendencias`, `unique (id_atendimento)`) preserving, at minimum: the source Atendimento, the responsible employee, the checklist version applicable at deferral time, the policy value in effect at deferral (a snapshot, not a live reference), the deferred timestamp, and a current pending/resolved state — never only a mutable pending-count number on the employee;
- the employee sees an aggregated, backend-authoritative count of their own currently-pending obligations, currently on the Atendimento/Lista da Vez experience (no detail list, no resolution action yet — awareness only; hidden entirely when the count is zero, shown with restrained amber styling otherwise — e.g. "1 checklist pendente" / "3 checklists pendentes");
- a successfully deferred Atendimento still becomes `concluido` and the employee still returns to the back of Lista da Vez exactly as a normal completion would — pending backlog never blocks continued Lista da Vez participation, Iniciar Atividades, or any other existing behavior;
- pending obligations survive Manaus business-day boundaries indefinitely — they are never auto-reset, auto-expired, auto-waived, or deleted;
- a policy change never rewrites or removes existing obligations, in either direction: switching `defer_allowed → required` leaves already-pending obligations pending (they are not deleted, waived, or auto-resolved), and switching `required → defer_allowed` does not alter historical completed checklists;
- checklist-version immutability (Milestone 2B) is unaffected — a deferred obligation snapshots the exact `checklist_versao` that was authoritative at the moment of deferral, the same way a completed checklist snapshots its version.

**Concurrency / data-integrity rule:** deferral and policy changes are serialized against each other through the same `checklist_config` singleton row, not left to incidental statement timing. `concluir_atendimento`'s deferral path takes a locking read (`FOR SHARE`) on that row when evaluating whether deferral is currently allowed; `set_checklist_policy` updates it under `FOR UPDATE`. These two lock modes conflict, so whichever transaction reaches the row first forces the other to wait until it commits, and the waiting transaction then observes the *post-commit* value rather than a stale snapshot. Practically: a deferral cannot commit based on a policy read that a concurrent policy change has already superseded — backend state, never UI state, determines whether **Farei depois** is actually honored at the moment of submission.

**Explicitly out of scope for 2C.1** (reserved for 2C.2): resolving a pending obligation in any way — no standalone checklist completion, no `Concluir checklist pendente` action, no clearing of obligations (by a later Atendimento's checklist or otherwise), no resolver-relationship/resolution-timestamp/resolution-source logic, no manual admin waiver or deletion of a pending obligation, and no detailed per-obligation list UI. The `checklist_pendencias` schema includes nullable `resolvido_em` / `tipo_resolucao` / `id_resolucao` columns now specifically so 2C.2 can populate them without a further schema change, but nothing in 2C.1 reads or writes them.

Validated in QA at a practical product-owner level: admin current-policy display and policy switching in both directions; **Farei depois** appearing only under `defer_allowed` and disappearing correctly when policy reverts to `required`; a deferral completing the Atendimento, returning the employee to the back of Lista da Vez, and creating a pending obligation; pending-count singular/plural wording across multiple deferrals; non-`Administrador` access correctly blocked from the policy control; cross-day persistence of pending obligations; and a general regression sweep. The policy-change-vs-deferral race and the rapid-double-tap/duplicate-deferral edge case were not manually exercised in browser QA — both are non-blocking, since the former is enforced by the `FOR SHARE`/`FOR UPDATE` serialization described above and the latter by the same Atendimento-row locking plus `checklist_pendencias`' `unique (id_atendimento)` that has protected every closing path since Milestone 2A.

### Milestone 2C.2 — Deferred Checklist Resolution

**Status:** IMPLEMENTED

Scope:

- **Concluir checklist pendente**: a lightweight standalone checklist experience, fully independent of any Atendimento — same Checklist V1 items/guidance treatment as Atendimento closing, no customer/outcome/motive questions, no Atendimento created, no Lista da Vez/queue mutation of any kind;
- one genuine, backend-validated checklist completion — whether via the standalone action or via completing the checklist normally during a later Atendimento's closing — resolves **all** obligations currently `pending` for that employee at the authoritative moment of resolution, not just one; the employee never selects or works through historical obligations individually — the concept stays simple: a count, a reminder, one action;
- every original `checklist_pendencias` row remains individually auditable and untouched in its original fields (`id_atendimento`, `checklist_versao`, `politica_no_momento`, `adiado_em`) — resolution only flips `status` to `resolved` and records how;
- the resolution relationship (which specific checklist completion resolved which obligation, when, and from which source) lives in a dedicated table rather than as loosely-typed columns directly on the pending row, so it stays a real, referentially-intact relationship instead of an ambiguous pointer — see the architecture note below;
- resolution source is preserved and distinguishable: a later Atendimento's normal closing vs. a standalone completion;
- the actual completion always performs the *current* authoritative active checklist version; each original obligation nonetheless keeps the version that was applicable when *it* was deferred — resolving an obligation never rewrites which version it was originally deferred under;
- resolution can happen on a later Manaus business day, with no restriction to the same day/shift as the deferral;
- the store's *current* checklist policy never blocks resolution of historical backlog — `required`/`defer_allowed` only ever governs whether a *new* deferral is currently allowed, never whether existing pending obligations can be cleared;
- standalone completion is unavailable while the employee is `Em atendimento` or `Finalizando` — enforced server-side, not only by hiding the action — since they should resolve their current Atendimento through the normal flow first (which, if its checklist is genuinely completed, will itself clear the same backlog);
- standalone completion does not require being inside Lista da Vez, and does not require today's Iniciar Atividades — an employee may clear backlog from a previous business day immediately after login, since this is operational cleanup, not attendance/timekeeping;
- a persistent, actionable pending-checklist indicator (count + tap-to-open standalone completion) is shown across the dashboard and Atendimento — a shared component/hook pair rather than per-page duplicated banners or polling — hidden entirely at zero pending, restrained amber styling otherwise, full page-content width rather than a narrow floating pill so it reads as part of each page's shared content grid;
- no manual admin waiver, resolve, or delete of a pending obligation exists anywhere in this milestone.

**Persistent indicator placement:** the indicator is currently mounted directly on the dashboard and Atendimento pages because no shared authenticated app-shell/layout exists yet in this codebase — every page today is independently self-contained (its own header, its own `useRequireSession` call). This is functionally equivalent to a shell-hosted indicator (one shared component, one shared hook, one shared TanStack Query cache — no duplicated polling), just mounted per-page rather than once in a wrapping layout. If a shared authenticated shell is introduced later as additional modules are built, centralizing this indicator there instead remains a clean future simplification, not a behavior change.

**Architecture — resolution relationship:** rather than adding two independently-nullable foreign keys directly onto `checklist_pendencias` (an awkward polymorphic-row pattern), resolution detail lives in a dedicated `checklist_pendencia_resolucoes` table: one row per resolved obligation, with an exclusive-arc pair of real foreign keys (exactly one of "resolved by this Atendimento's checklist completion" / "resolved by this standalone completion" populated, database-enforced) plus the version actually performed and the resolution timestamp. `checklist_pendencias` itself keeps the `resolvido_em`/`tipo_resolucao`/`id_resolucao` columns 2C.1 already reserved for this — populated as a cheap, single-table summary — so the pending-count query (`status = 'pending'`) needed no changes at all. Standalone completions get their own table, `checklist_conclusoes_avulsas` (no dummy/fake Atendimento is ever created to satisfy `atendimento_checklists`' schema, which genuinely requires a real Atendimento); unlike `atendimento_checklists`, it records both `id_funcionario` and `id_funcionario_ator` explicitly, since a standalone completion has no owning Atendimento row to anchor "responsible employee" the way `atendimento_checklists` already does — keeping the architecture compatible with a future privileged/manager completion-on-behalf-of workflow without another schema change, consistent with section 5.4.

**Architecture — concurrency:** every operation that mutates an employee's pending checklist set (new deferral, standalone resolution, later-Atendimento resolution) acquires the same per-employee transaction-scoped advisory lock before touching `checklist_pendencias`. This makes deferral-vs-resolution and resolution-vs-resolution races for the same employee fully deterministic: whichever operation reaches the lock first completes, and the other observes the resulting post-commit state rather than racing a stale read — reusing the exact same lock-based serialization discipline 2C.1 established for policy-vs-deferral, not a new mechanism. The lock order across the whole Atendimento/checklist/queue surface is: Atendimento row → (deferral only) checklist policy row → per-employee checklist-backlog lock → per-day Lista da Vez lock, consistently in every code path, so no new deadlock path was introduced; standalone completion never touches the Atendimento or Lista da Vez locks at all.

Do not implement in 2C.2 (still future scope): manager/admin backlog visibility/dashboard (see "Future — Checklist Backlog Management Visibility" below, unchanged and still not implemented), detailed employee-facing history, deferral reasons/limits, and any manual resolution/waiver tooling.

Validated in QA at a practical product-owner level: deferring multiple Atendimentos and confirming the pending indicator/count; standalone completion resolving all pending obligations while preserving every original row individually; a later Atendimento's normal checklist completion resolving prior backlog; standalone completion correctly blocked while `Em atendimento`/`Finalizando`; resolving old backlog after the store policy changed back to `required`; and a general regression sweep. Cross-day resolution, two-device simultaneous standalone resolution, and rapid double-submit duplicate protection were not manually exercised this round — all three are non-blocking, since they are protected by the same durable-row and per-employee advisory-lock design described above rather than by anything time- or session-dependent.

### Milestone 2C.3 — Verificação Periódica do Checklist

**Status:** IMPLEMENTED

Validated at a practical product-owner level in the browser: admin can select Verificação periódica; three consecutive non-mandatory periodic Atendimentos are followed by a forced-mandatory one; mandatory periodic closings block Farei depois, require the checklist, and a successful completion resolves existing pending backlog; non-mandatory periodic closings behave like `defer_allowed`; no two consecutive mandatory selections occur; `Voltar ao atendimento` does not reroll a persisted decision; a policy change made after a decision was persisted does not override that Atendimento's own decision. One UI defect found during this QA round — the mandatory-closing explanatory copy was not visually distinct enough to be noticed — was fixed (see "Employee-facing copy" below) and re-validated.

## Policy modes

```text
required
defer_allowed
periodic_verification
```

Employee/admin-facing labels:

- `required` → **Obrigatório**
- `defer_allowed` → **Permitir fazer depois**
- `periodic_verification` → **Verificação periódica**

Scope, as implemented:

- a third checklist-policy value, `periodic_verification`, alongside the existing `required` and `defer_allowed` — employee/admin-facing label **Verificação periódica**, selectable from the same existing admin policy control (`administrativo.tsx`), same Administrador-only authorization as 2C.1;
- base random-sampling probability of approximately **20%** (`random() < 0.20`, evaluated inside the SECURITY DEFINER RPC — never `Math.random()`, never client-side) for whether a given eligible Atendimento's checklist becomes mandatory — a sampling probability, not a guarantee that exactly 20% of closings end up mandatory;
- no two consecutive eligible Atendimentos for the same employee may both be mandatory (the "no-consecutive" rule) — if the most recent eligible Atendimento was mandatory, the random draw is skipped entirely and this one is forced non-mandatory;
- a maximum-gap guardrail: after 3 consecutive non-mandatory eligible Atendimentos for an employee, the next eligible one is forced mandatory, skipping the random draw;
- together, the random draw and the guardrail target roughly two mandatory checklist completions per normal employee working day — an operating target, not an exact daily quota, and is never encoded as a literal "2 per day" rule anywhere in the algorithm;
- "eligible", for both the no-consecutive and max-gap history, means "was itself decided under `periodic_verification`" (`checklist_politica_no_momento = 'periodic_verification' and checklist_obrigatorio is not null`) — Atendimentos decided under a different policy, or that never reached `Finalizando` at all, are simply absent from the filtered history and can neither break nor extend the streak;
- the mandatory/non-mandatory decision is made and persisted **server-side, exactly once, at the moment an Atendimento first enters `Finalizando`** (inside `iniciar_fechamento_atendimento`, gated on `checklist_obrigatorio is null`) — never at Atendimento start, never client-side, and never re-rolled by a refresh, a device change, or a `Voltar ao atendimento` / re-enter-`Finalizando` cycle, because the decision columns are only ever written once per Atendimento and are checked before any new computation is attempted;
- the employee receives no advance notice during the active (`Em atendimento`) phase of whether that Atendimento will turn out to require a mandatory checklist — no sampled/not-sampled status, probability, countdown, or remaining-Atendimentos indicator is shown while active;
- if selected, neutral operational copy is shown on the closing screen ("Neste atendimento, conclua o checklist antes de finalizar.") in place of the normal checklist subtitle — never wording implying random selection, being singled out, or audit/surveillance framing;
- a mandatory periodic Atendimento behaves exactly like `required`: **Farei depois** is hidden client-side and backend-rejected (`ADIAMENTO_NAO_PERMITIDO`) even if attempted directly;
- a non-mandatory periodic Atendimento behaves exactly like `defer_allowed`: normal completion or **Farei depois** both remain available, and either path interacts with existing pending backlog exactly as Milestone 2C.2 already defined (a genuine completion — mandatory or not — always resolves all currently-pending backlog for that employee via `resolver_checklist_pendencias`);
- sampling is not adaptive and not punitive: existing pending-backlog size, deferral history, or any per-employee "risk" signal never influences the sampling probability or enters the algorithm at all;
- **policy-change precedence rule:** once a per-Atendimento decision is persisted (`checklist_obrigatorio is not null`), it is permanently authoritative for that Atendimento and the live `checklist_config.policy` value is never consulted for it again, in either `iniciar_fechamento_atendimento` (skipped by the `is null` gate) or `concluir_atendimento`'s deferral branch (the `is not null` branch bypasses the live-policy read entirely). A decision is only ever computed when none yet exists for that Atendimento at that moment — including on a second `Finalizando` entry after a `Voltar ao atendimento`, if the first entry happened under a non-periodic policy and the policy has since changed to `periodic_verification`; this is correctly the Atendimento's *first* decision, not a reroll, since none was made before. This composes cleanly with 2C.1's "live policy at final submit" rule rather than conflicting with it: 2C.1's rule governs the case where no per-Atendimento decision exists; this milestone adds a per-Atendimento decision that, once made, simply takes precedence over that live read for that one Atendimento;
- the algorithm (prior-history inspection, no-consecutive check, max-gap check, the random draw itself, and persistence) is entirely server-authoritative inside `iniciar_fechamento_atendimento`; the frontend (`get_atendimento_ativo`'s new `checklist_obrigatorio` output column, surfaced to `FechamentoAtendimento` as the `checklistObrigatorio` prop) only ever receives the already-made decision, never computes or influences it;
- admin configuration for this milestone is limited to selecting `periodic_verification` as the active policy from the existing admin control — the 20% probability and the max-gap count are fixed application-level constants in `iniciar_fechamento_atendimento`, not admin-configurable, and no technical detail (probability, streak counters) is exposed in the admin UI.

**Schema:** four new nullable columns directly on `atendimentos` — `checklist_obrigatorio` (the decision), `checklist_decisao_motivo` (`'sorteio' | 'gap_maximo' | 'pos_obrigatorio' | 'nao_selecionado'`, a `CHECK`-enforced enum, never a bare null when a decision exists), `checklist_decisao_em` (when), `checklist_politica_no_momento` (snapshot of the policy active at decision time, same snapshot-not-live-reference pattern as `checklist_pendencias.politica_no_momento` since 2C.1). A `CHECK` constraint keeps `checklist_obrigatorio is null` and `checklist_decisao_em is null` in lockstep. A 1:1 columns-on-`atendimentos` model was chosen over a separate table since the relationship is genuinely 1:1 and always read/written in the same transaction as the Atendimento's own status transition.

**Concurrency:** no new lock was introduced for this milestone. `iniciar_fechamento_atendimento` already takes `select ... where status = 'ativo' for update` on the specific Atendimento row, and the pre-existing partial unique index (one active/finalizing Atendimento per employee) makes it structurally impossible for the same employee to have two Atendimentos concurrently transitioning into `Finalizando` — so the periodic-decision computation is already fully serialized per employee by locks/invariants that predate this milestone. A second concurrent call for the *same* Atendimento (double-tap, two devices) blocks on that row lock, then finds `status <> 'ativo'` once unblocked and fails cleanly before reaching the decision logic — a decision is made at most once. The new `checklist_config` read inside `iniciar_fechamento_atendimento` uses `for share`, in the same lock order already established for `concluir_atendimento`'s deferral branch since 2C.1 (Atendimento row → `checklist_config` `for share` → per-employee `checklist_pendencias` advisory lock → per-day Lista da Vez advisory lock) — no new deadlock path.

**Decision reasons / auditability:** every periodic decision this algorithm ever makes carries an explicit `checklist_decisao_motivo`, never a bare null when a decision exists — `sorteio` (genuine random draw selected it), `gap_maximo` (forced mandatory by the guardrail), `pos_obrigatorio` (forced non-mandatory by the no-consecutive rule), or `nao_selecionado` (ordinary non-selection from the random draw). Alongside the reason, `checklist_decisao_em` (timestamp) and `checklist_politica_no_momento` (policy snapshot at decision time) are preserved, plus the `checklist_obrigatorio` result itself — enough to reconstruct, per employee, exactly which decisions were made, why, and under what policy, without building any reporting UI now. The backend remains the sole source of truth for all of this; nothing is derived or reconstructed client-side.

## Employee behavior

**Mandatory periodic Atendimento** — when the persisted decision is mandatory: the checklist must be completed; **Farei depois** is unavailable (hidden client-side, backend-rejected with `ADIAMENTO_NAO_PERMITIDO` if attempted directly); the employee sees neutral explanatory copy in place of the routine checklist subtitle: **"Neste atendimento, conclua o checklist antes de finalizar."** A successful checklist completion is a genuine completion and therefore resolves any previously pending checklist obligations under the existing 2C.2 rules.

**Non-mandatory periodic Atendimento** — when the persisted decision is non-mandatory: the employee may complete the checklist normally, or use **Farei depois**; normal deferred-obligation behavior applies exactly as under `defer_allowed`.

**Employee-facing copy — QA fix:** browser QA found that the mandatory-closing message, while correctly computed and correctly gating `Farei depois`/checklist completion, was easy to miss — it replaced the routine subtitle using the exact same low-emphasis `text-muted-foreground` weight/color, so it read as just another instance of ordinary body text rather than a signal that this particular closing behaves differently. Fixed in `FechamentoAtendimento.tsx`: the swapped-in message now renders with `text-foreground` + `font-medium` (still no color, icon, or border implying warning/audit/surveillance) instead of `text-muted-foreground`, making it legible at a glance while remaining neutral and non-alarming. The underlying data flow and condition (`checklist_obrigatorio === true`, sourced from `get_atendimento_ativo`) were already correct — this was a visual-weight defect, not a logic defect.

## Policy-change precedence

Once an Atendimento has received a persisted periodic decision on entering `Finalizando`, that decision remains authoritative for that Atendimento even if the global checklist policy changes afterward:

```text
periodic → decision = non-mandatory
admin changes policy to required
→ existing Atendimento remains non-mandatory
```

```text
periodic → decision = mandatory
admin changes policy to defer_allowed
→ existing Atendimento remains mandatory
```

The new global policy applies only to future Atendimentos that have not yet received a durable closing decision — full reasoning above under "policy-change precedence rule".

Final validation: `npm run typecheck`, `npm run lint`, and `npm run build` all pass cleanly, including after the copy-visibility fix.

### Future — Agendamento da Política do Checklist

**Status:** FUTURE

Administrators may eventually pre-schedule which checklist policy should be active during defined future periods, e.g.:

```text
Seg–Qui → Verificação periódica
Sex–Dom → Obrigatório
```

or date windows such as:

```text
01/12–24/12 → Obrigatório
restante → Verificação periódica
```

Potential business uses include high-volume retail periods, campaigns, holiday periods, onboarding/training periods, and any period where stricter operational verification is desired.

Important product rules:

- this is FUTURE scope only — not implemented, not scaffolded, no scheduling behavior exists in the codebase today;
- first version should remain simple: scheduled policy windows, no complex rules engine;
- scheduled changes affect Atendimentos that have **not yet received a persisted closing decision** — an Atendimento that already received a periodic decision in `Finalizando` keeps that decision even if a scheduled policy transition occurs afterward, following the exact same policy-change-precedence architecture already established across 2C.1–2C.3, not a new rule;
- scheduled changes must remain server-authoritative and auditable, consistent with `checklist_policy_eventos`;
- do not turn this into payroll/timekeeping;
- do not create employee-specific schedules at this stage — one store-wide schedule, not per-employee.

Builds directly on the policy and decision-precedence architecture established in 2C.1–2C.3; no schema or algorithm changes were made in anticipation of this — it remains a clean, additive future extension.

### Future — Checklist Backlog Management Visibility

**Status:** FUTURE

Managers/admins should eventually be able to see operational checklist backlog by employee.

Useful future information includes:

- employee;
- current unresolved count;
- oldest pending obligation / age;
- recent deferral frequency;
- resolution time;
- deferral rate;
- unresolved trend over time.

This should be treated primarily as an **administrative dashboard/reporting visualization**, not as another operational control embedded in Lista da Vez.

Important product boundaries:

- do not implement this dashboard now;
- do not add manual waiver/delete/resolve actions here — any resolution action belongs entirely to Milestone 2C.2's employee-facing checklist-completion flow, not to an admin visibility screen;
- do not turn pending-checklist visibility into punitive employee scoring;
- preserve the durable data already established by 2C.1's `checklist_pendencias` (and whatever 2C.2 adds to it) so this visualization can be built later without redesigning the schema.

This is a roadmap/reporting item — not part of 2C.1, and not required for 2C.2 completion.

### Future — Manager/Admin Atendimento Exception Handling

**Status:** APPROVED DIRECTION

Implement only after the full closing/checklist flow is stabilized.

Future scope may include:

- manager/admin moving another employee's Atendimento to `finalizando`;
- manager/admin finalizing an Atendimento on behalf of another employee;
- preserving separate attribution between responsible salesperson and authenticated administrative actor;
- treating these actions as exception/assistance workflows rather than normal sales-floor behavior.

### Future — Configurable Gerente Auto-Join

**Status:** FUTURE — considered, not approved for implementation now

Epic 2 Stabilization fixed Gerente's Lista da Vez participation as "manual only, never automatic" (section 8.5.5) — a hard-coded cargo rule, not a setting.

A future admin-configurable toggle could instead control whether Gerente auto-joins Lista da Vez on Iniciar Atividades, e.g.:

> **Gerentes entram automaticamente na Lista da Vez ao iniciar atividades**

Important: this toggle, if built, would control only the *automatic* behavior. It must not be conflated with *whether* Gerente is allowed to participate at all — manual participation (Entrar na Lista da Vez) should remain available to Gerente regardless of this setting's value. Do not implement this toggle now.

### Future — Session Management / Concurrent Login Controls

**Status:** FUTURE

Potential future capabilities:

- view active sessions per employee;
- revoke other sessions;
- admin "log out all devices";
- detect unusual simultaneous sessions;
- optionally limit concurrent sessions by role.

Do not implement these session controls now. The current decision is explicitly **not** to enforce one-browser/one-device-only login in MVP.

### Milestone 2D — Atendimento Pendente de Fechamento entre Dias

**Status:** IMPLEMENTED

Implements section 8.14 / ADR-010: an Atendimento still `ativo` or `finalizando` when the Manaus business day changes must never keep timing overnight, disappear, or receive an invented outcome. It becomes a durable `pendente_fechamento` obligation, belonging to the original responsible employee, that must be completed with real information before any other operational Atendimento activity resumes.

Validated at a practical product-owner level: previous-day transition into `pendente_fechamento`; the dashboard/Atendimento recovery flow appearing correctly; no Farei depois and no Voltar ao atendimento during recovery; customer/outcome/checklist completion; successful recovery reaching `concluido`; a genuine recovery checklist completion resolving existing 2C.2 backlog; recovered duration bounded by the historical cutoff rather than accumulating overnight; and the full queue-integrity QA below. `npm run typecheck`, `npm run lint`, and `npm run build` all pass cleanly.

**Detection/transition:** entirely lazy and server-authoritative — an internal helper, `transicionar_atendimento_pendente(p_id_funcionario)`, locks and inspects that employee's own `ativo`/`finalizando` row and transitions it in place the moment its original Manaus business day is found to be earlier than today. No background scheduler exists or is needed. It is called at the top of every RPC that reads or mutates an employee's own active-Atendimento row (`get_atendimento_ativo`, `iniciar_atendimento`, `iniciar_fechamento_atendimento`, `voltar_ao_atendimento`, `concluir_atendimento`, `concluir_checklist_avulso`) — so the transition is caught regardless of how the employee reaches the backend: a fresh 5s poll (every page already polls `get_atendimento_ativo`), a direct action attempt, a different device, days later. This also closes the day-boundary race: a request arriving right after midnight always sees the authoritative post-transition state, never a stale same-day row.

**Timer/duration semantics — no invented overnight duration:** reuses the existing `finalizando_em` column and the existing `finalizando_em - iniciado_em` duration formula (established by Milestone 2A / ADR-021) rather than inventing a new one:

- if the Atendimento was still `ativo` at day's end (never entered Finalizando), `finalizando_em` is synthesized to the end-of-business-day cutoff — local midnight starting the next Manaus day — computed once at transition time and never revised;
- if it was already `finalizando` (the employee had tapped Concluir atendimento but never submitted), `finalizando_em` already holds a real, earlier, same-day timestamp — an earlier valid closing boundary already exists, so it is preserved untouched.

Either way, `finalizando_em - iniciado_em` is the correct, deterministic customer-facing duration once the Atendimento is eventually recovered — no special-case duration logic exists anywhere in the recovery completion RPC. `iniciado_em` itself is never touched, matching every prior Finalizando-cycle rule.

**Timer cutoff — current MVP approximation:** the end-of-business-day cutoff used above is the local-midnight boundary of the original Manaus calendar day — a simple, deterministic approximation that prevents overnight timer accumulation without requiring any store-hours/calendar configuration concept. **Future refinement (not implemented, not scheduled):** if store-hours/operating-calendar configuration is introduced later, this midnight approximation could be replaced with an authoritative configured store operating-day cutoff instead. Do not implement store-hours configuration as part of this milestone or speculatively ahead of it.

**Schema (`atendimentos`, additive):** `pendente_desde timestamptz` (when the lazy transition happened — may be well after the cutoff), `dia_negocio_original date` (the Manaus calendar date the Atendimento belonged to, locked in at transition time), `fim_dia_negocio_original timestamptz` (the computed cutoff, kept as its own auditable column even when `finalizando_em` was left holding a different, earlier value). Status check/consistency constraints and the one-active-Atendimento-per-employee partial unique index are widened to include `pendente_fechamento`.

> **Dev/QA simulation note (not a production behavior change).** A regression run once reported a recovered Atendimento with a ~1440-minute (24-hour) duration instead of the expected ~455–456 minutes for a same-scenario `ativo`-through-midnight case. Investigated and confirmed as a **test-fixture artifact**, not a code defect: the row's `finalizando_em` carried real, non-zero microsecond precision — something the synthesized-midnight code path can never produce, since `(v_dia_original + 1)::timestamp at time zone 'America/Manaus'` is always an exact, zero-fractional-second instant. This proves the row had already genuinely entered `finalizando` (a real `iniciar_fechamento_atendimento` call, `finalizando_em = now()`) before the manual `UPDATE atendimentos SET iniciado_em = iniciado_em - interval '1 day'` ran — so the correctly-preserved-per-design `finalizando_em` ended up representing "moments after the Atendimento's original, undated start," roughly 24 hours after the now-independently-backdated `iniciado_em`. The duration formula and the transition logic both behaved exactly as designed; the fixture itself became internally inconsistent because only one of the two related timestamps was shifted.
>
> **Correct simulation procedure going forward:**
> - To simulate a genuinely-`ativo`-through-midnight case (exercises the synthesized-midnight branch): start the Atendimento and do **not** enter Finalizando at all; before backdating, confirm `status = 'ativo'` and `finalizando_em is null`; then run `update atendimentos set iniciado_em = iniciado_em - interval '1 day' where id = '<id>';` and trigger the lazy transition.
> - To simulate a genuine abandoned-Finalizando-then-crossed-midnight case (exercises the preserve-existing-`finalizando_em` branch): actually enter Finalizando (tap Concluir atendimento, do not submit) so `finalizando_em` is genuinely set; then backdate **both** timestamps by the same interval — `update atendimentos set iniciado_em = iniciado_em - interval '1 day', finalizando_em = finalizando_em - interval '1 day' where id = '<id>';` — keeping the two internally consistent.
> - Backdating only `iniciado_em` on a row that has already entered `finalizando` does not represent any real scenario and will not produce a meaningful duration.

**Recovery completion — a new, separate RPC (`concluir_atendimento_pendente`), not a branch of `concluir_atendimento`:**

- customer-outcome validation/persistence is identical to `concluir_atendimento`'s;
- the checklist is **always required** — there is no `p_adiar_checklist` parameter at all on this RPC, so Farei depois is never offered during recovery, matching the preferred MVP rule. This was judged not to conflict with a previously-persisted 2C.3 periodic decision: `checklist_obrigatorio = false` has only ever meant "not exempt from Farei depois being offered", never "can never be required to complete under any circumstance" — Farei depois was never a permanent waiver even same-day (a deferral only ever creates another durable obligation). Recovery's always-require rule is a stricter superset of what a non-mandatory (or no) periodic decision would have allowed same-day, never a contradiction of it;
- `checklist_obrigatorio` / `checklist_decisao_motivo` / `checklist_politica_no_momento` are never written by the transition helper or by this RPC, at any point (including the post-QA correction below) — whatever they already were (including null) remains the exact historical fact, so a recovered Atendimento can never retroactively acquire or falsify a 2C.3 periodic decision. The existing periodic-eligible-history filter continues to mean exactly what it already meant; a recovery-forced mandatory checklist that never had a genuine periodic decision never counts toward future no-consecutive/max-gap sampling history, and existing policy decision/audit history is never rewritten by recovery;
- a genuine checklist completion during recovery resolves all of the employee's currently-pending checklist backlog too, via the existing 2C.2 `resolver_checklist_pendencias` helper — no duplicated resolution logic;
- only the responsible employee (`id_funcionario`) may recover their own pending Atendimento — enforced by the lookup itself, never by `id_funcionario_iniciador`. Manager/admin completion on behalf of another employee remains future scope (section 8.16).

**Queue semantics — final rule, corrected during QA.** Previous-day recovery must never itself determine today's queue membership, but if today's membership already exists independently, recovery must be able to clear the temporary unavailability the original Atendimento left behind, without corrupting that membership:

- **no current-day membership** — if the employee has no current-day `lista_vez_fila` row at all, recovery does nothing to `lista_vez_fila`: no row is created, no queue position is assigned, no Iniciar Atividades is implied. Normal current-day Iniciar Atividades / queue-entry rules apply afterward, exactly as for any employee who hasn't joined today's queue yet;
- **existing current-day membership (`na_fila = true`)** — recovery restores `disponivel = true` on that row after the historical Atendimento is successfully concluded, and nothing else: `na_fila`, the exact `posicao`, and current-day queue order are all preserved untouched. Recovery never appends the employee to the back, never calls the normal queue-return positioning logic (`nextval`), never creates a duplicate row, and never alters a prior day's queue row;
- **employee intentionally outside the queue (`na_fila = false`)** — recovery leaves `na_fila = false` alone and does not automatically rejoin the employee; the normal explicit **Entrar na Lista da Vez** action remains required.

Concretely, `concluir_atendimento_pendente`'s only `lista_vez_fila` interaction is a single narrowly-scoped `UPDATE ... WHERE id_funcionario = ... AND dia_manaus = today AND na_fila = true AND disponivel = false` (setting only `disponivel = true`) — no `INSERT`/upsert branch exists at all, so it is a structural no-op whenever no current-day row exists or `na_fila = false`. This runs in the same transaction as the rest of recovery, under the same per-day advisory lock every other queue-mutating RPC already uses, positioned after the `checklist_pendencias`(employee) lock — preserving the established lock order (Atendimento row → `checklist_pendencias`(employee) → `lista_vez`(day)) exactly, with no new deadlock path.

**Post-QA correction — root cause and fix.** Browser QA found that a previous-day pending Atendimento could leave the employee's *own current-day* `lista_vez_fila` row stuck at `disponivel = false` with `na_fila = true` after recovery, surfaced as a contradictory "Você está fora da Lista da Vez" / "Você já está na Lista da Vez" loop. Root cause: the original `concluir_atendimento_pendente` never touched `lista_vez_fila` at all (correctly avoiding a blind append to today's queue), but this was incomplete — it had no path to clear the `disponivel = false` a same-day-started Atendimento had already set on the employee's own row before that Atendimento was (re)classified as pending. Fixed additively (see migration list below) by the single narrowly-scoped `UPDATE` described above. The frontend compounded the same root cause: the "fora da Lista da Vez" gate on `/atendimento` relied on `souNaFila` (presence among `disponivel = true` rows), an invariant that only held before this milestone — before 2D, an employee with no own active Atendimento could never legitimately be `disponivel = false`. Fixed by adding a distinct `estouNaLista` signal (raw presence in the Lista da Vez result at all, which `get_lista_vez_estado` already restricts to `na_fila = true` rows since Milestone 2A.2) and gating "fora da Lista da Vez" on that instead. `na_fila = false` ("outside Lista da Vez") and `na_fila = true, disponivel = false` ("still a member, temporarily unavailable") are now kept as distinct concepts in the UI, not just the backend — a distinction that should remain part of the Lista da Vez state model going forward, for any future code path that reads queue membership.

**Concurrency/idempotency:** no new lock primitive beyond the one described above. The transition helper takes the same `atendimentos`-row `for update` lock every Atendimento RPC already takes, first in the established lock order — calling it first at the top of every function above adds no new deadlock path. The existing partial unique index (widened to cover `pendente_fechamento`) makes it structurally impossible for an employee to ever have more than one row in `(ativo, finalizando, pendente_fechamento)` — "more than one pending Atendimento" cannot occur; no extra application-level check was needed. The same `for update` + status-match pattern every closing RPC already uses gives `concluir_atendimento_pendente` the same cross-device/duplicate-submission protection for free. Two-device simultaneous recovery was not manually exercised in QA; non-blocking, since this same server-side row-lock/status-match mechanism is what every other closing RPC has relied on since Milestone 2A.

**Employee UX:** authentication always succeeds regardless of pending state. Once Termo is accepted, both the dashboard and `/atendimento` independently query the same widened `get_atendimento_ativo` (now also exposing `dia_negocio_original`); if the caller's Atendimento is `pendente_fechamento`, the dashboard redirects to `/atendimento` (same blocking-redirect pattern already used for Termo acceptance) rather than showing normal modules, and `/atendimento` renders the closing form in recovery mode — same components as an ordinary Finalizando (`FechamentoAtendimento`, now with an `isPendingRecovery` flag), with neutral copy ("Atendimento pendente de conclusão" / "Finalize as informações deste atendimento antes de continuar." / "Atendimento iniciado em DD/MM.") replacing the ordinary title/subtitle, Farei depois and the internal Voltar ao atendimento action both hidden, and the Lista da Vez card and Iniciar atendimento button hidden entirely — no partial bypass. `/atendimento`'s own independent query is the authoritative gate regardless of how the employee arrived there (bookmark, direct link, already on the page).

**Backend blocking:** `iniciar_atendimento` (covering both self-start and delegated-start targets uniformly) rejects with a new, distinct `ATENDIMENTO_PENDENTE_FECHAMENTO` error when the blocking row is a pending recovery obligation, rather than the generic `ATENDIMENTO_ATIVO_EXISTENTE`. `concluir_checklist_avulso`'s existing active-Atendimento block is widened to also cover `pendente_fechamento` — the unresolved Atendimento takes operational precedence over the standalone checklist-completion escape hatch (recovering it resolves that same backlog anyway).

**Pending Atendimento ≠ pending checklist:** kept as two entirely distinct concepts, never merged into one table/state. An employee may have both a `pendente_fechamento` Atendimento and unrelated `checklist_pendencias` backlog simultaneously; the pending Atendimento takes operational precedence (enforced above), and its own recovery completion resolves both.

**Manager/admin completion on behalf of another employee remains future scope**, per section 8.16 — not implemented here.

**Migrations:** `supabase/migrations/20260822_001_add_atendimento_pendente_fechamento.sql` (initial implementation) and `supabase/migrations/20260822_002_fix_pendente_fechamento_queue_disponibilidade.sql` (additive QA correction, described above) — both immutable applied history; neither was ever rewritten. **PostgREST schema reload required** after `20260822_001` (`get_atendimento_ativo` gained a new output column via `DROP FUNCTION` + `CREATE FUNCTION`) — `notify pgrst, 'reload schema';`.

**Queue-integrity QA:** no current-day membership (Case A) — pass, recovery created no membership/position. Existing current-day membership (Case B) — pass, `disponivel` was restored while `na_fila` and the exact `posicao` were preserved and the employee was not sent to the back. Deliberate `na_fila = false` (Case C) — **not manually exercised**; documented as an unexercised edge case rather than tested, non-blocking because the corrective `UPDATE`'s `WHERE` clause structurally requires `na_fila = true` and contains no insert/upsert/rejoin path at all.

**Duration/cutoff QA:** a reported ~1440-minute duration result was investigated and confirmed to be a test-fixture artifact, not a code defect — see the dev/QA simulation note above. The synthesized-midnight and preserve-existing-`finalizando_em` branches are both confirmed correct by that investigation; no production change was made.

### Milestone 2E — Positive Reinforcement

**Status:** IMPLEMENTED

Implements section 8.15: after a successfully completed Atendimento, a brief, varied, non-punitive positive-reinforcement message appears as a transient toast — never a blocking modal, never a dedicated success screen, never delaying the return to Lista da Vez.

**Three categories, determined purely by customer-outcome composition (section 2/8.15.3):**

- `converted` — every customer in the Atendimento is Convertido (including a single-customer Atendimento);
- `non_converted` — every customer is Não convertido (including a single-customer Atendimento);
- `mixed` — at least one Convertido **and** at least one Não convertido — its own dedicated pool, never collapsed into `converted` (this supersedes 8.15.3's earlier "generally use the positive conversion category" wording — a deliberate, explicit product decision made for this milestone).

No ratio/threshold calculation of any kind — any mixture of the two outcomes is simply `mixed`.

**Curated production content, stored in code — `src/config/atendimento-feedback.ts`:** `CONVERTED_MESSAGES` (exactly 100), `NON_CONVERTED_MESSAGES` (exactly 150), `MIXED_MESSAGES` (exactly 25) — every message reproduced byte-for-byte from the approved production library, including emoji, capitalization, and punctuation. No runtime AI generation of any kind (no OpenAI/Claude/other API/Supabase Edge AI/runtime prompt) — selection is a deterministic local random pick from these fixed pools only. Not stored in the database, and no admin message-editor exists — the library is application content, changed only through a code review.

**Selection:** classify the completed Atendimento's customer categories, then pick uniformly at random from the matching pool. A single immediate-repeat avoidance re-roll (in-memory, per category, scoped to the browser tab — never persisted, never a database history table) skips showing the exact same message twice in a row within the same category when the pool has more than one entry; a second consecutive match is accepted rather than looping, per the approved "keep this simple" direction.

**Trigger points — only after the backend RPC has already confirmed success:** ordinary `concluir_atendimento` completion (covering `required`, `defer_allowed` complete-now, and both mandatory/non-mandatory `periodic_verification` outcomes — the checklist policy path never affects which message pool is used); `defer_allowed`'s Farei depois path (still a genuine successful Atendimento conclusion — checklist deferral is tracked separately and never changes reinforcement tone or category, section 15); and Milestone 2D's `concluir_atendimento_pendente` previous-day recovery completion. The customer-outcome categories are captured synchronously from the closing draft *before* the RPC call is awaited (never re-derived afterward, since the draft can reset once the query invalidation triggered by a successful call resolves) — satisfying "never infer from UI state after the draft has already reset" while still deriving from exactly what was validated and submitted. No reinforcement is shown for a failed/rejected submission, a `Voltar ao atendimento` (Finalizando → ativo), an accidental-start cancellation, a session failure, or an Atendimento that remains `pendente_fechamento` unresolved.

**Standalone checklist completion (Concluir checklist pendente) is explicitly excluded** — it keeps its own existing, separate, concise operational success toast (`getChecklistAvulsoSuccessMessage`); the 275-message Atendimento library is never used there.

**No gamification of any kind:** no points, badges, stars, streaks, leaderboards, employee/conversion scoring, achievement tables, or reinforcement-message history/logs. A message-selection failure can never cause Atendimento completion to fail — completion has already succeeded by the time reinforcement is attempted, and the selection call is defensively wrapped so it can never throw into its caller.

**No database migration** — this milestone is entirely frontend/application-content; no schema, RPC, or persisted-state change was needed or introduced.

**Visual presentation — final polish.** The default toast styling read as a generic system notification (near-white background blending into the surrounding UI). Fixed with a presentation-only pass, kept centralized entirely inside `src/config/atendimento-feedback.ts` (`atendimento.tsx` needed no changes for this) — no copy, classification, selection, or trigger-point logic was touched:

- a modest size/prominence increase applied uniformly to every category (slightly more padding, slightly larger text, and this app's own `--shadow-card` value reused for the elevation, so the toast's depth matches every other elevated surface in the app) — still a single-line transient toast, never a banner, modal, or full-screen celebration, no confetti, no large icons, no animation that delays dismissal or operation;
- a soft, category-specific pastel background/border/text-color treatment, applied via sonner's own per-toast CSS custom-property hooks (`--normal-bg` / `--normal-border` / `--normal-text`, plus `--border-radius`) rather than Tailwind classes — this reliably overrides sonner's built-in default styling instead of racing it on CSS specificity:
  - `converted` → light green ("warm / positive / successful");
  - `non_converted` → light blue/calm ("encouraging / forward-looking / neutral-positive") — deliberately never red, pink, gray, or any warning/destructive treatment, so a non-converted outcome never visually reads as failure;
  - `mixed` → **soft lavender/light purple** ("positive / calm / distinct") — see the Epic 2 Stabilization entry below for why this replaced an earlier amber/gold treatment.
- converted/non-converted hues (152° green / 230° blue) intentionally match this app's existing `--success` / `--info` design tokens (`src/styles.css`) at pastel lightness/chroma; mixed deliberately does not reuse `--warning`'s amber (see below) and instead uses a standalone lavender hue (300°) chosen for this purpose only;
- the color differences are explicitly presentation only, never a performance grading — they exist to keep every outcome feeling positive and legible, not to rank customers or employees against each other.

**Final QA status:**

- single converted customer → Converted pool — **PASS**;
- single non-converted customer → Non-Converted pool — **PASS**;
- multiple all-converted customers → Converted pool — **PASS**;
- multiple all-non-converted customers → Non-Converted pool — **PASS**;
- mixed converted + non-converted → Mixed pool (soft lavender/purple) — **PASS**;
- `Farei depois` → reinforcement still appears with the correct customer-outcome category — **PASS**;
- previous-day recovery completion → reinforcement appears correctly — **PASS**;
- standalone checklist completion remains on its own separate success feedback, never the 275-message library — confirmed in code, unchanged by this milestone;
- code-level validation: message-library counts exactly 100 / 150 / 25 with no accidental duplicates/omissions, `npm run typecheck`, `npm run lint`, and `npm run build` all pass cleanly.

Other future Atendimento capabilities remain documented in their respective sections.

### Epic 2 Stabilization — Targeted UX / Business-Rule Corrections

**Status:** IMPLEMENTED / QA COMPLETE

A batch of targeted corrections found during practical Epic 2 regression testing, applied together. Product-owner regression testing on this batch — including the later Dashboard accessibility placement/interaction polish and the previous-day-recovery duration QA investigation (both resolved as described below) — is now complete; this closes Epic 2 for merge purposes (section 16.2 status above).

**1. Mandatory periodic checklist message visibility (Milestone 2C.3).** The neutral explanatory message ("Neste atendimento, conclua o checklist antes de finalizar.") was rendering correctly in every code path audited, but as plain text sharing the same weight/family as the routine checklist subtitle — easy to overlook, and easy to visually conflate with the unrelated amber pending-checklist backlog indicator that can legitimately appear on the same screen. Fixed by giving the mandatory-periodic message its own bordered chip using the `info` (blue) design token — deliberately a different color family from `warning`/amber, which this app already uses for pending/deferred/needs-attention states — so a current mandatory periodic decision and old deferred backlog can never be visually confused. The backlog indicator itself is unchanged and was already structurally independent (`PendingChecklistIndicator` only ever reads `checklist_pendencias` counts, never `checklist_obrigatorio`) — the two remain, and must remain, separate concepts.

**2. Reinforcement Mixed toast color (Milestone 2E).** Changed from light amber/gold to soft lavender/light purple. Amber already means pending work / deferred checklist / needs-attention throughout this app (the backlog indicator, Farei depois, the periodic-mandatory chip above); reusing that family for a positive Mixed-outcome toast created semantic confusion. Lavender (hue 300°, same pastel lightness/chroma as converted/non-converted) is calm, distinct, and unambiguously positive. No change to the 275 approved messages, classification logic, random selection, or anti-repeat behavior.

**3. Administrador Atendimento UX (section 8.5.5/8.5.6).** The Administrador no longer sees personal "Iniciar atividades" / "Iniciar atendimento" participation prompts on `/atendimento` — only the two "you need to start/join" cards were gated off; an Administrador genuinely holding an active Atendimento (however that occurred) still sees its real state. Lista da Vez and every existing management action remain fully visible.

**4. Login/PIN horizontal centering on mobile.** Root cause: the mobile PIN-entry wrapper (`src/routes/index.tsx`) rendered `PinPanel` (`w-full max-w-xs`, no margin-auto of its own) inside a flex-column parent with no `items-center`. Flexbox's default `align-items: stretch` still caps a `max-width`-constrained child at that width, but anchors it to the cross-axis start (left) rather than centering it — on any viewport wider than 320px (effectively every phone), that reads as extra margin on the right only. This reproduces identically in any browser at that viewport width; it was not a Safari-specific or `100vw`/safe-area issue (neither pattern exists in this codebase, and `viewport-fit=cover` was never set, so Safari does not extend content into the safe area here). Fixed by adding `items-center` to that wrapper, matching the desktop split-screen panel, which already centers this exact way. The `Voltar` back button keeps its explicit `self-start` so it is not incidentally re-centered.

**5. Checklist Item 2 guidance (Checklist V2).** Added the two approved guidance bullets under "Arrumar e/ou devolver as peças do atendimento" ("Dobrar ou colocar corretamente no cabide as peças do atendimento." / "Devolver as peças ao local correto ou encaminhá-las para reposição."). Checklist V1 has been live in production since Milestone 2B, and per this project's own checklist-versioning rule, a used version's item content (including guidance) is immutable — so this was implemented as **Checklist V2** (three items, identical to V1 except item 2's `guia_bullets`), not an in-place edit of V1. V1's items were marked `ativo = false`; V2 becomes the active version via the same `max(versao) where ativo = true` resolution every checklist-completion RPC already uses. No new checklist confirmation was added — still exactly three primary confirmations, and the new bullets are guidance only, never separate checkboxes. No RPC or frontend changes were needed beyond the new version's data.

**6. Gerente / Administrador and Lista da Vez auto-join (section 8.5.5).** Vendedor is unchanged (Iniciar Atividades still auto-enters Lista da Vez). Gerente's Iniciar Atividades now records operational readiness only — no automatic Lista da Vez entry — but a Gerente may still manually **Entrar na Lista da Vez** afterward (existing action, unchanged queue-entry/back-of-queue behavior) and retains Sair da Lista da Vez and every existing management action. Administrador does not personally join Lista da Vez at all, automatically or manually — enforced both by hiding the manual-join UI (item 3 above) and, backend-authoritatively, by `entrar_lista_da_vez` rejecting cargo = Administrador outright. This is a fixed cargo rule for now, not a configurable setting — see the new Future roadmap entry below.

**6a. Post-apply audit correction — exclusion vs. inclusion.** After `20260823_002` was applied, an audit found its auto-join gate (`cargo not in ('Gerente', 'Administrador')`) was an *exclusion* check, correct only if `cargo` is provably restricted to exactly those two values plus Vendedor — which nothing in this codebase guarantees (no `cargo` CHECK constraint exists in tracked migration history, the frontend treats `cargo` as an open string everywhere with no enum/union type, and section 2.3 explicitly anticipates future roles beyond the current three). Left uncorrected, any future or currently-unmodeled non-selling cargo (e.g. Caixa, Estoque, Operacional) would auto-join Lista da Vez simply by not being Gerente or Administrador. Corrected additively — `20260823_002` itself was left untouched — by `20260824_001_restrict_lista_vez_auto_join_to_vendedor.sql`, which changes the gate to an *inclusion* check, `cargo = 'Vendedor'`. This is the rule this section's own prose already described ("Vendedor — Iniciar Atividades auto-enters Lista da Vez") — only the SQL's shape was wrong, not the documented intent. `entrar_lista_da_vez`'s `cargo = 'Administrador'` rejection is unaffected — that check correctly needs the opposite shape (broad-allow/narrow-deny: manual join stays available to anyone except Administrador).

**Migrations (additive, not yet applied — apply in order):** `supabase/migrations/20260823_001_add_checklist_v2_item2_guidance.sql`, `supabase/migrations/20260823_002_restrict_gerente_admin_lista_auto_join.sql`, `supabase/migrations/20260824_001_restrict_lista_vez_auto_join_to_vendedor.sql`. None modifies an already-applied migration file. No PostgREST schema reload is required for any of them — every changed function (`registrar_turno_presenca`, `entrar_lista_da_vez`) keeps its exact existing signature (`CREATE OR REPLACE` in place), and the checklist migration is pure data (no function changes at all).

Validated: `npm run typecheck`, `npm run lint`, and `npm run build` all pass cleanly. Product-owner browser regression testing for this entire batch — plus the Dashboard accessibility Aa-trigger interaction (section 14.5) and the previous-day-recovery duration QA-fixture investigation (section 8.14) — is complete and **PASS**.

### Epic 3 — Conhecimento & Cultura

**Status:** IMPLEMENTED / MERGED TO MAIN

**Epic 3 — Conhecimento & Cultura.** See section 12 for the module's purpose and full future content-category list. This epic is the employee-facing broadening of Portal Benvisi beyond Atendimento — starting with a small, demo-quality first slice rather than the whole module at once. Milestone 3A (below) is complete, product-owner browser QA passed (including final tile order/subtitle polish), and `feature/conhecimento-cultura` has been merged into `main`.

### Milestone 3A — Module Foundation + Nossos Princípios

**Status:** IMPLEMENTED

Scope:

- a new Dashboard tile, **Conhecimento & Cultura**, visible to all normal employee-facing roles (not Administrador-only — no compelling reason exists to restrict it, unlike Administrativo);
- a new content hub page, `/conhecimento-cultura` — establishes the module's architecture for future knowledge/culture content; shows a single available content card (**Nossos Princípios**) rather than several disabled placeholders, per this project's "keep the first version clean and intentional" direction;
- a new native page, `/conhecimento-cultura/principios` (**Nossos Princípios**), translating the approved principles poster into an interactive, responsive Portal experience rather than displaying the poster image directly — five principles as accordion rows (one open at a time), each expanding to reveal **Atributos pessoais** and **Valores culturais**. Accordion was chosen over a dedicated detail page or a dialog/sheet: all five principles stay visible as a scannable list at all times, expansion needs no navigation or back-stack entry, and it works identically on touch and desktop (no hover-only interaction);
- content lives in a dedicated typed config module, `src/config/principios.ts` (a `Principio[]` array — `id`, `titulo`, `icon`, `atributosPessoais`, `valoresCulturais`), rendered generically by the accordion rather than one hardcoded card per principle — adding or editing a principle later means editing this array, not duplicating markup;
- the five principles and their exact approved attributes/values (Integridade, Foco no Cliente, Colaboração, Transparência, Qualidade) are reproduced verbatim from the approved source content — no reinterpretation, no added/removed values;
- visual language reuses existing Portal Benvisi tokens/components (`ModuleCard`, `Card`-style rounded/bordered containers, the `--brand` dark-green accent, existing `Accordion` primitive) — not a new disconnected design system, and not a pixel-for-pixel poster recreation;
- `Texto maior` requires no new code — every string renders through ordinary Tailwind `text-*` utilities, so the existing typography-scale override already covers this page automatically;
- no Supabase table, no migration, no admin content editor, no runtime AI — this is static application content for Milestone 3A, matching the project's "no unnecessary backend complexity for static content" principle.

**Not implemented in Milestone 3A** (future content categories under Conhecimento & Cultura, section 12): Lacoste/brand knowledge, product knowledge, selling/customer-service knowledge, operational training, knowledge-check quizzes, AI-generated training material. The hub page's architecture anticipates these as additional cards later; none are scaffolded or implied as already available. See "Princípios em Ação" below (section 12) for an additional future capability documented, but not implemented, during this milestone's closeout.

**QA status:** Dashboard tile presence, the Conhecimento & Cultura hub, the Nossos Princípios card, all five principles/content, the accordion interaction, back navigation, mobile layout, `Texto maior`, desktop layout, and the final Dashboard tile order/subtitle polish (tile moved to the last normal employee-facing position; subtitle shortened to "Princípios, produtos e formas de trabalhar.") — all **PASS**.

Validated: `npm run typecheck`, `npm run lint`, and `npm run build` all pass cleanly.

### Epic 4 — Operações

**Status:** IN DEVELOPMENT

**Epic 4 — Operações.** See section 10 for the module's full future scope. This epic implements Operações' first real (non-placeholder) content, starting with small, focused resources rather than the whole roadmap at once. The epic itself stays **IN DEVELOPMENT** even though Milestones 4A (Links Importantes), 4B (Mensagens para WhatsApp), and 4C (Escala V1) are complete and QA-passed — more Operações features (next likely Consulta de Estoque) are still planned.

**Near-term sequence (also drives an upcoming product demo, not purely technical priority):**

1. Conhecimento & Cultura — Nossos Princípios (Milestone 3A) — **complete**;
2. Operações — Links Importantes (Milestone 4A, below) — **complete, QA passed**;
3. Operações — Mensagens para WhatsApp (Milestone 4B, below) — **complete, QA passed**;
4. Operações — Escala V1 (Milestone 4C, section 10) — **complete, QA passed** (4C.1 foundation + 4C.2/4C.3 employee-facing Dia/Semana/Mês UI; the real Excel publish/import flow remains future V1.1 scope);
5. after evaluating Escala V1's complexity/quality in practice, likely move into Consulta de Estoque (section 9).

Escala V1 and Consulta de Estoque are **not** implemented by this sequence entry — they remain future/planned scope (section 10 / section 9) until their own milestone is completed.

### Milestone 4A — Links Importantes

**Status:** IMPLEMENTED / QA COMPLETE

Scope:

- a second active card on the `/operacoes` hub (alongside Mensagens para WhatsApp, Milestone 4B), navigating to `/operacoes/links-importantes`; the rest of the Operações roadmap (section 10) remains unrepresented on the hub — no disabled placeholder cards;
- exactly three approved resources, driven by a typed `ImportantResource[]` config module (`src/config/links-importantes.ts`), rendered generically by resource `type` rather than one hardcoded card per resource:
  - **Canal de Denúncia Segura e Sigilosa** (`external_link`) — an external Google Form (`https://forms.gle/w5UbXZ7BPwkUEzaLA`) opened via `target="_blank" rel="noopener noreferrer"`, with the approved description, supporting sigilo text, and an explicit "O formulário é externo ao Portal Benvisi." note. Portal does not store, receive, or process the complaint content itself — the form is entirely external, matching this project's "trusted doorway to external systems" principle (see also section 12, Sensitive HR issues, under Princípios em Ação);
  - **YOOBIC ONE** (`mobile_app`) — a primarily-mobile app; the page shows the approved instruction text and two official store links (App Store, Google Play) opened the same safe external way. No deep-link URI was invented and no in-app-open behavior is assumed — V1 is deliberately just instruction + official store links;
  - **CRM360** (`mobile_app`) — same treatment/pattern as YOOBIC ONE, its own approved store URLs.
- no Supabase table, no migration, no admin editor — static approved content, matching the same architecture already established for Nossos Princípios (Milestone 3A) and Conhecimento & Cultura generally.

Validated: `npm run typecheck`, `npm run lint`, and `npm run build` all pass cleanly. Product-owner browser QA — including the Denúncia form, both app-store link pairs, mobile layout, and `Texto maior` — is complete and **PASS**.

### Milestone 4B — Mensagens para WhatsApp

**Status:** IMPLEMENTED / QA COMPLETE

Scope:

- a second active card on the `/operacoes` hub, navigating to `/operacoes/mensagens-whatsapp`;
- purpose: fast access to approved WhatsApp customer-service message templates, so employees can find, copy, personalize (placeholders), and paste into WhatsApp without searching PDFs/old messages/memory;
- content lives in a typed static config module, `src/config/mensagens-whatsapp.ts` (`WhatsAppMessageGroup[]`, each holding `WhatsAppMessage[]`), rendered generically by a nested accordion — outer level shows the 6 approved groups (Mensagens iniciais, Responder com informações detalhadas, Sondar interesse em outros produtos, Finalizar a venda, Finalizando a conversa, Sobre a loja), inner level shows each situation; expanding a situation reveals the approved message text and a **Copiar mensagem** action;
- 6 groups, 17 individually copyable messages in total, reproduced verbatim from the approved Lacoste Manaus WhatsApp guidance document — no rewritten/"improved" Portuguese copy. Placeholders (`XXXXXX`, `PRODUTO`, `TAMANHO`, `COR`, `PREÇO`, `PRODUTO COMPLEMENTAR`) are preserved as-is for the employee to personalize after copying;
- **Técnica CVB was removed from this milestone during closeout** (originally 7 groups / 21 messages) — those four examples are sales/product training content, not ready-to-send customer message templates, and are retained instead as a FUTURE Conhecimento & Cultura content category (section 12);
- copy-to-clipboard preserves the approved paragraph/list formatting. The stored content already uses real line-break characters matching the approved source exactly (verified directly, not assumed), and the on-screen `<p>` and the copied clipboard text both render from that same unmodified string (`white-space: pre-line` on screen), so display and clipboard stay aligned by construction rather than by two separately-maintained formatting rules. The clipboard payload additionally normalizes line endings to CRLF (`\r\n`) — a defensive, display-invisible measure for paste targets that expect CRLF for multi-line plain text — since a product-owner QA report described paragraph breaks not surviving a WhatsApp paste despite the source content already being correct;
- copy uses the browser Clipboard API (`navigator.clipboard.writeText`) inside the button's click handler; success shows a lightweight `sonner` toast ("Mensagem copiada."), failure shows a distinct fallback toast and never crashes — the message text stays visible either way so the employee can select/copy it manually. No copy history is stored, no employee-level copy tracking of any kind;
- explicitly **not** implemented in this milestone: sending the message, WhatsApp API integration of any kind, automatic placeholder personalization, storing customer conversations, or AI-generated alternative messages;
- no Supabase table, no migration, no admin editor — content can evolve later through an explicit version/update decision, same as Milestone 4A.

**Content-maintenance note:** "Explicar o processo do envio do link" has approved, correct formatting as of this closeout, but the product owner intends to review/update its wording in a future content pass. This is not a blocker for Milestone 4B completion — do not rewrite this template's copy without that explicit future decision.

Validated: `npm run typecheck`, `npm run lint`, and `npm run build` all pass cleanly. Product-owner browser QA — including the Técnica CVB removal, the final 6-group/17-message structure, copy-to-clipboard behavior, paragraph/list formatting preserved on paste (payment-policy list, Frete, simple single-paragraph messages), on-screen/clipboard alignment, `Texto maior`, and mobile layout — is complete and **PASS**.

### Milestone 4C — Escala V1

**Status:** IMPLEMENTED / QA COMPLETE

4C.1 (foundation) + 4C.2 (employee-facing Dia / Semana / Mês UI) + 4C.3 (provisional data import, Gestão model change, QA revisions + polish) are all implemented and applied. Product-owner browser QA is complete and **PASS** — covering the 4C.2 rounds (normal weekday, Sunday/single-shift, Intermediário, Folga/Férias, Gestão visibility) and the 4C.3 revisions (colour-coded sections, section-hours-in-heading, section reorder, Gestão bucketing + withheld manager hours, `Dia` rename, Mês→Dia navigation, apelido-first identity, shared `AuthUtilityBar`, `/operacoes` tile reorder). Provisional September 2026 data is loaded into the production Supabase project as test data.

**Carried FUTURE / OPEN items (none are blockers for closing this milestone; do not implement as part of it):**

- replace the provisional September 2026 workbook data with the real published workbook before real rollout;
- Gestão / Favacho consistency refinement — how consistently a gerência member should appear on Escala when no explicit schedule entry exists (accepted as-is for V1; see the OPEN / FUTURE note under Milestone 4C.3);
- real employee `email` addresses (still `NULL` for all eight — never invented);
- the real Excel → structured-data UUID / technical-column mapping and publish flow (V1.1 — see below);
- a maintained `feriados` (holiday) dataset + Admin holiday-management UI;
- PIN security / Minha Conta roadmap (see Future — Minha Conta / Alterar PIN);
- real Admin account converted/renamed **in place** during rollout prep, not duplicated (see Future — Rollout Preparation & Access Architecture);
- Observador / non-employee read-only access as a separate principal + capability model (same section);
- rollout-time cleanup of real-employee pre-launch test history (same section);
- optional future annual Terms reaffirmation on top of the existing version-driven model (same section);
- "Celebrações de hoje" (birthdays / work anniversaries) — deferred, needs a new RPC (see 4C.2 Known Gaps);
- Supabase CLI / `supabase db push` adoption remains unverified future work (see Milestone 4C.3's migration-workflow note).

**Approved V1 architecture:** Excel remains the schedule-authoring tool (the current copy-previous-month / owner-assigns-shifts-via-dropdowns workflow works adequately and is not being replaced). Portal is initially a **publishing/consumption layer**, not a schedule editor:

```text
Excel (authoring, unchanged)
        ↓
structured publish/import step (future sub-milestone)
        ↓
Supabase (this milestone's schema)
        ↓
native mobile-friendly Portal Escala (future sub-milestone)
```

**Approved V1 views** (implemented — see Milestones 4C.2/4C.3 below): **Dia** (default; whole-team schedule for one date; sections shown only when applicable — MANHÃ, INTERMEDIÁRIO, TARDE, FOLGA, FÉRIAS, A CONFIRMAR; the separate GESTÃO section was removed in 4C.3 — gerência employees are bucketed normally), **Semana** (7 stacked day cards, mobile-first), **Mês** (personal "Minha Escala" for the authenticated employee). Also implemented: subtle highlighting of the authenticated employee; previous/next date navigation; America/Manaus as the default current date; previous/current month access, future month access only if explicitly published; holiday name/context on the relevant date. **Not yet implemented:** a "Celebrações de hoje" area for birthdays/work anniversaries — the funcionarios metadata exists, but exposing it safely requires a new RPC (no anon-facing query currently returns `aniversario_dia`/`aniversario_mes`/`data_admissao` for the whole team) — deferred rather than built around the existing schema; see Milestone 4C.2's Known Gaps.

**Employee function display:** normal day/week rows show only name + time (e.g. "Amanda — 10:00–16:00"), never cargo — the team is small enough that it would be visual noise. `cargo` is retained in the data model since it may become useful later; richer role/function display is FUTURE, not approved for now.

**V1.1 (future):** a proper Admin → Importar Escala workflow — workbook upload, preview, validation, publish — replacing the deliberately lightweight V1 approach (Excel → deterministic local conversion → validation/preview → structured data → publish into Supabase, without an in-Portal upload screen).

**Further future (not approved for implementation now):** richer role/function display, if ever genuinely useful; Admin holiday management UI; schedule authoring inside Portal (replacing Excel as the authoring tool); shift-swap requests/approvals; notifications; audit/history browsing UI; Minha Conta / Alterar PIN and PIN-security modernization (own entry below).

### Milestone 4C.1 — Escala Foundation

**Status:** IMPLEMENTED — migrations `20260825_001`–`20260825_005` have been applied by the product owner via the Supabase SQL Editor.

Establishes the employee data, backend schema, publishing rules, and domain logic the future read-only Escala UI and future Excel publish/import flow will both build on. **No employee-facing Escala UI, no Excel upload/import tooling, and no real September (or any other month's) schedule data are part of this milestone** — those are explicitly deferred to their own sub-milestones once this foundation is reviewed/applied.

**funcionarios metadata additions** (migration `20260825_001`):

- `aniversario_dia smallint`, `aniversario_mes smallint` — birthday celebrations. Day/month only, **no birth year stored anywhere** (not even inside a fabricated date) — the product requirement explicitly excludes age/birth year from Portal's data model. Both-or-neither and day-valid-for-month are enforced by a CHECK constraint (Feb capped at 29, since a birth year is never known and Feb 29 without a year cannot be fully validated either way);
- `data_admissao date` — work-anniversary celebrations ("X anos de Benvisi") are always derived from this date at read time, never stored redundantly as a separate "years of service" number;
- `escala_grupo_gestao boolean not null default false` — Gestão schedule-block **membership** (documented decision, in full in the migration's header comment): deliberately separate from `cargo`, because a future Gestão group may include more than one employee, possibly under a different cargo than 'Gerente' — coupling membership to a specific job title would break the moment that stops being 1:1. **Visibility** (who may *view* the Gestão block) is the separate, never-stored, server-side rule `cargo = 'Administrador' OR escala_grupo_gestao = true`, computed at query time inside the read RPCs — Administrador can view the block without being a scheduled Gestão member itself (mirrors the existing precedent that Administrador never personally participates in Lista da Vez/Atendimento);
- `cargo` widened from an unconstrained column (confirmed once again, dynamically, that no CHECK constraint existed under any name — the same gap 20260824_001 had already flagged) to an explicit `CHECK (cargo in ('Vendedor','Caixa','Gerente','Administrador'))`, adding the new **Caixa** cargo the real roster requires. A future new cargo needs its own additive migration widening this same constraint.

**Real employee roster** (migration `20260825_002`, corrected by `20260825_005`): inserts the 8 real active employees supplied by the product owner. Existing development/test employees are left completely untouched — this migration only adds rows. `email` is `NULL` for all eight (not yet supplied — never invented). `token_pin` is seeded as the approved provisional `'1111'`, matching this project's *current* plaintext-PIN architecture exactly (no PIN-security change is made here — see the Future — Minha Conta / Alterar PIN entry below). DAYANNA MOTA CAVALVANTE is inserted as `cargo = 'Vendedor'` per explicit product-owner instruction, not the historical workbook's operator/cashier labeling. Employee sex, present in the source spreadsheet, is **not** stored — no approved Portal feature needs it.

**Correction — `20260825_005`:** applying `20260825_002` initially failed — `funcionarios.email` carried a `NOT NULL` constraint invisible anywhere in tracked migration history (the same untracked-legacy-constraint gap already seen with `cargo`), and since real emails were not available, `NULL` (the only correct value here) was rejected. Because the failed `INSERT` rolled back entirely (Postgres never partially applies a failed statement), `20260825_002` needed no changes — `20260825_005` (`ALTER TABLE funcionarios ALTER COLUMN email DROP NOT NULL`) was applied first as a new additive corrective migration, then `20260825_002` was re-run successfully. `20260825_001`–`20260825_004` were never edited.

**Escala core schema** (migration `20260825_003`):

- `loja_horario_padrao` (7 rows, one per weekday) + `loja_horario_excecao` (special-date overrides, e.g. holiday hours or a full closure) — resolved for any date by the internal `loja_horario_do_dia(date)` helper, avoiding per-calendar-day duplication;
- `feriados` (date, nome, abrangencia: nacional/estadual/municipal) — foundation only; no Admin management UI/RPC yet (future, Admin-only when built — employees only ever see holiday context contextually on the relevant Escala day, never a configuration screen);
- `escala_classificar_turno(hora_inicio, hora_fim, abertura, fechamento)` — the approved MANHÃ/TARDE/INTERMEDIÁRIO derivation, pure backend domain logic (no stored labels): MANHÃ starts at opening and leaves before closing; TARDE starts after opening and stays until closing; INTERMEDIÁRIO is neither; a single shift spanning the entire operating window (Sunday/holiday reduced-hours case) is force-classified TARDE rather than falling through to neither bucket;
- `escala_publicacoes` (one row per publish event; `mes_referencia` always the 1st of the month) with a **partial unique index** enforcing at most one `ativa = true` row per month — this is what makes "publishing a revised month replaces the previous published version" true structurally, while every prior publication remains as `ativa = false` history (no version-management UI, but audit/history is not precluded);
- `escala_entradas` (one row per employee per day per publication; `status` in `trabalho`/`folga`/`ferias`; `hora_inicio`/`hora_fim` required iff `trabalho`). **A missing (employee, date) row — not a row with a placeholder status — is the only representation of "A confirmar."** This is enforced by construction: nothing in this schema ever writes a null-status row, so a blank can never be silently read back as FOLGA;
- every new table follows the exact RLS pattern already established for `funcionarios`/`sessoes_funcionario`: RLS enabled, zero policies, all access through SECURITY DEFINER RPCs only.

**Read RPCs** (migration `20260825_004`), all session-authenticated and SECURITY DEFINER, matching this project's established RPC pattern exactly:

- `get_escala_periodo(session_token, data_inicio, data_fim)` — team schedule for a date range (capped at 31 days), powering both the future Hoje (1-day range) and Semana (7-day range) views with one RPC. Gestão rows are never included in the payload for a caller who isn't Administrador or a Gestão member — enforced server-side, not filtered client-side;
- `get_minha_escala_mes(session_token, mes)` — the caller's own schedule for one calendar month, powering the future Mês/Minha Escala view; no Gestão check needed since it only ever returns the caller's own data;
- `list_escala_meses_publicados(session_token)` — which months currently have an active publication and when, so a future UI can decide which months are navigable without duplicating that logic per navigation control.

No write/publish RPC exists yet — the atomic "insert new publication + deactivate the previous one" operation is intentionally left to the next sub-milestone (the structured Excel → Supabase publish step), once that conversion/validation flow is designed. This migration only guarantees the schema cannot end up with two simultaneously-active publications for the same month, however that future insert happens.

**Validation foundation:** the schema does not prevent a future publish-time check for "which active roster members are missing an entry for the dates in this publication" (a straightforward anti-join between the active-roster set and `escala_entradas` for the target `id_publicacao`) — that check itself belongs to the future publish/import sub-milestone, not this one.

**Not implemented in 4C.1** (deferred to 4C.2 or later): the Escala employee-facing UI (now built — see Milestone 4C.2); the Excel → structured-data conversion and publish RPC; Admin holiday management UI; the provisional September 2026 schedule import; celebrations UI/RPC; any schedule editor, shift-swap, approval, notification, staffing-optimization, or payroll/time-clock logic — all remain future/out-of-scope per this milestone's approved boundary.

Validated: `npm run typecheck`, `npm run lint`, and `npm run build` all pass cleanly (no frontend code was part of this milestone). All five migrations have been applied by the product owner via the Supabase SQL Editor.

### Milestone 4C.2 — Escala UI (Hoje / Semana / Mês)

**Status:** IMPLEMENTED / QA COMPLETE

Builds the first usable Escala experience on top of 4C.1's applied schema/RPCs. New route `/operacoes/escala`, reached via a third card on the `/operacoes` hub (Dashboard → Operações → Escala).

**Page structure:** a single route with three tabs — **Hoje** (default), **Semana**, **Mês** — sharing one selected reference date (switching from Hoje to Semana keeps the same date) and, separately, one selected month for Mês. No separate routes per view, consistent with "do not introduce duplicate navigation concepts."

**Hoje:** PT-BR date header ("Terça-feira, 15 de setembro", no year), prev/today/next-day navigation, holiday name surfaced under the header when `get_escala_periodo` returns one for that date. Team entries grouped into MANHÃ / INTERMEDIÁRIO / TARDE / FOLGA / FÉRIAS / A CONFIRMAR / GESTÃO, in that display order, with empty sections omitted entirely — including an empty MANHÃ on Sundays/single-shift dates, since the backend's `escala_classificar_turno` already resolves those to TARDE. Within each section, employees are sorted alphabetically by `apelido` (their display name — job title/cargo is never shown, per the approved "Amanda — 10:00–16:00" format). The authenticated employee's own row gets a subtle border/tint plus an explicit "(Você)" text label — never color alone. If the viewed date's month has no active publication, Hoje shows one calm "Esta escala ainda não foi publicada." message instead of the grouped listing — distinct from `ESCALA_ERRO_MESSAGE`, which only appears for a genuine query error (see QA Round 1 fixes below).

**Semana:** seven stacked day cards starting from the currently-selected reference date (a rolling 7-day window, not calendar-week-aligned — chosen to avoid an unspecified Sunday-vs-Monday boundary decision and to carry over naturally from Hoje). Each card is a compact version of Hoje's grouping (same component, `compact` mode only suppresses the "A confirmar" support line) — no Excel-matrix reproduction, no horizontal scrolling. Since a 7-day window can span two calendar months, each card independently checks its own month's publication state and shows the same calm "not published" message rather than assuming the whole week shares one answer.

**Mês / Minha Escala:** the authenticated employee's own schedule for the selected month, one row per day, showing time range or Folga/Férias/A confirmar plus holiday context. Month navigation is prev/current always enabled; the next-month arrow is disabled unless `list_escala_meses_publicados` includes that month — satisfying "previous month; current month; a future month only if explicitly published" without an extra ad hoc check per control. If the *currently viewed* month has no active publication, the view shows one clear "Este mês ainda não foi publicado." message instead of 28–31 repeated "A confirmar" rows (the RPC always returns one row per calendar day, so an unpublished month would otherwise read as noisy repetition rather than a clear explanation).

**Gestão visibility:** purely a consequence of what `get_escala_periodo` returns — a regular employee's payload simply never contains any gerência row, so the caller cannot see gerência people at all; no client-side hiding exists to bypass. `get_minha_escala_mes` needs no such check since it only ever returns the caller's own data. (4C.2 rendered gerência people in a dedicated GESTÃO section; 4C.3 removed that section but kept this visibility rule and additionally withholds the manager's hours.)

**Data/contracts:** `src/integrations/supabase/contracts.ts` gained `EscalaEntradaPeriodo`/`EscalaEntradaMes`/`EscalaMesPublicado` types + type guards, matching this project's existing runtime-validation convention exactly (e.g. `isListaVezEntry`). Three new hooks (`useEscalaPeriodo`, `useMinhaEscalaMes`, `useEscalaMesesPublicados`) follow the established `useQuery` + `useSessionErrorHandler` pattern — no polling, since a published schedule does not change during a session. A new `src/lib/escala.ts` holds pure date/grouping helpers (calendar-date arithmetic pinned to UTC to avoid local-timezone drift; PT-BR header formatting; alphabetical section grouping).

**Known Gaps (explicitly not done in 4C.2, not silently skipped):**

- **Celebrações de hoje (birthdays/work anniversaries) — not implemented.** No RPC currently exposes `aniversario_dia`/`aniversario_mes`/`data_admissao` for the whole team (both are protected by RLS with no policies, like every other Escala table, and neither `get_escala_periodo` nor `get_minha_escala_mes` returns them). Implementing this would require a new RPC — per the approved instruction to stop and report rather than build around an unapplied migration, this was not attempted. A small additive migration (e.g. `get_celebracoes_do_dia(session_token, data)`) can be proposed in a follow-up round if wanted.
- **Provisional September 2026 import — DONE in Milestone 4C.3** (workbook `tmp/ESCALA DE TRABALHO.xlsx`, sheet `setembro 2026`). Superseded — see 4C.3 below.
- **Supabase MCP execution — now available and used** from Milestone 4C.3 onward. Superseded.
- **Nearby-date strip on Dia** (mentioned as optional — "if it remains clean on mobile") was not built; prev/today/next arrows were judged sufficient for V1 and simpler to keep accessible.

**QA Round 1 fixes (this round):**

- **Desktop segmented-control alignment.** Root cause: `TabsList`'s base style fixes `h-9` (36px), while each `TabsTrigger` was given `min-touch` (`min-height: 44px`) — taller than its own fixed-height parent, so the active segment protruded above/below the gray container instead of sitting inside it. Fixed by making the list's height intrinsic (`h-auto`) and applying the touch-target sizing to the triggers themselves (`min-h-11`), so the container grows to contain all three segments cleanly on both desktop and mobile.
- **Unpublished vs. technical-error distinction.** Code audit found no path where "no publication exists" would cause `get_escala_periodo` to throw — an unpublished month is a normal, successful response (every active employee returned as `a_confirmar`), so `query.isError` should never have been true for that case alone; the exact trigger behind the specific QA report could not be reproduced without live session/browser access this round. Regardless of that specific root cause, Hoje and Semana now explicitly check `list_escala_meses_publicados` (the same source Mês already used) and show a calm "Esta escala ainda não foi publicada." message whenever the viewed date's month has no active publication, reserving `ESCALA_ERRO_MESSAGE` ("Não foi possível carregar a escala. Tente novamente.") strictly for a genuine query error. A publication that exists but is missing a few specific entries still renders those correctly under A CONFIRMAR — only a fully unpublished month is replaced by the calm message.

Validated: `npm run typecheck`, `npm run lint`, and `npm run build` all pass cleanly.

**Browser QA (product owner): PASS** for all of QA1–QA5 (normal weekday, Sunday/single-shift, Intermediário, Folga/Férias, Gestão visibility). Follow-up UI/logic requests from that pass are implemented in Milestone 4C.3 below.

### Milestone 4C.3 — Escala: provisional data import, Gestão model change, QA revisions + polish

**Status:** IMPLEMENTED / QA COMPLETE — implemented in code, applied to Supabase, and browser QA of the revisions is complete and **PASS**.

Supabase MCP became available this milestone and was used directly (project `ugfogsseikupsfqqznzi` — the org's only project, `main` branch labelled PRODUCTION; there is no separate development project). All prior migrations `20260720_001`…`20260825_005` had been applied by hand via the SQL Editor and were never tracked; `supabase_migrations.schema_migrations` was backfilled once so all 26 files are recorded as applied (version + name only — the 26 backfilled rows carry no statement body; `20260826_001`…`003` were then applied through MCP `apply_migration`).

**Migration workflow — current approved process.** `supabase db push` / the Supabase CLI are **not** in use and are **not** confirmed safe against this repo yet. The repo's `YYYYMMDD_NNN_name.sql` filename convention does not match the CLI's expected `<digits>_<name>` parse (it would read the version as the 8-digit date only, colliding across the several files that share a date), and the backfilled ledger stores 11-digit `YYYYMMDDNNN` versions, so a stock `db push` could try to re-apply or reject the existing history. Until that convention is normalized and the CLI round-trip is verified, the approved process is:

1. write the change as a tracked local migration file under `supabase/migrations/` (keep the existing `YYYYMMDD_NNN_name.sql` naming for now — do **not** rename historical files);
2. apply it via Supabase MCP `apply_migration` (preferred) or manually in the SQL Editor;
3. verify the applied objects/data directly (MCP `execute_sql` / advisors);
4. treat the applied migration as immutable history — never edit or re-run it; corrections go in a new additive migration.

CLI / `db push` adoption is deferred future work, gated on (a) deciding whether to rename historical files to 14-digit timestamps and re-backfill the ledger to match, and (b) verifying a full `supabase migration list` / `db push` round-trip against the remote.

**Root-cause fix — `get_escala_periodo` (migration `20260826_001`).** The RPC declared `RETURNS TABLE(… nome text, apelido text …)` but `funcionarios.apelido` is `citext`. PL/pgSQL `RETURN QUERY` enforces exact type equality and raised `42804 … Returned type citext does not match expected type text` on **every** call — so Hoje/Semana always showed `ESCALA_ERRO_MESSAGE`, regardless of publication state (Mês/`list_escala_meses_publicados` were unaffected — they don't select `apelido`). Fix: `f.apelido::text` / `f.nome::text` casts; nothing else changed. This was the real backend error the earlier "unpublished vs technical error" QA note had been chasing without live DB access.

**Gestão model change — dedicated GESTÃO section removed (migration `20260826_002`).** Per browser-QA decision: an employee with `escala_grupo_gestao = true` is now classified into the normal buckets (MANHÃ / INTERMEDIÁRIO / TARDE / FOLGA / FÉRIAS / A CONFIRMAR) via `escala_classificar_turno`, exactly like everyone else. Two things are preserved: (1) **visibility is unchanged** — a caller who is neither Administrador nor a Gestão member still receives no row at all for a gerência employee (same WHERE clause); (2) **the manager's individual hours are still withheld** — `get_escala_periodo` and `get_minha_escala_mes` return `hora_inicio`/`hora_fim` as `NULL` for a gerência `trabalho` row (the real stored times are still used to pick the section, just not displayed), so their row renders name-only. The `EscalaSecao` type, `ESCALA_SECAO_LABELS`, `ESCALA_SECAO_ORDEM`, and `isSecaoComHorario` all dropped `'gestao'`.

**Employee-facing identity — prefer `apelido`, fall back to `nome` (migration `20260826_003`).** Approved product rule: everywhere the UI greets or labels an employee informally it now shows `funcionarios.apelido`, degrading to `nome` only when apelido is NULL/blank (`coalesce(nullif(btrim(apelido::text), ''), nome::text)` — defensive only, since apelido is currently NOT NULL and populated for every row). Scope, all additive / behavioural with no data changes: `verify_pin` gains an `apelido` output column (DROP + CREATE, its only signature change — nothing depends on it beyond the PostgREST RPC call); `get_lista_vez_estado`'s existing `nome` display column and `get_atendimento_ativo`'s `iniciado_por_nome` column both become apelido-first with no signature change. The formal name is untouched in `funcionarios.nome` and in `list_active_employees` (the login picker still shows full legal names). Frontend: `VerifyPinSuccess`/`AuthSessionData` carry `apelido` (with runtime guards), `useLogin` persists it into the session, and the Dashboard greeting renders `session.apelido || session.nome`. Escala already displayed `apelido` and is unchanged.

**Provisional September 2026 import.** Source: `tmp/ESCALA DE TRABALHO.xlsx`, sheet `setembro 2026`. Normalised to 231 `escala_entradas` rows under one active `escala_publicacoes` row (`mes_referencia = 2026-09-01`, `publicado_por` = the Administrador fixture). 8 employees mapped to existing `funcionarios.id` (Amanda, Graça, Renan, Elisieth, Vitor, Dayanna, Sara, Favacho). Excluded, by construction: the staffing-analysis rows (`Vendedor/Caixa diurno/noturno`), the `Folgas` tally column, all Férias/Folga note columns, free-text notes, Aug-30/31 + Oct spillover columns, and `MONICA` (no `funcionarios` row, and no schedule cells anyway). `FAVACHO`'s weekday cells read `MANHÃ`/`TARDE` (no times) — mapped to the workbook's two canonical windows (`10:00–16:00` / `16:00–22:00`) purely to drive section classification; his displayed hours are withheld anyway. He has entries for only 21 of 30 days (the sheet leaves the rest blank → A CONFIRMAR). Verified: publication active; 231 rows = 166 trabalho + 36 folga + 29 férias; 0 duplicate `(id_funcionario, data)`; 0 rows for test/admin employees; 0 rows outside Sep 1–30; Gestão visibility holds when replaying the RPC's filter for each caller type. This is provisional test data and will be replaced when the real workbook is available.

**UI revisions (browser QA complete, PASS):**

- **Colour-coded sections** (`src/config/escala-sections.ts`, light-theme oklch tints applied inline): MANHÃ amber/"sunrise", TARDE light blue, INTERMEDIÁRIO soft lavender (the Mixed-Atendimento family), FOLGA green (matches the legacy Excel), FÉRIAS near-neutral grey, A CONFIRMAR soft red. Each section is a colour-bounded block with its rows tinted a step stronger; the "(Você)" row keeps its primary border/tint override. Carried into Semana's day cards and Mês's day rows.
- **Section hours in the heading, not per row.** When every working member that has hours shares one start/end window, it is shown once next to the section label (`MANHÃ · 10:00–16:00`) and omitted from the rows. Gerência members (withheld hours) are ignored for this test — they never contribute a time in the heading or on their row, and their presence does not force the section back to per-row times. Only genuinely differing windows fall back to per-row times.
- **Section order** (`ESCALA_SECAO_ORDEM`): MANHÃ → INTERMEDIÁRIO → TARDE → FOLGA → FÉRIAS → A CONFIRMAR (each shown only when populated).
- **`Hoje` tab renamed `Dia`** — the tab shows any single day, not only today; the separate "Hoje" quick-jump button keeps its name. The route's tab state is now controlled.
- **Mês → Dia navigation:** each day row in Minha Escala is a button that switches to the Dia tab focused on that date (Semana intentionally not made navigable this way).
- **Shared bottom utility bar (`src/components/layout/AuthUtilityBar.tsx`).** The "Texto maior" (Aa) control + "Sair", previously assembled inline only on the Dashboard, are extracted into one component rendered as the last child of every authenticated route's `<main>` (Dashboard, Operações hub + all three Operações pages, Conhecimento & Cultura hub + Princípios, Atendimento, Administrativo) and on Termos (`showSignOut={false}` there — Termos has its own accept/decline pair). Same normal-document-flow placement and interaction model as before, now consistent across the whole authenticated surface. `TextSizeToggle` moved from `src/components/dashboard/` to `src/components/layout/` with no behavioural change. Deliberately a per-route component, not a router layout route — the routes share no layout wrapper today; a future layout route could host it.
- **`/operacoes` hub tile reorder** (product-owner approved): Escala → Mensagens para WhatsApp → Links Importantes (see section 10's Operações note).

Validated: `npm run typecheck`, `npm run lint` (0 errors; 6 pre-existing `react-refresh` warnings in `src/components/ui/*`), and `npm run build` all pass cleanly. (One prettier stray-blank-line error in `src/routes/dashboard.tsx`, left by the utility-bar extraction, was the point the prior validation run was interrupted at — fixed.)

**Browser QA (product owner): PASS.** Escala V1 (Milestone 4C in full) is closed as IMPLEMENTED / QA COMPLETE. Remaining scope is tracked as FUTURE / OPEN under Milestone 4C's status and the Future — Rollout Preparation & Access Architecture entry; none of it blocks closing this milestone.

**OPEN / FUTURE — Gestão consistency on Escala.** The current V1 Gestão behavior is **accepted as-is**: gerência members are bucketed into the normal shift sections by their stored hours, their individual hours are withheld (name-only rows), and non-privileged callers receive no gerência row at all. The product owner may later refine *how consistently* Gestão/Favacho should appear on Escala when there is **no explicit schedule entry** for a given day (e.g. whether a manager with no entry should still surface as "present", or how Favacho's currently-blank days — which fall through to A CONFIRMAR — should read). This is a presentation/product refinement, **not a current bug or blocker**, and nothing should be implemented for it now.

### Future — Minha Conta / Alterar PIN

**Status:** FUTURE — documented now per Milestone 4C.1, not implemented

Prompted by seeding provisional `'1111'` PINs for the new real employee roster (acceptable for now, matching the *current* plaintext-PIN architecture exactly — no PIN-related code was changed in Milestone 4C.1). A dedicated future account/security milestone should eventually provide:

- employee authenticated first, then may change their own PIN;
- voluntary PIN change requires the current PIN;
- a newly-created employee may be required to change a temporary PIN on first login;
- Admin can reset an employee's PIN but can never retrieve their chosen PIN;
- PIN stored as a secure hash rather than plaintext (a real migration of `funcionarios.token_pin` and `verify_pin`'s comparison logic — not attempted in 4C.1, and not to be attempted opportunistically inside any other milestone);
- possible supporting fields such as `pin_must_change` / `pin_updated_at`;
- no elaborate self-service password recovery needed for this small internal team — Admin reset is sufficient initially.

Do not implement this without a dedicated milestone; do not modify `verify_pin` opportunistically elsewhere.

### Future — Rollout Preparation & Access Architecture

**Status:** FUTURE — captured for the roadmap, none of it approved for implementation now. Each item below needs its own decision/milestone.

- **Terms stay version-driven; optional annual reaffirmation later.** The current model (`termos_aceite` unique on `(id_funcionario, versao_termo)`; `check_termo_acceptance` is existence-by-version; bumping the `TERMS_VERSION` constant re-prompts everyone and keeps prior acceptances as history) is sufficient and is the accepted approach. A later refinement *may* add a server-side source of truth for the current version (e.g. a `termos_versoes` table with an effective date) and/or an age-based reaffirmation rule (re-prompt when the latest acceptance is older than ~12 months). Not needed for rollout.
- **Real Admin account — convert in place, do not duplicate.** The existing `Administrador` fixture (`Admin Teste`) is already referenced by preserved data (it is `escala_publicacoes.publicado_por` for the September publication, plus `checklist_config.atualizado_por` and other non-cascading references). When a real Admin identity is needed, rename/re-point that row in place (keep its UUID) and set a real strong PIN — do **not** create a second Administrador row and retire the first.
- **Observador / non-employee access — separate principal, not `funcionarios`.** Read-only non-employee accounts must be modelled as their own principal + explicit read-only capability allow-list (a parallel session-context function), never as a `funcionarios` row and never via `cargo = 'Administrador'`. Because every employee-facing surface (login picker, Escala, Lista da Vez, Atendimento) filters on `funcionarios`, a non-`funcionarios` principal is excluded from all of them by construction, and admin RPCs fail closed for it. Do not widen the `funcionarios.cargo` CHECK to add an observer role.
- **Login UX — picker + PIN stays primary.** Keep the employee picker + PIN as the main path. A type-to-filter/search affordance on the picker and a separate, unlisted access path for non-employee principals *may* be added later; email + PIN is only worth revisiting if real employee emails are collected and the roster outgrows a scannable list. Tie any change to the Minha Conta / Alterar PIN + PIN-hashing milestone above.
- **Real-employee test-history cleanup happens at rollout preparation, not now.** Several real/named employees carry small amounts of pre-launch test activity (`termos_aceite`, `sessoes_funcionario`, `turno_presenca`, `lista_vez_fila`, one `atendimentos` row). A single ordered `DELETE` transaction restores a clean first-login experience while preserving all `funcionarios` rows and the provisional September Escala (`escala_publicacoes` / `escala_entradas`). This is deferred to the rollout window and must not be executed as part of Escala closeout.

## 16.3 Planned Operational Modules

### APPROVED / PLANNED

- Consulta de Estoque;
- operational/logistics workflows;
- administrative tools;
- sales/operational dashboards.

## 16.4 Future Opportunities

### FUTURE

- employee suggestion platform;
- employee upvoting of improvement ideas;
- customer-service chatbot integrated with WhatsApp;
- approved repository of professional product imagery;
- AI-generated training/quiz material;
- richer employee training;
- configurable Atendimento reminders;
- admin-assisted correction/exception workflows;
- deeper ERP/POS synchronization;
- richer analytics and coaching tools.

Future ideas are not current requirements unless promoted to APPROVED status.

---

# 17. Decision Log

## ADR-001 — Custom Employee Authentication

**Status:** IMPLEMENTED

Portal Benvisi uses custom employee PIN authentication and opaque employee sessions instead of Supabase Auth for the current employee workflow.

## ADR-002 — Server-Resolved Employee Identity

**Status:** IMPLEMENTED

Privileged backend operations derive authenticated employee identity from the opaque session token.

## ADR-003 — Iniciar Atividades Is Operational Readiness

**Status:** IMPLEMENTED

`turno_presenca` represents readiness to begin Portal operational activity. It is not payroll attendance or a legal time clock.

## ADR-004 — Atendimento May Contain Multiple Customers

**Status:** APPROVED

A continuous salesperson interaction may represent more than one customer. Customers are recorded when closing the Atendimento.

## ADR-005 — Lista da Vez Is Advisory

**Status:** APPROVED

The queue recommends service order but does not hard-block legitimate out-of-turn Atendimento.

## ADR-006 — Out-of-Turn Starts Require Confirmation

**Status:** APPROVED

The employee must explicitly confirm before starting out of turn. No explanation is required in MVP.

## ADR-007 — 20-Second Accidental-Start Window

**Status:** APPROVED

New Atendimento starts are provisional for 20 seconds and may be cancelled without affecting operational metrics or queue order.

## ADR-008 — No Explicit Post-Grace Confirmation RPC Required

**Status:** APPROVED

Once the server-defined provisional deadline passes, the Atendimento is official by definition.

## ADR-009 — Active Atendimento Survives Navigation

**Status:** APPROVED

Leaving the Atendimento page does not close the Atendimento.

## ADR-010 — Previous-Day Atendimento Must Be Completed

**Status:** APPROVED

An unfinished Atendimento crossing into a new Manaus business day becomes pending closure and blocks another Atendimento until completed.

## ADR-011 — Reset Checklist Is Versioned

**Status:** APPROVED

Atendimento close includes one version-controlled operational reset checklist.

## ADR-012 — Consulta de Estoque Is a Dedicated Module

**Status:** APPROVED

Fast inventory lookup is distinct from stock-organization workflows.

## ADR-013 — Core Business Logic Is Not Delegated to UI-Only Prototyping

**Status:** APPROVED

Rapid prototyping tools may help with low-risk UI work, but security, queueing, session integrity, transactional workflows, and other core business rules must conform to Portal Benvisi architecture.

## ADR-014 — Lista da Vez Uses Persistent Queue State

**Status:** APPROVED

Lista da Vez will use a persistent queue-state table rather than being reconstructed exclusively from Atendimento history.

Queue changes must be transactional and preserve exact queue position when a provisional Atendimento is cancelled within the accidental-start grace period.

---

## ADR-015 — Checklist Responses Use Versioned JSONB

**Status:** APPROVED

Atendimento checklist responses will be stored using versioned JSONB.

This allows checklist content to evolve while preserving the exact version and responses associated with historical Atendimentos.

---

## ADR-016 — Atendimento Completion Determines Queue Return Order

**Status:** APPROVED

When multiple employees are simultaneously in Atendimento, each returns to the back of the available Lista da Vez when their Atendimento is completed.

Therefore, completion order determines their relative position when returning to the queue, regardless of the order in which their Atendimentos began.

---

## ADR-017 — The 20-Second Window Is an Undo Window, Not a Minimum Duration

**Status:** APPROVED

The first 20 seconds of an Atendimento exist to allow accidental starts to be cancelled.

A legitimate Atendimento may be concluded during that period without waiting for the grace window to expire.

After the 20-second deadline, accidental cancellation is no longer available.

---

## ADR-018 — Lista da Vez Shows Active Atendimento Duration

**Status:** APPROVED

Lista da Vez will display the elapsed duration of each employee's active Atendimento to all authorized users viewing the queue.

Elapsed duration is derived from the server-authoritative Atendimento start timestamp and may update locally on each client.

The active-row visual treatment plus elapsed timer may replace a separate **Em atendimento** status pill.

---

## ADR-019 — Responsible Employee and Authenticated Actor Are Distinct Concepts

**Status:** APPROVED

When Portal Benvisi permits an authenticated employee to perform an operation on behalf of another employee, the system must distinguish:

- the employee whose operational record is affected;
- the authenticated actor who executed the system action.

The authenticated actor must always be resolved server-side from the opaque session.

Any target employee supplied by the client must be validated server-side against the business rules for that operation.

This distinction should be preserved whenever relevant for security, auditability, reporting, or future investigation.

---

## ADR-020 — Employees May Start Atendimento on Behalf of Another Available Employee

**Status:** APPROVED

An authenticated employee may initiate an Atendimento for another employee who is already eligible and available in Lista da Vez.

The Atendimento remains attributed to the target employee.

The authenticated actor's own queue position/state does not change.

Normal out-of-turn rules apply to the target employee, and the system must preserve who actually initiated the Atendimento.

---

## ADR-021 — Finalizando Time Is Excluded Only When Closing Succeeds

**Status:** APPROVED

Time spent in `Finalizando` is excluded from customer-facing Atendimento duration only when that specific closing attempt successfully completes the Atendimento.

An abandoned closing attempt (**Voltar ao atendimento**) means the Atendimento never ended, so that time counts as ordinary Atendimento time rather than being excluded.

This supersedes the originally-implemented Milestone 2A model, which excluded all time spent in `Finalizando` regardless of outcome.

`iniciado_em` and the 20-second accidental-start deadline remain unaffected by any Finalizando cycle under either model.

---

# 18. Open Decisions

There are currently no unresolved product-level decisions that block implementation of Epic 2 — Atendimento.

New unresolved decisions should be documented here when they materially affect:

- business behavior;
- architecture;
- security;
- data integrity;
- reporting;
- employee workflow.

Minor implementation choices that do not alter approved product behavior do not need to be escalated into this section.

---

# 19. Glossary

## Atendimento

A continuous customer-service/selling session handled by one employee. One Atendimento may contain multiple customers.

## Cliente

An individual customer outcome recorded within an Atendimento.

## Lista da Vez

The advisory ordering of available salespeople for the next customer interaction.

## Iniciar Atividades

The Portal Benvisi action indicating that an employee is operationally ready for the day.

## Turno Presença

The backend record supporting Iniciar Atividades. It is not payroll attendance.

## Atendimento Provisório

The first 20 seconds after starting an Atendimento, during which an accidental start may be cancelled without operational consequences.

## Atendimento Pendente de Fechamento

An Atendimento that remained unfinished across the Manaus business-day boundary and must be completed before the employee can start another.

## Responsible Employee

The employee whose operational record or Atendimento is being affected and to whom the operational activity is attributed.

## Authenticated Actor

The logged-in employee who actually performs a system action. The authenticated actor may, in approved delegated workflows, differ from the responsible employee.

## Consulta de Estoque

Dedicated read-only employee module for fast inventory lookup.

## `estoque_snapshot`

Portal-side inventory snapshot synchronized periodically from the ERP/POS environment.

---

# 20. Principles We Do Not Want to Forget

1. Customer experience outweighs perfect process compliance when the two genuinely conflict.
2. Portal Benvisi should help employees sell, not distract them from selling.
3. The application should feel like an assistant, not an auditor.
4. Prefer guidance over hard restrictions whenever operationally safe.
5. Ask employees only for information the system cannot reliably infer.
6. Capture operational data because it will be used, not merely because it can be stored.
7. Keep the frontend simple even when backend logic is sophisticated.
8. Critical rules belong on the server.
9. Design for accidental taps, interrupted sessions, navigation, and real retail behavior.
10. Use operational data primarily to improve processes and coaching.
11. Prefer simple, durable architecture over clever architecture.
12. Preserve approved business reasoning in this Blueprint so future implementation does not drift from product intent.
