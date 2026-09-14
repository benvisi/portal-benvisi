begin;

-- =============================================================================
-- Fixes a bug in 20260912_001: submetido_em kept its original
-- `default now()` from V1, when submetido_por/em were still NOT NULL and
-- always set explicitly by submeter_contagem's single insert. Once
-- submetido_em became nullable to represent "not yet finalized," that
-- leftover default meant a bare insert of an em_andamento row (see
-- get_or_start_contagem_ativa's `insert into contagens (iniciado_por,
-- status) values (...)`) silently stamped submetido_em = now() anyway,
-- immediately violating contagens_check's em_andamento branch (which
-- requires submetido_em is null). Caught during manual RPC verification
-- right after applying 20260912_001, before any real draft was created.
-- =============================================================================

alter table public.contagens alter column submetido_em drop default;

commit;
