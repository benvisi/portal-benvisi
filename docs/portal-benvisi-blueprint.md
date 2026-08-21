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

If at least one customer converted, the completion feedback should generally use the positive conversion category.

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

### PLANNED / PARTIALLY DEFINED

Potential workflows include:

- stock organization;
- receiving / movement controls;
- recurring operational tasks;
- maintenance coordination;
- store organization;
- process checklists.

These workflows remain distinct from the fast read-only Consulta de Estoque experience.

---

# 11. Administrativo

### PLANNED

Administrative functionality is intended for authorized roles.

Future capabilities may include configuration, operational corrections, checklist management, employee-related controls, reporting, and audit/review tools.

Exact permissions must be defined per capability.

---

# 12. Training, Knowledge and Company Culture

### FUTURE

Potential capabilities include:

- training quizzes;
- short knowledge checks;
- product training;
- brand knowledge;
- operational training;
- reinforcement of company values/attributes/principles;
- AI-generated training material based on approved source content.

Training should avoid excessive friction in the employee's normal sales workflow.

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

## 16.2 Current Epic

### APPROVED / IN DEVELOPMENT

**Epic 2 — Atendimento**

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

**Status:** APPROVED

Scope:

- admin-controlled checklist policy (`required` / `defer_allowed`), building on 2B's versioned checklist architecture without redesigning it;
- minimal admin control for that policy;
- **Farei depois** action;
- one durable historical deferral record per deferred Atendimento;
- aggregated employee-facing pending count;
- non-blocking reminder/nudge;
- standalone checklist completion;
- one successful checklist execution clears all currently outstanding deferred obligations for that employee;
- completing the checklist during a later Atendimento also clears all previous outstanding obligations;
- preserve individual historical deferrals for future reporting.

### Future — Manager/Admin Atendimento Exception Handling

**Status:** APPROVED DIRECTION

Implement only after the full closing/checklist flow is stabilized.

Future scope may include:

- manager/admin moving another employee's Atendimento to `finalizando`;
- manager/admin finalizing an Atendimento on behalf of another employee;
- preserving separate attribution between responsible salesperson and authenticated administrative actor;
- treating these actions as exception/assistance workflows rather than normal sales-floor behavior.

### Future — Session Management / Concurrent Login Controls

**Status:** FUTURE

Potential future capabilities:

- view active sessions per employee;
- revoke other sessions;
- admin "log out all devices";
- detect unusual simultaneous sessions;
- optionally limit concurrent sessions by role.

Do not implement these session controls now. The current decision is explicitly **not** to enforce one-browser/one-device-only login in MVP.

### Later Approved Atendimento Work

Still approved but not part of the immediate 2A → 2A.1 → 2B → 2C sequence:

- previous-day `pendente_fechamento` behavior;
- positive reinforcement after successful closure.

Other future Atendimento capabilities remain documented in their respective sections.

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
