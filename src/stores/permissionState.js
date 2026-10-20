import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabaseClient'

/**
 * PTS 共用權限狀態（Phase 02-B）
 *
 * 資料來源：
 *   public.pts_my_permissions()  → 目前登入者的最終有效權限
 *   public.pts_is_system_admin() → 是否為權限管理員
 *
 * 這裡只儲存「方便 Vue 顯示」的權限快照。
 * 真正的資料存取限制仍必須由 Supabase RLS / 後端執行。
 */
export const permissionList = ref([])
export const permissionUserId = ref(null)
export const permissionLoading = ref(false)
export const permissionReady = ref(false)
export const permissionError = ref('')
export const isSystemAdmin = ref(false)
export const permissionUpdatedAt = ref(null)

const permissionMap = computed(() => {
  return new Map(
    permissionList.value.map(item => [item.permission_key, item])
  )
})

// 每次更換帳號、重新讀取或登出都會讓舊的非同步回應失效。
let requestVersion = 0

/** 登出或切換帳號時立即清空，避免沿用上一位使用者的權限。 */
export function clearPermissions() {
  requestVersion += 1
  permissionList.value = []
  permissionUserId.value = null
  permissionLoading.value = false
  permissionReady.value = false
  permissionError.value = ''
  isSystemAdmin.value = false
  permissionUpdatedAt.value = null
}

/**
 * 取得已登入使用者的有效權限。
 * userId 僅作為前端非同步請求的識別用途，絕不傳進 RPC 當成授權依據。
 * 後端使用 auth.uid() 自行確認請求者身分。
 */
export async function loadPermissionsForUser(userId) {
  if (!userId) {
    clearPermissions()
    return false
  }

  const version = ++requestVersion
  permissionUserId.value = userId
  permissionList.value = []
  permissionLoading.value = true
  permissionReady.value = false
  permissionError.value = ''
  isSystemAdmin.value = false
  permissionUpdatedAt.value = null

  try {
    const [permissionResult, adminResult] = await Promise.all([
      supabase.rpc('pts_my_permissions'),
      supabase.rpc('pts_is_system_admin')
    ])

    // 已經登出、切換帳號或發出更新的查詢，不可寫回舊結果。
    if (version !== requestVersion) return false

    if (permissionResult.error) throw permissionResult.error
    if (adminResult.error) throw adminResult.error

    if (!Array.isArray(permissionResult.data) ||
        typeof adminResult.data !== 'boolean') {
      throw new Error('權限服務回傳格式不正確')
    }

    permissionList.value = permissionResult.data
    isSystemAdmin.value = adminResult.data
    permissionReady.value = true
    permissionUpdatedAt.value = new Date()

    // 目前僅供開發期間核對，不會限制既有工具的顯示與操作。
    if (import.meta.env.DEV) {
      const allowedCount = permissionResult.data.filter(
        item => item.is_allowed === true
      ).length

      console.info(
        `[PTS 權限] 載入成功：${permissionResult.data.length} 項，` +
        `允許 ${allowedCount} 項，系統管理員：${adminResult.data ? '是' : '否'}`
      )
    }

    return true
  } catch (error) {
    if (version !== requestVersion) return false

    // 讀取失敗時採預設禁止，不保留任何先前快取的權限。
    permissionList.value = []
    isSystemAdmin.value = false
    permissionReady.value = false
    permissionUpdatedAt.value = null
    permissionError.value = '目前無法讀取權限，請稍後重新整理'

    if (import.meta.env.DEV) {
      console.warn('[PTS 權限] 讀取失敗：', error?.message || error)
    }

    return false
  } finally {
    if (version === requestVersion) {
      permissionLoading.value = false
    }
  }
}

/** 供管理員調整權限後或使用者手動重新整理權限時呼叫。 */
export async function refreshPermissions() {
  if (!permissionUserId.value) return false
  return loadPermissionsForUser(permissionUserId.value)
}

/** 取得單一操作的權限詳情（包含繼承來源、禁止原因）。 */
export function getPermissionDetail(permissionKey) {
  if (!permissionReady.value || typeof permissionKey !== 'string') {
    return null
  }

  return permissionMap.value.get(permissionKey) ?? null
}

/** 預設禁止。注意：此方法不能取代真正的資料庫 RLS。 */
export function can(permissionKey) {
  return getPermissionDetail(permissionKey)?.is_allowed === true
}

/** 取得某工具的檢視權限，工具代碼沿用 App.vue 裡的 value。 */
export function canViewTool(toolKey) {
  if (typeof toolKey !== 'string' || !toolKey) return false
  return can(`${toolKey}.view`)
}
