begin;

drop policy if exists "Allow anon read funcionarios"
on public.funcionarios;

alter table public.funcionarios enable row level security;

drop function if exists public.verify_pin(text, text);

revoke all on function public.list_active_employees() from public;
revoke all on function public.verify_pin(uuid, text) from public;

grant execute on function public.list_active_employees() to anon;
grant execute on function public.verify_pin(uuid, text) to anon;

commit;