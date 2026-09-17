create extension if not exists pgcrypto;
create table if not exists public.permits (
                                              id uuid primary key default gen_random_uuid(),

    application_no text not null unique,
    certificate_no text not null unique,

    issue_date date not null,
    expiration_date date not null,

    goods_type text not null,
    applicant text not null,

    created_at timestamptz not null default now()
    );
comment on table public.permits
is '警政署槍砲彈藥簽審核准公文';
create table if not exists public.permit_items (
                                                   id uuid primary key default gen_random_uuid(),

    permit_id uuid not null
    references public.permits(id)
    on delete cascade,

    item_no text not null,
    ccc_code text not null,
    country text not null,
    brand text not null,
    goods_name text not null,
    model text not null,
    review_result text not null,

    created_at timestamptz not null default now()
    );
comment on table public.permit_items
is '公文明細';
create table if not exists public.notification_recipients (
                                                              id uuid primary key default gen_random_uuid(),

    name text not null,
    email text not null unique,

    is_active boolean not null default true,

    created_at timestamptz not null default now()
    );
create table if not exists public.notification_logs (
                                                        id uuid primary key default gen_random_uuid(),

    permit_id uuid not null
    references public.permits(id)
    on delete cascade,

    notification_type text not null,

    sent_at timestamptz not null default now(),
    created_at timestamptz not null default now()
    );
alter table public.permits
    enable row level security;
alter table public.permit_items
    enable row level security;
alter table public.notification_recipients
    enable row level security;
alter table public.notification_logs
    enable row level security;
drop policy if exists
  "Authenticated users can read permits"
on public.permits;
create policy
  "Authenticated users can read permits"
on public.permits
for select
                    to authenticated
                    using (true);
drop policy if exists
  "Authenticated users can insert permits"
on public.permits;
create policy
  "Authenticated users can insert permits"
on public.permits
for insert
to authenticated
with check (true);
drop policy if exists
  "Authenticated users can read permit items"
on public.permit_items;
create policy
  "Authenticated users can read permit items"
on public.permit_items
for select
                                to authenticated
                                using (true);
drop policy if exists
  "Authenticated users can insert permit items"
on public.permit_items;
create policy
  "Authenticated users can insert permit items"
on public.permit_items
for insert
to authenticated
with check (true);
create or replace function public.create_permit_with_items(
  p_application_no text,
  p_certificate_no text,
  p_issue_date date,
  p_expiration_date date,
  p_goods_type text,
  p_applicant text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
v_permit_id uuid;
  v_item jsonb;
  v_inserted_count integer := 0;
begin
insert into public.permits (
    application_no,
    certificate_no,
    issue_date,
    expiration_date,
    goods_type,
    applicant
)
values (
           p_application_no,
           p_certificate_no,
           p_issue_date,
           p_expiration_date,
           p_goods_type,
           p_applicant
       )
    returning id
into v_permit_id;


for v_item in
select *
from jsonb_array_elements(p_items)
         loop

    insert into public.permit_items (
    permit_id,
    item_no,
    ccc_code,
    country,
    brand,
    goods_name,
    model,
    review_result
)
values (
    v_permit_id,
    v_item ->> 'itemNo',
    v_item ->> 'cccCode',
    v_item ->> 'country',
    v_item ->> 'brand',
    v_item ->> 'goodsName',
    v_item ->> 'model',
    v_item ->> 'reviewResult'
    );

v_inserted_count :=
      v_inserted_count + 1;

end loop;


return jsonb_build_object(
        'permitId',
        v_permit_id,

        'itemCount',
        v_inserted_count
       );

end;
$$;
