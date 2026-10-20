-- READ-ONLY. Run after deployment to verify. Do not put in migrations.
select c.column_name, c.data_type
from information_schema.columns c
where c.table_schema='pts_private' and c.table_name='pts_employee_onboarding'
  and c.column_name in ('activation_claim_token','activation_claim_expires_at')
order by c.column_name;

select p.proname as rpc,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_can_call,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_can_call,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_call
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('pts_service_begin_employee_activation',
                   'pts_service_finish_employee_activation',
                   'pts_service_release_employee_activation')
order by p.proname;

select
  (select count(*) from auth.users) as total_auth_users,
  (select count(*) from public.app_profiles) as total_pts_profiles,
  (select count(*) from public.app_profiles where username='admin' and is_active and not must_change_password) as admin_ok,
  (select count(*) from public.app_profiles where must_change_password) as pending_employees;
