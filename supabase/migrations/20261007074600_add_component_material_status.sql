-- =========================================================
-- Add component material status
--
-- material_status:
--   metal          = 金屬
--   non_metal      = 非金屬
--   not_applicable = 無此部件 / 不適用
--
-- 舊的 is_metal 暫時保留，避免既有資料遺失。
-- =========================================================

alter table public.product_component_specs
    add column material_status text;


-- =========================================================
-- 將既有 is_metal 資料轉入 material_status
-- =========================================================

update public.product_component_specs
set material_status =
        case
            when is_metal is true
                then 'metal'

            when is_metal is false
                then 'non_metal'

            else null
            end;


-- =========================================================
-- Constraint
-- =========================================================

alter table public.product_component_specs
    add constraint product_component_specs_material_status_check
        check (
            material_status is null
                or material_status in (
                                       'metal',
                                       'non_metal',
                                       'not_applicable'
                )
            );


comment on column public.product_component_specs.material_status
is '部位材質狀態：metal=金屬、non_metal=非金屬、not_applicable=無此部件';