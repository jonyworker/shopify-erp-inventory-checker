import { ref } from 'vue'
import { supabase } from '@/lib/supabaseClient'
import {
  clearPermissions,
  loadPermissionsForUser
} from '@/stores/permissionState'

export const currentUser = ref(null)
export const isAuthReady = ref(false)

let authInitializationPromise = null
let authSubscription = null
let syncedUserId = null

/**
 * 將 Supabase Auth 工作階段同步到 Vue。
 * 登入後排程讀取權限；登出或切換帳號時立即清空舊權限。
 */
function syncAuthState(event, session) {
  const user = session?.user ?? null
  const userId = user?.id ?? null
  const accountChanged = userId !== syncedUserId

  syncedUserId = userId
  currentUser.value = user

  if (!userId) {
    if (accountChanged) clearPermissions()
    return
  }

  if (accountChanged) {
    clearPermissions()
  }

  // 同一位使用者再次登入或更新身分時，也重新取得有效權限。
  if (accountChanged || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
    // Supabase 建議不要在 onAuthStateChange callback 裡同步 await 其他
    // Supabase API；排到下一個 event loop 避免 Auth 鎖定造成死結。
    setTimeout(() => {
      if (syncedUserId === userId) {
        void loadPermissionsForUser(userId)
      }
    }, 0)
  }
}

/**
 * 原本 App.vue 只需要呼叫 initializeAuth()，不必修改其他元件。
 * 即使重複呼叫，也只會建立一份 Auth 訂閱。
 */
export function initializeAuth() {
  if (authInitializationPromise) return authInitializationPromise

  authInitializationPromise = (async () => {
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      syncAuthState('INITIAL_SESSION', data.session)
    } catch (error) {
      console.warn('[PTS Auth] 初始化工作階段失敗：', error?.message || error)
      syncAuthState('INITIAL_SESSION', null)
    } finally {
      if (!authSubscription) {
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          syncAuthState(event, session)
        })
        authSubscription = data.subscription
      }

      isAuthReady.value = true
    }
  })()

  return authInitializationPromise
}
