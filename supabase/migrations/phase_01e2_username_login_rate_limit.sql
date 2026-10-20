-- PTS / Phase 01-E-2: security controls for username/password login.
-- Applied to project PTS_tools. Keep exact remote migration version in local repo.
-- Only the trusted Edge Function service role may execute the helper.

create schema if not exists pts_private;
revoke all on schema pts_private from public, anon, authenticated;

create table pts_private.username_login_attempts (
  key_hash text primary key,
  window_started_at timestamptz not null,
  attempts integer not null default 1 check (attempts >= 1)
);

revoke all on pts_private.username_login_attempts from public, anon, authenticated;

-- Return true when both the username and network attempt budgets remain.
-- The network signal is best effort; the account-specific limit always applies.
-- Each UPSERT is atomic under concurrent requests.
create function public.pts_consume_username_login_attempt(
  p_username text,
  p_network_hint text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_user_count integer;
  v_network_count integer := 0;
  v_user_key text;
  v_network_key text;
begin
  if p_username is null or p_username !~ '^[a-z][a-z0-9._-]{1,30}[a-z0-9]$' then
    return false;
  end if;

  v_user_key := encode(pg_catalog.sha256(pg_catalog.convert_to('u:' || p_username, 'UTF8')), 'hex');

  insert into pts_private.username_login_attempts (key_hash, window_started_at, attempts)
  values (v_user_key, v_now, 1)
  on conflict (key_hash) do update set
    attempts = case
      when pts_private.username_login_attempts.window_started_at <= v_now - interval '15 minutes'
      then 1 else pts_private.username_login_attempts.attempts + 1 end,
    window_started_at = case
      when pts_private.username_login_attempts.window_started_at <= v_now - interval '15 minutes'
      then v_now else pts_private.username_login_attempts.window_started_at end
  returning attempts into v_user_count;

  if p_network_hint is not null and length(p_network_hint) between 1 and 128 then
    v_network_key := encode(pg_catalog.sha256(pg_catalog.convert_to('n:' || p_network_hint, 'UTF8')), 'hex');

    insert into pts_private.username_login_attempts (key_hash, window_started_at, attempts)
    values (v_network_key, v_now, 1)
    on conflict (key_hash) do update set
      attempts = case
        when pts_private.username_login_attempts.window_started_at <= v_now - interval '15 minutes'
        then 1 else pts_private.username_login_attempts.attempts + 1 end,
      window_started_at = case
        when pts_private.username_login_attempts.window_started_at <= v_now - interval '15 minutes'
        then v_now else pts_private.username_login_attempts.window_started_at end
    returning attempts into v_network_count;
  end if;

  return v_user_count <= 8 and v_network_count <= 80;
end;
$$;

revoke all on function public.pts_consume_username_login_attempt(text, text)
  from public, anon, authenticated;
grant execute on function public.pts_consume_username_login_attempt(text, text)
  to service_role;

comment on function public.pts_consume_username_login_attempt(text, text)
  is 'Edge-only atomic username/IP login rate limiter; denies after 8 per username or 80 per network per 15 minutes.';
comment on table pts_private.username_login_attempts
  is 'Private counters; clean old rows periodically in future maintenance.';
