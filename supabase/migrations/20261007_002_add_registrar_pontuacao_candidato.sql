-- =============================================================================
-- Trello #10, Slice 4A — secure persistence of AI scoring recommendations.
--
-- The worker (service_role) holds only SELECT/INSERT on
-- produto_imagem_candidatos (Slice 1, deliberate). Instead of granting it
-- table-wide UPDATE — which would also let it rewrite product/colour identity,
-- Lacoste verification, gallery provenance and review status — scoring is
-- persisted through this one narrow SECURITY DEFINER RPC.
--
-- Advisory only: it writes the scoring columns and nothing else. It never
-- changes status, revisado_por/revisado_em, identity, verification or
-- gallery_json, so a human review step remains the only way a candidate can
-- leave 'pendente'.
-- =============================================================================

begin;

create or replace function public.registrar_pontuacao_candidato(
  p_candidato_id uuid,
  p_primary_url text,
  p_primary_reason text,
  p_secondary_url text,
  p_secondary_reason text,
  p_scoring_notes jsonb,
  p_limitacoes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_gallery jsonb;
  v_gallery_urls text[];
begin
  -- Row lock so concurrent scoring of the same candidate serialises.
  select status, gallery_json
    into v_status, v_gallery
    from public.produto_imagem_candidatos
   where id = p_candidato_id
   for update;

  if not found then
    raise exception 'candidato não encontrado' using errcode = 'P0002';
  end if;
  if v_status <> 'pendente' then
    raise exception 'candidato não está pendente (status=%)', v_status using errcode = 'P0001';
  end if;

  if p_primary_url is null and p_secondary_url is not null then
    raise exception 'secundária exige primária' using errcode = '22023';
  end if;
  if p_primary_url is not null and (p_primary_reason is null or pg_catalog.btrim(p_primary_reason) = '') then
    raise exception 'primária exige justificativa' using errcode = '22023';
  end if;
  if p_secondary_url is not null and (p_secondary_reason is null or pg_catalog.btrim(p_secondary_reason) = '') then
    raise exception 'secundária exige justificativa' using errcode = '22023';
  end if;
  if p_secondary_url is not null and p_primary_url = p_secondary_url then
    raise exception 'primária e secundária não podem ser iguais' using errcode = '22023';
  end if;

  -- Stored gallery URLs are protocol-relative ("//host/path"); the worker
  -- sends them as "https://host/path". Compare on the scheme-less form so a
  -- selection must be one of THIS candidate's own gallery entries.
  select coalesce(pg_catalog.array_agg(pg_catalog.regexp_replace(g ->> 'desktopUrl', '^https:', '')), '{}')
    into v_gallery_urls
    from pg_catalog.jsonb_array_elements(v_gallery) g;

  if p_primary_url is not null
     and not (pg_catalog.regexp_replace(p_primary_url, '^https:', '') = any (v_gallery_urls)) then
    raise exception 'URL primária não pertence à galeria do candidato' using errcode = '22023';
  end if;
  if p_secondary_url is not null
     and not (pg_catalog.regexp_replace(p_secondary_url, '^https:', '') = any (v_gallery_urls)) then
    raise exception 'URL secundária não pertence à galeria do candidato' using errcode = '22023';
  end if;

  update public.produto_imagem_candidatos
     set primary_candidate_url     = p_primary_url,
         primary_candidate_reason  = p_primary_reason,
         secondary_candidate_url   = p_secondary_url,
         secondary_candidate_reason = p_secondary_reason,
         scoring_notes             = p_scoring_notes,
         limitacoes                = coalesce(p_limitacoes, '{}')
   where id = p_candidato_id
     and status = 'pendente';
end;
$$;

revoke all on function public.registrar_pontuacao_candidato(uuid, text, text, text, text, jsonb, text[]) from public;
revoke all on function public.registrar_pontuacao_candidato(uuid, text, text, text, text, jsonb, text[]) from anon;
revoke all on function public.registrar_pontuacao_candidato(uuid, text, text, text, text, jsonb, text[]) from authenticated;
grant execute on function public.registrar_pontuacao_candidato(uuid, text, text, text, text, jsonb, text[]) to service_role;

commit;
