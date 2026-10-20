-- Run manually AFTER deployment in Supabase SQL Editor.
SELECT policyname,cmd,roles,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename='meeting_records'
ORDER BY cmd,policyname;

SELECT ap.username, p.permission_key, d.is_allowed, d.grant_sources, d.blocked_by
FROM public.app_profiles ap
CROSS JOIN LATERAL pts_private.pts_permission_details_for_user(ap.user_id) d
JOIN public.permission_catalog p ON p.permission_key=d.permission_key
WHERE ap.username IN ('admin','testemployee')
  AND d.permission_key LIKE 'meetingArchive.%'
ORDER BY ap.username,p.permission_key;

SELECT count(*) AS existing_meeting_records FROM public.meeting_records;
-- Only inspect metadata, not sensitive meeting content.
