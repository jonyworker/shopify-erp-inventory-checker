import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const REMINDER_DAYS = 45
const NOTIFICATION_TYPE = "expiry_45_days"

function getTaiwanDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date())
}

function addDays(dateString: string, days: number) {
  const [year, month, day] =
    dateString.split("-").map(Number)

  const date = new Date(
    Date.UTC(year, month - 1, day)
  )

  date.setUTCDate(
    date.getUTCDate() + days
  )

  return date
    .toISOString()
    .slice(0, 10)
}

function getDaysRemaining(
  today: string,
  expirationDate: string
) {
  const start = new Date(
    `${today}T00:00:00Z`
  )

  const end = new Date(
    `${expirationDate}T00:00:00Z`
  )

  return Math.round(
    (
      end.getTime() -
      start.getTime()
    ) /
    (1000 * 60 * 60 * 24)
  )
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

Deno.serve(async (req: Request) => {
  try {
    const cronSecret =
      Deno.env.get("CRON_SECRET")

    if (!cronSecret) {
      throw new Error(
        "Missing CRON_SECRET"
      )
    }

    const requestCronSecret =
      req.headers.get("x-cron-secret")

    if (requestCronSecret !== cronSecret) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized"
        }),
        {
          status: 401,
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      )
    }

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL")

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY"
      )

    const resendApiKey =
      Deno.env.get("RESEND_API_KEY")

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      throw new Error(
        "Missing Supabase environment variables"
      )
    }

    if (!resendApiKey) {
      throw new Error(
        "Missing RESEND_API_KEY"
      )
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false
        }
      }
    )

    const {
      data: recipients,
      error: recipientError
    } = await supabase
      .from("notification_recipients")
      .select("id, name, email")
      .eq("is_active", true)
      .order(
        "created_at",
        { ascending: true }
      )

    if (recipientError) {
      throw recipientError
    }

    if (
      !recipients ||
      recipients.length === 0
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          message:
            "No active notification recipients"
        }),
        {
          status: 400,
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      )
    }

    const today =
      getTaiwanDateString()

    const reminderEndDate =
      addDays(
        today,
        REMINDER_DAYS
      )

      const {
          data: permits,
          error: permitError
      } = await supabase
          .from("permits")
          .select(`
            id,
            application_no,
            certificate_no,
            issue_date,
            expiration_date,
            goods_type,
            applicant,
            status,
            reminder_paused
          `)
          .eq(
              "status",
              "active"
          )
          .eq(
              "reminder_paused",
              false
          )
          .gte(
              "expiration_date",
              today
          )
          .lte(
              "expiration_date",
              reminderEndDate
          )
          .order(
              "expiration_date",
              { ascending: true }
          )

    const permitIds =
      permits.map(
        (permit) => permit.id
      )

    const {
      data: logs,
      error: logError
    } = await supabase
      .from("notification_logs")
      .select("permit_id")
      .eq(
        "notification_type",
        NOTIFICATION_TYPE
      )
      .in(
        "permit_id",
        permitIds
      )

    if (logError) {
      throw logError
    }

    const alreadySentIds =
      new Set(
        (logs ?? []).map(
          (log) => log.permit_id
        )
      )

    const permitsToNotify =
      permits.filter(
        (permit) =>
          !alreadySentIds.has(
            permit.id
          )
      )

    if (
      permitsToNotify.length === 0
    ) {
      return new Response(
        JSON.stringify({
          success: true,
          message:
            "All reminders were already sent",
          permitCount: 0
        }),
        {
          status: 200,
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      )
    }

    const rows =
      permitsToNotify
        .map((permit) => {
          const daysRemaining =
            getDaysRemaining(
              today,
              permit.expiration_date
            )

          return `
            <tr>
              <td style="padding:10px;border-bottom:1px solid #e2e8f0;">
                ${escapeHtml(
                  permit.application_no
                )}
              </td>

              <td style="padding:10px;border-bottom:1px solid #e2e8f0;">
                ${escapeHtml(
                  permit.certificate_no
                )}
              </td>

              <td style="padding:10px;border-bottom:1px solid #e2e8f0;">
                ${escapeHtml(
                  permit.goods_type
                )}
              </td>

              <td style="padding:10px;border-bottom:1px solid #e2e8f0;">
                ${escapeHtml(
                  permit.expiration_date
                )}
              </td>

              <td style="padding:10px;border-bottom:1px solid #e2e8f0;">
                剩 ${daysRemaining} 天
              </td>
            </tr>
          `
        })
        .join("")

    const emailResponse =
      await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${resendApiKey}`,

            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            from:
              "PTS Permit Reminder <onboarding@resend.dev>",

            to: recipients.map(
              (recipient) =>
                recipient.email
            ),

            subject:
              `【簽審提醒】${permitsToNotify.length} 筆公文即將到期`,

            html: `
              <div
                style="
                  font-family:
                    Arial,
                    sans-serif;
                  line-height:1.7;
                  color:#0f172a;
                "
              >
                <h2>
                  簽審公文即將到期提醒
                </h2>

                <p>
                  以下簽審公文將於
                  45 天內到期，
                  請留意後續申辦作業。
                </p>

                <table
                  style="
                    width:100%;
                    border-collapse:
                      collapse;
                    margin-top:20px;
                  "
                >
                  <thead>
                    <tr
                      style="
                        background:#f8fafc;
                        text-align:left;
                      "
                    >
                      <th style="padding:10px;">
                        申辦案號
                      </th>

                      <th style="padding:10px;">
                        簽審核准文號
                      </th>

                      <th style="padding:10px;">
                        貨品類別
                      </th>

                      <th style="padding:10px;">
                        有效日期
                      </th>

                      <th style="padding:10px;">
                        剩餘天數
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    ${rows}
                  </tbody>
                </table>

                <p
                  style="
                    margin-top:24px;
                    color:#64748b;
                    font-size:13px;
                  "
                >
                  此信件由 PTS
                  簽審公文管理系統自動寄送。
                </p>
              </div>
            `
          })
        }
      )

    const emailResult =
      await emailResponse.json()

    if (!emailResponse.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          message:
            "Resend API request failed",
          resend: emailResult
        }),
        {
          status:
            emailResponse.status,

          headers: {
            "Content-Type":
              "application/json"
          }
        }
      )
    }

    const notificationLogs =
      permitsToNotify.map(
        (permit) => ({
          permit_id:
            permit.id,

          notification_type:
            NOTIFICATION_TYPE
        })
      )

    const {
      error: insertLogError
    } = await supabase
      .from("notification_logs")
      .insert(
        notificationLogs
      )

    if (insertLogError) {
      throw insertLogError
    }

    return new Response(
      JSON.stringify({
        success: true,

        recipientCount:
          recipients.length,

        permitCount:
          permitsToNotify.length,

        reminderWindow: {
          from: today,
          to: reminderEndDate
        },

        resend:
          emailResult
      }),
      {
        status: 200,

        headers: {
          "Content-Type":
            "application/json"
        }
      }
    )
  } catch (error) {
    console.error(error)

    return new Response(
      JSON.stringify({
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "Unknown error"
      }),
      {
        status: 500,

        headers: {
          "Content-Type":
            "application/json"
        }
      }
    )
  }
})
