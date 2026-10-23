-- PTS / 簽審資料查詢：以單一 view 權限控制查詢工具及修改操作。
-- 此調整會讓所有具有 permitSearch.view 的使用者可更新 permits。
-- 不刪除 edit 授權紀錄；停用 edit 權限節點以從管理介面隱藏。
DO $validate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permission_catalog
    WHERE permission_key = 'permitSearch.view' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'permitSearch.view 不存在或未啟用，停止遷移';
  END IF;
END
$validate$;

-- 清理前一版針對 edit 的 UPDATE 政策，並改用 view。
DROP POLICY IF EXISTS "pts_permit_search_edit_update" ON public.permits;
DROP POLICY IF EXISTS "pts_permit_search_view_update" ON public.permits;
CREATE POLICY "pts_permit_search_view_update"
ON public.permits FOR UPDATE TO authenticated
USING ((SELECT public.pts_can('permitSearch.view')))
WITH CHECK ((SELECT public.pts_can('permitSearch.view')));

-- 防止其他寬鬆的 permissive UPDATE 政策旁路前述檢查。
DROP POLICY IF EXISTS "pts_permit_search_view_update_guard" ON public.permits;
CREATE POLICY "pts_permit_search_view_update_guard"
ON public.permits AS RESTRICTIVE FOR UPDATE TO authenticated
USING ((SELECT public.pts_can('permitSearch.view')))
WITH CHECK ((SELECT public.pts_can('permitSearch.view')));

UPDATE public.permission_catalog
SET is_active = false, updated_at = now()
WHERE permission_key = 'permitSearch.edit' AND is_active = true;
