alter table public.notification_logs
add constraint notification_logs_permit_type_unique
unique (permit_id, notification_type);;
