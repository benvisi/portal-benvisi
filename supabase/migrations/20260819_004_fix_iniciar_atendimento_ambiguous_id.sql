begin;

-- -----------------------------------------------------------------------------
-- Fixes a bug introduced in 20260819_003: the delegated-target validation
-- block in iniciar_atendimento referenced a bare, unqualified `id` column
-- (`select 1 from public.funcionarios where id = v_id_alvo ...`). Because
-- iniciar_atendimento is `returns table (id uuid, ...)`, PL/pgSQL implicitly
-- creates an OUT-parameter variable named `id` in scope for the entire
-- function body. The bare `id` inside that subquery was therefore ambiguous
-- between public.funcionarios.id and the function's own `id` OUT parameter,
-- raising Postgres error 42702 ("column reference is ambiguous") every time
-- a delegated start (p_id_funcionario_alvo different from the caller) took
-- that branch. Self-starts never hit this code path, which is why it wasn't
-- caught until delegated-start QA.
--
-- Fix: table-alias-qualify the reference (`fa.id`) so it unambiguously
-- resolves to public.funcionarios.id. No other function touched by
-- 20260819_003 has this issue — get_atendimento_ativo and
-- get_lista_vez_estado already alias-qualify every column reference, and
-- cancelar_atendimento_provisorio returns boolean (no `id` OUT parameter to
-- collide with).
--
-- CREATE OR REPLACE: same 3-arg signature as the currently-applied function,
-- so this updates it in place.
-- -----------------------------------------------------------------------------
create or replace function public.iniciar_atendimento(
  p_session_token text,
  p_confirmar_fora_de_ordem boolean default false,
  p_id_funcionario_alvo uuid default null
)
returns table (
  id uuid,
  iniciado_em timestamptz,
  fora_de_ordem boolean,
  prazo_provisorio_em timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_dia date;
  v_id_alvo uuid;
  v_primeiro_id uuid;
  v_fora_de_ordem boolean;
  v_atendimento record;
  v_grace_seconds int;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_id_alvo := coalesce(p_id_funcionario_alvo, v_ctx.id_funcionario);

  if v_id_alvo <> v_ctx.id_funcionario then
    if not exists (
      select 1 from public.funcionarios fa where fa.id = v_id_alvo and fa.is_active = true
    ) then
      raise exception using errcode = 'P0001', message = 'FUNCIONARIO_ALVO_INVALIDO';
    end if;
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  if not exists (
    select 1
    from public.turno_presenca
    where id_funcionario = v_id_alvo
      and (checked_in_at at time zone 'America/Manaus')::date = v_dia
  ) then
    raise exception using errcode = 'P0001', message = 'ATIVIDADES_NAO_INICIADAS';
  end if;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  if not exists (
    select 1 from public.lista_vez_fila
    where id_funcionario = v_id_alvo and dia_manaus = v_dia and disponivel = true
  ) then
    raise exception using errcode = 'P0001', message = 'FUNCIONARIO_ALVO_INDISPONIVEL';
  end if;

  select id_funcionario into v_primeiro_id
  from public.lista_vez_fila
  where dia_manaus = v_dia and disponivel = true
  order by posicao asc
  limit 1;

  v_fora_de_ordem := (v_primeiro_id is distinct from v_id_alvo);

  if v_fora_de_ordem and not p_confirmar_fora_de_ordem then
    raise exception using errcode = 'P0001', message = 'CONFIRMACAO_FORA_DE_ORDEM_NECESSARIA';
  end if;

  if exists (
    select 1 from public.atendimentos
    where id_funcionario = v_id_alvo and status in ('ativo', 'finalizando')
  ) then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_ATIVO_EXISTENTE';
  end if;

  update public.lista_vez_fila
  set disponivel = false, atualizado_em = now()
  where id_funcionario = v_id_alvo and dia_manaus = v_dia;

  begin
    insert into public.atendimentos (id_funcionario, id_funcionario_iniciador, fora_de_ordem)
    values (v_id_alvo, v_ctx.id_funcionario, v_fora_de_ordem)
    returning atendimentos.id, atendimentos.iniciado_em, atendimentos.fora_de_ordem
    into v_atendimento;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_ATIVO_EXISTENTE';
  end;

  v_grace_seconds := case when v_ctx.id_funcionario <> v_id_alvo then 60 else 20 end;

  return query select
    v_atendimento.id,
    v_atendimento.iniciado_em,
    v_atendimento.fora_de_ordem,
    v_atendimento.iniciado_em + make_interval(secs => v_grace_seconds);
end;
$$;

revoke all on function public.iniciar_atendimento(text, boolean, uuid) from public;
grant execute on function public.iniciar_atendimento(text, boolean, uuid) to anon;

commit;
