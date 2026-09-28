-- =========================================================
-- Products
-- =========================================================

create table public.products (
                                 id uuid primary key default gen_random_uuid(),

                                 sku text not null unique,
                                 name text not null,

                                 brand text,
                                 model text,
                                 color text,

                                 product_type text not null,

                                 part_category text,
                                 part_category_other text,
                                 part_is_metal boolean,

                                 is_active boolean not null default true,

                                 created_at timestamptz not null default now(),
                                 updated_at timestamptz not null default now(),

                                 constraint products_product_type_check
                                     check (
                                         product_type in (
                                                          'part',
                                                          'gun'
                                             )
                                         ),

                                 constraint products_part_category_check
                                     check (
                                         part_category is null
                                             or part_category in (
                                                                  'body',
                                                                  'slide',
                                                                  'barrel',
                                                                  'magazine',
                                                                  'bolt',
                                                                  'other'
                                             )
                                         ),

                                 constraint products_part_fields_check
                                     check (
                                         (
                                             product_type = 'gun'
                                                 and part_category is null
                                                 and part_category_other is null
                                                 and part_is_metal is null
                                             )
                                             or
                                         (
                                             product_type = 'part'
                                                 and part_category is not null
                                                 and part_is_metal is not null
                                             )
                                         ),

                                 constraint products_part_other_check
                                     check (
                                         part_category <> 'other'
                                             or nullif(trim(part_category_other), '') is not null
                                         )
);


-- =========================================================
-- Product Component Specs
--
-- 儲存全槍各部位的屬性。
-- 例如：槍管是否金屬。
-- =========================================================

create table public.product_component_specs (
                                                id uuid primary key default gen_random_uuid(),

                                                product_id uuid not null
                                                    references public.products(id)
                                                        on delete cascade,

                                                component_type text not null,

                                                is_metal boolean,

                                                note text,

                                                created_at timestamptz not null default now(),
                                                updated_at timestamptz not null default now(),

                                                constraint product_component_specs_component_type_check
                                                    check (
                                                        component_type in (
                                                                           'chamber',
                                                                           'barrel',
                                                                           'magazine_top',
                                                                           'slide_internal',
                                                                           'bolt'
                                                            )
                                                        ),

                                                constraint product_component_specs_unique_component
                                                    unique (
                                                            product_id,
                                                            component_type
                                                        )
);


-- =========================================================
-- Product Assets
--
-- 儲存商品專屬圖片。
-- 同一商品、同一 asset_type 可以有多張圖片。
-- =========================================================

create table public.product_assets (
                                       id uuid primary key default gen_random_uuid(),

                                       product_id uuid not null
                                           references public.products(id)
                                               on delete cascade,

                                       asset_type text not null,

                                       file_path text not null,

                                       sort_order integer not null default 0,

                                       note text,

                                       created_at timestamptz not null default now(),

                                       constraint product_assets_asset_type_check
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
                                                              'energy_report'
                                                   )
                                               ),

                                       constraint product_assets_sort_order_check
                                           check (
                                               sort_order >= 0
                                               )
);


-- =========================================================
-- updated_at function
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
return new;
end;
$$;


-- =========================================================
-- updated_at triggers
-- =========================================================

create trigger products_set_updated_at
    before update
    on public.products
    for each row
    execute function public.set_updated_at();


create trigger product_component_specs_set_updated_at
    before update
    on public.product_component_specs
    for each row
    execute function public.set_updated_at();