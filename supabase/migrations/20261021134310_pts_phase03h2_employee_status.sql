-- PTS Phase 03-H2: stop / restore employees with a server-only lifecycle API.
-- Target project: PTS_tools (fdlfzvtjehoaiaunclhn).
-- NO employee is changed when this migration runs.
-- Do not modify historical H1 or H1.1 migration files.
-- The Edge Function must be deployed separately AFTER this SQL migration.

-- Expire old employee access JWTs when disabling and, crucially, when restoring.
ALTER TABLE public.app_profiles
    ADD COLUMN IF NOT EXISTS session_valid_after_epoch bigint NOT NULL DEFAULT 0;

-- Guard works with the *actual verified Supabase JWT* and checks live PTS status.
-- SECURITY DEFINER reads app_profiles without requiring client SELECT rights.
CREATE OR REPLACE FUNCTION pts_private.pts_employee_business_session_active()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
SELECT EXISTS (
    SELECT 1
    FROM public.app_profiles ap
    WHERE ap.user_id = (SELECT auth.uid())
      AND ap.is_active = true
      AND ap.must_change_password = false
      AND COALESCE(NULLIF((SELECT auth.jwt() ->> 'iat'), '')::bigint, 0)
        >= ap.session_valid_after_epoch
);
$function$;
REVOKE ALL ON FUNCTION pts_private.pts_employee_business_session_active()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pts_private.pts_employee_business_session_active()
  TO authenticated;

-- Restrictive RLS = existing per-operation permission AND account is active.
-- All seven current business data tables are intentionally covered.
DO $policies$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'ccc_tax_rates', 'meeting_records', 'permit_items', 'permits',
    'product_assets', 'product_component_specs', 'products'
  ]::text[] LOOP
    EXECUTE format(
      'CREATE POLICY pts_h2_active_account_guard ON public.%I AS RESTRICTIVE '
      || 'FOR ALL TO authenticated '
      || 'USING ((SELECT pts_private.pts_employee_business_session_active())) '
      || 'WITH CHECK ((SELECT pts_private.pts_employee_business_session_active()))',
      v_table
    );
END LOOP;
END
$policies$;

-- product-assets is the private company asset bucket on this PTS project.
-- Only restrict this bucket; do not change rules of other buckets.
CREATE POLICY pts_h2_active_employee_product_storage
ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id <> 'product-assets'
  OR (SELECT pts_private.pts_employee_business_session_active())
)
WITH CHECK (
  bucket_id <> 'product-assets'
  OR (SELECT pts_private.pts_employee_business_session_active())
);

-- Short, exclusive claim prevents two simultaneous admin status operations
-- from racing across the separate Postgres and Supabase Auth services.
CREATE TABLE pts_private.pts_employee_status_claims (
                                                        user_id uuid PRIMARY KEY REFERENCES public.app_profiles(user_id) ON DELETE CASCADE,
                                                        actor_user_id uuid NOT NULL REFERENCES public.app_profiles(user_id),
                                                        action text NOT NULL CHECK (action IN ('deactivate', 'reactivate')),
  claim_token uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  was_active boolean NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
ALTER TABLE pts_private.pts_employee_status_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pts_private.pts_employee_status_claims FROM PUBLIC, anon, authenticated;

-- This is service_role-only; the authenticated admin is validated by the Edge
-- Function's getUser(access_token), not by a caller-supplied actor_user_id.
CREATE OR REPLACE FUNCTION pts_private.pts_service_begin_employee_status_change(
  p_actor_user_id uuid, p_target_user_id uuid, p_action text,
  p_claim_token uuid, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
v_target public.app_profiles%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_auth_banned_until timestamptz;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.app_profiles ap
      JOIN public.system_admins sa ON sa.user_id = ap.user_id
      JOIN auth.users au ON au.id = ap.user_id
    WHERE ap.user_id = p_actor_user_id AND ap.is_active
      AND NOT ap.must_change_password
      AND (au.banned_until IS NULL OR au.banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'PTS administrator authorization required' USING errcode = '42501';
END IF;
  IF p_action NOT IN ('deactivate', 'reactivate') OR p_action IS NULL
     OR p_claim_token IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid lifecycle operation or reason' USING errcode = '22023';
END IF;
  IF p_target_user_id IS NULL OR p_actor_user_id = p_target_user_id THEN
    RAISE EXCEPTION 'Cannot manage own account' USING errcode = '42501';
END IF;

SELECT * INTO v_target FROM public.app_profiles ap
WHERE ap.user_id = p_target_user_id FOR UPDATE;
IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found' USING errcode = 'P0002';
END IF;
  IF v_target.must_change_password OR EXISTS (
    SELECT 1 FROM public.system_admins sa WHERE sa.user_id = p_target_user_id
  ) OR EXISTS (
    SELECT 1 FROM pts_private.pts_superusers su WHERE su.user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Protected or pending employee cannot be changed' USING errcode = '42501';
END IF;

  -- Expired claims are safe to replace; still-valid claims block concurrent calls.
DELETE FROM pts_private.pts_employee_status_claims c
WHERE c.user_id = p_target_user_id AND c.expires_at <= now();
IF EXISTS (
    SELECT 1 FROM pts_private.pts_employee_status_claims c
    WHERE c.user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Employee lifecycle operation in progress' USING errcode = '55P03';
END IF;

SELECT au.banned_until INTO v_auth_banned_until
FROM auth.users au WHERE au.id = p_target_user_id;
IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee Auth account not found' USING errcode = 'P0002';
END IF;

  IF p_action = 'reactivate' AND v_target.is_active THEN
    RAISE EXCEPTION 'Employee already active' USING errcode = '22023';
END IF;
  IF p_action = 'deactivate' AND NOT v_target.is_active
     AND v_auth_banned_until > now() THEN
    RAISE EXCEPTION 'Employee already inactive and Auth-banned' USING errcode = '22023';
END IF;

INSERT INTO pts_private.pts_employee_status_claims
(user_id,actor_user_id,action,claim_token,reason,was_active,expires_at)
VALUES
    (p_target_user_id,p_actor_user_id,p_action,p_claim_token,v_reason,
     v_target.is_active,now() + interval '3 minutes');

IF p_action = 'deactivate' THEN
    -- Cut off data access BEFORE calling the external Auth ban API.
UPDATE public.app_profiles
SET is_active = false,
    session_valid_after_epoch = greatest(
            session_valid_after_epoch, floor(extract(epoch FROM clock_timestamp()))::bigint + 1
                                )
WHERE user_id = p_target_user_id;
END IF;

RETURN jsonb_build_object('ok',true,'action',p_action,'username',v_target.username);
END;
$function$;

CREATE OR REPLACE FUNCTION pts_private.pts_service_finish_employee_status_change(
  p_actor_user_id uuid, p_target_user_id uuid, p_action text,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
v_claim pts_private.pts_employee_status_claims%ROWTYPE;
  v_banned_until timestamptz;
  v_username text;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL
     OR p_action NOT IN ('deactivate','reactivate') OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Invalid lifecycle completion' USING errcode = '22023';
END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.app_profiles ap JOIN public.system_admins sa
      ON sa.user_id=ap.user_id
    WHERE ap.user_id=p_actor_user_id AND ap.is_active
  ) OR p_actor_user_id = p_target_user_id THEN
    RAISE EXCEPTION 'PTS administrator authorization required' USING errcode='42501';
END IF;
  -- Lock profile and claim in the same order as begin().
SELECT ap.username INTO v_username FROM public.app_profiles ap
WHERE ap.user_id=p_target_user_id FOR UPDATE;
IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.system_admins sa WHERE sa.user_id=p_target_user_id
  ) OR EXISTS (
    SELECT 1 FROM pts_private.pts_superusers su WHERE su.user_id=p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Protected or missing employee' USING errcode='42501';
END IF;

SELECT * INTO v_claim FROM pts_private.pts_employee_status_claims c
WHERE c.user_id=p_target_user_id FOR UPDATE;
IF NOT FOUND OR v_claim.claim_token IS DISTINCT FROM p_claim_token
     OR v_claim.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_claim.action IS DISTINCT FROM p_action
     OR v_claim.expires_at <= now() THEN
    RAISE EXCEPTION 'Lifecycle reservation expired or invalid' USING errcode='55P03';
END IF;

SELECT au.banned_until INTO v_banned_until
FROM auth.users au WHERE au.id=p_target_user_id;
IF NOT FOUND THEN RAISE EXCEPTION 'Auth account missing' USING errcode='P0002'; END IF;

  IF p_action='deactivate' THEN
    IF v_banned_until IS NULL OR v_banned_until <= now() + interval '1 day'
      OR EXISTS (SELECT 1 FROM public.app_profiles ap
                 WHERE ap.user_id=p_target_user_id AND ap.is_active) THEN
      RAISE EXCEPTION 'Auth ban / PTS disable not confirmed' USING errcode='22023';
END IF;
ELSE
    IF v_banned_until > now() THEN
      RAISE EXCEPTION 'Auth account is still banned' USING errcode='22023';
END IF;
UPDATE public.app_profiles SET
                               is_active=true,
                               -- Fresh JWT required: previously issued JWTs cannot be reused on revival.
                               session_valid_after_epoch=greatest(
                                       session_valid_after_epoch,
                                       floor(extract(epoch FROM clock_timestamp()))::bigint + 1
                                                         )
WHERE user_id=p_target_user_id AND NOT must_change_password;
IF NOT FOUND THEN RAISE EXCEPTION 'Profile cannot be reactivated' USING errcode='22023'; END IF;
END IF;

INSERT INTO public.permission_audit_logs
(actor_user_id,target_user_id,entity_type,entity_id,action_key,
 old_value,new_value,reason)
VALUES
    (p_actor_user_id,p_target_user_id,'employee_lifecycle',p_target_user_id,
     p_action,
     jsonb_build_object('is_active',v_claim.was_active),
     jsonb_build_object('is_active',p_action='reactivate','auth_banned',p_action='deactivate'),
     v_claim.reason);

DELETE FROM pts_private.pts_employee_status_claims c WHERE c.user_id=p_target_user_id;
RETURN jsonb_build_object('ok',true,'action',p_action,'username',v_username,
                          'is_active',p_action='reactivate');
END;
$function$;

-- The Edge Function calls this only if Auth request failed; fail closed.
-- We intentionally NEVER auto-reactivate after an incomplete deactivation.
CREATE OR REPLACE FUNCTION pts_private.pts_service_abort_employee_status_change(
  p_actor_user_id uuid,p_target_user_id uuid,p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
DELETE FROM pts_private.pts_employee_status_claims c
WHERE c.user_id=p_target_user_id AND c.actor_user_id=p_actor_user_id
  AND c.claim_token=p_claim_token;
RETURN FOUND;
END;
$function$;

-- The service role can call the public RPC wrappers, but no logged-in employee
-- (including Admin) can invoke lifecycle mutation SQL directly.
GRANT USAGE ON SCHEMA pts_private TO service_role;

CREATE OR REPLACE FUNCTION public.pts_service_begin_employee_status_change(
  p_actor_user_id uuid,p_target_user_id uuid,p_action text,
  p_claim_token uuid,p_reason text
) RETURNS jsonb LANGUAGE sql SET search_path = ''
AS $function$
SELECT pts_private.pts_service_begin_employee_status_change(
               p_actor_user_id,p_target_user_id,p_action,p_claim_token,p_reason);
$function$;

CREATE OR REPLACE FUNCTION public.pts_service_finish_employee_status_change(
  p_actor_user_id uuid,p_target_user_id uuid,p_action text,p_claim_token uuid
) RETURNS jsonb LANGUAGE sql SET search_path = ''
AS $function$
SELECT pts_private.pts_service_finish_employee_status_change(
               p_actor_user_id,p_target_user_id,p_action,p_claim_token);
$function$;

CREATE OR REPLACE FUNCTION public.pts_service_abort_employee_status_change(
  p_actor_user_id uuid,p_target_user_id uuid,p_claim_token uuid
) RETURNS boolean LANGUAGE sql SET search_path = ''
AS $function$
SELECT pts_private.pts_service_abort_employee_status_change(
               p_actor_user_id,p_target_user_id,p_claim_token);
$function$;

REVOKE ALL ON FUNCTION pts_private.pts_service_begin_employee_status_change(uuid,uuid,text,uuid,text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pts_private.pts_service_finish_employee_status_change(uuid,uuid,text,uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pts_private.pts_service_abort_employee_status_change(uuid,uuid,uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pts_service_begin_employee_status_change(uuid,uuid,text,uuid,text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pts_service_finish_employee_status_change(uuid,uuid,text,uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pts_service_abort_employee_status_change(uuid,uuid,uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pts_private.pts_service_begin_employee_status_change(uuid,uuid,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION pts_private.pts_service_finish_employee_status_change(uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION pts_private.pts_service_abort_employee_status_change(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pts_service_begin_employee_status_change(uuid,uuid,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pts_service_finish_employee_status_change(uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pts_service_abort_employee_status_change(uuid,uuid,uuid) TO service_role;
