create table if not exists public.meeting_participants (
  meeting_id uuid not null references public.meeting_records(id) on delete cascade,
  user_id uuid not null references public.app_profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);
create index if not exists meeting_participants_user_meeting_idx
  on public.meeting_participants(user_id, meeting_id);
alter table public.meeting_participants enable row level security;
revoke all on table public.meeting_participants from anon, authenticated, public;
comment on table public.meeting_participants is 'PTS meeting attendees keyed by profile UUID; direct client access denied until guarded operations and meeting RLS are deployed.';;
