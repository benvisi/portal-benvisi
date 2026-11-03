-- Product image publication: bounded retries with backoff (Trello #10).
--
-- Before: a failed publication stayed `pendente` and was retried on every
-- worker run, forever. After: each failure schedules the next attempt later
-- (backoff) and the 5th consecutive failure marks the publication as
-- permanently failed, so it stops being retried and can be found for manual
-- intervention. The approval itself is untouched: the candidate stays
-- `aprovado` and the publication row keeps its last error.
--
-- Design notes
--   * `status` is NOT extended. A permanently failed publication stays
--     `pendente` (so the partial unique index still holds the produto/cor slot
--     and the approved candidate cannot be approved a second time); it is
--     marked by `falha_permanente_em` and excluded from the worker queue.
--   * Backoff after failure n (n = 1..4): 15 min, 60 min, 240 min, 360 min.
--     Failure 5 is permanent.
--   * Interrupted runs (crash, timeout, kill) never reach
--     registrar_falha_publicacao_imagem, so they cost no attempt.
--   * Operator tools: reenfileirar_publicacao_imagem (service_role) clears the
--     counters of a failed publication so the worker picks it up again.
--     Diagnose with the query in scripts/sync-produto-imagens/README.md.
--
-- Not applied to production by this change; apply only after review.

begin;

alter table public.produto_imagem_publicacoes
  add column proxima_tentativa_em timestamptz,
  add column falha_permanente_em timestamptz;

-- Worker queue: skip permanently failed rows and rows still backing off.
create or replace function public.listar_publicacoes_imagem_pendentes(p_limite integer default 5)
returns table (
  publicacao_id uuid,
  candidato_id uuid,
  produto text,
  cor_codigo text,
  tentativas integer,
  arquivos jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 20 then
    raise exception using errcode = 'P0001', message = 'LIMITE_INVALIDO';
  end if;

  return query
  select p.id, p.candidato_id, p.produto, p.cor_codigo, p.tentativas,
         (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'arquivo_id', a.id,
                   'slot', a.slot,
                   'source_url', a.source_url,
                   'storage_path', a.storage_path,
                   'content_sha256', a.content_sha256) order by a.slot)
            from public.produto_imagem_publicacao_arquivos a
           where a.publicacao_id = p.id)
    from public.produto_imagem_publicacoes p
    join public.produto_imagem_candidatos c on c.id = p.candidato_id
   where p.status = 'pendente'
     and c.status = 'aprovado'
     and p.falha_permanente_em is null
     and (p.proxima_tentativa_em is null or p.proxima_tentativa_em <= pg_catalog.now())
   order by p.criado_em
   limit p_limite;
end;
$$;

-- Records a failed attempt, schedules the next one, or gives up after 5.
create or replace function public.registrar_falha_publicacao_imagem(p_publicacao_id uuid, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.produto_imagem_publicacoes
     set tentativas = tentativas + 1,
         ultimo_erro = pg_catalog.left(coalesce(p_erro, 'erro desconhecido'), 500),
         ultimo_erro_em = pg_catalog.now(),
         falha_permanente_em = case
           when tentativas + 1 >= 5 then pg_catalog.now()
           else null
         end,
         proxima_tentativa_em = case
           when tentativas + 1 >= 5 then null
           else pg_catalog.now() + pg_catalog.make_interval(
                  mins => least(15 * pg_catalog.power(4, tentativas), 360)::integer)
         end
   where id = p_publicacao_id
     and status = 'pendente'
     and falha_permanente_em is null;
end;
$$;

-- Manual intervention: put a failed (or backing-off) publication back in the
-- queue with a fresh attempt budget. The last error is kept for diagnosis.
create or replace function public.reenfileirar_publicacao_imagem(p_publicacao_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select p.status into v_status
    from public.produto_imagem_publicacoes p where p.id = p_publicacao_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PUBLICACAO_NAO_ENCONTRADA';
  end if;
  if v_status <> 'pendente' then
    raise exception using errcode = 'P0001', message = 'PUBLICACAO_NAO_PENDENTE';
  end if;

  update public.produto_imagem_publicacoes
     set tentativas = 0,
         falha_permanente_em = null,
         proxima_tentativa_em = null
   where id = p_publicacao_id;
end;
$$;

revoke all on function public.reenfileirar_publicacao_imagem(uuid) from public, anon, authenticated;
grant execute on function public.reenfileirar_publicacao_imagem(uuid) to service_role;

commit;
