alter table public.permits
    add column if not exists status text not null default 'active';

alter table public.permits
    add column if not exists completed_at timestamptz;

alter table public.permits
    add constraint permits_status_check
        check (
            status in (
                       'active',
                       'paused',
                       'completed'
                )
            );

comment on column public.permits.status
is '公文處理狀態：active=處理中、paused=暫停提醒、completed=已完成';

comment on column public.permits.completed_at
is '公文完成申請時間';