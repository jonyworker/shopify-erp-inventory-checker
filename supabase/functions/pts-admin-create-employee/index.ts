import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

/**
 * PTS Phase 03-D1: authenticated administrator creates a *pending* employee.
 * - Requires a real, valid admin JWT, not merely a browser-supplied user ID.
 * - SUPABASE_SERVICE_ROLE_KEY is read ONLY on this Edge Function.
 * - One-time temporary password is generated server-side and NEVER stored
 *   in app_profiles, audit logs, or console logs.
 * - New profile is inactive AND Auth user is banned until Phase 03-D3.
 * - The employee onboarding code differs from the hidden Auth password.
 * - No emails are sent.
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

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

function headersFor(origin: string | null) {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    'pragma': 'no-cache',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['access-control-allow-origin'] = origin
  }
  return headers
}

function jsonResponse(status: number, data: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(data), { status, headers: headersFor(origin) })
}

// Rejection sampling avoids modulo bias in generated temporary passwords.
function randomIndex(max: number): number {
  const bucket = Math.floor(256 / max) * max
  const bytes = new Uint8Array(1)
  do {
    crypto.getRandomValues(bytes)
  } while (bytes[0] >= bucket)
  return bytes[0] % max
}

function generateTemporaryPassword(): string {
  const chars = Array.from({ length: 24 }, () => ALPHABET[randomIndex(ALPHABET.length)])
  // Ensure the visible password contains at least one uppercase, lowercase and digit.
  chars[0] = 'ABCDEFGHJKLMNPQRSTUVWXYZ'[randomIndex(24)]
  chars[1] = 'abcdefghijkmnopqrstuvwxyz'[randomIndex(25)]
  chars[2] = '23456789'[randomIndex(8)]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin')
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(403, { error: '不允許的來源網址' }, origin)
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: headersFor(origin) })
  }
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: '只允許 POST' }, origin)
  }

  const authorization = request.headers.get('authorization') || ''
  const tokenMatch = /^Bearer\s+(.+)$/i.exec(authorization)
  if (!tokenMatch) return jsonResponse(401, { error: '尚未登入' }, origin)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) {
    console.error('Missing server-side Supabase configuration')
    return jsonResponse(503, { error: '帳號建立服務暫時無法使用' }, origin)
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Server-side validation of the provided access token.
  const { data: authInfo, error: authError } = await admin.auth.getUser(tokenMatch[1])
  if (authError || !authInfo.user?.id) {
    return jsonResponse(401, { error: '登入已失效，請重新登入' }, origin)
  }
  const actorId = authInfo.user.id

  const [{ data: profile, error: profileError }, { data: systemAdmin, error: adminError }] =
    await Promise.all([
      admin.from('app_profiles').select('user_id,is_active').eq('user_id', actorId).maybeSingle(),
      admin.from('system_admins').select('user_id').eq('user_id', actorId).maybeSingle(),
    ])
  if (profileError || adminError) {
    console.error('PTS admin verification failed')
    return jsonResponse(503, { error: '無法確認管理員資格' }, origin)
  }
  if (!profile?.is_active || !systemAdmin) {
    return jsonResponse(403, { error: '僅系統管理員可以建立員工帳號' }, origin)
  }

  let input: unknown
  try {
    const raw = await request.text()
    if (raw.length > 4096) return jsonResponse(413, { error: '資料量過大' }, origin)
    input = JSON.parse(raw)
  } catch {
    return jsonResponse(400, { error: 'JSON 格式錯誤' }, origin)
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return jsonResponse(400, { error: '資料格式錯誤' }, origin)
  }
  const payload = input as Record<string, unknown>
  const username = typeof payload.username === 'string'
    ? payload.username.trim().toLowerCase() : ''
  const displayName = typeof payload.display_name === 'string'
    ? payload.display_name.trim() : ''
  const email = typeof payload.email === 'string'
    ? payload.email.trim().toLowerCase() : ''

  if (!/^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/.test(username)) {
    return jsonResponse(400, { error: 'Username 必須是 3–32 個合法英文字元或數字組合' }, origin)
  }
  if (displayName.length < 1 || displayName.length > 120) {
    return jsonResponse(400, { error: '顯示名稱需為 1–120 個字元' }, origin)
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(400, { error: '請輸入有效的員工 Email' }, origin)
  }

  const { data: existingProfile, error: duplicateError } = await admin
    .from('app_profiles').select('user_id').eq('username', username).maybeSingle()
  if (duplicateError) return jsonResponse(503, { error: '暫時無法驗證帳號是否重複' }, origin)
  if (existingProfile) return jsonResponse(409, { error: 'Username 已被使用' }, origin)

  const temporaryPassword = generateTemporaryPassword()
  const internalAuthPassword = generateTemporaryPassword() + generateTemporaryPassword()
  const { data: newAuth, error: createError } = await admin.auth.admin.createUser({
    email,
    password: internalAuthPassword,
    email_confirm: true, // Admin-provisioned, not employee-verified. No email is sent.
  })
  if (createError || !newAuth.user?.id) {
    // Never return raw Auth errors that may contain sensitive information.
    return jsonResponse(409, { error: '建立 Supabase 帳號失敗，可能是 Email 已被使用' }, origin)
  }

  const userId = newAuth.user.id
  // Ban the Auth user, so even knowing the internal password cannot create a
  // session while this account is waiting for first-time onboarding.
  const { data: banned, error: banError } = await admin.auth.admin.updateUserById(
    userId, { ban_duration: '876000h' },
  )
  const bannedUntil = Date.parse(banned?.user?.banned_until || '')
  if (banError || !Number.isFinite(bannedUntil) || bannedUntil < Date.now() + 365 * 86400_000) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(userId)
    if (cleanupError) console.error('CRITICAL: failed cleanup after Auth ban failed', userId)
    return jsonResponse(500, { error: '無法安全鎖定新帳號，請管理員檢查帳號清單' }, origin)
  }

  // Hash the one-time, high-entropy secret with the user ID as domain salt.
  const digest = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`${userId}:${temporaryPassword}`),
  )
  const codeHash = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('')
  const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString()

  const { error: registerError } = await admin.rpc('pts_service_register_employee', {
    p_actor_user_id: actorId,
    p_new_user_id: userId,
    p_username: username,
    p_display_name: displayName,
    p_code_hash: codeHash,
    p_expires_at: expiresAt,
  })

  if (registerError) {
    // Compensating rollback: Auth user deletion cascades to the app profile.
    const { error: cleanupError } = await admin.auth.admin.deleteUser(userId)
    if (cleanupError) {
      console.error('CRITICAL: cleanup of newly provisioned Auth user failed', userId)
      return jsonResponse(500, { error: '建立失敗且需管理員檢查殘留帳號，請暫停重試' }, origin)
    }
    if (registerError.code === '23505') {
      return jsonResponse(409, { error: 'Username 或 Email 已被使用' }, origin)
    }
    console.error('Register pending profile failed:', registerError.code)
    return jsonResponse(500, { error: '建立員工資料失敗，已回復帳號建立操作' }, origin)
  }

  return jsonResponse(201, {
    user_id: userId,
    username,
    display_name: displayName,
    email,
    is_active: false,
    must_change_password: true,
    temporary_password_expires_at: expiresAt,
    temporary_password: temporaryPassword,
    notice: '這是一次性首次設定密碼憑證，僅顯示一次。員工目前仍無法登入，須等 Phase 03-D3 上線後使用。',
  }, origin)
})
