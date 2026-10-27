revoke truncate on table public.meeting_records from anon, authenticated;
revoke references, trigger on table public.meeting_records from anon, authenticated;
drop policy if exists meeting_delete_attendee_guard on public.meeting_records;
create policy meeting_delete_attendee_guard on public.meeting_records
 as restrictive for delete to authenticated
 using (public.pts_meeting_is_attendee(id));
;
