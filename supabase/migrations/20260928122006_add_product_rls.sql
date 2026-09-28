-- =========================================================
-- Product tables RLS
-- =========================================================


-- =========================================================
-- products
-- =========================================================

alter table public.products
    enable row level security;


create policy "Authenticated users can read products"
on public.products
for select
               to authenticated
               using (true);


create policy "Authenticated users can insert products"
on public.products
for insert
to authenticated
with check (true);


create policy "Authenticated users can update products"
on public.products
for update
                      to authenticated
                      using (true)
    with check (true);


-- products 暫時不開放 delete
-- 未來使用 is_active = false 來停用產品



-- =========================================================
-- product_component_specs
-- =========================================================

alter table public.product_component_specs
    enable row level security;


create policy "Authenticated users can read product component specs"
on public.product_component_specs
for select
               to authenticated
               using (true);


create policy "Authenticated users can insert product component specs"
on public.product_component_specs
for insert
to authenticated
with check (true);


create policy "Authenticated users can update product component specs"
on public.product_component_specs
for update
                      to authenticated
                      using (true)
    with check (true);


create policy "Authenticated users can delete product component specs"
on public.product_component_specs
for delete
to authenticated
using (true);



-- =========================================================
-- product_assets
-- =========================================================

alter table public.product_assets
    enable row level security;


create policy "Authenticated users can read product assets"
on public.product_assets
for select
               to authenticated
               using (true);


create policy "Authenticated users can insert product assets"
on public.product_assets
for insert
to authenticated
with check (true);


create policy "Authenticated users can update product assets"
on public.product_assets
for update
                      to authenticated
                      using (true)
    with check (true);


create policy "Authenticated users can delete product assets"
on public.product_assets
for delete
to authenticated
using (true);