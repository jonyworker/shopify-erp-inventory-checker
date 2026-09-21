-- =========================================================
-- Refine permit workflow status
--
-- status:
--   active      = 公文目前有效
--   completed   = 已完成重新申請
--   invalidated = 因合併、主管機關要求等原因提前失效
--
-- reminder_paused:
--   false = 正常寄送到期提醒
--   true  = 暫停寄送到期提醒
-- =========================================================


-- 1. 將之前可能存在的 paused 狀態還原成 active。
--    「暫停提醒」不再屬於公文本身的 status。
update public.permits
set status = 'active'
where status = 'paused';


-- 2. 移除舊的 status constraint。
alter table public.permits
drop constraint if exists permits_status_check;


-- 3. 建立新的 status constraint。
alter table public.permits
    add constraint permits_status_check
        check (
            status in (
                       'active',
                       'completed',
                       'invalidated'
                )
            );


-- 4. 新增提醒暫停欄位。
alter table public.permits
    add column if not exists reminder_paused boolean not null default false;


-- 5. 更新欄位說明。
comment on column public.permits.status
is '公文狀態：active=有效、completed=已完成重新申請、invalidated=提前失效';

comment on column public.permits.reminder_paused
is '是否暫停到期 Email 提醒';


-- 6. 更新 completed_at 說明。
comment on column public.permits.completed_at
is '完成重新申請的時間';