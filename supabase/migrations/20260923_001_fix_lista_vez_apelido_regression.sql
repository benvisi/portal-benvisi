begin;

-- =============================================================================
-- Hotfix: Lista da Vez regression — full names shown instead of apelido
--
-- Root cause: 20260922_001_add_atendimento_conclusao_gerencial.sql
-- recreated get_lista_vez_estado from a pre-20260826_003 base to add the
-- 'finalizando' id_atendimento change, and in doing so accidentally
-- reverted the `nome` display column from apelido-first
-- (`coalesce(nullif(btrim(fu.apelido::text), ''), fu.nome::text)`, added in
-- 20260826_003_prefer_apelido_display_name.sql) back to plain `fu.nome`.
--
-- This is the only column feeding both the Lista da Vez roster and the
-- "Concluir atendimento de ..." / "Finalizando em nome de ..." management
-- dialogs (src/routes/atendimento.tsx, src/config/constants.ts), so
-- restoring it here fixes both surfaces with no frontend change.
--
-- Everything else in this definition is byte-for-byte identical to
-- 20260922_001 (including the 'finalizando' id_atendimento behavior, which
-- must be preserved).
-- =============================================================================

create or replace function public.get_lista_vez_estado(
  p_session_token text
)
returns table (
  id_funcionario uuid,
  nome text,
  status text,
  ordem int,
  iniciado_em timestamptz,
  id_atendimento uuid,
  id_funcionario_iniciador uuid,
  prazo_provisorio_em timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
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

revoke all on function public.get_lista_vez_estado(text) from public;
grant execute on function public.get_lista_vez_estado(text) to anon;

commit;
