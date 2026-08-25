begin;

-- =============================================================================
-- Epic 2 — Atendimento, Milestone 2D QA correction: post-recovery queue-
-- availability inconsistency.
--
-- Bug found in browser QA: 20260822_001's concluir_atendimento_pendente
-- deliberately never touches lista_vez_fila at all (correct per section 17 —
-- recovery must never blindly append the employee to today's queue, never
-- call nextval(), never mutate the wrong business day). But this was
-- incomplete: if the employee's TODAY row already legitimately exists with
-- na_fila = true and happens to be disponivel = false — reproduced in QA by
-- backdating a same-day Atendimento's iniciado_em to simulate a previous-day
-- pending one, which leaves the *current* day's own lista_vez_fila row
-- (the one iniciar_atendimento actually flipped disponivel = false on) with
-- no other code path left to ever flip it back — recovery left that stale
-- disponivel = false in place. The employee then saw "Você está fora da
-- Lista da Vez" (the frontend's souNaFila check, see the companion frontend
-- fix, conflated "not currently disponivel" with "not na_fila"), and tapping
-- Entrar na Lista da Vez correctly failed with JA_NA_LISTA — an internally
-- inconsistent, user-visible dead end.
--
-- Fix: concluir_atendimento_pendente now performs exactly one additional,
-- narrowly-scoped statement after concluding the Atendimento — restore
-- disponivel = true on today's row, but ONLY if a row already exists AND
-- na_fila = true. It never creates a row, never calls nextval() (posicao is
-- therefore always left completely untouched), and never touches na_fila
-- itself:
--
--   - no current-day row at all               -> statement matches 0 rows, no-op;
--   - na_fila = true  (today's real membership) -> disponivel restored to true;
--   - na_fila = false (deliberately left today)  -> statement matches 0 rows
--                                                    (na_fila = true is part
--                                                    of the WHERE clause), no-op —
--                                                    the employee must use the
--                                                    normal Entrar na Lista da
--                                                    Vez flow to rejoin.
--
-- Same per-day advisory lock every other queue-mutating RPC already takes
-- (pg_advisory_xact_lock(hashtext('lista_vez:' || dia::text))), acquired
-- after the checklist_pendencias(employee) lock resolver_checklist_pendencias
-- already takes earlier in this same function — preserving the established
-- lock order (atendimentos row -> checklist_pendencias(employee) ->
-- lista_vez(day)) exactly, so this introduces no new deadlock path. Runs in
-- the same transaction as the rest of concluir_atendimento_pendente, so the
-- employee can never observe a concluded Atendimento with stale current-day
-- availability, even transiently.
--
-- concluir_atendimento_pendente's signature is unchanged (still 3 args) —
-- this is a behavior-only redefinition (plain CREATE OR REPLACE), no
-- drop/recreate needed. The already-applied 20260822_001 migration file
-- itself is left completely untouched, per the immutable-migration rule —
-- this is a new, additive, forward-only corrective migration.
-- =============================================================================

create or replace function public.concluir_atendimento_pendente(
  p_session_token text,
  p_clientes jsonb,
  p_checklist jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_atendimento record;
  v_cliente jsonb;
  v_id_motivo uuid;
  v_detalhe text;
  v_motivo record;
  v_versao_ativa int;
  v_codigos_confirmados text[];
  v_respostas jsonb;
  v_checklist_id uuid;
  v_dia_hoje date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  -- Section 8: only the responsible employee (id_funcionario) may recover
  -- their own pending Atendimento — this lookup itself is the enforcement,
  -- id_funcionario_iniciador is never consulted here.
  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = v_ctx.id_funcionario and status = 'pendente_fechamento'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'NENHUM_ATENDIMENTO_PENDENTE';
  end if;

  -- Customer outcomes — identical validation/persistence to
  -- concluir_atendimento.
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

  -- Checklist — always required (see 20260822_001's function-level comment
  -- for why this does not conflict with any historical 2C.3 decision).
  -- checklist_obrigatorio / checklist_decisao_motivo /
  -- checklist_politica_no_momento are intentionally never written anywhere
  -- in this function.
  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  select array_agg(elem ->> 'codigo')
  into v_codigos_confirmados
  from jsonb_array_elements(p_checklist) as elem
  where jsonb_typeof(elem) = 'object'
    and jsonb_typeof(elem -> 'concluido') = 'boolean'
    and (elem ->> 'concluido')::boolean is true
    and elem ->> 'codigo' is not null;

  if exists (
    select 1
    from public.atendimento_checklist_itens ci
    where ci.versao = v_versao_ativa
      and ci.ativo = true
      and ci.obrigatorio = true
      and not (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
  ) then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'codigo', ci.codigo,
      'concluido', (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
    )
    order by ci.ordem_exibicao
  )
  into v_respostas
  from public.atendimento_checklist_itens ci
  where ci.versao = v_versao_ativa and ci.ativo = true;

  insert into public.atendimento_checklists (id_atendimento, id_funcionario, versao, respostas)
  values (v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_respostas)
  returning id into v_checklist_id;

  -- Reuses the exact 2C.2 resolver — a genuine checklist completion during
  -- recovery resolves all of this employee's currently-pending checklist
  -- backlog too (section 15), no duplicated logic.
  perform public.resolver_checklist_pendencias(
    v_ctx.id_funcionario, 'fechamento_atendimento', v_checklist_id, null, v_versao_ativa
  );

  -- finalizando_em is deliberately never touched here — it already holds the
  -- correct historical closing boundary (either the original
  -- Finalizando-entry timestamp, or the synthesized end-of-business-day
  -- cutoff), established by transicionar_atendimento_pendente.
  update public.atendimentos
  set status = 'concluido',
      concluido_em = now()
  where id = v_atendimento.id;

  -- QA correction: restore availability on an already-existing, already-
  -- legitimate current-day queue membership, without creating, reordering,
  -- or otherwise touching it — see this migration's header comment for the
  -- full reasoning. Deliberately a single, narrowly-targeted UPDATE with no
  -- INSERT/upsert branch at all: na_fila = true is part of the WHERE
  -- clause, so this is a genuine no-op whenever no current-day row exists or
  -- the employee deliberately left today's queue (na_fila = false).
  v_dia_hoje := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia_hoje::text)::bigint);

  update public.lista_vez_fila
  set disponivel = true, atualizado_em = now()
  where id_funcionario = v_ctx.id_funcionario
    and dia_manaus = v_dia_hoje
    and na_fila = true
    and disponivel = false;

  return true;
end;
$$;

revoke all on function public.concluir_atendimento_pendente(text, jsonb, jsonb) from public;
grant execute on function public.concluir_atendimento_pendente(text, jsonb, jsonb) to anon;

commit;
