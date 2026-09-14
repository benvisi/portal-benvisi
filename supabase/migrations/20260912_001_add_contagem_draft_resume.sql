begin;

-- =============================================================================
-- Contagem de Embalagens — resumable draft ("em_andamento") support.
--
-- V1 (20260827_001) was single-shot: submeter_contagem created a fully-formed
-- contagens row in one atomic insert, and any unfinished count existed only
-- in the browser's component state — closing the tab lost all progress.
--
-- This adds a third status, 'em_andamento', that any authenticated employee
-- can start, resume, and autosave progress into before finalizing. The
-- existing review flow (get_contagens_pendentes, get_contagem_historico,
-- get_contagem_detalhe, marcar_contagem_revisada) is untouched — those only
-- ever see rows already past 'em_andamento'.
--
-- Only one em_andamento row may exist at a time (contagens_uma_ativa_idx, a
-- partial unique index on status) — this is the "one active count" rule,
-- enforced by Postgres itself, not application logic. Any employee resumes
-- it via get_or_start_contagem_ativa, which reports iniciado_por/iniciado_em
-- ("who started it and when") — distinct from submetido_por/em, which now
-- mean "who finalized it and when" and are only set at finalize time.
-- finalizar_contagem (replacing submeter_contagem) keeps the exact same
-- completeness validation V1 had.
-- =============================================================================

alter table public.contagens
  add column iniciado_por uuid references public.funcionarios(id),
  add column iniciado_em timestamptz;

-- Backfill: every existing row was submitted single-shot, so "started" and
-- "submitted" are the same person/moment for historical data.
update public.contagens
set iniciado_por = submetido_por,
    iniciado_em = submetido_em
where iniciado_por is null;

alter table public.contagens
  alter column iniciado_por set not null,
  alter column iniciado_em set not null,
  alter column iniciado_em set default now();

-- submetido_por/em now mean "who/when finalized" and are unknown while a
-- draft is still em_andamento, so they can no longer be NOT NULL.
alter table public.contagens
  alter column submetido_por drop not null,
  alter column submetido_em drop not null;

alter table public.contagens drop constraint contagens_status_check;
alter table public.contagens add constraint contagens_status_check
  check (status in ('em_andamento', 'pendente_revisao', 'revisada'));

alter table public.contagens drop constraint contagens_check;
alter table public.contagens add constraint contagens_check
  check (
    (status = 'em_andamento'
      and submetido_por is null and submetido_em is null
      and revisada_por is null and revisada_em is null)
    or (status = 'pendente_revisao'
      and submetido_por is not null and submetido_em is not null
      and revisada_por is null and revisada_em is null)
    or (status = 'revisada'
      and submetido_por is not null and submetido_em is not null
      and revisada_por is not null and revisada_em is not null)
  );

-- One active (in-progress) count at a time. All qualifying rows have the
-- same indexed value ('em_andamento'), so uniqueness over that value within
-- the partial predicate means at most one row may qualify.
create unique index contagens_uma_ativa_idx
  on public.contagens (status)
  where status = 'em_andamento';

-- -----------------------------------------------------------------------------
-- get_or_start_contagem_ativa — any authenticated employee. Returns the
-- single em_andamento draft, creating it if none exists, together with any
-- item values already autosaved into it. One row per saved item; if nothing
-- has been saved yet, one row is still returned with the item columns null
-- (LEFT JOIN), so header info (who started it, when) is never lost.
--
-- pg_advisory_xact_lock serializes concurrent "start" attempts so two
-- employees opening the form at the same instant cannot both pass the
-- not-exists check and race the partial unique index into a raw
-- unique_violation — same idiom this project already uses for lista_vez.
-- -----------------------------------------------------------------------------
create function public.get_or_start_contagem_ativa(
  p_session_token text
)
returns table (
  id_contagem uuid,
  iniciado_por_nome text,
  iniciado_em timestamptz,
  id_item uuid,
  pacotes_fechados int,
  unidades_avulsas int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_id_contagem uuid;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  perform pg_advisory_xact_lock(hashtext('contagem_ativa')::bigint);

  select c.id into v_id_contagem
  from public.contagens c
  where c.status = 'em_andamento';

  if v_id_contagem is null then
    insert into public.contagens (iniciado_por, status)
    values (v_ctx.id_funcionario, 'em_andamento')
    returning contagens.id into v_id_contagem;
  end if;

  return query
    select
      h.id,
      coalesce(nullif(btrim(f.apelido::text), ''), f.nome::text),
      h.iniciado_em,
      ci.id_item,
      ci.pacotes_fechados,
      ci.unidades_avulsas
    from public.contagens h
    join public.funcionarios f on f.id = h.iniciado_por
    left join public.contagem_itens ci on ci.id_contagem = h.id
    where h.id = v_id_contagem;
end;
$$;

revoke all on function public.get_or_start_contagem_ativa(text) from public;
grant execute on function public.get_or_start_contagem_ativa(text) to anon;

-- -----------------------------------------------------------------------------
-- salvar_progresso_contagem — any authenticated employee. Autosave: upserts
-- whatever the employee has filled in so far into contagem_itens. Unlike
-- finalizar_contagem, partial payloads are expected and normal — there is no
-- completeness requirement here, only per-item shape/range validation.
-- Rejects if the target contagem is not the current em_andamento draft
-- (already finalized, or a stale id from a previous draft the caller had
-- open) so a slow autosave can never silently resurrect a closed count.
-- -----------------------------------------------------------------------------
create function public.salvar_progresso_contagem(
  p_session_token text,
  p_id_contagem uuid,
  p_itens jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_item jsonb;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if not exists (
    select 1 from public.contagens c
    where c.id = p_id_contagem and c.status = 'em_andamento'
  ) then
    raise exception using errcode = 'P0001', message = 'CONTAGEM_NAO_ATIVA';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception using errcode = 'P0001', message = 'ITENS_INVALIDOS';
  end if;

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

  insert into public.contagem_itens (id_contagem, id_item, pacotes_fechados, unidades_avulsas)
  select
    p_id_contagem,
    (r.id_item)::uuid,
    r.pacotes_fechados,
    coalesce(r.unidades_avulsas, 0)
  from jsonb_to_recordset(p_itens)
    as r(id_item text, pacotes_fechados int, unidades_avulsas int)
  on conflict (id_contagem, id_item) do update
    set pacotes_fechados = excluded.pacotes_fechados,
        unidades_avulsas = excluded.unidades_avulsas;

  return true;
end;
$$;

revoke all on function public.salvar_progresso_contagem(text, uuid, jsonb) from public;
grant execute on function public.salvar_progresso_contagem(text, uuid, jsonb) to anon;

-- -----------------------------------------------------------------------------
-- finalizar_contagem — replaces submeter_contagem. Any authenticated
-- employee. Same completeness validation as V1's submeter_contagem (the
-- provided items must be exactly the active catalog set, once each, all
-- valid), but now it transitions the caller's already-open em_andamento
-- draft to pendente_revisao instead of inserting a fresh row, and stamps
-- submetido_por/em at that moment. `for update` + the status re-check in the
-- UPDATE's WHERE clause make a double finalize safe (matches
-- marcar_contagem_revisada's guard against a concurrent double review).
-- -----------------------------------------------------------------------------
drop function if exists public.submeter_contagem(text, jsonb, text);

create function public.finalizar_contagem(
  p_session_token text,
  p_id_contagem uuid,
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
  if v_entradas <> v_ativos then
    raise exception using errcode = 'P0001', message = 'CONTAGEM_INCOMPLETA';
  end if;

  perform 1 from public.contagens where id = p_id_contagem for update;

  update public.contagens
  set submetido_por = v_ctx.id_funcionario,
      submetido_em = now(),
      status = 'pendente_revisao',
      observacao = v_observacao
  where id = p_id_contagem and status = 'em_andamento';

  if not found then
    raise exception using errcode = 'P0001', message = 'CONTAGEM_JA_FINALIZADA';
  end if;

  insert into public.contagem_itens (id_contagem, id_item, pacotes_fechados, unidades_avulsas)
  select
    p_id_contagem,
    (r.id_item)::uuid,
    r.pacotes_fechados,
    coalesce(r.unidades_avulsas, 0)
  from jsonb_to_recordset(p_itens)
    as r(id_item text, pacotes_fechados int, unidades_avulsas int)
  on conflict (id_contagem, id_item) do update
    set pacotes_fechados = excluded.pacotes_fechados,
        unidades_avulsas = excluded.unidades_avulsas;

  return p_id_contagem;
end;
$$;

revoke all on function public.finalizar_contagem(text, uuid, jsonb, text) from public;
grant execute on function public.finalizar_contagem(text, uuid, jsonb, text) to anon;

commit;
