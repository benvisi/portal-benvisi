begin;

-- =============================================================================
-- Milestone 4D — Contagem de Embalagens V1
--
-- Replaces ONLY the paper packaging-count ticket with a structured
-- submission + Admin review history. An employee physically counts
-- packaging inventory (closed packages + loose units per configured item)
-- and submits; the submission is attributed to the authenticated employee
-- and timestamped server-side. An Administrador reviews pending submissions
-- and marks each "revisada" — meaning "seen/accepted for later purchasing
-- analysis", NOT a purchase order and NOT an approved purchase.
--
-- Explicitly NOT in scope here (future work, do not build now):
--   - Reposição Inteligente / purchasing recommendations;
--   - email notification on submit (Admin pending-review UI is the V1
--     notification mechanism);
--   - recurrence / monthly required tasks / reminders / overdue logic.
--
-- Every table below follows this project's established RLS pattern exactly:
-- RLS enabled, zero policies, all access through SECURITY DEFINER RPCs that
-- resolve identity server-side from the opaque session token (never a
-- client-supplied funcionario_id). Admin-only RPCs enforce
-- cargo = 'Administrador' server-side — the same line already drawn by
-- set_checklist_policy (20260821_002), not a hidden-button check.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- contagem_embalagem_itens — the configurable item catalog.
--
-- Package sizes live here as data, never hard-coded in the frontend:
-- changing a pack size, relabeling an item, reordering the form, or
-- (de)activating an item for counting is a row update, not a code change.
--
-- `ativo_para_contagem` is deliberately independent of any future "actively
-- being purchased" concept — an item discontinued for purchase may still
-- hold physical inventory that must be counted, so it stays
-- ativo_para_contagem = true. The purchasing side belongs to the future
-- Reposição Inteligente logic, not here.
--
-- `familia` is a stable lowercase code (frontend maps to a display group
-- heading); `tamanho` is the size code shown to employees ('PP'..'GG', or
-- 'TU' = tamanho único). `rotulo` is the exact employee-facing label.
-- -----------------------------------------------------------------------------
create table public.contagem_embalagem_itens (
  id uuid primary key default gen_random_uuid(),
  familia text not null check (familia in (
    'sacola_boutique', 'envelope', 'seda', 'etiqueta', 'de_para', 'outlet'
  )),
  tamanho text not null,
  rotulo text not null,
  unidades_por_pacote int not null check (unidades_por_pacote > 0),
  ordem_exibicao int not null,
  ativo_para_contagem boolean not null default true,
  created_at timestamptz not null default now(),
  unique (familia, tamanho)
);

alter table public.contagem_embalagem_itens enable row level security;

-- V1 catalog — the current physical count form, with the authoritative
-- package quantities from the purchasing spreadsheet (product owner
-- confirmed 2026-08-27). Display order matches the paper form's grouping:
-- Sacola Boutique, Envelope, Seda, Etiqueta, De/Para, Outlet. `ordem_exibicao`
-- is spaced by 10 so future items can be inserted without a rewrite.
--
-- Naming note: the source spreadsheet calls the first family simply
-- "Sacola"; Portal uses "Sacola Boutique" to distinguish it from "Outlet".
-- Boutique and Outlet are packaging/quality types, NOT locations —
-- everything is counted in the same store.
insert into public.contagem_embalagem_itens
  (familia, tamanho, rotulo, unidades_por_pacote, ordem_exibicao) values
  ('sacola_boutique', 'PP', 'Sacola Boutique PP', 100, 10),
  ('sacola_boutique', 'P',  'Sacola Boutique P',   50, 20),
  ('sacola_boutique', 'M',  'Sacola Boutique M',   50, 30),
  ('sacola_boutique', 'G',  'Sacola Boutique G',   50, 40),
  ('envelope',        'PP', 'Envelope PP',        100, 50),
  ('envelope',        'P',  'Envelope P',          50, 60),
  ('envelope',        'M',  'Envelope M',          50, 70),
  ('envelope',        'GG', 'Envelope GG',         50, 80),
  ('seda',            'TU', 'Seda',              500, 90),
  ('etiqueta',        'TU', 'Etiqueta',          500, 100),
  ('de_para',         'TU', 'De/Para',           500, 110),
  ('outlet',          'P',  'Outlet P',          100, 120),
  ('outlet',          'M',  'Outlet M',          100, 130),
  ('outlet',          'G',  'Outlet G',           50, 140);

-- -----------------------------------------------------------------------------
-- contagens — one row per submitted count (submission header).
--
-- Multiple valid counts may exist in the same month; nothing here overwrites
-- a prior count. `submetido_por` / `submetido_em` are always set
-- server-side from the authenticated session (see submeter_contagem).
--
-- V1 status: 'pendente_revisao' on submit, 'revisada' once an Administrador
-- has seen/accepted it. The CHECK keeps the reviewer columns consistent
-- with status — a pending row has neither, a reviewed row has both.
-- -----------------------------------------------------------------------------
create table public.contagens (
  id uuid primary key default gen_random_uuid(),
  submetido_por uuid not null references public.funcionarios(id),
  submetido_em timestamptz not null default now(),
  status text not null default 'pendente_revisao'
    check (status in ('pendente_revisao', 'revisada')),
  observacao text,
  revisada_por uuid references public.funcionarios(id),
  revisada_em timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status = 'pendente_revisao' and revisada_por is null and revisada_em is null)
    or (status = 'revisada' and revisada_por is not null and revisada_em is not null)
  )
);

alter table public.contagens enable row level security;

create index contagens_status_submetido_em_idx
  on public.contagens (status, submetido_em desc);
create index contagens_submetido_por_idx
  on public.contagens (submetido_por);

-- -----------------------------------------------------------------------------
-- contagem_itens — one row per catalog item per submission.
--
-- `pacotes_fechados` is required (NOT NULL, >= 0) — the employee must
-- explicitly provide a value for every active item, and zero is a valid
-- informed value. `unidades_avulsas` defaults to 0 (optional on the form).
--
-- `total_unidades` is deliberately NOT stored — it is a pure function of
-- (pacotes_fechados, unidades_avulsas, unidades_por_pacote) and is derived
-- in the read RPCs as
--   pacotes_fechados * unidades_por_pacote + unidades_avulsas
-- so a future correction to a catalog pack size does not leave stale totals
-- behind. unique (id_contagem, id_item) guarantees one row per item per
-- submission.
-- -----------------------------------------------------------------------------
create table public.contagem_itens (
  id uuid primary key default gen_random_uuid(),
  id_contagem uuid not null references public.contagens(id) on delete cascade,
  id_item uuid not null references public.contagem_embalagem_itens(id),
  pacotes_fechados int not null check (pacotes_fechados >= 0),
  unidades_avulsas int not null default 0 check (unidades_avulsas >= 0),
  created_at timestamptz not null default now(),
  unique (id_contagem, id_item)
);

alter table public.contagem_itens enable row level security;

create index contagem_itens_id_contagem_idx
  on public.contagem_itens (id_contagem);

-- =============================================================================
-- RPCs — all SECURITY DEFINER, session resolved server-side, matching this
-- project's established pattern (get_valid_employee_session_context, P0001
-- 'INVALID_SESSION' on a bad session, cargo never trusted from the client).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- get_contagem_catalogo — active catalog, ordered for direct form
-- consumption. Any authenticated employee.
-- -----------------------------------------------------------------------------
create or replace function public.get_contagem_catalogo(
  p_session_token text
)
returns table (
  id uuid,
  familia text,
  tamanho text,
  rotulo text,
  unidades_por_pacote int,
  ordem_exibicao int
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  return query
    select c.id, c.familia, c.tamanho, c.rotulo, c.unidades_por_pacote, c.ordem_exibicao
    from public.contagem_embalagem_itens c
    where c.ativo_para_contagem = true
    order by c.ordem_exibicao, c.rotulo;
end;
$$;

revoke all on function public.get_contagem_catalogo(text) from public;
grant execute on function public.get_contagem_catalogo(text) to anon;

-- -----------------------------------------------------------------------------
-- submeter_contagem — any authenticated employee submits one count.
--
-- p_itens is a JSON array of
--   { "id_item": "<uuid>", "pacotes_fechados": <int>, "unidades_avulsas": <int|null> }
-- The submitter is resolved from the session (never from p_itens or any
-- other client value). The whole function body runs in the one transaction
-- wrapping the RPC call, so the header + every item row commit together or
-- not at all.
--
-- Server-side completeness guarantee: the provided items must be exactly
-- the set of currently-active catalog items — every active item present,
-- once each, all valid. "Blank is not zero" is enforced on the client; the
-- server independently refuses an incomplete or tampered payload.
-- -----------------------------------------------------------------------------
create or replace function public.submeter_contagem(
  p_session_token text,
  p_itens jsonb,
  p_observacao text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_observacao text;
  v_id_contagem uuid;
  v_item jsonb;
  v_ativos int;
  v_entradas int;
  v_validas int;
  v_distintas int;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if p_itens is null
     or jsonb_typeof(p_itens) <> 'array'
     or jsonb_array_length(p_itens) = 0 then
    raise exception using errcode = 'P0001', message = 'NENHUM_ITEM_INFORMADO';
  end if;

  v_observacao := nullif(btrim(p_observacao), '');

  -- Per-item shape/range validation, with specific error messages. The
  -- client builds this payload straight from get_contagem_catalogo, so a
  -- failure here means a stale catalog, a bug, or tampering — not normal
  -- use.
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    if v_item ->> 'id_item' is null or v_item ->> 'pacotes_fechados' is null then
      raise exception using errcode = 'P0001', message = 'ITEM_INCOMPLETO';
    end if;

    begin
      perform (v_item ->> 'id_item')::uuid;
      if (v_item ->> 'pacotes_fechados')::int < 0
         or coalesce((v_item ->> 'unidades_avulsas')::int, 0) < 0 then
        raise exception using errcode = 'P0001', message = 'QUANTIDADE_INVALIDA';
      end if;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'QUANTIDADE_INVALIDA';
    end;
  end loop;

  select count(*) into v_ativos
  from public.contagem_embalagem_itens
  where ativo_para_contagem = true;

  select
    count(*),
    count(*) filter (where c.id is not null),
    count(distinct (r.id_item)::uuid)
  into v_entradas, v_validas, v_distintas
  from jsonb_to_recordset(p_itens) as r(id_item text)
  left join public.contagem_embalagem_itens c
    on c.id = (r.id_item)::uuid and c.ativo_para_contagem = true;

  if v_entradas <> v_distintas then
    raise exception using errcode = 'P0001', message = 'ITEM_DUPLICADO';
  end if;
  if v_validas <> v_entradas then
    raise exception using errcode = 'P0001', message = 'ITEM_INVALIDO';
  end if;
  -- All entries valid + distinct + count equal to the active-item count
  -- ⇒ exactly the active set, one each (pigeonhole).
  if v_entradas <> v_ativos then
    raise exception using errcode = 'P0001', message = 'CONTAGEM_INCOMPLETA';
  end if;

  insert into public.contagens (submetido_por, observacao)
  values (v_ctx.id_funcionario, v_observacao)
  returning id into v_id_contagem;

  insert into public.contagem_itens (id_contagem, id_item, pacotes_fechados, unidades_avulsas)
  select
    v_id_contagem,
    (r.id_item)::uuid,
    r.pacotes_fechados,
    coalesce(r.unidades_avulsas, 0)
  from jsonb_to_recordset(p_itens)
    as r(id_item text, pacotes_fechados int, unidades_avulsas int);

  return v_id_contagem;
end;
$$;

revoke all on function public.submeter_contagem(text, jsonb, text) from public;
grant execute on function public.submeter_contagem(text, jsonb, text) to anon;

-- -----------------------------------------------------------------------------
-- get_contagens_pendentes — Administrador only. The review queue: pending
-- submissions, oldest first. Names are apelido-first (fall back to nome),
-- matching 20260826_003. total_geral_unidades is the derived grand total.
-- -----------------------------------------------------------------------------
create or replace function public.get_contagens_pendentes(
  p_session_token text
)
returns table (
  id uuid,
  submetido_por_nome text,
  submetido_em timestamptz,
  observacao text,
  total_itens int,
  total_geral_unidades bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo <> 'Administrador' then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO';
  end if;

  return query
    select
      c.id,
      coalesce(nullif(btrim(f.apelido::text), ''), f.nome::text) as submetido_por_nome,
      c.submetido_em,
      c.observacao,
      count(ci.id)::int as total_itens,
      coalesce(sum(
        ci.pacotes_fechados::bigint * cei.unidades_por_pacote + ci.unidades_avulsas
      ), 0)::bigint as total_geral_unidades
    from public.contagens c
    join public.funcionarios f on f.id = c.submetido_por
    left join public.contagem_itens ci on ci.id_contagem = c.id
    left join public.contagem_embalagem_itens cei on cei.id = ci.id_item
    where c.status = 'pendente_revisao'
    group by c.id, f.apelido, f.nome, c.submetido_em, c.observacao
    order by c.submetido_em asc;
end;
$$;

revoke all on function public.get_contagens_pendentes(text) from public;
grant execute on function public.get_contagens_pendentes(text) to anon;

-- -----------------------------------------------------------------------------
-- get_contagem_historico — Administrador only. Reviewed submissions,
-- most-recently-reviewed first.
-- -----------------------------------------------------------------------------
create or replace function public.get_contagem_historico(
  p_session_token text
)
returns table (
  id uuid,
  submetido_por_nome text,
  submetido_em timestamptz,
  observacao text,
  revisada_por_nome text,
  revisada_em timestamptz,
  total_itens int,
  total_geral_unidades bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo <> 'Administrador' then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO';
  end if;

  return query
    select
      c.id,
      coalesce(nullif(btrim(f.apelido::text), ''), f.nome::text) as submetido_por_nome,
      c.submetido_em,
      c.observacao,
      coalesce(nullif(btrim(rf.apelido::text), ''), rf.nome::text) as revisada_por_nome,
      c.revisada_em,
      count(ci.id)::int as total_itens,
      coalesce(sum(
        ci.pacotes_fechados::bigint * cei.unidades_por_pacote + ci.unidades_avulsas
      ), 0)::bigint as total_geral_unidades
    from public.contagens c
    join public.funcionarios f on f.id = c.submetido_por
    left join public.funcionarios rf on rf.id = c.revisada_por
    left join public.contagem_itens ci on ci.id_contagem = c.id
    left join public.contagem_embalagem_itens cei on cei.id = ci.id_item
    where c.status = 'revisada'
    group by c.id, f.apelido, f.nome, c.submetido_em, c.observacao,
             rf.apelido, rf.nome, c.revisada_em
    order by c.revisada_em desc;
end;
$$;

revoke all on function public.get_contagem_historico(text) from public;
grant execute on function public.get_contagem_historico(text) to anon;

-- -----------------------------------------------------------------------------
-- get_contagem_detalhe — Administrador only. One row per item for a single
-- submission, in catalog display order, each row carrying the submission
-- header columns (repeated, same idiom as get_escala_periodo's feriado
-- columns) so the client can render header + table from one payload.
-- total_unidades is derived per item. Raises CONTAGEM_NAO_ENCONTRADA for an
-- unknown id.
-- -----------------------------------------------------------------------------
create or replace function public.get_contagem_detalhe(
  p_session_token text,
  p_id uuid
)
returns table (
  id_contagem uuid,
  submetido_por_nome text,
  submetido_em timestamptz,
  status text,
  observacao text,
  revisada_por_nome text,
  revisada_em timestamptz,
  id_item uuid,
  rotulo text,
  familia text,
  tamanho text,
  unidades_por_pacote int,
  pacotes_fechados int,
  unidades_avulsas int,
  total_unidades bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo <> 'Administrador' then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO';
  end if;

  if not exists (select 1 from public.contagens c where c.id = p_id) then
    raise exception using errcode = 'P0001', message = 'CONTAGEM_NAO_ENCONTRADA';
  end if;

  return query
    select
      c.id,
      coalesce(nullif(btrim(f.apelido::text), ''), f.nome::text) as submetido_por_nome,
      c.submetido_em,
      c.status,
      c.observacao,
      coalesce(nullif(btrim(rf.apelido::text), ''), rf.nome::text) as revisada_por_nome,
      c.revisada_em,
      cei.id,
      cei.rotulo,
      cei.familia,
      cei.tamanho,
      cei.unidades_por_pacote,
      ci.pacotes_fechados,
      ci.unidades_avulsas,
      (ci.pacotes_fechados::bigint * cei.unidades_por_pacote + ci.unidades_avulsas)::bigint
        as total_unidades
    from public.contagens c
    join public.funcionarios f on f.id = c.submetido_por
    left join public.funcionarios rf on rf.id = c.revisada_por
    join public.contagem_itens ci on ci.id_contagem = c.id
    join public.contagem_embalagem_itens cei on cei.id = ci.id_item
    where c.id = p_id
    order by cei.ordem_exibicao, cei.rotulo;
end;
$$;

revoke all on function public.get_contagem_detalhe(text, uuid) from public;
grant execute on function public.get_contagem_detalhe(text, uuid) to anon;

-- -----------------------------------------------------------------------------
-- marcar_contagem_revisada — Administrador only. Transitions
-- pendente_revisao -> revisada and stamps revisada_por / revisada_em.
-- `for update` + the status re-check make a double submission safe: the
-- second call blocks, then sees status <> 'pendente_revisao' and fails
-- cleanly with CONTAGEM_JA_REVISADA instead of re-stamping.
-- -----------------------------------------------------------------------------
create or replace function public.marcar_contagem_revisada(
  p_session_token text,
  p_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_status text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo <> 'Administrador' then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO';
  end if;

  select c.status into v_status
  from public.contagens c
  where c.id = p_id
  for update;

  if v_status is null then
    raise exception using errcode = 'P0001', message = 'CONTAGEM_NAO_ENCONTRADA';
  end if;
  if v_status <> 'pendente_revisao' then
    raise exception using errcode = 'P0001', message = 'CONTAGEM_JA_REVISADA';
  end if;

  update public.contagens
  set status = 'revisada',
      revisada_por = v_ctx.id_funcionario,
      revisada_em = now()
  where id = p_id;

  return true;
end;
$$;

revoke all on function public.marcar_contagem_revisada(text, uuid) from public;
grant execute on function public.marcar_contagem_revisada(text, uuid) to anon;

commit;
