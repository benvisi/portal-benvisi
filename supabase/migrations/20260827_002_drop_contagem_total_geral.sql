begin;

-- =============================================================================
-- Milestone 4D — product correction: remove the cross-category aggregate
-- "Total geral" from the Contagem de Embalagens review lists.
--
-- Summing heterogeneous packaging items (sacolas + envelopes + seda +
-- etiquetas + de/para + outlet) into one unit count is not operationally
-- meaningful. The pending/history cards now show a plain item count
-- ("14 itens contados") instead. Per-item totals
-- (pacotes_fechados * unidades_por_pacote + unidades_avulsas) are unchanged
-- and still returned by get_contagem_detalhe.
--
-- 20260827_001 is already applied and immutable — this is a new additive
-- migration that redefines the two list RPCs. The return-table shape
-- changes (a column is dropped), so CREATE OR REPLACE cannot be used;
-- DROP + CREATE is safe here because nothing in the database depends on
-- these functions — they are only ever invoked as PostgREST RPCs.
-- =============================================================================

drop function if exists public.get_contagens_pendentes(text);

create function public.get_contagens_pendentes(
  p_session_token text
)
returns table (
  id uuid,
  submetido_por_nome text,
  submetido_em timestamptz,
  observacao text,
  total_itens int
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
      count(ci.id)::int as total_itens
    from public.contagens c
    join public.funcionarios f on f.id = c.submetido_por
    left join public.contagem_itens ci on ci.id_contagem = c.id
    where c.status = 'pendente_revisao'
    group by c.id, f.apelido, f.nome, c.submetido_em, c.observacao
    order by c.submetido_em asc;
end;
$$;

revoke all on function public.get_contagens_pendentes(text) from public;
grant execute on function public.get_contagens_pendentes(text) to anon;

drop function if exists public.get_contagem_historico(text);

create function public.get_contagem_historico(
  p_session_token text
)
returns table (
  id uuid,
  submetido_por_nome text,
  submetido_em timestamptz,
  observacao text,
  revisada_por_nome text,
  revisada_em timestamptz,
  total_itens int
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

revoke all on function public.get_contagem_historico(text) from public;
grant execute on function public.get_contagem_historico(text) to anon;

commit;
