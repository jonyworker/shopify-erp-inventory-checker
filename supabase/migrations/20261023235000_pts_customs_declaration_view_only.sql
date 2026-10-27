-- PTS | 進出口報單整理：保留檢視作為工具使用權限，停用獨立匯出權限。
-- 不刪除既有授權紀錄，不修改 Excel 匯出功能。
DO $validate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permission_catalog
    WHERE permission_key = 'customsDeclarationParser.view' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'customsDeclarationParser.view 不存在或已停用，取消本次調整';
  END IF;
END;
$validate$;
UPDATE public.permission_catalog
SET is_active = false,
    updated_at = now()
WHERE permission_key = 'customsDeclarationParser.export'
  AND is_active = true;
