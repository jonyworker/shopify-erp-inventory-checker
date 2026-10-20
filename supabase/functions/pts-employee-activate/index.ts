import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

/**
 * PTS Phase 03-D3: FIRST-TIME employee password setup.
 *
 * This endpoint is intentionally unauthenticated at Supabase Gateway level
 * (--no-verify-jwt) because the employee does not yet have a valid session.
 * It authenticates using the one-time 24-character high-entropy onboarding code.
 * SQL enforces 30-day expiry, 5 bad attempts, one concurrent 3-minute claim,
 * and service_role-only EXECUTE. CORS is a browser safety boundary, NOT auth.
 *
 * Sequence: verify code -> set Auth password while BANNED -> activate PTS in DB
 * -> unban Auth. Auth unban is LAST to protect older tables with broad RLS.
 *
 * Never log or persist the onboarding code / chosen password.
 */

const ALLOWED_ORIGINS = new Set([
  'https://jonyworker.github.io',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:4173',
])

const COMMON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
  pragma: 'no-cache',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  vary: 'Origin',
}

function corsHeaders(origin: string | null): HeadersInit {
  return origin && ALLOWED_ORIGINS.has(origin)
    ? { ...COMMON_HEADERS, 'access-control-allow-origin': origin }
    : { ...COMMON_HEADERS }
}

function respond(status: number, message: string, origin: string | null, success = false): Response {
  return new Response(JSON.stringify(success ? { success: true, message } : { success: false, error: message }), {
    status,
    headers: corsHeaders(origin),
  })
}

const GENERIC_INVALID = '帳號或首次設定憑證錯誤、已過期，或已超過允許嘗試次數'

function isValidPassword(password: string): boolean {
  return password.length >= 12 && password.length <= 128 &&
    /[A-Za-z]/.test(password) && /[0-9]/.test(password) &&
    !/[\x00-\x1f\x7f]/.test(password)
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin')
  if (origin && !ALLOWED_ORIGINS.has(origin)) return respond(403, '不允許的來源網址', origin)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (request.method !== 'POST') return respond(405, '只允許 POST', origin)

  let payload: Record<string, unknown>
  try {
    const raw = await request.text()
    if (raw.length > 4096) return respond(413, '資料量過大', origin)
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return respond(400, '資料格式錯誤', origin)
    }
    payload = parsed as Record<string, unknown>
  } catch {
    return respond(400, 'JSON 格式錯誤', origin)
  }

  const username = typeof payload.username === 'string' ? payload.username.trim().toLowerCase() : ''
  const onboardingCode = typeof payload.temporary_password === 'string' ? payload.temporary_password.trim() : ''
  const newPassword = typeof payload.new_password === 'string' ? payload.new_password : ''
  if (!/^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/.test(username) ||
      !/^[A-HJ-NP-Za-km-z2-9]{24}$/.test(onboardingCode)) {
    return respond(400, GENERIC_INVALID, origin)
  }
  if (!isValidPassword(newPassword) || newPassword === onboardingCode) {
    return respond(400, '新密碼須為 12–128 字元，至少包含英文字母與數字，且不能與暫時憑證相同', origin)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) {
    console.error('Employee activation service is missing Supabase server configuration')
    return respond(503, '首次設定密碼服務暫時無法使用', origin)
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Look up only a pending/inactive PTS user. Do not reveal whether it exists.
  const { data: profile, error: profileError } = await admin
    .from('app_profiles')
    .select('user_id,is_active,must_change_password')
    .eq('username', username)
    .maybeSingle()
  if (profileError) {
    console.error('Activation profile lookup failed')
    return respond(503, '首次設定密碼服務暫時無法使用', origin)
  }
  if (!profile || profile.is_active || !profile.must_change_password || !isUuid(profile.user_id)) {
    return respond(400, GENERIC_INVALID, origin)
  }
  const userId = profile.user_id as string

  // A provisioning error could otherwise allow the employee to sign in while
  // SQL has not completed the activation. Verify the Auth ban is still active.
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId)
  const banUntil = Date.parse(authUser.user?.banned_until || '')
  if (authError || !Number.isFinite(banUntil) || banUntil < Date.now() + 86400_000) {
    console.error('Employee activation aborted: Auth user is not safely banned')
    return respond(503, '帳號暫時無法完成啟用，請聯絡管理員', origin)
  }

  const digest = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`${userId}:${onboardingCode}`),
  )
  const codeHash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('')
  const claimToken = crypto.randomUUID()

  const { data: claimed, error: claimError } = await admin.rpc('pts_service_begin_employee_activation', {
    p_target_user_id: userId,
    p_code_hash: codeHash,
    p_claim_token: claimToken,
  })
  if (claimError) {
    console.error('Activation verification failed:', claimError.code)
    return respond(503, '首次設定密碼服務暫時無法使用', origin)
  }
  if (claimed !== true) return respond(400, GENERIC_INVALID, origin)

  async function releaseClaim(): Promise<void> {
    const { error } = await admin.rpc('pts_service_release_employee_activation', {
      p_target_user_id: userId,
      p_claim_token: claimToken,
    })
    if (error) console.error('CRITICAL: Failed to release employee activation reservation', error.code)
  }

  // Safe while the account is still Auth-banned and the PTS profile is inactive.
  const { error: changeError } = await admin.auth.admin.updateUserById(userId, {
    password: newPassword,
  })
  if (changeError) {
    await releaseClaim()
    console.error('Employee activation password update failed:', changeError.code)
    return respond(503, '無法更新密碼，請稍後重試或聯絡管理員', origin)
  }

  // Recheck ban after the Auth password update. If an upstream behavior ever
  // clears the ban during password changes, fail closed before enabling PTS.
  const { data: afterPassword, error: statusError } = await admin.auth.admin.getUserById(userId)
  const stillBannedUntil = Date.parse(afterPassword.user?.banned_until || '')
  if (statusError || !Number.isFinite(stillBannedUntil) || stillBannedUntil < Date.now() + 86400_000) {
    const { error: rebanError } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
    if (rebanError) console.error('CRITICAL: Cannot restore employee Auth ban', rebanError.code)
    await releaseClaim()
    return respond(503, '帳號無法安全完成啟用，請聯絡管理員', origin)
  }

  // Commit profile activation and consume one-time code in ONE DB transaction.
  // The user remains AUTH-BANNED until after this has committed successfully.
  const { data: finished, error: finishError } = await admin.rpc('pts_service_finish_employee_activation', {
    p_target_user_id: userId,
    p_claim_token: claimToken,
  })
  if (finishError || finished !== true) {
    await releaseClaim()
    console.error('CRITICAL: Employee activation DB finalization failed', finishError?.code || 'false')
    return respond(503, '密碼已更新，但帳號啟用未完成，請聯絡管理員', origin)
  }

  const { error: unbanError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: 'none',
  })
  if (unbanError) {
    // Safe failure: password has changed but Auth still banned. Admin assistance
    // is needed to reconcile. Never pretend activation succeeded.
    console.error('CRITICAL: PTS activation committed but Auth ban removal failed', unbanError.code)
    return respond(503, '密碼已設定，但登入啟用未完成，請聯絡管理員', origin)
  }

  return respond(200, '首次設定完成！請使用 Username 與新密碼登入 PTS', origin, true)
})
