-- PTS / Phase 03-B: department permission assignments (admin-only)
-- Source of truth: public.permission_catalog / public.department_permissions.
-- This migration creates RPC interfaces only; it does NOT grant anything or change any department assignments.
-- Paste into the timestamped file created by `npx supabase migration new pts_phase03b_department_permissions`.

-- 1) Read the entire permission catalog with the selected department's check state.
-- SECURITY DEFINER is restricted to pts_private and checks auth.uid() through existing admin predicate.
create or replace function pts_private.pts_admin_list_department_permissions(p_department_id uuid)
returns table (
    permission_id uuid,
    permission_key text,
    tool_key text,
    tool_label text,
    group_key text,
    action_key text,
    action_label text,
    requires_permission_key text,
    is_available boolean,
    is_granted boolean,
    tool_sort_order integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
    if not coalesce(pts_private.pts_my_is_system_admin(), false) then
        raise exception 'PTS administrator authorization required' using errcode = '42501';
end if;
    if p_department_id is null or not exists (
        select 1 from public.departments d where d.id = p_department_id
    ) then
        raise exception 'Department not found' using errcode = 'P0002';
end if;

return query
select pc.id, pc.permission_key, tc.tool_key, tc.label, tc.group_key,
       pc.action_key, pc.label, prerequisite.permission_key,
       (pc.is_active and tc.is_active) as is_available,
       (dp.permission_id is not null) as is_granted,
       tc.sort_order
from public.permission_catalog pc
         join public.tool_catalog tc on tc.id = pc.tool_id
         left join public.permission_catalog prerequisite on prerequisite.id = pc.requires_permission_id
         left join public.department_permissions dp
                   on dp.department_id = p_department_id and dp.permission_id = pc.id
order by tc.sort_order, tc.tool_key,
         case pc.action_key when 'view' then 0 when 'create' then 1
                            when 'edit' then 2 when 'delete' then 3 when 'export' then 4 else 5 end,
         pc.action_key;
end;
$function$;
-- 2) Save a complete permission selection for one department atomically.
-- Empty array means revoke every department-level grant, NOT delete the department.
-- Existing assignments from other departments/roles and individual overrides are never touched.
create or replace function pts_private.pts_admin_replace_department_permissions(
    p_department_id uuid,
    p_permission_keys text[],
    p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
v_department public.departments%rowtype;
    v_old_keys text[];
    v_new_keys text[];
    v_key_count integer;
    v_actor uuid := (select auth.uid());
    v_reason text := btrim(coalesce(p_reason, ''));
    v_invalid text;
    v_missing_prerequisite text;
begin
    if not coalesce(pts_private.pts_my_is_system_admin(), false) then
        raise exception 'PTS administrator authorization required' using errcode = '42501';
end if;
    if p_department_id is null then
        raise exception 'Department not found' using errcode = 'P0002';
end if;
    if p_permission_keys is null then
        raise exception 'Permission list is required. Use an empty array to revoke all grants'
            using errcode = '22023';
end if;

    -- Serialize concurrent edits of the same department.
select * into v_department
from public.departments d where d.id = p_department_id for update;
if not found then
        raise exception 'Department not found' using errcode = 'P0002';
end if;
    if not v_department.is_active then
        raise exception 'Cannot edit permissions of an inactive department'
            using errcode = '22023';
end if;

    if exists (
        select 1 from unnest(p_permission_keys) as selected(key)
        where selected.key is null or selected.key = '' or selected.key <> btrim(selected.key)
    ) then
        raise exception 'Permission keys must be nonempty and without surrounding whitespace'
            using errcode = '22023';
end if;
select count(*) into v_key_count from unnest(p_permission_keys);
if v_key_count <> (select count(distinct selected.key) from unnest(p_permission_keys) as selected(key)) then
        raise exception 'Duplicate permission keys are not allowed'
            using errcode = '22023';
end if;

select selected.key into v_invalid
from unnest(p_permission_keys) as selected(key)
         left join public.permission_catalog pc on pc.permission_key = selected.key
         left join public.tool_catalog tc on tc.id = pc.tool_id
where pc.id is null or not coalesce(pc.is_active and tc.is_active, false)
    limit 1;
if v_invalid is not null then
        raise exception 'Unknown or inactive permission: %', v_invalid
            using errcode = '22023';
end if;

    -- Each granted action must include its own prerequisite in this same selection.
    -- This ensures a single department can stand alone; multiple departments still combine by union.
select pc.permission_key into v_missing_prerequisite
from public.permission_catalog pc
where pc.permission_key = any(p_permission_keys)
  and pc.requires_permission_id is not null
  and not exists (
    select 1 from public.permission_catalog dependency
    where dependency.id = pc.requires_permission_id
      and dependency.permission_key = any(p_permission_keys)
)
    limit 1;
if v_missing_prerequisite is not null then
        raise exception 'Missing prerequisite permission for %', v_missing_prerequisite
            using errcode = '22023';
end if;

select coalesce(array_agg(pc.permission_key order by pc.permission_key), array[]::text[])
into v_old_keys
from public.department_permissions dp
         join public.permission_catalog pc on pc.id = dp.permission_id
where dp.department_id = p_department_id;

select coalesce(array_agg(selected.key order by selected.key), array[]::text[])
into v_new_keys
from unnest(p_permission_keys) as selected(key);

if v_old_keys = v_new_keys then
        return 0;
end if;
    if char_length(v_reason) not between 1 and 500 then
        raise exception 'A reason of 1-500 characters is required to modify department grants'
            using errcode = '22023';
end if;

    -- Apply the diff rather than deleting all rows, preserving granted_at for unchanged grants.
delete from public.department_permissions dp
where dp.department_id = p_department_id
  and not exists (
    select 1 from public.permission_catalog pc
    where pc.id = dp.permission_id and pc.permission_key = any(v_new_keys)
);

insert into public.department_permissions (department_id, permission_id, granted_by)
select p_department_id, pc.id, v_actor
from public.permission_catalog pc
where pc.permission_key = any(v_new_keys)
    on conflict (department_id, permission_id) do nothing;

insert into public.permission_audit_logs
(actor_user_id, entity_type, entity_id, action_key, old_value, new_value, reason)
values
    (v_actor, 'department', p_department_id, 'set_permissions',
     jsonb_build_object('permission_keys', v_old_keys),
     jsonb_build_object('permission_keys', v_new_keys), v_reason);

return (select count(*)::integer from public.department_permissions dp
        where dp.department_id = p_department_id);
end;
$function$;
-- Private functions aren't directly exposed by PostgREST. Explicit EXECUTE grants
-- are required for the public invoker wrappers to reach them.
revoke all on function pts_private.pts_admin_list_department_permissions(uuid)
    from public, anon, authenticated, service_role;
revoke all on function pts_private.pts_admin_replace_department_permissions(uuid, text[], text)
    from public, anon, authenticated, service_role;
grant execute on function pts_private.pts_admin_list_department_permissions(uuid) to authenticated;
grant execute on function pts_private.pts_admin_replace_department_permissions(uuid, text[], text) to authenticated;
-- Public RPC wrappers intentionally use SECURITY INVOKER, not SECURITY DEFINER.
create or replace function public.pts_admin_department_permissions(p_department_id uuid)
returns table (
    permission_id uuid,
    permission_key text,
    tool_key text,
    tool_label text,
    group_key text,
    action_key text,
    action_label text,
    requires_permission_key text,
    is_available boolean,
    is_granted boolean,
    tool_sort_order integer
)
language sql
stable
security invoker
set search_path = ''
as $function$
select * from pts_private.pts_admin_list_department_permissions(p_department_id);
$function$;
create or replace function public.pts_admin_save_department_permissions(
    p_department_id uuid,
    p_permission_keys text[],
    p_reason text
)
returns integer
language sql
security invoker
set search_path = ''
as $function$
select pts_private.pts_admin_replace_department_permissions(
               p_department_id, p_permission_keys, p_reason
       );
$function$;
revoke all on function public.pts_admin_department_permissions(uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.pts_admin_save_department_permissions(uuid, text[], text)
    from public, anon, authenticated, service_role;
grant execute on function public.pts_admin_department_permissions(uuid) to authenticated;
grant execute on function public.pts_admin_save_department_permissions(uuid, text[], text) to authenticated;
