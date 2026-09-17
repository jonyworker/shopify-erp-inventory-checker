import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (_req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase environment variables");
    }

    if (!resendApiKey) {
      throw new Error("Missing RESEND_API_KEY secret");
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false
        }
      }
    );

    const { data: recipients, error: recipientsError } = await supabase
      .from("notification_recipients")
      .select("name,email")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (recipientsError) {
      throw recipientsError;
    }

    if (!recipients || recipients.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "No active notification recipients"
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "PTS Permit Reminder <onboarding@resend.dev>",
        to: recipients.map((recipient) => recipient.email),
        subject: "【測試】簽審公文到期提醒通知",
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.7; color: #0f172a;">
            <h2>簽審公文提醒系統測試</h2>
            <p>這是一封測試信。</p>
            <p>若你收到這封信，代表：</p>
            <ul>
              <li>Supabase Edge Function 可正常執行</li>
              <li>系統可讀取啟用中的通知收件人</li>
              <li>Resend API 可正常寄送 Email</li>
            </ul>
            <p>目前尚未啟用 45 天到期自動提醒。</p>
          </div>
        `
      })
    });

    const emailResult = await emailResponse.json();

    if (!emailResponse.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Resend API request failed",
          resend: emailResult
        }),
        {
          status: emailResponse.status,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        recipientCount: recipients.length,
        resend: emailResult
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
});
