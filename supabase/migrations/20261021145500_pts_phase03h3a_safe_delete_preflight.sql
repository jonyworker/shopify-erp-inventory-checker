-- PTS Phase 03-H3A: safe permanent deletion, ARCHIVE + READ-ONLY PREFLIGHT ONLY.
-- Project: PTS_tools. Does NOT delete or deactivate any user.
-- Existing H1/H2 migrations must remain unchanged.
-- H3B must archive all related audit records BEFORE calling Auth Admin deleteUser.

-- Intentionally no FK to auth.users / app_profiles: these rows must survive Auth deletion.
CREATE TABLE pts_private.pts_deleted_employee_archives (
                                                           id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                                                           former_user_id uuid NOT NULL UNIQUE,
                                                           username text,
                                                           display_name text,
                                                           archived_at timestamptz NOT NULL DEFAULT now(),
                                                           archived_by uuid NOT NULL,
                                                           deleted_at timestamptz,
                                                           lifecycle_state text NOT NULL DEFAULT 'prepared'
                                                               CHECK (lifecycle_state IN ('prepared','deleted','requires_review')),
                                                           reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
                                                           identity_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
                                                           permission_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
                                                           archive_note text
);
ALTER TABLE pts_private.pts_deleted_employee_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pts_private.pts_deleted_employee_archives FROM PUBLIC, anon, authenticated;

CREATE TABLE pts_private.pts_deleted_employee_audit_snapshots (
                                                                  archive_id uuid NOT NULL REFERENCES pts_private.pts_deleted_employee_archives(id) ON DELETE RESTRICT,
                                                                  original_audit_id uuid NOT NULL,
                                                                  audit_snapshot jsonb NOT NULL,
                                                                  PRIMARY KEY (archive_id,original_audit_id)
);
ALTER TABLE pts_private.pts_deleted_employee_audit_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pts_private.pts_deleted_employee_audit_snapshots FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE pts_private.pts_deleted_employee_archives IS
  'PTS H3 deletion ledger. Identity and authorization snapshots persist after Auth account deletion; not a complete PII erasure.';
COMMENT ON TABLE pts_private.pts_deleted_employee_audit_snapshots IS
  'Audit evidence snapshot to preserve actor/target attribution before auth.users delete cascades / SET NULL FKs.';

CREATE OR REPLACE FUNCTION pts_private.pts_admin_employee_delete_preview(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
v_actor_id uuid := (SELECT auth.uid());
  v_target public.app_profiles%ROWTYPE;
  v_is_admin boolean := false;
  v_is_superuser boolean := false;
  v_banned boolean := false;
  v_banned_until timestamptz;
  v_meetings bigint := 0;
  v_audits bigint := 0;
  v_sessions bigint := 0;
  v_storage bigint := 0;
  v_status_claims bigint := 0;
  v_departments bigint := 0;
  v_fk record;
  v_fk_count bigint;
  v_unknown_fks jsonb := '[]'::jsonb;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  IF v_actor_id IS NULL OR NOT coalesce(pts_private.pts_my_is_system_admin(),false) THEN
    RAISE EXCEPTION 'PTS administrator authorization required' USING errcode='42501';
END IF;
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Employee account not found' USING errcode='P0002';
END IF;

SELECT * INTO v_target FROM public.app_profiles ap
WHERE ap.user_id = p_target_user_id;
IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee account not found' USING errcode='P0002';
END IF;
SELECT EXISTS(SELECT 1 FROM public.system_admins s WHERE s.user_id=p_target_user_id) INTO v_is_admin;
SELECT EXISTS(SELECT 1 FROM pts_private.pts_superusers s WHERE s.user_id=p_target_user_id) INTO v_is_superuser;
SELECT banned_until INTO v_banned_until FROM auth.users u WHERE u.id=p_target_user_id;
IF NOT FOUND THEN
    v_blockers := array_append(v_blockers,'找不到對應的 Supabase Auth 帳號');
END IF;
  v_banned := coalesce(v_banned_until > now(),false);

SELECT count(*) INTO v_meetings FROM public.meeting_records mr WHERE mr.created_by=p_target_user_id;
SELECT count(*) INTO v_audits FROM public.permission_audit_logs a
WHERE a.actor_user_id=p_target_user_id OR a.target_user_id=p_target_user_id;
SELECT count(*) INTO v_sessions FROM auth.sessions s WHERE s.user_id=p_target_user_id;
SELECT count(*) INTO v_departments FROM public.user_departments d WHERE d.user_id=p_target_user_id;
SELECT count(*) INTO v_storage FROM storage.objects o
WHERE o.owner_id=p_target_user_id::text OR o.owner=p_target_user_id;
SELECT count(*) INTO v_status_claims FROM pts_private.pts_employee_status_claims c
WHERE c.user_id=p_target_user_id AND c.expires_at > now();

-- Survey NEW foreign keys that H3B has not explicitly reviewed.
-- Each FK is scanned only if it references auth.users or app_profiles and is
-- outside the known account / permission / audit tables.
FOR v_fk IN
SELECT ns.nspname AS schema_name, rel.relname AS table_name,
       att.attname AS column_name, fk.confdeltype,
       cardinality(fk.conkey) AS key_columns
FROM pg_catalog.pg_constraint fk
         JOIN pg_catalog.pg_class rel ON rel.oid=fk.conrelid
         JOIN pg_catalog.pg_namespace ns ON ns.oid=rel.relnamespace
         JOIN pg_catalog.pg_attribute att ON att.attrelid=fk.conrelid AND att.attnum=fk.conkey[1]
WHERE fk.contype='f'
  AND fk.confrelid IN ('auth.users'::regclass,'public.app_profiles'::regclass)
  AND ns.nspname IN ('public','pts_private')
  AND (ns.nspname || '.' || rel.relname) NOT IN (
                                                 'public.app_profiles',
                                                 'public.permission_audit_logs',
                                                 'public.department_permissions',
                                                 'public.role_permissions',
                                                 'public.system_admins',
                                                 'public.user_departments',
                                                 'public.user_business_roles',
                                                 'public.user_permission_overrides',
                                                 'pts_private.pts_employee_onboarding',
                                                 'pts_private.pts_employee_status_claims',
                                                 'pts_private.pts_superusers'
    )
    LOOP
    IF v_fk.key_columns <> 1 THEN
      v_unknown_fks := v_unknown_fks || jsonb_build_array(jsonb_build_object(
        'table',v_fk.schema_name||'.'||v_fk.table_name,
        'reason','unreviewed_composite_fk'));
ELSE
      EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',
        v_fk.schema_name,v_fk.table_name,v_fk.column_name)
        INTO v_fk_count USING p_target_user_id;
      IF v_fk_count > 0 THEN
        v_unknown_fks := v_unknown_fks || jsonb_build_array(jsonb_build_object(
          'table',v_fk.schema_name||'.'||v_fk.table_name,
          'column',v_fk.column_name,'rows',v_fk_count,
          'fk_delete_action',v_fk.confdeltype));
END IF;
END IF;
END LOOP;

  IF v_actor_id=p_target_user_id THEN
    v_blockers := array_append(v_blockers,'不可刪除自己的帳號');
END IF;
  IF v_is_admin OR v_is_superuser THEN
    v_blockers := array_append(v_blockers,'不可刪除系統管理員或 Superuser');
END IF;
  IF v_target.is_active THEN
    v_blockers := array_append(v_blockers,'永久刪除前必須先停用員工');
END IF;
  IF NOT v_banned THEN
    v_blockers := array_append(v_blockers,'Supabase Auth 尚未封鎖');
END IF;
  IF v_meetings > 0 THEN
    v_blockers := array_append(v_blockers,'存在員工建立的會議資料，必須保留建立者');
END IF;
  IF v_storage > 0 THEN
    v_blockers := array_append(v_blockers,'存在員工擁有的 Storage 檔案，須先處理');
END IF;
  IF v_sessions > 0 THEN
    v_blockers := array_append(v_blockers,'仍有 Auth Session，必須先處理');
END IF;
  IF v_status_claims > 0 THEN
    v_blockers := array_append(v_blockers,'有進行中的停用／恢復操作');
END IF;
  IF jsonb_array_length(v_unknown_fks)>0 THEN
    v_blockers := array_append(v_blockers,'發現尚未審核的業務資料關聯');
END IF;
  IF EXISTS(SELECT 1 FROM pts_private.pts_deleted_employee_archives a WHERE a.former_user_id=p_target_user_id) THEN
    v_blockers := array_append(v_blockers,'已存在刪除封存紀錄，需人工檢查');
END IF;

RETURN jsonb_build_object(
        'user_id',v_target.user_id,'username',v_target.username,
        'display_name',v_target.display_name,'is_active',v_target.is_active,
        'auth_banned',v_banned,'is_system_admin',v_is_admin,
        'is_superuser',v_is_superuser,'meeting_count',v_meetings,
        'audit_count',v_audits,'department_count',v_departments,
        'session_count',v_sessions,'storage_owned_count',v_storage,
        'unknown_fk_references',v_unknown_fks,
        'archive_required',v_audits > 0,
        'can_delete_after_archive',cardinality(v_blockers)=0,
        'delete_blockers',to_jsonb(v_blockers),
        'note','H3A 為唯讀檢查。即使 can_delete_after_archive=true，仍需 H3B 的原子封存及後端重查才可刪除 Auth 帳號。'
       );
END;
$function$;

REVOKE ALL ON FUNCTION pts_private.pts_admin_employee_delete_preview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION pts_private.pts_admin_employee_delete_preview(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pts_admin_employee_delete_preview(p_target_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=''
AS $function$
SELECT pts_private.pts_admin_employee_delete_preview(p_target_user_id);
$function$;
REVOKE ALL ON FUNCTION public.pts_admin_employee_delete_preview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pts_admin_employee_delete_preview(uuid) TO authenticated;
