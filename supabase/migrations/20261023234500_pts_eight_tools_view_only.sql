-- PTS | 庫存、價格與 Promotion 八項工具改由檢視權限管理
-- 僅停用 .export 權限節點，保留 .view 與既有歷史授權紀錄。
-- 本 Migration 不修改應用程式的 CSV/XLSX 匯出功能，也不調整其他工具權限。

DO $validate$
DECLARE
  missing_views text;
  missing_exports text;
BEGIN
  SELECT string_agg(v.permission_key, ', ' ORDER BY v.permission_key)
    INTO missing_views
  FROM unnest(ARRAY[
    'inventoryShopify.view',
    'inventoryRuten.view',
    'priceErp.view',
    'priceShopify.view',
    'priceRuten.view',
    'promotionPriceBuilder.view',
    'shopifyPromotionLaunch.view',
    'shopifyPromotionEnd.view'
  ]) AS v(permission_key)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.permission_catalog pc
    WHERE pc.permission_key = v.permission_key AND pc.is_active = true
  );

  IF missing_views IS NOT NULL THEN
    RAISE EXCEPTION '必要檢視權限不存在或已停用：%', missing_views;
  END IF;

  SELECT string_agg(v.permission_key, ', ' ORDER BY v.permission_key)
    INTO missing_exports
  FROM unnest(ARRAY[
    'inventoryShopify.export',
    'inventoryRuten.export',
    'priceErp.export',
    'priceShopify.export',
    'priceRuten.export',
    'promotionPriceBuilder.export',
    'shopifyPromotionLaunch.export',
    'shopifyPromotionEnd.export'
  ]) AS v(permission_key)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.permission_catalog pc
    WHERE pc.permission_key = v.permission_key
  );

  IF missing_exports IS NOT NULL THEN
    RAISE NOTICE '下列匯出權限節點已不存在，略過：%', missing_exports;
  END IF;
END
$validate$;

UPDATE public.permission_catalog
SET is_active = false,
    updated_at = now()
WHERE permission_key = ANY (ARRAY[
    'inventoryShopify.export',
    'inventoryRuten.export',
    'priceErp.export',
    'priceShopify.export',
    'priceRuten.export',
    'promotionPriceBuilder.export',
    'shopifyPromotionLaunch.export',
    'shopifyPromotionEnd.export'
])
AND is_active = true;
