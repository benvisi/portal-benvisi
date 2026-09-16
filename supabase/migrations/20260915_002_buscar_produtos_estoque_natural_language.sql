begin;

-- =============================================================================
-- Consulta de Estoque — natural-language search (Termos de busca V1)
--
-- Depends on 20260915_001 (estoque_normalizar_texto, estoque_termos_busca).
--
-- CREATE OR REPLACE with the IDENTICAL signature/return type as 20260911_003,
-- so the Consulta UI keeps calling it unchanged. Result grain stays ONE ROW
-- PER PRODUTO (reference); a colour or term hit makes the whole reference
-- eligible, and the detail view then shows the full matrix as before.
--
-- Matching, in ranking order:
--   1. exact reference     — hyphen-insensitive (CH2668-23 == CH266823)
--   2. reference prefix    — hyphen-insensitive
--   3. natural language    — the query is normalised (lower, accents folded,
--      whitespace collapsed) and split into tokens; a small Portuguese
--      stop-word list is dropped; EVERY remaining token must match the START
--      OF A WORD (\m) somewhere in the reference's combined searchable text,
--      in any order, across any field:
--        produto, desc_produto, tipo_produto, linha,
--        cor_nome_portal + cor_familia of every colour in stock,
--        every APPROVED termo de busca.
--      Gender variants: a token of 4+ chars ending in "a" or "o" is compared
--      with that final vowel removed (feminina / feminino -> feminin,
--      masculina / masculino -> masculin, preta / preto -> pret). Because
--      matching is word-PREFIX, that single rule makes either gender form
--      find either spelling. Deliberately narrow: no plural handling, no
--      synonyms, no stemming beyond this one vowel.
-- No LIKE/regex metacharacters from user input ever reach the pattern:
-- the reference tiers use equality/left(), and tokens are reduced to
-- [a-z0-9-] before being used as a \m-anchored regex.
-- No fuzzy/typo matching, no pg_trgm, no synonyms — the dataset (~600
-- references) makes a per-call aggregate + regex scan trivially cheap.
-- =============================================================================

create or replace function public.buscar_produtos_estoque(
  p_session_token text,
  p_termo text
)
returns table (
  produto text,
  desc_produto text,
  tipo_produto text,
  linha text,
  cores_disponiveis integer,
  unidades_total bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
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
$$;

revoke all on function public.buscar_produtos_estoque(text, text) from public;
grant execute on function public.buscar_produtos_estoque(text, text) to anon;

commit;
