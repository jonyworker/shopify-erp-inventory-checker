create table if not exists public.ccc_tax_rates (
  id uuid primary key default gen_random_uuid(),
  ccc_code text not null unique,
  tax_rate numeric(6,3) not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.ccc_tax_rates enable row level security;

drop policy if exists "Authenticated users can read CCC tax rates" on public.ccc_tax_rates;

create policy "Authenticated users can read CCC tax rates"
on public.ccc_tax_rates
for select
to authenticated
using (true);

insert into public.ccc_tax_rates (
  ccc_code,
  tax_rate,
  description,
  is_active
)
values
(
  '93040000407',
  5,
  '射擊動能低於２０焦耳／每平方公分之彈簧、空氣或瓦斯槍枝',
  true
),
(
  '93059900104',
  5,
  '射擊動能低於２０焦耳／每平方公分之彈簧、空氣或瓦斯槍枝之零件及附件',
  true
)
on conflict (ccc_code) do update
set
  tax_rate = excluded.tax_rate,
  description = excluded.description,
  is_active = excluded.is_active;;
