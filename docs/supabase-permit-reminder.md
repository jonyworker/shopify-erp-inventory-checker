# Supabase 簽審公文到期提醒系統

本文件記錄 PTS 小工具中「警政署槍砲彈藥簽審公文」相關的 Supabase 設定、Edge Function、Email 通知與 Cron 排程。

---

## 1. Supabase Project

### Project Ref

```text
fdlfzvtjehoaiaunclhn
```

本機專案已透過 Supabase CLI 連結：

```bash
npx supabase link --project-ref fdlfzvtjehoaiaunclhn
```

---

## 2. 本機 Supabase 結構

目前專案結構：

```text
supabase/
├── config.toml
│
├── functions/
│   ├── deno.json
│   │
│   ├── send-permit-expiry-reminders/
│   │   └── index.ts
│   │
│   └── send-permit-test-email/
│       └── index.ts
│
└── migrations/
    ├── 20260916090000_initial_permit_schema.sql
    ├── 20260916113041_add_unique_expiry_notification_log.sql
    └── 20260916114449_enable_pg_net.sql
```

---

## 3. Database Tables

### 3.1 `permits`

儲存簽審公文主資料。

主要欄位：

```text
id
application_no
certificate_no
issue_date
expiration_date
goods_type
applicant
created_at
```

欄位用途：

- `application_no`：申辦案號
- `certificate_no`：簽審核准文號
- `issue_date`：核准日期
- `expiration_date`：有效期限
- `goods_type`：貨品類別
- `applicant`：申請人 / 進口人

---

### 3.2 `permit_items`

儲存每份公文內的貨品明細。

主要欄位：

```text
id
permit_id
item_no
ccc_code
country
brand
goods_name
model
review_result
created_at
```

資料關聯：

```text
permits 1 : N permit_items
```

也就是一份簽審公文可以包含多筆貨品明細。

---

### 3.3 `notification_recipients`

儲存 Email 提醒收件人。

主要欄位：

```text
id
name
email
is_active
created_at
```

只有：

```text
is_active = true
```

的收件人才會收到提醒 Email。

目前此表主要由 Supabase Dashboard 管理。

---

### 3.4 `notification_logs`

記錄已經寄出的通知。

主要欄位：

```text
id
permit_id
notification_type
sent_at
created_at
```

目前使用的提醒類型：

```text
expiry_45_days
```

並具有唯一限制：

```text
permit_id + notification_type
```

用途是避免同一份公文重複寄送同一種類型的提醒。

---

## 4. Row Level Security（RLS）

以下資料表皆已啟用 Row Level Security：

```text
permits
permit_items
notification_recipients
notification_logs
```

### `permits`

Authenticated user 目前可執行：

```text
SELECT
INSERT
```

### `permit_items`

Authenticated user 目前可執行：

```text
SELECT
INSERT
```

目前尚未開放前端：

```text
UPDATE
DELETE
```

也就是目前前端只能：

- 查詢公文
- 新增公文

不能直接修改或刪除既有公文。

---

## 5. RPC：`create_permit_with_items`

目前資料庫有：

```text
create_permit_with_items
```

用途是一次建立：

```text
permits
+
permit_items
```

整個流程會在同一個 PostgreSQL transaction 中執行。

如果任何一筆 `permit_items` 寫入失敗：

```text
整筆交易 rollback
```

因此不會發生：

```text
permits 已建立
但 permit_items 只建立一半
```

這類資料不完整問題。

---

## 6. Edge Functions

目前有兩支 Edge Function。

### 6.1 `send-permit-test-email`

用途：

測試 Resend Email 是否可以正常寄送。

本機位置：

```text
supabase/functions/send-permit-test-email/index.ts
```

從 Supabase 雲端下載：

```bash
npx supabase functions download send-permit-test-email
```

---

### 6.2 `send-permit-expiry-reminders`

用途：

每日檢查 45 天內即將到期的簽審公文。

本機位置：

```text
supabase/functions/send-permit-expiry-reminders/index.ts
```

主要流程：

```text
Cron
↓
Edge Function
↓
取得啟用中的 notification_recipients
↓
取得今天～45 天內到期的 permits
↓
檢查 notification_logs
↓
排除已經寄送提醒的公文
↓
透過 Resend 寄出 Email
↓
寄送成功後寫入 notification_logs
```

提醒範圍採：

```text
今天 ～ 45 天內
```

而不是只抓：

```text
剛好第 45 天
```

這樣可以避免某一天 Cron 執行失敗後，該份公文永久錯過提醒。

---

## 7. Edge Function Secrets

目前 Edge Function 使用：

```text
RESEND_API_KEY
CRON_SECRET
```

另外 Supabase Edge Function 執行環境會提供：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

### 安全原則

不要把任何 Secret 的實際值寫入 Git。

文件內只記錄：

```text
Secret 名稱
```

不要記錄：

```text
Secret value
```

---

## 8. Cron 驗證方式

`send-permit-expiry-reminders` 使用自訂 Header 驗證。

Edge Function：

```text
verify_jwt = false
```

但 Function 內會檢查 HTTP Header：

```text
X-Cron-Secret
```

其值必須與 Supabase Secret：

```text
CRON_SECRET
```

完全相同。

如果不相同，Function 會回傳：

```text
401 Unauthorized
```

因此即使 `verify_jwt = false`，仍然有 Cron 專用驗證機制。

---

## 9. Cron Job

Cron Job 名稱：

```text
send-permit-expiry-reminders-daily
```

Schedule：

```text
0 1 * * *
```

Supabase Cron 使用 UTC / GMT。

因此：

```text
01:00 UTC
=
09:00 台灣時間
```

也就是：

```text
每天台灣時間 09:00
```

自動執行。

---

## 10. Cron HTTP Request

### Method

```text
POST
```

### Endpoint

```text
https://fdlfzvtjehoaiaunclhn.supabase.co/functions/v1/send-permit-expiry-reminders
```

### Headers

```text
Content-Type: application/json
```

```text
X-Cron-Secret: <CRON_SECRET 的實際值>
```

### Body

```json
{}
```

### Timeout

目前建議：

```text
10000 ms
```

也就是 10 秒。

---

## 11. Reminder Email

目前寄件人：

```text
PTS Permit Reminder <onboarding@resend.dev>
```

這是 Resend 提供的測試寄件人。

目前適合：

- 內部測試
- 少量使用

未來正式使用時，建議驗證公司網域後改成公司寄件地址，例如：

```text
permit@ptssyndicate.com
```

或其他公司內部專用信箱。

---

## 12. Email 內容

Email Subject：

```text
【簽審提醒】N 筆公文即將到期
```

Email 表格目前包含：

```text
申辦案號
簽審核准文號
貨品類別
有效日期
剩餘天數
```

---

## 13. 防止重複寄送

Edge Function 寄信前會查詢：

```text
notification_logs
```

如果某筆公文已經存在：

```text
permit_id
+
notification_type = expiry_45_days
```

則不再寄送。

Email 成功寄出後才會寫入：

```text
notification_logs
```

因此流程為：

```text
找需要提醒的公文
↓
寄信
↓
確認寄送成功
↓
寫入 notification_logs
```

而不是：

```text
先寫 log
↓
再寄信
```

這樣可以避免 Email 寄送失敗，系統卻誤判為已經提醒。

---

## 14. Database Migrations

目前 migration：

```text
20260916090000_initial_permit_schema.sql
20260916113041_add_unique_expiry_notification_log.sql
20260916114449_enable_pg_net.sql
```

### 14.1 `initial_permit_schema`

建立：

```text
permits
permit_items
notification_recipients
notification_logs
RLS
create_permit_with_items RPC
```

---

### 14.2 `add_unique_expiry_notification_log`

建立：

```text
permit_id + notification_type
```

唯一限制。

用途：

防止同一份公文重複建立同種類型的通知紀錄。

---

### 14.3 `enable_pg_net`

啟用：

```text
pg_net
```

主要供 Supabase Cron 執行 HTTP Request 使用。

---

## 15. Migration History

檢查本機與遠端 migration：

```bash
npx supabase migration list
```

目前應為：

```text
Local            Remote
20260916090000   20260916090000
20260916113041   20260916113041
20260916114449   20260916114449
```

代表本機與 Supabase 遠端 migration history 已對齊。

---

## 16. Edge Function Download

從 Supabase 雲端同步 Edge Function：

```bash
npx supabase functions download send-permit-expiry-reminders
```

```bash
npx supabase functions download send-permit-test-email
```

---

## 17. Edge Function Deploy

未來修改本機 Function 後，可以重新部署。

### 到期提醒 Function

```bash
npx supabase functions deploy send-permit-expiry-reminders
```

### 測試寄信 Function

```bash
npx supabase functions deploy send-permit-test-email
```

部署前需確認：

```text
Secrets
verify_jwt
Cron authentication
```

仍符合目前系統架構。

特別是：

```text
send-permit-expiry-reminders
```

目前採用：

```text
verify_jwt = false
+
X-Cron-Secret
```

的驗證方式。

---

## 18. Deno

Supabase Edge Functions 使用 Deno Runtime。

檢查本機版本：

```bash
deno --version
```

目前安裝版本：

```text
deno 2.9.6
```

Apple Silicon Homebrew 路徑：

```text
/opt/homebrew/bin/deno
```

目前 JetBrains 中 Edge Function 可能仍會出現部分：

```text
Cannot find name 'Deno'
Cannot find module 'jsr:...'
Cannot find module 'npm:...'
```

等 IDE inspection 訊息。

只要：

```text
Supabase Edge Function 可以正常部署
Function 可以正常執行
```

即可暫時忽略。

這些目前屬於 IDE 對 Deno / Supabase Edge Runtime 的解析問題，不代表雲端 Function 執行失敗。

---

## 19. 已完成測試

### PDF Parser

```text
✔ 成功
```

可解析警政署簽審 PDF。

---

### Auth / RLS

```text
✔ 未登入無法讀取 DB
✔ 未登入無法寫入 DB
✔ 登入後可以正常讀寫
```

---

### `create_permit_with_items`

```text
✔ Transaction 測試成功
✔ Rollback 測試成功
```

如果其中一筆 item 寫入失敗，整筆公文不會留下半套資料。

---

### Resend

```text
✔ Email 成功寄出
```

---

### 45 天內到期判斷

```text
✔ 成功
```

---

### `notification_logs`

```text
✔ 成功寫入
```

---

### 防止重複提醒

第一次執行：

```text
找到需提醒公文
→ 寄送 Email
→ 寫入 notification_logs
```

第二次立即執行：

```text
All reminders were already sent
```

因此：

```text
✔ 防止重複寄送成功
```

---

### Cron Job

```text
✔ 已建立
✔ Active
```

排程：

```text
每天台灣時間 09:00
```

Cron expression：

```text
0 1 * * *
```

---

## 20. 後續待辦

### 20.1 正式寄件網域

目前：

```text
onboarding@resend.dev
```

未來正式使用時，可改為公司自己的寄件地址。

例如：

```text
permit@ptssyndicate.com
```

---

### 20.2 收件人管理 UI

目前：

```text
notification_recipients
```

由 Supabase Dashboard 管理。

未來可以在 PTS 小工具增加：

- 新增收件人
- 修改 Email
- 啟用收件人
- 停用收件人

---

### 20.3 公文更新 / 刪除

目前 RLS 尚未開放：

```text
UPDATE
DELETE
```

如果未來需要：

- 修改申辦案號
- 修改有效期限
- 修改貨品資訊
- 刪除錯誤公文

再另外設計對應權限。

---

### 20.4 Email 通知歷史 UI

未來可以在 PTS 小工具顯示：

```text
哪一份公文
何時寄出
提醒類型
```

資料來源：

```text
notification_logs
```

---

## 21. 安全注意事項

以下內容禁止 commit：

```text
RESEND_API_KEY 實際值
CRON_SECRET 實際值
SUPABASE_SERVICE_ROLE_KEY
其他 private keys
```

前端只允許使用：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` 只能存在於：

```text
Supabase Edge Functions
Server-side environment
```

不可放入 Vue 前端程式碼。

---

## 22. Git

本文件建立後：

```bash
git add docs/supabase-permit-reminder.md
```

Commit：

```bash
git commit -m "新增 Supabase 簽審提醒系統文件"
```

---

## 23. 系統流程摘要

整套簽審提醒系統目前流程：

```text
警政署 PDF
↓
PDF Parser
↓
使用者輸入申辦案號
↓
資料驗證
↓
create_permit_with_items
↓
permits + permit_items
↓
Supabase Database
↓
每天 09:00 Cron
↓
send-permit-expiry-reminders
↓
檢查 45 天內到期公文
↓
檢查 notification_logs
↓
排除已提醒公文
↓
Resend Email
↓
notification_recipients
↓
寫入 notification_logs
```

目前核心流程已完成並通過測試。