-- Run AFTER deployment. These queries do not write data.
-- Check that the new functions exist and are not exposed to anon.
select n.nspname as schema_name, p.proname as function_name,
       p.prosecdef as is_security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as signed_in_can_invoke,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_invoke
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname in (
  'pts_admin_list_user_departments',
  'pts_admin_replace_user_departments',
  'pts_admin_user_departments',
  'pts_admin_save_user_departments'
)
order by n.nspname, p.proname;

-- There should be no membership changes from merely deploying the migration.
select count(*) as membership_count from public.user_departments;

-- Live admin/non-admin and inheritance scenarios will be tested transactionally
-- after deployment, without modifying the official user/department assignments.
