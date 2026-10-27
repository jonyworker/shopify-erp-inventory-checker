-- PTS | 申請書建立器僅保留工具使用權限
-- 保留 applicationBuilder.view，停用 applicationBuilder.export。
-- 不刪除歷史授權紀錄，也不更動 Word 下載功能及其他工具。

DO $validate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permission_catalog
    WHERE permission_key = 'applicationBuilder.view' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'applicationBuilder.view 不存在或已停用，取消本次調整';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.permission_catalog
    WHERE permission_key = 'applicationBuilder.export'
  ) THEN
    RAISE NOTICE 'applicationBuilder.export 已不存在，不需要停用';
  END IF;
END
$validate$;
UPDATE public.permission_catalog
SET is_active = false,
    updated_at = now()
WHERE permission_key = 'applicationBuilder.export'
  AND is_active = true;
