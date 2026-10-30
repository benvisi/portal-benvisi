-- =============================================================================
-- Trello #10, Slice 4B — human approval and publication of product images.
--
-- Three separate stages, three separate actors:
--   1. AI scoring (worker, service_role, Slice 4A) — advisory columns only.
--   2. Human approval/rejection (employee session token + the explicit
--      funcionarios.pode_gerenciar_imagens_produto capability). The reviewer's
--      identity comes ONLY from the validated session; nothing in
--      scoring_notes (including "human_reviewed") is ever read as
--      authorization.
--   3. Publication (worker, service_role) — uploads the approved files to the
--      public bucket produto-imagens-publicadas and activates them atomically.
--
-- Access model is unchanged: RLS on, zero policies, no table grants to
-- anon/authenticated/service_role. Browser RPCs are granted to anon only
-- (the Portal's PIN/session model, same as moderar_termo_busca); worker RPCs
-- to service_role only.
--
-- Storage paths are immutable and unique per publication:
--   {produto}/{cor_codigo}/{publicacao_id}/{principal|secundaria}.webp
-- A replacement is a new publication with new paths, so an already-published
-- file is never overwritten. Superseded/revoked files stay in the bucket for
-- manual cleanup (~30 days); their rows keep the full history.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Candidate: the human's final selection, kept separate from the AI
-- recommendation (primary/secondary_candidate_*), which stays untouched for
-- audit. An approved candidate always has a final primary.
-- -----------------------------------------------------------------------------
alter table public.produto_imagem_candidatos
  add column final_primary_url text,
  add column final_secondary_url text,
  add column revisao_observacao text;

alter table public.produto_imagem_candidatos
  add constraint produto_imagem_candidatos_final_check check (
    ((status = 'aprovado') = (final_primary_url is not null))
    and (final_secondary_url is null or final_primary_url is not null)
    and (final_secondary_url is null or final_secondary_url <> final_primary_url)
  );

-- -----------------------------------------------------------------------------
-- Publications: one row per approved candidate (the complete image set).
--   pendente    approved, files not yet all uploaded/activated (retryable)
--   ativa       visible to Consulta; at most one per (produto, cor_codigo)
--   substituida replaced by a newer activation (history)
--   revogada    withdrawn by an authorized employee (history)
--   cancelada   superseded by a newer approval before it was ever activated
-- -----------------------------------------------------------------------------
create table public.produto_imagem_publicacoes (
  id uuid primary key default gen_random_uuid(),
  candidato_id uuid not null unique references public.produto_imagem_candidatos(id),
  produto text not null,
  cor_codigo text not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'ativa', 'substituida', 'revogada', 'cancelada')),
  tentativas integer not null default 0,
  ultimo_erro text,
  ultimo_erro_em timestamptz,
  criado_em timestamptz not null default now(),
  publicado_em timestamptz,
  encerrado_em timestamptz,
  substituida_por uuid references public.produto_imagem_publicacoes(id),
  revogado_por uuid references public.funcionarios(id),
  motivo_encerramento text,

  check (status <> 'ativa' or publicado_em is not null),
  check ((status in ('pendente', 'ativa')) = (encerrado_em is null)),
  check ((status = 'substituida') = (substituida_por is not null)),
  check ((status = 'revogada') = (revogado_por is not null))
);

alter table public.produto_imagem_publicacoes enable row level security;

create unique index produto_imagem_publicacoes_ativa_uidx
  on public.produto_imagem_publicacoes (produto, cor_codigo)
  where status = 'ativa';

create unique index produto_imagem_publicacoes_pendente_uidx
  on public.produto_imagem_publicacoes (produto, cor_codigo)
  where status = 'pendente';

-- One row per slot. Upload metadata is all-or-nothing: a row is either not
-- yet recorded or fully recorded with both hashes.
create table public.produto_imagem_publicacao_arquivos (
  id uuid primary key default gen_random_uuid(),
  publicacao_id uuid not null references public.produto_imagem_publicacoes(id),
  slot text not null check (slot in ('principal', 'secundaria')),
  source_url text not null,
  storage_path text not null unique,
  source_sha256 text,
  content_sha256 text,
  bytes integer,
  width integer,
  height integer,
  enviado_em timestamptz,

  unique (publicacao_id, slot),
  check (
    (enviado_em is null and source_sha256 is null and content_sha256 is null
      and bytes is null and width is null and height is null)
    or
    (enviado_em is not null
      and source_sha256 ~ '^[0-9a-f]{64}$'
      and content_sha256 ~ '^[0-9a-f]{64}$'
      and bytes between 1 and 2097152
      and width between 1 and 1200
      and height between 1 and 1200)
  )
);

alter table public.produto_imagem_publicacao_arquivos enable row level security;

create index produto_imagem_publicacao_arquivos_pub_idx
  on public.produto_imagem_publicacao_arquivos (publicacao_id);

revoke all on public.produto_imagem_publicacoes from public, anon, authenticated, service_role;
revoke all on public.produto_imagem_publicacao_arquivos from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Internal helpers (not executable by any API role).
-- -----------------------------------------------------------------------------

-- Session -> employee id, requiring the image-management capability. Mirrors
-- estoque_termos_busca_exigir_gestor.
create or replace function public.produto_imagens_exigir_gestor(p_session_token text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx record;
  v_pode boolean;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select f.pode_gerenciar_imagens_produto into v_pode
    from public.funcionarios f
   where f.id = v_ctx.id_funcionario;

  if not coalesce(v_pode, false) then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_IMAGENS_PRODUTO';
  end if;

  return v_ctx.id_funcionario;
end;
$$;

-- Resolves a gallery index to its https URL, or raises. Only gallery
-- entries of type "image" on a lacoste.com host are eligible. Negative
-- indices are rejected explicitly (jsonb `->` would count from the end).
create or replace function public.produto_imagem_url_galeria(p_galeria jsonb, p_indice integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_raw text;
begin
  if p_indice is null or p_indice < 0 or pg_catalog.jsonb_typeof(p_galeria) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INDICE_INVALIDO';
  end if;

  v_item := p_galeria -> p_indice;
  if v_item is null or pg_catalog.jsonb_typeof(v_item) <> 'object' then
    raise exception using errcode = 'P0001', message = 'INDICE_INVALIDO';
  end if;
  if (v_item ->> 'type') is distinct from 'image' then
    raise exception using errcode = 'P0001', message = 'IMAGEM_NAO_ELEGIVEL';
  end if;

  v_raw := v_item ->> 'desktopUrl';
  if v_raw is null or v_raw !~* '^(https:)?//([a-z0-9-]+\.)*lacoste\.com/[^@[:space:]]+$' then
    raise exception using errcode = 'P0001', message = 'URL_NAO_PERMITIDA';
  end if;

  return 'https:' || pg_catalog.regexp_replace(v_raw, '^https:', '');
end;
$$;

-- Serialises approval/activation/revocation per (produto, cor_codigo).
create or replace function public.produto_imagem_lock(p_produto text, p_cor_codigo text)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('produto_imagem:' || p_produto || ':' || p_cor_codigo, 0));
$$;

-- True when the AI evaluation for that gallery index flags a person or a
-- non-product-only image. Advisory input only: it adds friction (explicit
-- confirmation + note), it never grants anything.
create or replace function public.produto_imagem_ia_sinaliza(p_scoring_notes jsonb, p_indice integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_or(
           (e ->> 'has_person') = 'true' or (e ->> 'product_only_still') = 'false'), false)
    from pg_catalog.jsonb_array_elements(
           case when pg_catalog.jsonb_typeof(p_scoring_notes -> 'images') = 'array'
                then p_scoring_notes -> 'images' else '[]'::jsonb end) e
   where (e ->> 'index') = p_indice::text;
$$;

revoke all on function public.produto_imagens_exigir_gestor(text) from public, anon, authenticated, service_role;
revoke all on function public.produto_imagem_url_galeria(jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.produto_imagem_lock(text, text) from public, anon, authenticated, service_role;
revoke all on function public.produto_imagem_ia_sinaliza(jsonb, integer) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Browser RPCs (anon + session token).
-- -----------------------------------------------------------------------------

create or replace function public.get_produto_imagens_permissao(p_session_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx record;
  v_pode boolean;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select f.pode_gerenciar_imagens_produto into v_pode
    from public.funcionarios f
   where f.id = v_ctx.id_funcionario;

  return coalesce(v_pode, false);
end;
$$;

-- Review queue for the (future) admin page. Gallery URLs are Lacoste CDN
-- URLs the reviewer's browser loads directly; nothing unapproved is stored
-- or served by the Portal.
create or replace function public.get_candidatos_imagem_pendentes(p_session_token text)
returns table (
  id uuid,
  produto text,
  cor_codigo text,
  lacoste_product_name text,
  lacoste_color_label text,
  resolved_url text,
  galeria jsonb,
  primary_candidate_url text,
  primary_candidate_reason text,
  secondary_candidate_url text,
  secondary_candidate_reason text,
  confianca text,
  avaliacoes_ia jsonb,
  limitacoes text[],
  criado_em timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.produto_imagens_exigir_gestor(p_session_token);

  return query
  select c.id, c.produto, c.cor_codigo, c.lacoste_product_name, c.lacoste_color_label,
         c.resolved_url, c.gallery_json,
         c.primary_candidate_url, c.primary_candidate_reason,
         c.secondary_candidate_url, c.secondary_candidate_reason,
         c.scoring_notes ->> 'confidence',
         c.scoring_notes -> 'images',
         c.limitacoes, c.criado_em
    from public.produto_imagem_candidatos c
   where c.status = 'pendente'
   order by c.criado_em, c.produto, c.cor_codigo;
end;
$$;

-- Formal approval. The reviewer picks gallery indices (may differ from the
-- AI recommendation). Selecting an image the AI flagged (person / not
-- product-only) requires p_confirmar_divergencia = true and a note.
-- Returns the new publication id.
create or replace function public.aprovar_candidato_imagem(
  p_session_token text,
  p_candidato_id uuid,
  p_indice_principal integer,
  p_indice_secundaria integer default null,
  p_observacao text default null,
  p_confirmar_divergencia boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gestor uuid;
  v_produto text;
  v_cor text;
  v_c public.produto_imagem_candidatos%rowtype;
  v_url_p text;
  v_url_s text;
  v_obs text := nullif(pg_catalog.btrim(p_observacao), '');
  v_pub uuid := pg_catalog.gen_random_uuid();
begin
  v_gestor := public.produto_imagens_exigir_gestor(p_session_token);

  select c.produto, c.cor_codigo into v_produto, v_cor
    from public.produto_imagem_candidatos c where c.id = p_candidato_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'CANDIDATO_NAO_ENCONTRADO';
  end if;

  perform public.produto_imagem_lock(v_produto, v_cor);

  select * into v_c from public.produto_imagem_candidatos c where c.id = p_candidato_id for update;
  if v_c.status <> 'pendente' then
    raise exception using errcode = 'P0001', message = 'TRANSICAO_INVALIDA';
  end if;

  -- Exact product/colour identity, as verified against Lacoste at acquisition.
  if v_c.verification_ok is not true
     or v_c.lacoste_pid is distinct from v_c.produto
     or v_c.lacoste_color_id is distinct from v_c.cor_codigo then
    raise exception using errcode = 'P0001', message = 'IDENTIDADE_NAO_VERIFICADA';
  end if;
  -- Identity values become storage path segments.
  if v_c.produto !~ '^[A-Za-z0-9-]+$' or v_c.cor_codigo !~ '^[A-Za-z0-9-]+$' then
    raise exception using errcode = 'P0001', message = 'IDENTIDADE_INVALIDA';
  end if;

  v_url_p := public.produto_imagem_url_galeria(v_c.gallery_json, p_indice_principal);
  if p_indice_secundaria is not null then
    if p_indice_secundaria = p_indice_principal then
      raise exception using errcode = 'P0001', message = 'INDICE_INVALIDO';
    end if;
    v_url_s := public.produto_imagem_url_galeria(v_c.gallery_json, p_indice_secundaria);
    if v_url_s = v_url_p then
      raise exception using errcode = 'P0001', message = 'INDICE_INVALIDO';
    end if;
  end if;

  if (public.produto_imagem_ia_sinaliza(v_c.scoring_notes, p_indice_principal)
      or (p_indice_secundaria is not null
          and public.produto_imagem_ia_sinaliza(v_c.scoring_notes, p_indice_secundaria)))
     and (p_confirmar_divergencia is not true or v_obs is null) then
    raise exception using errcode = 'P0001', message = 'DIVERGENCIA_IA_NAO_CONFIRMADA';
  end if;

  update public.produto_imagem_candidatos
     set status = 'aprovado',
         revisado_por = v_gestor,
         revisado_em = pg_catalog.now(),
         final_primary_url = v_url_p,
         final_secondary_url = v_url_s,
         revisao_observacao = v_obs
   where id = v_c.id;

  -- A newer approval supersedes a publication that never went live.
  update public.produto_imagem_publicacoes
     set status = 'cancelada',
         encerrado_em = pg_catalog.now(),
         motivo_encerramento = 'Substituída por nova aprovação antes da publicação'
   where produto = v_c.produto and cor_codigo = v_c.cor_codigo and status = 'pendente';

  insert into public.produto_imagem_publicacoes (id, candidato_id, produto, cor_codigo)
  values (v_pub, v_c.id, v_c.produto, v_c.cor_codigo);

  insert into public.produto_imagem_publicacao_arquivos (publicacao_id, slot, source_url, storage_path)
  values (v_pub, 'principal', v_url_p,
          v_c.produto || '/' || v_c.cor_codigo || '/' || v_pub::text || '/principal.webp');

  if v_url_s is not null then
    insert into public.produto_imagem_publicacao_arquivos (publicacao_id, slot, source_url, storage_path)
    values (v_pub, 'secundaria', v_url_s,
            v_c.produto || '/' || v_c.cor_codigo || '/' || v_pub::text || '/secundaria.webp');
  end if;

  return v_pub;
end;
$$;

create or replace function public.rejeitar_candidato_imagem(
  p_session_token text,
  p_candidato_id uuid,
  p_observacao text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gestor uuid;
  v_status text;
  v_obs text := nullif(pg_catalog.btrim(p_observacao), '');
begin
  v_gestor := public.produto_imagens_exigir_gestor(p_session_token);

  if v_obs is null then
    raise exception using errcode = 'P0001', message = 'OBSERVACAO_OBRIGATORIA';
  end if;

  select c.status into v_status
    from public.produto_imagem_candidatos c where c.id = p_candidato_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CANDIDATO_NAO_ENCONTRADO';
  end if;
  if v_status <> 'pendente' then
    raise exception using errcode = 'P0001', message = 'TRANSICAO_INVALIDA';
  end if;

  update public.produto_imagem_candidatos
     set status = 'rejeitado',
         revisado_por = v_gestor,
         revisado_em = pg_catalog.now(),
         revisao_observacao = v_obs
   where id = p_candidato_id;
end;
$$;

-- Withdraws an active (or not-yet-activated) publication. Consulta stops
-- showing it immediately; the files stay in the bucket for manual cleanup.
create or replace function public.revogar_publicacao_imagem(
  p_session_token text,
  p_publicacao_id uuid,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gestor uuid;
  v_produto text;
  v_cor text;
  v_status text;
  v_motivo text := nullif(pg_catalog.btrim(p_motivo), '');
begin
  v_gestor := public.produto_imagens_exigir_gestor(p_session_token);

  if v_motivo is null then
    raise exception using errcode = 'P0001', message = 'MOTIVO_OBRIGATORIO';
  end if;

  select p.produto, p.cor_codigo into v_produto, v_cor
    from public.produto_imagem_publicacoes p where p.id = p_publicacao_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PUBLICACAO_NAO_ENCONTRADA';
  end if;

  perform public.produto_imagem_lock(v_produto, v_cor);

  select p.status into v_status
    from public.produto_imagem_publicacoes p where p.id = p_publicacao_id for update;
  if v_status not in ('ativa', 'pendente') then
    raise exception using errcode = 'P0001', message = 'TRANSICAO_INVALIDA';
  end if;

  update public.produto_imagem_publicacoes
     set status = 'revogada',
         revogado_por = v_gestor,
         encerrado_em = pg_catalog.now(),
         motivo_encerramento = v_motivo
   where id = p_publicacao_id;
end;
$$;

-- Consulta read path: only ACTIVE publications, for any valid employee
-- session. Never touches candidates, so pending/rejected images cannot leak.
-- The browser builds the public URL from storage_path with the publishable key.
create or replace function public.get_produto_imagens_publicadas(p_session_token text, p_produto text)
returns table (
  cor_codigo text,
  slot text,
  storage_path text,
  width integer,
  height integer,
  publicado_em timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx record;
  v_produto text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_produto := pg_catalog.upper(pg_catalog.btrim(coalesce(p_produto, '')));
  if pg_catalog.length(v_produto) = 0 then
    return;
  end if;

  return query
  select p.cor_codigo, a.slot, a.storage_path, a.width, a.height, p.publicado_em
    from public.produto_imagem_publicacoes p
    join public.produto_imagem_publicacao_arquivos a on a.publicacao_id = p.id
   where p.produto = v_produto
     and p.status = 'ativa'
   order by p.cor_codigo, a.slot;
end;
$$;

-- -----------------------------------------------------------------------------
-- Worker RPCs (service_role only).
-- -----------------------------------------------------------------------------

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
   order by p.criado_em
   limit p_limite;
end;
$$;

-- Records one uploaded file. Idempotent for the same content; a different
-- content hash for an already-recorded file is refused (never overwritten).
create or replace function public.registrar_envio_arquivo_publicacao(
  p_arquivo_id uuid,
  p_source_sha256 text,
  p_content_sha256 text,
  p_bytes integer,
  p_width integer,
  p_height integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.produto_imagem_publicacao_arquivos%rowtype;
  v_status text;
begin
  select * into v_a from public.produto_imagem_publicacao_arquivos a where a.id = p_arquivo_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ARQUIVO_NAO_ENCONTRADO';
  end if;

  select p.status into v_status from public.produto_imagem_publicacoes p where p.id = v_a.publicacao_id;
  if v_status <> 'pendente' then
    raise exception using errcode = 'P0001', message = 'PUBLICACAO_NAO_PENDENTE';
  end if;

  if v_a.enviado_em is not null then
    if v_a.content_sha256 = p_content_sha256 then
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'ARQUIVO_DIVERGENTE';
  end if;

  -- Format/range validation is enforced by the table check constraint.
  update public.produto_imagem_publicacao_arquivos
     set source_sha256 = p_source_sha256,
         content_sha256 = p_content_sha256,
         bytes = p_bytes,
         width = p_width,
         height = p_height,
         enviado_em = pg_catalog.now()
   where id = p_arquivo_id;
end;
$$;

-- Atomically makes the complete set live and supersedes the previous one.
-- Re-calling on an already-active publication is a no-op (safe retry).
create or replace function public.ativar_publicacao_imagem(p_publicacao_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_produto text;
  v_cor text;
  v_status text;
  v_candidato_id uuid;
begin
  select p.produto, p.cor_codigo into v_produto, v_cor
    from public.produto_imagem_publicacoes p where p.id = p_publicacao_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PUBLICACAO_NAO_ENCONTRADA';
  end if;

  perform public.produto_imagem_lock(v_produto, v_cor);

  select p.status, p.candidato_id into v_status, v_candidato_id
    from public.produto_imagem_publicacoes p where p.id = p_publicacao_id for update;
  if v_status = 'ativa' then
    return;
  end if;
  if v_status <> 'pendente' then
    raise exception using errcode = 'P0001', message = 'PUBLICACAO_NAO_PENDENTE';
  end if;

  if not exists (select 1 from public.produto_imagem_candidatos c
                  where c.id = v_candidato_id and c.status = 'aprovado') then
    raise exception using errcode = 'P0001', message = 'CANDIDATO_NAO_APROVADO';
  end if;

  if not exists (select 1 from public.produto_imagem_publicacao_arquivos a
                  where a.publicacao_id = p_publicacao_id and a.slot = 'principal')
     or exists (select 1 from public.produto_imagem_publicacao_arquivos a
                 where a.publicacao_id = p_publicacao_id and a.enviado_em is null) then
    raise exception using errcode = 'P0001', message = 'ARQUIVOS_INCOMPLETOS';
  end if;

  update public.produto_imagem_publicacoes
     set status = 'substituida',
         substituida_por = p_publicacao_id,
         encerrado_em = pg_catalog.now(),
         motivo_encerramento = 'Substituída por nova publicação'
   where produto = v_produto and cor_codigo = v_cor and status = 'ativa';

  update public.produto_imagem_publicacoes
     set status = 'ativa',
         publicado_em = pg_catalog.now(),
         ultimo_erro = null,
         ultimo_erro_em = null
   where id = p_publicacao_id;
end;
$$;

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
         ultimo_erro_em = pg_catalog.now()
   where id = p_publicacao_id
     and status = 'pendente';
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants.
-- -----------------------------------------------------------------------------
revoke all on function public.get_produto_imagens_permissao(text) from public, authenticated, service_role;
revoke all on function public.get_candidatos_imagem_pendentes(text) from public, authenticated, service_role;
revoke all on function public.aprovar_candidato_imagem(text, uuid, integer, integer, text, boolean) from public, authenticated, service_role;
revoke all on function public.rejeitar_candidato_imagem(text, uuid, text) from public, authenticated, service_role;
revoke all on function public.revogar_publicacao_imagem(text, uuid, text) from public, authenticated, service_role;
revoke all on function public.get_produto_imagens_publicadas(text, text) from public, authenticated, service_role;
grant execute on function public.get_produto_imagens_permissao(text) to anon;
grant execute on function public.get_candidatos_imagem_pendentes(text) to anon;
grant execute on function public.aprovar_candidato_imagem(text, uuid, integer, integer, text, boolean) to anon;
grant execute on function public.rejeitar_candidato_imagem(text, uuid, text) to anon;
grant execute on function public.revogar_publicacao_imagem(text, uuid, text) to anon;
grant execute on function public.get_produto_imagens_publicadas(text, text) to anon;

revoke all on function public.listar_publicacoes_imagem_pendentes(integer) from public, anon, authenticated;
revoke all on function public.registrar_envio_arquivo_publicacao(uuid, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.ativar_publicacao_imagem(uuid) from public, anon, authenticated;
revoke all on function public.registrar_falha_publicacao_imagem(uuid, text) from public, anon, authenticated;
grant execute on function public.listar_publicacoes_imagem_pendentes(integer) to service_role;
grant execute on function public.registrar_envio_arquivo_publicacao(uuid, text, text, integer, integer, integer) to service_role;
grant execute on function public.ativar_publicacao_imagem(uuid) to service_role;
grant execute on function public.registrar_falha_publicacao_imagem(uuid, text) to service_role;

commit;
