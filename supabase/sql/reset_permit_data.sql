/*
 * 重置簽審公文資料
 *
 * 會清除：
 * - public.permits
 * - public.permit_items
 * - public.notification_logs
 *
 * 不會清除：
 * - public.notification_recipients
 * - public.ccc_tax_rates
 *
 * 注意：
 * 此操作不可還原。
 * 僅在需要重新匯入簽審公文資料時手動執行。
 */

truncate table public.permits cascade;