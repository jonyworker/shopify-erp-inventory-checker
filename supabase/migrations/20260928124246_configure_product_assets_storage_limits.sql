-- =========================================================
-- Configure product-assets Storage Bucket
--
-- 單檔最大：5 MB
-- 允許格式：
--   JPEG
--   PNG
--   WebP
-- =========================================================

update storage.buckets
set
    file_size_limit = 5242880,
    allowed_mime_types = array[
        'image/jpeg',
    'image/png',
    'image/webp'
    ]
where id = 'product-assets';