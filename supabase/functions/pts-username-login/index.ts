import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'vary': 'Origin',
}

function respond(status: number, body: object): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

const genericFailure = () => respond(401, { error: '帳號或密碼錯誤，或帳號尚未啟用' })

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return respond(405, { error: '不支援的請求方式' })

  const size = Number(request.headers.get('content-length') || 0)
  if (size > 4096) return respond(413, { error: '請求資料過大' })

  let body: unknown
  try {
    const raw = await request.text()
    if (raw.length > 4096) return respond(413, { error: '請求資料過大' })
    body = JSON.parse(raw)
  } catch {
    return respond(400, { error: '登入資料格式錯誤' })
  }

  const data = body as Record<string, unknown> | null
  const username = typeof data?.username === 'string' ? data.username.trim().toLowerCase() : ''
  const password = typeof data?.password === 'string' ? data.password : ''
  if (!/^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/.test(username) || password.length < 1 || password.length > 1024) {
    return genericFailure()
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !serviceKey || !anonKey) {
    console.error('Username login environment not configured')
    return respond(503, { error: '登入服務暫時無法使用' })
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // Username budget is authoritative. The network signal is best effort and
  // not used to establish identity: proxies can affect IP headers.
  const forwarded = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const networkHint = forwarded && forwarded.length <= 128 ? forwarded : null
  const { data: allowed, error: limiterError } = await admin.rpc('pts_consume_username_login_attempt', {
    p_username: username, p_network_hint: networkHint,
  })
  if (limiterError) {
    console.error('Login limiter failed', limiterError.message)
    return respond(503, { error: '登入服務暫時無法使用' })
  }
  if (allowed !== true) return respond(429, { error: '登入嘗試過於頻繁，請稍後重試' })

  const { data: profile, error: lookupError } = await admin
    .from('app_profiles').select('user_id,is_active').eq('username', username).maybeSingle()
  if (lookupError) {
    console.error('Profile lookup failed', lookupError.message)
    return respond(503, { error: '登入服務暫時無法使用' })
  }
  if (!profile?.is_active) return genericFailure()

  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(profile.user_id)
  if (authError || !authUser.user?.email) return genericFailure()

  // Auth validates the password; we never read its hash or store its plaintext.
  const { data: session, error: signInError } = await client.auth.signInWithPassword({
    email: authUser.user.email,
    password,
  })
  if (signInError || !session.session || session.user?.id !== profile.user_id) return genericFailure()

  return respond(200, {
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
    expires_in: session.session.expires_in,
    token_type: session.session.token_type,
  })
})
