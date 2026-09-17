create policy "Authenticated users can update permits"
on public.permits
for update
to authenticated
using (true)
with check (true);;
