-- Phase 02-C2 驗證 SQL
-- 請「分段執行」，方便看每一項結果。
-- SQL Editor 模擬 authenticated 是測試用途；不要將下方查詢放進前端程式。

-- [A] 管理員帳號身分與 RPC 函式是否存在
select
    to_regprocedure('public.pts_admin_users()') is not null as has_user_list_rpc,
    to_regprocedure('public.pts_admin_user_permissions(uuid)') is not null as has_user_permissions_rpc,
    has_function_privilege('anon', 'public.pts_admin_users()', 'EXECUTE') as anon_can_list,
    has_function_privilege('authenticated', 'pts_private.pts_permission_details_for_user(uuid)', 'EXECUTE') as authenticated_can_call_unrestricted_engine;
-- 預期：true, true, false, false

-- [B] 模擬 admin JWT。預期第一個 SELECT 看到人員列表（目前通常是 2 人），
--     第二個 SELECT 回傳 32 筆（對 admin 本人計算）。
begin;
select set_config('request.jwt.claim.sub', (
    select ap.user_id::text from public.app_profiles ap where ap.username = 'admin'
), true);
set local role authenticated;
select username, display_name, is_active, is_system_admin
from public.pts_admin_users();
select count(*) as own_permission_count
from public.pts_admin_user_permissions((select auth.uid()));
rollback;

-- [C] 非管理員拒絕測試。請與 [B] 分開執行，預期拋出
--     ERROR: PTS administrator authorization required (SQLSTATE 42501)。
--     目前舊共用帳號是 username IS NULL；若未來已更改，請自行指定非管理員 user_id。
begin;
select set_config('request.jwt.claim.sub', (
    select ap.user_id::text from public.app_profiles ap
    where ap.username is null order by ap.created_at limit 1
), true);
set local role authenticated;
select count(*) from public.pts_admin_users();
rollback;
