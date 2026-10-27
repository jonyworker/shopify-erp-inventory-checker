-- PTS 小工具 | Phase 02-C2: 系統管理員唯讀查詢人員與有效權限
-- 這份 SQL 只建立／更新讀取函式，不建立帳號、不變更權限指派、不修改業務資料 RLS。
-- 先決條件：Phase 02-A、02-A fix、02-C1 已完成。
-- 建議使用 Supabase CLI Migration 執行，避免漏記遠端 Migration 歷史。
-- 權限計算來源維持同一套：部門聯集、角色聯集、個人 allow/deny、有效期間、前置權限。

begin;
-- (1) 單一有效權限計算核心。由 SECURITY DEFINER 的受控函式呼叫。
--     特別注意：這個接受 user_id 的內部函式不可直接開放給 authenticated。
create or replace function pts_private.pts_permission_details_for_user(p_target_user_id uuid)
returns table (
    permission_key text,
    tool_key text,
    action_key text,
    is_allowed boolean,
    grant_sources text[],
    blocked_by text[]
)
language sql stable security definer
set search_path = ''
as $function$
with recursive
identity as (
    select p_target_user_id as user_id,
           exists (
               select 1 from public.app_profiles ap
               where ap.user_id = p_target_user_id and ap.is_active = true
           ) as user_active
),
raw_permissions as (
    select
        pc.id,
        pc.permission_key,
        tc.tool_key,
        pc.action_key,
        pc.requires_permission_id,
        i.user_active,
        tc.is_active as tool_active,
        pc.is_active as permission_active,
        coalesce(ds.sources, array[]::text[]) as department_sources,
        coalesce(rs.sources, array[]::text[]) as role_sources,
        uo.effect as override_effect,
        (
            i.user_active
            and tc.is_active
            and pc.is_active
            and uo.effect is distinct from 'deny'
            and (
                cardinality(coalesce(ds.sources, array[]::text[])) > 0
                or cardinality(coalesce(rs.sources, array[]::text[])) > 0
                or uo.effect = 'allow'
            )
        ) as base_allowed
    from public.permission_catalog pc
    join public.tool_catalog tc on tc.id = pc.tool_id
    cross join identity i
    left join lateral (
        select array_agg('department:' || d.code order by d.code) as sources
        from public.user_departments ud
        join public.departments d
          on d.id = ud.department_id and d.is_active
        join public.department_permissions dp
          on dp.department_id = d.id and dp.permission_id = pc.id
        where ud.user_id = i.user_id
    ) ds on true
    left join lateral (
        select array_agg('role:' || br.code order by br.code) as sources
        from public.user_business_roles ubr
        join public.business_roles br
          on br.id = ubr.role_id and br.is_active
        join public.role_permissions rp
          on rp.role_id = br.id and rp.permission_id = pc.id
        where ubr.user_id = i.user_id
    ) rs on true
    left join public.user_permission_overrides uo
      on uo.user_id = i.user_id
     and uo.permission_id = pc.id
     and (uo.valid_from is null or uo.valid_from <= statement_timestamp())
     and (uo.valid_until is null or uo.valid_until > statement_timestamp())
),
-- Resolve every ancestor prerequisite; flag cycles as invalid (fail closed).
dependency_chain as (
    select
        rp.id as root_id,
        rp.requires_permission_id as required_id,
        array[rp.id] as visited,
        false as has_cycle
    from raw_permissions rp
    where rp.requires_permission_id is not null

    union all

    select
        dc.root_id,
        dep.requires_permission_id,
        dc.visited || dep.id,
        dep.id = any(dc.visited)
    from dependency_chain dc
    join raw_permissions dep on dep.id = dc.required_id
    where dc.required_id is not null and not dc.has_cycle
),
resolved as (
    select
        rp.*,
        not exists (
            select 1
            from dependency_chain dc
            left join raw_permissions dep on dep.id = dc.required_id
            where dc.root_id = rp.id
              and (dc.has_cycle or (dc.required_id is not null and not coalesce(dep.base_allowed, false)))
        ) as dependencies_allowed,
        coalesce((
            select array_agg(distinct
                case when dc.has_cycle then 'dependency_cycle'
                     else 'requires:' || coalesce(dep.permission_key, 'unknown') end
            )
            from dependency_chain dc
            left join raw_permissions dep on dep.id = dc.required_id
            where dc.root_id = rp.id
              and (dc.has_cycle or (dc.required_id is not null and not coalesce(dep.base_allowed, false)))
        ), array[]::text[]) as dependency_blockers
    from raw_permissions rp
)
select
    r.permission_key,
    r.tool_key,
    r.action_key,
    (r.base_allowed and r.dependencies_allowed) as is_allowed,
    (
        r.department_sources || r.role_sources ||
        case when r.override_effect = 'allow'
                 then array['individual:allow']::text[] else array[]::text[] end
        ) as grant_sources,
    (
        array_remove(array[
                         case when not r.user_active then 'inactive_user'::text end,
                     case when not r.tool_active then 'inactive_tool'::text end,
                     case when not r.permission_active then 'inactive_permission'::text end,
                     case when r.override_effect = 'deny' then 'individual:deny'::text end,
                     case when cardinality(r.department_sources) = 0
                         and cardinality(r.role_sources) = 0
                         and r.override_effect is distinct from 'allow'
                         then 'no_grant'::text end
                         ], null::text)
            || r.dependency_blockers
        ) as blocked_by
from resolved r
order by r.tool_key, r.action_key;
$function$;
revoke all on function pts_private.pts_permission_details_for_user(uuid)
    from public, anon, authenticated, service_role;
-- (2) 原本的「查我的權限」改用相同核心；既有 Vue/RLS API 名稱完全不變。
create or replace function pts_private.pts_my_permission_details()
returns table (
    permission_key text,
    tool_key text,
    action_key text,
    is_allowed boolean,
    grant_sources text[],
    blocked_by text[]
)
language sql stable security definer
set search_path = ''
as $function$
select * from pts_private.pts_permission_details_for_user((select auth.uid()));
$function$;
revoke all on function pts_private.pts_my_permission_details()
    from public, anon, service_role;
grant execute on function pts_private.pts_my_permission_details()
    to authenticated;
-- (3) 管理員專用人員目錄。不讀取 Auth 密碼或 Email，也不洩漏 Email。
create or replace function pts_private.pts_admin_list_users()
returns table (
    user_id uuid,
    username text,
    display_name text,
    is_active boolean,
    is_system_admin boolean,
    created_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $function$
begin
    if not coalesce(pts_private.pts_my_is_system_admin(), false) then
        raise exception 'PTS administrator authorization required'
            using errcode = '42501';
end if;

return query
select
    ap.user_id,
    ap.username,
    ap.display_name,
    ap.is_active,
    (sa.user_id is not null) as is_system_admin,
    ap.created_at
from public.app_profiles ap
         left join public.system_admins sa on sa.user_id = ap.user_id
order by ap.is_active desc, ap.created_at asc, ap.user_id;
end;
$function$;
-- (4) 管理員查特定使用者有效權限；必須先驗證呼叫者，不接受客戶端宣告自己是管理員。
create or replace function pts_private.pts_admin_user_permission_details(p_target_user_id uuid)
returns table (
    permission_key text,
    tool_key text,
    action_key text,
    is_allowed boolean,
    grant_sources text[],
    blocked_by text[]
)
language plpgsql stable security definer
set search_path = ''
as $function$
begin
    if not coalesce(pts_private.pts_my_is_system_admin(), false) then
        raise exception 'PTS administrator authorization required'
            using errcode = '42501';
end if;

    if p_target_user_id is null or not exists (
        select 1 from public.app_profiles ap
        where ap.user_id = p_target_user_id
    ) then
        raise exception 'PTS profile not found' using errcode = 'P0002';
end if;

return query
select d.*
from pts_private.pts_permission_details_for_user(p_target_user_id) d;
end;
$function$;
-- (5) public API：使用呼叫者權限，真正的身份驗證寫在上方 private 函式。
create or replace function public.pts_admin_users()
returns table (
    user_id uuid,
    username text,
    display_name text,
    is_active boolean,
    is_system_admin boolean,
    created_at timestamptz
)
language sql stable security invoker
set search_path = ''
as $function$
select * from pts_private.pts_admin_list_users();
$function$;
create or replace function public.pts_admin_user_permissions(p_target_user_id uuid)
returns table (
    permission_key text,
    tool_key text,
    action_key text,
    is_allowed boolean,
    grant_sources text[],
    blocked_by text[]
)
language sql stable security invoker
set search_path = ''
as $function$
select * from pts_private.pts_admin_user_permission_details(p_target_user_id);
$function$;
-- (6) 最小權限：私人核心不允許一般使用者直接給任意 user_id。
--     只把需要進入 private 管理員檢查函式的 EXECUTE 授予 authenticated。
revoke all on function pts_private.pts_admin_list_users()
    from public, anon, authenticated, service_role;
revoke all on function pts_private.pts_admin_user_permission_details(uuid)
    from public, anon, authenticated, service_role;
grant usage on schema pts_private to authenticated;
grant execute on function pts_private.pts_admin_list_users()
    to authenticated;
grant execute on function pts_private.pts_admin_user_permission_details(uuid)
    to authenticated;
revoke all on function public.pts_admin_users()
    from public, anon, authenticated, service_role;
revoke all on function public.pts_admin_user_permissions(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.pts_admin_users()
    to authenticated;
grant execute on function public.pts_admin_user_permissions(uuid)
    to authenticated;
comment on function public.pts_admin_users() is
    'Read-only PTS personnel directory: active system admins only; excludes Auth email.';
comment on function public.pts_admin_user_permissions(uuid) is
    'Read-only effective permissions for a PTS profile: active system admins only.';
comment on function pts_private.pts_permission_details_for_user(uuid) is
    'Private shared evaluator, not directly executable by authenticated or anon.';
-- 讓 Supabase Data API 重新載入 RPC 定義。
notify pgrst, 'reload schema';
commit;
