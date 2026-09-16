begin;

-- =============================================================================
-- Consulta de Estoque — Termos de busca V1 (schema, capability, RPCs)
--
-- Benvisi-maintained search vocabulary attached to a product REFERENCE
-- (estoque_atual.produto), e.g. "regata", "gola alta", "manga longa". Terms
-- supplement Linx/Lacoste source data and never modify it. They persist
-- independently of the transient estoque_atual current-state table: a
-- reference that sells out keeps its terms and they apply again the moment
-- it returns. There is deliberately no FK to estoque_atual (no permanent
-- product parent table exists — estoque_atual rows come and go every sync).
--
-- Lifecycle (single table, status column, no separate event log):
--   pendente  -> aprovado | rejeitado         (moderation)
--   aprovado  -> desativado                   (admin removes from search)
--   desativado -> aprovado                    (admin reactivates)
-- Only status = 'aprovado' rows contribute to search (20260915_002).
-- Rejected rows are pure history and never block a resubmission;
-- pendente/aprovado/desativado rows hold the (produto, termo_normalizado)
-- slot via a partial unique index, which is what makes the duplicate rules
-- in sugerir_termo_busca / moderar_termo_busca / adicionar_termo_busca_admin
-- race-safe rather than merely advisory.
--
-- Authorization: an explicit boolean capability
-- funcionarios.pode_gerenciar_termos_busca (default false), NOT
-- cargo = 'Administrador'. Nobody holds it after this migration — it is
-- granted per employee by an explicit data change. Every management RPC
-- re-checks it server-side via estoque_termos_busca_exigir_gestor.
-- =============================================================================

alter table public.funcionarios
  add column pode_gerenciar_termos_busca boolean not null default false;

-- -----------------------------------------------------------------------------
-- Text normalisation for search + duplicate detection: lower-case, Portuguese
-- accents folded to ASCII, whitespace collapsed. A plain translate() rather
-- than the unaccent extension: it covers the Portuguese/Linx vocabulary in
-- play, adds no extension dependency, and is genuinely IMMUTABLE (unaccent()
-- is only STABLE), which lets it back a generated column.
-- -----------------------------------------------------------------------------
create or replace function public.estoque_normalizar_texto(p_texto text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select regexp_replace(
    translate(
      lower(p_texto),
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'
    ),
    '\s+', ' ', 'g'
  );
$$;

-- -----------------------------------------------------------------------------
-- Canonical form of a term (what is stored and displayed): trimmed,
-- whitespace-collapsed, lower-case, accents PRESERVED. Validates V1 rules —
-- 3..30 chars; letters, Portuguese accented letters, digits, spaces and
-- hyphens only; at least one letter/digit. Raises TERMO_INVALIDO otherwise.
-- Shared by every write path so employee suggestions, admin edits and admin
-- direct additions all obey exactly the same rules.
-- -----------------------------------------------------------------------------
create or replace function public.estoque_termo_busca_canonico(p_termo text)
returns text
language plpgsql
immutable
as $$
declare
  v_termo text;
begin
  v_termo := lower(trim(regexp_replace(coalesce(p_termo, ''), '\s+', ' ', 'g')));

  if length(v_termo) < 3 or length(v_termo) > 30 then
    raise exception using errcode = 'P0001', message = 'TERMO_INVALIDO';
  end if;

  if v_termo !~ '^[a-z0-9áàâãäéèêëíìîïóòôõöúùûüçñ -]+$' or v_termo !~ '[a-z0-9]' then
    raise exception using errcode = 'P0001', message = 'TERMO_INVALIDO';
  end if;

  return v_termo;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reference key normalisation shared by every RPC that takes a produto:
-- upper-case + trim, same as get_produto_estoque_detalhe. Raises on blank
-- or implausibly long input; existence in estoque_atual is deliberately NOT
-- required (terms outlive stock).
-- -----------------------------------------------------------------------------
create or replace function public.estoque_termo_busca_produto_key(p_produto text)
returns text
language plpgsql
immutable
as $$
declare
  v_produto text;
begin
  v_produto := upper(trim(coalesce(p_produto, '')));
  if length(v_produto) = 0 or length(v_produto) > 30 then
    raise exception using errcode = 'P0001', message = 'PRODUTO_INVALIDO';
  end if;
  return v_produto;
end;
$$;

-- -----------------------------------------------------------------------------
-- The terms table. RLS enabled with zero policies and no direct grants:
-- reachable only through the SECURITY DEFINER RPCs below, like every other
-- Portal table.
--
-- termo            — current canonical value (the FINAL value once approved;
--                    admin "Editar e aprovar" rewrites it).
-- termo_sugerido   — what was originally submitted (canonical form), kept
--                    verbatim for audit even after an admin edit.
-- termo_normalizado — generated, accent/case-folded; the duplicate key.
-- origem           — 'sugestao' (employee, moderated) or 'admin' (direct
--                    addition, approved on insert; sugerido_por = the admin).
-- moderado_*       — the aprovar/rejeitar decision (or the admin insert).
-- desativado_* / reativado_* — most recent deactivation / reactivation.
-- -----------------------------------------------------------------------------
create table public.estoque_termos_busca (
  id uuid primary key default gen_random_uuid(),
  produto text not null check (produto = upper(trim(produto)) and length(produto) between 1 and 30),
  termo text not null check (termo = public.estoque_termo_busca_canonico(termo)),
  termo_normalizado text generated always as (public.estoque_normalizar_texto(termo)) stored,
  termo_sugerido text not null,
  status text not null check (status in ('pendente', 'aprovado', 'rejeitado', 'desativado')),
  origem text not null check (origem in ('sugestao', 'admin')),
  sugerido_por uuid not null references public.funcionarios(id),
  sugerido_em timestamptz not null default now(),
  moderado_por uuid references public.funcionarios(id),
  moderado_em timestamptz,
  desativado_por uuid references public.funcionarios(id),
  desativado_em timestamptz,
  reativado_por uuid references public.funcionarios(id),
  reativado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  check ((status = 'pendente') = (moderado_por is null)),
  check ((status = 'pendente') = (moderado_em is null))
);

alter table public.estoque_termos_busca enable row level security;

-- One live slot per (produto, normalised term). Rejected rows are excluded on
-- purpose: a rejection never blocks a later resubmission.
create unique index estoque_termos_busca_slot_uidx
  on public.estoque_termos_busca (produto, termo_normalizado)
  where status in ('pendente', 'aprovado', 'desativado');

create index estoque_termos_busca_produto_idx
  on public.estoque_termos_busca (produto);

create index estoque_termos_busca_pendentes_idx
  on public.estoque_termos_busca (sugerido_em)
  where status = 'pendente';

-- -----------------------------------------------------------------------------
-- Internal helper (NOT granted to anon): validates the session and requires
-- the management capability. Returns the caller's funcionario id.
-- -----------------------------------------------------------------------------
create or replace function public.estoque_termos_busca_exigir_gestor(p_session_token text)
returns uuid
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_pode boolean;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select f.pode_gerenciar_termos_busca into v_pode
  from public.funcionarios f
  where f.id = v_ctx.id_funcionario;

  if not coalesce(v_pode, false) then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_TERMOS_BUSCA';
  end if;

  return v_ctx.id_funcionario;
end;
$$;

revoke all on function public.estoque_termos_busca_exigir_gestor(text) from public;

-- Raises the right duplicate error for an existing live row, if any.
-- Internal helper used by the three write paths; never granted.
create or replace function public.estoque_termos_busca_verificar_slot(
  p_produto text,
  p_termo_normalizado text,
  p_ignorar_id uuid default null
)
returns void
language plpgsql
stable
as $$
declare
  v_status text;
begin
  select t.status into v_status
  from public.estoque_termos_busca t
  where t.produto = p_produto
    and t.termo_normalizado = p_termo_normalizado
    and t.status in ('pendente', 'aprovado', 'desativado')
    and (p_ignorar_id is null or t.id <> p_ignorar_id)
  limit 1;

  if v_status = 'aprovado' then
    raise exception using errcode = 'P0001', message = 'TERMO_JA_APROVADO';
  elsif v_status = 'pendente' then
    raise exception using errcode = 'P0001', message = 'TERMO_JA_PENDENTE';
  elsif v_status = 'desativado' then
    raise exception using errcode = 'P0001', message = 'TERMO_DESATIVADO_PELA_GESTAO';
  end if;
end;
$$;

revoke all on function public.estoque_termos_busca_verificar_slot(text, text, uuid) from public;

-- =============================================================================
-- Employee RPCs (any authenticated active employee)
-- =============================================================================

-- Whether the caller may open the management area. UI gating only — every
-- management RPC re-checks the capability itself.
create or replace function public.get_termos_busca_permissao(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_pode boolean;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select f.pode_gerenciar_termos_busca into v_pode
  from public.funcionarios f
  where f.id = v_ctx.id_funcionario;

  return coalesce(v_pode, false);
end;
$$;

revoke all on function public.get_termos_busca_permissao(text) from public;
grant execute on function public.get_termos_busca_permissao(text) to anon;

-- Approved terms of one reference (visible to everyone) plus the CALLER'S
-- own pending suggestions for it. Other employees' pending/rejected rows and
-- deactivated history are never exposed here.
create or replace function public.get_produto_termos_busca(
  p_session_token text,
  p_produto text
)
returns table (
  id uuid,
  termo text,
  status text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_produto text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_produto := public.estoque_termo_busca_produto_key(p_produto);

  return query
  select t.id, t.termo, t.status
  from public.estoque_termos_busca t
  where t.produto = v_produto
    and (
      t.status = 'aprovado'
      or (t.status = 'pendente' and t.sugerido_por = v_ctx.id_funcionario)
    )
  order by (t.status = 'aprovado') desc, t.termo;
end;
$$;

revoke all on function public.get_produto_termos_busca(text, text) from public;
grant execute on function public.get_produto_termos_busca(text, text) to anon;

-- Employee suggestion: one term per call, always lands as 'pendente'.
-- Errors: TERMO_INVALIDO, PRODUTO_INVALIDO, TERMO_JA_APROVADO,
-- TERMO_JA_PENDENTE, TERMO_DESATIVADO_PELA_GESTAO.
create or replace function public.sugerir_termo_busca(
  p_session_token text,
  p_produto text,
  p_termo text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_produto text;
  v_termo text;
  v_id uuid;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_produto := public.estoque_termo_busca_produto_key(p_produto);
  v_termo := public.estoque_termo_busca_canonico(p_termo);

  perform public.estoque_termos_busca_verificar_slot(
    v_produto, public.estoque_normalizar_texto(v_termo));

  begin
    insert into public.estoque_termos_busca
      (produto, termo, termo_sugerido, status, origem, sugerido_por)
    values
      (v_produto, v_termo, v_termo, 'pendente', 'sugestao', v_ctx.id_funcionario)
    returning id into v_id;
  exception when unique_violation then
    -- Lost a race with a concurrent suggestion/addition of the same term.
    raise exception using errcode = 'P0001', message = 'TERMO_JA_PENDENTE';
  end;

  return v_id;
end;
$$;

revoke all on function public.sugerir_termo_busca(text, text, text) from public;
grant execute on function public.sugerir_termo_busca(text, text, text) to anon;

-- =============================================================================
-- Management RPCs (capability-gated)
-- =============================================================================

-- Moderation queue, oldest first, with the context needed to decide:
-- the reference's current approved terms and how many OTHER references
-- already carry the same normalised term as an approved term.
create or replace function public.get_termos_busca_pendentes(p_session_token text)
returns table (
  id uuid,
  produto text,
  desc_produto text,
  termo text,
  sugerido_por_nome text,
  sugerido_em timestamptz,
  termos_aprovados text[],
  outros_produtos_mesmo_termo integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.estoque_termos_busca_exigir_gestor(p_session_token);

  return query
  select
    t.id,
    t.produto,
    (select min(s.desc_produto) from public.estoque_atual s where s.produto = t.produto),
    t.termo,
    coalesce(nullif(btrim(f.apelido::text), ''), f.nome::text),
    t.sugerido_em,
    coalesce(
      (select array_agg(a.termo order by a.termo)
       from public.estoque_termos_busca a
       where a.produto = t.produto and a.status = 'aprovado'),
      '{}'::text[]),
    (select count(distinct o.produto)::integer
     from public.estoque_termos_busca o
     where o.termo_normalizado = t.termo_normalizado
       and o.status = 'aprovado'
       and o.produto <> t.produto)
  from public.estoque_termos_busca t
  join public.funcionarios f on f.id = t.sugerido_por
  where t.status = 'pendente'
  order by t.sugerido_em asc, t.id;
end;
$$;

revoke all on function public.get_termos_busca_pendentes(text) from public;
grant execute on function public.get_termos_busca_pendentes(text) to anon;

-- Every row of one reference (all statuses) with its audit trail, for the
-- Gerenciar termos view. The client splits approved vs history.
create or replace function public.get_termos_busca_produto_admin(
  p_session_token text,
  p_produto text
)
returns table (
  id uuid,
  termo text,
  termo_sugerido text,
  status text,
  origem text,
  sugerido_por_nome text,
  sugerido_em timestamptz,
  moderado_por_nome text,
  moderado_em timestamptz,
  desativado_por_nome text,
  desativado_em timestamptz,
  reativado_em timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_produto text;
begin
  perform public.estoque_termos_busca_exigir_gestor(p_session_token);
  v_produto := public.estoque_termo_busca_produto_key(p_produto);

  return query
  select
    t.id,
    t.termo,
    t.termo_sugerido,
    t.status,
    t.origem,
    coalesce(nullif(btrim(fs.apelido::text), ''), fs.nome::text),
    t.sugerido_em,
    coalesce(nullif(btrim(fm.apelido::text), ''), fm.nome::text),
    t.moderado_em,
    coalesce(nullif(btrim(fd.apelido::text), ''), fd.nome::text),
    t.desativado_em,
    t.reativado_em
  from public.estoque_termos_busca t
  join public.funcionarios fs on fs.id = t.sugerido_por
  left join public.funcionarios fm on fm.id = t.moderado_por
  left join public.funcionarios fd on fd.id = t.desativado_por
  where t.produto = v_produto
  order by
    case t.status when 'aprovado' then 0 when 'pendente' then 1 when 'desativado' then 2 else 3 end,
    t.termo,
    t.sugerido_em desc;
end;
$$;

revoke all on function public.get_termos_busca_produto_admin(text, text) from public;
grant execute on function public.get_termos_busca_produto_admin(text, text) to anon;

-- Direct admin addition: approved and searchable immediately, attributed to
-- the admin as both author and moderator. Same validation and duplicate
-- rules as a suggestion (a deactivated equivalent must be reactivated, not
-- re-added, so history stays in one row).
create or replace function public.adicionar_termo_busca_admin(
  p_session_token text,
  p_produto text,
  p_termo text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gestor uuid;
  v_produto text;
  v_termo text;
  v_id uuid;
begin
  v_gestor := public.estoque_termos_busca_exigir_gestor(p_session_token);
  v_produto := public.estoque_termo_busca_produto_key(p_produto);
  v_termo := public.estoque_termo_busca_canonico(p_termo);

  perform public.estoque_termos_busca_verificar_slot(
    v_produto, public.estoque_normalizar_texto(v_termo));

  begin
    insert into public.estoque_termos_busca
      (produto, termo, termo_sugerido, status, origem, sugerido_por, moderado_por, moderado_em)
    values
      (v_produto, v_termo, v_termo, 'aprovado', 'admin', v_gestor, v_gestor, now())
    returning id into v_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'TERMO_JA_PENDENTE';
  end;

  return v_id;
end;
$$;

revoke all on function public.adicionar_termo_busca_admin(text, text, text) from public;
grant execute on function public.adicionar_termo_busca_admin(text, text, text) to anon;

-- Single state-transition RPC. p_acao:
--   'aprovar'   pendente -> aprovado. p_termo_final (optional) is the
--               admin-edited value ("Editar e aprovar"); it passes the same
--               validation/duplicate rules and replaces `termo`, while
--               `termo_sugerido` keeps the employee's original.
--   'rejeitar'  pendente -> rejeitado (no reason required).
--   'desativar' aprovado -> desativado (stops contributing to search now).
--   'reativar'  desativado -> aprovado.
-- Errors: TERMO_NAO_ENCONTRADO, TRANSICAO_INVALIDA, ACAO_INVALIDA, plus the
-- validation/duplicate codes for 'aprovar' with an edited value.
create or replace function public.moderar_termo_busca(
  p_session_token text,
  p_id uuid,
  p_acao text,
  p_termo_final text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gestor uuid;
  v_row public.estoque_termos_busca%rowtype;
  v_termo text;
begin
  v_gestor := public.estoque_termos_busca_exigir_gestor(p_session_token);

  if p_acao not in ('aprovar', 'rejeitar', 'desativar', 'reativar') then
    raise exception using errcode = 'P0001', message = 'ACAO_INVALIDA';
  end if;

  select * into v_row from public.estoque_termos_busca t where t.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'TERMO_NAO_ENCONTRADO';
  end if;

  if p_acao = 'aprovar' then
    if v_row.status <> 'pendente' then
      raise exception using errcode = 'P0001', message = 'TRANSICAO_INVALIDA';
    end if;

    v_termo := public.estoque_termo_busca_canonico(coalesce(nullif(trim(p_termo_final), ''), v_row.termo));

    if public.estoque_normalizar_texto(v_termo) <> v_row.termo_normalizado then
      perform public.estoque_termos_busca_verificar_slot(
        v_row.produto, public.estoque_normalizar_texto(v_termo), v_row.id);
    end if;

    begin
      update public.estoque_termos_busca
      set termo = v_termo,
          status = 'aprovado',
          moderado_por = v_gestor,
          moderado_em = now(),
          atualizado_em = now()
      where id = v_row.id;
    exception when unique_violation then
      raise exception using errcode = 'P0001', message = 'TERMO_JA_APROVADO';
    end;

  elsif p_acao = 'rejeitar' then
    if v_row.status <> 'pendente' then
      raise exception using errcode = 'P0001', message = 'TRANSICAO_INVALIDA';
    end if;

    update public.estoque_termos_busca
    set status = 'rejeitado',
        moderado_por = v_gestor,
        moderado_em = now(),
        atualizado_em = now()
    where id = v_row.id;

  elsif p_acao = 'desativar' then
    if v_row.status <> 'aprovado' then
      raise exception using errcode = 'P0001', message = 'TRANSICAO_INVALIDA';
    end if;

    update public.estoque_termos_busca
    set status = 'desativado',
        desativado_por = v_gestor,
        desativado_em = now(),
        atualizado_em = now()
    where id = v_row.id;

  else -- reativar
    if v_row.status <> 'desativado' then
      raise exception using errcode = 'P0001', message = 'TRANSICAO_INVALIDA';
    end if;

    update public.estoque_termos_busca
    set status = 'aprovado',
        reativado_por = v_gestor,
        reativado_em = now(),
        atualizado_em = now()
    where id = v_row.id;
  end if;

  return true;
end;
$$;

revoke all on function public.moderar_termo_busca(text, uuid, text, text) from public;
grant execute on function public.moderar_termo_busca(text, uuid, text, text) to anon;

commit;
