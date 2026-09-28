-- =========================================================
-- Product Assets Storage Bucket
-- =========================================================

insert into storage.buckets (
    id,
    name,
    public
)
values (
           'product-assets',
           'product-assets',
           false
       )
    on conflict (id) do nothing;


-- =========================================================
-- Storage RLS Policies
-- =========================================================

-- 登入使用者可以讀取產品圖片

create policy "Authenticated users can read product assets"
on storage.objects
for select
               to authenticated
               using (
               bucket_id = 'product-assets'
               );


-- 登入使用者可以上傳產品圖片

create policy "Authenticated users can upload product assets"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'product-assets'
);


-- 登入使用者可以更新產品圖片

create policy "Authenticated users can update product assets"
on storage.objects
for update
                      to authenticated
                      using (
                      bucket_id = 'product-assets'
                      )
    with check (
                      bucket_id = 'product-assets'
                      );


-- 登入使用者可以刪除產品圖片

create policy "Authenticated users can delete product assets"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'product-assets'
);