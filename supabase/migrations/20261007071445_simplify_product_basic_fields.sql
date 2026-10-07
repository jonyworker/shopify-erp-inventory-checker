-- =========================================================
-- Simplify Product Basic Fields
--
-- 產品基本資料之後只要求「品名」。
--
-- 舊的 sku / brand / model / color 欄位先保留，
-- 避免既有資料遺失。
--
-- sku 改為可為 null，
-- 新建立的產品不再需要 SKU。
-- =========================================================


alter table public.products
    alter column sku drop not null;


-- =========================================================
-- 移除 SKU UNIQUE constraint
--
-- PostgreSQL 在：
--
--     sku text not null unique
--
-- 建立時，預設 constraint 名稱為：
--
--     products_sku_key
-- =========================================================

alter table public.products
drop constraint if exists products_sku_key;