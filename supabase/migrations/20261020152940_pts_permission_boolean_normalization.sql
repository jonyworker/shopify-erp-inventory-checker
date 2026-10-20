-- PTS Phase 03-F1: normalize permission result to true/false.
-- Preserve department inheritance, individual deny, and Superuser override.
-- No table rows, assignments or authorization decisions are changed.
-- Paste into a fresh timestamped Supabase migration.

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
             THEN true ELSE COALESCE(d.is_allowed, false) END AS is_allowed,
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

