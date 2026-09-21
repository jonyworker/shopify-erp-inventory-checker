-- =========================================================
-- Add permit invalidation details
--
-- invalidated_at:
--   公文被標記為提前失效的時間
--
-- invalidation_reason:
--   merged            = 合併重新申請
--   authority_request = 主管機關要求
--   cancelled         = 文件作廢
--   other             = 其他
-- =========================================================

alter table public.permits
    add column if not exists invalidated_at timestamptz;

alter table public.permits
    add column if not exists invalidation_reason text;

alter table public.permits
    add constraint permits_invalidation_reason_check
        check (
            invalidation_reason is null
                or invalidation_reason in (
                                           'merged',
                                           'authority_request',
                                           'cancelled',
                                           'other'
                )
            );

comment on column public.permits.invalidated_at
is '公文提前失效時間';

comment on column public.permits.invalidation_reason
is '提前失效原因：merged=合併重新申請、authority_request=主管機關要求、cancelled=文件作廢、other=其他';