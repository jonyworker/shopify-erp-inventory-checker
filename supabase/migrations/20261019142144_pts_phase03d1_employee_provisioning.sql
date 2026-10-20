-- PTS Phase 03-D1: Secure pending employee provisioning.
-- Copy the complete content to a timestamped file made with:
-- npx supabase migration new pts_phase03d1_employee_provisioning
-- No existing account is disabled or modified by this migration.

alter table public.app_profiles
    add column if not exists must_change_password boolean not null default false;

-- A pending account cannot accidentally be activated before its initial
-- password has been changed through the dedicated completion workflow.
do $ddl$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.app_profiles'::regclass
      and conname = 'app_profiles_pending_cannot_be_active'
  ) then
alter table public.app_profiles
    add constraint app_profiles_pending_cannot_be_active
        check (not (must_change_password and is_active));
end if;
end
$ddl$;

-- Pending onboarding secrets live outside exposed public schema.
-- The "temporary password" handed to the employee is an enrollment secret;
-- it is NOT the Supabase Auth user's password. This prevents any session
-- before the secure initial-password completion flow is implemented.
create table if not exists pts_private.pts_employee_onboarding (
                                                                   user_id uuid primary key references auth.users(id) on delete cascade,
    code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
    expires_at timestamptz not null,
    failed_attempts integer not null default 0 check (failed_attempts >= 0),
    consumed_at timestamptz,
    created_at timestamptz not null default now()
    );

-- Private schema is not exposed through PostgREST by default; RLS is added
-- for defense in depth, and the table is not writable from client roles.
alter table pts_private.pts_employee_onboarding enable row level security;
revoke all on pts_private.pts_employee_onboarding from public, anon, authenticated;

-- Service-role-only RPC, called exclusively by the trusted Edge Function.
-- A single transaction creates the pending profile, onboarding code HASH
-- and the audit trail. No temporary plaintext is ever stored in the DB.
create or replace function public.pts_service_register_employee(
    p_actor_user_id uuid,
    p_new_user_id uuid,
    p_username text,
    p_display_name text,
    p_code_hash text,
    p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
v_username text := lower(btrim(coalesce(p_username, '')));
  v_display_name text := btrim(coalesce(p_display_name, ''));
begin
  if p_actor_user_id is null or not exists (
    select 1
    from public.app_profiles ap
    join public.system_admins sa on sa.user_id = ap.user_id
    where ap.user_id = p_actor_user_id and ap.is_active
  ) then
    raise exception 'PTS administrator authorization required'
      using errcode = '42501';
end if;

  if p_new_user_id is null or not exists (
    select 1 from auth.users u where u.id = p_new_user_id
  ) then
    raise exception 'New Supabase Auth user does not exist'
      using errcode = '22023';
end if;

  if v_username !~ '^[a-z][a-z0-9._-]{1,30}[a-z0-9]$' then
    raise exception 'Invalid username format'
      using errcode = '22023';
end if;

  if char_length(v_display_name) not between 1 and 120 then
    raise exception 'Display name length must be 1-120'
      using errcode = '22023';
end if;

  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid onboarding code hash'
      using errcode = '22023';
end if;

  if p_expires_at is null or p_expires_at <= now()
     or p_expires_at > now() + interval '31 days' then
    raise exception 'Invalid onboarding expiration'
      using errcode = '22023';
end if;

insert into public.app_profiles (
    user_id, username, display_name, is_active, must_change_password
) values (
             p_new_user_id, v_username, v_display_name, false, true
         );

insert into pts_private.pts_employee_onboarding (
    user_id, code_hash, expires_at
) values (p_new_user_id, p_code_hash, p_expires_at);

insert into public.permission_audit_logs (
    actor_user_id, target_user_id, entity_type, entity_id,
    action_key, old_value, new_value, reason
) values (
             p_actor_user_id, p_new_user_id, 'employee_account', p_new_user_id,
             'create_pending', null,
             jsonb_build_object(
                     'username', v_username,
                     'display_name', v_display_name,
                     'is_active', false,
                     'must_change_password', true,
                     'expires_at', p_expires_at
             ),
             'Created pending employee account with one-time temporary onboarding password'
         );

return p_new_user_id;
end;
$function$;

-- PostgreSQL grants EXECUTE on functions to PUBLIC by default: revoke it.
revoke all on function public.pts_service_register_employee(uuid, uuid, text, text, text, timestamptz)
    from public, anon, authenticated;
grant execute on function public.pts_service_register_employee(uuid, uuid, text, text, text, timestamptz)
  to service_role;
