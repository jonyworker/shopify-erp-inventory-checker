-- PTS 公文工具／簽審公文匯入：只保留檢視 (= 工具使用與匯入) 權限。
-- 本變更會移除 permitPdfParser.create 的授權資料，請先確認已備份及測試。
-- 需要資料庫已有 public.pts_can(text) 函式。

BEGIN;

-- 移除原本允許任何已登入者匯入的寬鬆 INSERT policy。
DROP POLICY IF EXISTS "Authenticated users can insert permits" ON public.permits;
DROP POLICY IF EXISTS "Authenticated users can insert permit items" ON public.permit_items;

DROP POLICY IF EXISTS "pts_permit_pdf_parser_insert" ON public.permits;
CREATE POLICY "pts_permit_pdf_parser_insert"
ON public.permits FOR INSERT TO authenticated
WITH CHECK ((SELECT public.pts_can('permitPdfParser.view')));

DROP POLICY IF EXISTS "pts_permit_pdf_parser_items_insert" ON public.permit_items;
CREATE POLICY "pts_permit_pdf_parser_items_insert"
ON public.permit_items FOR INSERT TO authenticated
WITH CHECK ((SELECT public.pts_can('permitPdfParser.view')));

-- 不再保留獨立「新增」授權。關聯授權資料會由 FK ON DELETE CASCADE 清除。
-- 此權限沒有子依賴時才刪除，避免不小心破壞其他功能的前置關係。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.permission_catalog child
    JOIN public.permission_catalog parent
      ON child.requires_permission_id = parent.id
    WHERE parent.permission_key = 'permitPdfParser.create'
  ) THEN
    RAISE EXCEPTION 'permitPdfParser.create 被其他權限依賴，停止移除';
  END IF;
END $$;

DELETE FROM public.permission_catalog
WHERE permission_key = 'permitPdfParser.create';

COMMIT;
