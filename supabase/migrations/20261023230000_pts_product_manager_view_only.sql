-- PTS | 產品資料管理改為單一工具使用權限
-- 只對 productManager.view 開放寫入產品、規格與附件資訊。
-- 採 RESTRICTIVE policy 與既有政策相交，避免其他 permissive policy 繞過。
-- 保留舊授權紀錄，停用 create/edit/manage_assets 權限節點，便於稽核及復原。

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permission_catalog
    WHERE permission_key = 'productManager.view' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'productManager.view is missing or inactive; migration cancelled';
  END IF;
END
$check$;

UPDATE public.permission_catalog
SET is_active = false, updated_at = now()
WHERE permission_key IN (
  'productManager.create',
  'productManager.edit',
  'productManager.manage_assets'
) AND is_active = true;

-- 公開資料表：只收緊寫入；SELECT 政策維持原狀。
-- 既有 pts_h2_active_account_guard 仍須通過。
DO $tables$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','product_component_specs','product_assets'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS pts_product_manager_insert_guard ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS pts_product_manager_update_guard ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS pts_product_manager_delete_guard ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY pts_product_manager_insert_guard ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.pts_can(''productManager.view'')))', t
    );
    EXECUTE format(
      'CREATE POLICY pts_product_manager_update_guard ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT public.pts_can(''productManager.view''))) WITH CHECK ((SELECT public.pts_can(''productManager.view'')))', t
    );
    EXECUTE format(
      'CREATE POLICY pts_product_manager_delete_guard ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.pts_can(''productManager.view'')))', t
    );
  END LOOP;
END
$tables$;

-- Storage：僅針對 product-assets 加上寫入的限制性政策。
-- 別的 bucket 不會受到本次政策影響。
DROP POLICY IF EXISTS pts_product_manager_storage_insert_guard ON storage.objects;
DROP POLICY IF EXISTS pts_product_manager_storage_update_guard ON storage.objects;
DROP POLICY IF EXISTS pts_product_manager_storage_delete_guard ON storage.objects;

CREATE POLICY pts_product_manager_storage_insert_guard
ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  bucket_id <> 'product-assets' OR (SELECT public.pts_can('productManager.view'))
);

CREATE POLICY pts_product_manager_storage_update_guard
ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
USING (bucket_id <> 'product-assets' OR (SELECT public.pts_can('productManager.view')))
WITH CHECK (bucket_id <> 'product-assets' OR (SELECT public.pts_can('productManager.view')));

CREATE POLICY pts_product_manager_storage_delete_guard
ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
USING (bucket_id <> 'product-assets' OR (SELECT public.pts_can('productManager.view')));
