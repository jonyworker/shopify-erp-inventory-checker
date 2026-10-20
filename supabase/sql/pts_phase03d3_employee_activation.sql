-- PTS Phase 03-D3: secure first-time employee activation (scheme B).
-- Deploy after Phase 03-D1. Never place this backup/verify file in migrations directly;
-- paste into a CLI-generated TIMESTAMPED migration file.
-- Does not alter existing admin, legacy users or business permissions.

alter table pts_private.pts_employee_onboarding
  add column if not exists activation_claim_token uuid,
  add column if not exists activation_claim_expires_at timestamptz;

-- Either both reservation fields are set or neither is set.
alter table pts_private.pts_employee_onboarding
  add constraint pts_employee_onboarding_claim_fields_match
  check ((activation_claim_token is null) = (activation_claim_expires_at is null));

-- Stage 1. Verify pending profile + 30-day one-time code under a row lock.
-- Caller hashes `${userId}:${temporaryCode}` in its server-side Edge Function.
-- The 5-attempt lock persists and can only be reset through a future admin reissue workflow.
create or replace function public.pts_service_begin_employee_activation(
  p_target_user_id uuid,
  p_code_hash text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_record record;
begin
  if p_target_user_id is null or p_claim_token is null
     or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select
    ap.is_active,
    ap.must_change_password,
    o.code_hash,
    o.expires_at,
    o.failed_attempts,
    o.consumed_at,
    o.activation_claim_expires_at
  into v_record
  from pts_private.pts_employee_onboarding o
  join public.app_profiles ap on ap.user_id = o.user_id
  where o.user_id = p_target_user_id
  for update of o;

  if not found
    or v_record.is_active
    or not v_record.must_change_password
    or v_record.consumed_at is not null
    or v_record.expires_at <= statement_timestamp()
    or v_record.failed_attempts >= 5
    or v_record.activation_claim_expires_at > statement_timestamp()
  then
    return false;
  end if;

  if v_record.code_hash <> p_code_hash then
    update pts_private.pts_employee_onboarding
       set failed_attempts = failed_attempts + 1
     where user_id = p_target_user_id;
    return false;
  end if;

  update pts_private.pts_employee_onboarding
     set activation_claim_token = p_claim_token,
         activation_claim_expires_at = statement_timestamp() + interval '3 minutes'
   where user_id = p_target_user_id;

  return true;
end;
$function$;

-- Stage 2. Called only after Auth admin API successfully changes the new password
-- WHILE the Auth user is still banned. This transaction marks the code consumed,
-- activates the PTS profile, and audits activation together.
create or replace function public.pts_service_finish_employee_activation(
  p_target_user_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_record record;
begin
  if p_target_user_id is null or p_claim_token is null then
    return false;
  end if;

  select
    ap.is_active,
    ap.must_change_password,
    o.activation_claim_token,
    o.activation_claim_expires_at,
    o.consumed_at
  into v_record
  from pts_private.pts_employee_onboarding o
  join public.app_profiles ap on ap.user_id = o.user_id
  where o.user_id = p_target_user_id
  for update of o;

  if not found
    or v_record.is_active
    or not v_record.must_change_password
    or v_record.consumed_at is not null
    or v_record.activation_claim_token is distinct from p_claim_token
    or v_record.activation_claim_expires_at <= statement_timestamp()
  then
    return false;
  end if;

  update public.app_profiles
     set is_active = true,
         must_change_password = false,
         updated_at = now()
   where user_id = p_target_user_id
     and is_active = false
     and must_change_password = true;

  if not found then return false; end if;

  update pts_private.pts_employee_onboarding
     set consumed_at = now(),
         activation_claim_token = null,
         activation_claim_expires_at = null
   where user_id = p_target_user_id;

  insert into public.permission_audit_logs (
    actor_user_id, target_user_id, entity_type, entity_id,
    action_key, old_value, new_value, reason
  ) values (
    p_target_user_id, p_target_user_id, 'employee_account', p_target_user_id,
    'complete_onboarding',
    jsonb_build_object('is_active', false, 'must_change_password', true),
    jsonb_build_object('is_active', true, 'must_change_password', false),
    'Employee completed initial password setup; Auth ban is lifted separately'
  );

  return true;
end;
$function$;

-- On an Auth password-write failure, release only our matching reservation.
-- The original one-time code remains valid if it has not expired or been locked.
create or replace function public.pts_service_release_employee_activation(
  p_target_user_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_target_user_id is null or p_claim_token is null then
    return false;
  end if;

  update pts_private.pts_employee_onboarding
     set activation_claim_token = null,
         activation_claim_expires_at = null
   where user_id = p_target_user_id
     and consumed_at is null
     and activation_claim_token = p_claim_token;

  return found;
end;
$function$;

-- These are privileged service-only operations. The browser cannot execute them.
revoke all on function public.pts_service_begin_employee_activation(uuid,text,uuid)
  from public, anon, authenticated;
revoke all on function public.pts_service_finish_employee_activation(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.pts_service_release_employee_activation(uuid,uuid)
  from public, anon, authenticated;

grant execute on function public.pts_service_begin_employee_activation(uuid,text,uuid)
  to service_role;
grant execute on function public.pts_service_finish_employee_activation(uuid,uuid)
  to service_role;
grant execute on function public.pts_service_release_employee_activation(uuid,uuid)
  to service_role;
