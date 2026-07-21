begin;

-- =============================================================================
-- Terms acceptance RPCs
--
-- Depends on public.get_valid_employee_session_context(text) from
-- 20260722_001_add_employee_sessions_and_verify_pin_token.sql — apply that
-- migration first.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Uniqueness detection: does an existing unique constraint or index already
-- cover exactly (id_funcionario, versao_termo), under any name? Detected by
-- comparing actual indexed column sets via pg_index/pg_attribute, not by
-- assuming a specific object name or relying on catching duplicate_table.
-- -----------------------------------------------------------------------------
do $$
declare
  v_target_attnums int2[];
  v_already_protected boolean;
  v_duplicate_count int;
begin
  select array_agg(a.attnum order by a.attnum)
  into v_target_attnums
  from pg_attribute a
  where a.attrelid = 'public.termos_aceite'::regclass
    and a.attname in ('id_funcionario', 'versao_termo')
    and a.attnum > 0
    and not a.attisdropped;

  if v_target_attnums is null or array_length(v_target_attnums, 1) <> 2 then
    raise exception
      'Could not resolve both id_funcionario and versao_termo columns on '
      'public.termos_aceite. Verify these column names before applying '
      'this migration.';
  end if;

  select exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.termos_aceite'::regclass
      and i.indisunique
      and (
        select array_agg(k order by k)
        from unnest(i.indkey::int2[]) as k
        where k > 0
      ) = v_target_attnums
  ) into v_already_protected;

  if not v_already_protected then
    -- Fail-closed duplicate preflight: refuse to add the constraint if
    -- incompatible data already exists. No rows are modified either way.
    select count(*) into v_duplicate_count
    from (
      select id_funcionario, versao_termo
      from public.termos_aceite
      group by id_funcionario, versao_termo
      having count(*) > 1
    ) dupes;

    if v_duplicate_count > 0 then
      raise exception
        'termos_aceite has % duplicate (id_funcionario, versao_termo) '
        'group(s). Resolve these manually (decide which row to keep per '
        'group) before applying this migration — no rows were modified. '
        'Diagnostic query: select id_funcionario, versao_termo, count(*) '
        'from public.termos_aceite group by 1, 2 having count(*) > 1;',
        v_duplicate_count;
    end if;

    alter table public.termos_aceite
      add constraint termos_aceite_id_funcionario_versao_termo_key
      unique (id_funcionario, versao_termo);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- check_termo_acceptance: read-only status check. Identity and role come
-- exclusively from the validated session context; p_funcionario_id is never
-- accepted from the client.
-- -----------------------------------------------------------------------------
create or replace function public.check_termo_acceptance(
  p_session_token text,
  p_versao_termo text
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  return exists (
    select 1
    from public.termos_aceite
    where id_funcionario = v_ctx.id_funcionario
      and versao_termo = p_versao_termo
  );
end;
$$;

revoke all on function public.check_termo_acceptance(text, text) from public;
grant execute on function public.check_termo_acceptance(text, text) to anon;

-- -----------------------------------------------------------------------------
-- accept_termo: idempotent for (id_funcionario, versao_termo) — relies on the
-- unique protection ensured above plus ON CONFLICT DO NOTHING for
-- concurrency safety. Stores the exact displayed text and an acceptance
-- timestamp; returns a simple success boolean.
-- -----------------------------------------------------------------------------
create or replace function public.accept_termo(
  p_session_token text,
  p_versao_termo text,
  p_texto_termo text
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

  insert into public.termos_aceite (id_funcionario, versao_termo, texto_termo, aceito_em)
  values (v_ctx.id_funcionario, p_versao_termo, p_texto_termo, now())
  on conflict (id_funcionario, versao_termo) do nothing;

  return true;
end;
$$;

revoke all on function public.accept_termo(text, text, text) from public;
grant execute on function public.accept_termo(text, text, text) to anon;

commit;
