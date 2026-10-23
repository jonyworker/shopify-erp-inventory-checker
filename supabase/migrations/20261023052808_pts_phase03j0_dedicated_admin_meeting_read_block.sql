-- PTS Phase 03-J0: dedicated @admin must not read meetings.
-- This is separate from the Phase 03-J strict-participant RLS, which follows later.
-- A restrictive SELECT policy combines with all existing permissive SELECT policies.
-- It does NOT modify meeting data or employee permissions.

CREATE OR REPLACE FUNCTION pts_private.pts_is_dedicated_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
SELECT EXISTS (
    SELECT 1
    FROM public.app_profiles ap
             JOIN public.system_admins sa ON sa.user_id = ap.user_id
    WHERE ap.user_id = (SELECT auth.uid())
      AND ap.username = 'admin'
      AND ap.is_active
      AND NOT ap.must_change_password
);
$function$;

REVOKE ALL ON FUNCTION pts_private.pts_is_dedicated_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pts_private.pts_is_dedicated_admin() TO authenticated;

CREATE POLICY pts_meeting_dedicated_admin_no_read
  ON public.meeting_records
  AS RESTRICTIVE
  FOR SELECT TO authenticated
                                                                             USING (NOT (SELECT pts_private.pts_is_dedicated_admin()));
