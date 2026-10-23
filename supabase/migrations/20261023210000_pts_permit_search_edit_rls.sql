-- PTS 簽審資料查詢：實際寫入權限防護（只調整 permits UPDATE）
-- 查看仍維持既有 SELECT 規則，新增公文匯入另案處理。
-- 移除舊有「所有 authenticated 可更新」的寬鬆政策。
DROP POLICY IF EXISTS "Authenticated users can update permits" ON public.permits;
DROP POLICY IF EXISTS "pts_permit_search_edit_update" ON public.permits;
CREATE POLICY "pts_permit_search_edit_update"
ON public.permits
FOR UPDATE TO authenticated
USING ((SELECT public.pts_can('permitSearch.edit')))
WITH CHECK ((SELECT public.pts_can('permitSearch.edit')));
