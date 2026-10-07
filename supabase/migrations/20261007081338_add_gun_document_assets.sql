-- =========================================================
-- Gun Document Assets
--
-- 擴充全槍附件：
--
--   certification_statement
--     認證標章說明文件
--
--   traditional_chinese_translation
--     中文正體字譯本
--
--   energy_report
--     動能輸出檢測報告
--
-- 同時讓 product-assets Storage 可以儲存：
--   JPG / PNG / WebP
--   PDF
--   DOC / DOCX
-- =========================================================


-- =========================================================
-- Product Assets Metadata
-- =========================================================

alter table public.product_assets
    add column if not exists original_file_name text;

alter table public.product_assets
    add column if not exists mime_type text;

alter table public.product_assets
    add column if not exists file_size bigint;


-- =========================================================
-- File Size Constraint
-- =========================================================

alter table public.product_assets
drop constraint if exists product_assets_file_size_check;

alter table public.product_assets
    add constraint product_assets_file_size_check
        check (
            file_size is null
                or file_size >= 0
            );


-- =========================================================
-- Asset Type Constraint
-- =========================================================

alter table public.product_assets
drop constraint if exists product_assets_asset_type_check;


alter table public.product_assets
    add constraint product_assets_asset_type_check
        check (
            asset_type in (
                           'main',
                           'full_gun',

                           'chamber',
                           'barrel',
                           'magazine_top',
                           'slide_internal',
                           'bolt',

                           'exploded_diagram',

                           'certification_statement',
                           'traditional_chinese_translation',
                           'energy_report'
                )
            );


-- =========================================================
-- Storage Bucket Configuration
--
-- 單檔最大 10 MB
-- =========================================================

update storage.buckets
set
    file_size_limit = 10485760,

    allowed_mime_types = array[
        'image/jpeg',
    'image/png',
    'image/webp',

    'application/pdf',

    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]

where id = 'product-assets';