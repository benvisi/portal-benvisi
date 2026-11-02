begin;

-- =============================================================================
-- Salesperson Metrics Portal V1 — Slice A — write path for the on-prem sync.
--
-- public.vendas_diarias_substituir_dia(p_codigo_filial, p_data_venda,
-- p_linhas_vendedores, p_total_loja, p_linhas_anomalias) replaces the ENTIRE
-- set of rows for one (codigo_filial, data_venda) across all three
-- vendas_diarias_* tables in a single statement/transaction: delete
-- whatever is currently stored for that day in each table, then insert
-- exactly what the caller just computed from Linx. A plpgsql function body
-- runs inside the caller's transaction, so all three tables' delete+insert
-- either all commit together or none do.
--
-- Full-day replacement (not a per-row upsert) is what makes reruns
-- idempotent even when attribution changes between runs — e.g. a late
-- cancellation or a correction in LOJA_VENDA_VENDEDORES can legitimately
-- drop a funcionario to zero resolved tickets on a day they previously had
-- some, or move the store total; an upsert alone would leave stale rows
-- behind. Replacing the whole day's row set every sync avoids that drift by
-- construction. The sync script (scripts/sales-metrics-sync/) calls this
-- once per (filial, date) for "today" and "yesterday" on every run.
--
-- p_total_loja is a single jsonb object (the store-level overallKpis
-- ingredients for the day, computed exactly like
-- reconcile-vendas.mjs's computeKpis(validRows)) — the authoritative source
-- for the Portal's "Total" row. p_linhas_anomalias is a jsonb array of
-- {categoria, venda_liquida, tickets, pecas_brutas, pecas_troca} — pure
-- diagnostics, not read by the MTD RPC's Outros calculation.
--
-- CLAUDE.md: "service_role direct table access must also be explicit and
-- least-privilege" — so the on-prem sync never writes to these tables
-- directly with the service_role key; it only ever calls this RPC, the
-- single auditable write path. Not callable by anon/authenticated — see
-- the revoke/grant at the bottom.
-- =============================================================================

create or replace function public.vendas_diarias_substituir_dia(
  p_codigo_filial text,
  p_data_venda date,
  p_linhas_vendedores jsonb,
  p_total_loja jsonb,
  p_linhas_anomalias jsonb
)
returns table (
  vendedores_inseridos integer,
  vendedores_removidos integer,
  loja_gravada boolean,
  anomalias_inseridas integer,
  anomalias_removidas integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendedores_removidos integer;
  v_vendedores_inseridos integer;
  v_anomalias_removidas integer;
  v_anomalias_inseridas integer;
begin
  if p_codigo_filial is null or length(trim(p_codigo_filial)) = 0 then
    raise exception using errcode = 'P0001', message = 'CODIGO_FILIAL_REQUIRED';
  end if;
  if p_data_venda is null then
    raise exception using errcode = 'P0001', message = 'DATA_VENDA_REQUIRED';
  end if;

  -- --- vendas_diarias_vendedor (clean, mapped salespeople) -------------------
  delete from public.vendas_diarias_vendedor
  where codigo_filial = p_codigo_filial
    and data_venda = p_data_venda;
  get diagnostics v_vendedores_removidos = row_count;

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
    linha->>'codigo_vendedor_linx',
    coalesce((linha->>'venda_liquida')::numeric, 0),
    coalesce((linha->>'tickets')::integer, 0),
    coalesce((linha->>'pecas_brutas')::integer, 0),
    coalesce((linha->>'pecas_troca')::integer, 0)
  from jsonb_array_elements(coalesce(p_linhas_vendedores, '[]'::jsonb)) as linha;
  get diagnostics v_vendedores_inseridos = row_count;

  -- --- vendas_diarias_loja (store-level Total, overallKpis ingredients) -----
  delete from public.vendas_diarias_loja
  where codigo_filial = p_codigo_filial
    and data_venda = p_data_venda;

  insert into public.vendas_diarias_loja (
    codigo_filial,
    data_venda,
    venda_liquida,
    tickets,
    pecas_brutas,
    pecas_troca
  )
  values (
    p_codigo_filial,
    p_data_venda,
    coalesce((p_total_loja->>'venda_liquida')::numeric, 0),
    coalesce((p_total_loja->>'tickets')::integer, 0),
    coalesce((p_total_loja->>'pecas_brutas')::integer, 0),
    coalesce((p_total_loja->>'pecas_troca')::integer, 0)
  );

  -- --- vendas_diarias_anomalias (diagnostics only) ---------------------------
  delete from public.vendas_diarias_anomalias
  where codigo_filial = p_codigo_filial
    and data_venda = p_data_venda;
  get diagnostics v_anomalias_removidas = row_count;

  insert into public.vendas_diarias_anomalias (
    codigo_filial,
    data_venda,
    categoria,
    venda_liquida,
    tickets,
    pecas_brutas,
    pecas_troca
  )
  select
    p_codigo_filial,
    p_data_venda,
    linha->>'categoria',
    coalesce((linha->>'venda_liquida')::numeric, 0),
    coalesce((linha->>'tickets')::integer, 0),
    coalesce((linha->>'pecas_brutas')::integer, 0),
    coalesce((linha->>'pecas_troca')::integer, 0)
  from jsonb_array_elements(coalesce(p_linhas_anomalias, '[]'::jsonb)) as linha;
  get diagnostics v_anomalias_inseridas = row_count;

  return query select v_vendedores_inseridos, v_vendedores_removidos, true, v_anomalias_inseridas, v_anomalias_removidas;
end;
$$;

revoke all on function public.vendas_diarias_substituir_dia(text, date, jsonb, jsonb, jsonb) from public;
grant execute on function public.vendas_diarias_substituir_dia(text, date, jsonb, jsonb, jsonb) to service_role;

commit;
