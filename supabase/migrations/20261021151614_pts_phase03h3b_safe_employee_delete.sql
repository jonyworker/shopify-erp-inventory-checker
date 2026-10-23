-- PTS Phase 03-H3B | Safe permanent account deletion backend.
-- IMPORTANT: This migration ONLY defines tables/functions/triggers. It deletes NO users.
-- The Edge Function is deployed separately and requires a real admin JWT.
-- Hard deletion uses the supported Supabase Auth Admin API, NOT direct SQL DELETE.
-- PTS H3A prerequisite. Historical migrations must remain unchanged.

-- One-time, short-lived deletion reservation; no FK to auth.users (must survive deletion).
ALTER TABLE pts_private.pts_deleted_employee_archives
    ADD COLUMN IF NOT EXISTS delete_token uuid,
    ADD COLUMN IF NOT EXISTS prepared_expires_at timestamptz;

-- Helper: discover unreviewed referencing business data BEFORE deleting Auth.
CREATE OR REPLACE FUNCTION pts_private.pts_employee_delete_references(p_target uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
v_ref record;
  v_count bigint;
  v_extra jsonb := '[]'::jsonb;
BEGIN
FOR v_ref IN
SELECT n.nspname AS schema_name, cl.relname AS table_name,
       at.attname AS column_name, fk.confdeltype,
       cardinality(fk.conkey) AS key_columns
FROM pg_catalog.pg_constraint fk
         JOIN pg_catalog.pg_class cl ON cl.oid=fk.conrelid
         JOIN pg_catalog.pg_namespace n ON n.oid=cl.relnamespace
         JOIN pg_catalog.pg_attribute at ON at.attrelid=fk.conrelid
    AND at.attnum=fk.conkey[1]
WHERE fk.contype='f'
  AND fk.confrelid IN ('auth.users'::regclass,'public.app_profiles'::regclass)
  AND n.nspname IN ('public','pts_private')
  AND (n.nspname||'.'||cl.relname) NOT IN (
    'public.app_profiles','public.permission_audit_logs',
    'public.department_permissions','public.role_permissions',
    'public.system_admins','public.user_departments',
    'public.user_business_roles','public.user_permission_overrides',
    'pts_private.pts_employee_onboarding','pts_private.pts_employee_status_claims',
    'pts_private.pts_superusers'
    )
    LOOP
    IF v_ref.key_columns <> 1 THEN
    v_extra := v_extra || jsonb_build_array(jsonb_build_object(
    'table',v_ref.schema_name||'.'||v_ref.table_name,'issue','composite_fk_not_reviewed'));
ELSE
      EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',
        v_ref.schema_name,v_ref.table_name,v_ref.column_name)
        INTO v_count USING p_target;
      IF v_count>0 THEN
        v_extra := v_extra || jsonb_build_array(jsonb_build_object(
          'table',v_ref.schema_name||'.'||v_ref.table_name,
          'column',v_ref.column_name,'count',v_count,
          'fk_delete_action',v_ref.confdeltype));
END IF;
END IF;
END LOOP;
RETURN v_extra;
END;
$fn$;
REVOKE ALL ON FUNCTION pts_private.pts_employee_delete_references(uuid) FROM PUBLIC,anon,authenticated;

-- H3B also blocks deletion when this person authored/approved other users' grants.
-- Those FK columns use SET NULL and would otherwise erase attribution.
CREATE OR REPLACE FUNCTION pts_private.pts_employee_delete_has_other_grant_history(p_target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
SELECT
    EXISTS(SELECT 1 FROM public.department_permissions WHERE granted_by=p_target)
        OR EXISTS(SELECT 1 FROM public.role_permissions WHERE granted_by=p_target)
        OR EXISTS(SELECT 1 FROM public.system_admins WHERE granted_by=p_target)
        OR EXISTS(SELECT 1 FROM public.user_departments WHERE assigned_by=p_target AND user_id<>p_target)
        OR EXISTS(SELECT 1 FROM public.user_business_roles WHERE assigned_by=p_target AND user_id<>p_target)
        OR EXISTS(SELECT 1 FROM public.user_permission_overrides
                  WHERE (created_by=p_target OR updated_by=p_target) AND user_id<>p_target);
$fn$;
REVOKE ALL ON FUNCTION pts_private.pts_employee_delete_has_other_grant_history(uuid) FROM PUBLIC,anon,authenticated;

-- Full server-side safety check. Neither the browser nor H3A's preview is trusted.
CREATE OR REPLACE FUNCTION pts_private.pts_employee_delete_is_safe(p_target uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
v_profile public.app_profiles%ROWTYPE;
  v_banned_until timestamptz;
BEGIN
SELECT * INTO v_profile FROM public.app_profiles WHERE user_id=p_target;
IF NOT FOUND OR v_profile.is_active OR v_profile.must_change_password
    OR v_profile.username IS NULL OR length(btrim(v_profile.username))=0
    OR v_profile.display_name IS NULL OR length(btrim(v_profile.display_name))=0
    OR EXISTS(SELECT 1 FROM public.system_admins WHERE user_id=p_target)
    OR EXISTS(SELECT 1 FROM pts_private.pts_superusers WHERE user_id=p_target)
  THEN RETURN false; END IF;
SELECT banned_until INTO v_banned_until FROM auth.users WHERE id=p_target;
IF NOT FOUND OR v_banned_until IS NULL OR v_banned_until<=now()+interval '1 day'
  THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.meeting_records WHERE created_by=p_target)
    OR EXISTS(SELECT 1 FROM auth.sessions WHERE user_id=p_target)
    OR EXISTS(SELECT 1 FROM storage.objects WHERE owner=p_target OR owner_id=p_target::text)
    OR EXISTS(SELECT 1 FROM pts_private.pts_employee_status_claims
      WHERE user_id=p_target AND expires_at>now())
    OR pts_private.pts_employee_delete_has_other_grant_history(p_target)
    OR jsonb_array_length(pts_private.pts_employee_delete_references(p_target))>0
  THEN RETURN false; END IF;
RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION pts_private.pts_employee_delete_is_safe(uuid) FROM PUBLIC,anon,authenticated;

-- One SQL transaction: check -> reserve -> archive identity, grants and audit.
-- The actual Auth deletion is done later through the Auth Admin API.
CREATE OR REPLACE FUNCTION pts_private.pts_service_prepare_employee_delete(
  p_actor_user_id uuid, p_target_user_id uuid,
  p_confirm_username text, p_reason text, p_delete_token uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
v_target public.app_profiles%ROWTYPE;
  v_archive_id uuid;
  v_audit_count bigint;
  v_saved_count bigint;
  v_reason text:=btrim(coalesce(p_reason,''));
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL
    OR p_delete_token IS NULL OR p_actor_user_id=p_target_user_id
    OR char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid delete request' USING errcode='22023';
END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.app_profiles ap
      JOIN public.system_admins sa ON sa.user_id=ap.user_id
      JOIN auth.users au ON au.id=ap.user_id
    WHERE ap.user_id=p_actor_user_id AND ap.is_active AND NOT ap.must_change_password
      AND (au.banned_until IS NULL OR au.banned_until <= now())
  ) THEN RAISE EXCEPTION 'PTS administrator authorization required' USING errcode='42501'; END IF;

SELECT * INTO v_target FROM public.app_profiles WHERE user_id=p_target_user_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING errcode='P0002'; END IF;
  IF v_target.username IS NULL OR p_confirm_username IS DISTINCT FROM v_target.username THEN
    RAISE EXCEPTION 'Username confirmation mismatch' USING errcode='22023';
END IF;
  IF NOT pts_private.pts_employee_delete_is_safe(p_target_user_id) THEN
    RAISE EXCEPTION 'Employee has protected data, sessions or unfulfilled prerequisites'
      USING errcode='42501';
END IF;
  IF EXISTS(SELECT 1 FROM pts_private.pts_deleted_employee_archives
     WHERE former_user_id=p_target_user_id) THEN
    RAISE EXCEPTION 'Deletion archive already exists; review required'
      USING errcode='23505';
END IF;

INSERT INTO pts_private.pts_deleted_employee_archives
(former_user_id,username,display_name,archived_by,reason,
 identity_snapshot,permission_snapshot,delete_token,prepared_expires_at)
VALUES (
           p_target_user_id,v_target.username,v_target.display_name,p_actor_user_id,v_reason,
           jsonb_build_object(
                   'user_id',v_target.user_id,'username',v_target.username,
                   'display_name',v_target.display_name,'created_at',v_target.created_at,
                   'is_active',v_target.is_active,'must_change_password',v_target.must_change_password
           ),
           jsonb_build_object(
                   'departments',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.user_departments x
                                           WHERE x.user_id=p_target_user_id),'[]'::jsonb),
                   'business_roles',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.user_business_roles x
                                              WHERE x.user_id=p_target_user_id),'[]'::jsonb),
                   'permission_overrides',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.user_permission_overrides x
                                                    WHERE x.user_id=p_target_user_id),'[]'::jsonb)
           ),
           p_delete_token, now()+interval '5 minutes'
       ) RETURNING id INTO v_archive_id;

INSERT INTO pts_private.pts_deleted_employee_audit_snapshots
(archive_id,original_audit_id,audit_snapshot)
SELECT v_archive_id,a.id,to_jsonb(a) FROM public.permission_audit_logs a
WHERE a.actor_user_id=p_target_user_id OR a.target_user_id=p_target_user_id;

SELECT count(*) INTO v_audit_count FROM public.permission_audit_logs a
WHERE a.actor_user_id=p_target_user_id OR a.target_user_id=p_target_user_id;
SELECT count(*) INTO v_saved_count FROM pts_private.pts_deleted_employee_audit_snapshots
WHERE archive_id=v_archive_id;
IF v_audit_count<>v_saved_count THEN
    RAISE EXCEPTION 'Audit snapshot incomplete' USING errcode='22023';
END IF;

RETURN jsonb_build_object('ok',true,'archive_id',v_archive_id,
                          'username',v_target.username,'audits_archived',v_saved_count);
END;
$fn$;
REVOKE ALL ON FUNCTION pts_private.pts_service_prepare_employee_delete(uuid,uuid,text,text,uuid)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pts_private.pts_service_prepare_employee_delete(uuid,uuid,text,text,uuid) TO service_role;

-- Before ANY Auth delete, enforce that a live PTS profile has a prepared archive
-- and that all business data references and audit snapshots are still safe.
-- This also blocks accidental deletion from the Dashboard or unrelated API calls.
CREATE OR REPLACE FUNCTION pts_private.pts_guard_pts_auth_user_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
v_archive pts_private.pts_deleted_employee_archives%ROWTYPE;
  v_total bigint;
  v_saved bigint;
BEGIN
  -- Only governs Auth accounts that belong to a PTS app_profile.
  IF NOT EXISTS(SELECT 1 FROM public.app_profiles ap WHERE ap.user_id=OLD.id) THEN
    RETURN OLD;
END IF;

SELECT * INTO v_archive FROM pts_private.pts_deleted_employee_archives a
WHERE a.former_user_id=OLD.id FOR UPDATE;
IF NOT FOUND OR v_archive.lifecycle_state<>'prepared'
     OR v_archive.delete_token IS NULL OR v_archive.prepared_expires_at<=now() THEN
    RAISE EXCEPTION 'PTS employee deletion requires a valid prepared archive'
      USING errcode='42501';
END IF;
  IF NOT pts_private.pts_employee_delete_is_safe(OLD.id) THEN
    RAISE EXCEPTION 'PTS employee no longer meets delete prerequisites'
      USING errcode='42501';
END IF;
  IF v_archive.username IS DISTINCT FROM (SELECT ap.username FROM public.app_profiles ap WHERE ap.user_id=OLD.id)
     OR v_archive.display_name IS DISTINCT FROM (SELECT ap.display_name FROM public.app_profiles ap WHERE ap.user_id=OLD.id) THEN
    RAISE EXCEPTION 'PTS employee identity changed after archive; deletion denied'
      USING errcode='42501';
END IF;

SELECT count(*) INTO v_total FROM public.permission_audit_logs a
WHERE a.actor_user_id=OLD.id OR a.target_user_id=OLD.id;
SELECT count(*) INTO v_saved FROM pts_private.pts_deleted_employee_audit_snapshots s
WHERE s.archive_id=v_archive.id;
-- Protect against grants/assignments changing AFTER the preflight archive.
IF v_archive.permission_snapshot IS DISTINCT FROM jsonb_build_object(
      'departments',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)
        FROM public.user_departments x WHERE x.user_id=OLD.id),'[]'::jsonb),
      'business_roles',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)
        FROM public.user_business_roles x WHERE x.user_id=OLD.id),'[]'::jsonb),
      'permission_overrides',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)
        FROM public.user_permission_overrides x WHERE x.user_id=OLD.id),'[]'::jsonb)
     ) THEN
    RAISE EXCEPTION 'PTS assignments changed after archive; deletion denied'
      USING errcode='42501';
END IF;
  IF v_saved<>v_total OR EXISTS(
    SELECT 1 FROM public.permission_audit_logs a
    WHERE (a.actor_user_id=OLD.id OR a.target_user_id=OLD.id)
      AND NOT EXISTS (
        SELECT 1 FROM pts_private.pts_deleted_employee_audit_snapshots s
        WHERE s.archive_id=v_archive.id AND s.original_audit_id=a.id
      )
  ) THEN RAISE EXCEPTION 'PTS audit archive mismatch; deletion denied'
    USING errcode='42501'; END IF;
RETURN OLD;
END;
$fn$;
REVOKE ALL ON FUNCTION pts_private.pts_guard_pts_auth_user_delete() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS pts_guard_pts_auth_user_delete ON auth.users;
CREATE TRIGGER pts_guard_pts_auth_user_delete BEFORE DELETE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION pts_private.pts_guard_pts_auth_user_delete();

-- Prevent restoration of an account while its deletion archive needs review.
CREATE OR REPLACE FUNCTION pts_private.pts_guard_employee_reactivation_on_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF NEW.is_active AND EXISTS (
   SELECT 1 FROM pts_private.pts_deleted_employee_archives a
   WHERE a.former_user_id=NEW.user_id AND a.lifecycle_state IN ('prepared','requires_review')
 ) THEN
   RAISE EXCEPTION 'PTS employee has pending deletion archive; reconciliation required'
     USING errcode='42501';
END IF;
RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION pts_private.pts_guard_employee_reactivation_on_delete() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS pts_guard_employee_reactivation_on_delete ON public.app_profiles;
CREATE TRIGGER pts_guard_employee_reactivation_on_delete
    BEFORE UPDATE OF is_active ON public.app_profiles FOR EACH ROW
    WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
EXECUTE FUNCTION pts_private.pts_guard_employee_reactivation_on_delete();

-- Complete ONLY when Auth deletion has really removed both Auth and PTS profile.
CREATE OR REPLACE FUNCTION pts_private.pts_service_finish_employee_delete(
  p_actor_user_id uuid,p_archive_id uuid,p_delete_token uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_archive pts_private.pts_deleted_employee_archives%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR p_archive_id IS NULL OR p_delete_token IS NULL THEN
    RAISE EXCEPTION 'Invalid completion token' USING errcode='22023';
END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_profiles ap
    JOIN public.system_admins sa ON sa.user_id=ap.user_id
    WHERE ap.user_id=p_actor_user_id AND ap.is_active) THEN
    RAISE EXCEPTION 'PTS administrator authorization required' USING errcode='42501';
END IF;
SELECT * INTO v_archive FROM pts_private.pts_deleted_employee_archives
WHERE id=p_archive_id FOR UPDATE;
IF NOT FOUND OR v_archive.archived_by IS DISTINCT FROM p_actor_user_id
    OR v_archive.delete_token IS DISTINCT FROM p_delete_token
    OR v_archive.lifecycle_state<>'prepared' THEN
    RAISE EXCEPTION 'Deletion completion claim mismatch' USING errcode='42501';
END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=v_archive.former_user_id)
    OR EXISTS(SELECT 1 FROM public.app_profiles WHERE user_id=v_archive.former_user_id) THEN
    RAISE EXCEPTION 'Auth / PTS account still exists' USING errcode='22023';
END IF;
UPDATE pts_private.pts_deleted_employee_archives
SET lifecycle_state='deleted', deleted_at=now(),delete_token=NULL,
    prepared_expires_at=NULL,archive_note='Auth deletion verified; account removed'
WHERE id=p_archive_id;
RETURN jsonb_build_object('ok',true,'archive_id',p_archive_id,'state','deleted');
END;
$fn$;
REVOKE ALL ON FUNCTION pts_private.pts_service_finish_employee_delete(uuid,uuid,uuid)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pts_private.pts_service_finish_employee_delete(uuid,uuid,uuid) TO service_role;

-- Mark problems for manual reconciliation instead of guessing that deletion succeeded.
CREATE OR REPLACE FUNCTION pts_private.pts_service_flag_employee_delete_review(
  p_actor_user_id uuid,p_archive_id uuid,p_delete_token uuid,p_note text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF p_actor_user_id IS NULL OR p_archive_id IS NULL OR p_delete_token IS NULL THEN RETURN false; END IF;
UPDATE pts_private.pts_deleted_employee_archives
SET lifecycle_state='requires_review', archive_note=left(coalesce(p_note,'Incomplete delete'),500),
    delete_token=NULL,prepared_expires_at=NULL
WHERE id=p_archive_id AND archived_by=p_actor_user_id AND delete_token=p_delete_token
  AND lifecycle_state='prepared';
RETURN FOUND;
END;
$fn$;
REVOKE ALL ON FUNCTION pts_private.pts_service_flag_employee_delete_review(uuid,uuid,uuid,text)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pts_private.pts_service_flag_employee_delete_review(uuid,uuid,uuid,text) TO service_role;

-- RPC bridge. Service role ONLY. Admin JWT is authenticated in the Edge Function,
-- and DB checks admin against live PTS tables again.
GRANT USAGE ON SCHEMA pts_private TO service_role;
CREATE OR REPLACE FUNCTION public.pts_service_prepare_employee_delete(
  p_actor_user_id uuid,p_target_user_id uuid,p_confirm_username text,p_reason text,p_delete_token uuid
) RETURNS jsonb LANGUAGE sql SET search_path=''
AS $fn$
SELECT pts_private.pts_service_prepare_employee_delete(
               p_actor_user_id,p_target_user_id,p_confirm_username,p_reason,p_delete_token);
$fn$;
CREATE OR REPLACE FUNCTION public.pts_service_finish_employee_delete(
  p_actor_user_id uuid,p_archive_id uuid,p_delete_token uuid
) RETURNS jsonb LANGUAGE sql SET search_path=''
AS $fn$
SELECT pts_private.pts_service_finish_employee_delete(p_actor_user_id,p_archive_id,p_delete_token);
$fn$;
CREATE OR REPLACE FUNCTION public.pts_service_flag_employee_delete_review(
  p_actor_user_id uuid,p_archive_id uuid,p_delete_token uuid,p_note text
) RETURNS boolean LANGUAGE sql SET search_path=''
AS $fn$
SELECT pts_private.pts_service_flag_employee_delete_review(
               p_actor_user_id,p_archive_id,p_delete_token,p_note);
$fn$;

REVOKE ALL ON FUNCTION public.pts_service_prepare_employee_delete(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pts_service_finish_employee_delete(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pts_service_flag_employee_delete_review(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pts_service_prepare_employee_delete(uuid,uuid,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pts_service_finish_employee_delete(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pts_service_flag_employee_delete_review(uuid,uuid,uuid,text) TO service_role;

COMMENT ON FUNCTION pts_private.pts_service_prepare_employee_delete(uuid,uuid,text,text,uuid)
IS 'H3B: archive and reserve only. NEVER performs Auth deletion.';
COMMENT ON FUNCTION pts_private.pts_guard_pts_auth_user_delete()
IS 'Rejects unsafe deletion of any PTS Auth user; leaves non-PTS Auth users unaffected.';
