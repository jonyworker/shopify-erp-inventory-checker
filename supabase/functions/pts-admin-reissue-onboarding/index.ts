import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

// PTS Phase 03-I3A: rotate one-time onboarding credential for a PENDING employee.
// Does NOT change the Auth password, unban the account, or disclose the old credential.
const ALLOWED_ORIGINS = new Set([
  'https://jonyworker.github.io',
  'http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173',
  'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:4173'
])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

function headersFor(origin: string | null) {
  const h: Record<string,string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    'pragma': 'no-cache',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin'
  }
  if (origin && ALLOWED_ORIGINS.has(origin)) h['access-control-allow-origin'] = origin
  return h
}
const json = (status: number, data: Record<string, unknown>, origin: string|null) =>
  new Response(JSON.stringify(data), { status, headers: headersFor(origin) })
function randomIndex(max: number) {
  const bucket = Math.floor(256/max)*max
  const bytes = new Uint8Array(1)
  do { crypto.getRandomValues(bytes) } while (bytes[0] >= bucket)
  return bytes[0]%max
}
function newCredential() {
  const result = Array.from({length:24},()=>ALPHABET[randomIndex(ALPHABET.length)])
  result[0] = 'ABCDEFGHJKLMNPQRSTUVWXYZ'[randomIndex(24)]
  result[1] = 'abcdefghijkmnopqrstuvwxyz'[randomIndex(25)]
  result[2] = '23456789'[randomIndex(8)]
  for(let i=result.length-1;i>0;i--){const j=randomIndex(i+1);[result[i],result[j]]=[result[j],result[i]]}
  return result.join('')
}

Deno.serve(async (request:Request)=>{
  const origin = request.headers.get('origin')
  if(origin && !ALLOWED_ORIGINS.has(origin)) return json(403,{error:'不允許的來源網址'},origin)
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:headersFor(origin)})
  if(request.method!=='POST') return json(405,{error:'只允許 POST'},origin)
  const authHeader=request.headers.get('authorization')||''
  const match=/^Bearer\s+(.+)$/i.exec(authHeader)
  if(!match) return json(401,{error:'尚未登入'},origin)
  const url=Deno.env.get('SUPABASE_URL')
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!url||!key) return json(503,{error:'服務暫時無法使用'},origin)
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:identity,error:identityError}=await admin.auth.getUser(match[1])
  if(identityError||!identity.user?.id) return json(401,{error:'登入已失效'},origin)
  const [{data:actorProfile,error:profileError},{data:adminRow,error:adminError}] = await Promise.all([
    admin.from('app_profiles').select('is_active,must_change_password').eq('user_id',identity.user.id).maybeSingle(),
    admin.from('system_admins').select('user_id').eq('user_id',identity.user.id).maybeSingle()
  ])
  if (profileError || adminError) return json(503,{error:'無法核對管理員資格'},origin)
  if (!actorProfile?.is_active || actorProfile?.must_change_password || !adminRow) {
    return json(403,{error:'只有正式啟用的系統管理員可重新核發'},origin)
  }
  let requestData:unknown
  try {
    const raw=await request.text()
    if(raw.length>4096) return json(413,{error:'資料量過大'},origin)
    requestData=JSON.parse(raw)
  }catch{return json(400,{error:'資料格式不正確'},origin)}
  if(!requestData||typeof requestData!=='object'||Array.isArray(requestData)) return json(400,{error:'資料格式不正確'},origin)
  const data=requestData as Record<string,unknown>
  const userId=typeof data.user_id==='string'?data.user_id:''
  const username=typeof data.confirm_username==='string'?data.confirm_username:''
  const reason=typeof data.reason==='string'?data.reason.trim():''
  if(!UUID.test(userId)||!username||reason.length<1||reason.length>500) return json(400,{error:'請核對帳號與操作原因'},origin)

  // No plaintext or hash in logs. DB transaction either rotates the hash and logs audit or changes nothing.
  const credential=newCredential()
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${userId}:${credential}`))
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
  const expiresAt=new Date(Date.now()+30*86400_000).toISOString()
  const {data:account,error:accountError}=await admin.auth.admin.getUserById(userId)
  if(accountError||!account.user) return json(404,{error:'找不到員工 Auth 帳號'},origin)
  const {data:result,error:rpcError}=await admin.rpc('pts_service_reissue_pending_employee_credential',{
    p_actor_user_id:identity.user.id,
    p_target_user_id:userId,
    p_confirm_username:username,
    p_code_hash:hash,
    p_expires_at:expiresAt,
    p_reason:reason
  })
  if(rpcError){
    // The error message may include user data; return a controlled response.
    if(rpcError.code==='42501') return json(403,{error:'目前帳號不符合重新核發條件，或管理員權限不足'},origin)
    if(rpcError.code==='22023') return json(400,{error:'帳號確認或操作資料有誤'},origin)
    if(rpcError.code==='P0002') return json(404,{error:'找不到員工資料'},origin)
    console.error('Reissue RPC failed',rpcError.code)
    return json(500,{error:'重新核發結果尚無法確認，請勿直接重試'},origin)
  }
  if(!result?.success||result.user_id!==userId||result.username!==username){
    return json(500,{error:'重新核發結果尚無法確認，請勿直接重試'},origin)
  }
  return json(200,{
    success:true,user_id:userId,username:result.username,display_name:result.display_name,
    email:account.user.email??'',temporary_password:credential,
    temporary_password_expires_at:result.temporary_password_expires_at
  },origin)
})
