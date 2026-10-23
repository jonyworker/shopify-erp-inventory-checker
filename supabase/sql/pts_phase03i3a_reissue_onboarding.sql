-- Phase 03-I3A: Reissue a one-time onboarding credential for an EXISTING pending account.
-- This migration DOES NOT rotate any actual credential, activate, or delete an account.
-- API assumes service_role only and a valid administrator JWT checked at the Edge Function.

CREATE OR REPLACE FUNCTION pts_private.pts_service_reissue_pending_employee_credential(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_confirm_username text,
  p_code_hash text,
  p_expires_at timestamptz,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_target public.app_profiles%ROWTYPE;
  v_onboarding pts_private.pts_employee_onboarding%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_banned_until timestamptz;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_actor_user_id = p_target_user_id
     OR char_length(v_reason) NOT BETWEEN 1 AND 500
     OR p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '31 days'
  THEN
    RAISE EXCEPTION 'Invalid credential reissue request' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.app_profiles ap
    JOIN public.system_admins sa ON sa.user_id = ap.user_id
    JOIN auth.users au ON au.id = ap.user_id
    WHERE ap.user_id = p_actor_user_id AND ap.is_active AND NOT ap.must_change_password
      AND (au.banned_until IS NULL OR au.banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'PTS administrator authorization required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target FROM public.app_profiles ap
  WHERE ap.user_id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE = 'P0002'; END IF;

  IF v_target.username IS DISTINCT FROM p_confirm_username THEN
    RAISE EXCEPTION 'Username confirmation mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_target.is_active OR NOT v_target.must_change_password
     OR v_target.username IS NULL OR v_target.display_name IS NULL
     OR EXISTS (SELECT 1 FROM public.system_admins WHERE user_id = p_target_user_id)
     OR EXISTS (SELECT 1 FROM pts_private.pts_superusers WHERE user_id = p_target_user_id)
     OR EXISTS (SELECT 1 FROM pts_private.pts_deleted_employee_archives WHERE former_user_id = p_target_user_id)
  THEN
    RAISE EXCEPTION 'Employee is not eligible for onboarding credential reissue' USING ERRCODE = '42501';
  END IF;

  SELECT au.banned_until INTO v_banned_until FROM auth.users au WHERE au.id = p_target_user_id;
  IF NOT FOUND OR v_banned_until IS NULL OR v_banned_until < now() + interval '1 day'
     OR EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = p_target_user_id)
  THEN
    RAISE EXCEPTION 'Employee Auth state must be safely blocked' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_onboarding FROM pts_private.pts_employee_onboarding o
  WHERE o.user_id = p_target_user_id FOR UPDATE;
  IF NOT FOUND OR v_onboarding.consumed_at IS NOT NULL
     OR v_onboarding.activation_claim_expires_at > now()
  THEN
    RAISE EXCEPTION 'Onboarding credential is unavailable or currently in use' USING ERRCODE = '42501';
  END IF;

  UPDATE pts_private.pts_employee_onboarding
  SET code_hash = p_code_hash,
      expires_at = p_expires_at,
      failed_attempts = 0,
      activation_claim_token = NULL,
      activation_claim_expires_at = NULL
  WHERE user_id = p_target_user_id;

  INSERT INTO public.permission_audit_logs (
    actor_user_id,target_user_id,entity_type,entity_id,action_key,old_value,new_value,reason
  ) VALUES (
    p_actor_user_id,p_target_user_id,'employee_account',p_target_user_id,'reissue_onboarding_credential',
    jsonb_build_object('previous_expires_at',v_onboarding.expires_at,'previous_attempts',v_onboarding.failed_attempts),
    jsonb_build_object('expires_at',p_expires_at,'pending',true),
    v_reason
  );

  RETURN jsonb_build_object('success',true,'user_id',p_target_user_id,
   'username',v_target.username,'display_name',v_target.display_name,
   'temporary_password_expires_at',p_expires_at);
END;
$function$;

-- Service credential changes cannot be invoked from frontend SQL/RPC with an ordinary JWT.
REVOKE ALL ON FUNCTION pts_private.pts_service_reissue_pending_employee_credential(uuid,uuid,text,text,timestamptz,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pts_private.pts_service_reissue_pending_employee_credential(uuid,uuid,text,text,timestamptz,text)
  TO service_role;

-- RPC exposed to admin UI just to distinguish pending vs deactivated accounts.
CREATE OR REPLACE FUNCTION pts_private.pts_admin_list_pending_onboarding_users()
RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NOT coalesce(pts_private.pts_my_is_system_admin(),false)
     OR NOT coalesce(pts_private.pts_employee_business_session_active(),false)
  THEN RAISE EXCEPTION 'PTS administrator authorization required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT ap.user_id FROM public.app_profiles ap
    JOIN pts_private.pts_employee_onboarding o ON o.user_id = ap.user_id
    WHERE ap.is_active = false AND ap.must_change_password = true
      AND o.consumed_at IS NULL
    ORDER BY ap.user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pts_admin_pending_onboarding_users()
RETURNS TABLE(user_id uuid)
LANGUAGE sql STABLE SET search_path = '' AS $function$
  SELECT * FROM pts_private.pts_admin_list_pending_onboarding_users();
$function$;

REVOKE ALL ON FUNCTION pts_private.pts_admin_list_pending_onboarding_users() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pts_admin_pending_onboarding_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pts_private.pts_admin_list_pending_onboarding_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pts_admin_pending_onboarding_users() TO authenticated;

-- PostgREST can call public functions only; delegate as service_role to private function.
CREATE OR REPLACE FUNCTION public.pts_service_reissue_pending_employee_credential(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_confirm_username text,
  p_code_hash text,
  p_expires_at timestamptz,
  p_reason text
)
RETURNS jsonb
LANGUAGE sql
SET search_path = ''
AS $function$
  SELECT pts_private.pts_service_reissue_pending_employee_credential(
    p_actor_user_id,p_target_user_id,p_confirm_username,p_code_hash,p_expires_at,p_reason
  );
$function$;
REVOKE ALL ON FUNCTION public.pts_service_reissue_pending_employee_credential(uuid,uuid,text,text,timestamptz,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pts_service_reissue_pending_employee_credential(uuid,uuid,text,text,timestamptz,text)
  TO service_role;
