-- PTS Phase 03-H3F: 已停用員工可在 Auth Session 尚存時進行安全永久刪除
--
-- 背景：Auth Admin deleteUser(user_id) 在正式刪除 Auth user 時，會由外鍵 CASCADE
--       清理 auth.sessions（相關 refresh_tokens 也隨之移除）。
--       之前 H3 的 preview/is_safe 錯將 session_count > 0 視為不可刪除，
--       導致離職員工未自行登出時，管理員無法完成安全刪除。
--
-- 本 Migration 僅修改兩個現有 SECURITY DEFINER 函式中對 Sessions 的判斷：
--   1) pts_private.pts_admin_employee_delete_preview(uuid)
--   2) pts_private.pts_employee_delete_is_safe(uuid)
-- 維持原本的管理員驗證、停用／Auth 封鎖、稽核封存、業務資料與外鍵檢查。
--
-- 以 pg_get_functiondef 擷取遠端現有定義，定位「唯一且精確」的既有片段，
--  避免覆寫先前各階段對這兩個長函式做過的其它安全強化。
--  若與已驗證版本不同，明確拒絕部署，而非猜測替換。

DO $migration$
DECLARE
v_safe_def text;
  v_preview_def text;
  v_safe_needle text := 'OR EXISTS(SELECT 1 FROM auth.sessions WHERE user_id=p_target)';
  v_preview_needle text :=
      'IF v_sessions > 0 THEN' || E'\n'
      || '    v_blockers := array_append(v_blockers,''仍有 Auth Session，必須先處理'');' || E'\n'
      || 'END IF;';
  v_safe_new text;
  v_preview_new text;
BEGIN
SELECT pg_get_functiondef('pts_private.pts_employee_delete_is_safe(uuid)'::regprocedure)
INTO v_safe_def;
SELECT pg_get_functiondef('pts_private.pts_admin_employee_delete_preview(uuid)'::regprocedure)
INTO v_preview_def;

IF v_safe_def IS NULL OR v_preview_def IS NULL THEN
    RAISE EXCEPTION 'PTS H3F: 缺少 H3 安全永久刪除函式；停止部署';
END IF;

  -- 防止同一片段在函式內出現多次，或前置程式已改版。
  IF (length(v_safe_def) - length(replace(v_safe_def, v_safe_needle, '')))
       <> length(v_safe_needle) THEN
    RAISE EXCEPTION 'PTS H3F: is_safe 版本不符，無法精確定位 Session 防護條件；停止部署';
END IF;

  IF (length(v_preview_def) - length(replace(v_preview_def, v_preview_needle, '')))
       <> length(v_preview_needle) THEN
    RAISE EXCEPTION 'PTS H3F: preview 版本不符，無法精確定位 Session 阻擋訊息；停止部署';
END IF;

  -- Session 不再是永久刪除的前置阻擋條件。
  -- auth.sessions / refresh_tokens 由 Auth Admin 正式刪除使用者時處理。
  v_safe_new := replace(v_safe_def, v_safe_needle, 'OR false /* H3F: existing sessions are not a deletion blocker */');

  -- 預檢仍保留 session_count 給管理員參考，僅移除「不能刪除」的理由。
  v_preview_new := replace(v_preview_def, v_preview_needle,
    '/* H3F: Auth Sessions are informative only; Auth deletion cascades sessions. */');

EXECUTE v_safe_new;
EXECUTE v_preview_new;
END;
$migration$;
COMMENT ON FUNCTION pts_private.pts_employee_delete_is_safe(uuid)
  IS 'PTS H3F: 安全永久刪除仍需停用、Auth 封鎖、業務資料與稽核安全檢查；Session 數量不單獨阻止刪除。';
COMMENT ON FUNCTION pts_private.pts_admin_employee_delete_preview(uuid)
  IS 'PTS H3F: 刪除前預檢保留 session_count 顯示，但不以殘留 Auth Session 阻止安全永久刪除。';
