begin;

-- -----------------------------------------------------------------------------
-- cancelar_contagem_ativa — any authenticated employee. Lets an in-progress
-- draft be abandoned outright (e.g. started by mistake, or counted against
-- the wrong period) rather than left to sit forever as the one active count
-- blocking a fresh start.
--
-- Only ever deletes a row still in em_andamento (`where ... and status =
-- 'em_andamento'` on the DELETE itself, not a separate check-then-delete) —
-- a finalized (pendente_revisao) or reviewed (revisada) count can never be
-- reached through this RPC, matching this project's rule that management
-- correction/reopen of a finalized count stays future work, not this. The
-- `on delete cascade` from contagem_itens (20260827_001) removes any
-- autosaved item rows for free.
-- -----------------------------------------------------------------------------
create function public.cancelar_contagem_ativa(
  p_session_token text,
  p_id_contagem uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  delete from public.contagens
  where id = p_id_contagem and status = 'em_andamento';

  if not found then
    raise exception using errcode = 'P0001', message = 'CONTAGEM_NAO_ATIVA';
  end if;

  return true;
end;
$$;

revoke all on function public.cancelar_contagem_ativa(text, uuid) from public;
grant execute on function public.cancelar_contagem_ativa(text, uuid) to anon;

commit;
