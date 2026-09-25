begin;

-- =============================================================================
-- Fix: limpeza_concluir_atribuicao raised "column reference id is ambiguous"
-- on every call. Found during database-backed QA (2026-09-25), not by static
-- review — the bug only manifests at execution time.
--
-- Root cause: `returns table (id uuid, status text, concluido_por_apelido
-- text, concluido_em timestamptz)` implicitly declares a plpgsql variable
-- named `id` in scope for the whole function body. The very first statement,
-- `select * into v_row from public.limpeza_atribuicoes where id =
-- p_atribuicao_id`, then has a bare `id` that Postgres cannot resolve
-- between that OUT-parameter variable and limpeza_atribuicoes.id — every
-- other `id` reference in the function was already qualified
-- (public.limpeza_atribuicoes.id / v_row.id), so this was the only spot.
-- Every other Limpeza RPC was checked for the same RETURNS-TABLE-column-
-- shadowing hazard; none of the others have an unqualified `id` reference.
-- =============================================================================

create or replace function public.limpeza_concluir_atribuicao(
  p_session_token text,
  p_atribuicao_id uuid
)
returns table (
  id uuid,
  status text,
  concluido_por_apelido text,
  concluido_em timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_row record;
  v_is_manager boolean;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_row
  from public.limpeza_atribuicoes
  where public.limpeza_atribuicoes.id = p_atribuicao_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_NAO_ENCONTRADA';
  end if;

  v_is_manager := v_ctx.cargo in ('Gerente', 'Administrador');
  if v_row.funcionario_id is distinct from v_ctx.id_funcionario and not v_is_manager then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_CONCLUIR_LIMPEZA';
  end if;

  if v_row.funcionario_id is null then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_SEM_FUNCIONARIO';
  end if;

  if v_row.status = 'conflito' then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_EM_CONFLITO';
  end if;

  if v_row.status = 'pendente' then
    update public.limpeza_atribuicoes
      set status = 'concluida', concluido_por = v_ctx.id_funcionario, concluido_em = now(),
          atualizado_em = now()
      where public.limpeza_atribuicoes.id = v_row.id;

    select * into v_row from public.limpeza_atribuicoes where public.limpeza_atribuicoes.id = v_row.id;
  end if;

  return query
  select v_row.id, v_row.status, f.apelido::text, v_row.concluido_em
  from public.funcionarios f
  where f.id = v_row.concluido_por;
end;
$$;

revoke all on function public.limpeza_concluir_atribuicao(text, uuid) from public;
grant execute on function public.limpeza_concluir_atribuicao(text, uuid) to anon;

commit;
