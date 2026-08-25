begin;

-- =============================================================================
-- Epic 2 — Atendimento, Milestone 2A QA corrections (round 2)
--
-- Depends on 20260819_001_add_atendimento_fechamento_clientes_motivos.sql —
-- apply that first. That file (and 20260818_001/002) are treated as
-- immutable applied history and are not modified here.
--
-- 1. Revised product rule (supersedes 20260819_001's "always exclude
--    finalizando time" model): time spent in Finalizando is excluded from
--    customer-facing Atendimento duration ONLY when that closing attempt
--    successfully completes the Atendimento. An abandoned attempt (Voltar
--    ao atendimento) means the Atendimento never actually ended, so that
--    time counts as ordinary Atendimento time.
--
--    This substantially simplifies the previous accumulator model: since an
--    Atendimento can be successfully completed at most once, there is at
--    most one finalizando period that ever needs excluding — the final
--    one — and its duration is simply finalizando_em (preserved, not
--    cleared, on successful completion) minus iniciado_em. No running
--    accumulation is needed for the duration calculation any more.
--
--    Concretely: while 'ativo' (whether the original start or resumed
--    after an abandoned closing attempt), the shared/live elapsed display
--    is now just now() - iniciado_em, unadjusted — no anchor shifting.
--    iniciado_em itself was never touched by finalizando transitions and
--    still isn't; the 20-second accidental-start deadline
--    (iniciado_em + 20s) remains completely unaffected by any of this, in
--    either model.
--
--    tempo_finalizando_acumulado is renamed to tempo_finalizando_abandonado
--    and repurposed as an audit-only fact (per section 13.3
--    Auditability / "future historical reporting" in the Milestone 2A
--    prompt): it keeps accumulating the duration of every *abandoned*
--    closing attempt (voltar_ao_atendimento), but is no longer subtracted
--    from anything — a successful closing period is no longer added to it.
--    Existing values already recorded under the old column name remain
--    semantically correct under the new name/meaning (they already
--    represent time spent in abandoned closing attempts); no data needs
--    correcting.
--
-- 2. Shorter employee-facing motive labels (updated in place via UPDATE by
--    the stable `codigo`, not by dropping/recreating rows) — codigo,
--    categoria, detalhe_obrigatorio, and ordem_exibicao are all unchanged,
--    preserving analytical meaning. atendimento_clientes.motivo_rotulo is a
--    snapshot captured at INSERT time in 20260819_001's concluir_atendimento
--    and is never re-derived from the current atendimento_motivos.rotulo,
--    so already-recorded historical customer rows keep showing the exact
--    label an employee saw at the time, unaffected by this relabeling.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rename (guarded/idempotent: handles "already renamed", "still the old
-- name", and — purely for robustness on a hypothetical from-scratch apply —
-- "column missing entirely").
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'atendimentos'
      and column_name = 'tempo_finalizando_abandonado'
  ) then
    null; -- already renamed
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'atendimentos'
      and column_name = 'tempo_finalizando_acumulado'
  ) then
    alter table public.atendimentos
      rename column tempo_finalizando_acumulado to tempo_finalizando_abandonado;
  else
    alter table public.atendimentos
      add column tempo_finalizando_abandonado interval not null default '0 seconds'::interval;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- voltar_ao_atendimento: same transition as before (finalizando -> ativo,
-- finalizando_em cleared, iniciado_em never touched), still accumulating
-- the abandoned period's duration — now explicitly as an audit-only fact,
-- not something ever subtracted from a duration calculation.
-- -----------------------------------------------------------------------------
create or replace function public.voltar_ao_atendimento(
  p_session_token text
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

  update public.atendimentos
  set status = 'ativo',
      tempo_finalizando_abandonado = tempo_finalizando_abandonado + (now() - finalizando_em),
      finalizando_em = null
  where id_funcionario = v_ctx.id_funcionario and status = 'finalizando';

  if not found then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

  return true;
end;
$$;

revoke all on function public.voltar_ao_atendimento(text) from public;
grant execute on function public.voltar_ao_atendimento(text) to anon;

-- -----------------------------------------------------------------------------
-- concluir_atendimento: identical to 20260819_001 except the final
-- (successful) finalizando period is no longer added to
-- tempo_finalizando_abandonado — it wasn't abandoned. finalizando_em is
-- deliberately left as-is (not cleared) so it remains available as the
-- authoritative "customer-facing duration ended here" marker:
-- finalizando_em - iniciado_em is the official excluded-closing-time-aware
-- duration for any completed Atendimento, computable directly from these
-- two preserved columns without any stored/accumulated total.
-- -----------------------------------------------------------------------------
create or replace function public.concluir_atendimento(
  p_session_token text,
  p_clientes jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_atendimento record;
  v_dia date;
  v_cliente jsonb;
  v_id_motivo uuid;
  v_detalhe text;
  v_motivo record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = v_ctx.id_funcionario and status = 'finalizando'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

  if p_clientes is null
     or jsonb_typeof(p_clientes) <> 'array'
     or jsonb_array_length(p_clientes) = 0 then
    raise exception using errcode = 'P0001', message = 'NENHUM_CLIENTE_INFORMADO';
  end if;

  for v_cliente in select * from jsonb_array_elements(p_clientes)
  loop
    if v_cliente ->> 'id_motivo' is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_OBRIGATORIO';
    end if;

    begin
      v_id_motivo := (v_cliente ->> 'id_motivo')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end;

    select * into v_motivo
    from public.atendimento_motivos
    where id = v_id_motivo and ativo = true;

    if v_motivo.id is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end if;

    v_detalhe := nullif(trim(both from (v_cliente ->> 'detalhe')), '');

    if v_motivo.detalhe_obrigatorio and v_detalhe is null then
      raise exception using errcode = 'P0001', message = 'DETALHE_OBRIGATORIO';
    end if;

    insert into public.atendimento_clientes (
      id_atendimento, id_motivo, categoria, motivo_rotulo, detalhe
    ) values (
      v_atendimento.id, v_motivo.id, v_motivo.categoria, v_motivo.rotulo, v_detalhe
    );
  end loop;

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  update public.atendimentos
  set status = 'concluido',
      concluido_em = now()
  where id = v_atendimento.id;

  insert into public.lista_vez_fila (id_funcionario, dia_manaus, disponivel, posicao)
  values (v_ctx.id_funcionario, v_dia, true, nextval('public.lista_vez_posicao_seq'))
  on conflict (id_funcionario, dia_manaus)
  do update set
    disponivel = true,
    posicao = excluded.posicao,
    atualizado_em = now();

  return true;
end;
$$;

revoke all on function public.concluir_atendimento(text, jsonb) from public;
grant execute on function public.concluir_atendimento(text, jsonb) to anon;

-- -----------------------------------------------------------------------------
-- get_lista_vez_estado: iniciado_em for an 'em_atendimento' (status = 'ativo')
-- row is now the raw, unadjusted a.iniciado_em — under the revised rule,
-- live elapsed time while 'ativo' never needs correcting for past
-- finalizando cycles (abandoned ones count as active time; the only ever-
-- excluded period is the final successful one, which only matters once the
-- Atendimento is already 'concluido', at which point it no longer appears
-- here as 'em_atendimento' at all). Same output columns as
-- 20260819_001 — CREATE OR REPLACE is sufficient, no DROP needed.
-- -----------------------------------------------------------------------------
create or replace function public.get_lista_vez_estado(
  p_session_token text
)
returns table (
  id_funcionario uuid,
  nome text,
  status text,
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
      case when a.status = 'ativo' then a.iniciado_em else null end as iniciado_em
    from public.lista_vez_fila f
    join public.funcionarios fu on fu.id = f.id_funcionario
    left join public.atendimentos a
      on a.id_funcionario = f.id_funcionario and a.status in ('ativo', 'finalizando')
    where f.dia_manaus = v_dia
    order by f.disponivel desc, f.posicao asc;
end;
$$;

revoke all on function public.get_lista_vez_estado(text) from public;
grant execute on function public.get_lista_vez_estado(text) to anon;

-- -----------------------------------------------------------------------------
-- Shorter employee-facing motive labels. codigo/categoria/
-- detalhe_obrigatorio/ordem_exibicao unchanged — only rotulo (the current,
-- display-only label) is updated. Idempotent (plain UPDATE, safe to
-- re-run). Motives whose label was already short (Troca, Outro, Preço) are
-- intentionally not listed — nothing to change.
-- -----------------------------------------------------------------------------
update public.atendimento_motivos set rotulo = 'Pessoal' where codigo = 'compra_pessoal';
update public.atendimento_motivos set rotulo = 'Presente' where codigo = 'compra_presente';
update public.atendimento_motivos set rotulo = 'Olhando' where codigo = 'so_olhando';
update public.atendimento_motivos set rotulo = 'Não gostou' where codigo = 'nao_gostou_opcoes';
update public.atendimento_motivos set rotulo = 'Item indisponível' where codigo = 'produto_indisponivel';
update public.atendimento_motivos set rotulo = 'Só troca' where codigo = 'troca_sem_compra';

commit;
