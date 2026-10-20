-- 會議紀錄：所有已登入帳號可查閱與維護；未登入者無權限。
create table if not exists public.meeting_records (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 200),
  meeting_date date not null,
  category text not null default '',
  attendees text not null default '',
  content text not null check (char_length(trim(content)) > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meeting_records_date_idx on public.meeting_records (meeting_date desc);
-- pg_trgm 支援中文任意連續字串的 ILIKE 搜尋（未來資料量大時可用）。
create extension if not exists pg_trgm with schema extensions;
create index if not exists meeting_records_search_idx on public.meeting_records
  using gin ((coalesce(title,'') || ' ' || coalesce(category,'') || ' ' || coalesce(attendees,'') || ' ' || coalesce(content,'')) extensions.gin_trgm_ops);
create or replace function public.set_meeting_record_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_meeting_record_updated_at on public.meeting_records;
create trigger trg_meeting_record_updated_at before update on public.meeting_records
for each row execute function public.set_meeting_record_updated_at();
alter table public.meeting_records enable row level security;
create policy "meeting_read_authenticated" on public.meeting_records for select to authenticated using (true);
create policy "meeting_insert_authenticated" on public.meeting_records for insert to authenticated with check (created_by = (select auth.uid()));
create policy "meeting_update_authenticated" on public.meeting_records for update to authenticated using (true) with check (true);
create policy "meeting_delete_authenticated" on public.meeting_records for delete to authenticated using (true);
