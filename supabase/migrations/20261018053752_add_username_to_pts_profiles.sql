-- PTS Authorization System / Phase 01-E (step 1)
-- Add a username to app_profiles while preserving existing Email sign-in.
-- The old shared account remains untouched (username stays NULL).
-- No password or authentication data is stored in this table.

alter table public.app_profiles
  add column username text;

-- All stored usernames are canonical lowercase; a future login endpoint
-- will normalize user input before secure authentication.
-- Length 3-32, begins with a letter, ends with an alphanumeric character.
alter table public.app_profiles
  add constraint app_profiles_username_format
  check (
    username is null
    or username ~ '^[a-z][a-z0-9._-]{1,30}[a-z0-9]$'
  );

-- Uniqueness applies to assigned usernames. Multiple legacy users may
-- temporarily have NULL usernames during migration.
create unique index app_profiles_username_unique_idx
  on public.app_profiles (username)
  where username is not null;

comment on column public.app_profiles.username is
  'Unique lowercase PTS login name; NULL for legacy/unassigned users. '
  'Authentication credentials remain managed by Supabase Auth.';

-- Existing RLS policies and role grants are not changed.
;
