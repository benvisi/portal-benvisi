begin;

-- =============================================================================
-- Epic 2 — Atendimento, Milestone 2B: Versioned Reset Checklist V1
--
-- Scope (docs/portal-benvisi-blueprint.md section 8.12/8.12.1, Milestone 2B):
-- the three approved Checklist V1 confirmations become a required part of
-- closing an Atendimento — customer outcomes are recorded, then the
-- checklist is completed, then final submission atomically persists both
-- and marks the Atendimento concluded. Checklist completion is REQUIRED in
-- this milestone; deferred completion ("Farei depois") and the deferred
-- backlog are explicitly reserved for Milestone 2C and are not built here.
--
-- Two new tables, following the exact same data-driven-catalog /
-- append-only-completion split already established by
-- atendimento_motivos / atendimento_clientes in 20260819_001:
--
-- - atendimento_checklist_itens: the authoritative checklist DEFINITION,
--   versioned so a future Checklist V2 never requires redesigning this
--   schema or historical rows — items simply get inserted under a new
--   `versao`. Never encoded as fixed boolean columns (no
--   provador_ok/pecas_ok/loja_ok) precisely so the item set itself can
--   change between versions.
--
-- - atendimento_checklists: one row per Atendimento's completed checklist,
--   preserving which version was presented and the employee's per-item
--   responses as versioned JSONB (same architecture ADR-015 already
--   established for the reset checklist and used by the closing flow's own
--   motive/customer persistence) — never a bare `checklist_completed =
--   true`. `unique (id_atendimento)` guarantees exactly one completion per
--   Atendimento, matching section 8.12.1 ("Exactly one completed checklist
--   is associated with each Atendimento").
--
-- No policy/`defer_allowed` configuration is introduced here — see the
-- Blueprint sequencing note added alongside this migration. The "active
-- version" is simply `max(versao) where ativo = true` on the items table;
-- 2C can add whatever policy concept it needs as its own additive
-- migration without touching this definition/completion schema at all.
--
-- concluir_atendimento gains a third required parameter, p_checklist jsonb
-- (no default — checklist completion cannot be optional under the required
-- policy, so there is no sensible default to give the old 2-arg call site).
-- Because the argument list changes, the old 2-arg overload is explicitly
-- dropped, same convention as iniciar_atendimento's 2-arg -> 3-arg
-- evolution in 20260819_003.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- atendimento_checklist_itens: authoritative, versioned checklist
-- definition. guia_bullets is a plain text array (not one semicolon-joined
-- sentence) purely for legible mobile rendering — these are NOT separate
-- checkboxes (section 3: "Do NOT create individual checkboxes for every
-- explanatory bullet"), just visual guidance under each of the three real
-- confirmations.
-- -----------------------------------------------------------------------------
create table if not exists public.atendimento_checklist_itens (
  id uuid primary key default gen_random_uuid(),
  versao int not null,
  codigo text not null,
  titulo text not null,
  guia_bullets text[],
  ordem_exibicao int not null,
  obrigatorio boolean not null default true,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (versao, codigo)
);

create index if not exists atendimento_checklist_itens_versao_ativo_ordem_idx
  on public.atendimento_checklist_itens (versao, ativo, ordem_exibicao);

alter table public.atendimento_checklist_itens enable row level security;
-- No policies: read access is via list_atendimento_checklist_itens below,
-- same convention as atendimento_motivos/list_atendimento_motivos — this
-- table is only ever modified by migrations, no editor UI in this
-- milestone (section 8: "Do not build a checklist-editor UI").

-- Idempotent seed — exact Checklist V1 production content (section 2). Do
-- not add items beyond these three without an explicit product decision.
insert into public.atendimento_checklist_itens
  (versao, codigo, titulo, guia_bullets, ordem_exibicao, obrigatorio)
values
  (
    1,
    'conferir_provador',
    'Conferir o provador',
    array[
      'Verificar se o cliente esqueceu ou perdeu algum item pessoal',
      'Recolher peças que precisam ser arrumadas e/ou devolvidas',
      'Retirar qualquer lixo',
      'Deixar a cortina aberta para o lado direito'
    ],
    1,
    true
  ),
  (
    1,
    'arrumar_devolver_pecas',
    'Arrumar e/ou devolver as peças do atendimento',
    null,
    2,
    true
  ),
  (
    1,
    'verificar_loja',
    'Verificar a loja toda',
    array[
      'Organizar as peças e a exposição, incluindo pilhas',
      'Repor peças quando necessário',
      'Retirar qualquer lixo ou sujeira'
    ],
    3,
    true
  )
on conflict (versao, codigo) do nothing;

-- -----------------------------------------------------------------------------
-- atendimento_checklists: one completion row per Atendimento. id_funcionario
-- is the responsible employee (section 10) — under this milestone's closing
-- permissions the responsible employee always completes their own
-- checklist, so this is not a separate actor/responsible pair the way
-- atendimentos.id_funcionario/id_funcionario_iniciador is; a future
-- privileged-completion workflow (out of scope here) can add an actor
-- column then without touching this row shape, consistent with the global
-- Responsible Employee vs Authenticated Actor principle (section 5.4).
-- -----------------------------------------------------------------------------
create table if not exists public.atendimento_checklists (
  id uuid primary key default gen_random_uuid(),
  id_atendimento uuid not null references public.atendimentos(id) on delete cascade,
  id_funcionario uuid not null references public.funcionarios(id) on delete cascade,
  versao int not null,
  respostas jsonb not null,
  completado_em timestamptz not null default now(),
  unique (id_atendimento)
);

create index if not exists atendimento_checklists_id_funcionario_idx
  on public.atendimento_checklists (id_funcionario);

alter table public.atendimento_checklists enable row level security;
-- No policies: written exclusively by concluir_atendimento (SECURITY
-- DEFINER) below, same convention as atendimento_clientes.

-- -----------------------------------------------------------------------------
-- list_atendimento_checklist_itens: read-only, active items of the current
-- active version, ordered for direct UI consumption. Every table-derived
-- column below is alias-qualified (ci.*) — this function's RETURNS TABLE
-- creates PL/pgSQL OUT-parameter variables with the same bare names
-- (versao, codigo, titulo, ...), and a bare, unqualified reference to any
-- of them anywhere in this body would be ambiguous (Postgres 42702) exactly
-- like the bug fixed in 20260819_004 for iniciar_atendimento.
-- -----------------------------------------------------------------------------
create or replace function public.list_atendimento_checklist_itens(
  p_session_token text
)
returns table (
  id uuid,
  versao int,
  codigo text,
  titulo text,
  guia_bullets text[],
  ordem_exibicao int,
  obrigatorio boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_versao_ativa int;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  return query
    select ci.id, ci.versao, ci.codigo, ci.titulo, ci.guia_bullets, ci.ordem_exibicao, ci.obrigatorio
    from public.atendimento_checklist_itens ci
    where ci.versao = v_versao_ativa and ci.ativo = true
    order by ci.ordem_exibicao;
end;
$$;

revoke all on function public.list_atendimento_checklist_itens(text) from public;
grant execute on function public.list_atendimento_checklist_itens(text) to anon;

-- -----------------------------------------------------------------------------
-- concluir_atendimento: identical customer-outcome validation/persistence as
-- 20260819_002, plus checklist validation/persistence in the same
-- transaction, per section 11's required atomic order. Backend-authoritative
-- throughout (section 12): the active checklist version and its required
-- items are always recomputed server-side from
-- atendimento_checklist_itens, never trusted from the client — a submitted
-- p_checklist is only ever used as a boolean "did the employee confirm this
-- codigo" signal, and the actually-persisted respostas are rebuilt from the
-- authoritative item set, not stored verbatim from client input.
--
-- Same idempotency/duplicate-submission protection as before extends for
-- free: the `for update` lock + `status = 'finalizando'` check below still
-- gates every insert in this function (customer rows AND the new checklist
-- row), so a rapid double-submit's second call sees status = 'concluido'
-- and is rejected with ATENDIMENTO_NAO_ESTA_FINALIZANDO before it can
-- duplicate anything — atendimento_checklists' unique (id_atendimento) is
-- an additional belt-and-suspenders guarantee at the database level.
--
-- Signature change (2 args -> 3 args, no default for the new p_checklist —
-- checklist completion cannot be optional under this milestone's required
-- policy) creates a new overload; the old 2-arg version is dropped
-- explicitly so exactly one concluir_atendimento exists, same convention as
-- 20260819_003's iniciar_atendimento evolution.
-- -----------------------------------------------------------------------------
drop function if exists public.concluir_atendimento(text, jsonb);

create or replace function public.concluir_atendimento(
  p_session_token text,
  p_clientes jsonb,
  p_checklist jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_atendimento record;
  v_dia date;
  v_cliente jsonb;
  v_id_motivo uuid;
  v_detalhe text;
  v_motivo record;
  v_versao_ativa int;
  v_codigos_confirmados text[];
  v_respostas jsonb;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = v_ctx.id_funcionario and status = 'finalizando'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

  -- Customer outcomes — unchanged from 20260819_002.
  if p_clientes is null
     or jsonb_typeof(p_clientes) <> 'array'
     or jsonb_array_length(p_clientes) = 0 then
    raise exception using errcode = 'P0001', message = 'NENHUM_CLIENTE_INFORMADO';
  end if;

  for v_cliente in select * from jsonb_array_elements(p_clientes)
  loop
    if v_cliente ->> 'id_motivo' is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_OBRIGATORIO';
    end if;

    begin
      v_id_motivo := (v_cliente ->> 'id_motivo')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end;

    select * into v_motivo
    from public.atendimento_motivos
    where id = v_id_motivo and ativo = true;

    if v_motivo.id is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end if;

    v_detalhe := nullif(trim(both from (v_cliente ->> 'detalhe')), '');

    if v_motivo.detalhe_obrigatorio and v_detalhe is null then
      raise exception using errcode = 'P0001', message = 'DETALHE_OBRIGATORIO';
    end if;

    insert into public.atendimento_clientes (
      id_atendimento, id_motivo, categoria, motivo_rotulo, detalhe
    ) values (
      v_atendimento.id, v_motivo.id, v_motivo.categoria, v_motivo.rotulo, v_detalhe
    );
  end loop;

  -- Checklist V1 — new in this milestone. The active version is always
  -- resolved fresh here, never taken from the client.
  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  -- Only well-formed {"codigo": text, "concluido": true} elements count —
  -- anything malformed or concluido = false is simply not "confirmed",
  -- which naturally fails the required-items check below rather than
  -- erroring out separately (fail safe, not fail loud, for client noise).
  select array_agg(elem ->> 'codigo')
  into v_codigos_confirmados
  from jsonb_array_elements(p_checklist) as elem
  where jsonb_typeof(elem) = 'object'
    and jsonb_typeof(elem -> 'concluido') = 'boolean'
    and (elem ->> 'concluido')::boolean is true
    and elem ->> 'codigo' is not null;

  if exists (
    select 1
    from public.atendimento_checklist_itens ci
    where ci.versao = v_versao_ativa
      and ci.ativo = true
      and ci.obrigatorio = true
      and not (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
  ) then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  -- Persist the authoritative, server-reconstructed response set (every
  -- active item of the active version, each with its confirmed state) —
  -- not the raw client payload — so historical respostas always exactly
  -- match the version identified alongside them, per section 7/9.
  select jsonb_agg(
    jsonb_build_object(
      'codigo', ci.codigo,
      'concluido', (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
    )
    order by ci.ordem_exibicao
  )
  into v_respostas
  from public.atendimento_checklist_itens ci
  where ci.versao = v_versao_ativa and ci.ativo = true;

  insert into public.atendimento_checklists (id_atendimento, id_funcionario, versao, respostas)
  values (v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_respostas);

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  update public.atendimentos
  set status = 'concluido',
      concluido_em = now()
  where id = v_atendimento.id;

  insert into public.lista_vez_fila (id_funcionario, dia_manaus, na_fila, disponivel, posicao)
  values (v_ctx.id_funcionario, v_dia, true, true, nextval('public.lista_vez_posicao_seq'))
  on conflict (id_funcionario, dia_manaus)
  do update set
    na_fila = true,
    disponivel = true,
    posicao = excluded.posicao,
    atualizado_em = now();

  return true;
end;
$$;

revoke all on function public.concluir_atendimento(text, jsonb, jsonb) from public;
grant execute on function public.concluir_atendimento(text, jsonb, jsonb) to anon;

commit;
