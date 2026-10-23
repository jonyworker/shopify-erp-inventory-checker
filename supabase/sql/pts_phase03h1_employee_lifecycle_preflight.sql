-- PTS Phase 03-H1: read-only employee lifecycle preflight.
-- This migration NEVER suspends, reactivates or deletes any user.
-- Access: ACTIVE system administrators only, even if called with a service_role key.
-- Confirmed project: fdlfzvtjehoaiaunclhn (PTS_tools).

CREATE OR REPLACE FUNCTION pts_private.pts_admin_employee_lifecycle_preview(
  p_target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_target public.app_profiles%ROWTYPE;
  v_is_admin boolean := false;
  v_is_superuser boolean := false;
  v_audit_count bigint := 0;
  v_meeting_count bigint := 0;
  v_session_count bigint := 0;
  v_banned_until timestamptz;
  v_fk record;
  v_fk_count bigint;
  v_fk_blockers jsonb := '[]'::jsonb;
  v_reasons text[] := ARRAY[]::text[];
  v_is_protected boolean;
BEGIN
  -- The caller's JWT, not any ID passed in request arguments, proves admin status.
  IF v_actor_id IS NULL OR NOT coalesce(pts_private.pts_my_is_system_admin(), false) THEN
    RAISE EXCEPTION 'PTS administrator authorization required' USING errcode = '42501';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Employee account not found' USING errcode = 'P0002';
  END IF;

  SELECT * INTO v_target
  FROM public.app_profiles ap WHERE ap.user_id = p_target_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee account not found' USING errcode = 'P0002';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.system_admins sa WHERE sa.user_id = p_target_user_id)
    INTO v_is_admin;
  SELECT EXISTS (SELECT 1 FROM pts_private.pts_superusers su WHERE su.user_id = p_target_user_id)
    INTO v_is_superuser;

  SELECT count(*) INTO v_audit_count
  FROM public.permission_audit_logs l
  WHERE l.actor_user_id = p_target_user_id OR l.target_user_id = p_target_user_id;

  SELECT count(*) INTO v_meeting_count
  FROM public.meeting_records mr WHERE mr.created_by = p_target_user_id;

  SELECT count(*) INTO v_session_count
  FROM auth.sessions s WHERE s.user_id = p_target_user_id;

  SELECT u.banned_until INTO v_banned_until
  FROM auth.users u WHERE u.id = p_target_user_id;

  -- Generic check for hard-delete foreign key blockers, including future tables.
  -- Only restrictive FKs are included; ON DELETE SET NULL / CASCADE relationships
  -- must be reviewed separately before the later H3 permanent-delete implementation.
  FOR v_fk IN
    SELECT n.nspname AS schema_name, rel.relname AS table_name,
           attr.attname AS column_name
    FROM pg_catalog.pg_constraint fk
    JOIN pg_catalog.pg_class rel ON rel.oid = fk.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = rel.relnamespace
    JOIN pg_catalog.pg_attribute attr ON attr.attrelid = fk.conrelid
      AND attr.attnum = fk.conkey[1]
    WHERE fk.contype = 'f'
      AND fk.confrelid IN ('auth.users'::regclass, 'public.app_profiles'::regclass)
      AND fk.confdeltype IN ('a', 'r')
      AND pg_catalog.array_length(fk.conkey, 1) = 1
      AND n.nspname NOT IN ('auth', 'pg_catalog', 'information_schema')
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT count(*) FROM %I.%I WHERE %I = $1',
      v_fk.schema_name, v_fk.table_name, v_fk.column_name
    ) INTO v_fk_count USING p_target_user_id;
    IF v_fk_count > 0 THEN
      v_fk_blockers := v_fk_blockers || jsonb_build_array(
        jsonb_build_object('table', v_fk.schema_name || '.' || v_fk.table_name,
                           'column', v_fk.column_name, 'rows', v_fk_count)
      );
    END IF;
  END LOOP;

  v_is_protected := (p_target_user_id = v_actor_id OR v_is_admin OR v_is_superuser);

  IF p_target_user_id = v_actor_id THEN
    v_reasons := v_reasons || '不可操作自己的帳號';
  END IF;
  IF v_is_admin OR v_is_superuser THEN
    v_reasons := v_reasons || '系統管理員或 Superuser 帳號禁止在此流程操作';
  END IF;
  IF v_target.is_active THEN
    v_reasons := v_reasons || '永久刪除前必須先停用帳號';
  END IF;
  IF v_meeting_count > 0 THEN
    v_reasons := v_reasons || '存在員工建立的會議紀錄';
  END IF;
  IF v_audit_count > 0 THEN
    v_reasons := v_reasons || '存在權限稽核紀錄，須先規劃保留與封存';
  END IF;
  IF jsonb_array_length(v_fk_blockers) > 0 THEN
    v_reasons := v_reasons || '存在其他資料表的限制性外鍵關聯';
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_target.user_id,
    'username', v_target.username,
    'display_name', v_target.display_name,
    'is_active', v_target.is_active,
    'must_change_password', v_target.must_change_password,
    'is_system_admin', v_is_admin,
    'is_superuser', v_is_superuser,
    'auth_banned', coalesce(v_banned_until > now(), false),
    'session_count', v_session_count,
    'meeting_count', v_meeting_count,
    'audit_count', v_audit_count,
    'restrictive_fk_blockers', v_fk_blockers,
    'can_deactivate', (NOT v_is_protected AND v_target.is_active AND NOT v_target.must_change_password),
    'can_reactivate', (NOT v_is_protected AND NOT v_target.is_active AND NOT v_target.must_change_password),
    'can_delete', (pg_catalog.cardinality(v_reasons) = 0),
    'delete_blockers', to_jsonb(v_reasons),
    'note', 'H1 為唯讀預檢；實際操作需由後續 H2/H3 安全後端重新檢查，禁止直接依預檢結果刪除帳號'
  );
END;
$function$;

REVOKE ALL ON FUNCTION pts_private.pts_admin_employee_lifecycle_preview(uuid)
  FROM PUBLIC, anon;
-- Existing PTS design calls private SECURITY DEFINER functions from invoker wrappers.
-- The inner function performs the mandatory admin check on every call.
GRANT EXECUTE ON FUNCTION pts_private.pts_admin_employee_lifecycle_preview(uuid)
  TO authenticated;

-- Exposed wrapper is SECURITY INVOKER: it must not bypass the internal admin check.
CREATE OR REPLACE FUNCTION public.pts_admin_employee_lifecycle_preview(
  p_target_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT pts_private.pts_admin_employee_lifecycle_preview(p_target_user_id);
$function$;

REVOKE ALL ON FUNCTION public.pts_admin_employee_lifecycle_preview(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pts_admin_employee_lifecycle_preview(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.pts_admin_employee_lifecycle_preview(uuid) IS
  'Phase 03-H1 admin-only read-only preflight for employee lifecycle. Never mutates accounts.';
