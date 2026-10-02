begin;

-- =============================================================================
-- Salesperson Metrics Portal V1 — Slice A — write path for the on-prem sync.
--
-- public.vendas_diarias_substituir_dia(p_codigo_filial, p_data_venda, p_linhas)
-- replaces the ENTIRE set of rows for one (codigo_filial, data_venda) in a
-- single statement/transaction: delete whatever is currently stored for that
-- day, then insert exactly the rows the caller just computed from Linx.
--
-- Full-day replacement (not a per-funcionario upsert) is what makes reruns
-- idempotent even when attribution changes between runs — e.g. a late
-- cancellation or a correction in LOJA_VENDA_VENDEDORES can legitimately
-- drop a funcionario to zero resolved tickets on a day they previously had
-- some; an upsert alone would leave that funcionario's stale nonzero row
-- behind. Replacing the whole day's row set every sync avoids that drift by
-- construction. The sync script (scripts/sales-metrics-sync/) is expected to
-- call this once per (filial, date) for "today" and "yesterday" on every
-- run, per the refresh-behavior decision in Slice A's spec.
--
-- CLAUDE.md: "service_role direct table access must also be explicit and
-- least-privilege" — so the on-prem sync never writes to
-- vendas_diarias_vendedor directly with the service_role key; it only ever
-- calls this RPC, which is the single, auditable write path. Not callable by
-- anon/authenticated — see the revoke/grant at the bottom.
-- =============================================================================

create or replace function public.vendas_diarias_substituir_dia(
  p_codigo_filial text,
  p_data_venda date,
  p_linhas jsonb
)
returns table (
  linhas_inseridas integer,
  linhas_removidas integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removidas integer;
  v_inseridas integer;
begin
  if p_codigo_filial is null or length(trim(p_codigo_filial)) = 0 then
    raise exception using errcode = 'P0001', message = 'CODIGO_FILIAL_REQUIRED';
  end if;
  if p_data_venda is null then
    raise exception using errcode = 'P0001', message = 'DATA_VENDA_REQUIRED';
  end if;

  delete from public.vendas_diarias_vendedor
  where codigo_filial = p_codigo_filial
    and data_venda = p_data_venda;
  get diagnostics v_removidas = row_count;

  insert into public.vendas_diarias_vendedor (
    codigo_filial,
    data_venda,
    funcionario_id,
    codigo_vendedor_linx,
    venda_liquida,
    tickets,
    pecas_brutas,
    pecas_troca
  )
  select
    p_codigo_filial,
    p_data_venda,
    (linha->>'funcionario_id')::uuid,
    (linha->>'codigo_vendedor_linx')::integer,
    coalesce((linha->>'venda_liquida')::numeric, 0),
    coalesce((linha->>'tickets')::integer, 0),
    coalesce((linha->>'pecas_brutas')::integer, 0),
    coalesce((linha->>'pecas_troca')::integer, 0)
  from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) as linha;
  get diagnostics v_inseridas = row_count;

  return query select v_inseridas, v_removidas;
end;
$$;

revoke all on function public.vendas_diarias_substituir_dia(text, date, jsonb) from public;
grant execute on function public.vendas_diarias_substituir_dia(text, date, jsonb) to service_role;

commit;
