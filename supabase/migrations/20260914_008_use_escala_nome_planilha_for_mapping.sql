begin;

-- =============================================================================
-- Escala Admin upload — switch employee mapping from apelido to the new
-- dedicated escala_nome_planilha field (see 20260914_007). Everything else
-- about escala_processar_importacao is unchanged from 20260914_005/006.
-- =============================================================================

create or replace function public.escala_processar_importacao(
  p_session_token text,
  p_mes_referencia date,
  p_nome_arquivo text,
  p_funcionarios_planilha text[],
  p_entradas jsonb,
  p_publicar boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- WARNING: an active, non-Administrador employee who HAS a spreadsheet
  -- identity configured, but that identity never appears as a row in the
  -- uploaded sheet at all. An active employee with no escala_nome_planilha
  -- configured yet is excluded here (there is nothing to check them
  -- against) rather than always spuriously flagged as "ausente".
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

  -- WARNING: a mapped employee whose row exists but has zero usable entries
  -- for the whole target month (e.g. Monica-style blank row that IS mapped).
  -- An unmapped blank row is never warned about at all — it is fully ignored,
  -- per product direction.
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

  if p_publicar then
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
$$;

revoke all on function public.escala_processar_importacao(text, date, text, text[], jsonb, boolean) from public;
grant execute on function public.escala_processar_importacao(text, date, text, text[], jsonb, boolean) to anon;

commit;
