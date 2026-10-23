-- V5：權限矩陣所需的完整前置權限關係，管理員唯讀 API。
-- 不變更現有權限資料及判斷邏輯。
begin;
create or replace function public.pts_admin_permission_dependencies()
returns table (permission_key text, requires_permission_key text)
language plpgsql stable security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.app_profiles ap
    join public.system_admins sa on sa.user_id = ap.user_id
    where ap.user_id = (select auth.uid()) and ap.is_active = true
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select pc.permission_key, prerequisite.permission_key
    from public.permission_catalog pc
    left join public.permission_catalog prerequisite on prerequisite.id = pc.requires_permission_id
    order by pc.permission_key;
end;
$function$;
revoke all on function public.pts_admin_permission_dependencies() from public, anon, authenticated;
grant execute on function public.pts_admin_permission_dependencies() to authenticated;
comment on function public.pts_admin_permission_dependencies() is 'Admin-only read of complete permission prerequisites for unsaved draft impact preview.';
commit;
