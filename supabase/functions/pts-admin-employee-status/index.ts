import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

/**
 * PTS 03-H2: Admin-only employee deactivate / reactivate endpoint.
 *
 * Browser MUST NEVER receive a service role key. The caller must provide its
 * real Supabase Auth bearer JWT. It is validated with auth.getUser(token).
 *
 * Deactivate: SQL first revokes PTS access + stale JWT data access ->
 *             Auth ban -> SQL confirms + audits.
 * Reactivate: SQL reserves -> Auth unban -> SQL enables PTS access & forces
 *             NEW JWT before business data can be queried.
 * If an external step fails, PTS account stays INACTIVE (fail closed).
 *
 * No permanent deletion happens here. The separate H3 flow handles deletion.
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

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'OPTIONS, POST',
    vary: 'Origin',
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { 'access-control-allow-origin': origin } : {}),
  }
}

function respond(
  code: number,
  origin: string | null,
  message: string,
  success = false,
  extra: Record<string, unknown> = {},
): Response {
  const payload = success ? { success: true, message, ...extra } : { success: false, error: message, ...extra }
  return new Response(JSON.stringify(payload), { status: code, headers: corsHeaders(origin) })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BAN_DURATION = '876000h' // 100 years, matching the onboarding ban behavior.

type Action = 'deactivate' | 'reactivate'

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin')
  if (origin && !ALLOWED_ORIGINS.has(origin)) return respond(403, origin, '不允許的來源網址')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (request.method !== 'POST') return respond(405, origin, '只允許 POST')

  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '')?.[1]
  if (!bearer) return respond(401, origin, '請先登入系統管理員帳號')

  let input: unknown
  try {
    const body = await request.text()
    if (body.length > 4096) return respond(413, origin, '請求資料過大')
    input = JSON.parse(body)
  } catch {
    return respond(400, origin, 'JSON 格式錯誤')
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return respond(400, origin, '請求資料格式錯誤')
  }

  const payload = input as Record<string, unknown>
  const userId = typeof payload.user_id === 'string' ? payload.user_id : ''
  const action = payload.action
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
  if (!UUID.test(userId) || (action !== 'deactivate' && action !== 'reactivate') ||
    reason.length < 1 || reason.length > 500) {
    return respond(400, origin, '請提供正確員工 ID、操作類型及 1–500 字的操作原因')
  }
  const selectedAction: Action = action

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    console.error('PTS employee status service missing server configuration')
    return respond(503, origin, '員工帳號管理服務暫時無法使用')
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // The admin's JWT is authenticated SERVER-SIDE; caller cannot forge actorId.
  const { data: userInfo, error: verifyError } = await admin.auth.getUser(bearer)
  if (verifyError || !userInfo.user?.id) return respond(401, origin, '登入已失效，請重新登入')
  const actorId = userInfo.user.id
  if (actorId === userId) return respond(403, origin, '不能操作自己的帳號')

  // Early auth guard for clear errors; SQL RPCs independently repeat these checks.
  const [{ data: actorProfile, error: actorError }, { data: systemAdmin, error: roleError }] =
    await Promise.all([
      admin.from('app_profiles').select('is_active,must_change_password').eq('user_id', actorId).maybeSingle(),
      admin.from('system_admins').select('user_id').eq('user_id', actorId).maybeSingle(),
    ])
  if (actorError || roleError) return respond(503, origin, '無法驗證管理員身分')
  if (!actorProfile?.is_active || actorProfile.must_change_password || !systemAdmin) {
    return respond(403, origin, '僅系統管理員可執行員工帳號管理')
  }

  const claimToken = crypto.randomUUID()
  const baseArgs = {
    p_actor_user_id: actorId,
    p_target_user_id: userId,
    p_action: selectedAction,
    p_claim_token: claimToken,
  }
  const { data: prepared, error: beginError } = await admin.rpc(
    'pts_service_begin_employee_status_change',
    { ...baseArgs, p_reason: reason },
  )
  if (beginError || prepared?.ok !== true) {
    if (beginError?.code === '42501') return respond(403, origin, '不可操作此帳號（可能為管理員或尚未啟用的員工）')
    if (beginError?.code === 'P0002') return respond(404, origin, '找不到員工帳號')
    if (beginError?.code === '22023') return respond(409, origin, '員工狀態不符合此次操作，請重新整理')
    if (beginError?.code === '55P03') return respond(409, origin, '此帳號正在處理其他操作，請稍候再試')
    console.error('Employee status start failed', beginError?.code || 'unexpected')
    return respond(503, origin, '無法開始員工帳號操作，請稍後再試')
  }

  async function releaseReservation(): Promise<void> {
    const { error } = await admin.rpc('pts_service_abort_employee_status_change', {
      p_actor_user_id: actorId,
      p_target_user_id: userId,
      p_claim_token: claimToken,
    })
    if (error) console.error('Employee status reservation release failed', error.code)
  }

  // Deactivation is already blocked by PTS profile & RLS, even if Auth is slow.
  const shouldBan = selectedAction === 'deactivate'
  const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: shouldBan ? BAN_DURATION : 'none',
  })
  if (authUpdateError) {
    await releaseReservation()
    console.error('Employee status Auth update failed', authUpdateError.code)
    return respond(503, origin, shouldBan
      ? 'PTS 資料權限已停用，但 Auth 封鎖尚未完成，請稍後重試「停用」'
      : 'Auth 解除封鎖失敗，員工仍為停用狀態')
  }

  const { data: authState, error: statusError } = await admin.auth.admin.getUserById(userId)
  const bannedUntil = Date.parse(authState.user?.banned_until || '')
  const banned = Number.isFinite(bannedUntil) && bannedUntil > Date.now() + 86400_000
  const unbanned = !Number.isFinite(bannedUntil) || bannedUntil <= Date.now()
  if (statusError || (shouldBan && !banned) || (!shouldBan && !unbanned)) {
    if (!shouldBan) {
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION })
      if (error) console.error('CRITICAL: cannot reban employee after unban verify failure', error.code)
    }
    await releaseReservation()
    return respond(503, origin, 'Auth 帳號狀態驗證失敗，PTS 帳號仍維持停用，請聯絡管理員')
  }

  const { data: finished, error: finishError } = await admin.rpc(
    'pts_service_finish_employee_status_change', baseArgs,
  )
  if (finishError || finished?.ok !== true) {
    // Always fail closed. Incomplete reactivations must not get a PTS session.
    if (!shouldBan) {
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION })
      if (error) console.error('CRITICAL: cannot reban employee after DB finalize failure', error.code)
    }
    await releaseReservation()
    console.error('Employee status finalization failed', finishError?.code || 'unexpected')
    return respond(503, origin, '狀態更新尚未完整完成，PTS 存取仍被停用，請稍後重試或聯絡管理員')
  }

  return respond(200, origin, shouldBan
    ? '員工已停用，已禁止登入及存取 PTS 業務資料'
    : '員工已重新啟用，請重新登入以取得新的登入憑證', true, {
    user_id: userId,
    action: selectedAction,
    is_active: !shouldBan,
  })
})
