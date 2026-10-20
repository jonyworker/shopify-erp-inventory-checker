-- PTS Phase 03-A: administrator-only department management API.
-- Execute ONLY once in a properly timestamped Supabase migration.
-- Existing RLS / direct table privileges remain unchanged.
-- Requires prior Phase 02-A and 02-C2 migrations.

create or replace function pts_private.pts_admin_list_departments()
returns table (
  id uuid, code text, name text, description text,
  is_active boolean, sort_order integer,
  member_count bigint, permission_count bigint,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $function$
begin
  if not coalesce(pts_private.pts_my_is_system_admin(), false) then
    raise exception 'PTS administrator authorization required' using errcode = '42501';
  end if;

  return query
  select d.id, d.code, d.name, d.description, d.is_active, d.sort_order,
         (select count(*) from public.user_departments ud where ud.department_id = d.id),
         (select count(*) from public.department_permissions dp where dp.department_id = d.id),
         d.created_at, d.updated_at
  from public.departments d
  order by d.sort_order, d.name, d.id;
end;
$function$;

create or replace function pts_private.pts_admin_create_department(
  p_code text, p_name text, p_description text default null, p_sort_order integer default 0
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $function$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_sort_order integer := coalesce(p_sort_order, 0);
  v_row public.departments%rowtype;
begin
  if not coalesce(pts_private.pts_my_is_system_admin(), false) then
    raise exception 'PTS administrator authorization required' using errcode = '42501';
  end if;
  if v_code !~ '^[a-z][a-z0-9_]{0,49}$' then
    raise exception 'Department code must use 1-50 lowercase letters, numbers or underscore; start with a letter'
      using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'Department name must contain 1-120 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(v_description, '')) > 1000 then
    raise exception 'Department description is too long' using errcode = '22023';
  end if;
  if v_sort_order not between 0 and 9999 then
    raise exception 'Department sort order must be 0-9999' using errcode = '22023';
  end if;

  insert into public.departments (code, name, description, sort_order)
  values (v_code, v_name, v_description, v_sort_order)
  returning * into v_row;

  insert into public.permission_audit_logs
    (actor_user_id, entity_type, entity_id, action_key, old_value, new_value)
  values
    ((select auth.uid()), 'department', v_row.id, 'create', null, to_jsonb(v_row));

  return v_row.id;
end;
$function$;

create or replace function pts_private.pts_admin_update_department(
  p_department_id uuid, p_name text, p_description text default null, p_sort_order integer default null
)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_before public.departments%rowtype;
  v_after public.departments%rowtype;
  v_sort_order integer;
begin
  if not coalesce(pts_private.pts_my_is_system_admin(), false) then
    raise exception 'PTS administrator authorization required' using errcode = '42501';
  end if;
  if p_department_id is null then
    raise exception 'Department not found' using errcode = 'P0002';
  end if;
  select * into v_before from public.departments where id = p_department_id for update;
  if not found then
    raise exception 'Department not found' using errcode = 'P0002';
  end if;
  v_sort_order := coalesce(p_sort_order, v_before.sort_order);
  if char_length(v_name) not between 1 and 120 then
    raise exception 'Department name must contain 1-120 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(v_description, '')) > 1000 then
    raise exception 'Department description is too long' using errcode = '22023';
  end if;
  if v_sort_order not between 0 and 9999 then
    raise exception 'Department sort order must be 0-9999' using errcode = '22023';
  end if;
  if v_before.name is not distinct from v_name
     and v_before.description is not distinct from v_description
     and v_before.sort_order is not distinct from v_sort_order then
    return false;
  end if;

  update public.departments
     set name = v_name, description = v_description,
         sort_order = v_sort_order, updated_at = now()
   where id = p_department_id
   returning * into v_after;

  insert into public.permission_audit_logs
    (actor_user_id, entity_type, entity_id, action_key, old_value, new_value)
  values
    ((select auth.uid()), 'department', p_department_id, 'update',
     to_jsonb(v_before), to_jsonb(v_after));
  return true;
end;
$function$;

create or replace function pts_private.pts_admin_set_department_active(
  p_department_id uuid, p_is_active boolean, p_reason text
)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $function$
declare
  v_before public.departments%rowtype;
  v_after public.departments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not coalesce(pts_private.pts_my_is_system_admin(), false) then
    raise exception 'PTS administrator authorization required' using errcode = '42501';
  end if;
  if p_department_id is null then
    raise exception 'Department not found' using errcode = 'P0002';
  end if;
  if p_is_active is null then
    raise exception 'New department active status must be specified' using errcode = '22023';
  end if;
  select * into v_before from public.departments where id = p_department_id for update;
  if not found then
    raise exception 'Department not found' using errcode = 'P0002';
  end if;
  if v_before.is_active = p_is_active then
    return false;
  end if;
  if char_length(v_reason) not between 1 and 500 then
    raise exception 'A reason of 1-500 characters is required to change department status'
      using errcode = '22023';
  end if;

  update public.departments
     set is_active = p_is_active, updated_at = now()
   where id = p_department_id
   returning * into v_after;

  insert into public.permission_audit_logs
    (actor_user_id, entity_type, entity_id, action_key, old_value, new_value, reason)
  values
    ((select auth.uid()), 'department', p_department_id,
     case when p_is_active then 'activate' else 'deactivate' end,
     to_jsonb(v_before), to_jsonb(v_after), v_reason);
  return true;
end;
$function$;

-- Public RPC wrappers: SECURITY INVOKER. Authorization is checked by private functions.
create or replace function public.pts_admin_departments()
returns table (
  id uuid, code text, name text, description text,
  is_active boolean, sort_order integer,
  member_count bigint, permission_count bigint,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security invoker set search_path = ''
as $function$
  select * from pts_private.pts_admin_list_departments();
$function$;

create or replace function public.pts_admin_create_department(
  p_code text, p_name text, p_description text default null, p_sort_order integer default 0
)
returns uuid
language sql volatile security invoker set search_path = ''
as $function$
  select pts_private.pts_admin_create_department(p_code, p_name, p_description, p_sort_order);
$function$;

create or replace function public.pts_admin_update_department(
  p_department_id uuid, p_name text, p_description text default null, p_sort_order integer default null
)
returns boolean
language sql volatile security invoker set search_path = ''
as $function$
  select pts_private.pts_admin_update_department(p_department_id, p_name, p_description, p_sort_order);
$function$;

create or replace function public.pts_admin_set_department_active(
  p_department_id uuid, p_is_active boolean, p_reason text
)
returns boolean
language sql volatile security invoker set search_path = ''
as $function$
  select pts_private.pts_admin_set_department_active(p_department_id, p_is_active, p_reason);
$function$;

-- Public functions are only callable by signed-in sessions.
-- New PostgreSQL functions otherwise grant EXECUTE to PUBLIC by default.
revoke all on function public.pts_admin_departments() from public, anon, authenticated, service_role;
revoke all on function public.pts_admin_create_department(text,text,text,integer) from public, anon, authenticated, service_role;
revoke all on function public.pts_admin_update_department(uuid,text,text,integer) from public, anon, authenticated, service_role;
revoke all on function public.pts_admin_set_department_active(uuid,boolean,text) from public, anon, authenticated, service_role;
grant execute on function public.pts_admin_departments() to authenticated;
grant execute on function public.pts_admin_create_department(text,text,text,integer) to authenticated;
grant execute on function public.pts_admin_update_department(uuid,text,text,integer) to authenticated;
grant execute on function public.pts_admin_set_department_active(uuid,boolean,text) to authenticated;

-- Private SECURITY DEFINER functions: avoid generic PUBLIC/anon access.
-- The shared pts_private schema already has USAGE for authenticated from Phase 02-A.
revoke all on function pts_private.pts_admin_list_departments() from public, anon, authenticated, service_role;
revoke all on function pts_private.pts_admin_create_department(text,text,text,integer) from public, anon, authenticated, service_role;
revoke all on function pts_private.pts_admin_update_department(uuid,text,text,integer) from public, anon, authenticated, service_role;
revoke all on function pts_private.pts_admin_set_department_active(uuid,boolean,text) from public, anon, authenticated, service_role;
grant execute on function pts_private.pts_admin_list_departments() to authenticated;
grant execute on function pts_private.pts_admin_create_department(text,text,text,integer) to authenticated;
grant execute on function pts_private.pts_admin_update_department(uuid,text,text,integer) to authenticated;
grant execute on function pts_private.pts_admin_set_department_active(uuid,boolean,text) to authenticated;
