create or replace function pts_private.pts_my_permission_details()
returns table (permission_key text,tool_key text,action_key text,is_allowed boolean,grant_sources text[],blocked_by text[])
language sql stable security definer set search_path = ''
as $$
with recursive identity as (
 select (select auth.uid()) as user_id,
  exists(select 1 from public.app_profiles ap where ap.user_id=(select auth.uid()) and ap.is_active=true) as user_active
), raw_permissions as (
 select pc.id, pc.permission_key,tc.tool_key,pc.action_key,pc.requires_permission_id,
 i.user_active,tc.is_active as tool_active,pc.is_active as permission_active,
 coalesce(ds.sources,array[]::text[]) as department_sources,
 coalesce(rs.sources,array[]::text[]) as role_sources,
 uo.effect as override_effect,
 (i.user_active and tc.is_active and pc.is_active and uo.effect is distinct from 'deny' and
 (cardinality(coalesce(ds.sources,array[]::text[]))>0 or cardinality(coalesce(rs.sources,array[]::text[]))>0 or uo.effect='allow')) as base_allowed
 from public.permission_catalog pc join public.tool_catalog tc on tc.id=pc.tool_id
 cross join identity i
 left join lateral (
   select array_agg('department:'||d.code order by d.code) as sources
   from public.user_departments ud join public.departments d on d.id=ud.department_id and d.is_active
   join public.department_permissions dp on dp.department_id=d.id and dp.permission_id=pc.id
   where ud.user_id=i.user_id
 ) ds on true
 left join lateral (
   select array_agg('role:'||br.code order by br.code) as sources
   from public.user_business_roles ubr join public.business_roles br on br.id=ubr.role_id and br.is_active
   join public.role_permissions rp on rp.role_id=br.id and rp.permission_id=pc.id
   where ubr.user_id=i.user_id
 ) rs on true
 left join public.user_permission_overrides uo on uo.user_id=i.user_id and uo.permission_id=pc.id
   and (uo.valid_from is null or uo.valid_from<=statement_timestamp())
   and (uo.valid_until is null or uo.valid_until>statement_timestamp())
), dependency_chain as (
 select rp.id as root_id,rp.requires_permission_id as required_id,array[rp.id] as visited,false as has_cycle
 from raw_permissions rp where rp.requires_permission_id is not null
 union all
 select dc.root_id,dep.requires_permission_id,dc.visited||dep.id,dep.id=any(dc.visited)
 from dependency_chain dc join raw_permissions dep on dep.id=dc.required_id
 where dc.required_id is not null and not dc.has_cycle
), resolved as (
 select rp.*,not exists (
  select 1 from dependency_chain dc left join raw_permissions dep on dep.id=dc.required_id
  where dc.root_id=rp.id and (dc.has_cycle or not coalesce(dep.base_allowed,false))
 ) as dependencies_allowed,
 coalesce((
  select array_agg(distinct case when dc.has_cycle then 'dependency_cycle'
   else 'requires:'||coalesce(dep.permission_key,'unknown') end)
  from dependency_chain dc left join raw_permissions dep on dep.id=dc.required_id
  where dc.root_id=rp.id and (dc.has_cycle or not coalesce(dep.base_allowed,false))
 ),array[]::text[]) as dependency_blockers
 from raw_permissions rp
)
select r.permission_key,r.tool_key,r.action_key,
(r.base_allowed and r.dependencies_allowed) as is_allowed,
(r.department_sources||r.role_sources||
 case when r.override_effect='allow' then array['individual:allow']::text[] else array[]::text[] end) as grant_sources,
(array_remove(array[
  case when not r.user_active then 'inactive_user'::text end,
  case when not r.tool_active then 'inactive_tool'::text end,
  case when not r.permission_active then 'inactive_permission'::text end,
  case when r.override_effect='deny' then 'individual:deny'::text end,
  case when cardinality(r.department_sources)=0 and cardinality(r.role_sources)=0
        and r.override_effect is distinct from 'allow' then 'no_grant'::text end
],null::text)||r.dependency_blockers) as blocked_by
from resolved r order by r.tool_key,r.action_key;
$$;
create or replace function pts_private.pts_my_is_system_admin()
returns boolean language sql stable security definer set search_path=''
as $$
select exists(select 1 from public.app_profiles ap
 join public.system_admins sa on sa.user_id=ap.user_id
 where ap.user_id=(select auth.uid()) and ap.is_active);
$$;
create or replace function public.pts_my_permissions()
returns table (permission_key text,tool_key text,action_key text,is_allowed boolean,grant_sources text[],blocked_by text[])
language sql stable security invoker set search_path=''
as $$select * from pts_private.pts_my_permission_details();$$;
create or replace function public.pts_can(p_permission_key text)
returns boolean language sql stable security invoker set search_path=''
as $$select coalesce((select p.is_allowed from pts_private.pts_my_permission_details() p where p.permission_key=p_permission_key),false);$$;
create or replace function public.pts_is_system_admin()
returns boolean language sql stable security invoker set search_path=''
as $$select pts_private.pts_my_is_system_admin();$$;
grant usage on schema pts_private to authenticated;
revoke all on function pts_private.pts_my_permission_details() from public,anon;
revoke all on function pts_private.pts_my_is_system_admin() from public,anon;
grant execute on function pts_private.pts_my_permission_details() to authenticated;
grant execute on function pts_private.pts_my_is_system_admin() to authenticated;
revoke all on function public.pts_my_permissions() from public,anon;
revoke all on function public.pts_can(text) from public,anon;
revoke all on function public.pts_is_system_admin() from public,anon;
grant execute on function public.pts_my_permissions() to authenticated;
grant execute on function public.pts_can(text) to authenticated;
grant execute on function public.pts_is_system_admin() to authenticated;
comment on function public.pts_my_permissions() is 'Current authenticated user only: effective permissions and inheritance sources.';
comment on function public.pts_can(text) is 'Current authenticated user only: permission check, suitable for future business RLS.';
comment on function public.pts_is_system_admin() is 'Current authenticated user only: explicit system admin membership; not business permissions.';;
