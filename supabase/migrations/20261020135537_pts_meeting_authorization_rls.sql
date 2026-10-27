-- PTS / Meeting Archive authorization Phase 1
-- Install via a timestamped Supabase migration. Do not execute verify SQL as a migration.
-- Explicitly authorize the existing system admin for meeting business operations.
-- Other staff remain ungranted unless their departments/roles/overrides permit access.

DO $$
DECLARE
v_admin uuid;
  v_count integer;
BEGIN
SELECT ap.user_id INTO v_admin
FROM public.app_profiles ap
         JOIN public.system_admins sa ON sa.user_id = ap.user_id
WHERE ap.username = 'admin' AND ap.is_active = true;

IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Active PTS admin account not found; refusing to lock meeting_records';
END IF;

SELECT count(*) INTO v_count FROM public.permission_catalog pc
                                      JOIN public.tool_catalog tc ON tc.id = pc.tool_id
WHERE tc.tool_key = 'meetingArchive'
  AND pc.permission_key IN (
                            'meetingArchive.view', 'meetingArchive.create',
                            'meetingArchive.edit', 'meetingArchive.delete'
    ) AND pc.is_active AND tc.is_active;
IF v_count <> 4 THEN
    RAISE EXCEPTION 'Meeting permission catalog incomplete: % of 4', v_count;
END IF;

  -- Do not overwrite any explicit per-user "deny" set previously.
INSERT INTO public.user_permission_overrides
(user_id, permission_id, effect, reason, created_by, updated_by)
SELECT v_admin, pc.id, 'allow',
       'Phase 03-D4 migration: preserve explicit administrator meeting access',
       v_admin, v_admin
FROM public.permission_catalog pc
WHERE pc.permission_key IN (
                            'meetingArchive.view', 'meetingArchive.create',
                            'meetingArchive.edit', 'meetingArchive.delete'
    )
  AND NOT EXISTS (
    SELECT 1 FROM public.user_permission_overrides u
    WHERE u.user_id=v_admin AND u.permission_id=pc.id
)
    ON CONFLICT (user_id, permission_id) DO NOTHING;

INSERT INTO public.permission_audit_logs
(actor_user_id,target_user_id,entity_type,entity_id,action_key,new_value,reason)
VALUES (
           v_admin,v_admin,'user_permission',v_admin,'grant_meeting',
           jsonb_build_object('permissions',jsonb_build_array(
                   'meetingArchive.view','meetingArchive.create',
                   'meetingArchive.edit','meetingArchive.delete')),
           'Phase 03-D4: existing administrator receives explicit meeting rights before enforcing RLS'
       );
END $$;
-- Remove legacy authenticated-wide RLS policies: permissive policies combine with OR.
DROP POLICY IF EXISTS meeting_read_authenticated ON public.meeting_records;
DROP POLICY IF EXISTS meeting_insert_authenticated ON public.meeting_records;
DROP POLICY IF EXISTS meeting_update_authenticated ON public.meeting_records;
DROP POLICY IF EXISTS meeting_delete_authenticated ON public.meeting_records;
ALTER TABLE public.meeting_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY meeting_select_pts_view
ON public.meeting_records
FOR SELECT TO authenticated
               USING ((SELECT public.pts_can('meetingArchive.view')));
CREATE POLICY meeting_insert_pts_create
ON public.meeting_records
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.pts_can('meetingArchive.create'))
  AND created_by = (SELECT auth.uid())
);
CREATE POLICY meeting_update_pts_edit
ON public.meeting_records
FOR UPDATE TO authenticated
                      USING ((SELECT public.pts_can('meetingArchive.edit')))
    WITH CHECK ((SELECT public.pts_can('meetingArchive.edit')));
CREATE POLICY meeting_delete_pts_delete
ON public.meeting_records
FOR DELETE TO authenticated
USING ((SELECT public.pts_can('meetingArchive.delete')));
-- Intentionally leave existing grants unchanged. RLS enforces user-specific rights.;
