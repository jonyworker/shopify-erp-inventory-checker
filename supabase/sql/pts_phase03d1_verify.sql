-- Safe, read-only checks. Do NOT put this file in migrations/.
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'app_profiles'
  and column_name = 'must_change_password';

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.app_profiles'::regclass
  and conname = 'app_profiles_pending_cannot_be_active';

select p.proname,
       has_function_privilege('service_role', p.oid, 'execute') as service_role_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
       has_function_privilege('anon', p.oid, 'execute') as anon_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'pts_service_register_employee';

select count(*) as pending_employee_count
from public.app_profiles
where must_change_password;

select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'pts_private'
  and c.relname = 'pts_employee_onboarding';
