begin;

-- =============================================================================
-- Escala Admin upload — publication metadata (V1.1 upload/publish milestone)
--
-- Two nullable, additive columns on escala_publicacoes so a publication
-- created by the new escala_processar_importacao RPC (next migration) can
-- record where it came from and what it replaced, without touching any
-- existing row or the read RPCs. Both are optional because a publication
-- created any other way (e.g. a future manual/product-owner path) is not
-- required to supply them.
-- =============================================================================

alter table public.escala_publicacoes
  add column nome_arquivo text,
  add column publicacao_anterior_id uuid references public.escala_publicacoes(id);

commit;
