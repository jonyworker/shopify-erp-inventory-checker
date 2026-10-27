-- PTS: admin-only display name editing. Keeps user_id, username and grants intact.
-- Clients cannot update app_profiles directly. The SECURITY DEFINER function
-- verifies the authenticated caller against the existing system-admin helper.
CREATE OR REPLACE FUNCTION public.pts_admin_update_display_name(
  p_target_user_id uuid,
  p_display_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_name text := btrim(coalesce(p_display_name, ''));
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(pts_private.pts_my_is_system_admin(), false) THEN
    RAISE EXCEPTION 'PTS administrator authorization required' USING errcode = '42501';
  END IF;

  IF p_target_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.app_profiles WHERE user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'PTS profile not found' USING errcode = 'P0002';
  END IF;

  IF char_length(v_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Display name length must be 1-120' USING errcode = '22023';
  END IF;

  UPDATE public.app_profiles
  SET display_name = v_name, updated_at = now()
  WHERE user_id = p_target_user_id;
  RETURN v_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.pts_admin_update_display_name(uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pts_admin_update_display_name(uuid, text)
TO authenticated;
COMMENT ON FUNCTION public.pts_admin_update_display_name(uuid, text) IS
'Admin only: change app_profiles.display_name without changing login or permissions.';
