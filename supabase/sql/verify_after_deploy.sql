-- Phase 03-A safe metadata verification (Supabase SQL Editor).
-- Does not create or edit departments.
select p.proname as function_name,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as signed_in_can_invoke,
       has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_can_invoke
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname = 'public' and p.proname in (
  'pts_admin_departments',
  'pts_admin_create_department',
  'pts_admin_update_department',
  'pts_admin_set_department_active'
)
order by p.proname;

-- Expected: all four have signed_in_can_invoke=true; anonymous_can_invoke=false.
-- Important: signed-in users can call the wrappers, but only *active system admins*
-- are permitted to execute their operations. Private functions enforce that.
