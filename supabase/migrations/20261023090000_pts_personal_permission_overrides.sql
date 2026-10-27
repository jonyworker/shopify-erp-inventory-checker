-- PTS / Individual permission overrides: admin-only RPC, audit, and optional Taiwan-local expiry date.
begin;
create or replace function pts_private.pts_admin_user_overrides(p_target_user_id uuid)
returns table (
 permission_key text, tool_key text, tool_label text, action_key text,
 action_label text, is_available boolean, effect text, valid_until timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
 if not coalesce(pts_private.pts_my_is_system_admin(), false) then
   raise exception 'PTS administrator authorization required' using errcode='42501';
 end if;
 if p_target_user_id is null or not exists (select 1 from public.app_profiles where user_id=p_target_user_id) then
   raise exception 'User not found' using errcode='P0002';
 end if;
 return query
 select pc.permission_key, tc.tool_key, tc.label, pc.action_key, pc.label,
        (tc.is_active and pc.is_active), uo.effect, uo.valid_until
 from public.permission_catalog pc
 join public.tool_catalog tc on tc.id=pc.tool_id
 left join public.user_permission_overrides uo on uo.user_id=p_target_user_id and uo.permission_id=pc.id
 order by tc.sort_order, tc.tool_key, pc.action_key;
end; $$;
create or replace function pts_private.pts_admin_save_user_override(
 p_target_user_id uuid, p_permission_key text, p_effect text, p_valid_until_date date
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
 v_actor uuid := (select auth.uid());
 v_permission public.permission_catalog%rowtype;
 v_old public.user_permission_overrides%rowtype;
 v_old_json jsonb;
 v_new_json jsonb;
 v_until timestamptz;
begin
 if not coalesce(pts_private.pts_my_is_system_admin(), false) then
   raise exception 'PTS administrator authorization required' using errcode='42501';
 end if;
 if p_target_user_id is null or not exists (
  select 1 from public.app_profiles where user_id=p_target_user_id and is_active
 ) then raise exception 'Active user required' using errcode='22023'; end if;
 if p_effect is null or p_effect not in ('inherit','allow','deny') then
   raise exception 'Invalid override mode' using errcode='22023';
 end if;
 select pc.* into v_permission from public.permission_catalog pc
 join public.tool_catalog tc on tc.id=pc.tool_id
 where pc.permission_key=p_permission_key and pc.is_active and tc.is_active;
 if not found then raise exception 'Permission unknown or inactive' using errcode='22023'; end if;
 -- A dated grant expires at midnight at the END of the selected calendar day, Asia/Taipei.
 if p_effect <> 'inherit' and p_valid_until_date is not null then
   if p_valid_until_date < (statement_timestamp() at time zone 'Asia/Taipei')::date then
     raise exception 'Expiry date cannot be in the past' using errcode='22023';
   end if;
   v_until := ((p_valid_until_date + 1)::timestamp at time zone 'Asia/Taipei');
 end if;
 -- Serialize concurrent writes for this (user, permission) even if row absent.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_target_user_id::text || ':' || v_permission.id::text, 0));
 select * into v_old from public.user_permission_overrides
 where user_id=p_target_user_id and permission_id=v_permission.id for update;
 v_old_json := case when v_old.user_id is null then null else
   jsonb_build_object('effect',v_old.effect,'valid_from',v_old.valid_from,'valid_until',v_old.valid_until) end;
 v_new_json := case when p_effect='inherit' then null else
   jsonb_build_object('effect',p_effect,'valid_from',null,'valid_until',v_until) end;
 if v_old_json is not distinct from v_new_json then return false; end if;
 if p_effect='inherit' then
   delete from public.user_permission_overrides
   where user_id=p_target_user_id and permission_id=v_permission.id;
 else
   insert into public.user_permission_overrides
     (user_id,permission_id,effect,valid_from,valid_until,created_by,updated_by,reason)
   values(p_target_user_id,v_permission.id,p_effect,null,v_until,v_actor,v_actor,'管理介面調整個人權限')
   on conflict(user_id,permission_id) do update set
     effect=excluded.effect, valid_from=null,valid_until=excluded.valid_until,
     updated_by=v_actor,updated_at=statement_timestamp(),reason='管理介面調整個人權限';
 end if;
 insert into public.permission_audit_logs
   (actor_user_id,target_user_id,entity_type,entity_id,action_key,old_value,new_value,reason)
 values(v_actor,p_target_user_id,'user_permission',v_permission.id,'set_override',v_old_json,v_new_json,
        left('管理介面調整個人權限：' || p_permission_key || ' → ' || p_effect,500));
 return true;
end; $$;
create or replace function public.pts_admin_user_overrides(p_target_user_id uuid)
returns table(permission_key text, tool_key text, tool_label text, action_key text,
 action_label text, is_available boolean, effect text, valid_until timestamptz)
language sql stable security invoker set search_path='' as $$
 select * from pts_private.pts_admin_user_overrides(p_target_user_id);
$$;
create or replace function public.pts_admin_save_user_override(
 p_target_user_id uuid, p_permission_key text, p_effect text, p_valid_until_date date default null
)
returns boolean language sql security invoker set search_path='' as $$
 select pts_private.pts_admin_save_user_override(p_target_user_id,p_permission_key,p_effect,p_valid_until_date);
$$;
revoke all on function pts_private.pts_admin_user_overrides(uuid) from public,anon,authenticated,service_role;
revoke all on function pts_private.pts_admin_save_user_override(uuid,text,text,date) from public,anon,authenticated,service_role;
revoke all on function public.pts_admin_user_overrides(uuid) from public,anon,authenticated,service_role;
revoke all on function public.pts_admin_save_user_override(uuid,text,text,date) from public,anon,authenticated,service_role;
grant execute on function pts_private.pts_admin_user_overrides(uuid) to authenticated;
grant execute on function pts_private.pts_admin_save_user_override(uuid,text,text,date) to authenticated;
grant execute on function public.pts_admin_user_overrides(uuid) to authenticated;
grant execute on function public.pts_admin_save_user_override(uuid,text,text,date) to authenticated;
notify pgrst, 'reload schema';
commit;
