\set ON_ERROR_STOP on
-- =============================================================================
-- Portal Benvisi baseline — 10: public schema at watermark 20260927_107
--
-- NOT a migration. NEVER run against an existing database. psql only.
-- GENERATED from a production schema-only pg_dump (2026-10-07 14:05:49);
-- source hash and the exact transformations are in README.md. Every line
-- changed from the source is marked "-- [baseline]". Do not hand-edit:
-- regenerate from a new dump instead.
-- =============================================================================

do $guard$
begin
  if exists (select 1 from pg_catalog.pg_tables where schemaname = 'public') then
    raise exception 'baseline refused: schema public already contains tables (existing Portal database?). The baseline only builds a blank environment.';
  end if;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'citext') then
    raise exception 'baseline refused: run 00_prerequisites.sql first (citext is not installed).';
  end if;
end
$guard$;

-- ------------------------- production pg_dump output follows ------------------
--
-- PostgreSQL database dump
--

\restrict EnVi85cauDUDc5AsrPQPqcoyMfgx4ue27yVH1YOVV7WqIkby7Ng90ahy8vOA9si

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- [baseline] skipped: Supabase provisions the public schema -- CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: abrir_treinamento(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.abrir_treinamento(p_session_token text, p_id_modulo uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: accept_termo(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_termo(p_session_token text, p_versao_termo text, p_texto_termo text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  insert into public.termos_aceite (id_funcionario, versao_termo, texto_termo, aceito_em)
  values (v_ctx.id_funcionario, p_versao_termo, p_texto_termo, now())
  on conflict (id_funcionario, versao_termo) do nothing;

  return true;
end;
$$;


--
-- Name: adicionar_termo_busca_admin(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.adicionar_termo_busca_admin(p_session_token text, p_produto text, p_termo text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: avancar_treinamento(text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.avancar_treinamento(p_session_token text, p_id_progresso uuid, p_id_bloco_destino uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: buscar_produtos_estoque(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.buscar_produtos_estoque(p_session_token text, p_termo text) RETURNS TABLE(produto text, desc_produto text, tipo_produto text, linha text, cores_disponiveis integer, unidades_total bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_ctx record;
  v_termo text;
  v_ref text;
  v_tokens text[];
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_termo := trim(regexp_replace(coalesce(p_termo, ''), '\s+', ' ', 'g'));
  if length(v_termo) < 2 then
    return;
  end if;

  -- Reference form of the query: upper-case, hyphens removed.
  v_ref := upper(replace(v_termo, '-', ''));

  -- Natural-language tokens: normalised, reduced to [a-z0-9-], leading
  -- hyphens dropped (\m needs a word character), stop-words and anything
  -- shorter than 2 chars removed (so "P%" cannot become a 1-char "p" token
  -- broader than the 2-char minimum the raw term obeys), then the gender-
  -- variant trim (final a/o dropped from tokens of 4+ chars — the token
  -- stays a valid word prefix of both forms). An empty array disables
  -- tier 3 (reference tiers still apply).
  select coalesce(array_agg(
           case when length(tok) >= 4 and tok ~ '[ao]$' then left(tok, -1) else tok end
         ), '{}'::text[])
  into v_tokens
  from (
    select regexp_replace(regexp_replace(t, '[^a-z0-9-]', '', 'g'), '^-+', '') as tok
    from unnest(string_to_array(public.estoque_normalizar_texto(v_termo), ' ')) as t
  ) x
  where tok ~ '[a-z0-9]'
    and length(tok) >= 2
    and tok not in ('de', 'da', 'do', 'das', 'dos', 'e');

  return query
  with referencias as (
    select
      s.produto,
      min(s.desc_produto) as desc_produto,
      min(s.tipo_produto) as tipo_produto,
      min(s.linha) as linha,
      count(distinct s.cor_codigo)::integer as cores_disponiveis,
      sum(s.quantidade_estoque)::bigint as unidades_total,
      string_agg(distinct concat_ws(' ', m.cor_nome_portal, m.cor_familia), ' ') as cores_texto
    from public.estoque_atual s
    left join public.estoque_cores_mapeamento m
      on m.cor_codigo = s.cor_codigo
     and m.cor_descricao_linx = s.cor_descricao_linx
    group by s.produto
  ),
  corpus as (
    select
      r.*,
      replace(r.produto, '-', '') as ref,
      public.estoque_normalizar_texto(concat_ws(' ',
        r.produto, r.desc_produto, r.tipo_produto, r.linha, r.cores_texto,
        (select string_agg(t.termo, ' ')
         from public.estoque_termos_busca t
         where t.produto = r.produto and t.status = 'aprovado')
      )) as texto
    from referencias r
  )
  select c.produto, c.desc_produto, c.tipo_produto, c.linha, c.cores_disponiveis, c.unidades_total
  from corpus c
  where c.ref = v_ref
     or left(c.ref, length(v_ref)) = v_ref
     or (
       cardinality(v_tokens) > 0
       and (select bool_and(c.texto ~ ('\m' || tok)) from unnest(v_tokens) as tok)
     )
  order by
    (c.ref = v_ref) desc,
    (left(c.ref, length(v_ref)) = v_ref) desc,
    c.produto
  limit 50;
end;
$_$;


--
-- Name: cancelar_atendimento_provisorio(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancelar_atendimento_provisorio(p_session_token text, p_id_atendimento uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_atendimento record;
  v_dia date;
  v_grace_seconds int;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_atendimento
  from public.atendimentos
  where id = p_id_atendimento and status = 'ativo'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'NENHUM_ATENDIMENTO_ATIVO';
  end if;

  if v_atendimento.id_funcionario <> v_ctx.id_funcionario
     and v_atendimento.id_funcionario_iniciador <> v_ctx.id_funcionario then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_CANCELAR';
  end if;

  v_grace_seconds := case
    when v_atendimento.id_funcionario_iniciador <> v_atendimento.id_funcionario then 60
    else 20
  end;

  if now() > v_atendimento.iniciado_em + make_interval(secs => v_grace_seconds) then
    raise exception using errcode = 'P0001', message = 'PRAZO_PROVISORIO_EXPIRADO';
  end if;

  v_dia := (v_atendimento.iniciado_em at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  update public.atendimentos
  set status = 'cancelado', cancelado_em = now(), id_funcionario_cancelou = v_ctx.id_funcionario
  where id = v_atendimento.id;

  update public.lista_vez_fila
  set disponivel = true, atualizado_em = now()
  where id_funcionario = v_atendimento.id_funcionario and dia_manaus = v_dia;

  return true;
end;
$$;


--
-- Name: cancelar_contagem_ativa(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancelar_contagem_ativa(p_session_token text, p_id_contagem uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  delete from public.contagens
  where id = p_id_contagem and status = 'em_andamento';

  if not found then
    raise exception using errcode = 'P0001', message = 'CONTAGEM_NAO_ATIVA';
  end if;

  return true;
end;
$$;


--
-- Name: check_termo_acceptance(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_termo_acceptance(p_session_token text, p_versao_termo text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  return exists (
    select 1
    from public.termos_aceite
    where id_funcionario = v_ctx.id_funcionario
      and versao_termo = p_versao_termo
  );
end;
$$;


--
-- Name: concluir_atendimento(text, jsonb, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.concluir_atendimento(p_session_token text, p_clientes jsonb, p_checklist jsonb, p_adiar_checklist boolean DEFAULT false) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  v_politica text;
  v_checklist_id uuid;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  perform public.transicionar_atendimento_pendente(v_ctx.id_funcionario);

  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = v_ctx.id_funcionario and status = 'finalizando'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

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

  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_adiar_checklist then
    if v_atendimento.checklist_obrigatorio is not null then
      if v_atendimento.checklist_obrigatorio then
        raise exception using errcode = 'P0001', message = 'ADIAMENTO_NAO_PERMITIDO';
      end if;
    else
      select cc.policy into v_politica from public.checklist_config cc where cc.id = 1 for share;

      if v_politica is distinct from 'defer_allowed' then
        raise exception using errcode = 'P0001', message = 'ADIAMENTO_NAO_PERMITIDO';
      end if;
    end if;

    perform pg_advisory_xact_lock(
      hashtext('checklist_pendencias:' || v_ctx.id_funcionario::text)::bigint
    );

    insert into public.checklist_pendencias (
      id_atendimento, id_funcionario, checklist_versao, politica_no_momento, status
    ) values (
      v_atendimento.id,
      v_ctx.id_funcionario,
      v_versao_ativa,
      coalesce(v_atendimento.checklist_politica_no_momento, v_politica),
      'pending'
    );
  else
    if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
      raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
    end if;

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

    insert into public.atendimento_checklists (
      id_atendimento, id_funcionario, versao, respostas, id_funcionario_ator, checklist_validado
    )
    values (v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_respostas, v_ctx.id_funcionario, true)
    returning id into v_checklist_id;

    perform public.resolver_checklist_pendencias(
      v_ctx.id_funcionario, 'fechamento_atendimento', v_checklist_id, null, v_versao_ativa
    );
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  update public.atendimentos
  set status = 'concluido',
      concluido_em = now(),
      id_funcionario_concluiu = v_ctx.id_funcionario
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


--
-- Name: concluir_atendimento_gerencial(text, uuid, jsonb, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.concluir_atendimento_gerencial(p_session_token text, p_id_atendimento uuid, p_clientes jsonb, p_checklist jsonb, p_ignorar_checklist boolean DEFAULT false) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_id_alvo uuid;
  v_atendimento record;
  v_dia date;
  v_cliente jsonb;
  v_id_motivo uuid;
  v_detalhe text;
  v_motivo record;
  v_versao_ativa int;
  v_codigos_confirmados text[];
  v_respostas jsonb;
  v_checklist_id uuid;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if v_ctx.cargo not in ('Administrador', 'Gerente') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_CONCLUIR_GERENCIAL';
  end if;

  select id_funcionario into v_id_alvo
  from public.atendimentos
  where id = p_id_atendimento;

  if v_id_alvo is null then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

  perform public.transicionar_atendimento_pendente(v_id_alvo);

  select * into v_atendimento
  from public.atendimentos
  where id = p_id_atendimento and status = 'finalizando'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

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

  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  select array_agg(elem ->> 'codigo')
  into v_codigos_confirmados
  from jsonb_array_elements(p_checklist) as elem
  where jsonb_typeof(elem) = 'object'
    and jsonb_typeof(elem -> 'concluido') = 'boolean'
    and (elem ->> 'concluido')::boolean is true
    and elem ->> 'codigo' is not null;

  if not p_ignorar_checklist and exists (
    select 1
    from public.atendimento_checklist_itens ci
    where ci.versao = v_versao_ativa
      and ci.ativo = true
      and ci.obrigatorio = true
      and not (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
  ) then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

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

  insert into public.atendimento_checklists (
    id_atendimento, id_funcionario, versao, respostas, id_funcionario_ator, checklist_validado
  )
  values (
    v_atendimento.id,
    v_atendimento.id_funcionario,
    v_versao_ativa,
    v_respostas,
    v_ctx.id_funcionario,
    not p_ignorar_checklist
  )
  returning id into v_checklist_id;

  if not p_ignorar_checklist then
    perform public.resolver_checklist_pendencias(
      v_atendimento.id_funcionario, 'fechamento_atendimento', v_checklist_id, null, v_versao_ativa
    );
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  update public.atendimentos
  set status = 'concluido',
      concluido_em = now(),
      id_funcionario_concluiu = v_ctx.id_funcionario
  where id = v_atendimento.id;

  insert into public.lista_vez_fila (id_funcionario, dia_manaus, na_fila, disponivel, posicao)
  values (v_atendimento.id_funcionario, v_dia, true, true, nextval('public.lista_vez_posicao_seq'))
  on conflict (id_funcionario, dia_manaus)
  do update set
    na_fila = true,
    disponivel = true,
    posicao = excluded.posicao,
    atualizado_em = now();

  return true;
end;
$$;


--
-- Name: concluir_atendimento_pendente(text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.concluir_atendimento_pendente(p_session_token text, p_clientes jsonb, p_checklist jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_atendimento record;
  v_cliente jsonb;
  v_id_motivo uuid;
  v_detalhe text;
  v_motivo record;
  v_versao_ativa int;
  v_codigos_confirmados text[];
  v_respostas jsonb;
  v_checklist_id uuid;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = v_ctx.id_funcionario and status = 'pendente_fechamento'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'NENHUM_ATENDIMENTO_PENDENTE';
  end if;

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

  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

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

  insert into public.atendimento_checklists (
    id_atendimento, id_funcionario, versao, respostas, id_funcionario_ator, checklist_validado
  )
  values (v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_respostas, v_ctx.id_funcionario, true)
  returning id into v_checklist_id;

  perform public.resolver_checklist_pendencias(
    v_ctx.id_funcionario, 'fechamento_atendimento', v_checklist_id, null, v_versao_ativa
  );

  update public.atendimentos
  set status = 'concluido',
      concluido_em = now(),
      id_funcionario_concluiu = v_ctx.id_funcionario
  where id = v_atendimento.id;

  return true;
end;
$$;


--
-- Name: concluir_checklist_avulso(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.concluir_checklist_avulso(p_session_token text, p_checklist jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_versao_ativa int;
  v_codigos_confirmados text[];
  v_respostas jsonb;
  v_conclusao_id uuid;
  v_resolved_count int;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  perform public.transicionar_atendimento_pendente(v_ctx.id_funcionario);

  if exists (
    select 1 from public.atendimentos
    where id_funcionario = v_ctx.id_funcionario
      and status in ('ativo', 'finalizando', 'pendente_fechamento')
  ) then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_ATIVO_IMPEDE_CHECKLIST_AVULSO';
  end if;

  if not exists (
    select 1 from public.checklist_pendencias
    where id_funcionario = v_ctx.id_funcionario and status = 'pending'
  ) then
    raise exception using errcode = 'P0001', message = 'SEM_CHECKLIST_PENDENTE';
  end if;

  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

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

  insert into public.checklist_conclusoes_avulsas (
    id_funcionario, id_funcionario_ator, versao, respostas
  ) values (
    v_ctx.id_funcionario, v_ctx.id_funcionario, v_versao_ativa, v_respostas
  )
  returning id into v_conclusao_id;

  v_resolved_count := public.resolver_checklist_pendencias(
    v_ctx.id_funcionario, 'checklist_avulso', null, v_conclusao_id, v_versao_ativa
  );

  return v_resolved_count;
end;
$$;


--
-- Name: concluir_treinamento(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.concluir_treinamento(p_session_token text, p_id_progresso uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: criar_modulo_treinamento(text, text, text, text, smallint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.criar_modulo_treinamento(p_session_token text, p_slug text, p_titulo text, p_resumo text DEFAULT NULL::text, p_duracao_estimada_min smallint DEFAULT NULL::smallint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;


--
-- Name: criar_rascunho_treinamento(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.criar_rascunho_treinamento(p_session_token text, p_id_modulo uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: entrar_lista_da_vez(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.entrar_lista_da_vez(p_session_token text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_dia date;
  v_fila record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  -- Stabilization: Administrador never personally participates in Lista da
  -- Vez, manual join included. Gerente is deliberately allowed past this
  -- check — manual participation is exactly what remains approved.
  if v_ctx.cargo = 'Administrador' then
    raise exception using errcode = 'P0001', message = 'SEM_PARTICIPACAO_ADMINISTRADOR';
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  if not exists (
    select 1 from public.turno_presenca
    where id_funcionario = v_ctx.id_funcionario
      and (checked_in_at at time zone 'America/Manaus')::date = v_dia
  ) then
    raise exception using errcode = 'P0001', message = 'ATIVIDADES_NAO_INICIADAS';
  end if;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  select * into v_fila
  from public.lista_vez_fila
  where id_funcionario = v_ctx.id_funcionario and dia_manaus = v_dia
  for update;

  if v_fila.id is not null and v_fila.na_fila then
    raise exception using errcode = 'P0001', message = 'JA_NA_LISTA';
  end if;

  insert into public.lista_vez_fila (id_funcionario, dia_manaus, na_fila, disponivel, posicao)
  values (v_ctx.id_funcionario, v_dia, true, true, nextval('public.lista_vez_posicao_seq'))
  on conflict (id_funcionario, dia_manaus)
  do update set
    na_fila = true,
    disponivel = true,
    posicao = excluded.posicao,
    atualizado_em = now();

  insert into public.lista_vez_eventos (id_funcionario, dia_manaus, tipo, id_funcionario_ator)
  values (v_ctx.id_funcionario, v_dia, 'reingresso', v_ctx.id_funcionario);

  return true;
end;
$$;


--
-- Name: escala_classificar_turno(time without time zone, time without time zone, time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.escala_classificar_turno(p_hora_inicio time without time zone, p_hora_fim time without time zone, p_abertura time without time zone, p_fechamento time without time zone) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when p_hora_inicio is null or p_hora_fim is null
      or p_abertura is null or p_fechamento is null then null
    when p_hora_inicio <= p_abertura and p_hora_fim >= p_fechamento then 'tarde'
    when p_hora_inicio <= p_abertura and p_hora_fim < p_fechamento then 'manha'
    when p_hora_inicio > p_abertura and p_hora_fim >= p_fechamento then 'tarde'
    else 'intermediario'
  end;
$$;


--
-- Name: escala_processar_importacao(text, date, text, text[], jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.escala_processar_importacao(p_session_token text, p_mes_referencia date, p_nome_arquivo text, p_funcionarios_planilha text[], p_entradas jsonb, p_publicar boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_ctx record;
  v_mes date := date_trunc('month', p_mes_referencia)::date;
  v_bloqueios jsonb := '[]'::jsonb;
  v_avisos jsonb := '[]'::jsonb;
  v_diff jsonb := '[]'::jsonb;
  v_publicacao_ativa_id uuid;
  v_is_revisao boolean;
  v_nova_publicacao_id uuid := null;
  v_registros bigint := 0;
  v_funcionarios bigint := 0;
  v_dias integer;
  v_status text := 'pronto';
  v_datas_afetadas date[];
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if v_ctx.cargo <> 'Administrador' then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_ESCALA';
  end if;

  if p_mes_referencia is null then
    raise exception using errcode = 'P0001', message = 'MES_REFERENCIA_OBRIGATORIO';
  end if;

  drop table if exists tmp_escala_raw;
  drop table if exists tmp_escala_resolvida;

  create temporary table tmp_escala_raw on commit drop as
  select
    (elem->>'nome_planilha') as nome_planilha,
    nullif(elem->>'data', '')::date as data,
    (elem->>'valor') as valor
  from jsonb_array_elements(coalesce(p_entradas, '[]'::jsonb)) as elem;

  create temporary table tmp_escala_resolvida on commit drop as
  with normalizado as (
    select
      r.nome_planilha,
      r.data,
      upper(btrim(r.valor)) as valor_norm,
      f.id as id_funcionario,
      f.apelido::text as apelido
    from tmp_escala_raw r
    left join public.funcionarios f
      on f.escala_nome_planilha = r.nome_planilha
      and f.is_active = true
      and f.cargo <> 'Administrador'
  ),
  classificado as (
    select
      n.*,
      h.abertura,
      h.fechamento,
      h.fechada,
      case
        when n.data is null or n.valor_norm is null or n.valor_norm = '' then 'VALOR_VAZIO'
        when n.id_funcionario is null then 'FUNCIONARIO_NAO_MAPEADO'
        when n.data < v_mes or n.data >= (v_mes + interval '1 month')::date then 'DATA_FORA_DO_MES'
        when n.valor_norm = 'FOLGA' then null
        when n.valor_norm in ('FÉRIAS', 'FERIAS') then null
        when n.valor_norm ~ '^[0-9]{1,2}:[0-9]{2}-[0-9]{1,2}:[0-9]{2}$' then
          case
            when split_part(n.valor_norm, '-', 2)::time <= split_part(n.valor_norm, '-', 1)::time
              then 'HORARIO_INCOERENTE'
            else null
          end
        when n.valor_norm in ('MANHÃ', 'MANHA', 'TARDE') then
          case
            when coalesce(h.fechada, true) or h.abertura is null or h.fechamento is null
              then 'TURNO_NAO_DERIVAVEL'
            else null
          end
        else 'VALOR_NAO_RECONHECIDO'
      end as problema
    from normalizado n
    left join lateral public.loja_horario_do_dia(n.data) h on true
  )
  select
    c.nome_planilha,
    c.data,
    c.valor_norm,
    c.id_funcionario,
    c.apelido,
    c.problema,
    case
      when c.problema is not null then null
      when c.valor_norm = 'FOLGA' then 'folga'
      when c.valor_norm in ('FÉRIAS', 'FERIAS') then 'ferias'
      else 'trabalho'
    end as status,
    case
      when c.problema is not null then null
      when c.valor_norm ~ '^[0-9]{1,2}:[0-9]{2}-[0-9]{1,2}:[0-9]{2}$'
        then split_part(c.valor_norm, '-', 1)::time
      when c.valor_norm in ('MANHÃ', 'MANHA') then c.abertura
      when c.valor_norm = 'TARDE' then c.abertura + (c.fechamento - c.abertura) / 2
      else null
    end as hora_inicio,
    case
      when c.problema is not null then null
      when c.valor_norm ~ '^[0-9]{1,2}:[0-9]{2}-[0-9]{1,2}:[0-9]{2}$'
        then split_part(c.valor_norm, '-', 2)::time
      when c.valor_norm in ('MANHÃ', 'MANHA') then c.abertura + (c.fechamento - c.abertura) / 2
      when c.valor_norm = 'TARDE' then c.fechamento
      else null
    end as hora_fim
  from classificado c;

  select coalesce(
    jsonb_agg(jsonb_build_object('codigo', problema, 'mensagem', mensagem)
      order by problema, nome_planilha, data),
    '[]'::jsonb
  )
  into v_bloqueios
  from (
    select distinct
      problema,
      nome_planilha,
      data,
      case problema
        when 'FUNCIONARIO_NAO_MAPEADO' then
          format('Funcionário "%s" não foi encontrado no Portal (%s).',
            nome_planilha, to_char(data, 'DD/MM/YYYY'))
        when 'DATA_FORA_DO_MES' then
          format('%s: data %s está fora do mês selecionado.',
            nome_planilha, to_char(data, 'DD/MM/YYYY'))
        when 'HORARIO_INCOERENTE' then
          format('%s em %s: horário "%s" é inválido.',
            nome_planilha, to_char(data, 'DD/MM/YYYY'), valor_norm)
        when 'TURNO_NAO_DERIVAVEL' then
          format('%s em %s: não foi possível calcular o horário de "%s" (loja fechada nesse dia).',
            nome_planilha, to_char(data, 'DD/MM/YYYY'), valor_norm)
        when 'VALOR_NAO_RECONHECIDO' then
          format('%s em %s: valor "%s" não é reconhecido.',
            nome_planilha, to_char(data, 'DD/MM/YYYY'), valor_norm)
        when 'VALOR_VAZIO' then
          format('%s: célula sem data ou valor válido.', nome_planilha)
      end as mensagem
    from tmp_escala_resolvida
    where problema is not null
  ) t;

  select v_bloqueios || coalesce(
    jsonb_agg(jsonb_build_object(
      'codigo', 'DUPLICADO',
      'mensagem', format('%s: mais de um valor encontrado para %s.', apelido, to_char(data, 'DD/MM/YYYY'))
    ) order by apelido, data),
    '[]'::jsonb
  )
  into v_bloqueios
  from (
    select apelido, data
    from tmp_escala_resolvida
    where problema is null
    group by id_funcionario, apelido, data
    having count(*) > 1
  ) d;

  if jsonb_array_length(v_bloqueios) = 0 then
    select count(*) into v_registros from tmp_escala_resolvida where problema is null;
    if v_registros = 0 then
      v_bloqueios := v_bloqueios || jsonb_build_array(jsonb_build_object(
        'codigo', 'NENHUM_DADO_VALIDO',
        'mensagem', 'Nenhum dado de escala válido foi encontrado para o mês selecionado.'
      ));
    end if;
  end if;

  if jsonb_array_length(v_bloqueios) > 0 then
    return jsonb_build_object(
      'status', 'bloqueado',
      'mes_referencia', v_mes,
      'bloqueios', v_bloqueios,
      'avisos', '[]'::jsonb,
      'diff', '[]'::jsonb,
      'contadores', jsonb_build_object('funcionarios', 0, 'dias', 0, 'registros', 0),
      'is_revisao', null,
      'publicacao_id', null,
      'publicacao_anterior_id', null
    );
  end if;

  select count(distinct id_funcionario), count(*)
  into v_funcionarios, v_registros
  from tmp_escala_resolvida
  where problema is null;

  v_dias := extract(day from ((v_mes + interval '1 month' - interval '1 day')))::int;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'codigo', 'FUNCIONARIO_AUSENTE',
      'mensagem', format('%s não aparece na escala deste mês.', f.apelido)
    ) order by f.apelido),
    '[]'::jsonb
  )
  into v_avisos
  from public.funcionarios f
  where f.is_active = true
    and f.cargo <> 'Administrador'
    and f.escala_nome_planilha is not null
    and not exists (
      select 1 from unnest(coalesce(p_funcionarios_planilha, array[]::text[])) np
      where f.escala_nome_planilha = np
    );

  select v_avisos || coalesce(
    jsonb_agg(jsonb_build_object(
      'codigo', 'FUNCIONARIO_SEM_ESCALA',
      'mensagem', format('%s está na planilha, mas sem nenhum dia preenchido neste mês.', f.apelido)
    ) order by f.apelido),
    '[]'::jsonb
  )
  into v_avisos
  from public.funcionarios f
  where f.is_active = true
    and f.cargo <> 'Administrador'
    and f.escala_nome_planilha is not null
    and exists (
      select 1 from unnest(coalesce(p_funcionarios_planilha, array[]::text[])) np
      where f.escala_nome_planilha = np
    )
    and not exists (
      select 1 from tmp_escala_resolvida t
      where t.id_funcionario = f.id and t.problema is null
    );

  select id into v_publicacao_ativa_id
  from public.escala_publicacoes
  where mes_referencia = v_mes and ativa = true;

  v_is_revisao := v_publicacao_ativa_id is not null;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'tipo', tipo,
      'id_funcionario', id_funcionario,
      'apelido', apelido,
      'data', data,
      'de_status', de_status,
      'de_hora_inicio', de_hora_inicio,
      'de_hora_fim', de_hora_fim,
      'para_status', para_status,
      'para_hora_inicio', para_hora_inicio,
      'para_hora_fim', para_hora_fim
    ) order by apelido, data),
    '[]'::jsonb
  )
  into v_diff
  from (
    select
      f.id as id_funcionario,
      f.apelido::text as apelido,
      coalesce(novo.data, antigo.data) as data,
      antigo.status as de_status,
      antigo.hora_inicio as de_hora_inicio,
      antigo.hora_fim as de_hora_fim,
      novo.status as para_status,
      novo.hora_inicio as para_hora_inicio,
      novo.hora_fim as para_hora_fim,
      case
        when antigo.id_funcionario is null then 'adicionado'
        when novo.id_funcionario is null then 'removido'
        else 'alterado'
      end as tipo
    from (select * from tmp_escala_resolvida where problema is null) novo
    full outer join (
      select e.id_funcionario, e.data, e.status, e.hora_inicio, e.hora_fim
      from public.escala_entradas e
      where e.id_publicacao = v_publicacao_ativa_id
    ) antigo
      on antigo.id_funcionario = novo.id_funcionario and antigo.data = novo.data
    join public.funcionarios f on f.id = coalesce(novo.id_funcionario, antigo.id_funcionario)
    where v_publicacao_ativa_id is not null
      and (
        antigo.id_funcionario is null
        or novo.id_funcionario is null
        or antigo.status is distinct from novo.status
        or antigo.hora_inicio is distinct from novo.hora_inicio
        or antigo.hora_fim is distinct from novo.hora_fim
      )
  ) diff_rows;

  -- The zero-diff revision guard: even a forced p_publicar = true never
  -- writes anything when this month is already published identically.
  if p_publicar and not (v_is_revisao and jsonb_array_length(v_diff) = 0) then
    select id into v_publicacao_ativa_id
    from public.escala_publicacoes
    where mes_referencia = v_mes and ativa = true
    for update;

    if v_publicacao_ativa_id is not null then
      update public.escala_publicacoes
      set ativa = false
      where id = v_publicacao_ativa_id;
    end if;

    insert into public.escala_publicacoes
      (mes_referencia, publicado_por, ativa, nome_arquivo, publicacao_anterior_id)
    values
      (v_mes, v_ctx.id_funcionario, true, p_nome_arquivo, v_publicacao_ativa_id)
    returning id into v_nova_publicacao_id;

    insert into public.escala_entradas (id_publicacao, id_funcionario, data, status, hora_inicio, hora_fim)
    select v_nova_publicacao_id, id_funcionario, data, status, hora_inicio, hora_fim
    from tmp_escala_resolvida
    where problema is null;

    v_status := 'publicado';

    if v_is_revisao then
      select coalesce(array_agg(distinct (elem->>'data')::date), array[]::date[])
      into v_datas_afetadas
      from jsonb_array_elements(v_diff) elem;
    else
      select array_agg(d::date)
      into v_datas_afetadas
      from generate_series(v_mes, (v_mes + interval '1 month' - interval '1 day')::date, interval '1 day') d;
    end if;

    -- Limpeza sync hook (2026-09-25). See 20260925_103's header comment for
    -- the full transaction-semantics/SAVEPOINT rationale — unchanged here.
    begin
      perform public.limpeza_sincronizar_datas_afetadas(v_datas_afetadas);
    exception when others then
      null;
    end;

    -- Estoque — Organização Semanal sync hook (2026-09-27). Same isolation
    -- pattern as Limpeza above, and independent of it: a failure here
    -- cannot affect Limpeza's sync or the Escala publication itself, and
    -- vice versa. Recovery path: estoque_organizacao_sincronizar_manual
    -- (a future Gerenciar-tab "Sincronizar" action, mirroring Limpeza's).
    begin
      perform public.estoque_organizacao_sincronizar_datas_afetadas(v_datas_afetadas);
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'mes_referencia', v_mes,
    'bloqueios', '[]'::jsonb,
    'avisos', v_avisos,
    'diff', v_diff,
    'contadores', jsonb_build_object('funcionarios', v_funcionarios, 'dias', v_dias, 'registros', v_registros),
    'is_revisao', v_is_revisao,
    'publicacao_id', v_nova_publicacao_id,
    'publicacao_anterior_id', v_publicacao_ativa_id
  );
end;
$_$;


--
-- Name: estoque_aplicar_sync(uuid, integer, integer, integer, integer, jsonb, boolean, text, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_aplicar_sync(p_sync_id uuid, p_raw_rows integer, p_canonical_rows integer, p_produto_count integer, p_produto_cor_count integer, p_avisos jsonb DEFAULT '[]'::jsonb, p_allow_large_removal boolean DEFAULT false, p_override_reason text DEFAULT NULL::text, p_preco_rows_lidos integer DEFAULT NULL::integer, p_preco_produto_cor_count integer DEFAULT NULL::integer, p_preco_sem_correspondencia integer DEFAULT NULL::integer) RETURNS TABLE(status text, error_code text, mensagem text, grupos_novos integer, grupos_alterados integer, grupos_removidos integer, grupos_inalterados integer, linhas_escritas integer, remocao_percentual numeric, preco_novos integer, preco_alterados integer, preco_removidos integer, preco_inalterados integer, preco_linhas_escritas integer, concluido_em timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_exec record;
  v_current_group_count integer;
  v_new_count integer;
  v_changed_count integer;
  v_removed_count integer;
  v_unchanged_count integer;
  v_removal_pct numeric(6, 3);
  v_rows_written integer := 0;
  v_bad record;
  v_override_applied boolean := false;
  v_preco_current_count integer;
  v_preco_novos integer;
  v_preco_alterados integer;
  v_preco_removidos integer;
  v_preco_inalterados integer;
  v_preco_escritos integer := 0;
begin
  select * into v_exec
  from public.estoque_sync_execucoes
  where id = p_sync_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ESTOQUE_APLICAR_SYNC_NOT_FOUND';
  end if;

  if v_exec.status <> 'executando' then
    raise exception using errcode = 'P0001',
      message = format('ESTOQUE_APLICAR_SYNC_NOT_ACTIVE status=%s', v_exec.status);
  end if;

  -- a) every novo/alterado manifest group's actual staged row count must
  --    match its declared expected count.
  for v_bad in
    select g.produto, g.cor_codigo, g.row_count_esperado, count(l.tamanho_key) as real_count
    from public.estoque_staging_grupos g
    left join public.estoque_staging_linhas l
      on l.sync_id = g.sync_id and l.produto = g.produto and l.cor_codigo = g.cor_codigo
    where g.sync_id = p_sync_id and g.acao in ('novo', 'alterado')
    group by g.produto, g.cor_codigo, g.row_count_esperado
    having count(l.tamanho_key) <> g.row_count_esperado
    limit 1
  loop
    update public.estoque_sync_execucoes set
      status = 'erro', concluido_em = now(), error_code = 'MANIFEST_ROW_COUNT_MISMATCH',
      erro = format('produto=%s cor_codigo=%s expected=%s actual=%s',
                     v_bad.produto, v_bad.cor_codigo, v_bad.row_count_esperado, v_bad.real_count),
      raw_rows = p_raw_rows, linhas_extraidas = p_canonical_rows,
      produto_count = p_produto_count, produto_cor_count = p_produto_cor_count
    where id = p_sync_id;

    delete from public.estoque_staging_linhas where sync_id = p_sync_id;
    delete from public.estoque_staging_grupos where sync_id = p_sync_id;
    delete from public.estoque_staging_precos where sync_id = p_sync_id;

    return query select 'erro'::text, 'MANIFEST_ROW_COUNT_MISMATCH'::text,
      format('produto=%s cor_codigo=%s expected=%s actual=%s',
             v_bad.produto, v_bad.cor_codigo, v_bad.row_count_esperado, v_bad.real_count),
      null::integer, null::integer, null::integer, null::integer, 0, null::numeric,
      null::integer, null::integer, null::integer, null::integer, 0, now();
    return;
  end loop;

  -- b) a 'removido' group must have no staged rows.
  if exists (
    select 1
    from public.estoque_staging_grupos g
    join public.estoque_staging_linhas l
      on l.sync_id = g.sync_id and l.produto = g.produto and l.cor_codigo = g.cor_codigo
    where g.sync_id = p_sync_id and g.acao = 'removido'
  ) then
    update public.estoque_sync_execucoes set
      status = 'erro', concluido_em = now(), error_code = 'REMOVED_GROUP_HAS_STAGED_ROWS',
      erro = 'A group marked removido has staged inventory rows.',
      raw_rows = p_raw_rows, linhas_extraidas = p_canonical_rows,
      produto_count = p_produto_count, produto_cor_count = p_produto_cor_count
    where id = p_sync_id;

    delete from public.estoque_staging_linhas where sync_id = p_sync_id;
    delete from public.estoque_staging_grupos where sync_id = p_sync_id;
    delete from public.estoque_staging_precos where sync_id = p_sync_id;

    return query select 'erro'::text, 'REMOVED_GROUP_HAS_STAGED_ROWS'::text,
      'A group marked removido has staged inventory rows.'::text,
      null::integer, null::integer, null::integer, null::integer, 0, null::numeric,
      null::integer, null::integer, null::integer, null::integer, 0, now();
    return;
  end if;

  -- c) every staged row must belong to a novo/alterado manifest group of
  --    this sync (no orphan staged rows).
  if exists (
    select 1
    from public.estoque_staging_linhas l
    where l.sync_id = p_sync_id
      and not exists (
        select 1 from public.estoque_staging_grupos g
        where g.sync_id = l.sync_id and g.produto = l.produto and g.cor_codigo = l.cor_codigo
          and g.acao in ('novo', 'alterado')
      )
  ) then
    update public.estoque_sync_execucoes set
      status = 'erro', concluido_em = now(), error_code = 'STAGED_ROWS_WITHOUT_MANIFEST',
      erro = 'Staged inventory rows exist with no matching novo/alterado manifest entry.',
      raw_rows = p_raw_rows, linhas_extraidas = p_canonical_rows,
      produto_count = p_produto_count, produto_cor_count = p_produto_cor_count
    where id = p_sync_id;

    delete from public.estoque_staging_linhas where sync_id = p_sync_id;
    delete from public.estoque_staging_grupos where sync_id = p_sync_id;
    delete from public.estoque_staging_precos where sync_id = p_sync_id;

    return query select 'erro'::text, 'STAGED_ROWS_WITHOUT_MANIFEST'::text,
      'Staged inventory rows exist with no matching novo/alterado manifest entry.'::text,
      null::integer, null::integer, null::integer, null::integer, 0, null::numeric,
      null::integer, null::integer, null::integer, null::integer, 0, now();
    return;
  end if;

  select count(*) into v_new_count from public.estoque_staging_grupos where sync_id = p_sync_id and acao = 'novo';
  select count(*) into v_changed_count from public.estoque_staging_grupos where sync_id = p_sync_id and acao = 'alterado';
  select count(*) into v_removed_count from public.estoque_staging_grupos where sync_id = p_sync_id and acao = 'removido';
  select count(*) into v_current_group_count from public.estoque_atual_grupos;
  v_unchanged_count := greatest(v_current_group_count - v_changed_count - v_removed_count, 0);

  v_removal_pct := case when v_current_group_count > 0
    then round(100.0 * v_removed_count / v_current_group_count, 3)
    else 0 end;

  v_override_applied := (p_allow_large_removal and v_removal_pct > 10);

  if v_removal_pct > 10 and not p_allow_large_removal then
    update public.estoque_sync_execucoes set
      status = 'erro', concluido_em = now(), error_code = 'LARGE_REMOVAL_GUARD',
      erro = format('Removal %s%% (%s of %s groups) exceeds the 10%% guard without --allow-large-removal',
                     v_removal_pct, v_removed_count, v_current_group_count),
      raw_rows = p_raw_rows, linhas_extraidas = p_canonical_rows,
      produto_count = p_produto_count, produto_cor_count = p_produto_cor_count,
      grupos_novos = v_new_count, grupos_alterados = v_changed_count,
      grupos_removidos = v_removed_count, grupos_inalterados = v_unchanged_count,
      remocao_percentual = v_removal_pct, avisos = p_avisos,
      avisos_count = jsonb_array_length(coalesce(p_avisos, '[]'::jsonb))
    where id = p_sync_id;

    delete from public.estoque_staging_linhas where sync_id = p_sync_id;
    delete from public.estoque_staging_grupos where sync_id = p_sync_id;
    delete from public.estoque_staging_precos where sync_id = p_sync_id;

    return query select 'erro'::text, 'LARGE_REMOVAL_GUARD'::text,
      format('Removal %s%% (%s of %s groups) exceeds the 10%% guard without --allow-large-removal',
             v_removal_pct, v_removed_count, v_current_group_count),
      v_new_count, v_changed_count, v_removed_count, v_unchanged_count, 0, v_removal_pct,
      null::integer, null::integer, null::integer, null::integer, 0, now();
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- Atomic apply. Any unexpected error from here raises and rolls back
  -- everything in this function, including the row lock taken above —
  -- inventory AND price together, never a partial publish.
  -- ---------------------------------------------------------------------
  delete from public.estoque_atual a
  using public.estoque_staging_grupos g
  where g.sync_id = p_sync_id
    and g.acao in ('alterado', 'removido')
    and a.produto = g.produto
    and a.cor_codigo = g.cor_codigo;

  insert into public.estoque_atual (
    produto, desc_produto, tipo_produto, linha, cor_codigo, cor_descricao_linx,
    grade, tamanho_key, tamanho_venda, quantidade_estoque, atualizado_em
  )
  select
    l.produto, l.desc_produto, l.tipo_produto, l.linha, l.cor_codigo, l.cor_descricao_linx,
    l.grade, l.tamanho_key, l.tamanho_venda, l.quantidade_estoque, now()
  from public.estoque_staging_linhas l
  where l.sync_id = p_sync_id;

  get diagnostics v_rows_written = row_count;

  delete from public.estoque_atual_grupos gr
  using public.estoque_staging_grupos g
  where g.sync_id = p_sync_id
    and g.acao = 'removido'
    and gr.produto = g.produto
    and gr.cor_codigo = g.cor_codigo;

  insert into public.estoque_atual_grupos (produto, cor_codigo, hash_conteudo, row_count, ultimo_sync_id, atualizado_em)
  select g.produto, g.cor_codigo, g.hash_conteudo, g.row_count_esperado, p_sync_id, now()
  from public.estoque_staging_grupos g
  where g.sync_id = p_sync_id and g.acao in ('novo', 'alterado')
  on conflict (produto, cor_codigo) do update set
    hash_conteudo = excluded.hash_conteudo,
    row_count = excluded.row_count,
    ultimo_sync_id = excluded.ultimo_sync_id,
    atualizado_em = excluded.atualizado_em;

  delete from public.estoque_staging_linhas where sync_id = p_sync_id;
  delete from public.estoque_staging_grupos where sync_id = p_sync_id;

  -- Price apply — independent of the inventory delta above (may touch a
  -- completely different set of produto+cor keys, e.g. a price-only change
  -- on an otherwise-unchanged inventory group).
  select count(*) into v_preco_current_count from public.estoque_precos_atual;
  select count(*) into v_preco_novos from public.estoque_staging_precos where sync_id = p_sync_id and acao = 'novo';
  select count(*) into v_preco_alterados from public.estoque_staging_precos where sync_id = p_sync_id and acao = 'alterado';
  select count(*) into v_preco_removidos from public.estoque_staging_precos where sync_id = p_sync_id and acao = 'removido';
  v_preco_inalterados := greatest(v_preco_current_count - v_preco_alterados - v_preco_removidos, 0);

  delete from public.estoque_precos_atual pa
  using public.estoque_staging_precos sp
  where sp.sync_id = p_sync_id
    and sp.acao in ('alterado', 'removido')
    and pa.produto = sp.produto
    and pa.cor_codigo = sp.cor_codigo;

  insert into public.estoque_precos_atual (produto, cor_codigo, preco, atualizado_em, ultimo_sync_id)
  select sp.produto, sp.cor_codigo, sp.preco, now(), p_sync_id
  from public.estoque_staging_precos sp
  where sp.sync_id = p_sync_id and sp.acao in ('novo', 'alterado');

  get diagnostics v_preco_escritos = row_count;

  delete from public.estoque_staging_precos where sync_id = p_sync_id;

  update public.estoque_sync_execucoes set
    status = 'sucesso',
    concluido_em = now(),
    raw_rows = p_raw_rows,
    linhas_extraidas = p_canonical_rows,
    linhas_publicadas = v_rows_written,
    produto_count = p_produto_count,
    produto_cor_count = p_produto_cor_count,
    grupos_novos = v_new_count,
    grupos_alterados = v_changed_count,
    grupos_removidos = v_removed_count,
    grupos_inalterados = v_unchanged_count,
    remocao_percentual = v_removal_pct,
    avisos = p_avisos,
    avisos_count = jsonb_array_length(coalesce(p_avisos, '[]'::jsonb)),
    large_removal_override_used = v_override_applied,
    override_reason = case when v_override_applied then p_override_reason else null end,
    error_code = null,
    erro = null,
    preco_rows_lidos = p_preco_rows_lidos,
    preco_produto_cor_count = p_preco_produto_cor_count,
    preco_novos = v_preco_novos,
    preco_alterados = v_preco_alterados,
    preco_removidos = v_preco_removidos,
    preco_inalterados = v_preco_inalterados,
    preco_sem_correspondencia = p_preco_sem_correspondencia,
    preco_linhas_escritas = v_preco_escritos
  where id = p_sync_id;

  return query select 'sucesso'::text, null::text, null::text,
    v_new_count, v_changed_count, v_removed_count, v_unchanged_count,
    v_rows_written, v_removal_pct,
    v_preco_novos, v_preco_alterados, v_preco_removidos, v_preco_inalterados, v_preco_escritos,
    now();
end;
$$;


--
-- Name: estoque_claim_sync(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_claim_sync() RETURNS TABLE(sync_id uuid, claimed boolean, motivo text, execucao_anterior_recuperada uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_stale record;
  v_recovered uuid := null;
  v_new_id uuid;
begin
  select e.id, e.iniciado_em into v_stale
  from public.estoque_sync_execucoes e
  where e.status = 'executando'
  order by e.iniciado_em desc
  limit 1
  for update;

  if found then
    if v_stale.iniciado_em > now() - interval '30 minutes' then
      return query select null::uuid, false, 'BUSY'::text, null::uuid;
      return;
    end if;

    update public.estoque_sync_execucoes
    set status = 'erro',
        concluido_em = now(),
        error_code = 'ABANDONED_STALE_TIMEOUT',
        erro = 'No apply/failure signal received within 30 minutes of claim; assumed crashed and superseded by a newer run.'
    where id = v_stale.id;

    delete from public.estoque_staging_linhas l where l.sync_id = v_stale.id;
    delete from public.estoque_staging_grupos g where g.sync_id = v_stale.id;
    delete from public.estoque_staging_precos p where p.sync_id = v_stale.id;

    v_recovered := v_stale.id;
  end if;

  begin
    insert into public.estoque_sync_execucoes (status)
    values ('executando')
    returning id into v_new_id;
  exception when unique_violation then
    return query select null::uuid, false, 'BUSY'::text, v_recovered;
    return;
  end;

  return query select v_new_id, true, 'CLAIMED'::text, v_recovered;
end;
$$;


--
-- Name: estoque_freshness_atual(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_freshness_atual() RETURNS TABLE(concluido_em timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select e.concluido_em
  from public.estoque_sync_execucoes e
  where e.status = 'sucesso' and e.concluido_em is not null
  order by e.concluido_em desc
  limit 1;
$$;


--
-- Name: estoque_marcar_erro(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_marcar_erro(p_sync_id uuid, p_mensagem text, p_error_code text DEFAULT NULL::text) RETURNS TABLE(marcado boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_rows integer;
begin
  update public.estoque_sync_execucoes
  set status = 'erro',
      concluido_em = now(),
      erro = left(coalesce(p_mensagem, 'erro desconhecido'), 4000),
      error_code = p_error_code
  where id = p_sync_id
    and status = 'executando';

  get diagnostics v_rows = row_count;

  delete from public.estoque_staging_linhas where sync_id = p_sync_id;
  delete from public.estoque_staging_grupos where sync_id = p_sync_id;
  delete from public.estoque_staging_precos where sync_id = p_sync_id;

  return query select (v_rows > 0);
end;
$$;


--
-- Name: estoque_normalizar_texto(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_normalizar_texto(p_texto text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
  select regexp_replace(
    translate(
      lower(p_texto),
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'
    ),
    '\s+', ' ', 'g'
  );
$$;


--
-- Name: estoque_organizacao_atualizar_progresso(text, uuid, smallint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_organizacao_atualizar_progresso(p_session_token text, p_atribuicao_id uuid, p_prateleiras_concluidas smallint) RETURNS TABLE(id uuid, prateleiras_concluidas smallint, concluido_por_apelido text, concluido_em timestamp with time zone, atualizado_em timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_row record;
  v_semana_atual date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if p_prateleiras_concluidas is null
     or p_prateleiras_concluidas < 0
     or p_prateleiras_concluidas > 5 then
    raise exception using errcode = 'P0001', message = 'PROGRESSO_INVALIDO';
  end if;

  select * into v_row
  from public.estoque_organizacao_atribuicoes
  where public.estoque_organizacao_atribuicoes.id = p_atribuicao_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_NAO_ENCONTRADA';
  end if;

  if v_row.funcionario_id <> v_ctx.id_funcionario then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_ESTOQUE_ORGANIZACAO';
  end if;

  v_semana_atual := public.estoque_organizacao_semana_inicio((now() at time zone 'America/Manaus')::date);
  if v_row.semana_inicio <> v_semana_atual then
    raise exception using errcode = 'P0001', message = 'SEMANA_ENCERRADA';
  end if;

  update public.estoque_organizacao_atribuicoes
  set prateleiras_concluidas = p_prateleiras_concluidas,
      concluido_por = case
        when p_prateleiras_concluidas = 5 then coalesce(v_row.concluido_por, v_ctx.id_funcionario)
        else null
      end,
      concluido_em = case
        when p_prateleiras_concluidas = 5 then coalesce(v_row.concluido_em, now())
        else null
      end,
      atualizado_por = v_ctx.id_funcionario,
      atualizado_em = now()
  where public.estoque_organizacao_atribuicoes.id = p_atribuicao_id;

  return query
  select a.id, a.prateleiras_concluidas, fc.apelido::text, a.concluido_em, a.atualizado_em
  from public.estoque_organizacao_atribuicoes a
  left join public.funcionarios fc on fc.id = a.concluido_por
  where a.id = p_atribuicao_id;
end;
$$;


--
-- Name: estoque_organizacao_concluir_estante(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_organizacao_concluir_estante(p_session_token text, p_atribuicao_id uuid) RETURNS TABLE(id uuid, prateleiras_concluidas smallint, concluido_por_apelido text, concluido_em timestamp with time zone, atualizado_em timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  select * from public.estoque_organizacao_atualizar_progresso(p_session_token, p_atribuicao_id, 5::smallint);
end;
$$;


--
-- Name: estoque_organizacao_linhas_semana(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_organizacao_linhas_semana(p_semana_inicio date) RETURNS TABLE(id uuid, funcionario_id uuid, funcionario_nome text, funcionario_apelido text, numero_estante smallint, prateleiras_concluidas smallint, concluido_por_apelido text, concluido_em timestamp with time zone, atualizado_em timestamp with time zone, semana_inicio date)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select
    a.id, f.id, f.nome::text, f.apelido::text,
    a.numero_estante, a.prateleiras_concluidas,
    fc.apelido::text, a.concluido_em, a.atualizado_em, a.semana_inicio
  from public.estoque_organizacao_atribuicoes a
  join public.funcionarios f on f.id = a.funcionario_id
  left join public.funcionarios fc on fc.id = a.concluido_por
  where a.semana_inicio = p_semana_inicio
  order by a.numero_estante;
$$;


--
-- Name: estoque_organizacao_semana_inicio(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_organizacao_semana_inicio(p_data date) RETURNS date
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select p_data - extract(dow from p_data)::int;
$$;


--
-- Name: estoque_organizacao_sincronizar_datas_afetadas(date[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_organizacao_sincronizar_datas_afetadas(p_datas date[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_semana date;
begin
  for v_semana in
    select distinct public.estoque_organizacao_semana_inicio(d)
    from unnest(coalesce(p_datas, array[]::date[])) as d
    order by 1
  loop
    perform public.estoque_organizacao_sincronizar_semana_com_registro(v_semana);
  end loop;
end;
$$;


--
-- Name: estoque_organizacao_sincronizar_manual(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_organizacao_sincronizar_manual(p_session_token text, p_mes date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_mes_inicio date;
  v_mes_fim date;
  v_semana date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_ESTOQUE_ORGANIZACAO';
  end if;

  v_mes_inicio := date_trunc('month', p_mes)::date;
  v_mes_fim := (v_mes_inicio + interval '1 month' - interval '1 day')::date;

  v_semana := public.estoque_organizacao_semana_inicio(v_mes_inicio);
  while v_semana <= v_mes_fim loop
    perform public.estoque_organizacao_sincronizar_semana_com_registro(v_semana);
    v_semana := v_semana + 7;
  end loop;
end;
$$;


--
-- Name: estoque_organizacao_sincronizar_semana(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_organizacao_sincronizar_semana(p_semana_inicio date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_proximo smallint;
  v_funcionario record;
  v_semana_atual date;
  v_ativo_a_partir date;
  v_minimo date;
begin
  if extract(dow from p_semana_inicio) <> 0 then
    raise exception using errcode = 'P0001', message = 'SEMANA_INICIO_DEVE_SER_DOMINGO';
  end if;

  select ativo_a_partir into v_ativo_a_partir
  from public.estoque_organizacao_rotacao_estado
  where id = 1;

  v_semana_atual := public.estoque_organizacao_semana_inicio((now() at time zone 'America/Manaus')::date);
  v_minimo := greatest(v_semana_atual, v_ativo_a_partir);
  if p_semana_inicio < v_minimo then
    return;
  end if;

  select proximo_numero into v_proximo
  from public.estoque_organizacao_rotacao_estado
  where id = 1
  for update;

  for v_funcionario in
    select f.id
    from public.funcionarios f
    where f.is_active = true
      and f.cargo <> 'Administrador'
      and exists (
        select 1
        from public.escala_entradas e
        join public.escala_publicacoes ep on ep.id = e.id_publicacao and ep.ativa = true
        where e.id_funcionario = f.id
          and e.status = 'trabalho'
          and e.data between p_semana_inicio and (p_semana_inicio + 6)
      )
      and not exists (
        select 1
        from public.estoque_organizacao_atribuicoes a
        where a.semana_inicio = p_semana_inicio and a.funcionario_id = f.id
      )
    order by f.apelido, f.id
  loop
    insert into public.estoque_organizacao_atribuicoes
      (semana_inicio, funcionario_id, numero_estante, origem)
    values
      (p_semana_inicio, v_funcionario.id, v_proximo, 'automatica');

    v_proximo := case when v_proximo = 41 then 1 else v_proximo + 1 end;
  end loop;

  update public.estoque_organizacao_rotacao_estado
  set proximo_numero = v_proximo, atualizado_em = now()
  where id = 1;
end;
$$;


--
-- Name: estoque_organizacao_sincronizar_semana_com_registro(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_organizacao_sincronizar_semana_com_registro(p_semana_inicio date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  begin
    perform public.estoque_organizacao_sincronizar_semana(p_semana_inicio);

    update public.estoque_organizacao_sync_falhas
    set resolvido_em = now()
    where semana_inicio = p_semana_inicio and resolvido_em is null;
  exception when others then
    insert into public.estoque_organizacao_sync_falhas (semana_inicio, motivo)
    values (p_semana_inicio, sqlerrm);
  end;
end;
$$;


--
-- Name: estoque_termo_busca_canonico(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_termo_busca_canonico(p_termo text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
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
$_$;


--
-- Name: estoque_termo_busca_produto_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_termo_busca_produto_key(p_produto text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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


--
-- Name: estoque_termos_busca_exigir_gestor(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_termos_busca_exigir_gestor(p_session_token text) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: estoque_termos_busca_verificar_slot(text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_termos_busca_verificar_slot(p_produto text, p_termo_normalizado text, p_ignorar_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql STABLE
    AS $$
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


--
-- Name: finalizar_contagem(text, uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalizar_contagem(p_session_token text, p_id_contagem uuid, p_itens jsonb, p_observacao text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: get_atendimento_ativo(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_atendimento_ativo(p_session_token text) RETURNS TABLE(id uuid, status text, iniciado_em timestamp with time zone, fora_de_ordem boolean, prazo_provisorio_em timestamp with time zone, iniciado_por_nome text, checklist_obrigatorio boolean, dia_negocio_original date)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  perform public.transicionar_atendimento_pendente(v_ctx.id_funcionario);

  return query
    select
      a.id,
      a.status,
      a.iniciado_em,
      a.fora_de_ordem,
      a.iniciado_em + make_interval(
        secs => case when a.id_funcionario_iniciador <> a.id_funcionario then 60 else 20 end
      ),
      case
        when a.id_funcionario_iniciador <> a.id_funcionario
          then coalesce(nullif(btrim(fi.apelido::text), ''), fi.nome::text)
        else null
      end,
      a.checklist_obrigatorio,
      a.dia_negocio_original
    from public.atendimentos a
    left join public.funcionarios fi on fi.id = a.id_funcionario_iniciador
    where a.id_funcionario = v_ctx.id_funcionario
      and a.status in ('ativo', 'finalizando', 'pendente_fechamento')
    limit 1;
end;
$$;


--
-- Name: get_atendimento_resumo_hoje(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_atendimento_resumo_hoje(p_session_token text) RETURNS TABLE(funcionario_id uuid, funcionario_nome text, id_atendimento uuid, iniciado_em timestamp with time zone, concluido_em timestamp with time zone, id_atendimento_cliente uuid, categoria text, motivo_rotulo text, detalhe text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_dia date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  return query
    select
      f.id,
      f.nome::text,
      a.id,
      a.iniciado_em,
      a.concluido_em,
      ac.id,
      ac.categoria::text,
      ac.motivo_rotulo::text,
      ac.detalhe::text
    from public.funcionarios f
    left join public.atendimentos a
      on a.id_funcionario = f.id
      and a.status = 'concluido'
      and (a.concluido_em at time zone 'America/Manaus')::date = v_dia
    left join public.atendimento_clientes ac
      on ac.id_atendimento = a.id
    where f.is_active = true
      and f.cargo = 'Vendedor'
    order by f.apelido, a.iniciado_em desc, ac.criado_em asc;
end;
$$;


--
-- Name: get_checklist_pendencias_count(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_checklist_pendencias_count(p_session_token text) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_count int;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select count(*) into v_count
  from public.checklist_pendencias cp
  where cp.id_funcionario = v_ctx.id_funcionario and cp.status = 'pending';

  return v_count;
end;
$$;


--
-- Name: get_checklist_policy(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_checklist_policy(p_session_token text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_policy text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select cc.policy into v_policy from public.checklist_config cc where cc.id = 1;

  return v_policy;
end;
$$;


--
-- Name: get_contagem_catalogo(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_contagem_catalogo(p_session_token text) RETURNS TABLE(id uuid, familia text, tamanho text, rotulo text, unidades_por_pacote integer, ordem_exibicao integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: get_contagem_detalhe(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_contagem_detalhe(p_session_token text, p_id uuid) RETURNS TABLE(id_contagem uuid, submetido_por_nome text, submetido_em timestamp with time zone, status text, observacao text, revisada_por_nome text, revisada_em timestamp with time zone, id_item uuid, rotulo text, familia text, tamanho text, unidades_por_pacote integer, pacotes_fechados integer, unidades_avulsas integer, total_unidades bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: get_contagem_historico(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_contagem_historico(p_session_token text) RETURNS TABLE(id uuid, submetido_por_nome text, submetido_em timestamp with time zone, observacao text, revisada_por_nome text, revisada_em timestamp with time zone, total_itens integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
      count(ci.id)::int as total_itens
    from public.contagens c
    join public.funcionarios f on f.id = c.submetido_por
    left join public.funcionarios rf on rf.id = c.revisada_por
    left join public.contagem_itens ci on ci.id_contagem = c.id
    where c.status = 'revisada'
    group by c.id, f.apelido, f.nome, c.submetido_em, c.observacao,
             rf.apelido, rf.nome, c.revisada_em
    order by c.revisada_em desc;
end;
$$;


--
-- Name: get_contagens_pendentes(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_contagens_pendentes(p_session_token text) RETURNS TABLE(id uuid, submetido_por_nome text, submetido_em timestamp with time zone, observacao text, total_itens integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
      count(ci.id)::int as total_itens
    from public.contagens c
    join public.funcionarios f on f.id = c.submetido_por
    left join public.contagem_itens ci on ci.id_contagem = c.id
    where c.status = 'pendente_revisao'
    group by c.id, f.apelido, f.nome, c.submetido_em, c.observacao
    order by c.submetido_em asc;
end;
$$;


--
-- Name: get_escala_periodo(text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_escala_periodo(p_session_token text, p_data_inicio date, p_data_fim date) RETURNS TABLE(data date, id_funcionario uuid, nome text, apelido text, secao text, hora_inicio time without time zone, hora_fim time without time zone, feriado_nome text, feriado_abrangencia text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_caller_gestao boolean;
  v_pode_ver_gestao boolean;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if p_data_fim < p_data_inicio or p_data_fim - p_data_inicio > 31 then
    raise exception using errcode = 'P0001', message = 'INTERVALO_INVALIDO';
  end if;
  select f.escala_grupo_gestao into v_caller_gestao
  from public.funcionarios f where f.id = v_ctx.id_funcionario;
  v_pode_ver_gestao := (v_ctx.cargo = 'Administrador' or coalesce(v_caller_gestao, false));
  return query
  select
    d.dia::date, f.id, f.nome::text, f.apelido::text,
    case
      when e.status = 'folga' then 'folga'
      when e.status = 'ferias' then 'ferias'
      when e.status = 'trabalho'
        then public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento)
      else 'a_confirmar'
    end as secao,
    case when e.status = 'trabalho' and f.escala_grupo_gestao then null else e.hora_inicio end as hora_inicio,
    case when e.status = 'trabalho' and f.escala_grupo_gestao then null else e.hora_fim end as hora_fim,
    fer.nome as feriado_nome, fer.abrangencia as feriado_abrangencia
  from generate_series(p_data_inicio, p_data_fim, interval '1 day') as d(dia)
  cross join public.funcionarios f
  cross join lateral public.loja_horario_do_dia(d.dia::date) h
  left join public.feriados fer on fer.data = d.dia::date
  left join public.escala_publicacoes ep
    on ep.mes_referencia = date_trunc('month', d.dia)::date and ep.ativa = true
  left join public.escala_entradas e
    on e.id_publicacao = ep.id and e.id_funcionario = f.id and e.data = d.dia::date
  where f.is_active = true and f.cargo <> 'Administrador'
    and (v_pode_ver_gestao or f.escala_grupo_gestao = false)
  order by d.dia, f.nome;
end;
$$;


--
-- Name: get_escala_publicacoes_historico(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_escala_publicacoes_historico(p_session_token text) RETURNS TABLE(id uuid, mes_referencia date, publicado_em timestamp with time zone, publicado_por_nome text, nome_arquivo text, ativa boolean, total_registros bigint, versao bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if v_ctx.cargo <> 'Administrador' then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_ESCALA';
  end if;

  return query
  select
    ep.id,
    ep.mes_referencia,
    ep.publicado_em,
    f.nome,
    ep.nome_arquivo,
    ep.ativa,
    (select count(*) from public.escala_entradas e where e.id_publicacao = ep.id),
    row_number() over (partition by ep.mes_referencia order by ep.publicado_em)
  from public.escala_publicacoes ep
  join public.funcionarios f on f.id = ep.publicado_por
  order by ep.mes_referencia desc, ep.publicado_em desc;
end;
$$;


--
-- Name: get_estoque_freshness(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_estoque_freshness(p_session_token text) RETURNS TABLE(sync_concluido_em timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  return query select f.concluido_em from public.estoque_freshness_atual() f;
end;
$$;


--
-- Name: get_estoque_organizacao_gerencial_semana(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_estoque_organizacao_gerencial_semana(p_session_token text, p_semana_inicio date) RETURNS TABLE(id uuid, funcionario_id uuid, funcionario_nome text, funcionario_apelido text, numero_estante smallint, prateleiras_concluidas smallint, concluido_por_apelido text, concluido_em timestamp with time zone, atualizado_em timestamp with time zone, semana_inicio date)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_ESTOQUE_ORGANIZACAO';
  end if;
  if extract(dow from p_semana_inicio) <> 0 then
    raise exception using errcode = 'P0001', message = 'SEMANA_INICIO_DEVE_SER_DOMINGO';
  end if;

  return query
  select * from public.estoque_organizacao_linhas_semana(p_semana_inicio);
end;
$$;


--
-- Name: get_estoque_organizacao_semana(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_estoque_organizacao_semana(p_session_token text) RETURNS TABLE(id uuid, funcionario_id uuid, funcionario_nome text, funcionario_apelido text, numero_estante smallint, prateleiras_concluidas smallint, concluido_por_apelido text, concluido_em timestamp with time zone, atualizado_em timestamp with time zone, semana_inicio date)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_semana date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_semana := public.estoque_organizacao_semana_inicio((now() at time zone 'America/Manaus')::date);

  return query
  select * from public.estoque_organizacao_linhas_semana(v_semana);
end;
$$;


--
-- Name: get_estoque_organizacao_sync_pendencias(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_estoque_organizacao_sync_pendencias(p_session_token text) RETURNS TABLE(semana_inicio date, falhou_em timestamp with time zone, motivo text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_ESTOQUE_ORGANIZACAO';
  end if;

  return query
  select f.semana_inicio, f.falhou_em, f.motivo
  from public.estoque_organizacao_sync_falhas f
  where f.resolvido_em is null
  order by f.semana_inicio;
end;
$$;


--
-- Name: get_limpeza_atribuicoes_mes(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_limpeza_atribuicoes_mes(p_session_token text, p_mes date) RETURNS TABLE(id uuid, data date, turno text, tarefa text, funcionario_id uuid, funcionario_apelido text, origem text, bloqueada boolean, status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_mes_ref date;
  v_mes_fim date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_LIMPEZA';
  end if;

  v_mes_ref := date_trunc('month', p_mes)::date;
  v_mes_fim := (v_mes_ref + interval '1 month' - interval '1 day')::date;

  return query
  select
    a.id, a.data, a.turno, a.tarefa,
    a.funcionario_id, f.apelido::text,
    a.origem, a.bloqueada, a.status
  from public.limpeza_atribuicoes a
  left join public.funcionarios f on f.id = a.funcionario_id
  where a.data between v_mes_ref and v_mes_fim
  order by a.data, case a.turno when 'manha' then 0 else 1 end, a.tarefa;
end;
$$;


--
-- Name: get_limpeza_dia(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_limpeza_dia(p_session_token text, p_data date) RETURNS TABLE(id uuid, data date, turno text, tarefa text, funcionario_id uuid, funcionario_nome text, funcionario_apelido text, origem text, bloqueada boolean, status text, concluido_por_apelido text, concluido_em timestamp with time zone, conflito_motivo text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  return query
  select
    a.id, a.data, a.turno, a.tarefa,
    a.funcionario_id, f.nome::text, f.apelido::text,
    a.origem, a.bloqueada, a.status,
    fc.apelido::text, a.concluido_em, a.conflito_motivo
  from public.limpeza_atribuicoes a
  left join public.funcionarios f on f.id = a.funcionario_id
  left join public.funcionarios fc on fc.id = a.concluido_por
  where a.data = p_data
  order by
    case a.turno when 'manha' then 0 else 1 end,
    case a.tarefa when 'varrer' then 0 else 1 end;
end;
$$;


--
-- Name: get_limpeza_gerencial_mes(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_limpeza_gerencial_mes(p_session_token text, p_mes date) RETURNS TABLE(id uuid, data date, turno text, tarefa text, funcionario_apelido text, origem text, bloqueada boolean, status text, conflito_motivo text, atrasada boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_mes_ref date;
  v_mes_fim date;
  v_hoje date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_LIMPEZA';
  end if;

  v_mes_ref := date_trunc('month', p_mes)::date;
  v_mes_fim := (v_mes_ref + interval '1 month' - interval '1 day')::date;
  v_hoje := (now() at time zone 'America/Manaus')::date;

  return query
  select
    a.id, a.data, a.turno, a.tarefa, f.apelido::text,
    a.origem, a.bloqueada, a.status, a.conflito_motivo,
    (a.data < v_hoje and a.status = 'pendente') as atrasada
  from public.limpeza_atribuicoes a
  left join public.funcionarios f on f.id = a.funcionario_id
  where a.data between v_mes_ref and v_mes_fim
    and (
      a.status in ('conflito', 'sem_candidato')
      or a.bloqueada = true
      or (a.data < v_hoje and a.status = 'pendente')
    )
  order by a.data, case a.turno when 'manha' then 0 else 1 end, a.tarefa;
end;
$$;


--
-- Name: get_limpeza_mes(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_limpeza_mes(p_session_token text, p_mes date) RETURNS TABLE(funcionario_id uuid, funcionario_nome text, funcionario_apelido text, varrer_atribuidos bigint, passar_pano_atribuidos bigint, total bigint, concluidos bigint, nao_concluidos bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_mes_ref date;
  v_mes_fim date;
  v_hoje date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_mes_ref := date_trunc('month', p_mes)::date;
  v_mes_fim := (v_mes_ref + interval '1 month' - interval '1 day')::date;
  v_hoje := (now() at time zone 'America/Manaus')::date;

  return query
  select
    f.id, f.nome::text, f.apelido::text,
    count(*) filter (where a.tarefa = 'varrer') as varrer_atribuidos,
    count(*) filter (where a.tarefa = 'passar_pano') as passar_pano_atribuidos,
    count(*) as total,
    count(*) filter (where a.status = 'concluida') as concluidos,
    count(*) filter (where a.data < v_hoje and a.status <> 'concluida') as nao_concluidos
  from public.funcionarios f
  join public.limpeza_atribuicoes a
    on a.funcionario_id = f.id and a.data between v_mes_ref and v_mes_fim
  where f.is_active = true
    and f.escala_grupo_gestao = false
    and not exists (select 1 from public.limpeza_cargos_excluidos x where x.cargo = f.cargo)
  group by f.id, f.nome, f.apelido
  order by f.apelido;
end;
$$;


--
-- Name: get_limpeza_sync_pendencias(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_limpeza_sync_pendencias(p_session_token text) RETURNS TABLE(data date, falhou_em timestamp with time zone, motivo text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_LIMPEZA';
  end if;

  return query
  select f.data, f.falhou_em, f.motivo
  from public.limpeza_sync_falhas f
  where f.resolvido_em is null
  order by f.data;
end;
$$;


--
-- Name: get_lista_vez_estado(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lista_vez_estado(p_session_token text) RETURNS TABLE(id_funcionario uuid, nome text, status text, ordem integer, iniciado_em timestamp with time zone, id_atendimento uuid, id_funcionario_iniciador uuid, prazo_provisorio_em timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_dia date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  return query
    select
      f.id_funcionario,
      coalesce(nullif(btrim(fu.apelido::text), ''), fu.nome::text) as nome,
      case
        when f.disponivel then 'disponivel'
        when a.status = 'finalizando' then 'finalizando'
        else 'em_atendimento'
      end as status,
      case
        when f.disponivel then
          row_number() over (partition by f.disponivel order by f.posicao asc)::int
        else null
      end as ordem,
      case when a.status = 'ativo' then a.iniciado_em else null end as iniciado_em,
      case when a.status in ('ativo', 'finalizando') then a.id else null end as id_atendimento,
      case when a.status = 'ativo' then a.id_funcionario_iniciador else null end
        as id_funcionario_iniciador,
      case
        when a.status = 'ativo' then
          a.iniciado_em + make_interval(
            secs => case when a.id_funcionario_iniciador <> a.id_funcionario then 60 else 20 end
          )
        else null
      end as prazo_provisorio_em
    from public.lista_vez_fila f
    join public.funcionarios fu on fu.id = f.id_funcionario
    left join public.atendimentos a
      on a.id_funcionario = f.id_funcionario and a.status in ('ativo', 'finalizando')
    where f.dia_manaus = v_dia
      and f.na_fila = true
    order by f.disponivel desc, f.posicao asc;
end;
$$;


--
-- Name: get_minha_escala_mes(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_minha_escala_mes(p_session_token text, p_mes date) RETURNS TABLE(data date, secao text, hora_inicio time without time zone, hora_fim time without time zone, feriado_nome text, feriado_abrangencia text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_mes_ref date;
  v_gestao boolean;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  v_mes_ref := date_trunc('month', p_mes)::date;
  select f.escala_grupo_gestao into v_gestao
  from public.funcionarios f where f.id = v_ctx.id_funcionario;
  return query
  select
    d.dia::date,
    case
      when e.status = 'folga' then 'folga'
      when e.status = 'ferias' then 'ferias'
      when e.status = 'trabalho'
        then public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento)
      else 'a_confirmar'
    end as secao,
    case when e.status = 'trabalho' and coalesce(v_gestao, false) then null else e.hora_inicio end,
    case when e.status = 'trabalho' and coalesce(v_gestao, false) then null else e.hora_fim end,
    fer.nome as feriado_nome, fer.abrangencia as feriado_abrangencia
  from generate_series(v_mes_ref, (v_mes_ref + interval '1 month' - interval '1 day')::date, interval '1 day') as d(dia)
  cross join lateral public.loja_horario_do_dia(d.dia::date) h
  left join public.feriados fer on fer.data = d.dia::date
  left join public.escala_publicacoes ep on ep.mes_referencia = v_mes_ref and ep.ativa = true
  left join public.escala_entradas e
    on e.id_publicacao = ep.id and e.id_funcionario = v_ctx.id_funcionario and e.data = d.dia::date
  order by d.dia;
end;
$$;


--
-- Name: get_or_start_contagem_ativa(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_or_start_contagem_ativa(p_session_token text) RETURNS TABLE(id_contagem uuid, iniciado_por_nome text, iniciado_em timestamp with time zone, id_item uuid, pacotes_fechados integer, unidades_avulsas integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: get_produto_estoque_detalhe(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_produto_estoque_detalhe(p_session_token text, p_produto text) RETURNS TABLE(produto text, desc_produto text, tipo_produto text, linha text, grade text, cor_codigo text, cor_nome_portal text, cor_familia text, tamanho_key integer, tamanho_venda text, quantidade_estoque integer, preco numeric, sync_concluido_em timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_produto text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_produto := upper(trim(coalesce(p_produto, '')));
  if length(v_produto) = 0 then
    return;
  end if;

  return query
  select
    s.produto,
    s.desc_produto,
    s.tipo_produto,
    s.linha,
    s.grade,
    s.cor_codigo,
    m.cor_nome_portal,
    m.cor_familia,
    s.tamanho_key,
    s.tamanho_venda,
    s.quantidade_estoque,
    pr.preco,
    f.concluido_em as sync_concluido_em
  from public.estoque_atual s
  cross join public.estoque_freshness_atual() f
  left join public.estoque_cores_mapeamento m
    on m.cor_codigo = s.cor_codigo
   and m.cor_descricao_linx = s.cor_descricao_linx
  left join public.estoque_precos_atual pr
    on pr.produto = s.produto
   and pr.cor_codigo = s.cor_codigo
  where s.produto = v_produto
    and s.tamanho_venda is not null
  order by s.cor_codigo, s.tamanho_key;
end;
$$;


--
-- Name: get_produto_termos_busca(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_produto_termos_busca(p_session_token text, p_produto text) RETURNS TABLE(id uuid, termo text, status text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: get_termos_busca_pendentes(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_termos_busca_pendentes(p_session_token text) RETURNS TABLE(id uuid, produto text, desc_produto text, termo text, sugerido_por_nome text, sugerido_em timestamp with time zone, termos_aprovados text[], outros_produtos_mesmo_termo integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: get_termos_busca_permissao(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_termos_busca_permissao(p_session_token text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: get_termos_busca_produto_admin(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_termos_busca_produto_admin(p_session_token text, p_produto text) RETURNS TABLE(id uuid, termo text, termo_sugerido text, status text, origem text, sugerido_por_nome text, sugerido_em timestamp with time zone, moderado_por_nome text, moderado_em timestamp with time zone, desativado_por_nome text, desativado_em timestamp with time zone, reativado_em timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: get_treinamento_versao_admin(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_treinamento_versao_admin(p_session_token text, p_id_versao uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: get_treinamentos_admin(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_treinamentos_admin(p_session_token text) RETURNS TABLE(id_modulo uuid, slug text, ordem_exibicao integer, arquivado boolean, titulo_atual text, id_versao_publicada uuid, versao_publicada integer, publicado_em timestamp with time zone, publicado_por_nome text, id_versao_rascunho uuid, versao_rascunho integer, rascunho_atualizado_em timestamp with time zone, total_versoes integer, total_concluidos integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: get_treinamentos_disponiveis(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_treinamentos_disponiveis(p_session_token text) RETURNS TABLE(id_modulo uuid, slug text, titulo text, resumo text, duracao_estimada_min smallint, total_blocos integer, id_versao_publicada uuid, estado text, concluido_em timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: get_turno_presenca_hoje(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_turno_presenca_hoje(p_session_token text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  return exists (
    select 1
    from public.turno_presenca
    where id_funcionario = v_ctx.id_funcionario
      and (checked_in_at at time zone 'America/Manaus')::date =
          (now() at time zone 'America/Manaus')::date
  );
end;
$$;


--
-- Name: get_valid_employee_session_context(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_valid_employee_session_context(p_session_token text) RETURNS TABLE(id_funcionario uuid, cargo text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_session_token is null or length(p_session_token) = 0 then
    return;
  end if;

  return query
    select f.id, f.cargo
    from public.sessoes_funcionario s
    join public.funcionarios f on f.id = s.id_funcionario
    where s.token_hash = public.hash_session_token(p_session_token)
      and s.revogado_em is null
      and s.expira_em > now()
      and f.is_active = true
    limit 1;
end;
$$;


--
-- Name: hash_session_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hash_session_token(p_token text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'extensions'
    AS $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;


--
-- Name: iniciar_atendimento(text, boolean, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.iniciar_atendimento(p_session_token text, p_confirmar_fora_de_ordem boolean DEFAULT false, p_id_funcionario_alvo uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, iniciado_em timestamp with time zone, fora_de_ordem boolean, prazo_provisorio_em timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_dia date;
  v_id_alvo uuid;
  v_primeiro_id uuid;
  v_fora_de_ordem boolean;
  v_atendimento record;
  v_grace_seconds int;
  v_status_existente text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_id_alvo := coalesce(p_id_funcionario_alvo, v_ctx.id_funcionario);

  if v_id_alvo <> v_ctx.id_funcionario then
    if not exists (
      select 1 from public.funcionarios fa where fa.id = v_id_alvo and fa.is_active = true
    ) then
      raise exception using errcode = 'P0001', message = 'FUNCIONARIO_ALVO_INVALIDO';
    end if;
  end if;

  -- Milestone 2D: closes the day-boundary race (section 22) — a call
  -- arriving right after midnight always sees the authoritative
  -- post-transition state below, never a stale ativo/finalizando row.
  perform public.transicionar_atendimento_pendente(v_id_alvo);

  v_dia := (now() at time zone 'America/Manaus')::date;

  if not exists (
    select 1
    from public.turno_presenca
    where id_funcionario = v_id_alvo
      and (checked_in_at at time zone 'America/Manaus')::date = v_dia
  ) then
    raise exception using errcode = 'P0001', message = 'ATIVIDADES_NAO_INICIADAS';
  end if;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  if not exists (
    select 1 from public.lista_vez_fila
    where id_funcionario = v_id_alvo and dia_manaus = v_dia and disponivel = true
  ) then
    raise exception using errcode = 'P0001', message = 'FUNCIONARIO_ALVO_INDISPONIVEL';
  end if;

  select id_funcionario into v_primeiro_id
  from public.lista_vez_fila
  where dia_manaus = v_dia and disponivel = true
  order by posicao asc
  limit 1;

  v_fora_de_ordem := (v_primeiro_id is distinct from v_id_alvo);

  if v_fora_de_ordem and not p_confirmar_fora_de_ordem then
    raise exception using errcode = 'P0001', message = 'CONFIRMACAO_FORA_DE_ORDEM_NECESSARIA';
  end if;

  select a.status into v_status_existente
  from public.atendimentos a
  where a.id_funcionario = v_id_alvo and a.status in ('ativo', 'finalizando', 'pendente_fechamento')
  limit 1;

  if v_status_existente = 'pendente_fechamento' then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_PENDENTE_FECHAMENTO';
  elsif v_status_existente is not null then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_ATIVO_EXISTENTE';
  end if;

  update public.lista_vez_fila
  set disponivel = false, atualizado_em = now()
  where id_funcionario = v_id_alvo and dia_manaus = v_dia;

  begin
    insert into public.atendimentos (id_funcionario, id_funcionario_iniciador, fora_de_ordem)
    values (v_id_alvo, v_ctx.id_funcionario, v_fora_de_ordem)
    returning atendimentos.id, atendimentos.iniciado_em, atendimentos.fora_de_ordem
    into v_atendimento;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_ATIVO_EXISTENTE';
  end;

  v_grace_seconds := case when v_ctx.id_funcionario <> v_id_alvo then 60 else 20 end;

  return query select
    v_atendimento.id,
    v_atendimento.iniciado_em,
    v_atendimento.fora_de_ordem,
    v_atendimento.iniciado_em + make_interval(secs => v_grace_seconds);
end;
$$;


--
-- Name: iniciar_fechamento_atendimento(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.iniciar_fechamento_atendimento(p_session_token text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_atendimento record;
  v_politica text;
  v_obrigatorio boolean;
  v_motivo text;
  v_ultimas boolean[];
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  perform public.transicionar_atendimento_pendente(v_ctx.id_funcionario);

  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = v_ctx.id_funcionario and status = 'ativo'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'NENHUM_ATENDIMENTO_ATIVO';
  end if;

  if v_atendimento.checklist_obrigatorio is null then
    select cc.policy into v_politica from public.checklist_config cc where cc.id = 1 for share;

    if v_politica = 'periodic_verification' then
      select array_agg(h.checklist_obrigatorio order by h.checklist_decisao_em desc)
      into v_ultimas
      from (
        select a2.checklist_obrigatorio, a2.checklist_decisao_em
        from public.atendimentos a2
        where a2.id_funcionario = v_ctx.id_funcionario
          and a2.checklist_politica_no_momento = 'periodic_verification'
          and a2.checklist_obrigatorio is not null
        order by a2.checklist_decisao_em desc
        limit 3
      ) h;

      if v_ultimas is not null and v_ultimas[1] then
        v_obrigatorio := false;
        v_motivo := 'pos_obrigatorio';
      elsif array_length(v_ultimas, 1) = 3
        and not v_ultimas[1] and not v_ultimas[2] and not v_ultimas[3] then
        v_obrigatorio := true;
        v_motivo := 'gap_maximo';
      else
        v_obrigatorio := (random() < 0.20);
        v_motivo := case when v_obrigatorio then 'sorteio' else 'nao_selecionado' end;
      end if;

      update public.atendimentos
      set checklist_obrigatorio = v_obrigatorio,
          checklist_decisao_motivo = v_motivo,
          checklist_decisao_em = now(),
          checklist_politica_no_momento = v_politica
      where id = v_atendimento.id;
    end if;
  end if;

  update public.atendimentos
  set status = 'finalizando',
      finalizando_em = now(),
      id_funcionario_iniciou_fechamento = v_ctx.id_funcionario
  where id = v_atendimento.id;

  return true;
end;
$$;


--
-- Name: iniciar_fechamento_atendimento_gerencial(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.iniciar_fechamento_atendimento_gerencial(p_session_token text, p_id_atendimento uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_id_alvo uuid;
  v_atendimento record;
  v_politica text;
  v_obrigatorio boolean;
  v_motivo text;
  v_ultimas boolean[];
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if v_ctx.cargo not in ('Administrador', 'Gerente') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_CONCLUIR_GERENCIAL';
  end if;

  select id_funcionario into v_id_alvo
  from public.atendimentos
  where id = p_id_atendimento;

  if v_id_alvo is null then
    raise exception using errcode = 'P0001', message = 'NENHUM_ATENDIMENTO_ATIVO';
  end if;

  perform public.transicionar_atendimento_pendente(v_id_alvo);

  select * into v_atendimento
  from public.atendimentos
  where id = p_id_atendimento and status = 'ativo'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'NENHUM_ATENDIMENTO_ATIVO';
  end if;

  if v_atendimento.checklist_obrigatorio is null then
    select cc.policy into v_politica from public.checklist_config cc where cc.id = 1 for share;

    if v_politica = 'periodic_verification' then
      select array_agg(h.checklist_obrigatorio order by h.checklist_decisao_em desc)
      into v_ultimas
      from (
        select a2.checklist_obrigatorio, a2.checklist_decisao_em
        from public.atendimentos a2
        where a2.id_funcionario = v_atendimento.id_funcionario
          and a2.checklist_politica_no_momento = 'periodic_verification'
          and a2.checklist_obrigatorio is not null
        order by a2.checklist_decisao_em desc
        limit 3
      ) h;

      if v_ultimas is not null and v_ultimas[1] then
        v_obrigatorio := false;
        v_motivo := 'pos_obrigatorio';
      elsif array_length(v_ultimas, 1) = 3
        and not v_ultimas[1] and not v_ultimas[2] and not v_ultimas[3] then
        v_obrigatorio := true;
        v_motivo := 'gap_maximo';
      else
        v_obrigatorio := (random() < 0.20);
        v_motivo := case when v_obrigatorio then 'sorteio' else 'nao_selecionado' end;
      end if;

      update public.atendimentos
      set checklist_obrigatorio = v_obrigatorio,
          checklist_decisao_motivo = v_motivo,
          checklist_decisao_em = now(),
          checklist_politica_no_momento = v_politica
      where id = v_atendimento.id;
    end if;
  end if;

  update public.atendimentos
  set status = 'finalizando',
      finalizando_em = now(),
      id_funcionario_iniciou_fechamento = v_ctx.id_funcionario
  where id = v_atendimento.id;

  return true;
end;
$$;


--
-- Name: issue_employee_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.issue_employee_session(p_id_funcionario uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_raw_token text;
begin
  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.sessoes_funcionario (id_funcionario, token_hash, expira_em)
  values (
    p_id_funcionario,
    public.hash_session_token(v_raw_token),
    now() + interval '12 hours'
  );

  return v_raw_token;
end;
$$;


--
-- Name: limpeza_concluir_atribuicao(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limpeza_concluir_atribuicao(p_session_token text, p_atribuicao_id uuid) RETURNS TABLE(id uuid, status text, concluido_por_apelido text, concluido_em timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_row record;
  v_is_manager boolean;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_row
  from public.limpeza_atribuicoes
  where public.limpeza_atribuicoes.id = p_atribuicao_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_NAO_ENCONTRADA';
  end if;

  v_is_manager := v_ctx.cargo in ('Gerente', 'Administrador');
  if v_row.funcionario_id is distinct from v_ctx.id_funcionario and not v_is_manager then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_CONCLUIR_LIMPEZA';
  end if;

  if v_row.funcionario_id is null then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_SEM_FUNCIONARIO';
  end if;

  if v_row.status = 'conflito' then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_EM_CONFLITO';
  end if;

  if v_row.status = 'pendente' then
    update public.limpeza_atribuicoes
      set status = 'concluida', concluido_por = v_ctx.id_funcionario, concluido_em = now(),
          atualizado_em = now()
      where public.limpeza_atribuicoes.id = v_row.id;

    select * into v_row from public.limpeza_atribuicoes where public.limpeza_atribuicoes.id = v_row.id;
  end if;

  return query
  select v_row.id, v_row.status, f.apelido::text, v_row.concluido_em
  from public.funcionarios f
  where f.id = v_row.concluido_por;
end;
$$;


--
-- Name: limpeza_definir_atribuicao_manual(text, date, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limpeza_definir_atribuicao_manual(p_session_token text, p_data date, p_turno text, p_tarefa text, p_funcionario_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_outro_funcionario uuid;
  v_id uuid;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_LIMPEZA';
  end if;

  if p_turno not in ('manha', 'tarde') then
    raise exception using errcode = 'P0001', message = 'TURNO_INVALIDO';
  end if;
  if p_tarefa not in ('varrer', 'passar_pano') then
    raise exception using errcode = 'P0001', message = 'TAREFA_INVALIDA';
  end if;

  if not public.limpeza_funcionario_escalado_turno(p_funcionario_id, p_data, p_turno) then
    raise exception using errcode = 'P0001', message = 'FUNCIONARIO_INDISPONIVEL';
  end if;

  select funcionario_id into v_outro_funcionario
  from public.limpeza_atribuicoes
  where data = p_data and turno = p_turno
    and tarefa <> p_tarefa;

  if v_outro_funcionario is not null and v_outro_funcionario = p_funcionario_id then
    raise exception using errcode = 'P0001', message = 'CONFLITO_MESMA_PESSOA';
  end if;

  insert into public.limpeza_atribuicoes (
    data, turno, tarefa, funcionario_id, origem, bloqueada, status,
    conflito_motivo, criado_por, atualizado_por, atualizado_em
  )
  values (
    p_data, p_turno, p_tarefa, p_funcionario_id, 'manual', true, 'pendente',
    null, v_ctx.id_funcionario, v_ctx.id_funcionario, now()
  )
  on conflict (data, turno, tarefa) do update
    set funcionario_id = excluded.funcionario_id,
        origem = 'manual',
        bloqueada = true,
        status = 'pendente',
        conflito_motivo = null,
        atualizado_por = v_ctx.id_funcionario,
        atualizado_em = now()
    where public.limpeza_atribuicoes.status <> 'concluida'
  returning id into v_id;

  if v_id is null then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_CONCLUIDA';
  end if;

  return v_id;
end;
$$;


--
-- Name: limpeza_funcionario_escalado_turno(uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limpeza_funcionario_escalado_turno(p_funcionario_id uuid, p_data date, p_turno text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.funcionarios f
    join public.escala_publicacoes ep
      on ep.mes_referencia = date_trunc('month', p_data)::date and ep.ativa = true
    join public.escala_entradas e
      on e.id_publicacao = ep.id and e.id_funcionario = f.id and e.data = p_data
    cross join lateral public.loja_horario_do_dia(p_data) h
    where f.id = p_funcionario_id
      and f.is_active = true
      and e.status = 'trabalho'
      and public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento)
        in (p_turno, 'intermediario')
  );
$$;


--
-- Name: limpeza_funcionario_regras_automaticas(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limpeza_funcionario_regras_automaticas(p_funcionario_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.funcionarios f
    where f.id = p_funcionario_id
      and f.is_active = true
      and f.escala_grupo_gestao = false
      and not exists (select 1 from public.limpeza_cargos_excluidos x where x.cargo = f.cargo)
  );
$$;


--
-- Name: limpeza_proximo_candidato(date, text, text, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limpeza_proximo_candidato(p_data date, p_turno text, p_tarefa text, p_reservados uuid[] DEFAULT ARRAY[]::uuid[]) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with elegiveis as (
    select f.id, f.apelido
    from public.funcionarios f
    join public.escala_publicacoes ep
      on ep.mes_referencia = date_trunc('month', p_data)::date and ep.ativa = true
    join public.escala_entradas e
      on e.id_publicacao = ep.id and e.id_funcionario = f.id and e.data = p_data
    cross join lateral public.loja_horario_do_dia(p_data) h
    where f.is_active = true
      and e.status = 'trabalho'
      and f.escala_grupo_gestao = false
      and not exists (select 1 from public.limpeza_cargos_excluidos x where x.cargo = f.cargo)
      and public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento)
        in (p_turno, 'intermediario')
      and not (f.id = any(coalesce(p_reservados, array[]::uuid[])))
  ),
  contagens as (
    select
      el.id,
      el.apelido,
      (
        select count(*) from public.limpeza_atribuicoes a
        where a.funcionario_id = el.id
          and a.data >= date_trunc('month', p_data)::date
          and a.data < (date_trunc('month', p_data) + interval '1 month')::date
      ) as total_mes,
      (
        select count(*) from public.limpeza_atribuicoes a
        where a.funcionario_id = el.id
          and a.tarefa = p_tarefa
          and a.data >= date_trunc('month', p_data)::date
          and a.data < (date_trunc('month', p_data) + interval '1 month')::date
      ) as tarefa_mes,
      not exists (
        select 1 from public.limpeza_atribuicoes a
        where a.funcionario_id = el.id and a.data = p_data - 1
      ) as nao_atribuido_ontem
    from elegiveis el
  )
  select id
  from contagens
  order by nao_atribuido_ontem desc, tarefa_mes asc, total_mes asc, apelido asc, id asc
  limit 1;
$$;


--
-- Name: limpeza_sincronizar_datas_afetadas(date[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limpeza_sincronizar_datas_afetadas(p_datas date[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_hoje date := (now() at time zone 'America/Manaus')::date;
  v_data date;
begin
  foreach v_data in array coalesce(p_datas, array[]::date[]) loop
    if v_data >= v_hoje then
      perform public.limpeza_sincronizar_dia_com_registro(v_data);
    end if;
  end loop;
end;
$$;


--
-- Name: limpeza_sincronizar_dia(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limpeza_sincronizar_dia(p_data date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_turno text;
  v_tarefa text;
  v_row record;
  v_found boolean;
  v_reservados uuid[];
  v_candidato uuid;
  v_status text;
begin
  -- Reserve whoever already holds a concluída or bloqueada (manual) slot
  -- today — those rows are never touched below, and nobody may receive a
  -- second automatic assignment the same day.
  select coalesce(array_agg(distinct funcionario_id), array[]::uuid[])
    into v_reservados
  from public.limpeza_atribuicoes
  where data = p_data
    and funcionario_id is not null
    and (status = 'concluida' or bloqueada = true);

  foreach v_turno in array array['manha', 'tarde'] loop
    foreach v_tarefa in array array['varrer', 'passar_pano'] loop
      select * into v_row
      from public.limpeza_atribuicoes
      where data = p_data and turno = v_turno and tarefa = v_tarefa
      for update;
      v_found := found;

      if v_found and v_row.status = 'concluida' then
        continue; -- already reserved above; never touched.
      end if;

      if v_found and v_row.bloqueada then
        if v_row.funcionario_id is not null
           and public.limpeza_funcionario_escalado_turno(v_row.funcionario_id, p_data, v_turno) then
          if v_row.status = 'conflito' then
            update public.limpeza_atribuicoes
              set status = 'pendente', conflito_motivo = null, atualizado_em = now()
              where id = v_row.id;
          end if;
        elsif v_row.status <> 'conflito' then
          update public.limpeza_atribuicoes
            set status = 'conflito',
                conflito_motivo = 'FUNCIONARIO_NAO_ELEGIVEL_APOS_ATUALIZACAO_ESCALA',
                atualizado_em = now()
            where id = v_row.id;
        end if;
        continue; -- already reserved above (bloqueada); never reassigned automatically.
      end if;

      -- Automatic slot, still valid: schedule-compatible with this turno,
      -- still part of the automatic rotation, and not reserved elsewhere
      -- today by a concluída/bloqueada row (or an earlier slot this run).
      if v_found
         and v_row.funcionario_id is not null
         and not (v_row.funcionario_id = any(v_reservados))
         and public.limpeza_funcionario_escalado_turno(v_row.funcionario_id, p_data, v_turno)
         and public.limpeza_funcionario_regras_automaticas(v_row.funcionario_id) then
        v_reservados := v_reservados || v_row.funcionario_id;
        continue;
      end if;

      -- Needs a (re)assignment.
      v_candidato := public.limpeza_proximo_candidato(p_data, v_turno, v_tarefa, v_reservados);

      if v_found then
        v_status := case when v_candidato is null then 'sem_candidato' else 'pendente' end;
        update public.limpeza_atribuicoes
          set funcionario_id = v_candidato,
              status = v_status,
              conflito_motivo = null,
              atualizado_em = now()
          where id = v_row.id;
      elsif v_candidato is not null then
        insert into public.limpeza_atribuicoes (data, turno, tarefa, funcionario_id, origem, status)
        values (p_data, v_turno, v_tarefa, v_candidato, 'automatica', 'pendente');
      end if;
      -- else: no existing row and no eligible candidate — nothing to create.

      if v_candidato is not null then
        v_reservados := v_reservados || v_candidato;
      end if;
    end loop;
  end loop;
end;
$$;


--
-- Name: limpeza_sincronizar_dia_com_registro(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limpeza_sincronizar_dia_com_registro(p_data date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  begin
    perform public.limpeza_sincronizar_dia(p_data);

    update public.limpeza_sync_falhas
    set resolvido_em = now()
    where data = p_data and resolvido_em is null;
  exception when others then
    insert into public.limpeza_sync_falhas (data, motivo)
    values (p_data, sqlerrm);
  end;
end;
$$;


--
-- Name: limpeza_sincronizar_manual(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limpeza_sincronizar_manual(p_session_token text, p_mes date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_mes_ref date;
  v_mes_fim date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_LIMPEZA';
  end if;

  v_mes_ref := date_trunc('month', p_mes)::date;
  v_mes_fim := (v_mes_ref + interval '1 month' - interval '1 day')::date;

  perform public.limpeza_sincronizar_periodo(v_mes_ref, v_mes_fim);
end;
$$;


--
-- Name: limpeza_sincronizar_periodo(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limpeza_sincronizar_periodo(p_data_inicio date, p_data_fim date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_hoje date := (now() at time zone 'America/Manaus')::date;
  v_dia date;
begin
  v_dia := greatest(p_data_inicio, v_hoje);
  while v_dia <= p_data_fim loop
    perform public.limpeza_sincronizar_dia_com_registro(v_dia);
    v_dia := v_dia + 1;
  end loop;
end;
$$;


--
-- Name: list_active_employees(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_active_employees() RETURNS TABLE(funcionario_id uuid, nome text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    select
        f.id as funcionario_id,
        f.nome::text as nome
    from public.funcionarios f
    where f.is_active = true
    order by f.nome;
$$;


--
-- Name: list_atendimento_checklist_itens(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_atendimento_checklist_itens(p_session_token text) RETURNS TABLE(id uuid, versao integer, codigo text, titulo text, guia_bullets text[], ordem_exibicao integer, obrigatorio boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: list_atendimento_motivos(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_atendimento_motivos(p_session_token text) RETURNS TABLE(id uuid, codigo text, categoria text, rotulo text, detalhe_obrigatorio boolean, ordem_exibicao integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  return query
    select m.id, m.codigo, m.categoria, m.rotulo, m.detalhe_obrigatorio, m.ordem_exibicao
    from public.atendimento_motivos m
    where m.ativo = true
    order by m.categoria, m.ordem_exibicao;
end;
$$;


--
-- Name: list_escala_meses_publicados(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_escala_meses_publicados(p_session_token text) RETURNS TABLE(mes_referencia date, publicado_em timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  return query
  select ep.mes_referencia, ep.publicado_em
  from public.escala_publicacoes ep
  where ep.ativa = true
  order by ep.mes_referencia;
end;
$$;


--
-- Name: loja_horario_do_dia(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.loja_horario_do_dia(p_data date) RETURNS TABLE(abertura time without time zone, fechamento time without time zone, fechada boolean)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select
    coalesce(exc.abertura, pad.abertura) as abertura,
    coalesce(exc.fechamento, pad.fechamento) as fechamento,
    coalesce(exc.fechada, false) as fechada
  from (select p_data as d) base
  left join public.loja_horario_excecao exc on exc.data = base.d
  left join public.loja_horario_padrao pad on pad.dia_semana = extract(dow from base.d)::smallint;
$$;


--
-- Name: marcar_contagem_revisada(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.marcar_contagem_revisada(p_session_token text, p_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: moderar_termo_busca(text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.moderar_termo_busca(p_session_token text, p_id uuid, p_acao text, p_termo_final text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

  else
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


--
-- Name: publicar_rascunho_treinamento(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publicar_rascunho_treinamento(p_session_token text, p_id_versao uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

  perform 1 from public.treinamento_modulos m where m.id = v_versao.id_modulo for update;

  select count(*)::int into v_total
  from public.treinamento_blocos b where b.id_versao = p_id_versao;
  if v_total = 0 then
    raise exception using errcode = 'P0001', message = 'RASCUNHO_VAZIO';
  end if;

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


--
-- Name: registrar_turno_presenca(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_turno_presenca(p_session_token text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_dia date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  insert into public.turno_presenca (id_funcionario)
  values (v_ctx.id_funcionario)
  on conflict (id_funcionario, ((checked_in_at at time zone 'America/Manaus')::date))
  do nothing;

  v_dia := (now() at time zone 'America/Manaus')::date;

  -- Correction: inclusion check, not exclusion — only Vendedor auto-joins.
  -- Gerente participates manually only (entrar_lista_da_vez); Administrador
  -- does not participate at all; any other/future cargo does not auto-join
  -- either, preserving its pre-existing (non-participating-by-default)
  -- semantics rather than newly becoming eligible by omission.
  if v_ctx.cargo = 'Vendedor' then
    insert into public.lista_vez_fila (id_funcionario, dia_manaus)
    values (v_ctx.id_funcionario, v_dia)
    on conflict (id_funcionario, dia_manaus) do nothing;
  end if;

  return true;
end;
$$;


--
-- Name: remover_funcionario_lista_da_vez(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remover_funcionario_lista_da_vez(p_session_token text, p_id_funcionario_alvo uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_dia date;
  v_fila record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if v_ctx.cargo not in ('Administrador', 'Gerente') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_REMOVER';
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  select * into v_fila
  from public.lista_vez_fila
  where id_funcionario = p_id_funcionario_alvo and dia_manaus = v_dia
  for update;

  if v_fila.id is null or not v_fila.na_fila then
    raise exception using errcode = 'P0001', message = 'FUNCIONARIO_ALVO_INDISPONIVEL';
  end if;

  if not v_fila.disponivel then
    raise exception using errcode = 'P0001', message = 'FUNCIONARIO_EM_ATENDIMENTO';
  end if;

  update public.lista_vez_fila
  set na_fila = false, disponivel = false, atualizado_em = now()
  where id = v_fila.id;

  insert into public.lista_vez_eventos (id_funcionario, dia_manaus, tipo, id_funcionario_ator)
  values (p_id_funcionario_alvo, v_dia, 'remocao_admin', v_ctx.id_funcionario);

  return true;
end;
$$;


--
-- Name: resolver_checklist_pendencias(uuid, text, uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolver_checklist_pendencias(p_id_funcionario uuid, p_tipo_resolucao text, p_id_atendimento_checklist uuid, p_id_checklist_avulso uuid, p_versao_resolucao integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_resolvido_em timestamptz := now();
  v_count int := 0;
  v_pendencia record;
  v_id_resolucao uuid;
begin
  perform pg_advisory_xact_lock(
    hashtext('checklist_pendencias:' || p_id_funcionario::text)::bigint
  );

  for v_pendencia in
    select cp.id
    from public.checklist_pendencias cp
    where cp.id_funcionario = p_id_funcionario and cp.status = 'pending'
    for update
  loop
    insert into public.checklist_pendencia_resolucoes (
      id_pendencia, tipo_resolucao, id_atendimento_checklist, id_checklist_avulso,
      versao_resolucao, resolvido_em
    ) values (
      v_pendencia.id, p_tipo_resolucao, p_id_atendimento_checklist, p_id_checklist_avulso,
      p_versao_resolucao, v_resolvido_em
    )
    returning id into v_id_resolucao;

    update public.checklist_pendencias
    set status = 'resolved',
        resolvido_em = v_resolvido_em,
        tipo_resolucao = p_tipo_resolucao,
        id_resolucao = v_id_resolucao
    where id = v_pendencia.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


--
-- Name: responder_cenario_treinamento(text, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.responder_cenario_treinamento(p_session_token text, p_id_progresso uuid, p_id_bloco uuid, p_id_opcao uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: revoke_employee_session(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_employee_session(p_session_token text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_session_token is null or length(p_session_token) = 0 then
    return;
  end if;

  update public.sessoes_funcionario
  set revogado_em = now()
  where token_hash = public.hash_session_token(p_session_token)
    and revogado_em is null
    and expira_em > now();
end;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: sair_lista_da_vez(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sair_lista_da_vez(p_session_token text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_dia date;
  v_fila record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  select * into v_fila
  from public.lista_vez_fila
  where id_funcionario = v_ctx.id_funcionario and dia_manaus = v_dia
  for update;

  if v_fila.id is null then
    raise exception using errcode = 'P0001', message = 'ATIVIDADES_NAO_INICIADAS';
  end if;

  if not v_fila.na_fila then
    raise exception using errcode = 'P0001', message = 'JA_FORA_DA_LISTA';
  end if;

  if not v_fila.disponivel then
    raise exception using errcode = 'P0001', message = 'EM_ATENDIMENTO_NAO_PODE_SAIR';
  end if;

  update public.lista_vez_fila
  set na_fila = false, disponivel = false, atualizado_em = now()
  where id = v_fila.id;

  insert into public.lista_vez_eventos (id_funcionario, dia_manaus, tipo, id_funcionario_ator)
  values (v_ctx.id_funcionario, v_dia, 'saida_voluntaria', v_ctx.id_funcionario);

  return true;
end;
$$;


--
-- Name: salvar_progresso_contagem(text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.salvar_progresso_contagem(p_session_token text, p_id_contagem uuid, p_itens jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: salvar_rascunho_treinamento(text, uuid, text, text, smallint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.salvar_rascunho_treinamento(p_session_token text, p_id_versao uuid, p_titulo text, p_resumo text, p_duracao_estimada_min smallint, p_blocos jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: set_checklist_policy(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_checklist_policy(p_session_token text, p_policy text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
  v_politica_atual text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if v_ctx.cargo <> 'Administrador' then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_POLITICA';
  end if;

  if p_policy not in ('required', 'defer_allowed', 'periodic_verification') then
    raise exception using errcode = 'P0001', message = 'POLITICA_INVALIDA';
  end if;

  select cc.policy into v_politica_atual from public.checklist_config cc where cc.id = 1 for update;

  if v_politica_atual is distinct from p_policy then
    insert into public.checklist_policy_eventos (politica_anterior, politica_nova, id_funcionario_ator)
    values (v_politica_atual, p_policy, v_ctx.id_funcionario);

    update public.checklist_config
    set policy = p_policy, atualizado_em = now(), atualizado_por = v_ctx.id_funcionario
    where id = 1;
  end if;

  return true;
end;
$$;


--
-- Name: sugerir_termo_busca(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sugerir_termo_busca(p_session_token text, p_produto text, p_termo text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    raise exception using errcode = 'P0001', message = 'TERMO_JA_PENDENTE';
  end;

  return v_id;
end;
$$;


--
-- Name: transicionar_atendimento_pendente(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transicionar_atendimento_pendente(p_id_funcionario uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_atendimento record;
  v_dia_hoje date;
  v_dia_original date;
  v_fim_dia timestamptz;
begin
  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = p_id_funcionario
    and status in ('ativo', 'finalizando')
  for update;

  if v_atendimento.id is null then
    return;
  end if;

  v_dia_hoje := (now() at time zone 'America/Manaus')::date;
  v_dia_original := (v_atendimento.iniciado_em at time zone 'America/Manaus')::date;

  if v_dia_original >= v_dia_hoje then
    return;
  end if;

  -- The instant of local midnight starting the day AFTER v_dia_original —
  -- i.e. the end of v_dia_original's own Manaus business day.
  v_fim_dia := (v_dia_original + 1)::timestamp at time zone 'America/Manaus';

  if v_atendimento.status = 'ativo' then
    -- Case A: no closing boundary exists yet — synthesize one at the
    -- business-day cutoff, reusing finalizando_em/the existing duration
    -- formula rather than inventing a new one.
    update public.atendimentos
    set status = 'pendente_fechamento',
        finalizando_em = v_fim_dia,
        pendente_desde = now(),
        dia_negocio_original = v_dia_original,
        fim_dia_negocio_original = v_fim_dia
    where id = v_atendimento.id;
  else
    -- Case B: finalizando_em already holds a real, earlier, same-day
    -- timestamp from when the employee originally tapped Concluir
    -- atendimento — an earlier valid closing boundary already exists, so it
    -- is preserved untouched.
    update public.atendimentos
    set status = 'pendente_fechamento',
        pendente_desde = now(),
        dia_negocio_original = v_dia_original,
        fim_dia_negocio_original = v_fim_dia
    where id = v_atendimento.id;
  end if;
end;
$$;


--
-- Name: treinamento_aplicar_blocos(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_aplicar_blocos(p_id_versao uuid, p_blocos jsonb) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  v_total int;
begin
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
$_$;


--
-- Name: treinamento_bloco_comparavel(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_bloco_comparavel(p_tipo text, p_conteudo jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $$
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


--
-- Name: treinamento_bloco_conteudo_valido(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_bloco_conteudo_valido(p_tipo text, p_conteudo jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select public.treinamento_bloco_erro(p_tipo, p_conteudo) is null;
$$;


--
-- Name: treinamento_bloco_erro(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_bloco_erro(p_tipo text, p_conteudo jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
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

  if v_melhores = 0 then
    return 'CENARIO_SEM_MELHOR';
  end if;
  if v_melhores > 1 then
    return 'CENARIO_MELHOR_DUPLICADA';
  end if;

  return null;
end;
$_$;


--
-- Name: treinamento_bloco_publico(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_bloco_publico(p_tipo text, p_conteudo jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $$
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


--
-- Name: treinamento_blocos_imutavel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_blocos_imutavel() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: treinamento_exigir_admin(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_exigir_admin(p_session_token text) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: treinamento_metadados_erro(text, text, smallint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_metadados_erro(p_titulo text, p_resumo text, p_duracao_estimada_min smallint) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
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


--
-- Name: treinamento_normalizar_blocos(jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_normalizar_blocos(p_blocos jsonb, p_preservar_ids boolean) RETURNS jsonb
    LANGUAGE sql
    AS $$
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


--
-- Name: treinamento_normalizar_ids_opcoes(text, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_normalizar_ids_opcoes(p_tipo text, p_conteudo jsonb, p_preservar boolean) RETURNS jsonb
    LANGUAGE sql
    AS $_$
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
$_$;


--
-- Name: treinamento_principios_erro(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_principios_erro(p_principios jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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


--
-- Name: treinamento_processar_importacao(text, uuid, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_processar_importacao(p_session_token text, p_id_versao uuid, p_payload jsonb, p_aplicar boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: treinamento_regenerar_ids_opcoes(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_regenerar_ids_opcoes(p_tipo text, p_conteudo jsonb) RETURNS jsonb
    LANGUAGE sql
    AS $$
  select public.treinamento_normalizar_ids_opcoes(p_tipo, p_conteudo, false);
$$;


--
-- Name: treinamento_respostas_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_respostas_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: treinamento_respostas_validar(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_respostas_validar() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: treinamento_validar_bloco(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_validar_bloco(p_tipo text, p_conteudo jsonb) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  v_erro text;
begin
  v_erro := public.treinamento_bloco_erro(p_tipo, p_conteudo);
  if v_erro is not null then
    raise exception using errcode = 'P0001', message = v_erro;
  end if;
end;
$$;


--
-- Name: treinamento_versao_assinatura(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_versao_assinatura(p_id_versao uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: treinamento_versoes_delete_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_versoes_delete_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if old.status <> 'rascunho' then
    raise exception using errcode = 'P0001', message = 'CONTEUDO_PUBLICADO_IMUTAVEL';
  end if;
  return old;
end;
$$;


--
-- Name: treinamento_versoes_transicao(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.treinamento_versoes_transicao() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: verify_pin(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_pin(p_funcionario_id uuid, p_pin text) RETURNS TABLE(success boolean, funcionario_id uuid, nome text, apelido text, cargo text, error_code text, session_token text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_employee record;
  v_session_token text;
begin
  if p_funcionario_id is null or p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return query select false, null::uuid, null::text, null::text, null::text,
                        'INVALID_INPUT'::text, null::text;
    return;
  end if;

  select
    f.id                                                       as id,
    f.nome::text                                               as nome,
    coalesce(nullif(btrim(f.apelido::text), ''), f.nome::text) as apelido,
    f.cargo::text                                              as cargo
  into v_employee
  from public.funcionarios f
  where f.id = p_funcionario_id
    and f.token_pin = p_pin
    and f.is_active = true
  limit 1;

  if found then
    v_session_token := public.issue_employee_session(v_employee.id);
    return query select true, v_employee.id, v_employee.nome, v_employee.apelido,
                        v_employee.cargo, null::text, v_session_token;
    return;
  end if;

  return query select false, null::uuid, null::text, null::text, null::text,
                      'INVALID_CREDENTIALS'::text, null::text;
end;
$_$;


--
-- Name: voltar_ao_atendimento(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.voltar_ao_atendimento(p_session_token text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  perform public.transicionar_atendimento_pendente(v_ctx.id_funcionario);

  update public.atendimentos
  set status = 'ativo',
      tempo_finalizando_abandonado = tempo_finalizando_abandonado + (now() - finalizando_em),
      finalizando_em = null,
      id_funcionario_iniciou_fechamento = null
  where id_funcionario = v_ctx.id_funcionario and status = 'finalizando';

  if not found then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

  return true;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: atendimento_checklist_itens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.atendimento_checklist_itens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    versao integer NOT NULL,
    codigo text NOT NULL,
    titulo text NOT NULL,
    guia_bullets text[],
    ordem_exibicao integer NOT NULL,
    obrigatorio boolean DEFAULT true NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: atendimento_checklists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.atendimento_checklists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_atendimento uuid NOT NULL,
    id_funcionario uuid NOT NULL,
    versao integer NOT NULL,
    respostas jsonb NOT NULL,
    completado_em timestamp with time zone DEFAULT now() NOT NULL,
    id_funcionario_ator uuid,
    checklist_validado boolean DEFAULT true NOT NULL
);


--
-- Name: atendimento_clientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.atendimento_clientes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_atendimento uuid NOT NULL,
    id_motivo uuid NOT NULL,
    categoria text NOT NULL,
    motivo_rotulo text NOT NULL,
    detalhe text,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT atendimento_clientes_categoria_check CHECK ((categoria = ANY (ARRAY['convertido'::text, 'nao_convertido'::text])))
);


--
-- Name: atendimento_motivos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.atendimento_motivos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo text NOT NULL,
    categoria text NOT NULL,
    rotulo text NOT NULL,
    detalhe_obrigatorio boolean DEFAULT false NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    ordem_exibicao integer NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT atendimento_motivos_categoria_check CHECK ((categoria = ANY (ARRAY['convertido'::text, 'nao_convertido'::text])))
);


--
-- Name: atendimentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.atendimentos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_funcionario uuid NOT NULL,
    status text DEFAULT 'ativo'::text NOT NULL,
    fora_de_ordem boolean NOT NULL,
    iniciado_em timestamp with time zone DEFAULT now() NOT NULL,
    concluido_em timestamp with time zone,
    cancelado_em timestamp with time zone,
    finalizando_em timestamp with time zone,
    tempo_finalizando_abandonado interval DEFAULT '00:00:00'::interval NOT NULL,
    id_funcionario_iniciador uuid NOT NULL,
    id_funcionario_cancelou uuid,
    checklist_obrigatorio boolean,
    checklist_decisao_motivo text,
    checklist_decisao_em timestamp with time zone,
    checklist_politica_no_momento text,
    pendente_desde timestamp with time zone,
    dia_negocio_original date,
    fim_dia_negocio_original timestamp with time zone,
    id_funcionario_concluiu uuid,
    id_funcionario_iniciou_fechamento uuid,
    CONSTRAINT atendimentos_checklist_decisao_consistente CHECK (((checklist_obrigatorio IS NULL) = (checklist_decisao_em IS NULL))),
    CONSTRAINT atendimentos_checklist_decisao_motivo_check CHECK (((checklist_decisao_motivo IS NULL) OR (checklist_decisao_motivo = ANY (ARRAY['sorteio'::text, 'gap_maximo'::text, 'pos_obrigatorio'::text, 'nao_selecionado'::text])))),
    CONSTRAINT atendimentos_status_check CHECK ((status = ANY (ARRAY['ativo'::text, 'finalizando'::text, 'pendente_fechamento'::text, 'concluido'::text, 'cancelado'::text]))),
    CONSTRAINT atendimentos_status_timestamps_consistentes CHECK ((((status = 'ativo'::text) AND (finalizando_em IS NULL) AND (concluido_em IS NULL) AND (cancelado_em IS NULL)) OR ((status = 'finalizando'::text) AND (finalizando_em IS NOT NULL) AND (concluido_em IS NULL) AND (cancelado_em IS NULL)) OR ((status = 'pendente_fechamento'::text) AND (finalizando_em IS NOT NULL) AND (concluido_em IS NULL) AND (cancelado_em IS NULL) AND (pendente_desde IS NOT NULL) AND (dia_negocio_original IS NOT NULL) AND (fim_dia_negocio_original IS NOT NULL)) OR ((status = 'concluido'::text) AND (concluido_em IS NOT NULL) AND (cancelado_em IS NULL)) OR ((status = 'cancelado'::text) AND (cancelado_em IS NOT NULL) AND (concluido_em IS NULL) AND (finalizando_em IS NULL))))
);


--
-- Name: atendimentos_legacy_pre_milestone1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.atendimentos_legacy_pre_milestone1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_vendedor uuid NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    outcome text,
    motive text,
    motive_details text,
    ticket_number text,
    is_regular_customer boolean DEFAULT false NOT NULL,
    is_out_of_turn boolean DEFAULT false NOT NULL,
    queue_position_at_start integer,
    created_at timestamp with time zone DEFAULT timezone('America/Manaus'::text, now()) NOT NULL
);


--
-- Name: TABLE atendimentos_legacy_pre_milestone1; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.atendimentos_legacy_pre_milestone1 IS 'Renamed out of the way on 2026-08-18 before applying 20260818_001_add_atendimento_lista_vez.sql. Structurally incompatible with Epic 2 Milestone 1 (id_vendedor/started_at/ended_at/outcome/... shape; one row per Atendimento+outcome, no multi-customer support per ADR-004) and had 0 rows at time of rename. Not created by any migration in supabase/migrations/ — appears to be an earlier prototype table. Left in place (renamed, not dropped) out of caution; safe to drop later once you''ve confirmed it is genuinely unused.';


--
-- Name: checklist_conclusoes_avulsas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_conclusoes_avulsas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_funcionario uuid NOT NULL,
    id_funcionario_ator uuid NOT NULL,
    versao integer NOT NULL,
    respostas jsonb NOT NULL,
    completado_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: checklist_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_config (
    id integer DEFAULT 1 NOT NULL,
    policy text DEFAULT 'required'::text NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_por uuid,
    CONSTRAINT checklist_config_policy_check CHECK ((policy = ANY (ARRAY['required'::text, 'defer_allowed'::text, 'periodic_verification'::text]))),
    CONSTRAINT checklist_config_singleton CHECK ((id = 1))
);


--
-- Name: checklist_pendencia_resolucoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_pendencia_resolucoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_pendencia uuid NOT NULL,
    tipo_resolucao text NOT NULL,
    id_atendimento_checklist uuid,
    id_checklist_avulso uuid,
    versao_resolucao integer NOT NULL,
    resolvido_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT checklist_pendencia_resolucoes_fonte_exclusiva CHECK ((((tipo_resolucao = 'fechamento_atendimento'::text) AND (id_atendimento_checklist IS NOT NULL) AND (id_checklist_avulso IS NULL)) OR ((tipo_resolucao = 'checklist_avulso'::text) AND (id_checklist_avulso IS NOT NULL) AND (id_atendimento_checklist IS NULL)))),
    CONSTRAINT checklist_pendencia_resolucoes_tipo_resolucao_check CHECK ((tipo_resolucao = ANY (ARRAY['fechamento_atendimento'::text, 'checklist_avulso'::text])))
);


--
-- Name: checklist_pendencias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_pendencias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_atendimento uuid NOT NULL,
    id_funcionario uuid NOT NULL,
    checklist_versao integer NOT NULL,
    politica_no_momento text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    adiado_em timestamp with time zone DEFAULT now() NOT NULL,
    resolvido_em timestamp with time zone,
    tipo_resolucao text,
    id_resolucao uuid,
    CONSTRAINT checklist_pendencias_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'resolved'::text]))),
    CONSTRAINT checklist_pendencias_status_resolucao_consistente CHECK ((((status = 'pending'::text) AND (resolvido_em IS NULL)) OR ((status = 'resolved'::text) AND (resolvido_em IS NOT NULL))))
);


--
-- Name: checklist_policy_eventos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_policy_eventos (
    id bigint NOT NULL,
    politica_anterior text,
    politica_nova text NOT NULL,
    id_funcionario_ator uuid NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT checklist_policy_eventos_politica_nova_check CHECK ((politica_nova = ANY (ARRAY['required'::text, 'defer_allowed'::text, 'periodic_verification'::text])))
);


--
-- Name: checklist_policy_eventos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.checklist_policy_eventos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.checklist_policy_eventos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: contagem_embalagem_itens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contagem_embalagem_itens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    familia text NOT NULL,
    tamanho text NOT NULL,
    rotulo text NOT NULL,
    unidades_por_pacote integer NOT NULL,
    ordem_exibicao integer NOT NULL,
    ativo_para_contagem boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contagem_embalagem_itens_familia_check CHECK ((familia = ANY (ARRAY['sacola_boutique'::text, 'envelope'::text, 'seda'::text, 'etiqueta'::text, 'de_para'::text, 'outlet'::text]))),
    CONSTRAINT contagem_embalagem_itens_unidades_por_pacote_check CHECK ((unidades_por_pacote > 0))
);


--
-- Name: contagem_itens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contagem_itens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_contagem uuid NOT NULL,
    id_item uuid NOT NULL,
    pacotes_fechados integer NOT NULL,
    unidades_avulsas integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contagem_itens_pacotes_fechados_check CHECK ((pacotes_fechados >= 0)),
    CONSTRAINT contagem_itens_unidades_avulsas_check CHECK ((unidades_avulsas >= 0))
);


--
-- Name: contagens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contagens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submetido_por uuid,
    submetido_em timestamp with time zone,
    status text DEFAULT 'pendente_revisao'::text NOT NULL,
    observacao text,
    revisada_por uuid,
    revisada_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    iniciado_por uuid NOT NULL,
    iniciado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contagens_check CHECK ((((status = 'em_andamento'::text) AND (submetido_por IS NULL) AND (submetido_em IS NULL) AND (revisada_por IS NULL) AND (revisada_em IS NULL)) OR ((status = 'pendente_revisao'::text) AND (submetido_por IS NOT NULL) AND (submetido_em IS NOT NULL) AND (revisada_por IS NULL) AND (revisada_em IS NULL)) OR ((status = 'revisada'::text) AND (submetido_por IS NOT NULL) AND (submetido_em IS NOT NULL) AND (revisada_por IS NOT NULL) AND (revisada_em IS NOT NULL)))),
    CONSTRAINT contagens_status_check CHECK ((status = ANY (ARRAY['em_andamento'::text, 'pendente_revisao'::text, 'revisada'::text])))
);


--
-- Name: escala_entradas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.escala_entradas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_publicacao uuid NOT NULL,
    id_funcionario uuid NOT NULL,
    data date NOT NULL,
    status text NOT NULL,
    hora_inicio time without time zone,
    hora_fim time without time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT escala_entradas_check CHECK ((((status = 'trabalho'::text) AND (hora_inicio IS NOT NULL) AND (hora_fim IS NOT NULL) AND (hora_fim > hora_inicio)) OR ((status <> 'trabalho'::text) AND (hora_inicio IS NULL) AND (hora_fim IS NULL)))),
    CONSTRAINT escala_entradas_status_check CHECK ((status = ANY (ARRAY['trabalho'::text, 'folga'::text, 'ferias'::text])))
);


--
-- Name: escala_publicacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.escala_publicacoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mes_referencia date NOT NULL,
    publicado_em timestamp with time zone DEFAULT now() NOT NULL,
    publicado_por uuid NOT NULL,
    ativa boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    nome_arquivo text,
    publicacao_anterior_id uuid,
    CONSTRAINT escala_publicacoes_mes_referencia_check CHECK ((mes_referencia = (date_trunc('month'::text, (mes_referencia)::timestamp with time zone))::date))
);


--
-- Name: escalas_trabalho; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.escalas_trabalho (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_funcionario uuid NOT NULL,
    data_escala date NOT NULL,
    horario_chegada_previsto time without time zone NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('America/Manaus'::text, now()) NOT NULL
);


--
-- Name: estoque_atual; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_atual (
    produto text NOT NULL,
    desc_produto text,
    tipo_produto text,
    linha text,
    cor_codigo text NOT NULL,
    cor_descricao_linx text,
    grade text,
    tamanho_key integer NOT NULL,
    tamanho_venda text NOT NULL,
    quantidade_estoque integer NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estoque_atual_quantidade_estoque_check CHECK ((quantidade_estoque >= 0)),
    CONSTRAINT estoque_atual_tamanho_key_check CHECK (((tamanho_key >= 1) AND (tamanho_key <= 48)))
);


--
-- Name: estoque_atual_grupos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_atual_grupos (
    produto text NOT NULL,
    cor_codigo text NOT NULL,
    hash_conteudo text NOT NULL,
    row_count integer NOT NULL,
    ultimo_sync_id uuid,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estoque_atual_grupos_row_count_check CHECK ((row_count > 0))
);


--
-- Name: estoque_cores_mapeamento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_cores_mapeamento (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cor_codigo text NOT NULL,
    cor_descricao_linx text NOT NULL,
    cor_nome_portal text NOT NULL,
    cor_familia text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: estoque_organizacao_atribuicoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_organizacao_atribuicoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    semana_inicio date NOT NULL,
    funcionario_id uuid NOT NULL,
    numero_estante smallint NOT NULL,
    prateleiras_concluidas smallint DEFAULT 0 NOT NULL,
    origem text DEFAULT 'automatica'::text NOT NULL,
    criado_por uuid,
    atualizado_por uuid,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    concluido_por uuid,
    concluido_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estoque_organizacao_atribuicoes_check CHECK (((concluido_por IS NULL) = (concluido_em IS NULL))),
    CONSTRAINT estoque_organizacao_atribuicoes_numero_estante_check CHECK (((numero_estante >= 1) AND (numero_estante <= 41))),
    CONSTRAINT estoque_organizacao_atribuicoes_origem_check CHECK ((origem = ANY (ARRAY['automatica'::text, 'manual'::text]))),
    CONSTRAINT estoque_organizacao_atribuicoes_prateleiras_concluidas_check CHECK (((prateleiras_concluidas >= 0) AND (prateleiras_concluidas <= 5))),
    CONSTRAINT estoque_organizacao_atribuicoes_semana_inicio_check CHECK ((EXTRACT(dow FROM semana_inicio) = (0)::numeric))
);


--
-- Name: estoque_organizacao_rotacao_estado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_organizacao_rotacao_estado (
    id smallint DEFAULT 1 NOT NULL,
    proximo_numero smallint DEFAULT 1 NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    ativo_a_partir date NOT NULL,
    CONSTRAINT estoque_organizacao_rotacao_estado_ativo_a_partir_domingo CHECK ((EXTRACT(dow FROM ativo_a_partir) = (0)::numeric)),
    CONSTRAINT estoque_organizacao_rotacao_estado_id_check CHECK ((id = 1)),
    CONSTRAINT estoque_organizacao_rotacao_estado_proximo_numero_check CHECK (((proximo_numero >= 1) AND (proximo_numero <= 41)))
);


--
-- Name: estoque_organizacao_sync_falhas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_organizacao_sync_falhas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    semana_inicio date NOT NULL,
    falhou_em timestamp with time zone DEFAULT now() NOT NULL,
    motivo text,
    resolvido_em timestamp with time zone
);


--
-- Name: estoque_precos_atual; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_precos_atual (
    produto text NOT NULL,
    cor_codigo text NOT NULL,
    preco numeric(10,2) NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    ultimo_sync_id uuid,
    CONSTRAINT estoque_precos_atual_preco_check CHECK ((preco > (0)::numeric))
);


--
-- Name: estoque_staging_grupos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_staging_grupos (
    sync_id uuid NOT NULL,
    produto text NOT NULL,
    cor_codigo text NOT NULL,
    acao text NOT NULL,
    hash_conteudo text,
    row_count_esperado integer,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estoque_staging_grupos_acao_check CHECK ((acao = ANY (ARRAY['novo'::text, 'alterado'::text, 'removido'::text]))),
    CONSTRAINT estoque_staging_grupos_check CHECK ((((acao = ANY (ARRAY['novo'::text, 'alterado'::text])) AND (hash_conteudo IS NOT NULL) AND (row_count_esperado IS NOT NULL) AND (row_count_esperado > 0)) OR ((acao = 'removido'::text) AND (hash_conteudo IS NULL) AND (row_count_esperado IS NULL))))
);


--
-- Name: estoque_staging_linhas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_staging_linhas (
    sync_id uuid NOT NULL,
    produto text NOT NULL,
    cor_codigo text NOT NULL,
    tamanho_key integer NOT NULL,
    desc_produto text,
    tipo_produto text,
    linha text,
    cor_descricao_linx text,
    grade text,
    tamanho_venda text NOT NULL,
    quantidade_estoque integer NOT NULL,
    CONSTRAINT estoque_staging_linhas_quantidade_estoque_check CHECK ((quantidade_estoque >= 0)),
    CONSTRAINT estoque_staging_linhas_tamanho_key_check CHECK (((tamanho_key >= 1) AND (tamanho_key <= 48)))
);


--
-- Name: estoque_staging_precos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_staging_precos (
    sync_id uuid NOT NULL,
    produto text NOT NULL,
    cor_codigo text NOT NULL,
    acao text NOT NULL,
    preco numeric(10,2),
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estoque_staging_precos_acao_check CHECK ((acao = ANY (ARRAY['novo'::text, 'alterado'::text, 'removido'::text]))),
    CONSTRAINT estoque_staging_precos_check CHECK ((((acao = ANY (ARRAY['novo'::text, 'alterado'::text])) AND (preco IS NOT NULL) AND (preco > (0)::numeric)) OR ((acao = 'removido'::text) AND (preco IS NULL))))
);


--
-- Name: estoque_sync_execucoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_sync_execucoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    iniciado_em timestamp with time zone DEFAULT now() NOT NULL,
    concluido_em timestamp with time zone,
    status text DEFAULT 'executando'::text NOT NULL,
    linhas_extraidas integer,
    linhas_publicadas integer,
    erro text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_rows integer,
    produto_count integer,
    produto_cor_count integer,
    grupos_novos integer,
    grupos_alterados integer,
    grupos_removidos integer,
    grupos_inalterados integer,
    remocao_percentual numeric(6,3),
    avisos jsonb DEFAULT '[]'::jsonb NOT NULL,
    avisos_count integer DEFAULT 0 NOT NULL,
    large_removal_override_used boolean DEFAULT false NOT NULL,
    override_reason text,
    error_code text,
    preco_rows_lidos integer,
    preco_produto_cor_count integer,
    preco_novos integer,
    preco_alterados integer,
    preco_removidos integer,
    preco_inalterados integer,
    preco_sem_correspondencia integer,
    preco_linhas_escritas integer,
    CONSTRAINT estoque_sync_execucoes_check CHECK ((((status = 'sucesso'::text) AND (concluido_em IS NOT NULL)) OR (status <> 'sucesso'::text))),
    CONSTRAINT estoque_sync_execucoes_status_check CHECK ((status = ANY (ARRAY['executando'::text, 'sucesso'::text, 'erro'::text])))
);


--
-- Name: estoque_termos_busca; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_termos_busca (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    produto text NOT NULL,
    termo text NOT NULL,
    termo_normalizado text GENERATED ALWAYS AS (public.estoque_normalizar_texto(termo)) STORED,
    termo_sugerido text NOT NULL,
    status text NOT NULL,
    origem text NOT NULL,
    sugerido_por uuid NOT NULL,
    sugerido_em timestamp with time zone DEFAULT now() NOT NULL,
    moderado_por uuid,
    moderado_em timestamp with time zone,
    desativado_por uuid,
    desativado_em timestamp with time zone,
    reativado_por uuid,
    reativado_em timestamp with time zone,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estoque_termos_busca_check CHECK (((status = 'pendente'::text) = (moderado_por IS NULL))),
    CONSTRAINT estoque_termos_busca_check1 CHECK (((status = 'pendente'::text) = (moderado_em IS NULL))),
    CONSTRAINT estoque_termos_busca_origem_check CHECK ((origem = ANY (ARRAY['sugestao'::text, 'admin'::text]))),
    CONSTRAINT estoque_termos_busca_produto_check CHECK (((produto = upper(TRIM(BOTH FROM produto))) AND ((length(produto) >= 1) AND (length(produto) <= 30)))),
    CONSTRAINT estoque_termos_busca_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'aprovado'::text, 'rejeitado'::text, 'desativado'::text]))),
    CONSTRAINT estoque_termos_busca_termo_check CHECK ((termo = public.estoque_termo_busca_canonico(termo)))
);


--
-- Name: feriados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feriados (
    data date NOT NULL,
    nome text NOT NULL,
    abrangencia text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feriados_abrangencia_check CHECK ((abrangencia = ANY (ARRAY['nacional'::text, 'estadual'::text, 'municipal'::text])))
);


--
-- Name: funcionarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funcionarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nome text NOT NULL,
    apelido public.citext NOT NULL,
    email public.citext,
    token_pin text NOT NULL,
    cargo text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    aniversario_dia smallint,
    aniversario_mes smallint,
    data_admissao date,
    escala_grupo_gestao boolean DEFAULT false NOT NULL,
    escala_nome_planilha public.citext,
    pode_gerenciar_termos_busca boolean DEFAULT false NOT NULL,
    CONSTRAINT funcionarios_aniversario_check CHECK ((((aniversario_dia IS NULL) = (aniversario_mes IS NULL)) AND ((aniversario_mes IS NULL) OR ((aniversario_dia >= 1) AND (aniversario_dia <=
CASE aniversario_mes
    WHEN 2 THEN 29
    WHEN 4 THEN 30
    WHEN 6 THEN 30
    WHEN 9 THEN 30
    WHEN 11 THEN 30
    ELSE 31
END))) AND ((aniversario_mes IS NULL) OR ((aniversario_mes >= 1) AND (aniversario_mes <= 12))))),
    CONSTRAINT funcionarios_cargo_check CHECK ((cargo = ANY (ARRAY['Vendedor'::text, 'Caixa'::text, 'Gerente'::text, 'Administrador'::text])))
);


--
-- Name: limpeza_atribuicoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.limpeza_atribuicoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    data date NOT NULL,
    turno text NOT NULL,
    tarefa text NOT NULL,
    funcionario_id uuid,
    origem text DEFAULT 'automatica'::text NOT NULL,
    bloqueada boolean DEFAULT false NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    conflito_motivo text,
    concluido_por uuid,
    concluido_em timestamp with time zone,
    criado_por uuid,
    atualizado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT limpeza_atribuicoes_check CHECK (((funcionario_id IS NOT NULL) OR (status = 'sem_candidato'::text))),
    CONSTRAINT limpeza_atribuicoes_check1 CHECK (((status <> 'concluida'::text) OR ((concluido_por IS NOT NULL) AND (concluido_em IS NOT NULL)))),
    CONSTRAINT limpeza_atribuicoes_origem_check CHECK ((origem = ANY (ARRAY['automatica'::text, 'manual'::text]))),
    CONSTRAINT limpeza_atribuicoes_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'concluida'::text, 'conflito'::text, 'sem_candidato'::text]))),
    CONSTRAINT limpeza_atribuicoes_tarefa_check CHECK ((tarefa = ANY (ARRAY['varrer'::text, 'passar_pano'::text]))),
    CONSTRAINT limpeza_atribuicoes_turno_check CHECK ((turno = ANY (ARRAY['manha'::text, 'tarde'::text])))
);


--
-- Name: limpeza_cargos_excluidos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.limpeza_cargos_excluidos (
    cargo text NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: limpeza_sync_falhas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.limpeza_sync_falhas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    data date NOT NULL,
    falhou_em timestamp with time zone DEFAULT now() NOT NULL,
    motivo text,
    resolvido_em timestamp with time zone
);


--
-- Name: lista_vez_eventos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lista_vez_eventos (
    id bigint NOT NULL,
    id_funcionario uuid NOT NULL,
    dia_manaus date NOT NULL,
    tipo text NOT NULL,
    id_funcionario_ator uuid NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lista_vez_eventos_tipo_check CHECK ((tipo = ANY (ARRAY['saida_voluntaria'::text, 'reingresso'::text, 'remocao_admin'::text])))
);


--
-- Name: lista_vez_eventos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.lista_vez_eventos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lista_vez_eventos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: lista_vez_posicao_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lista_vez_posicao_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lista_vez_fila; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lista_vez_fila (
    id bigint NOT NULL,
    id_funcionario uuid NOT NULL,
    dia_manaus date NOT NULL,
    posicao bigint DEFAULT nextval('public.lista_vez_posicao_seq'::regclass) NOT NULL,
    disponivel boolean DEFAULT true NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    na_fila boolean DEFAULT true NOT NULL
);


--
-- Name: lista_vez_fila_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.lista_vez_fila ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lista_vez_fila_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: loja_horario_excecao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loja_horario_excecao (
    data date NOT NULL,
    abertura time without time zone,
    fechamento time without time zone,
    fechada boolean DEFAULT false NOT NULL,
    motivo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loja_horario_excecao_check CHECK (((fechada = true) OR ((abertura IS NOT NULL) AND (fechamento IS NOT NULL) AND (fechamento > abertura))))
);


--
-- Name: loja_horario_padrao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loja_horario_padrao (
    dia_semana smallint NOT NULL,
    abertura time without time zone NOT NULL,
    fechamento time without time zone NOT NULL,
    CONSTRAINT loja_horario_padrao_check CHECK ((fechamento > abertura)),
    CONSTRAINT loja_horario_padrao_dia_semana_check CHECK (((dia_semana >= 0) AND (dia_semana <= 6)))
);


--
-- Name: queue_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_funcionario uuid NOT NULL,
    status_registrado text NOT NULL,
    data_evento timestamp with time zone DEFAULT timezone('America/Manaus'::text, now()) NOT NULL
);


--
-- Name: queue_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_status (
    id_funcionario uuid NOT NULL,
    current_status text NOT NULL,
    status_changed_at timestamp with time zone DEFAULT timezone('America/Manaus'::text, now()) NOT NULL
);


--
-- Name: sessoes_funcionario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessoes_funcionario (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_funcionario uuid NOT NULL,
    token_hash text NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    expira_em timestamp with time zone NOT NULL,
    revogado_em timestamp with time zone
);


--
-- Name: shift_swaps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_swaps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_solicitante uuid NOT NULL,
    id_parceiro uuid NOT NULL,
    data_swap date NOT NULL,
    status_swap text DEFAULT 'pendente'::text NOT NULL,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('America/Manaus'::text, now()) NOT NULL
);


--
-- Name: termos_aceite; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.termos_aceite (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_funcionario uuid NOT NULL,
    versao_termo text DEFAULT '1.0'::text NOT NULL,
    texto_termo text NOT NULL,
    aceito_em timestamp with time zone DEFAULT timezone('America/Manaus'::text, now()) NOT NULL
);


--
-- Name: treinamento_blocos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treinamento_blocos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_versao uuid NOT NULL,
    ordem integer NOT NULL,
    tipo text NOT NULL,
    principios text[] DEFAULT '{}'::text[] NOT NULL,
    conteudo jsonb NOT NULL,
    origem_bloco_id uuid,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT treinamento_blocos_conteudo_check CHECK (public.treinamento_bloco_conteudo_valido(tipo, conteudo)),
    CONSTRAINT treinamento_blocos_ordem_check CHECK ((ordem > 0)),
    CONSTRAINT treinamento_blocos_principios_check CHECK ((principios <@ ARRAY['integridade'::text, 'foco-no-cliente'::text, 'colaboracao'::text, 'transparencia'::text, 'qualidade'::text])),
    CONSTRAINT treinamento_blocos_principios_max_check CHECK ((COALESCE(array_length(principios, 1), 0) <= 3)),
    CONSTRAINT treinamento_blocos_tipo_check CHECK ((tipo = ANY (ARRAY['texto'::text, 'cenario'::text])))
);


--
-- Name: treinamento_modulos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treinamento_modulos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    ordem_exibicao integer DEFAULT 0 NOT NULL,
    criado_por uuid NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    arquivado_por uuid,
    arquivado_em timestamp with time zone,
    CONSTRAINT treinamento_modulos_check CHECK (((arquivado_em IS NULL) = (arquivado_por IS NULL))),
    CONSTRAINT treinamento_modulos_slug_check CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND ((length(slug) >= 3) AND (length(slug) <= 60))))
);


--
-- Name: treinamento_progresso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treinamento_progresso (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_funcionario uuid NOT NULL,
    id_modulo uuid NOT NULL,
    id_versao uuid NOT NULL,
    tentativa integer DEFAULT 1 NOT NULL,
    status text NOT NULL,
    id_bloco_atual uuid,
    iniciado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    concluido_em timestamp with time zone,
    CONSTRAINT treinamento_progresso_check CHECK (((status = 'concluido'::text) = (concluido_em IS NOT NULL))),
    CONSTRAINT treinamento_progresso_status_check CHECK ((status = ANY (ARRAY['em_andamento'::text, 'concluido'::text]))),
    CONSTRAINT treinamento_progresso_tentativa_check CHECK ((tentativa > 0))
);


--
-- Name: treinamento_respostas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treinamento_respostas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_progresso uuid NOT NULL,
    id_versao uuid NOT NULL,
    id_bloco uuid NOT NULL,
    id_opcao uuid NOT NULL,
    classificacao text NOT NULL,
    respondido_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT treinamento_respostas_classificacao_check CHECK ((classificacao = ANY (ARRAY['best'::text, 'acceptable'::text, 'needs_improvement'::text])))
);


--
-- Name: treinamento_versoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treinamento_versoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_modulo uuid NOT NULL,
    versao integer NOT NULL,
    status text NOT NULL,
    titulo text NOT NULL,
    resumo text,
    duracao_estimada_min smallint,
    derivada_de uuid,
    criado_por uuid NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    publicado_por uuid,
    publicado_em timestamp with time zone,
    arquivado_em timestamp with time zone,
    CONSTRAINT treinamento_versoes_check CHECK (((publicado_em IS NULL) = (publicado_por IS NULL))),
    CONSTRAINT treinamento_versoes_check1 CHECK (((status = 'rascunho'::text) = (publicado_em IS NULL))),
    CONSTRAINT treinamento_versoes_check2 CHECK (((status = 'arquivada'::text) = (arquivado_em IS NOT NULL))),
    CONSTRAINT treinamento_versoes_duracao_estimada_min_check CHECK (((duracao_estimada_min IS NULL) OR ((duracao_estimada_min >= 1) AND (duracao_estimada_min <= 60)))),
    CONSTRAINT treinamento_versoes_resumo_check CHECK (((resumo IS NULL) OR ((length(btrim(resumo)) >= 3) AND (length(btrim(resumo)) <= 300)))),
    CONSTRAINT treinamento_versoes_status_check CHECK ((status = ANY (ARRAY['rascunho'::text, 'publicada'::text, 'arquivada'::text]))),
    CONSTRAINT treinamento_versoes_titulo_check CHECK (((length(btrim(titulo)) >= 3) AND (length(btrim(titulo)) <= 120))),
    CONSTRAINT treinamento_versoes_versao_check CHECK ((versao > 0))
);


--
-- Name: turno_presenca; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.turno_presenca (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_funcionario uuid NOT NULL,
    checked_in_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: atendimento_checklist_itens atendimento_checklist_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_checklist_itens
    ADD CONSTRAINT atendimento_checklist_itens_pkey PRIMARY KEY (id);


--
-- Name: atendimento_checklist_itens atendimento_checklist_itens_versao_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_checklist_itens
    ADD CONSTRAINT atendimento_checklist_itens_versao_codigo_key UNIQUE (versao, codigo);


--
-- Name: atendimento_checklists atendimento_checklists_id_atendimento_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_checklists
    ADD CONSTRAINT atendimento_checklists_id_atendimento_key UNIQUE (id_atendimento);


--
-- Name: atendimento_checklists atendimento_checklists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_checklists
    ADD CONSTRAINT atendimento_checklists_pkey PRIMARY KEY (id);


--
-- Name: atendimento_clientes atendimento_clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_clientes
    ADD CONSTRAINT atendimento_clientes_pkey PRIMARY KEY (id);


--
-- Name: atendimento_motivos atendimento_motivos_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_motivos
    ADD CONSTRAINT atendimento_motivos_codigo_key UNIQUE (codigo);


--
-- Name: atendimento_motivos atendimento_motivos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_motivos
    ADD CONSTRAINT atendimento_motivos_pkey PRIMARY KEY (id);


--
-- Name: atendimentos_legacy_pre_milestone1 atendimentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimentos_legacy_pre_milestone1
    ADD CONSTRAINT atendimentos_pkey PRIMARY KEY (id);


--
-- Name: atendimentos atendimentos_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimentos
    ADD CONSTRAINT atendimentos_pkey1 PRIMARY KEY (id);


--
-- Name: checklist_conclusoes_avulsas checklist_conclusoes_avulsas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_conclusoes_avulsas
    ADD CONSTRAINT checklist_conclusoes_avulsas_pkey PRIMARY KEY (id);


--
-- Name: checklist_config checklist_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_config
    ADD CONSTRAINT checklist_config_pkey PRIMARY KEY (id);


--
-- Name: checklist_pendencia_resolucoes checklist_pendencia_resolucoes_id_pendencia_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_pendencia_resolucoes
    ADD CONSTRAINT checklist_pendencia_resolucoes_id_pendencia_key UNIQUE (id_pendencia);


--
-- Name: checklist_pendencia_resolucoes checklist_pendencia_resolucoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_pendencia_resolucoes
    ADD CONSTRAINT checklist_pendencia_resolucoes_pkey PRIMARY KEY (id);


--
-- Name: checklist_pendencias checklist_pendencias_id_atendimento_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_pendencias
    ADD CONSTRAINT checklist_pendencias_id_atendimento_key UNIQUE (id_atendimento);


--
-- Name: checklist_pendencias checklist_pendencias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_pendencias
    ADD CONSTRAINT checklist_pendencias_pkey PRIMARY KEY (id);


--
-- Name: checklist_policy_eventos checklist_policy_eventos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_policy_eventos
    ADD CONSTRAINT checklist_policy_eventos_pkey PRIMARY KEY (id);


--
-- Name: contagem_embalagem_itens contagem_embalagem_itens_familia_tamanho_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contagem_embalagem_itens
    ADD CONSTRAINT contagem_embalagem_itens_familia_tamanho_key UNIQUE (familia, tamanho);


--
-- Name: contagem_embalagem_itens contagem_embalagem_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contagem_embalagem_itens
    ADD CONSTRAINT contagem_embalagem_itens_pkey PRIMARY KEY (id);


--
-- Name: contagem_itens contagem_itens_id_contagem_id_item_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contagem_itens
    ADD CONSTRAINT contagem_itens_id_contagem_id_item_key UNIQUE (id_contagem, id_item);


--
-- Name: contagem_itens contagem_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contagem_itens
    ADD CONSTRAINT contagem_itens_pkey PRIMARY KEY (id);


--
-- Name: contagens contagens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contagens
    ADD CONSTRAINT contagens_pkey PRIMARY KEY (id);


--
-- Name: escala_entradas escala_entradas_id_publicacao_id_funcionario_data_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escala_entradas
    ADD CONSTRAINT escala_entradas_id_publicacao_id_funcionario_data_key UNIQUE (id_publicacao, id_funcionario, data);


--
-- Name: escala_entradas escala_entradas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escala_entradas
    ADD CONSTRAINT escala_entradas_pkey PRIMARY KEY (id);


--
-- Name: escala_publicacoes escala_publicacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escala_publicacoes
    ADD CONSTRAINT escala_publicacoes_pkey PRIMARY KEY (id);


--
-- Name: escalas_trabalho escalas_trabalho_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalas_trabalho
    ADD CONSTRAINT escalas_trabalho_pkey PRIMARY KEY (id);


--
-- Name: estoque_atual_grupos estoque_atual_grupos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_atual_grupos
    ADD CONSTRAINT estoque_atual_grupos_pkey PRIMARY KEY (produto, cor_codigo);


--
-- Name: estoque_atual estoque_atual_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_atual
    ADD CONSTRAINT estoque_atual_pkey PRIMARY KEY (produto, cor_codigo, tamanho_key);


--
-- Name: estoque_cores_mapeamento estoque_cores_mapeamento_cor_codigo_cor_descricao_linx_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_cores_mapeamento
    ADD CONSTRAINT estoque_cores_mapeamento_cor_codigo_cor_descricao_linx_key UNIQUE (cor_codigo, cor_descricao_linx);


--
-- Name: estoque_cores_mapeamento estoque_cores_mapeamento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_cores_mapeamento
    ADD CONSTRAINT estoque_cores_mapeamento_pkey PRIMARY KEY (id);


--
-- Name: estoque_organizacao_atribuicoes estoque_organizacao_atribuicoe_semana_inicio_funcionario_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_organizacao_atribuicoes
    ADD CONSTRAINT estoque_organizacao_atribuicoe_semana_inicio_funcionario_id_key UNIQUE (semana_inicio, funcionario_id);


--
-- Name: estoque_organizacao_atribuicoes estoque_organizacao_atribuicoe_semana_inicio_numero_estante_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_organizacao_atribuicoes
    ADD CONSTRAINT estoque_organizacao_atribuicoe_semana_inicio_numero_estante_key UNIQUE (semana_inicio, numero_estante);


--
-- Name: estoque_organizacao_atribuicoes estoque_organizacao_atribuicoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_organizacao_atribuicoes
    ADD CONSTRAINT estoque_organizacao_atribuicoes_pkey PRIMARY KEY (id);


--
-- Name: estoque_organizacao_rotacao_estado estoque_organizacao_rotacao_estado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_organizacao_rotacao_estado
    ADD CONSTRAINT estoque_organizacao_rotacao_estado_pkey PRIMARY KEY (id);


--
-- Name: estoque_organizacao_sync_falhas estoque_organizacao_sync_falhas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_organizacao_sync_falhas
    ADD CONSTRAINT estoque_organizacao_sync_falhas_pkey PRIMARY KEY (id);


--
-- Name: estoque_precos_atual estoque_precos_atual_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_precos_atual
    ADD CONSTRAINT estoque_precos_atual_pkey PRIMARY KEY (produto, cor_codigo);


--
-- Name: estoque_staging_grupos estoque_staging_grupos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_staging_grupos
    ADD CONSTRAINT estoque_staging_grupos_pkey PRIMARY KEY (sync_id, produto, cor_codigo);


--
-- Name: estoque_staging_linhas estoque_staging_linhas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_staging_linhas
    ADD CONSTRAINT estoque_staging_linhas_pkey PRIMARY KEY (sync_id, produto, cor_codigo, tamanho_key);


--
-- Name: estoque_staging_precos estoque_staging_precos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_staging_precos
    ADD CONSTRAINT estoque_staging_precos_pkey PRIMARY KEY (sync_id, produto, cor_codigo);


--
-- Name: estoque_sync_execucoes estoque_sync_execucoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_sync_execucoes
    ADD CONSTRAINT estoque_sync_execucoes_pkey PRIMARY KEY (id);


--
-- Name: estoque_termos_busca estoque_termos_busca_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_termos_busca
    ADD CONSTRAINT estoque_termos_busca_pkey PRIMARY KEY (id);


--
-- Name: feriados feriados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feriados
    ADD CONSTRAINT feriados_pkey PRIMARY KEY (data);


--
-- Name: funcionarios funcionarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funcionarios
    ADD CONSTRAINT funcionarios_pkey PRIMARY KEY (id);


--
-- Name: limpeza_atribuicoes limpeza_atribuicoes_data_turno_tarefa_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.limpeza_atribuicoes
    ADD CONSTRAINT limpeza_atribuicoes_data_turno_tarefa_key UNIQUE (data, turno, tarefa);


--
-- Name: limpeza_atribuicoes limpeza_atribuicoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.limpeza_atribuicoes
    ADD CONSTRAINT limpeza_atribuicoes_pkey PRIMARY KEY (id);


--
-- Name: limpeza_cargos_excluidos limpeza_cargos_excluidos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.limpeza_cargos_excluidos
    ADD CONSTRAINT limpeza_cargos_excluidos_pkey PRIMARY KEY (cargo);


--
-- Name: limpeza_sync_falhas limpeza_sync_falhas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.limpeza_sync_falhas
    ADD CONSTRAINT limpeza_sync_falhas_pkey PRIMARY KEY (id);


--
-- Name: lista_vez_eventos lista_vez_eventos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_vez_eventos
    ADD CONSTRAINT lista_vez_eventos_pkey PRIMARY KEY (id);


--
-- Name: lista_vez_fila lista_vez_fila_id_funcionario_dia_manaus_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_vez_fila
    ADD CONSTRAINT lista_vez_fila_id_funcionario_dia_manaus_key UNIQUE (id_funcionario, dia_manaus);


--
-- Name: lista_vez_fila lista_vez_fila_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_vez_fila
    ADD CONSTRAINT lista_vez_fila_pkey PRIMARY KEY (id);


--
-- Name: loja_horario_excecao loja_horario_excecao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loja_horario_excecao
    ADD CONSTRAINT loja_horario_excecao_pkey PRIMARY KEY (data);


--
-- Name: loja_horario_padrao loja_horario_padrao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loja_horario_padrao
    ADD CONSTRAINT loja_horario_padrao_pkey PRIMARY KEY (dia_semana);


--
-- Name: queue_log queue_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_log
    ADD CONSTRAINT queue_log_pkey PRIMARY KEY (id);


--
-- Name: queue_status queue_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_status
    ADD CONSTRAINT queue_status_pkey PRIMARY KEY (id_funcionario);


--
-- Name: sessoes_funcionario sessoes_funcionario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessoes_funcionario
    ADD CONSTRAINT sessoes_funcionario_pkey PRIMARY KEY (id);


--
-- Name: sessoes_funcionario sessoes_funcionario_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessoes_funcionario
    ADD CONSTRAINT sessoes_funcionario_token_hash_key UNIQUE (token_hash);


--
-- Name: shift_swaps shift_swaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_pkey PRIMARY KEY (id);


--
-- Name: termos_aceite termos_aceite_id_funcionario_versao_termo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.termos_aceite
    ADD CONSTRAINT termos_aceite_id_funcionario_versao_termo_key UNIQUE (id_funcionario, versao_termo);


--
-- Name: termos_aceite termos_aceite_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.termos_aceite
    ADD CONSTRAINT termos_aceite_pkey PRIMARY KEY (id);


--
-- Name: treinamento_blocos treinamento_blocos_id_id_versao_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_blocos
    ADD CONSTRAINT treinamento_blocos_id_id_versao_key UNIQUE (id, id_versao);


--
-- Name: treinamento_blocos treinamento_blocos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_blocos
    ADD CONSTRAINT treinamento_blocos_pkey PRIMARY KEY (id);


--
-- Name: treinamento_blocos treinamento_blocos_versao_ordem_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_blocos
    ADD CONSTRAINT treinamento_blocos_versao_ordem_key UNIQUE (id_versao, ordem) DEFERRABLE;


--
-- Name: treinamento_modulos treinamento_modulos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_modulos
    ADD CONSTRAINT treinamento_modulos_pkey PRIMARY KEY (id);


--
-- Name: treinamento_modulos treinamento_modulos_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_modulos
    ADD CONSTRAINT treinamento_modulos_slug_key UNIQUE (slug);


--
-- Name: treinamento_progresso treinamento_progresso_id_id_versao_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_progresso
    ADD CONSTRAINT treinamento_progresso_id_id_versao_key UNIQUE (id, id_versao);


--
-- Name: treinamento_progresso treinamento_progresso_id_versao_id_funcionario_tentativa_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_progresso
    ADD CONSTRAINT treinamento_progresso_id_versao_id_funcionario_tentativa_key UNIQUE (id_versao, id_funcionario, tentativa);


--
-- Name: treinamento_progresso treinamento_progresso_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_progresso
    ADD CONSTRAINT treinamento_progresso_pkey PRIMARY KEY (id);


--
-- Name: treinamento_respostas treinamento_respostas_id_progresso_id_bloco_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_respostas
    ADD CONSTRAINT treinamento_respostas_id_progresso_id_bloco_key UNIQUE (id_progresso, id_bloco);


--
-- Name: treinamento_respostas treinamento_respostas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_respostas
    ADD CONSTRAINT treinamento_respostas_pkey PRIMARY KEY (id);


--
-- Name: treinamento_versoes treinamento_versoes_id_id_modulo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_versoes
    ADD CONSTRAINT treinamento_versoes_id_id_modulo_key UNIQUE (id, id_modulo);


--
-- Name: treinamento_versoes treinamento_versoes_id_modulo_versao_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_versoes
    ADD CONSTRAINT treinamento_versoes_id_modulo_versao_key UNIQUE (id_modulo, versao);


--
-- Name: treinamento_versoes treinamento_versoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_versoes
    ADD CONSTRAINT treinamento_versoes_pkey PRIMARY KEY (id);


--
-- Name: turno_presenca turno_presenca_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.turno_presenca
    ADD CONSTRAINT turno_presenca_pkey PRIMARY KEY (id);


--
-- Name: atendimento_checklist_itens_versao_ativo_ordem_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX atendimento_checklist_itens_versao_ativo_ordem_idx ON public.atendimento_checklist_itens USING btree (versao, ativo, ordem_exibicao);


--
-- Name: atendimento_checklists_id_funcionario_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX atendimento_checklists_id_funcionario_idx ON public.atendimento_checklists USING btree (id_funcionario);


--
-- Name: atendimento_clientes_categoria_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX atendimento_clientes_categoria_idx ON public.atendimento_clientes USING btree (categoria);


--
-- Name: atendimento_clientes_id_atendimento_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX atendimento_clientes_id_atendimento_idx ON public.atendimento_clientes USING btree (id_atendimento);


--
-- Name: atendimento_motivos_categoria_ativo_ordem_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX atendimento_motivos_categoria_ativo_ordem_idx ON public.atendimento_motivos USING btree (categoria, ativo, ordem_exibicao);


--
-- Name: atendimentos_id_funcionario_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX atendimentos_id_funcionario_idx ON public.atendimentos USING btree (id_funcionario);


--
-- Name: atendimentos_um_ativo_por_funcionario_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX atendimentos_um_ativo_por_funcionario_idx ON public.atendimentos USING btree (id_funcionario) WHERE (status = ANY (ARRAY['ativo'::text, 'finalizando'::text, 'pendente_fechamento'::text]));


--
-- Name: checklist_conclusoes_avulsas_id_funcionario_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_conclusoes_avulsas_id_funcionario_idx ON public.checklist_conclusoes_avulsas USING btree (id_funcionario);


--
-- Name: checklist_pendencia_resolucoes_atendimento_checklist_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_pendencia_resolucoes_atendimento_checklist_idx ON public.checklist_pendencia_resolucoes USING btree (id_atendimento_checklist);


--
-- Name: checklist_pendencia_resolucoes_checklist_avulso_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_pendencia_resolucoes_checklist_avulso_idx ON public.checklist_pendencia_resolucoes USING btree (id_checklist_avulso);


--
-- Name: checklist_pendencias_funcionario_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_pendencias_funcionario_status_idx ON public.checklist_pendencias USING btree (id_funcionario, status);


--
-- Name: checklist_policy_eventos_criado_em_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_policy_eventos_criado_em_idx ON public.checklist_policy_eventos USING btree (criado_em DESC);


--
-- Name: contagem_itens_id_contagem_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contagem_itens_id_contagem_idx ON public.contagem_itens USING btree (id_contagem);


--
-- Name: contagens_status_submetido_em_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contagens_status_submetido_em_idx ON public.contagens USING btree (status, submetido_em DESC);


--
-- Name: contagens_submetido_por_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contagens_submetido_por_idx ON public.contagens USING btree (submetido_por);


--
-- Name: contagens_uma_ativa_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contagens_uma_ativa_idx ON public.contagens USING btree (status) WHERE (status = 'em_andamento'::text);


--
-- Name: escala_entradas_data_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX escala_entradas_data_idx ON public.escala_entradas USING btree (data);


--
-- Name: escala_entradas_funcionario_data_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX escala_entradas_funcionario_data_idx ON public.escala_entradas USING btree (id_funcionario, data);


--
-- Name: escala_publicacoes_mes_ativa_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX escala_publicacoes_mes_ativa_key ON public.escala_publicacoes USING btree (mes_referencia) WHERE ativa;


--
-- Name: escala_publicacoes_mes_referencia_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX escala_publicacoes_mes_referencia_idx ON public.escala_publicacoes USING btree (mes_referencia);


--
-- Name: estoque_organizacao_atribuicoes_funcionario_semana_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_organizacao_atribuicoes_funcionario_semana_idx ON public.estoque_organizacao_atribuicoes USING btree (funcionario_id, semana_inicio);


--
-- Name: estoque_organizacao_atribuicoes_semana_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_organizacao_atribuicoes_semana_idx ON public.estoque_organizacao_atribuicoes USING btree (semana_inicio);


--
-- Name: estoque_organizacao_sync_falhas_nao_resolvida_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_organizacao_sync_falhas_nao_resolvida_idx ON public.estoque_organizacao_sync_falhas USING btree (semana_inicio) WHERE (resolvido_em IS NULL);


--
-- Name: estoque_organizacao_sync_falhas_semana_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_organizacao_sync_falhas_semana_idx ON public.estoque_organizacao_sync_falhas USING btree (semana_inicio);


--
-- Name: estoque_staging_linhas_grupo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_staging_linhas_grupo_idx ON public.estoque_staging_linhas USING btree (sync_id, produto, cor_codigo);


--
-- Name: estoque_sync_execucoes_sucesso_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_sync_execucoes_sucesso_idx ON public.estoque_sync_execucoes USING btree (concluido_em DESC) WHERE (status = 'sucesso'::text);


--
-- Name: estoque_sync_execucoes_unica_executando_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX estoque_sync_execucoes_unica_executando_idx ON public.estoque_sync_execucoes USING btree ((true)) WHERE (status = 'executando'::text);


--
-- Name: estoque_termos_busca_pendentes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_termos_busca_pendentes_idx ON public.estoque_termos_busca USING btree (sugerido_em) WHERE (status = 'pendente'::text);


--
-- Name: estoque_termos_busca_produto_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_termos_busca_produto_idx ON public.estoque_termos_busca USING btree (produto);


--
-- Name: estoque_termos_busca_slot_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX estoque_termos_busca_slot_uidx ON public.estoque_termos_busca USING btree (produto, termo_normalizado) WHERE (status = ANY (ARRAY['pendente'::text, 'aprovado'::text, 'desativado'::text]));


--
-- Name: funcionarios_escala_nome_planilha_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX funcionarios_escala_nome_planilha_key ON public.funcionarios USING btree (escala_nome_planilha) WHERE (escala_nome_planilha IS NOT NULL);


--
-- Name: idx_unique_active_apelido; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_unique_active_apelido ON public.funcionarios USING btree (apelido) WHERE (is_active = true);


--
-- Name: limpeza_atribuicoes_data_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX limpeza_atribuicoes_data_idx ON public.limpeza_atribuicoes USING btree (data);


--
-- Name: limpeza_atribuicoes_funcionario_data_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX limpeza_atribuicoes_funcionario_data_idx ON public.limpeza_atribuicoes USING btree (funcionario_id, data);


--
-- Name: limpeza_sync_falhas_data_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX limpeza_sync_falhas_data_idx ON public.limpeza_sync_falhas USING btree (data);


--
-- Name: limpeza_sync_falhas_nao_resolvida_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX limpeza_sync_falhas_nao_resolvida_idx ON public.limpeza_sync_falhas USING btree (data) WHERE (resolvido_em IS NULL);


--
-- Name: lista_vez_eventos_funcionario_dia_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lista_vez_eventos_funcionario_dia_idx ON public.lista_vez_eventos USING btree (id_funcionario, dia_manaus);


--
-- Name: lista_vez_fila_dia_disponivel_posicao_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lista_vez_fila_dia_disponivel_posicao_idx ON public.lista_vez_fila USING btree (dia_manaus, disponivel, posicao);


--
-- Name: sessoes_funcionario_id_funcionario_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessoes_funcionario_id_funcionario_idx ON public.sessoes_funcionario USING btree (id_funcionario);


--
-- Name: treinamento_progresso_ativo_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX treinamento_progresso_ativo_uidx ON public.treinamento_progresso USING btree (id_funcionario, id_modulo) WHERE (status = 'em_andamento'::text);


--
-- Name: treinamento_progresso_funcionario_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX treinamento_progresso_funcionario_idx ON public.treinamento_progresso USING btree (id_funcionario, status);


--
-- Name: treinamento_progresso_versao_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX treinamento_progresso_versao_idx ON public.treinamento_progresso USING btree (id_versao);


--
-- Name: treinamento_respostas_bloco_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX treinamento_respostas_bloco_idx ON public.treinamento_respostas USING btree (id_bloco, classificacao);


--
-- Name: treinamento_versoes_modulo_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX treinamento_versoes_modulo_status_idx ON public.treinamento_versoes USING btree (id_modulo, status);


--
-- Name: treinamento_versoes_um_rascunho_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX treinamento_versoes_um_rascunho_uidx ON public.treinamento_versoes USING btree (id_modulo) WHERE (status = 'rascunho'::text);


--
-- Name: treinamento_versoes_uma_publicada_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX treinamento_versoes_uma_publicada_uidx ON public.treinamento_versoes USING btree (id_modulo) WHERE (status = 'publicada'::text);


--
-- Name: turno_presenca_id_funcionario_dia_manaus_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX turno_presenca_id_funcionario_dia_manaus_key ON public.turno_presenca USING btree (id_funcionario, (((checked_in_at AT TIME ZONE 'America/Manaus'::text))::date));


--
-- Name: treinamento_blocos treinamento_blocos_imutavel_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER treinamento_blocos_imutavel_trg BEFORE DELETE OR UPDATE ON public.treinamento_blocos FOR EACH ROW EXECUTE FUNCTION public.treinamento_blocos_imutavel();


--
-- Name: treinamento_respostas treinamento_respostas_append_only_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER treinamento_respostas_append_only_trg BEFORE DELETE OR UPDATE ON public.treinamento_respostas FOR EACH ROW EXECUTE FUNCTION public.treinamento_respostas_append_only();


--
-- Name: treinamento_respostas treinamento_respostas_validar_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER treinamento_respostas_validar_trg BEFORE INSERT ON public.treinamento_respostas FOR EACH ROW EXECUTE FUNCTION public.treinamento_respostas_validar();


--
-- Name: treinamento_versoes treinamento_versoes_delete_guard_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER treinamento_versoes_delete_guard_trg BEFORE DELETE ON public.treinamento_versoes FOR EACH ROW EXECUTE FUNCTION public.treinamento_versoes_delete_guard();


--
-- Name: treinamento_versoes treinamento_versoes_transicao_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER treinamento_versoes_transicao_trg BEFORE UPDATE ON public.treinamento_versoes FOR EACH ROW EXECUTE FUNCTION public.treinamento_versoes_transicao();


--
-- Name: atendimento_checklists atendimento_checklists_id_atendimento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_checklists
    ADD CONSTRAINT atendimento_checklists_id_atendimento_fkey FOREIGN KEY (id_atendimento) REFERENCES public.atendimentos(id) ON DELETE CASCADE;


--
-- Name: atendimento_checklists atendimento_checklists_id_funcionario_ator_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_checklists
    ADD CONSTRAINT atendimento_checklists_id_funcionario_ator_fkey FOREIGN KEY (id_funcionario_ator) REFERENCES public.funcionarios(id);


--
-- Name: atendimento_checklists atendimento_checklists_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_checklists
    ADD CONSTRAINT atendimento_checklists_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: atendimento_clientes atendimento_clientes_id_atendimento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_clientes
    ADD CONSTRAINT atendimento_clientes_id_atendimento_fkey FOREIGN KEY (id_atendimento) REFERENCES public.atendimentos(id) ON DELETE CASCADE;


--
-- Name: atendimento_clientes atendimento_clientes_id_motivo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_clientes
    ADD CONSTRAINT atendimento_clientes_id_motivo_fkey FOREIGN KEY (id_motivo) REFERENCES public.atendimento_motivos(id);


--
-- Name: atendimentos atendimentos_id_funcionario_cancelou_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimentos
    ADD CONSTRAINT atendimentos_id_funcionario_cancelou_fkey FOREIGN KEY (id_funcionario_cancelou) REFERENCES public.funcionarios(id);


--
-- Name: atendimentos atendimentos_id_funcionario_concluiu_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimentos
    ADD CONSTRAINT atendimentos_id_funcionario_concluiu_fkey FOREIGN KEY (id_funcionario_concluiu) REFERENCES public.funcionarios(id);


--
-- Name: atendimentos atendimentos_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimentos
    ADD CONSTRAINT atendimentos_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: atendimentos atendimentos_id_funcionario_iniciador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimentos
    ADD CONSTRAINT atendimentos_id_funcionario_iniciador_fkey FOREIGN KEY (id_funcionario_iniciador) REFERENCES public.funcionarios(id);


--
-- Name: atendimentos atendimentos_id_funcionario_iniciou_fechamento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimentos
    ADD CONSTRAINT atendimentos_id_funcionario_iniciou_fechamento_fkey FOREIGN KEY (id_funcionario_iniciou_fechamento) REFERENCES public.funcionarios(id);


--
-- Name: atendimentos_legacy_pre_milestone1 atendimentos_id_vendedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimentos_legacy_pre_milestone1
    ADD CONSTRAINT atendimentos_id_vendedor_fkey FOREIGN KEY (id_vendedor) REFERENCES public.funcionarios(id) ON DELETE RESTRICT;


--
-- Name: checklist_conclusoes_avulsas checklist_conclusoes_avulsas_id_funcionario_ator_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_conclusoes_avulsas
    ADD CONSTRAINT checklist_conclusoes_avulsas_id_funcionario_ator_fkey FOREIGN KEY (id_funcionario_ator) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: checklist_conclusoes_avulsas checklist_conclusoes_avulsas_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_conclusoes_avulsas
    ADD CONSTRAINT checklist_conclusoes_avulsas_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: checklist_config checklist_config_atualizado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_config
    ADD CONSTRAINT checklist_config_atualizado_por_fkey FOREIGN KEY (atualizado_por) REFERENCES public.funcionarios(id);


--
-- Name: checklist_pendencia_resolucoes checklist_pendencia_resolucoes_id_atendimento_checklist_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_pendencia_resolucoes
    ADD CONSTRAINT checklist_pendencia_resolucoes_id_atendimento_checklist_fkey FOREIGN KEY (id_atendimento_checklist) REFERENCES public.atendimento_checklists(id);


--
-- Name: checklist_pendencia_resolucoes checklist_pendencia_resolucoes_id_checklist_avulso_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_pendencia_resolucoes
    ADD CONSTRAINT checklist_pendencia_resolucoes_id_checklist_avulso_fkey FOREIGN KEY (id_checklist_avulso) REFERENCES public.checklist_conclusoes_avulsas(id);


--
-- Name: checklist_pendencia_resolucoes checklist_pendencia_resolucoes_id_pendencia_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_pendencia_resolucoes
    ADD CONSTRAINT checklist_pendencia_resolucoes_id_pendencia_fkey FOREIGN KEY (id_pendencia) REFERENCES public.checklist_pendencias(id) ON DELETE CASCADE;


--
-- Name: checklist_pendencias checklist_pendencias_id_atendimento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_pendencias
    ADD CONSTRAINT checklist_pendencias_id_atendimento_fkey FOREIGN KEY (id_atendimento) REFERENCES public.atendimentos(id) ON DELETE CASCADE;


--
-- Name: checklist_pendencias checklist_pendencias_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_pendencias
    ADD CONSTRAINT checklist_pendencias_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: checklist_pendencias checklist_pendencias_id_resolucao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_pendencias
    ADD CONSTRAINT checklist_pendencias_id_resolucao_fkey FOREIGN KEY (id_resolucao) REFERENCES public.checklist_pendencia_resolucoes(id);


--
-- Name: checklist_policy_eventos checklist_policy_eventos_id_funcionario_ator_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_policy_eventos
    ADD CONSTRAINT checklist_policy_eventos_id_funcionario_ator_fkey FOREIGN KEY (id_funcionario_ator) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: contagem_itens contagem_itens_id_contagem_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contagem_itens
    ADD CONSTRAINT contagem_itens_id_contagem_fkey FOREIGN KEY (id_contagem) REFERENCES public.contagens(id) ON DELETE CASCADE;


--
-- Name: contagem_itens contagem_itens_id_item_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contagem_itens
    ADD CONSTRAINT contagem_itens_id_item_fkey FOREIGN KEY (id_item) REFERENCES public.contagem_embalagem_itens(id);


--
-- Name: contagens contagens_iniciado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contagens
    ADD CONSTRAINT contagens_iniciado_por_fkey FOREIGN KEY (iniciado_por) REFERENCES public.funcionarios(id);


--
-- Name: contagens contagens_revisada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contagens
    ADD CONSTRAINT contagens_revisada_por_fkey FOREIGN KEY (revisada_por) REFERENCES public.funcionarios(id);


--
-- Name: contagens contagens_submetido_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contagens
    ADD CONSTRAINT contagens_submetido_por_fkey FOREIGN KEY (submetido_por) REFERENCES public.funcionarios(id);


--
-- Name: escala_entradas escala_entradas_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escala_entradas
    ADD CONSTRAINT escala_entradas_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id);


--
-- Name: escala_entradas escala_entradas_id_publicacao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escala_entradas
    ADD CONSTRAINT escala_entradas_id_publicacao_fkey FOREIGN KEY (id_publicacao) REFERENCES public.escala_publicacoes(id) ON DELETE CASCADE;


--
-- Name: escala_publicacoes escala_publicacoes_publicacao_anterior_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escala_publicacoes
    ADD CONSTRAINT escala_publicacoes_publicacao_anterior_id_fkey FOREIGN KEY (publicacao_anterior_id) REFERENCES public.escala_publicacoes(id);


--
-- Name: escala_publicacoes escala_publicacoes_publicado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escala_publicacoes
    ADD CONSTRAINT escala_publicacoes_publicado_por_fkey FOREIGN KEY (publicado_por) REFERENCES public.funcionarios(id);


--
-- Name: escalas_trabalho escalas_trabalho_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalas_trabalho
    ADD CONSTRAINT escalas_trabalho_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: estoque_atual_grupos estoque_atual_grupos_ultimo_sync_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_atual_grupos
    ADD CONSTRAINT estoque_atual_grupos_ultimo_sync_id_fkey FOREIGN KEY (ultimo_sync_id) REFERENCES public.estoque_sync_execucoes(id);


--
-- Name: estoque_organizacao_atribuicoes estoque_organizacao_atribuicoes_atualizado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_organizacao_atribuicoes
    ADD CONSTRAINT estoque_organizacao_atribuicoes_atualizado_por_fkey FOREIGN KEY (atualizado_por) REFERENCES public.funcionarios(id);


--
-- Name: estoque_organizacao_atribuicoes estoque_organizacao_atribuicoes_concluido_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_organizacao_atribuicoes
    ADD CONSTRAINT estoque_organizacao_atribuicoes_concluido_por_fkey FOREIGN KEY (concluido_por) REFERENCES public.funcionarios(id);


--
-- Name: estoque_organizacao_atribuicoes estoque_organizacao_atribuicoes_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_organizacao_atribuicoes
    ADD CONSTRAINT estoque_organizacao_atribuicoes_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.funcionarios(id);


--
-- Name: estoque_organizacao_atribuicoes estoque_organizacao_atribuicoes_funcionario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_organizacao_atribuicoes
    ADD CONSTRAINT estoque_organizacao_atribuicoes_funcionario_id_fkey FOREIGN KEY (funcionario_id) REFERENCES public.funcionarios(id);


--
-- Name: estoque_precos_atual estoque_precos_atual_ultimo_sync_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_precos_atual
    ADD CONSTRAINT estoque_precos_atual_ultimo_sync_id_fkey FOREIGN KEY (ultimo_sync_id) REFERENCES public.estoque_sync_execucoes(id);


--
-- Name: estoque_staging_grupos estoque_staging_grupos_sync_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_staging_grupos
    ADD CONSTRAINT estoque_staging_grupos_sync_id_fkey FOREIGN KEY (sync_id) REFERENCES public.estoque_sync_execucoes(id) ON DELETE CASCADE;


--
-- Name: estoque_staging_linhas estoque_staging_linhas_sync_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_staging_linhas
    ADD CONSTRAINT estoque_staging_linhas_sync_id_fkey FOREIGN KEY (sync_id) REFERENCES public.estoque_sync_execucoes(id) ON DELETE CASCADE;


--
-- Name: estoque_staging_precos estoque_staging_precos_sync_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_staging_precos
    ADD CONSTRAINT estoque_staging_precos_sync_id_fkey FOREIGN KEY (sync_id) REFERENCES public.estoque_sync_execucoes(id) ON DELETE CASCADE;


--
-- Name: estoque_termos_busca estoque_termos_busca_desativado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_termos_busca
    ADD CONSTRAINT estoque_termos_busca_desativado_por_fkey FOREIGN KEY (desativado_por) REFERENCES public.funcionarios(id);


--
-- Name: estoque_termos_busca estoque_termos_busca_moderado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_termos_busca
    ADD CONSTRAINT estoque_termos_busca_moderado_por_fkey FOREIGN KEY (moderado_por) REFERENCES public.funcionarios(id);


--
-- Name: estoque_termos_busca estoque_termos_busca_reativado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_termos_busca
    ADD CONSTRAINT estoque_termos_busca_reativado_por_fkey FOREIGN KEY (reativado_por) REFERENCES public.funcionarios(id);


--
-- Name: estoque_termos_busca estoque_termos_busca_sugerido_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_termos_busca
    ADD CONSTRAINT estoque_termos_busca_sugerido_por_fkey FOREIGN KEY (sugerido_por) REFERENCES public.funcionarios(id);


--
-- Name: limpeza_atribuicoes limpeza_atribuicoes_atualizado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.limpeza_atribuicoes
    ADD CONSTRAINT limpeza_atribuicoes_atualizado_por_fkey FOREIGN KEY (atualizado_por) REFERENCES public.funcionarios(id);


--
-- Name: limpeza_atribuicoes limpeza_atribuicoes_concluido_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.limpeza_atribuicoes
    ADD CONSTRAINT limpeza_atribuicoes_concluido_por_fkey FOREIGN KEY (concluido_por) REFERENCES public.funcionarios(id);


--
-- Name: limpeza_atribuicoes limpeza_atribuicoes_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.limpeza_atribuicoes
    ADD CONSTRAINT limpeza_atribuicoes_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.funcionarios(id);


--
-- Name: limpeza_atribuicoes limpeza_atribuicoes_funcionario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.limpeza_atribuicoes
    ADD CONSTRAINT limpeza_atribuicoes_funcionario_id_fkey FOREIGN KEY (funcionario_id) REFERENCES public.funcionarios(id);


--
-- Name: lista_vez_eventos lista_vez_eventos_id_funcionario_ator_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_vez_eventos
    ADD CONSTRAINT lista_vez_eventos_id_funcionario_ator_fkey FOREIGN KEY (id_funcionario_ator) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: lista_vez_eventos lista_vez_eventos_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_vez_eventos
    ADD CONSTRAINT lista_vez_eventos_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: lista_vez_fila lista_vez_fila_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_vez_fila
    ADD CONSTRAINT lista_vez_fila_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: queue_log queue_log_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_log
    ADD CONSTRAINT queue_log_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE RESTRICT;


--
-- Name: queue_status queue_status_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_status
    ADD CONSTRAINT queue_status_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: sessoes_funcionario sessoes_funcionario_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessoes_funcionario
    ADD CONSTRAINT sessoes_funcionario_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: shift_swaps shift_swaps_id_parceiro_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_id_parceiro_fkey FOREIGN KEY (id_parceiro) REFERENCES public.funcionarios(id) ON DELETE RESTRICT;


--
-- Name: shift_swaps shift_swaps_id_solicitante_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_id_solicitante_fkey FOREIGN KEY (id_solicitante) REFERENCES public.funcionarios(id) ON DELETE RESTRICT;


--
-- Name: termos_aceite termos_aceite_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.termos_aceite
    ADD CONSTRAINT termos_aceite_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE RESTRICT;


--
-- Name: treinamento_blocos treinamento_blocos_id_versao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_blocos
    ADD CONSTRAINT treinamento_blocos_id_versao_fkey FOREIGN KEY (id_versao) REFERENCES public.treinamento_versoes(id) ON DELETE CASCADE;


--
-- Name: treinamento_blocos treinamento_blocos_origem_bloco_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_blocos
    ADD CONSTRAINT treinamento_blocos_origem_bloco_id_fkey FOREIGN KEY (origem_bloco_id) REFERENCES public.treinamento_blocos(id) ON DELETE SET NULL;


--
-- Name: treinamento_modulos treinamento_modulos_arquivado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_modulos
    ADD CONSTRAINT treinamento_modulos_arquivado_por_fkey FOREIGN KEY (arquivado_por) REFERENCES public.funcionarios(id);


--
-- Name: treinamento_modulos treinamento_modulos_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_modulos
    ADD CONSTRAINT treinamento_modulos_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.funcionarios(id);


--
-- Name: treinamento_progresso treinamento_progresso_id_bloco_atual_id_versao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_progresso
    ADD CONSTRAINT treinamento_progresso_id_bloco_atual_id_versao_fkey FOREIGN KEY (id_bloco_atual, id_versao) REFERENCES public.treinamento_blocos(id, id_versao);


--
-- Name: treinamento_progresso treinamento_progresso_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_progresso
    ADD CONSTRAINT treinamento_progresso_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE CASCADE;


--
-- Name: treinamento_progresso treinamento_progresso_id_versao_id_modulo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_progresso
    ADD CONSTRAINT treinamento_progresso_id_versao_id_modulo_fkey FOREIGN KEY (id_versao, id_modulo) REFERENCES public.treinamento_versoes(id, id_modulo);


--
-- Name: treinamento_respostas treinamento_respostas_id_bloco_id_versao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_respostas
    ADD CONSTRAINT treinamento_respostas_id_bloco_id_versao_fkey FOREIGN KEY (id_bloco, id_versao) REFERENCES public.treinamento_blocos(id, id_versao);


--
-- Name: treinamento_respostas treinamento_respostas_id_progresso_id_versao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_respostas
    ADD CONSTRAINT treinamento_respostas_id_progresso_id_versao_fkey FOREIGN KEY (id_progresso, id_versao) REFERENCES public.treinamento_progresso(id, id_versao) ON DELETE CASCADE;


--
-- Name: treinamento_versoes treinamento_versoes_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_versoes
    ADD CONSTRAINT treinamento_versoes_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.funcionarios(id);


--
-- Name: treinamento_versoes treinamento_versoes_derivada_de_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_versoes
    ADD CONSTRAINT treinamento_versoes_derivada_de_fkey FOREIGN KEY (derivada_de) REFERENCES public.treinamento_versoes(id);


--
-- Name: treinamento_versoes treinamento_versoes_id_modulo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_versoes
    ADD CONSTRAINT treinamento_versoes_id_modulo_fkey FOREIGN KEY (id_modulo) REFERENCES public.treinamento_modulos(id) ON DELETE RESTRICT;


--
-- Name: treinamento_versoes treinamento_versoes_publicado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treinamento_versoes
    ADD CONSTRAINT treinamento_versoes_publicado_por_fkey FOREIGN KEY (publicado_por) REFERENCES public.funcionarios(id);


--
-- Name: turno_presenca turno_presenca_id_funcionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.turno_presenca
    ADD CONSTRAINT turno_presenca_id_funcionario_fkey FOREIGN KEY (id_funcionario) REFERENCES public.funcionarios(id) ON DELETE RESTRICT;


--
-- Name: atendimento_checklist_itens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.atendimento_checklist_itens ENABLE ROW LEVEL SECURITY;

--
-- Name: atendimento_checklists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.atendimento_checklists ENABLE ROW LEVEL SECURITY;

--
-- Name: atendimento_clientes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.atendimento_clientes ENABLE ROW LEVEL SECURITY;

--
-- Name: atendimento_motivos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.atendimento_motivos ENABLE ROW LEVEL SECURITY;

--
-- Name: atendimentos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.atendimentos ENABLE ROW LEVEL SECURITY;

--
-- Name: atendimentos_legacy_pre_milestone1; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.atendimentos_legacy_pre_milestone1 ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_conclusoes_avulsas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_conclusoes_avulsas ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_config ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_pendencia_resolucoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_pendencia_resolucoes ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_pendencias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_pendencias ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_policy_eventos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_policy_eventos ENABLE ROW LEVEL SECURITY;

--
-- Name: contagem_embalagem_itens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contagem_embalagem_itens ENABLE ROW LEVEL SECURITY;

--
-- Name: contagem_itens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contagem_itens ENABLE ROW LEVEL SECURITY;

--
-- Name: contagens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contagens ENABLE ROW LEVEL SECURITY;

--
-- Name: escala_entradas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.escala_entradas ENABLE ROW LEVEL SECURITY;

--
-- Name: escala_publicacoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.escala_publicacoes ENABLE ROW LEVEL SECURITY;

--
-- Name: escalas_trabalho; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.escalas_trabalho ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_atual; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_atual ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_atual_grupos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_atual_grupos ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_cores_mapeamento; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_cores_mapeamento ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_organizacao_atribuicoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_organizacao_atribuicoes ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_organizacao_rotacao_estado; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_organizacao_rotacao_estado ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_organizacao_sync_falhas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_organizacao_sync_falhas ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_precos_atual; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_precos_atual ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_staging_grupos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_staging_grupos ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_staging_linhas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_staging_linhas ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_staging_precos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_staging_precos ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_sync_execucoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_sync_execucoes ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_termos_busca; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_termos_busca ENABLE ROW LEVEL SECURITY;

--
-- Name: feriados; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;

--
-- Name: funcionarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;

--
-- Name: limpeza_atribuicoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.limpeza_atribuicoes ENABLE ROW LEVEL SECURITY;

--
-- Name: limpeza_cargos_excluidos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.limpeza_cargos_excluidos ENABLE ROW LEVEL SECURITY;

--
-- Name: limpeza_sync_falhas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.limpeza_sync_falhas ENABLE ROW LEVEL SECURITY;

--
-- Name: lista_vez_eventos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lista_vez_eventos ENABLE ROW LEVEL SECURITY;

--
-- Name: lista_vez_fila; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lista_vez_fila ENABLE ROW LEVEL SECURITY;

--
-- Name: loja_horario_excecao; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loja_horario_excecao ENABLE ROW LEVEL SECURITY;

--
-- Name: loja_horario_padrao; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loja_horario_padrao ENABLE ROW LEVEL SECURITY;

--
-- Name: queue_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.queue_log ENABLE ROW LEVEL SECURITY;

--
-- Name: queue_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.queue_status ENABLE ROW LEVEL SECURITY;

--
-- Name: sessoes_funcionario; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessoes_funcionario ENABLE ROW LEVEL SECURITY;

--
-- Name: shift_swaps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shift_swaps ENABLE ROW LEVEL SECURITY;

--
-- Name: termos_aceite; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.termos_aceite ENABLE ROW LEVEL SECURITY;

--
-- Name: treinamento_blocos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.treinamento_blocos ENABLE ROW LEVEL SECURITY;

--
-- Name: treinamento_modulos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.treinamento_modulos ENABLE ROW LEVEL SECURITY;

--
-- Name: treinamento_progresso; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.treinamento_progresso ENABLE ROW LEVEL SECURITY;

--
-- Name: treinamento_respostas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.treinamento_respostas ENABLE ROW LEVEL SECURITY;

--
-- Name: treinamento_versoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.treinamento_versoes ENABLE ROW LEVEL SECURITY;

--
-- Name: turno_presenca; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.turno_presenca ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION abrir_treinamento(p_session_token text, p_id_modulo uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.abrir_treinamento(p_session_token text, p_id_modulo uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.abrir_treinamento(p_session_token text, p_id_modulo uuid) TO anon;


--
-- Name: FUNCTION accept_termo(p_session_token text, p_versao_termo text, p_texto_termo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.accept_termo(p_session_token text, p_versao_termo text, p_texto_termo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accept_termo(p_session_token text, p_versao_termo text, p_texto_termo text) TO anon;


--
-- Name: FUNCTION adicionar_termo_busca_admin(p_session_token text, p_produto text, p_termo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.adicionar_termo_busca_admin(p_session_token text, p_produto text, p_termo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.adicionar_termo_busca_admin(p_session_token text, p_produto text, p_termo text) TO anon;


--
-- Name: FUNCTION avancar_treinamento(p_session_token text, p_id_progresso uuid, p_id_bloco_destino uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.avancar_treinamento(p_session_token text, p_id_progresso uuid, p_id_bloco_destino uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.avancar_treinamento(p_session_token text, p_id_progresso uuid, p_id_bloco_destino uuid) TO anon;


--
-- Name: FUNCTION buscar_produtos_estoque(p_session_token text, p_termo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.buscar_produtos_estoque(p_session_token text, p_termo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.buscar_produtos_estoque(p_session_token text, p_termo text) TO anon;


--
-- Name: FUNCTION cancelar_atendimento_provisorio(p_session_token text, p_id_atendimento uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancelar_atendimento_provisorio(p_session_token text, p_id_atendimento uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancelar_atendimento_provisorio(p_session_token text, p_id_atendimento uuid) TO anon;


--
-- Name: FUNCTION cancelar_contagem_ativa(p_session_token text, p_id_contagem uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancelar_contagem_ativa(p_session_token text, p_id_contagem uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancelar_contagem_ativa(p_session_token text, p_id_contagem uuid) TO anon;


--
-- Name: FUNCTION check_termo_acceptance(p_session_token text, p_versao_termo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_termo_acceptance(p_session_token text, p_versao_termo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_termo_acceptance(p_session_token text, p_versao_termo text) TO anon;


--
-- Name: FUNCTION concluir_atendimento(p_session_token text, p_clientes jsonb, p_checklist jsonb, p_adiar_checklist boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.concluir_atendimento(p_session_token text, p_clientes jsonb, p_checklist jsonb, p_adiar_checklist boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.concluir_atendimento(p_session_token text, p_clientes jsonb, p_checklist jsonb, p_adiar_checklist boolean) TO anon;


--
-- Name: FUNCTION concluir_atendimento_gerencial(p_session_token text, p_id_atendimento uuid, p_clientes jsonb, p_checklist jsonb, p_ignorar_checklist boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.concluir_atendimento_gerencial(p_session_token text, p_id_atendimento uuid, p_clientes jsonb, p_checklist jsonb, p_ignorar_checklist boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.concluir_atendimento_gerencial(p_session_token text, p_id_atendimento uuid, p_clientes jsonb, p_checklist jsonb, p_ignorar_checklist boolean) TO anon;


--
-- Name: FUNCTION concluir_atendimento_pendente(p_session_token text, p_clientes jsonb, p_checklist jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.concluir_atendimento_pendente(p_session_token text, p_clientes jsonb, p_checklist jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.concluir_atendimento_pendente(p_session_token text, p_clientes jsonb, p_checklist jsonb) TO anon;


--
-- Name: FUNCTION concluir_checklist_avulso(p_session_token text, p_checklist jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.concluir_checklist_avulso(p_session_token text, p_checklist jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.concluir_checklist_avulso(p_session_token text, p_checklist jsonb) TO anon;


--
-- Name: FUNCTION concluir_treinamento(p_session_token text, p_id_progresso uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.concluir_treinamento(p_session_token text, p_id_progresso uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.concluir_treinamento(p_session_token text, p_id_progresso uuid) TO anon;


--
-- Name: FUNCTION criar_modulo_treinamento(p_session_token text, p_slug text, p_titulo text, p_resumo text, p_duracao_estimada_min smallint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.criar_modulo_treinamento(p_session_token text, p_slug text, p_titulo text, p_resumo text, p_duracao_estimada_min smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.criar_modulo_treinamento(p_session_token text, p_slug text, p_titulo text, p_resumo text, p_duracao_estimada_min smallint) TO anon;


--
-- Name: FUNCTION criar_rascunho_treinamento(p_session_token text, p_id_modulo uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.criar_rascunho_treinamento(p_session_token text, p_id_modulo uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.criar_rascunho_treinamento(p_session_token text, p_id_modulo uuid) TO anon;


--
-- Name: FUNCTION entrar_lista_da_vez(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.entrar_lista_da_vez(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.entrar_lista_da_vez(p_session_token text) TO anon;


--
-- Name: FUNCTION escala_classificar_turno(p_hora_inicio time without time zone, p_hora_fim time without time zone, p_abertura time without time zone, p_fechamento time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.escala_classificar_turno(p_hora_inicio time without time zone, p_hora_fim time without time zone, p_abertura time without time zone, p_fechamento time without time zone) FROM PUBLIC;


--
-- Name: FUNCTION escala_processar_importacao(p_session_token text, p_mes_referencia date, p_nome_arquivo text, p_funcionarios_planilha text[], p_entradas jsonb, p_publicar boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.escala_processar_importacao(p_session_token text, p_mes_referencia date, p_nome_arquivo text, p_funcionarios_planilha text[], p_entradas jsonb, p_publicar boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.escala_processar_importacao(p_session_token text, p_mes_referencia date, p_nome_arquivo text, p_funcionarios_planilha text[], p_entradas jsonb, p_publicar boolean) TO anon;


--
-- Name: FUNCTION estoque_aplicar_sync(p_sync_id uuid, p_raw_rows integer, p_canonical_rows integer, p_produto_count integer, p_produto_cor_count integer, p_avisos jsonb, p_allow_large_removal boolean, p_override_reason text, p_preco_rows_lidos integer, p_preco_produto_cor_count integer, p_preco_sem_correspondencia integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_aplicar_sync(p_sync_id uuid, p_raw_rows integer, p_canonical_rows integer, p_produto_count integer, p_produto_cor_count integer, p_avisos jsonb, p_allow_large_removal boolean, p_override_reason text, p_preco_rows_lidos integer, p_preco_produto_cor_count integer, p_preco_sem_correspondencia integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estoque_aplicar_sync(p_sync_id uuid, p_raw_rows integer, p_canonical_rows integer, p_produto_count integer, p_produto_cor_count integer, p_avisos jsonb, p_allow_large_removal boolean, p_override_reason text, p_preco_rows_lidos integer, p_preco_produto_cor_count integer, p_preco_sem_correspondencia integer) TO service_role;


--
-- Name: FUNCTION estoque_claim_sync(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_claim_sync() FROM PUBLIC;
GRANT ALL ON FUNCTION public.estoque_claim_sync() TO service_role;


--
-- Name: FUNCTION estoque_freshness_atual(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_freshness_atual() FROM PUBLIC;


--
-- Name: FUNCTION estoque_marcar_erro(p_sync_id uuid, p_mensagem text, p_error_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_marcar_erro(p_sync_id uuid, p_mensagem text, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estoque_marcar_erro(p_sync_id uuid, p_mensagem text, p_error_code text) TO service_role;


--
-- Name: FUNCTION estoque_organizacao_atualizar_progresso(p_session_token text, p_atribuicao_id uuid, p_prateleiras_concluidas smallint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_organizacao_atualizar_progresso(p_session_token text, p_atribuicao_id uuid, p_prateleiras_concluidas smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estoque_organizacao_atualizar_progresso(p_session_token text, p_atribuicao_id uuid, p_prateleiras_concluidas smallint) TO anon;


--
-- Name: FUNCTION estoque_organizacao_concluir_estante(p_session_token text, p_atribuicao_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_organizacao_concluir_estante(p_session_token text, p_atribuicao_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estoque_organizacao_concluir_estante(p_session_token text, p_atribuicao_id uuid) TO anon;


--
-- Name: FUNCTION estoque_organizacao_linhas_semana(p_semana_inicio date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_organizacao_linhas_semana(p_semana_inicio date) FROM PUBLIC;


--
-- Name: FUNCTION estoque_organizacao_semana_inicio(p_data date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_organizacao_semana_inicio(p_data date) FROM PUBLIC;


--
-- Name: FUNCTION estoque_organizacao_sincronizar_datas_afetadas(p_datas date[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_organizacao_sincronizar_datas_afetadas(p_datas date[]) FROM PUBLIC;


--
-- Name: FUNCTION estoque_organizacao_sincronizar_manual(p_session_token text, p_mes date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_organizacao_sincronizar_manual(p_session_token text, p_mes date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estoque_organizacao_sincronizar_manual(p_session_token text, p_mes date) TO anon;


--
-- Name: FUNCTION estoque_organizacao_sincronizar_semana(p_semana_inicio date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_organizacao_sincronizar_semana(p_semana_inicio date) FROM PUBLIC;


--
-- Name: FUNCTION estoque_organizacao_sincronizar_semana_com_registro(p_semana_inicio date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_organizacao_sincronizar_semana_com_registro(p_semana_inicio date) FROM PUBLIC;


--
-- Name: FUNCTION estoque_termos_busca_exigir_gestor(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_termos_busca_exigir_gestor(p_session_token text) FROM PUBLIC;


--
-- Name: FUNCTION estoque_termos_busca_verificar_slot(p_produto text, p_termo_normalizado text, p_ignorar_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_termos_busca_verificar_slot(p_produto text, p_termo_normalizado text, p_ignorar_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION finalizar_contagem(p_session_token text, p_id_contagem uuid, p_itens jsonb, p_observacao text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.finalizar_contagem(p_session_token text, p_id_contagem uuid, p_itens jsonb, p_observacao text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finalizar_contagem(p_session_token text, p_id_contagem uuid, p_itens jsonb, p_observacao text) TO anon;


--
-- Name: FUNCTION get_atendimento_ativo(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_atendimento_ativo(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_atendimento_ativo(p_session_token text) TO anon;


--
-- Name: FUNCTION get_atendimento_resumo_hoje(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_atendimento_resumo_hoje(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_atendimento_resumo_hoje(p_session_token text) TO anon;


--
-- Name: FUNCTION get_checklist_pendencias_count(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_checklist_pendencias_count(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_checklist_pendencias_count(p_session_token text) TO anon;


--
-- Name: FUNCTION get_checklist_policy(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_checklist_policy(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_checklist_policy(p_session_token text) TO anon;


--
-- Name: FUNCTION get_contagem_catalogo(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_contagem_catalogo(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_contagem_catalogo(p_session_token text) TO anon;


--
-- Name: FUNCTION get_contagem_detalhe(p_session_token text, p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_contagem_detalhe(p_session_token text, p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_contagem_detalhe(p_session_token text, p_id uuid) TO anon;


--
-- Name: FUNCTION get_contagem_historico(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_contagem_historico(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_contagem_historico(p_session_token text) TO anon;


--
-- Name: FUNCTION get_contagens_pendentes(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_contagens_pendentes(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_contagens_pendentes(p_session_token text) TO anon;


--
-- Name: FUNCTION get_escala_periodo(p_session_token text, p_data_inicio date, p_data_fim date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_escala_periodo(p_session_token text, p_data_inicio date, p_data_fim date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_escala_periodo(p_session_token text, p_data_inicio date, p_data_fim date) TO anon;


--
-- Name: FUNCTION get_escala_publicacoes_historico(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_escala_publicacoes_historico(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_escala_publicacoes_historico(p_session_token text) TO anon;


--
-- Name: FUNCTION get_estoque_freshness(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_estoque_freshness(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_estoque_freshness(p_session_token text) TO anon;


--
-- Name: FUNCTION get_estoque_organizacao_gerencial_semana(p_session_token text, p_semana_inicio date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_estoque_organizacao_gerencial_semana(p_session_token text, p_semana_inicio date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_estoque_organizacao_gerencial_semana(p_session_token text, p_semana_inicio date) TO anon;


--
-- Name: FUNCTION get_estoque_organizacao_semana(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_estoque_organizacao_semana(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_estoque_organizacao_semana(p_session_token text) TO anon;


--
-- Name: FUNCTION get_estoque_organizacao_sync_pendencias(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_estoque_organizacao_sync_pendencias(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_estoque_organizacao_sync_pendencias(p_session_token text) TO anon;


--
-- Name: FUNCTION get_limpeza_atribuicoes_mes(p_session_token text, p_mes date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_limpeza_atribuicoes_mes(p_session_token text, p_mes date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_limpeza_atribuicoes_mes(p_session_token text, p_mes date) TO anon;


--
-- Name: FUNCTION get_limpeza_dia(p_session_token text, p_data date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_limpeza_dia(p_session_token text, p_data date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_limpeza_dia(p_session_token text, p_data date) TO anon;


--
-- Name: FUNCTION get_limpeza_gerencial_mes(p_session_token text, p_mes date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_limpeza_gerencial_mes(p_session_token text, p_mes date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_limpeza_gerencial_mes(p_session_token text, p_mes date) TO anon;


--
-- Name: FUNCTION get_limpeza_mes(p_session_token text, p_mes date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_limpeza_mes(p_session_token text, p_mes date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_limpeza_mes(p_session_token text, p_mes date) TO anon;


--
-- Name: FUNCTION get_limpeza_sync_pendencias(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_limpeza_sync_pendencias(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_limpeza_sync_pendencias(p_session_token text) TO anon;


--
-- Name: FUNCTION get_lista_vez_estado(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_lista_vez_estado(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_lista_vez_estado(p_session_token text) TO anon;


--
-- Name: FUNCTION get_minha_escala_mes(p_session_token text, p_mes date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_minha_escala_mes(p_session_token text, p_mes date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_minha_escala_mes(p_session_token text, p_mes date) TO anon;


--
-- Name: FUNCTION get_or_start_contagem_ativa(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_or_start_contagem_ativa(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_or_start_contagem_ativa(p_session_token text) TO anon;


--
-- Name: FUNCTION get_produto_estoque_detalhe(p_session_token text, p_produto text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_produto_estoque_detalhe(p_session_token text, p_produto text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_produto_estoque_detalhe(p_session_token text, p_produto text) TO anon;


--
-- Name: FUNCTION get_produto_termos_busca(p_session_token text, p_produto text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_produto_termos_busca(p_session_token text, p_produto text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_produto_termos_busca(p_session_token text, p_produto text) TO anon;


--
-- Name: FUNCTION get_termos_busca_pendentes(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_termos_busca_pendentes(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_termos_busca_pendentes(p_session_token text) TO anon;


--
-- Name: FUNCTION get_termos_busca_permissao(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_termos_busca_permissao(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_termos_busca_permissao(p_session_token text) TO anon;


--
-- Name: FUNCTION get_termos_busca_produto_admin(p_session_token text, p_produto text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_termos_busca_produto_admin(p_session_token text, p_produto text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_termos_busca_produto_admin(p_session_token text, p_produto text) TO anon;


--
-- Name: FUNCTION get_treinamento_versao_admin(p_session_token text, p_id_versao uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_treinamento_versao_admin(p_session_token text, p_id_versao uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_treinamento_versao_admin(p_session_token text, p_id_versao uuid) TO anon;


--
-- Name: FUNCTION get_treinamentos_admin(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_treinamentos_admin(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_treinamentos_admin(p_session_token text) TO anon;


--
-- Name: FUNCTION get_treinamentos_disponiveis(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_treinamentos_disponiveis(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_treinamentos_disponiveis(p_session_token text) TO anon;


--
-- Name: FUNCTION get_turno_presenca_hoje(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_turno_presenca_hoje(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_turno_presenca_hoje(p_session_token text) TO anon;


--
-- Name: FUNCTION get_valid_employee_session_context(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_valid_employee_session_context(p_session_token text) FROM PUBLIC;


--
-- Name: FUNCTION hash_session_token(p_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hash_session_token(p_token text) FROM PUBLIC;


--
-- Name: FUNCTION iniciar_atendimento(p_session_token text, p_confirmar_fora_de_ordem boolean, p_id_funcionario_alvo uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.iniciar_atendimento(p_session_token text, p_confirmar_fora_de_ordem boolean, p_id_funcionario_alvo uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.iniciar_atendimento(p_session_token text, p_confirmar_fora_de_ordem boolean, p_id_funcionario_alvo uuid) TO anon;


--
-- Name: FUNCTION iniciar_fechamento_atendimento(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.iniciar_fechamento_atendimento(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.iniciar_fechamento_atendimento(p_session_token text) TO anon;


--
-- Name: FUNCTION iniciar_fechamento_atendimento_gerencial(p_session_token text, p_id_atendimento uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.iniciar_fechamento_atendimento_gerencial(p_session_token text, p_id_atendimento uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.iniciar_fechamento_atendimento_gerencial(p_session_token text, p_id_atendimento uuid) TO anon;


--
-- Name: FUNCTION issue_employee_session(p_id_funcionario uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.issue_employee_session(p_id_funcionario uuid) FROM PUBLIC;


--
-- Name: FUNCTION limpeza_concluir_atribuicao(p_session_token text, p_atribuicao_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limpeza_concluir_atribuicao(p_session_token text, p_atribuicao_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.limpeza_concluir_atribuicao(p_session_token text, p_atribuicao_id uuid) TO anon;


--
-- Name: FUNCTION limpeza_definir_atribuicao_manual(p_session_token text, p_data date, p_turno text, p_tarefa text, p_funcionario_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limpeza_definir_atribuicao_manual(p_session_token text, p_data date, p_turno text, p_tarefa text, p_funcionario_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.limpeza_definir_atribuicao_manual(p_session_token text, p_data date, p_turno text, p_tarefa text, p_funcionario_id uuid) TO anon;


--
-- Name: FUNCTION limpeza_funcionario_escalado_turno(p_funcionario_id uuid, p_data date, p_turno text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limpeza_funcionario_escalado_turno(p_funcionario_id uuid, p_data date, p_turno text) FROM PUBLIC;


--
-- Name: FUNCTION limpeza_funcionario_regras_automaticas(p_funcionario_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limpeza_funcionario_regras_automaticas(p_funcionario_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION limpeza_proximo_candidato(p_data date, p_turno text, p_tarefa text, p_reservados uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limpeza_proximo_candidato(p_data date, p_turno text, p_tarefa text, p_reservados uuid[]) FROM PUBLIC;


--
-- Name: FUNCTION limpeza_sincronizar_datas_afetadas(p_datas date[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limpeza_sincronizar_datas_afetadas(p_datas date[]) FROM PUBLIC;


--
-- Name: FUNCTION limpeza_sincronizar_dia(p_data date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limpeza_sincronizar_dia(p_data date) FROM PUBLIC;


--
-- Name: FUNCTION limpeza_sincronizar_dia_com_registro(p_data date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limpeza_sincronizar_dia_com_registro(p_data date) FROM PUBLIC;


--
-- Name: FUNCTION limpeza_sincronizar_manual(p_session_token text, p_mes date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limpeza_sincronizar_manual(p_session_token text, p_mes date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.limpeza_sincronizar_manual(p_session_token text, p_mes date) TO anon;


--
-- Name: FUNCTION limpeza_sincronizar_periodo(p_data_inicio date, p_data_fim date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limpeza_sincronizar_periodo(p_data_inicio date, p_data_fim date) FROM PUBLIC;


--
-- Name: FUNCTION list_active_employees(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_active_employees() FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_active_employees() TO anon;
GRANT ALL ON FUNCTION public.list_active_employees() TO authenticated;


--
-- Name: FUNCTION list_atendimento_checklist_itens(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_atendimento_checklist_itens(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_atendimento_checklist_itens(p_session_token text) TO anon;


--
-- Name: FUNCTION list_atendimento_motivos(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_atendimento_motivos(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_atendimento_motivos(p_session_token text) TO anon;


--
-- Name: FUNCTION list_escala_meses_publicados(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_escala_meses_publicados(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_escala_meses_publicados(p_session_token text) TO anon;


--
-- Name: FUNCTION loja_horario_do_dia(p_data date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.loja_horario_do_dia(p_data date) FROM PUBLIC;


--
-- Name: FUNCTION marcar_contagem_revisada(p_session_token text, p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.marcar_contagem_revisada(p_session_token text, p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.marcar_contagem_revisada(p_session_token text, p_id uuid) TO anon;


--
-- Name: FUNCTION moderar_termo_busca(p_session_token text, p_id uuid, p_acao text, p_termo_final text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.moderar_termo_busca(p_session_token text, p_id uuid, p_acao text, p_termo_final text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.moderar_termo_busca(p_session_token text, p_id uuid, p_acao text, p_termo_final text) TO anon;


--
-- Name: FUNCTION publicar_rascunho_treinamento(p_session_token text, p_id_versao uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.publicar_rascunho_treinamento(p_session_token text, p_id_versao uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publicar_rascunho_treinamento(p_session_token text, p_id_versao uuid) TO anon;


--
-- Name: FUNCTION registrar_turno_presenca(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_turno_presenca(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_turno_presenca(p_session_token text) TO anon;


--
-- Name: FUNCTION remover_funcionario_lista_da_vez(p_session_token text, p_id_funcionario_alvo uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remover_funcionario_lista_da_vez(p_session_token text, p_id_funcionario_alvo uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remover_funcionario_lista_da_vez(p_session_token text, p_id_funcionario_alvo uuid) TO anon;


--
-- Name: FUNCTION resolver_checklist_pendencias(p_id_funcionario uuid, p_tipo_resolucao text, p_id_atendimento_checklist uuid, p_id_checklist_avulso uuid, p_versao_resolucao integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resolver_checklist_pendencias(p_id_funcionario uuid, p_tipo_resolucao text, p_id_atendimento_checklist uuid, p_id_checklist_avulso uuid, p_versao_resolucao integer) FROM PUBLIC;


--
-- Name: FUNCTION responder_cenario_treinamento(p_session_token text, p_id_progresso uuid, p_id_bloco uuid, p_id_opcao uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.responder_cenario_treinamento(p_session_token text, p_id_progresso uuid, p_id_bloco uuid, p_id_opcao uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.responder_cenario_treinamento(p_session_token text, p_id_progresso uuid, p_id_bloco uuid, p_id_opcao uuid) TO anon;


--
-- Name: FUNCTION revoke_employee_session(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.revoke_employee_session(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revoke_employee_session(p_session_token text) TO anon;


--
-- Name: FUNCTION sair_lista_da_vez(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sair_lista_da_vez(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sair_lista_da_vez(p_session_token text) TO anon;


--
-- Name: FUNCTION salvar_progresso_contagem(p_session_token text, p_id_contagem uuid, p_itens jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.salvar_progresso_contagem(p_session_token text, p_id_contagem uuid, p_itens jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.salvar_progresso_contagem(p_session_token text, p_id_contagem uuid, p_itens jsonb) TO anon;


--
-- Name: FUNCTION salvar_rascunho_treinamento(p_session_token text, p_id_versao uuid, p_titulo text, p_resumo text, p_duracao_estimada_min smallint, p_blocos jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.salvar_rascunho_treinamento(p_session_token text, p_id_versao uuid, p_titulo text, p_resumo text, p_duracao_estimada_min smallint, p_blocos jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.salvar_rascunho_treinamento(p_session_token text, p_id_versao uuid, p_titulo text, p_resumo text, p_duracao_estimada_min smallint, p_blocos jsonb) TO anon;


--
-- Name: FUNCTION set_checklist_policy(p_session_token text, p_policy text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_checklist_policy(p_session_token text, p_policy text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_checklist_policy(p_session_token text, p_policy text) TO anon;


--
-- Name: FUNCTION sugerir_termo_busca(p_session_token text, p_produto text, p_termo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sugerir_termo_busca(p_session_token text, p_produto text, p_termo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sugerir_termo_busca(p_session_token text, p_produto text, p_termo text) TO anon;


--
-- Name: FUNCTION transicionar_atendimento_pendente(p_id_funcionario uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.transicionar_atendimento_pendente(p_id_funcionario uuid) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_aplicar_blocos(p_id_versao uuid, p_blocos jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_aplicar_blocos(p_id_versao uuid, p_blocos jsonb) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_bloco_comparavel(p_tipo text, p_conteudo jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_bloco_comparavel(p_tipo text, p_conteudo jsonb) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_bloco_conteudo_valido(p_tipo text, p_conteudo jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_bloco_conteudo_valido(p_tipo text, p_conteudo jsonb) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_bloco_erro(p_tipo text, p_conteudo jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_bloco_erro(p_tipo text, p_conteudo jsonb) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_bloco_publico(p_tipo text, p_conteudo jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_bloco_publico(p_tipo text, p_conteudo jsonb) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_exigir_admin(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_exigir_admin(p_session_token text) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_metadados_erro(p_titulo text, p_resumo text, p_duracao_estimada_min smallint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_metadados_erro(p_titulo text, p_resumo text, p_duracao_estimada_min smallint) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_normalizar_blocos(p_blocos jsonb, p_preservar_ids boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_normalizar_blocos(p_blocos jsonb, p_preservar_ids boolean) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_normalizar_ids_opcoes(p_tipo text, p_conteudo jsonb, p_preservar boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_normalizar_ids_opcoes(p_tipo text, p_conteudo jsonb, p_preservar boolean) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_principios_erro(p_principios jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_principios_erro(p_principios jsonb) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_processar_importacao(p_session_token text, p_id_versao uuid, p_payload jsonb, p_aplicar boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_processar_importacao(p_session_token text, p_id_versao uuid, p_payload jsonb, p_aplicar boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.treinamento_processar_importacao(p_session_token text, p_id_versao uuid, p_payload jsonb, p_aplicar boolean) TO anon;


--
-- Name: FUNCTION treinamento_regenerar_ids_opcoes(p_tipo text, p_conteudo jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_regenerar_ids_opcoes(p_tipo text, p_conteudo jsonb) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_validar_bloco(p_tipo text, p_conteudo jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_validar_bloco(p_tipo text, p_conteudo jsonb) FROM PUBLIC;


--
-- Name: FUNCTION treinamento_versao_assinatura(p_id_versao uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.treinamento_versao_assinatura(p_id_versao uuid) FROM PUBLIC;


--
-- Name: FUNCTION verify_pin(p_funcionario_id uuid, p_pin text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.verify_pin(p_funcionario_id uuid, p_pin text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.verify_pin(p_funcionario_id uuid, p_pin text) TO anon;


--
-- Name: FUNCTION voltar_ao_atendimento(p_session_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.voltar_ao_atendimento(p_session_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.voltar_ao_atendimento(p_session_token text) TO anon;


--
-- Name: TABLE atendimento_checklist_itens; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimento_checklist_itens TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimento_checklist_itens TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimento_checklist_itens TO service_role;


--
-- Name: TABLE atendimento_checklists; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimento_checklists TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimento_checklists TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimento_checklists TO service_role;


--
-- Name: TABLE atendimento_clientes; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimento_clientes TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimento_clientes TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimento_clientes TO service_role;


--
-- Name: TABLE atendimento_motivos; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimento_motivos TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimento_motivos TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimento_motivos TO service_role;


--
-- Name: TABLE atendimentos; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimentos TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimentos TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimentos TO service_role;


--
-- Name: TABLE atendimentos_legacy_pre_milestone1; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimentos_legacy_pre_milestone1 TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimentos_legacy_pre_milestone1 TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.atendimentos_legacy_pre_milestone1 TO service_role;


--
-- Name: TABLE checklist_conclusoes_avulsas; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_conclusoes_avulsas TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_conclusoes_avulsas TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_conclusoes_avulsas TO service_role;


--
-- Name: TABLE checklist_config; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_config TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_config TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_config TO service_role;


--
-- Name: TABLE checklist_pendencia_resolucoes; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_pendencia_resolucoes TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_pendencia_resolucoes TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_pendencia_resolucoes TO service_role;


--
-- Name: TABLE checklist_pendencias; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_pendencias TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_pendencias TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_pendencias TO service_role;


--
-- Name: TABLE checklist_policy_eventos; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_policy_eventos TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_policy_eventos TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.checklist_policy_eventos TO service_role;


--
-- Name: TABLE contagem_embalagem_itens; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.contagem_embalagem_itens TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.contagem_embalagem_itens TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.contagem_embalagem_itens TO service_role;


--
-- Name: TABLE contagem_itens; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.contagem_itens TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.contagem_itens TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.contagem_itens TO service_role;


--
-- Name: TABLE contagens; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.contagens TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.contagens TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.contagens TO service_role;


--
-- Name: TABLE escala_entradas; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.escala_entradas TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.escala_entradas TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.escala_entradas TO service_role;


--
-- Name: TABLE escala_publicacoes; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.escala_publicacoes TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.escala_publicacoes TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.escala_publicacoes TO service_role;


--
-- Name: TABLE escalas_trabalho; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.escalas_trabalho TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.escalas_trabalho TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.escalas_trabalho TO service_role;


--
-- Name: TABLE estoque_atual; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_atual TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_atual TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_atual TO service_role;


--
-- Name: TABLE estoque_atual_grupos; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_atual_grupos TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_atual_grupos TO authenticated;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_atual_grupos TO service_role;


--
-- Name: TABLE estoque_cores_mapeamento; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_cores_mapeamento TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_cores_mapeamento TO authenticated;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_cores_mapeamento TO service_role;


--
-- Name: TABLE estoque_precos_atual; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_precos_atual TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_precos_atual TO authenticated;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_precos_atual TO service_role;


--
-- Name: TABLE estoque_staging_grupos; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_staging_grupos TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_staging_grupos TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_staging_grupos TO service_role;


--
-- Name: TABLE estoque_staging_linhas; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_staging_linhas TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_staging_linhas TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_staging_linhas TO service_role;


--
-- Name: TABLE estoque_staging_precos; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_staging_precos TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_staging_precos TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_staging_precos TO service_role;


--
-- Name: TABLE estoque_sync_execucoes; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_sync_execucoes TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_sync_execucoes TO authenticated;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_sync_execucoes TO service_role;


--
-- Name: TABLE estoque_termos_busca; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_termos_busca TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_termos_busca TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.estoque_termos_busca TO service_role;


--
-- Name: TABLE feriados; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.feriados TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.feriados TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.feriados TO service_role;


--
-- Name: TABLE funcionarios; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.funcionarios TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.funcionarios TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.funcionarios TO service_role;


--
-- Name: TABLE lista_vez_eventos; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.lista_vez_eventos TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.lista_vez_eventos TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.lista_vez_eventos TO service_role;


--
-- Name: TABLE lista_vez_fila; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.lista_vez_fila TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.lista_vez_fila TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.lista_vez_fila TO service_role;


--
-- Name: TABLE loja_horario_excecao; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.loja_horario_excecao TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.loja_horario_excecao TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.loja_horario_excecao TO service_role;


--
-- Name: TABLE loja_horario_padrao; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.loja_horario_padrao TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.loja_horario_padrao TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.loja_horario_padrao TO service_role;


--
-- Name: TABLE queue_log; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.queue_log TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.queue_log TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.queue_log TO service_role;


--
-- Name: TABLE queue_status; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.queue_status TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.queue_status TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.queue_status TO service_role;


--
-- Name: TABLE sessoes_funcionario; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.sessoes_funcionario TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.sessoes_funcionario TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.sessoes_funcionario TO service_role;


--
-- Name: TABLE shift_swaps; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.shift_swaps TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.shift_swaps TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.shift_swaps TO service_role;


--
-- Name: TABLE termos_aceite; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.termos_aceite TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.termos_aceite TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.termos_aceite TO service_role;


--
-- Name: TABLE treinamento_blocos; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_blocos TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_blocos TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_blocos TO service_role;


--
-- Name: TABLE treinamento_modulos; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_modulos TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_modulos TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_modulos TO service_role;


--
-- Name: TABLE treinamento_progresso; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_progresso TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_progresso TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_progresso TO service_role;


--
-- Name: TABLE treinamento_respostas; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_respostas TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_respostas TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_respostas TO service_role;


--
-- Name: TABLE treinamento_versoes; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_versoes TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_versoes TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.treinamento_versoes TO service_role;


--
-- Name: TABLE turno_presenca; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.turno_presenca TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.turno_presenca TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.turno_presenca TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

-- [baseline] skipped: supabase_admin default ACL is platform-owned -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
-- [baseline] skipped: supabase_admin default ACL is platform-owned -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
-- [baseline] skipped: supabase_admin default ACL is platform-owned -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
-- [baseline] skipped: supabase_admin default ACL is platform-owned -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

-- [baseline] skipped: supabase_admin default ACL is platform-owned -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
-- [baseline] skipped: supabase_admin default ACL is platform-owned -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
-- [baseline] skipped: supabase_admin default ACL is platform-owned -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
-- [baseline] skipped: supabase_admin default ACL is platform-owned -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

-- [baseline] skipped: supabase_admin default ACL is platform-owned -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
-- [baseline] skipped: supabase_admin default ACL is platform-owned -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
-- [baseline] skipped: supabase_admin default ACL is platform-owned -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
-- [baseline] skipped: supabase_admin default ACL is platform-owned -- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict EnVi85cauDUDc5AsrPQPqcoyMfgx4ue27yVH1YOVV7WqIkby7Ng90ahy8vOA9si

