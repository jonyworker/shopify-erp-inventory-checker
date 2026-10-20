import { supabase } from '@/lib/supabaseClient'

/**
 * 過渡用：讓舊共用帳號維持既有 Email 登入方式。
 * 待正式完成帳號移轉、RLS 與停用流程後，再決定何時移除。
 */
export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (error) {
    // 登入畫面不必揭露 Auth 內部的英文錯誤訊息。
    throw new Error('帳號或密碼錯誤，請重新確認')
  }

  return data
}

/**
 * Username 登入：
 * 1. Edge Function 在伺服器端查詢 Username 對應的 Supabase Auth 身分
 * 2. Edge Function 由 Supabase Auth 驗證密碼，回傳工作階段 Token
 * 3. setSession 交給既有 Supabase Client 保存工作階段
 * 4. authState.js 的 onAuthStateChange 自動更新登入狀態
 *
 * 重要：不得在前端保存 service_role 或 secret key。
 */
export async function signInWithUsername(username, password) {
  const normalizedUsername = String(username ?? '').trim().toLowerCase()

  if (!/^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/.test(normalizedUsername)) {
    throw new Error('請輸入有效的登入帳號')
  }

  if (!password) {
    throw new Error('請輸入密碼')
  }

  const { data, error } = await supabase.functions.invoke(
    'pts-username-login',
    {
      body: {
        username: normalizedUsername,
        password
      }
    }
  )

  if (error) {
    // FunctionsHttpError 的 context 為 HTTP Response。
    // 只依據狀態碼顯示通用訊息，不洩漏是否有這個帳號。
    const status = error.context?.status

    if (status === 429) {
      throw new Error('登入嘗試過於頻繁，請稍後再試')
    }

    if (status === 503 || status >= 500) {
      throw new Error('登入服務暫時無法使用，請稍後再試')
    }

    throw new Error('帳號或密碼錯誤，或帳號尚未啟用')
  }

  if (!data?.access_token || !data?.refresh_token) {
    throw new Error('登入回應不完整，請稍後再試')
  }

  const { data: sessionData, error: sessionError } =
    await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token
    })

  if (sessionError || !sessionData?.session?.user) {
    throw new Error('無法建立登入工作階段，請稍後再試')
  }

  return sessionData
}


/**
 * 首次設定密碼：新員工尚無 Auth Session，使用高熵一次性憑證驗證。
 * 只由部署於 Supabase 的 pts-employee-activate 更新 Supabase Auth 密碼。
 * 此函式不會登入、不會儲存或記錄一次性憑證及新密碼。
 */
export async function activateEmployeeAccount({ username, temporaryPassword, newPassword }) {
  const { data, error } = await supabase.functions.invoke('pts-employee-activate', {
    body: {
      username: String(username ?? '').trim().toLowerCase(),
      temporary_password: temporaryPassword,
      new_password: newPassword
    }
  })

  if (error) {
    const status = error.context?.status
    // 後端只回傳經過處理、可以顯示給使用者的訊息，不包含憑證。
    let backendMessage = ''
    if (typeof error.context?.clone === 'function') {
      try {
        const response = await error.context.clone().json()
        if (typeof response?.error === 'string' && response.error.length <= 150) {
          backendMessage = response.error
        }
      } catch {
        // 網路錯誤或非 JSON 回應：顯示安全的通用提示。
      }
    }

    if (backendMessage) throw new Error(backendMessage)
    if (status === 400 || status === 401 || status === 403) {
      throw new Error('帳號或一次性憑證無效，請重新檢查')
    }
    if (status === 429) throw new Error('嘗試過於頻繁，請稍後再試')
    if (status === 503 || status >= 500) {
      throw new Error('首次設定密碼服務暫時無法使用，請稍後再試')
    }
    throw new Error('無法完成首次設定密碼，請確認連線後重試')
  }

  if (data?.success !== true) {
    throw new Error('首次設定密碼尚未完成，請聯絡管理員')
  }
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw error
  }
}

export async function getCurrentUser() {
  const {
    data: { user },
    error
  } = await supabase.auth.getUser()

  if (error) {
    throw error
  }

  return user
}
