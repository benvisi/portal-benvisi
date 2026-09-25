begin;

-- =============================================================================
-- Treinamento V1 — Slice 1 foundation (schema, validators, triggers, RPCs)
--
-- Employee-facing home: Conhecimento & Cultura (Blueprint section 12). This
-- migration is the whole database/runtime foundation; no UI exists yet and
-- none is implied. Approved contract: hybrid five-table model —
--
--   treinamento_modulos    stable module identity (slug, display order)
--   treinamento_versoes    revisions: one draft max, one published max
--   treinamento_blocos     ordered blocks of one version ('texto'|'cenario')
--   treinamento_progresso  one employee attempt against ONE version
--   treinamento_respostas  one persisted answer per answered scenario
--
-- Architecture notes that the rest of this file depends on:
--
-- 1. Published versions are IMMUTABLE. Enforced three ways (narrowest
--    reliable combination): RLS-with-no-policies + no DML grants (so the
--    only write path is the SECURITY DEFINER RPCs below), explicit
--    status/`for update` checks inside every authoring RPC, and triggers
--    that physically refuse to mutate a non-draft version's rows. The
--    triggers are what keeps the guarantee true against a future careless
--    RPC or migration — historical employee evidence must not silently
--    change.
--
-- 2. Deriving a draft from a published version copies the blocks with NEW
--    block ids and NEW option uuids, keeping lineage in
--    treinamento_versoes.derivada_de / treinamento_blocos.origem_bloco_id.
--    A response therefore always names one exact version's block + option
--    and can never be confused with evidence from another revision.
--    Consequence: an unedited derived draft is NOT byte-identical to its
--    parent, so the zero-diff publish refusal compares
--    treinamento_bloco_comparavel(), which strips option ids.
--
-- 3. The answer key is withheld until the employee answers. abrir_treinamento
--    projects unanswered 'cenario' blocks through treinamento_bloco_publico()
--    (no classificacao, no feedback, no fechamento); responder_cenario_
--    treinamento returns the evaluation. A block the caller already answered
--    in this attempt comes back in full — one rule that covers resume and
--    review alike.
--
-- 4. Authoring/publishing is Administrador-only, checked server-side by
--    treinamento_exigir_admin. No capability column is introduced in V1
--    (deliberate: shipping an ungranted flag with no management UI). Adding
--    one later changes only that one function.
--
-- Precedents followed: escala_publicacoes (publication + partial-unique
-- "one active" + validate/publish in one RPC, 20260825_003 / 20260914_004),
-- the zero-diff publish refusal (20260914_009), ADR-011/ADR-015 versioned
-- definition + versioned JSONB responses (20260821_001), and the
-- estoque_termos_busca authorization/grant shape (20260915_001).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Block content validation.
--
-- treinamento_bloco_erro is the single source of truth: it RETURNS an error
-- code (null = valid) instead of raising, so the same rules can back three
-- different needs without ever drifting apart —
--   * the CHECK constraint (treinamento_bloco_conteudo_valido),
--   * the raising validator used by authoring RPCs (treinamento_validar_bloco),
--   * the per-block error list the paste-import preview reports.
-- The approved contract described the boolean wrapper as catching the raising
-- validator's exception; returning the code and deriving both wrappers from it
-- is the same behaviour without a broad `when others` handler.
-- -----------------------------------------------------------------------------
create or replace function public.treinamento_bloco_erro(
  p_tipo text,
  p_conteudo jsonb
)
returns text
language plpgsql
immutable
as $$
declare
  v_uuid_re constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_chaves text[];
  v_chaves_opcao text[];
  v_item jsonb;
  v_ids text[] := '{}'::text[];
  v_melhores int := 0;
  v_n int;
  v_txt text;
begin
  if p_tipo is null or p_tipo not in ('texto', 'cenario') then
    return 'BLOCO_TIPO_INVALIDO';
  end if;

  if p_conteudo is null or jsonb_typeof(p_conteudo) <> 'object' then
    return 'CONTEUDO_NAO_OBJETO';
  end if;

  select coalesce(array_agg(k), '{}'::text[]) into v_chaves
  from jsonb_object_keys(p_conteudo) as k;

  if p_tipo = 'texto' then
    if not (v_chaves <@ array['titulo', 'paragrafos', 'destaques']::text[]) then
      return 'CHAVES_DESCONHECIDAS';
    end if;

    if jsonb_typeof(p_conteudo -> 'paragrafos') <> 'array' then
      return 'TEXTO_PARAGRAFOS_INVALIDOS';
    end if;
    v_n := jsonb_array_length(p_conteudo -> 'paragrafos');
    if v_n < 1 or v_n > 10 then
      return 'TEXTO_PARAGRAFOS_INVALIDOS';
    end if;
    for v_item in select * from jsonb_array_elements(p_conteudo -> 'paragrafos') loop
      if jsonb_typeof(v_item) <> 'string' then
        return 'TEXTO_PARAGRAFOS_INVALIDOS';
      end if;
      v_txt := btrim(v_item #>> '{}');
      if length(v_txt) < 1 or length(v_txt) > 1200 then
        return 'TEXTO_PARAGRAFOS_INVALIDOS';
      end if;
    end loop;

    if p_conteudo ? 'titulo' and jsonb_typeof(p_conteudo -> 'titulo') <> 'null' then
      if jsonb_typeof(p_conteudo -> 'titulo') <> 'string' then
        return 'TEXTO_TITULO_INVALIDO';
      end if;
      v_txt := btrim(p_conteudo ->> 'titulo');
      if length(v_txt) < 1 or length(v_txt) > 120 then
        return 'TEXTO_TITULO_INVALIDO';
      end if;
    end if;

    if p_conteudo ? 'destaques' and jsonb_typeof(p_conteudo -> 'destaques') <> 'null' then
      if jsonb_typeof(p_conteudo -> 'destaques') <> 'array' then
        return 'TEXTO_DESTAQUES_INVALIDOS';
      end if;
      if jsonb_array_length(p_conteudo -> 'destaques') > 8 then
        return 'TEXTO_DESTAQUES_INVALIDOS';
      end if;
      for v_item in select * from jsonb_array_elements(p_conteudo -> 'destaques') loop
        if jsonb_typeof(v_item) <> 'string' then
          return 'TEXTO_DESTAQUES_INVALIDOS';
        end if;
        v_txt := btrim(v_item #>> '{}');
        if length(v_txt) < 1 or length(v_txt) > 200 then
          return 'TEXTO_DESTAQUES_INVALIDOS';
        end if;
      end loop;
    end if;

    return null;
  end if;

  -- p_tipo = 'cenario'
  if not (v_chaves <@ array['situacao', 'pergunta', 'opcoes', 'fechamento']::text[]) then
    return 'CHAVES_DESCONHECIDAS';
  end if;

  if jsonb_typeof(p_conteudo -> 'situacao') <> 'string' then
    return 'CENARIO_SITUACAO_INVALIDA';
  end if;
  v_txt := btrim(p_conteudo ->> 'situacao');
  if length(v_txt) < 20 or length(v_txt) > 1200 then
    return 'CENARIO_SITUACAO_INVALIDA';
  end if;

  if jsonb_typeof(p_conteudo -> 'pergunta') <> 'string' then
    return 'CENARIO_PERGUNTA_INVALIDA';
  end if;
  v_txt := btrim(p_conteudo ->> 'pergunta');
  if length(v_txt) < 5 or length(v_txt) > 200 then
    return 'CENARIO_PERGUNTA_INVALIDA';
  end if;

  if p_conteudo ? 'fechamento' and jsonb_typeof(p_conteudo -> 'fechamento') <> 'null' then
    if jsonb_typeof(p_conteudo -> 'fechamento') <> 'string' then
      return 'CENARIO_FECHAMENTO_INVALIDO';
    end if;
    v_txt := btrim(p_conteudo ->> 'fechamento');
    if length(v_txt) < 1 or length(v_txt) > 600 then
      return 'CENARIO_FECHAMENTO_INVALIDO';
    end if;
  end if;

  if jsonb_typeof(p_conteudo -> 'opcoes') <> 'array' then
    return 'CENARIO_OPCOES_INVALIDAS';
  end if;
  v_n := jsonb_array_length(p_conteudo -> 'opcoes');
  if v_n < 2 or v_n > 5 then
    return 'CENARIO_OPCOES_INVALIDAS';
  end if;

  for v_item in select * from jsonb_array_elements(p_conteudo -> 'opcoes') loop
    if jsonb_typeof(v_item) <> 'object' then
      return 'OPCAO_INVALIDA';
    end if;

    select coalesce(array_agg(k), '{}'::text[]) into v_chaves_opcao
    from jsonb_object_keys(v_item) as k;
    if not (v_chaves_opcao <@ array['id', 'texto', 'classificacao', 'feedback']::text[]) then
      return 'CHAVES_DESCONHECIDAS';
    end if;

    if jsonb_typeof(v_item -> 'id') <> 'string' or (v_item ->> 'id') !~ v_uuid_re then
      return 'OPCAO_ID_INVALIDO';
    end if;
    if lower(v_item ->> 'id') = any (v_ids) then
      return 'OPCAO_DUPLICADA';
    end if;
    v_ids := v_ids || lower(v_item ->> 'id');

    if jsonb_typeof(v_item -> 'texto') <> 'string' then
      return 'OPCAO_INVALIDA';
    end if;
    v_txt := btrim(v_item ->> 'texto');
    if length(v_txt) < 5 or length(v_txt) > 300 then
      return 'OPCAO_INVALIDA';
    end if;

    if (v_item ->> 'classificacao') is null
       or (v_item ->> 'classificacao') not in ('best', 'acceptable', 'needs_improvement') then
      return 'OPCAO_CLASSIFICACAO_INVALIDA';
    end if;

    if jsonb_typeof(v_item -> 'feedback') <> 'string' then
      return 'OPCAO_INVALIDA';
    end if;
    v_txt := btrim(v_item ->> 'feedback');
    if length(v_txt) < 10 or length(v_txt) > 600 then
      return 'OPCAO_INVALIDA';
    end if;

    if (v_item ->> 'classificacao') = 'best' then
      v_melhores := v_melhores + 1;
    end if;
  end loop;

  -- Exactly one 'best' option is what identifies the preferred Benvisi
  -- behaviour; there is deliberately no separate "preferida" flag to drift.
  if v_melhores = 0 then
    return 'CENARIO_SEM_MELHOR';
  end if;
  if v_melhores > 1 then
    return 'CENARIO_MELHOR_DUPLICADA';
  end if;

  return null;
end;
$$;

revoke all on function public.treinamento_bloco_erro(text, jsonb) from public;

-- Boolean wrapper — the CHECK constraint on treinamento_blocos.
create or replace function public.treinamento_bloco_conteudo_valido(
  p_tipo text,
  p_conteudo jsonb
)
returns boolean
language sql
immutable
as $$
  select public.treinamento_bloco_erro(p_tipo, p_conteudo) is null;
$$;

revoke all on function public.treinamento_bloco_conteudo_valido(text, jsonb) from public;

-- Raising wrapper — used by authoring RPCs so the client gets a specific,
-- mappable code instead of a raw check-constraint violation.
create or replace function public.treinamento_validar_bloco(
  p_tipo text,
  p_conteudo jsonb
)
returns void
language plpgsql
immutable
as $$
declare
  v_erro text;
begin
  v_erro := public.treinamento_bloco_erro(p_tipo, p_conteudo);
  if v_erro is not null then
    raise exception using errcode = 'P0001', message = v_erro;
  end if;
end;
$$;

revoke all on function public.treinamento_validar_bloco(text, jsonb) from public;

-- Block-level principle ids. Duplicated from src/config/principios.ts by
-- design: adding a lookup table for five static ids would contradict the
-- existing "Nossos Princípios is static approved content" decision (3A).
create or replace function public.treinamento_principios_erro(p_principios jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_item jsonb;
  v_vistos text[] := '{}'::text[];
begin
  if p_principios is null or jsonb_typeof(p_principios) <> 'array' then
    return 'PRINCIPIOS_INVALIDOS';
  end if;
  if jsonb_array_length(p_principios) > 3 then
    return 'PRINCIPIOS_EXCESSIVOS';
  end if;
  for v_item in select * from jsonb_array_elements(p_principios) loop
    if jsonb_typeof(v_item) <> 'string'
       or (v_item #>> '{}') not in
          ('integridade', 'foco-no-cliente', 'colaboracao', 'transparencia', 'qualidade') then
      return 'PRINCIPIO_INVALIDO';
    end if;
    if (v_item #>> '{}') = any (v_vistos) then
      return 'PRINCIPIO_DUPLICADO';
    end if;
    v_vistos := v_vistos || (v_item #>> '{}');
  end loop;
  return null;
end;
$$;

revoke all on function public.treinamento_principios_erro(jsonb) from public;

-- Version metadata rules, shared by create / save / import.
create or replace function public.treinamento_metadados_erro(
  p_titulo text,
  p_resumo text,
  p_duracao_estimada_min smallint
)
returns text
language sql
immutable
as $$
  select case
    when p_titulo is null or length(btrim(p_titulo)) < 3 or length(btrim(p_titulo)) > 120
      then 'TITULO_INVALIDO'
    when p_resumo is not null
         and (length(btrim(p_resumo)) < 3 or length(btrim(p_resumo)) > 300)
      then 'RESUMO_INVALIDO'
    when p_duracao_estimada_min is not null
         and (p_duracao_estimada_min < 1 or p_duracao_estimada_min > 60)
      then 'DURACAO_INVALIDA'
    else null
  end;
$$;

revoke all on function public.treinamento_metadados_erro(text, text, smallint) from public;

-- -----------------------------------------------------------------------------
-- Employee projection: strips the answer key from an unanswered scenario.
-- 'texto' blocks pass through untouched.
-- -----------------------------------------------------------------------------
create or replace function public.treinamento_bloco_publico(
  p_tipo text,
  p_conteudo jsonb
)
returns jsonb
language sql
immutable
as $$
  select case
    when p_tipo <> 'cenario' then p_conteudo
    else jsonb_build_object(
      'situacao', p_conteudo -> 'situacao',
      'pergunta', p_conteudo -> 'pergunta',
      'opcoes', coalesce((
        select jsonb_agg(jsonb_build_object('id', o -> 'id', 'texto', o -> 'texto') order by ord)
        from jsonb_array_elements(
          case when jsonb_typeof(p_conteudo -> 'opcoes') = 'array'
               then p_conteudo -> 'opcoes' else '[]'::jsonb end
        ) with ordinality t(o, ord)
      ), '[]'::jsonb))
  end;
$$;

revoke all on function public.treinamento_bloco_publico(text, jsonb) from public;

-- -----------------------------------------------------------------------------
-- Canonical comparison form — everything that is authored MEANING, with the
-- machine-generated option ids removed and surrounding whitespace folded.
-- This is what makes "refuse to publish an unchanged revision" work at all:
-- deriving a draft regenerates every option id, so a raw jsonb comparison
-- would report a difference for a draft nobody edited.
-- -----------------------------------------------------------------------------
create or replace function public.treinamento_bloco_comparavel(
  p_tipo text,
  p_conteudo jsonb
)
returns jsonb
language sql
immutable
as $$
  select case
    when p_tipo = 'texto' then jsonb_build_object(
      'titulo', btrim(coalesce(p_conteudo ->> 'titulo', '')),
      'paragrafos', coalesce((
        select jsonb_agg(btrim(e) order by ord)
        from jsonb_array_elements_text(
          case when jsonb_typeof(p_conteudo -> 'paragrafos') = 'array'
               then p_conteudo -> 'paragrafos' else '[]'::jsonb end
        ) with ordinality t(e, ord)), '[]'::jsonb),
      'destaques', coalesce((
        select jsonb_agg(btrim(e) order by ord)
        from jsonb_array_elements_text(
          case when jsonb_typeof(p_conteudo -> 'destaques') = 'array'
               then p_conteudo -> 'destaques' else '[]'::jsonb end
        ) with ordinality t(e, ord)), '[]'::jsonb))
    when p_tipo = 'cenario' then jsonb_build_object(
      'situacao', btrim(coalesce(p_conteudo ->> 'situacao', '')),
      'pergunta', btrim(coalesce(p_conteudo ->> 'pergunta', '')),
      'fechamento', btrim(coalesce(p_conteudo ->> 'fechamento', '')),
      'opcoes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'texto', btrim(coalesce(o ->> 'texto', '')),
          'classificacao', coalesce(o ->> 'classificacao', ''),
          'feedback', btrim(coalesce(o ->> 'feedback', ''))) order by ord)
        from jsonb_array_elements(
          case when jsonb_typeof(p_conteudo -> 'opcoes') = 'array'
               then p_conteudo -> 'opcoes' else '[]'::jsonb end
        ) with ordinality t(o, ord)), '[]'::jsonb))
    else p_conteudo
  end;
$$;

revoke all on function public.treinamento_bloco_comparavel(text, jsonb) from public;

-- -----------------------------------------------------------------------------
-- Option-id ownership. p_preservar = false regenerates every option id (the
-- copy-on-derive and paste-import paths); true keeps well-formed ids and
-- generates one for any option that lacks one (the form-editor round trip).
-- Ids are always normalised to canonical lower-case uuid text, which is what
-- the response trigger compares against.
-- -----------------------------------------------------------------------------
create or replace function public.treinamento_normalizar_ids_opcoes(
  p_tipo text,
  p_conteudo jsonb,
  p_preservar boolean
)
returns jsonb
language sql
volatile
as $$
  select case
    when p_tipo is distinct from 'cenario'
      or jsonb_typeof(p_conteudo -> 'opcoes') <> 'array' then p_conteudo
    else jsonb_set(p_conteudo, '{opcoes}', coalesce((
      select jsonb_agg(
        jsonb_set(o, '{id}', to_jsonb(
          case
            when p_preservar
             and jsonb_typeof(o -> 'id') = 'string'
             and (o ->> 'id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then lower(o ->> 'id')
            else gen_random_uuid()::text
          end)) order by ord)
      from jsonb_array_elements(p_conteudo -> 'opcoes') with ordinality t(o, ord)
    ), '[]'::jsonb))
  end;
$$;

revoke all on function public.treinamento_normalizar_ids_opcoes(text, jsonb, boolean) from public;

-- Copy-on-derive helper named by the approved contract.
create or replace function public.treinamento_regenerar_ids_opcoes(
  p_tipo text,
  p_conteudo jsonb
)
returns jsonb
language sql
volatile
as $$
  select public.treinamento_normalizar_ids_opcoes(p_tipo, p_conteudo, false);
$$;

revoke all on function public.treinamento_regenerar_ids_opcoes(text, jsonb) from public;

-- Normalises a whole incoming block array into exactly the shape the applier
-- writes, BEFORE validation — so what is validated is byte-for-byte what is
-- stored. p_preservar_ids = false additionally drops every incoming block id
-- (the paste-import rule: ids are server-owned, never author-supplied).
create or replace function public.treinamento_normalizar_blocos(
  p_blocos jsonb,
  p_preservar_ids boolean
)
returns jsonb
language sql
volatile
as $$
  select coalesce((
    select jsonb_agg(
      (case when p_preservar_ids and jsonb_typeof(t.elem -> 'id') = 'string'
            then jsonb_build_object('id', t.elem -> 'id')
            else '{}'::jsonb end)
      || jsonb_build_object(
           'tipo', t.elem -> 'tipo',
           'principios', case when jsonb_typeof(t.elem -> 'principios') = 'array'
                              then t.elem -> 'principios' else '[]'::jsonb end,
           'conteudo', public.treinamento_normalizar_ids_opcoes(
                         t.elem ->> 'tipo', t.elem -> 'conteudo', p_preservar_ids))
      order by t.ord)
    from jsonb_array_elements(p_blocos) with ordinality t(elem, ord)
  ), '[]'::jsonb);
$$;

revoke all on function public.treinamento_normalizar_blocos(jsonb, boolean) from public;

-- -----------------------------------------------------------------------------
-- Authorization helper. Same shape as estoque_termos_busca_exigir_gestor
-- (20260915_001), but cargo-based: Training V1 authoring is Administrador
-- only and deliberately introduces no capability column. Never granted to
-- anon — called only from within the SECURITY DEFINER RPCs below.
-- -----------------------------------------------------------------------------
create or replace function public.treinamento_exigir_admin(p_session_token text)
returns uuid
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
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_TREINAMENTO';
  end if;

  return v_ctx.id_funcionario;
end;
$$;

revoke all on function public.treinamento_exigir_admin(text) from public;

-- =============================================================================
-- Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Módulos — stable identity only. Title/resumo/duração live on the VERSION
-- because they are revisable content, not identity. Modules are never
-- deleted; arquivado_em retires one from the employee list while preserving
-- every historical attempt.
-- -----------------------------------------------------------------------------
create table public.treinamento_modulos (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique
                   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  ordem_exibicao int not null default 0,
  criado_por     uuid not null references public.funcionarios(id),
  criado_em      timestamptz not null default now(),
  arquivado_por  uuid references public.funcionarios(id),
  arquivado_em   timestamptz,
  check ((arquivado_em is null) = (arquivado_por is null))
);

alter table public.treinamento_modulos enable row level security;
-- No policies, no DML grants: every read and write goes through the
-- SECURITY DEFINER RPCs below, exactly like every other Portal table.

-- -----------------------------------------------------------------------------
-- 2. Versões. `versao` is assigned at DRAFT CREATION (max+1 under a module
-- row lock), not at publication — the simplest durable model; a discarded
-- draft leaves a gap, which is harmless because the number is a label, not a
-- count. publicado_em/por are assigned only at publish.
--
-- The two partial unique indexes are the one-draft and one-current-publication
-- rules, enforced by Postgres rather than by application logic (same device as
-- escala_publicacoes_mes_ativa_key).
-- -----------------------------------------------------------------------------
create table public.treinamento_versoes (
  id                   uuid primary key default gen_random_uuid(),
  id_modulo            uuid not null references public.treinamento_modulos(id) on delete restrict,
  versao               int not null check (versao > 0),
  status               text not null check (status in ('rascunho', 'publicada', 'arquivada')),
  titulo               text not null check (length(btrim(titulo)) between 3 and 120),
  resumo               text check (resumo is null or length(btrim(resumo)) between 3 and 300),
  duracao_estimada_min smallint
                         check (duracao_estimada_min is null
                                or duracao_estimada_min between 1 and 60),
  derivada_de          uuid references public.treinamento_versoes(id),
  criado_por           uuid not null references public.funcionarios(id),
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  publicado_por        uuid references public.funcionarios(id),
  publicado_em         timestamptz,
  arquivado_em         timestamptz,
  unique (id_modulo, versao),
  unique (id, id_modulo),
  check ((publicado_em is null) = (publicado_por is null)),
  check ((status = 'rascunho') = (publicado_em is null)),
  check ((status = 'arquivada') = (arquivado_em is not null))
);

alter table public.treinamento_versoes enable row level security;

create unique index treinamento_versoes_um_rascunho_uidx
  on public.treinamento_versoes (id_modulo) where status = 'rascunho';

create unique index treinamento_versoes_uma_publicada_uidx
  on public.treinamento_versoes (id_modulo) where status = 'publicada';

create index treinamento_versoes_modulo_status_idx
  on public.treinamento_versoes (id_modulo, status);

-- -----------------------------------------------------------------------------
-- 3. Blocos. `ordem` is DEFERRABLE so the draft applier can renumber and
-- reorder in one statement without temp-shuffling values.
-- `unique (id, id_versao)` exists purely as the composite-FK target that lets
-- progresso/respostas prove version membership relationally.
-- -----------------------------------------------------------------------------
create table public.treinamento_blocos (
  id              uuid primary key default gen_random_uuid(),
  id_versao       uuid not null references public.treinamento_versoes(id) on delete cascade,
  ordem           int not null check (ordem > 0),
  tipo            text not null check (tipo in ('texto', 'cenario')),
  principios      text[] not null default '{}'::text[],
  conteudo        jsonb not null,
  origem_bloco_id uuid references public.treinamento_blocos(id) on delete set null,
  criado_em       timestamptz not null default now(),
  constraint treinamento_blocos_principios_check
    check (principios <@ array['integridade', 'foco-no-cliente', 'colaboracao',
                               'transparencia', 'qualidade']::text[]),
  constraint treinamento_blocos_principios_max_check
    check (coalesce(array_length(principios, 1), 0) <= 3),
  constraint treinamento_blocos_conteudo_check
    check (public.treinamento_bloco_conteudo_valido(tipo, conteudo)),
  unique (id, id_versao),
  constraint treinamento_blocos_versao_ordem_key
    unique (id_versao, ordem) deferrable initially immediate
);

alter table public.treinamento_blocos enable row level security;

-- -----------------------------------------------------------------------------
-- 4. Progresso — one employee attempt against ONE version.
--
-- id_modulo is denormalised only so the "one active attempt per module"
-- partial unique index can exist; the composite FK to (id, id_modulo) makes
-- it impossible for it to disagree with the version's own module.
-- The (id_bloco_atual, id_versao) FK is MATCH SIMPLE: a null current block is
-- simply unenforced, which is the intended "not started" state.
-- -----------------------------------------------------------------------------
create table public.treinamento_progresso (
  id             uuid primary key default gen_random_uuid(),
  id_funcionario uuid not null references public.funcionarios(id) on delete cascade,
  id_modulo      uuid not null,
  id_versao      uuid not null,
  tentativa      int not null default 1 check (tentativa > 0),
  status         text not null check (status in ('em_andamento', 'concluido')),
  id_bloco_atual uuid,
  iniciado_em    timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  concluido_em   timestamptz,
  unique (id, id_versao),
  unique (id_versao, id_funcionario, tentativa),
  foreign key (id_versao, id_modulo)
    references public.treinamento_versoes (id, id_modulo),
  foreign key (id_bloco_atual, id_versao)
    references public.treinamento_blocos (id, id_versao),
  check ((status = 'concluido') = (concluido_em is not null))
);

alter table public.treinamento_progresso enable row level security;

create unique index treinamento_progresso_ativo_uidx
  on public.treinamento_progresso (id_funcionario, id_modulo)
  where status = 'em_andamento';

create index treinamento_progresso_funcionario_idx
  on public.treinamento_progresso (id_funcionario, status);

create index treinamento_progresso_versao_idx
  on public.treinamento_progresso (id_versao);

-- -----------------------------------------------------------------------------
-- 5. Respostas — append-only evidence.
--
-- The two composite FKs both carry id_versao, which is what makes "the
-- answered block belongs to the same version as the attempt" a Postgres
-- guarantee rather than an RPC convention. `classificacao` is denormalised
-- from immutable published content and is SET BY TRIGGER, never accepted
-- from the caller.
-- -----------------------------------------------------------------------------
create table public.treinamento_respostas (
  id            uuid primary key default gen_random_uuid(),
  id_progresso  uuid not null,
  id_versao     uuid not null,
  id_bloco      uuid not null,
  id_opcao      uuid not null,
  classificacao text not null
                  check (classificacao in ('best', 'acceptable', 'needs_improvement')),
  respondido_em timestamptz not null default now(),
  unique (id_progresso, id_bloco),
  foreign key (id_progresso, id_versao)
    references public.treinamento_progresso (id, id_versao) on delete cascade,
  foreign key (id_bloco, id_versao)
    references public.treinamento_blocos (id, id_versao)
);

alter table public.treinamento_respostas enable row level security;

create index treinamento_respostas_bloco_idx
  on public.treinamento_respostas (id_bloco, classificacao);

-- =============================================================================
-- Integrity triggers — the part that survives a future careless RPC
-- =============================================================================

-- Published/archived block rows are physically immutable. The `v_status is
-- not null` guard is what allows the legitimate cascade: when a DRAFT version
-- row is deleted, its parent row is already gone by the time the child
-- delete fires, so the lookup returns no row and the cascade proceeds.
create or replace function public.treinamento_blocos_imutavel()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  select v.status into v_status
  from public.treinamento_versoes v
  where v.id = old.id_versao;

  if v_status is not null and v_status <> 'rascunho' then
    raise exception using errcode = 'P0001', message = 'CONTEUDO_PUBLICADO_IMUTAVEL';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger treinamento_blocos_imutavel_trg
  before update or delete on public.treinamento_blocos
  for each row execute function public.treinamento_blocos_imutavel();

-- Version transitions: rascunho -> publicada -> arquivada, one way only, and
-- no content metadata may change once the version has left 'rascunho'.
create or replace function public.treinamento_versoes_transicao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'rascunho' then
    if new.status not in ('rascunho', 'publicada') then
      raise exception using errcode = 'P0001', message = 'TRANSICAO_INVALIDA';
    end if;
    return new;
  end if;

  if new.id_modulo is distinct from old.id_modulo
     or new.versao is distinct from old.versao
     or new.titulo is distinct from old.titulo
     or new.resumo is distinct from old.resumo
     or new.duracao_estimada_min is distinct from old.duracao_estimada_min
     or new.derivada_de is distinct from old.derivada_de
     or new.criado_por is distinct from old.criado_por
     or new.criado_em is distinct from old.criado_em
     or new.publicado_por is distinct from old.publicado_por
     or new.publicado_em is distinct from old.publicado_em then
    raise exception using errcode = 'P0001', message = 'CONTEUDO_PUBLICADO_IMUTAVEL';
  end if;

  if old.status = 'publicada' and new.status not in ('publicada', 'arquivada') then
    raise exception using errcode = 'P0001', message = 'TRANSICAO_INVALIDA';
  end if;

  if old.status = 'arquivada'
     and (new.status <> 'arquivada' or new.arquivado_em is distinct from old.arquivado_em) then
    raise exception using errcode = 'P0001', message = 'CONTEUDO_PUBLICADO_IMUTAVEL';
  end if;

  return new;
end;
$$;

create trigger treinamento_versoes_transicao_trg
  before update on public.treinamento_versoes
  for each row execute function public.treinamento_versoes_transicao();

-- Only a draft version may be deleted.
create or replace function public.treinamento_versoes_delete_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'rascunho' then
    raise exception using errcode = 'P0001', message = 'CONTEUDO_PUBLICADO_IMUTAVEL';
  end if;
  return old;
end;
$$;

create trigger treinamento_versoes_delete_guard_trg
  before delete on public.treinamento_versoes
  for each row execute function public.treinamento_versoes_delete_guard();

-- Responses are append-only. A direct UPDATE or DELETE is refused; the only
-- permitted removal is the cascade from a deleted attempt, detected exactly
-- the same way as the block cascade above (parent already gone).
create or replace function public.treinamento_respostas_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.treinamento_progresso p where p.id = old.id_progresso) then
      raise exception using errcode = 'P0001', message = 'RESPOSTA_IMUTAVEL';
    end if;
    return old;
  end if;

  raise exception using errcode = 'P0001', message = 'RESPOSTA_IMUTAVEL';
end;
$$;

create trigger treinamento_respostas_append_only_trg
  before update or delete on public.treinamento_respostas
  for each row execute function public.treinamento_respostas_append_only();

-- The one guarantee a relational FK cannot express, because options live in
-- JSONB: the selected option must actually exist inside THAT scenario block.
-- classificacao is OVERWRITTEN from the stored immutable option rather than
-- merely checked, so no caller — not even a direct table write — can record a
-- flattering classification.
create or replace function public.treinamento_respostas_validar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_bloco record;
  v_opcao jsonb;
begin
  select b.tipo, b.conteudo into v_bloco
  from public.treinamento_blocos b
  where b.id = new.id_bloco and b.id_versao = new.id_versao;

  if not found then
    raise exception using errcode = 'P0001', message = 'BLOCO_NAO_ENCONTRADO';
  end if;

  if v_bloco.tipo <> 'cenario' then
    raise exception using errcode = 'P0001', message = 'BLOCO_NAO_E_CENARIO';
  end if;

  select o into v_opcao
  from jsonb_array_elements(v_bloco.conteudo -> 'opcoes') as t(o)
  where lower(o ->> 'id') = new.id_opcao::text
  limit 1;

  if v_opcao is null then
    raise exception using errcode = 'P0001', message = 'OPCAO_INVALIDA';
  end if;

  new.classificacao := v_opcao ->> 'classificacao';
  return new;
end;
$$;

create trigger treinamento_respostas_validar_trg
  before insert on public.treinamento_respostas
  for each row execute function public.treinamento_respostas_validar();

-- =============================================================================
-- Shared draft applier
-- =============================================================================

-- Full replacement of a draft's block set in one statement: blocks absent
-- from the payload are deleted, blocks carrying an id that really belongs to
-- this draft are updated in place (keeping their identity and origem lineage),
-- everything else is inserted with a fresh id. Array position defines `ordem`.
-- Never called directly by a client — internal to the authoring RPCs.
create or replace function public.treinamento_aplicar_blocos(
  p_id_versao uuid,
  p_blocos jsonb
)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_total int;
begin
  -- The reorder case (e.g. swapping ordem 1 and 2) transiently collides on
  -- (id_versao, ordem); deferring to end-of-transaction is what makes a
  -- single-statement rewrite possible.
  set constraints public.treinamento_blocos_versao_ordem_key deferred;

  with entrada as (
    select
      (t.ord)::int as ordem,
      t.elem ->> 'tipo' as tipo,
      coalesce((
        select array_agg(p order by o)
        from jsonb_array_elements_text(t.elem -> 'principios') with ordinality k(p, o)
      ), '{}'::text[]) as principios,
      t.elem -> 'conteudo' as conteudo,
      case
        when jsonb_typeof(t.elem -> 'id') = 'string'
         and (t.elem ->> 'id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         and exists (
           select 1 from public.treinamento_blocos b
           where b.id = (t.elem ->> 'id')::uuid and b.id_versao = p_id_versao)
          then (t.elem ->> 'id')::uuid
        else gen_random_uuid()
      end as id
    from jsonb_array_elements(p_blocos) with ordinality t(elem, ord)
  ),
  removidos as (
    delete from public.treinamento_blocos b
    where b.id_versao = p_id_versao
      and not exists (select 1 from entrada e where e.id = b.id)
    returning 1
  )
  insert into public.treinamento_blocos (id, id_versao, ordem, tipo, principios, conteudo)
  select e.id, p_id_versao, e.ordem, e.tipo, e.principios, e.conteudo
  from entrada e
  on conflict (id) do update
    set ordem = excluded.ordem,
        tipo = excluded.tipo,
        principios = excluded.principios,
        conteudo = excluded.conteudo;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

revoke all on function public.treinamento_aplicar_blocos(uuid, jsonb) from public;

-- Canonical comparison signature of a whole version, used by the zero-diff
-- publish refusal. Includes version metadata: retitling a module IS a change.
create or replace function public.treinamento_versao_assinatura(p_id_versao uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'titulo', btrim(v.titulo),
    'resumo', btrim(coalesce(v.resumo, '')),
    'duracao_estimada_min', coalesce(v.duracao_estimada_min, 0),
    'blocos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ordem', b.ordem,
        'tipo', b.tipo,
        'principios', to_jsonb(b.principios),
        'conteudo', public.treinamento_bloco_comparavel(b.tipo, b.conteudo)) order by b.ordem)
      from public.treinamento_blocos b where b.id_versao = v.id), '[]'::jsonb))
  from public.treinamento_versoes v
  where v.id = p_id_versao;
$$;

revoke all on function public.treinamento_versao_assinatura(uuid) from public;

-- =============================================================================
-- Employee runtime RPCs
-- =============================================================================

-- Modules with a current publication, plus the CALLER'S own state.
-- `estado` = 'concluido' only for a concluded attempt on the CURRENT published
-- version: having finished v1 when v2 is live is deliberately reported as
-- 'nao_iniciado', because there is genuinely new material to do.
create or replace function public.get_treinamentos_disponiveis(p_session_token text)
returns table (
  id_modulo uuid,
  slug text,
  titulo text,
  resumo text,
  duracao_estimada_min smallint,
  total_blocos int,
  id_versao_publicada uuid,
  estado text,
  concluido_em timestamptz
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
  select
    m.id,
    m.slug,
    v.titulo,
    v.resumo,
    v.duracao_estimada_min,
    (select count(*)::int from public.treinamento_blocos b where b.id_versao = v.id),
    v.id,
    case
      when ativo.id is not null then 'em_andamento'
      when feito.id is not null then 'concluido'
      else 'nao_iniciado'
    end,
    feito.concluido_em
  from public.treinamento_modulos m
  join public.treinamento_versoes v
    on v.id_modulo = m.id and v.status = 'publicada'
  left join lateral (
    select p.id
    from public.treinamento_progresso p
    where p.id_funcionario = v_ctx.id_funcionario
      and p.id_modulo = m.id
      and p.status = 'em_andamento'
  ) ativo on true
  left join lateral (
    select p.id, p.concluido_em
    from public.treinamento_progresso p
    where p.id_funcionario = v_ctx.id_funcionario
      and p.id_versao = v.id
      and p.status = 'concluido'
    order by p.tentativa desc
    limit 1
  ) feito on true
  where m.arquivado_em is null
  order by m.ordem_exibicao, v.titulo;
end;
$$;

revoke all on function public.get_treinamentos_disponiveis(text) from public;
grant execute on function public.get_treinamentos_disponiveis(text) to anon;

-- Open + start + resume, in one call. The SERVER owns the "which version does
-- this employee open" policy so it can evolve without a client change:
--   1. an active attempt (on ANY version) always resumes — someone mid-way
--      through v1 finishes v1 even after v2 is published;
--   2. otherwise a concluded attempt on the CURRENT published version opens
--      read-only in review mode;
--   3. otherwise a new attempt starts on the current published version.
create or replace function public.abrir_treinamento(
  p_session_token text,
  p_id_modulo uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_modulo record;
  v_pub record;
  v_prog record;
  v_versao record;
  v_modo text;
  v_primeiro uuid;
  v_blocos jsonb;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_modulo
  from public.treinamento_modulos m
  where m.id = p_id_modulo and m.arquivado_em is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'MODULO_NAO_ENCONTRADO';
  end if;

  -- Serialises concurrent opens by the same employee on the same module, so a
  -- double-tap can never race two attempts into existence.
  perform pg_advisory_xact_lock(
    hashtext('treinamento:' || v_ctx.id_funcionario::text || ':' || p_id_modulo::text)::bigint);

  select * into v_pub
  from public.treinamento_versoes v
  where v.id_modulo = p_id_modulo and v.status = 'publicada';

  select * into v_prog
  from public.treinamento_progresso p
  where p.id_funcionario = v_ctx.id_funcionario
    and p.id_modulo = p_id_modulo
    and p.status = 'em_andamento';

  if found then
    v_modo := 'andamento';
  else
    if v_pub.id is null then
      raise exception using errcode = 'P0001', message = 'MODULO_SEM_PUBLICACAO';
    end if;

    select * into v_prog
    from public.treinamento_progresso p
    where p.id_funcionario = v_ctx.id_funcionario
      and p.id_versao = v_pub.id
      and p.status = 'concluido'
    order by p.tentativa desc
    limit 1;

    if found then
      v_modo := 'revisao';
    else
      select b.id into v_primeiro
      from public.treinamento_blocos b
      where b.id_versao = v_pub.id
      order by b.ordem
      limit 1;

      insert into public.treinamento_progresso
        (id_funcionario, id_modulo, id_versao, tentativa, status, id_bloco_atual)
      values (
        v_ctx.id_funcionario,
        p_id_modulo,
        v_pub.id,
        coalesce((
          select max(p.tentativa) from public.treinamento_progresso p
          where p.id_funcionario = v_ctx.id_funcionario and p.id_versao = v_pub.id), 0) + 1,
        'em_andamento',
        v_primeiro)
      returning * into v_prog;

      v_modo := 'andamento';
    end if;
  end if;

  select * into v_versao
  from public.treinamento_versoes v
  where v.id = v_prog.id_versao;

  -- One uniform revelation rule: a scenario block is returned in full exactly
  -- when this attempt has already answered it.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'ordem', b.ordem,
      'tipo', b.tipo,
      'principios', to_jsonb(b.principios),
      'conteudo', case
        when b.tipo = 'cenario' and r.id is null
          then public.treinamento_bloco_publico(b.tipo, b.conteudo)
        else b.conteudo end,
      'resposta', case
        when r.id is null then null
        else jsonb_build_object(
          'id_opcao', r.id_opcao,
          'classificacao', r.classificacao,
          'respondido_em', r.respondido_em) end
    ) order by b.ordem), '[]'::jsonb)
  into v_blocos
  from public.treinamento_blocos b
  left join public.treinamento_respostas r
    on r.id_bloco = b.id and r.id_progresso = v_prog.id
  where b.id_versao = v_prog.id_versao;

  return jsonb_build_object(
    'modulo', jsonb_build_object(
      'id', v_modulo.id,
      'slug', v_modulo.slug,
      'titulo', v_versao.titulo,
      'resumo', v_versao.resumo,
      'duracao_estimada_min', v_versao.duracao_estimada_min),
    'versao', jsonb_build_object(
      'id', v_versao.id,
      'numero', v_versao.versao,
      'status', v_versao.status),
    'progresso', jsonb_build_object(
      'id', v_prog.id,
      'tentativa', v_prog.tentativa,
      'status', v_prog.status,
      'id_bloco_atual', v_prog.id_bloco_atual,
      'iniciado_em', v_prog.iniciado_em,
      'concluido_em', v_prog.concluido_em),
    'modo', v_modo,
    'blocos', v_blocos);
end;
$$;

revoke all on function public.abrir_treinamento(text, uuid) from public;
grant execute on function public.abrir_treinamento(text, uuid) to anon;

-- Record one scenario answer and return its evaluation. The first answer is
-- final within an attempt: re-sending the same option is idempotent, a
-- different option is refused. This is training, not testing — the employee
-- sees the feedback for what they chose AND the preferred Benvisi response.
create or replace function public.responder_cenario_treinamento(
  p_session_token text,
  p_id_progresso uuid,
  p_id_bloco uuid,
  p_id_opcao uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_prog record;
  v_bloco record;
  v_opcao jsonb;
  v_melhor jsonb;
  v_resp record;
  v_ja boolean := false;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_prog
  from public.treinamento_progresso p
  where p.id = p_id_progresso and p.id_funcionario = v_ctx.id_funcionario
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROGRESSO_NAO_ENCONTRADO';
  end if;
  if v_prog.status <> 'em_andamento' then
    raise exception using errcode = 'P0001', message = 'PROGRESSO_ENCERRADO';
  end if;

  select b.tipo, b.conteudo into v_bloco
  from public.treinamento_blocos b
  where b.id = p_id_bloco and b.id_versao = v_prog.id_versao;
  if not found then
    raise exception using errcode = 'P0001', message = 'BLOCO_NAO_ENCONTRADO';
  end if;
  if v_bloco.tipo <> 'cenario' then
    raise exception using errcode = 'P0001', message = 'BLOCO_NAO_E_CENARIO';
  end if;

  select o into v_opcao
  from jsonb_array_elements(v_bloco.conteudo -> 'opcoes') as t(o)
  where lower(o ->> 'id') = p_id_opcao::text
  limit 1;
  if v_opcao is null then
    raise exception using errcode = 'P0001', message = 'OPCAO_INVALIDA';
  end if;

  select o into v_melhor
  from jsonb_array_elements(v_bloco.conteudo -> 'opcoes') as t(o)
  where o ->> 'classificacao' = 'best'
  limit 1;

  select * into v_resp
  from public.treinamento_respostas r
  where r.id_progresso = v_prog.id and r.id_bloco = p_id_bloco;

  if found then
    if v_resp.id_opcao <> p_id_opcao then
      raise exception using errcode = 'P0001', message = 'RESPOSTA_JA_REGISTRADA';
    end if;
    v_ja := true;
  else
    begin
      -- classificacao is passed for completeness and independently
      -- overwritten by treinamento_respostas_validar from the stored option.
      insert into public.treinamento_respostas
        (id_progresso, id_versao, id_bloco, id_opcao, classificacao)
      values (v_prog.id, v_prog.id_versao, p_id_bloco, p_id_opcao,
              v_opcao ->> 'classificacao')
      returning * into v_resp;
    exception when unique_violation then
      select * into v_resp
      from public.treinamento_respostas r
      where r.id_progresso = v_prog.id and r.id_bloco = p_id_bloco;
      if v_resp.id_opcao <> p_id_opcao then
        raise exception using errcode = 'P0001', message = 'RESPOSTA_JA_REGISTRADA';
      end if;
      v_ja := true;
    end;

    update public.treinamento_progresso
    set atualizado_em = now()
    where id = v_prog.id;
  end if;

  return jsonb_build_object(
    'id_bloco', p_id_bloco,
    'id_opcao', p_id_opcao,
    'classificacao', v_resp.classificacao,
    'feedback', v_opcao ->> 'feedback',
    'melhor', jsonb_build_object(
      'id', v_melhor ->> 'id',
      'texto', v_melhor ->> 'texto',
      'feedback', v_melhor ->> 'feedback'),
    'fechamento', v_bloco.conteudo ->> 'fechamento',
    'ja_respondida', v_ja);
end;
$$;

revoke all on function public.responder_cenario_treinamento(text, uuid, uuid, uuid) from public;
grant execute on function public.responder_cenario_treinamento(text, uuid, uuid, uuid) to anon;

-- Move the resume point. Monotonic by design: a destination earlier than the
-- current position is accepted and ignored, which makes refresh, back button
-- and double-tap harmless without any client-side bookkeeping.
create or replace function public.avancar_treinamento(
  p_session_token text,
  p_id_progresso uuid,
  p_id_bloco_destino uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_prog record;
  v_ordem_destino int;
  v_ordem_atual int;
  v_avancou boolean := false;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_prog
  from public.treinamento_progresso p
  where p.id = p_id_progresso and p.id_funcionario = v_ctx.id_funcionario
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROGRESSO_NAO_ENCONTRADO';
  end if;
  if v_prog.status <> 'em_andamento' then
    raise exception using errcode = 'P0001', message = 'PROGRESSO_ENCERRADO';
  end if;

  select b.ordem into v_ordem_destino
  from public.treinamento_blocos b
  where b.id = p_id_bloco_destino and b.id_versao = v_prog.id_versao;
  if v_ordem_destino is null then
    raise exception using errcode = 'P0001', message = 'BLOCO_NAO_ENCONTRADO';
  end if;

  select coalesce((
    select b.ordem from public.treinamento_blocos b where b.id = v_prog.id_bloco_atual
  ), 0) into v_ordem_atual;

  if v_ordem_destino > v_ordem_atual then
    update public.treinamento_progresso
    set id_bloco_atual = p_id_bloco_destino,
        atualizado_em = now()
    where id = v_prog.id;
    v_avancou := true;
    v_ordem_atual := v_ordem_destino;
    v_prog.id_bloco_atual := p_id_bloco_destino;
  end if;

  return jsonb_build_object(
    'id_bloco_atual', v_prog.id_bloco_atual,
    'ordem', v_ordem_atual,
    'avancou', v_avancou);
end;
$$;

revoke all on function public.avancar_treinamento(text, uuid, uuid) from public;
grant execute on function public.avancar_treinamento(text, uuid, uuid) to anon;

-- Complete the attempt. Requires every scenario block of the version to have
-- been answered; text blocks need no evidence. Idempotent.
create or replace function public.concluir_treinamento(
  p_session_token text,
  p_id_progresso uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_prog record;
  v_total_cenarios int;
  v_respondidos int;
  v_ja boolean := false;
  v_resumo jsonb;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_prog
  from public.treinamento_progresso p
  where p.id = p_id_progresso and p.id_funcionario = v_ctx.id_funcionario
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROGRESSO_NAO_ENCONTRADO';
  end if;

  select count(*)::int into v_total_cenarios
  from public.treinamento_blocos b
  where b.id_versao = v_prog.id_versao and b.tipo = 'cenario';

  select count(*)::int into v_respondidos
  from public.treinamento_respostas r
  where r.id_progresso = v_prog.id;

  if v_prog.status = 'concluido' then
    v_ja := true;
  else
    if v_respondidos < v_total_cenarios then
      raise exception using errcode = 'P0001', message = 'TREINAMENTO_INCOMPLETO';
    end if;

    update public.treinamento_progresso
    set status = 'concluido',
        concluido_em = now(),
        atualizado_em = now()
    where id = v_prog.id
    returning * into v_prog;
  end if;

  select jsonb_build_object(
    'best', count(*) filter (where r.classificacao = 'best'),
    'acceptable', count(*) filter (where r.classificacao = 'acceptable'),
    'needs_improvement', count(*) filter (where r.classificacao = 'needs_improvement'))
  into v_resumo
  from public.treinamento_respostas r
  where r.id_progresso = v_prog.id;

  return jsonb_build_object(
    'id_progresso', v_prog.id,
    'concluido_em', v_prog.concluido_em,
    'total_cenarios', v_total_cenarios,
    'resumo', v_resumo,
    'ja_concluido', v_ja);
end;
$$;

revoke all on function public.concluir_treinamento(text, uuid) from public;
grant execute on function public.concluir_treinamento(text, uuid) to anon;

-- =============================================================================
-- Admin authoring RPCs (Administrador only)
-- =============================================================================

create or replace function public.get_treinamentos_admin(p_session_token text)
returns table (
  id_modulo uuid,
  slug text,
  ordem_exibicao int,
  arquivado boolean,
  titulo_atual text,
  id_versao_publicada uuid,
  versao_publicada int,
  publicado_em timestamptz,
  publicado_por_nome text,
  id_versao_rascunho uuid,
  versao_rascunho int,
  rascunho_atualizado_em timestamptz,
  total_versoes int,
  total_concluidos int
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.treinamento_exigir_admin(p_session_token);

  return query
  select
    m.id,
    m.slug,
    m.ordem_exibicao,
    (m.arquivado_em is not null),
    coalesce(pub.titulo, rasc.titulo, ult.titulo),
    pub.id,
    pub.versao,
    pub.publicado_em,
    coalesce(nullif(btrim(f.apelido::text), ''), f.nome),
    rasc.id,
    rasc.versao,
    rasc.atualizado_em,
    (select count(*)::int from public.treinamento_versoes v where v.id_modulo = m.id),
    (select count(*)::int from public.treinamento_progresso p
      where p.id_modulo = m.id and p.status = 'concluido')
  from public.treinamento_modulos m
  left join lateral (
    select v.* from public.treinamento_versoes v
    where v.id_modulo = m.id and v.status = 'publicada') pub on true
  left join lateral (
    select v.* from public.treinamento_versoes v
    where v.id_modulo = m.id and v.status = 'rascunho') rasc on true
  left join lateral (
    select v.* from public.treinamento_versoes v
    where v.id_modulo = m.id order by v.versao desc limit 1) ult on true
  left join public.funcionarios f on f.id = pub.publicado_por
  order by m.ordem_exibicao, coalesce(pub.titulo, rasc.titulo, ult.titulo);
end;
$$;

revoke all on function public.get_treinamentos_admin(text) from public;
grant execute on function public.get_treinamentos_admin(text) to anon;

-- Any version — draft, published or archived — in full, nothing stripped.
-- Backs the editor, the preview, and read-only inspection of history.
create or replace function public.get_treinamento_versao_admin(
  p_session_token text,
  p_id_versao uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_versao record;
  v_modulo record;
  v_blocos jsonb;
begin
  perform public.treinamento_exigir_admin(p_session_token);

  select * into v_versao from public.treinamento_versoes v where v.id = p_id_versao;
  if not found then
    raise exception using errcode = 'P0001', message = 'VERSAO_NAO_ENCONTRADA';
  end if;

  select * into v_modulo from public.treinamento_modulos m where m.id = v_versao.id_modulo;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'ordem', b.ordem,
      'tipo', b.tipo,
      'principios', to_jsonb(b.principios),
      'conteudo', b.conteudo,
      'origem_bloco_id', b.origem_bloco_id
    ) order by b.ordem), '[]'::jsonb)
  into v_blocos
  from public.treinamento_blocos b
  where b.id_versao = p_id_versao;

  return jsonb_build_object(
    'modulo', jsonb_build_object(
      'id', v_modulo.id,
      'slug', v_modulo.slug,
      'ordem_exibicao', v_modulo.ordem_exibicao,
      'arquivado', (v_modulo.arquivado_em is not null)),
    'versao', jsonb_build_object(
      'id', v_versao.id,
      'numero', v_versao.versao,
      'status', v_versao.status,
      'titulo', v_versao.titulo,
      'resumo', v_versao.resumo,
      'duracao_estimada_min', v_versao.duracao_estimada_min,
      'derivada_de', v_versao.derivada_de,
      'criado_em', v_versao.criado_em,
      'atualizado_em', v_versao.atualizado_em,
      'publicado_em', v_versao.publicado_em,
      'arquivado_em', v_versao.arquivado_em),
    'blocos', v_blocos);
end;
$$;

revoke all on function public.get_treinamento_versao_admin(text, uuid) from public;
grant execute on function public.get_treinamento_versao_admin(text, uuid) to anon;

-- Creating a module also creates its versao 1 draft: a module with no version
-- has no reason to exist, and one call means the pair can never be half-made.
create or replace function public.criar_modulo_treinamento(
  p_session_token text,
  p_slug text,
  p_titulo text,
  p_resumo text default null,
  p_duracao_estimada_min smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  v_slug text;
  v_erro text;
  v_id_modulo uuid;
  v_id_versao uuid;
begin
  v_admin := public.treinamento_exigir_admin(p_session_token);

  v_slug := lower(btrim(coalesce(p_slug, '')));
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) < 3 or length(v_slug) > 60 then
    raise exception using errcode = 'P0001', message = 'SLUG_INVALIDO';
  end if;

  v_erro := public.treinamento_metadados_erro(p_titulo, p_resumo, p_duracao_estimada_min);
  if v_erro is not null then
    raise exception using errcode = 'P0001', message = v_erro;
  end if;

  begin
    insert into public.treinamento_modulos (slug, criado_por)
    values (v_slug, v_admin)
    returning id into v_id_modulo;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'SLUG_DUPLICADO';
  end;

  insert into public.treinamento_versoes
    (id_modulo, versao, status, titulo, resumo, duracao_estimada_min, criado_por)
  values (v_id_modulo, 1, 'rascunho', btrim(p_titulo), nullif(btrim(coalesce(p_resumo, '')), ''),
          p_duracao_estimada_min, v_admin)
  returning id into v_id_versao;

  return jsonb_build_object(
    'id_modulo', v_id_modulo,
    'id_versao', v_id_versao,
    'versao', 1,
    'slug', v_slug);
end;
$$;

revoke all on function public.criar_modulo_treinamento(text, text, text, text, smallint) from public;
grant execute on function public.criar_modulo_treinamento(text, text, text, text, smallint) to anon;

-- "Edit published module": derive a new draft from the current publication.
-- Copies metadata and every block with NEW block ids and NEW option uuids,
-- keeping lineage. Nothing about the published version is touched, and the
-- whole derivation is one transaction — a failure leaves no partial draft.
create or replace function public.criar_rascunho_treinamento(
  p_session_token text,
  p_id_modulo uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  v_modulo record;
  v_pub record;
  v_id_versao uuid;
begin
  v_admin := public.treinamento_exigir_admin(p_session_token);

  select * into v_modulo
  from public.treinamento_modulos m
  where m.id = p_id_modulo
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'MODULO_NAO_ENCONTRADO';
  end if;

  if exists (
    select 1 from public.treinamento_versoes v
    where v.id_modulo = p_id_modulo and v.status = 'rascunho'
  ) then
    raise exception using errcode = 'P0001', message = 'RASCUNHO_JA_EXISTE';
  end if;

  select * into v_pub
  from public.treinamento_versoes v
  where v.id_modulo = p_id_modulo and v.status = 'publicada';
  if not found then
    raise exception using errcode = 'P0001', message = 'MODULO_SEM_PUBLICACAO';
  end if;

  insert into public.treinamento_versoes
    (id_modulo, versao, status, titulo, resumo, duracao_estimada_min, derivada_de, criado_por)
  values (
    p_id_modulo,
    coalesce((select max(v.versao) from public.treinamento_versoes v
              where v.id_modulo = p_id_modulo), 0) + 1,
    'rascunho',
    v_pub.titulo,
    v_pub.resumo,
    v_pub.duracao_estimada_min,
    v_pub.id,
    v_admin)
  returning id into v_id_versao;

  insert into public.treinamento_blocos
    (id_versao, ordem, tipo, principios, conteudo, origem_bloco_id)
  select
    v_id_versao,
    b.ordem,
    b.tipo,
    b.principios,
    public.treinamento_regenerar_ids_opcoes(b.tipo, b.conteudo),
    b.id
  from public.treinamento_blocos b
  where b.id_versao = v_pub.id
  order by b.ordem;

  return v_id_versao;
end;
$$;

revoke all on function public.criar_rascunho_treinamento(text, uuid) from public;
grant execute on function public.criar_rascunho_treinamento(text, uuid) to anon;

-- Full replace of a draft's metadata and block set — one write path covering
-- save, add, remove and reorder. Array position defines `ordem`.
create or replace function public.salvar_rascunho_treinamento(
  p_session_token text,
  p_id_versao uuid,
  p_titulo text,
  p_resumo text,
  p_duracao_estimada_min smallint,
  p_blocos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_versao record;
  v_erro text;
  v_blocos jsonb;
  v_elem jsonb;
  v_i int;
  v_total int;
begin
  perform public.treinamento_exigir_admin(p_session_token);

  select * into v_versao
  from public.treinamento_versoes v
  where v.id = p_id_versao
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'VERSAO_NAO_ENCONTRADA';
  end if;
  if v_versao.status <> 'rascunho' then
    raise exception using errcode = 'P0001', message = 'VERSAO_NAO_EDITAVEL';
  end if;

  v_erro := public.treinamento_metadados_erro(p_titulo, p_resumo, p_duracao_estimada_min);
  if v_erro is not null then
    raise exception using errcode = 'P0001', message = v_erro;
  end if;

  if p_blocos is null or jsonb_typeof(p_blocos) <> 'array' then
    raise exception using errcode = 'P0001', message = 'BLOCOS_INVALIDOS';
  end if;

  v_blocos := public.treinamento_normalizar_blocos(p_blocos, true);

  for v_i in 0 .. jsonb_array_length(v_blocos) - 1 loop
    v_elem := v_blocos -> v_i;
    v_erro := public.treinamento_bloco_erro(v_elem ->> 'tipo', v_elem -> 'conteudo');
    if v_erro is null then
      v_erro := public.treinamento_principios_erro(v_elem -> 'principios');
    end if;
    if v_erro is not null then
      raise exception using errcode = 'P0001', message = v_erro,
        detail = 'bloco ' || (v_i + 1)::text;
    end if;
  end loop;

  update public.treinamento_versoes
  set titulo = btrim(p_titulo),
      resumo = nullif(btrim(coalesce(p_resumo, '')), ''),
      duracao_estimada_min = p_duracao_estimada_min,
      atualizado_em = now()
  where id = p_id_versao;

  v_total := public.treinamento_aplicar_blocos(p_id_versao, v_blocos);

  return jsonb_build_object(
    'id_versao', p_id_versao,
    'total_blocos', v_total,
    'atualizado_em', now());
end;
$$;

revoke all on function public.salvar_rascunho_treinamento(text, uuid, text, text, smallint, jsonb) from public;
grant execute on function public.salvar_rascunho_treinamento(text, uuid, text, text, smallint, jsonb) to anon;

-- Paste-JSON import. Called twice with the SAME payload — once with
-- p_aplicar = false for the preview/error screen, once with true to apply —
-- exactly the escala_processar_importacao contract (20260914_004), so
-- apply-time validation can never drift from what the preview showed.
--
-- Full replacement, never a merge. Every incoming id is stripped and
-- regenerated server-side, which is what stops a pasted payload reusing a
-- published version's option ids. Nothing is written unless every block is
-- valid AND p_aplicar is true.
create or replace function public.treinamento_processar_importacao(
  p_session_token text,
  p_id_versao uuid,
  p_payload jsonb,
  p_aplicar boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_versao record;
  v_modulo record;
  v_blocos_in jsonb;
  v_blocos jsonb;
  v_elem jsonb;
  v_i int;
  v_erro text;
  v_erros jsonb := '[]'::jsonb;
  v_titulo text;
  v_resumo text;
  v_duracao smallint;
  v_total int;
  v_previa jsonb;
begin
  perform public.treinamento_exigir_admin(p_session_token);

  select * into v_versao
  from public.treinamento_versoes v
  where v.id = p_id_versao
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'VERSAO_NAO_ENCONTRADA';
  end if;
  if v_versao.status <> 'rascunho' then
    raise exception using errcode = 'P0001', message = 'VERSAO_NAO_EDITAVEL';
  end if;

  select * into v_modulo from public.treinamento_modulos m where m.id = v_versao.id_modulo;

  -- Fatal, payload-level problems: these are not per-block errors, they mean
  -- the paste is not this module's content at all.
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or coalesce(p_payload ->> 'formato', '') <> 'benvisi.treinamento.v1' then
    raise exception using errcode = 'P0001', message = 'FORMATO_DESCONHECIDO';
  end if;

  if (p_payload -> 'modulo' ->> 'slug') is not null
     and lower(btrim(p_payload -> 'modulo' ->> 'slug')) <> v_modulo.slug then
    raise exception using errcode = 'P0001', message = 'SLUG_DIVERGENTE';
  end if;

  v_blocos_in := p_payload -> 'blocos';
  if v_blocos_in is null or jsonb_typeof(v_blocos_in) <> 'array'
     or jsonb_array_length(v_blocos_in) = 0 then
    raise exception using errcode = 'P0001', message = 'BLOCOS_INVALIDOS';
  end if;

  v_titulo := coalesce(p_payload -> 'modulo' ->> 'titulo', v_versao.titulo);
  v_resumo := coalesce(p_payload -> 'modulo' ->> 'resumo', v_versao.resumo);
  v_duracao := coalesce(
    nullif(btrim(coalesce(p_payload -> 'modulo' ->> 'duracao_estimada_min', '')), '')::smallint,
    v_versao.duracao_estimada_min);

  v_erro := public.treinamento_metadados_erro(v_titulo, v_resumo, v_duracao);
  if v_erro is not null then
    v_erros := v_erros || jsonb_build_object('bloco', null, 'campo', 'modulo', 'codigo', v_erro);
  end if;

  -- Ids are generated BEFORE validation so that what is validated is exactly
  -- what would be stored.
  v_blocos := public.treinamento_normalizar_blocos(v_blocos_in, false);

  for v_i in 0 .. jsonb_array_length(v_blocos) - 1 loop
    v_elem := v_blocos -> v_i;
    v_erro := public.treinamento_bloco_erro(v_elem ->> 'tipo', v_elem -> 'conteudo');
    if v_erro is not null then
      v_erros := v_erros || jsonb_build_object(
        'bloco', v_i + 1, 'campo', 'conteudo', 'codigo', v_erro);
    end if;
    v_erro := public.treinamento_principios_erro(v_elem -> 'principios');
    if v_erro is not null then
      v_erros := v_erros || jsonb_build_object(
        'bloco', v_i + 1, 'campo', 'principios', 'codigo', v_erro);
    end if;
  end loop;

  if jsonb_array_length(v_erros) > 0 then
    return jsonb_build_object(
      'status', 'erro',
      'id_versao', p_id_versao,
      'erros', v_erros,
      'avisos', '[]'::jsonb,
      'previa', null);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'ordem', t.ord,
      'tipo', t.elem ->> 'tipo',
      'principios', t.elem -> 'principios',
      'titulo', coalesce(t.elem -> 'conteudo' ->> 'titulo',
                         t.elem -> 'conteudo' ->> 'pergunta')) order by t.ord), '[]'::jsonb)
  into v_previa
  from jsonb_array_elements(v_blocos) with ordinality t(elem, ord);

  if not p_aplicar then
    return jsonb_build_object(
      'status', 'pronto',
      'id_versao', p_id_versao,
      'erros', '[]'::jsonb,
      'avisos', '[]'::jsonb,
      'previa', jsonb_build_object(
        'titulo', btrim(v_titulo),
        'resumo', nullif(btrim(coalesce(v_resumo, '')), ''),
        'duracao_estimada_min', v_duracao,
        'total_blocos', jsonb_array_length(v_blocos),
        'blocos', v_previa));
  end if;

  update public.treinamento_versoes
  set titulo = btrim(v_titulo),
      resumo = nullif(btrim(coalesce(v_resumo, '')), ''),
      duracao_estimada_min = v_duracao,
      atualizado_em = now()
  where id = p_id_versao;

  v_total := public.treinamento_aplicar_blocos(p_id_versao, v_blocos);

  return jsonb_build_object(
    'status', 'aplicado',
    'id_versao', p_id_versao,
    'erros', '[]'::jsonb,
    'avisos', '[]'::jsonb,
    'previa', jsonb_build_object(
      'titulo', btrim(v_titulo),
      'resumo', nullif(btrim(coalesce(v_resumo, '')), ''),
      'duracao_estimada_min', v_duracao,
      'total_blocos', v_total,
      'blocos', v_previa));
end;
$$;

revoke all on function public.treinamento_processar_importacao(text, uuid, jsonb, boolean) from public;
grant execute on function public.treinamento_processar_importacao(text, uuid, jsonb, boolean) to anon;

-- Publish a draft. The previous publication is archived and the draft becomes
-- current in ONE transaction, so there is never a moment with two current
-- versions or none. An unchanged revision is refused (SEM_ALTERACOES) on the
-- same reasoning as the Escala zero-diff guard (20260914_009), comparing the
-- canonical signature that ignores regenerated option ids.
create or replace function public.publicar_rascunho_treinamento(
  p_session_token text,
  p_id_versao uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  v_versao record;
  v_pub record;
  v_bloco record;
  v_erro text;
  v_total int;
  v_publicado_em timestamptz;
begin
  v_admin := public.treinamento_exigir_admin(p_session_token);

  select * into v_versao
  from public.treinamento_versoes v
  where v.id = p_id_versao
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'VERSAO_NAO_ENCONTRADA';
  end if;
  if v_versao.status <> 'rascunho' then
    raise exception using errcode = 'P0001', message = 'VERSAO_NAO_EDITAVEL';
  end if;

  -- Serialises concurrent publishes for the same module.
  perform 1 from public.treinamento_modulos m where m.id = v_versao.id_modulo for update;

  select count(*)::int into v_total
  from public.treinamento_blocos b where b.id_versao = p_id_versao;
  if v_total = 0 then
    raise exception using errcode = 'P0001', message = 'RASCUNHO_VAZIO';
  end if;

  -- Re-validate from scratch at publish time rather than trusting that the
  -- content was valid when it was saved.
  for v_bloco in
    select b.ordem, b.tipo, b.conteudo from public.treinamento_blocos b
    where b.id_versao = p_id_versao order by b.ordem
  loop
    v_erro := public.treinamento_bloco_erro(v_bloco.tipo, v_bloco.conteudo);
    if v_erro is not null then
      raise exception using errcode = 'P0001', message = v_erro,
        detail = 'bloco ' || v_bloco.ordem::text;
    end if;
  end loop;

  select * into v_pub
  from public.treinamento_versoes v
  where v.id_modulo = v_versao.id_modulo and v.status = 'publicada'
  for update;

  if found then
    if public.treinamento_versao_assinatura(p_id_versao)
       = public.treinamento_versao_assinatura(v_pub.id) then
      raise exception using errcode = 'P0001', message = 'SEM_ALTERACOES';
    end if;

    -- Archive first: the one-publication-per-module index is immediate.
    update public.treinamento_versoes
    set status = 'arquivada',
        arquivado_em = now()
    where id = v_pub.id;
  end if;

  v_publicado_em := now();

  update public.treinamento_versoes
  set status = 'publicada',
      publicado_por = v_admin,
      publicado_em = v_publicado_em,
      atualizado_em = v_publicado_em
  where id = p_id_versao;

  return jsonb_build_object(
    'id_versao', p_id_versao,
    'versao', v_versao.versao,
    'publicado_em', v_publicado_em,
    'total_blocos', v_total,
    'versao_anterior', v_pub.id);
end;
$$;

revoke all on function public.publicar_rascunho_treinamento(text, uuid) from public;
grant execute on function public.publicar_rascunho_treinamento(text, uuid) to anon;

commit;
