begin;

-- =============================================================================
-- Employee-facing identity: prefer `apelido`, fall back to `nome`
--
-- Approved product rule (Milestone 4C.3 polish):
--   employee-facing informal identity → apelido
--   fallback                          → nome   (when apelido is NULL/blank)
--
-- `funcionarios.apelido` is currently NOT NULL and populated for every row,
-- so the fallback is defensive only. It is still applied everywhere via
-- `coalesce(nullif(btrim(apelido::text), ''), nome::text)` so a future
-- nullable/blank apelido degrades gracefully rather than showing an empty
-- name.
--
-- Scope of this migration (all additive / behavioural, no data changes):
--   1. verify_pin        — gains an `apelido` output column (the session
--                          then carries it; the Dashboard greeting uses it).
--                          This is the only signature change, so verify_pin
--                          is DROP + CREATE'd; nothing depends on it besides
--                          the PostgREST RPC call.
--   2. get_lista_vez_estado   — its existing `nome` display column now
--                                returns apelido-first. No signature change.
--   3. get_atendimento_ativo  — its existing `iniciado_por_nome` display
--                                column now returns apelido-first. No
--                                signature change.
--
-- The formal/legal name is unchanged in `funcionarios.nome` and in
-- `list_active_employees` (the login picker still shows full names).
-- Escala already displays `apelido` and is not touched here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. verify_pin — add `apelido` to the result (DROP + CREATE: return type
--    change). Body is otherwise identical to 20260722_001's definition.
-- ---------------------------------------------------------------------------
drop function if exists public.verify_pin(uuid, text);

create function public.verify_pin(p_funcionario_id uuid, p_pin text)
returns table (
  success boolean,
  funcionario_id uuid,
  nome text,
  apelido text,
  cargo text,
  error_code text,
  session_token text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_employee record;
  v_session_token text;
begin
  -- Input format check: reject missing id/PIN and any PIN that is not
  -- exactly four numeric digits.
  if p_funcionario_id is null
     or p_pin is null
     or p_pin !~ '^[0-9]{4}$' then
    return query select false, null::uuid, null::text, null::text, null::text,
                        'INVALID_INPUT'::text, null::text;
    return;
  end if;

  -- Validate employee, PIN, and active status. cargo comes from the
  -- database; the browser never submits the role.
  select
    f.id                                                       as id,
    f.nome::text                                               as nome,
    coalesce(nullif(btrim(f.apelido::text), ''), f.nome::text) as apelido,
    f.cargo::text                                              as cargo
  into v_employee
  from public.funcionarios f
  where f.id = p_funcionario_id
    and f.token_pin = p_pin
    and f.is_active = true
  limit 1;

  if found then
    v_session_token := public.issue_employee_session(v_employee.id);
    return query select true, v_employee.id, v_employee.nome, v_employee.apelido,
                        v_employee.cargo, null::text, v_session_token;
    return;
  end if;

  -- One generic failure — never reveal which of id/PIN/active was wrong.
  return query select false, null::uuid, null::text, null::text, null::text,
                      'INVALID_CREDENTIALS'::text, null::text;
end;
$function$;

revoke all on function public.verify_pin(uuid, text) from public;
grant execute on function public.verify_pin(uuid, text) to anon;

-- ---------------------------------------------------------------------------
-- 2. get_lista_vez_estado — `nome` display column becomes apelido-first.
--    Only the one select expression changes vs the prior definition.
-- ---------------------------------------------------------------------------
create or replace function public.get_lista_vez_estado(p_session_token text)
returns table (
  id_funcionario uuid,
  nome text,
  status text,
  ordem integer,
  iniciado_em timestamp with time zone,
  id_atendimento uuid,
  id_funcionario_iniciador uuid,
  prazo_provisorio_em timestamp with time zone
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
      case when a.status = 'ativo' then a.id else null end as id_atendimento,
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
$function$;

revoke all on function public.get_lista_vez_estado(text) from public;
grant execute on function public.get_lista_vez_estado(text) to anon;

-- ---------------------------------------------------------------------------
-- 3. get_atendimento_ativo — `iniciado_por_nome` becomes apelido-first.
--    Only the one select expression changes vs the prior definition.
-- ---------------------------------------------------------------------------
create or replace function public.get_atendimento_ativo(p_session_token text)
returns table (
  id uuid,
  status text,
  iniciado_em timestamp with time zone,
  fora_de_ordem boolean,
  prazo_provisorio_em timestamp with time zone,
  iniciado_por_nome text,
  checklist_obrigatorio boolean,
  dia_negocio_original date
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  perform public.transicionar_atendimento_pendente(v_ctx.id_funcionario);

  return query
    select
      a.id,
      a.status,
      a.iniciado_em,
      a.fora_de_ordem,
      a.iniciado_em + make_interval(
        secs => case when a.id_funcionario_iniciador <> a.id_funcionario then 60 else 20 end
      ),
      case
        when a.id_funcionario_iniciador <> a.id_funcionario
          then coalesce(nullif(btrim(fi.apelido::text), ''), fi.nome::text)
        else null
      end,
      a.checklist_obrigatorio,
      a.dia_negocio_original
    from public.atendimentos a
    left join public.funcionarios fi on fi.id = a.id_funcionario_iniciador
    where a.id_funcionario = v_ctx.id_funcionario
      and a.status in ('ativo', 'finalizando', 'pendente_fechamento')
    limit 1;
end;
$function$;

revoke all on function public.get_atendimento_ativo(text) from public;
grant execute on function public.get_atendimento_ativo(text) to anon;

commit;
