begin;

-- =============================================================================
-- get_lista_vez_estado: add iniciado_em (display only)
--
-- Depends on 20260818_001_add_atendimento_lista_vez.sql — apply that
-- migration first.
--
-- UX request: expose elapsed Atendimento duration on every active
-- employee's Lista da Vez row, sourced from the authoritative server
-- iniciado_em (never a client-supplied value), so the frontend can tick a
-- locally-computed "X min" display between polls instead of re-querying the
-- backend every second. This is a read-only addition to an existing
-- read-only function — no queue/business logic changes. Changing the
-- function's output columns requires DROP + CREATE (not CREATE OR REPLACE,
-- which cannot alter an existing function's return type — same reasoning
-- as verify_pin in 20260722_001_add_employee_sessions_and_verify_pin_token.sql).
-- =============================================================================

drop function public.get_lista_vez_estado(text);

create function public.get_lista_vez_estado(
  p_session_token text
)
returns table (
  id_funcionario uuid,
  nome text,
  em_atendimento boolean,
  ordem int,
  iniciado_em timestamptz
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
      fu.nome::text,
      (not f.disponivel) as em_atendimento,
      case
        when f.disponivel then
          row_number() over (partition by f.disponivel order by f.posicao asc)::int
        else null
      end as ordem,
      a.iniciado_em
    from public.lista_vez_fila f
    join public.funcionarios fu on fu.id = f.id_funcionario
    -- LEFT JOIN (not INNER): disponivel=false should always have exactly one
    -- matching 'ativo' atendimento by construction (iniciar_atendimento sets
    -- both together), but LEFT JOIN degrades to iniciado_em = null instead
    -- of silently dropping the employee from the queue listing if that
    -- invariant were ever violated.
    left join public.atendimentos a
      on a.id_funcionario = f.id_funcionario and a.status = 'ativo'
    where f.dia_manaus = v_dia
    order by f.disponivel desc, f.posicao asc;
end;
$$;

revoke all on function public.get_lista_vez_estado(text) from public;
grant execute on function public.get_lista_vez_estado(text) to anon;

commit;
