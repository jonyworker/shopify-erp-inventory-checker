import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

/**
 * PTS H3B: employee permanent deletion, admin-only.
 * Must deploy with JWT verification ENABLED (default).
 * Flow: getUser JWT -> check live admin -> SQL reserve+snapshot -> Auth Admin deleteUser
 * -> SQL verify+finalize. SQL trigger blocks deletion without a safe archive.
 * Never expose service_role to browsers; no user is touched on deployment.
 */
const ALLOWED_ORIGINS = new Set([
  'https://jonyworker.github.io',
  'http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173',
  'http://127.0.0.1:5173','http://127.0.0.1:5174','http://127.0.0.1:4173',
])

function headers(origin: string | null): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
    ...(origin && ALLOWED_ORIGINS.has(origin)
      ? { 'access-control-allow-origin': origin } : {}),
  }
}
function reply(status: number, origin: string | null, message: string,
  success = false, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify(success
    ? { success: true, message, ...extra }
    : { success: false, error: message, ...extra }),
  { status, headers: headers(origin) })
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin')
  if (origin && !ALLOWED_ORIGINS.has(origin))
    return reply(403, origin, '不允許的來源網址')
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: headers(origin) })
  if (request.method !== 'POST') return reply(405, origin, '只允許 POST')

  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '')?.[1]
  if (!bearer) return reply(401, origin, '尚未登入管理員帳號')

  let body: Record<string, unknown>
  try {
    const raw = await request.text()
    if (raw.length > 4096) return reply(413, origin, '資料量過大')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return reply(400, origin, '資料格式錯誤')
    body = parsed as Record<string, unknown>
  } catch { return reply(400, origin, 'JSON 格式錯誤') }

  const userId = typeof body.user_id === 'string' ? body.user_id : ''
  const username = typeof body.confirm_username === 'string'
    ? body.confirm_username.trim() : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  const explicitConfirm = body.confirm_permanent_delete === true
  if (!UUID.test(userId) || !/^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/.test(username)
    || reason.length < 1 || reason.length > 500 || !explicitConfirm)
    return reply(400, origin, '必須輸入目標 Username、刪除原因，並再次確認永久刪除')

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRole) return reply(503, origin, '服務端設定不完整')
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: verified, error: userError } = await admin.auth.getUser(bearer)
  if (userError || !verified.user?.id) return reply(401, origin, '登入已失效')
  const actorId = verified.user.id
  if (actorId === userId) return reply(403, origin, '不可刪除自己的帳號')
  const [profileResult, adminResult] = await Promise.all([
    admin.from('app_profiles').select('is_active,must_change_password')
      .eq('user_id', actorId).maybeSingle(),
    admin.from('system_admins').select('user_id')
      .eq('user_id', actorId).maybeSingle(),
  ])
  if (profileResult.error || adminResult.error)
    return reply(503, origin, '無法確認系統管理員資格')
  if (!profileResult.data?.is_active || profileResult.data.must_change_password
    || !adminResult.data) return reply(403, origin, '權限不足：必須為已啟用的系統管理員')

  const token = crypto.randomUUID()
  const { data: prepared, error: prepareError } = await admin.rpc(
    'pts_service_prepare_employee_delete', {
      p_actor_user_id: actorId,
      p_target_user_id: userId,
      p_confirm_username: username,
      p_reason: reason,
      p_delete_token: token,
    })
  if (prepareError || !prepared?.ok || !UUID.test(prepared?.archive_id || '')) {
    if (prepareError?.code === '42501') return reply(403, origin,
      '無法刪除：帳號受保護或仍有需要保留的資料關聯')
    if (prepareError?.code === '22023') return reply(400, origin,
      '目標 Username 或操作資訊不正確')
    if (prepareError?.code === '23505') return reply(409, origin,
      '此帳號已有封存或刪除紀錄，請管理員人工確認')
    if (prepareError?.code === 'P0002') return reply(404, origin, '找不到員工')
    console.error('Prepare delete rejected', prepareError?.code || 'unknown')
    return reply(503, origin, '無法完成刪除前封存，帳號尚未刪除')
  }
  const archiveId: string = prepared.archive_id

  async function flagForReview(note: string): Promise<void> {
    const { error } = await admin.rpc('pts_service_flag_employee_delete_review', {
      p_actor_user_id: actorId,
      p_archive_id: archiveId,
      p_delete_token: token,
      p_note: note,
    })
    if (error) console.error('Delete review state update failed', error.code)
  }

  // Destructive step is deliberately reachable ONLY after the SQL archive commits.
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError) {
    console.error('Auth account delete failed', deleteError.code)
    await flagForReview('Auth deleteUser failed; account and audit archive require reconciliation')
    return reply(503, origin,
      '刪除未完成；封存紀錄已保留，帳號須由管理員確認後處理')
  }

  const { data: done, error: finishError } = await admin.rpc(
    'pts_service_finish_employee_delete', {
      p_actor_user_id: actorId,
      p_archive_id: archiveId,
      p_delete_token: token,
    })
  if (finishError || done?.ok !== true) {
    // DO NOT mark deletion as failed; Auth might already be gone.
    console.error('CRITICAL: Auth deleted but archive finalization failed', finishError?.code)
    return reply(503, origin,
      'Auth 帳號可能已刪除，但封存狀態尚待人工核對。請勿重複操作')
  }
  return reply(200, origin, '帳號已永久刪除，稽核封存完成', true, {
    archive_id: archiveId, username, audits_archived: prepared.audits_archived,
  })
})
