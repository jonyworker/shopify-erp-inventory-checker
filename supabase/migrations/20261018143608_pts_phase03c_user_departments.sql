-- PTS Phase 03-C | Admin-only read and replace employee department memberships.
-- Only install this SQL in a timestamp-named supabase/migrations/<timestamp>_*.sql file.
-- Data is not modified by this migration. Membership edits happen only when an admin calls the RPC.

create or replace function pts_private.pts_admin_list_user_departments(p_target_user_id uuid)
returns table (
  department_id uuid,
  department_code text,
  department_name text,
  department_description text,
  is_active boolean,
  is_assigned boolean,
  permission_count bigint,
  sort_order integer
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not coalesce(pts_private.pts_my_is_system_admin(), false) then
    raise exception 'PTS administrator authorization required' using errcode = '42501';
end if;

  if p_target_user_id is null or not exists (
    select 1 from public.app_profiles ap where ap.user_id = p_target_user_id
  ) then
    raise exception 'PTS profile not found' using errcode = 'P0002';
end if;

return query
select d.id, d.code, d.name, d.description, d.is_active,
       (ud.user_id is not null),
       (select count(*) from public.department_permissions dp
        where dp.department_id = d.id),
       d.sort_order
from public.departments d
         left join public.user_departments ud
                   on ud.department_id = d.id and ud.user_id = p_target_user_id
order by d.sort_order, d.name, d.id;
end;
$function$;

create or replace function pts_private.pts_admin_replace_user_departments(
  p_target_user_id uuid,
  p_department_ids uuid[],
  p_reason text
)
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare
v_target public.app_profiles%rowtype;
  v_old_ids uuid[];
  v_new_ids uuid[];
  v_missing uuid;
  v_unavailable uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor uuid := (select auth.uid());
begin
  if not coalesce(pts_private.pts_my_is_system_admin(), false) then
    raise exception 'PTS administrator authorization required' using errcode = '42501';
end if;

  if p_target_user_id is null then
    raise exception 'PTS profile not found' using errcode = 'P0002';
end if;
  if p_department_ids is null then
    raise exception 'Department ID list is required; use an empty array to clear assignments'
      using errcode = '22023';
end if;
  if exists (select 1 from unnest(p_department_ids) x(id) where x.id is null) then
    raise exception 'Department ID list may not contain null' using errcode = '22023';
end if;
  if cardinality(p_department_ids) <> (
    select count(distinct x.id)::integer from unnest(p_department_ids) x(id)
  ) then
    raise exception 'Duplicate department IDs are not allowed' using errcode = '22023';
end if;

  -- Lock the profile row so concurrent saves for this person are serialized.
select * into v_target
from public.app_profiles ap
where ap.user_id = p_target_user_id for update;
if not found then
    raise exception 'PTS profile not found' using errcode = 'P0002';
end if;

select coalesce(array_agg(ud.department_id order by ud.department_id), array[]::uuid[])
into v_old_ids from public.user_departments ud
where ud.user_id = p_target_user_id;

select coalesce(array_agg(x.id order by x.id), array[]::uuid[])
into v_new_ids from unnest(p_department_ids) x(id);

select x.id into v_missing
from unnest(v_new_ids) x(id)
         left join public.departments d on d.id = x.id
where d.id is null limit 1;
if found then
    raise exception 'Unknown department ID: %', v_missing using errcode = '22023';
end if;

  -- Do not grant new memberships to inactive profiles (including the legacy shared account).
  -- Allow an inactive profile's existing memberships to be cleared for cleanup.
  if not v_target.is_active and cardinality(v_new_ids) > 0 then
    raise exception 'Cannot assign departments to an inactive PTS account'
      using errcode = '22023';
end if;

  -- A previously assigned, subsequently disabled department may stay assigned,
  -- so its historic link will resume working if the department is reactivated.
  -- Brand new assignments to disabled departments are rejected.
select d.id into v_unavailable
from public.departments d
where d.id = any(v_new_ids) and not d.is_active
  and not (d.id = any(v_old_ids))
    limit 1;
if found then
    raise exception 'Cannot newly assign an inactive department: %', v_unavailable
      using errcode = '22023';
end if;

  if v_old_ids = v_new_ids then
    return cardinality(v_new_ids);
end if;

  if char_length(v_reason) not between 1 and 500 then
    raise exception 'A reason of 1-500 characters is required to change memberships'
      using errcode = '22023';
end if;

delete from public.user_departments ud
where ud.user_id = p_target_user_id
  and not (ud.department_id = any(v_new_ids));

insert into public.user_departments (user_id, department_id, assigned_by)
select p_target_user_id, d.id, v_actor
from public.departments d where d.id = any(v_new_ids)
    on conflict (user_id, department_id) do nothing;

insert into public.permission_audit_logs (
    actor_user_id, target_user_id, entity_type, entity_id,
    action_key, old_value, new_value, reason
) values (
             v_actor, p_target_user_id, 'user_department', p_target_user_id,
             'set_departments',
             jsonb_build_object(
                     'department_ids', v_old_ids,
                     'department_codes', (
                         select coalesce(jsonb_agg(d.code order by d.code), '[]'::jsonb)
                         from public.departments d where d.id = any(v_old_ids)
                     )
             ),
             jsonb_build_object(
                     'department_ids', v_new_ids,
                     'department_codes', (
                         select coalesce(jsonb_agg(d.code order by d.code), '[]'::jsonb)
                         from public.departments d where d.id = any(v_new_ids)
                     )
             ),
             v_reason
         );

return cardinality(v_new_ids);
end;
$function$;

-- Public API wrappers are security INVOKER, calling explicitly guarded private functions.
create or replace function public.pts_admin_user_departments(p_target_user_id uuid)
returns table (
  department_id uuid,
  department_code text,
  department_name text,
  department_description text,
  is_active boolean,
  is_assigned boolean,
  permission_count bigint,
  sort_order integer
)
language sql stable security invoker set search_path = ''
as $function$
select * from pts_private.pts_admin_list_user_departments(p_target_user_id);
$function$;

create or replace function public.pts_admin_save_user_departments(
  p_target_user_id uuid,
  p_department_ids uuid[],
  p_reason text
)
returns integer
language sql security invoker set search_path = ''
as $function$
select pts_private.pts_admin_replace_user_departments(
               p_target_user_id, p_department_ids, p_reason
       );
$function$;

-- Carefully restrict invocation. Private helpers are not exposed through the Data API.
revoke all on function pts_private.pts_admin_list_user_departments(uuid)
    from public, anon, authenticated, service_role;
revoke all on function pts_private.pts_admin_replace_user_departments(uuid,uuid[],text)
    from public, anon, authenticated, service_role;
grant execute on function pts_private.pts_admin_list_user_departments(uuid)
  to authenticated;
grant execute on function pts_private.pts_admin_replace_user_departments(uuid,uuid[],text)
  to authenticated;

revoke all on function public.pts_admin_user_departments(uuid)
    from public, anon, authenticated;
revoke all on function public.pts_admin_save_user_departments(uuid,uuid[],text)
    from public, anon, authenticated;
grant execute on function public.pts_admin_user_departments(uuid)
  to authenticated;
grant execute on function public.pts_admin_save_user_departments(uuid,uuid[],text)
  to authenticated;
