-- PTS meeting participant region source fix
-- Save in a Supabase CLI-generated migration file after reviewing existing migrations.
-- Already applied manually in Supabase SQL Editor on 2026-10-26.
-- Uses organization membership rather than app_profiles.work_region.
-- Preserves the existing permission checks and participant filters.

CREATE OR REPLACE FUNCTION pts_private.pts_meeting_participant_candidates_internal()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  username text,
  is_active boolean,
  regions text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL
    OR NOT (
      COALESCE((SELECT public.pts_can('meetingArchive.create')), FALSE)
      OR COALESCE((SELECT public.pts_can('meetingArchive.edit')), FALSE)
    )
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
END IF;

RETURN QUERY
SELECT
    p.user_id,
    p.display_name,
    p.username,
    p.is_active,
    ARRAY(
        SELECT DISTINCT LOWER(BTRIM(o.code))
      FROM public.user_organizations uo
      JOIN public.organizations o ON o.id = uo.organization_id
      WHERE uo.user_id = p.user_id
        AND o.is_active = TRUE
        AND LOWER(BTRIM(o.code)) IN ('tw', 'hk')
      ORDER BY LOWER(BTRIM(o.code))
    ) AS regions
FROM public.app_profiles p
WHERE p.is_active = TRUE
  AND NULLIF(BTRIM(p.display_name), '') IS NOT NULL
  AND NULLIF(BTRIM(p.username), '') IS NOT NULL
  AND LOWER(p.username) <> 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.system_admins a WHERE a.user_id = p.user_id
)
ORDER BY p.display_name;
END;
$function$;
