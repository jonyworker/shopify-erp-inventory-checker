-- PTS Phase 03-F | Permanent app-level Superuser for the existing admin account.
-- Scope: ONLY the current active PTS "admin" user; no changes to system_admins
-- or employee department/role/individual grants. No Auth/service_role privileges.
-- Future ACTIVE permission_catalog records automatically become allowed.

CREATE TABLE IF NOT EXISTS pts_private.pts_superusers (
  user_id uuid PRIMARY KEY REFERENCES public.app_profiles(user_id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES public.app_profiles(user_id) ON DELETE SET NULL,
  reason text NOT NULL
);
ALTER TABLE pts_private.pts_superusers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pts_private.pts_superusers FROM PUBLIC, anon, authenticated;

DO $block$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT ap.user_id INTO v_admin_id
  FROM public.app_profiles ap
  INNER JOIN public.system_admins sa ON sa.user_id = ap.user_id
  WHERE ap.username = 'admin' AND ap.is_active = true;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Active PTS admin with system_admins membership not found';
  END IF;

  INSERT INTO pts_private.pts_superusers(user_id, granted_by, reason)
  VALUES (v_admin_id, v_admin_id,
          'Explicit business Superuser grant for the existing PTS admin; future active permissions included')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.permission_audit_logs
     (actor_user_id, target_user_id, entity_type, entity_id, action_key, new_value, reason)
  VALUES
     (v_admin_id, v_admin_id, 'superuser', v_admin_id, 'grant_superuser',
      jsonb_build_object('scope','all_current_and_future_active_tool_permissions'),
      'PTS Phase 03-F: admin has full active business permissions; ordinary staff unchanged');
END;
$block$;

-- Keep the standard inheritance engine untouched: no change to the
-- department union, role union, individual allow/deny or dependencies for staff.
CREATE OR REPLACE FUNCTION pts_private.pts_effective_permission_details_for_user(
  p_target_user_id uuid
)
RETURNS TABLE (
  permission_key text,
  tool_key text,
  action_key text,
  is_allowed boolean,
  grant_sources text[],
  blocked_by text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  WITH superuser_status AS (
    SELECT EXISTS (
      SELECT 1
      FROM pts_private.pts_superusers su
      INNER JOIN public.app_profiles ap ON ap.user_id = su.user_id AND ap.is_active
      INNER JOIN public.system_admins sa ON sa.user_id = su.user_id
      WHERE su.user_id = p_target_user_id
    ) AS is_superuser
  )
  SELECT
    d.permission_key,
    d.tool_key,
    d.action_key,
    CASE WHEN s.is_superuser AND tc.is_active AND pc.is_active
      THEN true ELSE d.is_allowed END AS is_allowed,
    CASE WHEN s.is_superuser AND tc.is_active AND pc.is_active
      THEN ARRAY['system:superuser']::text[] ELSE d.grant_sources END AS grant_sources,
    CASE WHEN s.is_superuser AND tc.is_active AND pc.is_active
      THEN ARRAY[]::text[] ELSE d.blocked_by END AS blocked_by
  FROM pts_private.pts_permission_details_for_user(p_target_user_id) d
  INNER JOIN public.permission_catalog pc ON pc.permission_key = d.permission_key
  INNER JOIN public.tool_catalog tc ON tc.id = pc.tool_id
  CROSS JOIN superuser_status s
  ORDER BY d.tool_key, d.action_key;
$function$;

-- Never expose a privileged permission-by-user function to browser callers.
REVOKE ALL ON FUNCTION pts_private.pts_effective_permission_details_for_user(uuid)
  FROM PUBLIC, anon, authenticated;

-- Both browser permission snapshot and RLS pts_can() use this function.
CREATE OR REPLACE FUNCTION pts_private.pts_my_permission_details()
RETURNS TABLE (
  permission_key text, tool_key text, action_key text,
  is_allowed boolean, grant_sources text[], blocked_by text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT * FROM pts_private.pts_effective_permission_details_for_user((SELECT auth.uid()));
$function$;

-- Make the admin Effective Permissions Overview show the same Superuser result.
CREATE OR REPLACE FUNCTION pts_private.pts_admin_user_permission_details(
  p_target_user_id uuid
)
RETURNS TABLE (
  permission_key text, tool_key text, action_key text,
  is_allowed boolean, grant_sources text[], blocked_by text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NOT COALESCE(pts_private.pts_my_is_system_admin(), false) THEN
    RAISE EXCEPTION 'PTS administrator authorization required' USING errcode = '42501';
  END IF;

  IF p_target_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.app_profiles ap WHERE ap.user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'PTS profile not found' USING errcode = 'P0002';
  END IF;

  RETURN QUERY
    SELECT d.* FROM pts_private.pts_effective_permission_details_for_user(p_target_user_id) d;
END;
$function$;

COMMENT ON TABLE pts_private.pts_superusers IS
  'App-level full business permissions, independent of department and regular system administrator status.';
COMMENT ON FUNCTION pts_private.pts_effective_permission_details_for_user(uuid) IS
  'Superuser active catalog override; ordinary accounts use unchanged inheritance engine.';
