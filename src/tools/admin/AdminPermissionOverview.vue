<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { supabase } from '@/lib/supabaseClient'
import { currentUser } from '@/stores/authState'
import {
  permissionList,
  permissionReady,
  permissionLoading,
  permissionError,
  permissionUpdatedAt,
  permissionUserId,
  isSystemAdmin,
  refreshPermissions
} from '@/stores/permissionState'

/**
 * Phase 03-C：管理員查看有效權限，並管理人員的多部門歸屬。
 * - 自己的權限：沿用既有 permissionState，避免污染登入者的權限快照。
 * - 其他人的權限：只能由管理員呼叫後端受保護的 RPC 查詢。
 * - 選擇帳號、登出或管理員資格重新驗證時，舊請求不可以覆蓋新畫面。
 * - 只允許修改部門歸屬；有效權限仍為唯讀。
 * - 前端管理員判斷僅用於 UX，真正授權由 RPC 後端檢查。
 */
const search = ref('')
const statusFilter = ref('all')

const verifiedAdmin = computed(() =>
  Boolean(
    currentUser.value?.id &&
    permissionReady.value &&
    isSystemAdmin.value &&
    permissionUserId.value === currentUser.value.id
  )
)

const users = ref([])
const usersLoading = ref(false)
const usersError = ref('')
const selectedUserId = ref('')
const otherPermissions = ref([])
const otherPermissionsLoading = ref(false)
const otherPermissionsError = ref('')
const otherPermissionsUserId = ref(null)
const otherPermissionsUpdatedAt = ref(null)
const refreshing = ref(false)

// 部門歸屬僅存放在本頁，不污染登入者 permissionState 中的權限快照。
const departments = ref([])
const departmentsLoading = ref(false)
const departmentsError = ref('')
const departmentsLoadedUserId = ref(null)
const checkedDepartmentIds = ref([])
const savedDepartmentIds = ref([])
const departmentReason = ref('')
const departmentSaving = ref(false)
const departmentSaveError = ref('')
const departmentSaveSuccess = ref('')

const departmentsReady = computed(() =>
  verifiedAdmin.value &&
  !!selectedUserId.value &&
  departmentsLoadedUserId.value === selectedUserId.value &&
  !departmentsLoading.value &&
  !departmentsError.value
)

const selectedDepartmentCount = computed(() => checkedDepartmentIds.value.length)
const departmentChangesPending = computed(() =>
  departmentsReady.value &&
  checkedDepartmentIds.value.slice().sort().join('|') !== savedDepartmentIds.value.slice().sort().join('|')
)

// 版本號讓晚回來的 API 回應失效，防止使用者切換帳號時混用資料。
let usersRequestVersion = 0
let detailsRequestVersion = 0
let departmentsRequestVersion = 0

const viewingSelf = computed(() =>
  Boolean(selectedUserId.value && selectedUserId.value === currentUser.value?.id)
)

const selectedUser = computed(() =>
  users.value.find(user => user.user_id === selectedUserId.value) ?? null
)

const displayedPermissions = computed(() => {
  if (!verifiedAdmin.value) return []
  return viewingSelf.value ? permissionList.value : otherPermissions.value
})

const detailsReady = computed(() =>
  verifiedAdmin.value &&
  (viewingSelf.value
    ? permissionReady.value
    : Boolean(
        selectedUserId.value &&
        otherPermissionsUserId.value === selectedUserId.value &&
        !otherPermissionsLoading.value &&
        !otherPermissionsError.value
      ))
)

// Superuser 由後端有效權限來源判斷，而非以 is_system_admin 猜測。
// 非 Superuser 系統管理員仍可使用多部門歸屬維護功能。
const selectedIsSuperuser = computed(() =>
  detailsReady.value && displayedPermissions.value.some(permission =>
    permission.is_allowed === true &&
    Array.isArray(permission.grant_sources) &&
    permission.grant_sources.includes('system:superuser')
  )
)

const detailsLoading = computed(() =>
  viewingSelf.value ? permissionLoading.value : otherPermissionsLoading.value
)

const lastUpdatedLabel = computed(() => {
  const date = viewingSelf.value
    ? permissionUpdatedAt.value
    : otherPermissionsUpdatedAt.value
  return detailsReady.value && date
    ? new Date(date).toLocaleString('zh-TW', { hour12: false })
    : '尚未載入'
})

const toolNames = {
  inventoryShopify: 'ERP / Shopify 庫存比對',
  inventoryRuten: 'ERP / Ruten 庫存比對',
  priceErp: 'RRP / ERP 價格比對',
  priceShopify: 'RRP / Shopify 價格比對',
  priceRuten: 'RRP / Ruten 價格比對',
  promotionPriceBuilder: 'Promotion 價格產生器',
  shopifyPromotionLaunch: 'Promotion 商品上架',
  shopifyPromotionEnd: 'Promotion 商品下架',
  customsDeclarationParser: '進出口報單整理',
  productManager: '產品資料管理',
  applicationBuilder: '申請書建立器',
  permitSearch: '簽審資料查詢',
  permitPdfParser: '簽審公文匯入',
  meetingArchive: '會議紀錄'
}

const actionNames = {
  view: '檢視',
  create: '新增',
  edit: '編輯',
  delete: '刪除',
  export: '匯出',
  manage_assets: '附件管理'
}

const permittedCount = computed(() =>
  displayedPermissions.value.filter(item => item.is_allowed === true).length
)
const deniedCount = computed(() =>
  displayedPermissions.value.length - permittedCount.value
)

function userOptionLabel(user) {
  const name = user.display_name || user.username || '未命名帳號'
  const id = user.username ? `@${user.username}` : '尚未設定 Username'
  return `${name} · ${id}${user.is_active ? '' : '（未啟用）'}`
}

function resetOtherDetails() {
  detailsRequestVersion += 1
  otherPermissions.value = []
  otherPermissionsLoading.value = false
  otherPermissionsError.value = ''
  otherPermissionsUserId.value = null
  otherPermissionsUpdatedAt.value = null
}

async function loadOtherPermissions(userId) {
  if (!verifiedAdmin.value || !userId || userId === currentUser.value?.id) return
  if (!users.value.some(user => user.user_id === userId)) return

  const requestVersion = ++detailsRequestVersion
  otherPermissions.value = []
  otherPermissionsUserId.value = null
  otherPermissionsUpdatedAt.value = null
  otherPermissionsError.value = ''
  otherPermissionsLoading.value = true

  try {
    const { data, error } = await supabase.rpc('pts_admin_user_permissions', {
      p_target_user_id: userId
    })

    if (requestVersion !== detailsRequestVersion ||
        !verifiedAdmin.value || selectedUserId.value !== userId) return

    if (error) throw error
    if (!Array.isArray(data)) throw new Error('有效權限回傳格式不正確')

    otherPermissions.value = data
    otherPermissionsUserId.value = userId
    otherPermissionsUpdatedAt.value = new Date()
  } catch (error) {
    if (requestVersion !== detailsRequestVersion ||
        !verifiedAdmin.value || selectedUserId.value !== userId) return

    otherPermissionsError.value = '無法讀取這位人員的權限，請稍後重新整理。'
    if (import.meta.env.DEV) {
      console.warn('[PTS 管理員] 查詢人員權限失敗：', error?.message || error)
    }
  } finally {
    if (requestVersion === detailsRequestVersion) {
      otherPermissionsLoading.value = false
    }
  }
}


function resetDepartmentDetails() {
  departmentsRequestVersion += 1
  departments.value = []
  departmentsLoadedUserId.value = null
  departmentsLoading.value = false
  departmentsError.value = ''
  checkedDepartmentIds.value = []
  savedDepartmentIds.value = []
  departmentReason.value = ''
  departmentSaveError.value = ''
  departmentSaveSuccess.value = ''
}

async function loadUserDepartments(userId) {
  if (!verifiedAdmin.value || !userId || selectedUserId.value !== userId) return
  if (!users.value.some(user => user.user_id === userId)) return

  const version = ++departmentsRequestVersion
  departmentsLoading.value = true
  departmentsError.value = ''
  departmentsLoadedUserId.value = null
  departmentSaveError.value = ''
  departmentSaveSuccess.value = ''

  try {
    const { data, error } = await supabase.rpc('pts_admin_user_departments', {
      p_target_user_id: userId
    })
    if (version !== departmentsRequestVersion ||
        !verifiedAdmin.value || selectedUserId.value !== userId) return
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('部門歸屬資料格式不正確')

    departments.value = data
    const assigned = data.filter(item => item.is_assigned).map(item => item.department_id)
    checkedDepartmentIds.value = [...assigned]
    savedDepartmentIds.value = [...assigned]
    departmentReason.value = ''
    departmentsLoadedUserId.value = userId
  } catch (error) {
    if (version !== departmentsRequestVersion ||
        !verifiedAdmin.value || selectedUserId.value !== userId) return
    departmentsError.value = '無法讀取此人員的部門歸屬，請稍後重試。'
    if (import.meta.env.DEV) {
      console.warn('[PTS 管理員] 讀取部門歸屬失敗：', error?.message || error)
    }
  } finally {
    if (version === departmentsRequestVersion) departmentsLoading.value = false
  }
}

function canToggleDepartment(department) {
  if (!verifiedAdmin.value || !departmentsReady.value || departmentSaving.value ||
      selectedUser.value?.is_active !== true) return false
  // 停用部門不得新增歸屬，原本已指派者仍可取消、保留或恢復未儲存的勾選。
  return department.is_active || department.is_assigned
}

function toggleDepartment(id, checked) {
  const department = departments.value.find(item => item.department_id === id)
  if (!department || !canToggleDepartment(department)) return
  const next = new Set(checkedDepartmentIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  checkedDepartmentIds.value = [...next]
  departmentSaveError.value = ''
  departmentSaveSuccess.value = ''
}

function discardDepartmentChanges() {
  checkedDepartmentIds.value = [...savedDepartmentIds.value]
  departmentReason.value = ''
  departmentSaveError.value = ''
  departmentSaveSuccess.value = ''
}

function confirmDiscardDepartmentChanges() {
  return !departmentChangesPending.value ||
    window.confirm('此人員的部門歸屬還沒儲存，確定捨棄修改嗎？')
}

function handleUserChange(event) {
  const nextUserId = event.target.value
  if (nextUserId === selectedUserId.value) return
  if (departmentSaving.value || !confirmDiscardDepartmentChanges()) {
    event.target.value = selectedUserId.value
    return
  }
  selectedUserId.value = nextUserId
}

async function handleSaveDepartments() {
  const userId = selectedUserId.value
  if (!departmentsReady.value || !departmentChangesPending.value ||
      departmentSaving.value || selectedUser.value?.is_active !== true) return

  const reason = departmentReason.value.trim()
  if (!reason || reason.length > 500) {
    departmentSaveError.value = '請填寫 1～500 字的部門歸屬異動原因。'
    return
  }

  const newIds = [...checkedDepartmentIds.value]
  departmentSaving.value = true
  departmentSaveError.value = ''
  departmentSaveSuccess.value = ''

  try {
    const { error } = await supabase.rpc('pts_admin_save_user_departments', {
      p_target_user_id: userId,
      p_department_ids: newIds,
      p_reason: reason
    })
    if (error) throw error
    if (!verifiedAdmin.value || selectedUserId.value !== userId) return

    // 先把伺服器已確認的值當成基準，避免重新查詢時誤判尚未儲存。
    savedDepartmentIds.value = [...newIds]
    departmentReason.value = ''
    await loadUserDepartments(userId)
    if (!verifiedAdmin.value || selectedUserId.value !== userId) return

    // 部門聯集可能改變有效權限，重新取得所選帳號的權限快照。
    if (userId === currentUser.value?.id) {
      await refreshPermissions()
    } else {
      await loadOtherPermissions(userId)
    }
    if (verifiedAdmin.value && selectedUserId.value === userId) {
      departmentSaveSuccess.value = '部門歸屬已儲存，有效權限已重新讀取。'
    }
  } catch (error) {
    if (!verifiedAdmin.value || selectedUserId.value !== userId) return
    departmentSaveError.value = error?.message || '儲存部門歸屬失敗，請稍後再試。'
    if (import.meta.env.DEV) {
      console.warn('[PTS 管理員] 更新部門歸屬失敗：', error?.message || error)
    }
  } finally {
    departmentSaving.value = false
  }
}

async function loadUsers() {
  if (!verifiedAdmin.value) return

  const requestVersion = ++usersRequestVersion
  usersLoading.value = true
  usersError.value = ''

  try {
    const { data, error } = await supabase.rpc('pts_admin_users')
    if (requestVersion !== usersRequestVersion || !verifiedAdmin.value) return

    if (error) throw error
    if (!Array.isArray(data)) throw new Error('人員清單回傳格式不正確')

    users.value = data
    if (!data.some(user => user.user_id === selectedUserId.value)) {
      // 人員確實變更時，交由 selectedUserId watcher 讀取新資料，避免重複請求。
      selectedUserId.value = currentUser.value?.id || ''
      return
    }

    // 身分重新驗證或手動重新整理後，保留原選取人員並同步權限與部門。
    if (departmentsLoadedUserId.value !== selectedUserId.value &&
        !departmentsLoading.value) {
      void loadUserDepartments(selectedUserId.value)
    }
    if (selectedUserId.value !== currentUser.value?.id) {
      await loadOtherPermissions(selectedUserId.value)
    }
  } catch (error) {
    if (requestVersion !== usersRequestVersion || !verifiedAdmin.value) return
    usersError.value = '目前無法取得人員清單，請稍後重新整理。'
    if (import.meta.env.DEV) {
      console.warn('[PTS 管理員] 讀取人員清單失敗：', error?.message || error)
    }
  } finally {
    if (requestVersion === usersRequestVersion) usersLoading.value = false
  }
}

async function handleRefresh() {
  if (!verifiedAdmin.value || refreshing.value || departmentSaving.value) return
  if (!confirmDiscardDepartmentChanges()) return
  refreshing.value = true
  try {
    // 同時重新驗證自己的管理員資格；verifiedAdmin 會暫時 false，
    // watch 恢復後自動重新讀取名單與目前選定的其他人權限。
    await refreshPermissions()
  } finally {
    refreshing.value = false
  }
}

watch(
  () => currentUser.value?.id ?? null,
  userId => {
    usersRequestVersion += 1
    users.value = []
    usersError.value = ''
    usersLoading.value = false
    selectedUserId.value = userId || ''
    resetOtherDetails()
    resetDepartmentDetails()
    search.value = ''
    statusFilter.value = 'all'
  },
  { immediate: true }
)

watch(
  verifiedAdmin,
  isVerified => {
    if (!isVerified) {
      usersRequestVersion += 1
      users.value = []
      usersLoading.value = false
      usersError.value = ''
      resetOtherDetails()
      resetDepartmentDetails()
      return
    }
    void loadUsers()
  },
  { immediate: true }
)

watch(selectedUserId, userId => {
  resetOtherDetails()
  resetDepartmentDetails()
  if (!verifiedAdmin.value) return
  if (userId !== currentUser.value?.id) {
    void loadOtherPermissions(userId)
  }
  if (users.value.some(user => user.user_id === userId)) {
    void loadUserDepartments(userId)
  }
})

onUnmounted(() => {
  usersRequestVersion += 1
  detailsRequestVersion += 1
  departmentsRequestVersion += 1
})

function readablePermission(key) {
  if (typeof key !== 'string') return '未知操作'
  const separator = key.lastIndexOf('.')
  if (separator === -1) return key
  const toolKey = key.slice(0, separator)
  const actionKey = key.slice(separator + 1)
  return `${toolNames[toolKey] || toolKey} / ${actionNames[actionKey] || actionKey}`
}

function sourceLabel(source) {
  if (source === 'system:superuser') return 'Superuser 自動授權'
  if (source === 'individual:allow') return '個人額外允許'
  if (source.startsWith('department:')) return `部門：${source.slice(11)}`
  if (source.startsWith('role:')) return `業務角色：${source.slice(5)}`
  return source
}

function blockerLabel(reason) {
  if (reason === 'no_grant') return '未取得部門、角色或個人授權'
  if (reason === 'individual:deny') return '個人禁止'
  if (reason === 'inactive_user') return '帳號未啟用'
  if (reason === 'inactive_tool') return '工具已停用'
  if (reason === 'inactive_permission') return '操作已停用'
  if (reason === 'dependency_cycle') return '前置權限設定存在循環'
  if (reason.startsWith('requires:')) {
    const requirement = reason.slice('requires:'.length)
    return `缺少前置權限：${readablePermission(requirement)}`
  }
  return reason
}

const filteredGroups = computed(() => {
  if (!detailsReady.value) return []

  const keyword = search.value.trim().toLocaleLowerCase()
  const grouped = new Map()

  for (const permission of displayedPermissions.value) {
    if (statusFilter.value === 'allowed' && !permission.is_allowed) continue
    if (statusFilter.value === 'denied' && permission.is_allowed) continue

    const label = toolNames[permission.tool_key] || permission.tool_key
    const action = actionNames[permission.action_key] || permission.action_key
    const searchText = [label, permission.tool_key, action, permission.permission_key]
      .join(' ').toLocaleLowerCase()

    if (keyword && !searchText.includes(keyword)) continue

    if (!grouped.has(permission.tool_key)) {
      grouped.set(permission.tool_key, {
        key: permission.tool_key,
        label,
        permissions: []
      })
    }
    grouped.get(permission.tool_key).permissions.push(permission)
  }

  return [...grouped.values()]
})
</script>

<template>
  <section class="space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="space-y-2">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          SYSTEM ADMINISTRATION
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">
          有效權限總覽
        </h1>
        <p class="max-w-2xl text-sm leading-6 text-slate-500">
          選擇 PTS 人員、維護多部門歸屬，並檢視實際權限與繼承來源。有效權限明細仍為唯讀。
        </p>
      </div>
      <button
        v-if="verifiedAdmin"
        type="button"
        class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
        :disabled="permissionLoading || usersLoading || detailsLoading || departmentsLoading || departmentSaving || refreshing"
        @click="handleRefresh"
      >
        {{ permissionLoading || refreshing ? '驗證中…' : '重新整理權限' }}
      </button>
    </header>

    <div v-if="!verifiedAdmin" class="rounded-xl border border-slate-200 bg-white p-6">
      <p class="font-semibold text-slate-900">
        {{ permissionLoading ? '正在驗證管理員身分…' : '無法顯示管理員權限資料' }}
      </p>
      <p class="mt-2 text-sm leading-6 text-slate-500">
        {{ permissionError || (permissionLoading ? '請稍候，正在同步最新權限。' : '此頁僅供已驗證的 PTS 系統管理員使用。') }}
      </p>
    </div>

    <template v-else>
      <div class="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <label class="block w-full max-w-lg space-y-2">
            <span class="block text-xs font-medium text-slate-500">查看人員</span>
            <select
              :value="selectedUserId"
              :disabled="usersLoading || users.length === 0 || departmentSaving"
              @change="handleUserChange"
              class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-400 disabled:opacity-60"
            >
              <option v-if="usersLoading && !users.length" :value="currentUser?.id || ''">讀取人員清單中…</option>
              <option v-else-if="users.length === 0" :value="currentUser?.id || ''">目前登入帳號</option>
              <option v-for="user in users" :key="user.user_id" :value="user.user_id">
                {{ userOptionLabel(user) }}
              </option>
            </select>
          </label>
          <span class="text-xs text-slate-500">{{ viewingSelf ? '檢視：本人' : '檢視：其他帳號' }} · 權限明細唯讀</span>
        </div>
        <p v-if="usersError" role="alert" class="mt-3 text-sm text-rose-700">{{ usersError }}</p>
        <p v-if="selectedUser && !selectedUser.is_active" class="mt-3 text-sm text-amber-700">
          此帳號尚未啟用 PTS 新權限，因此目前權限可能全部為禁止；不代表 Supabase Auth 已停用。
        </p>
        <p v-else-if="selectedUser?.is_system_admin" class="mt-3 text-xs text-slate-500">
          {{ selectedIsSuperuser ? '此帳號具有 Superuser 權限，所有已啟用的業務功能自動開放，不需要設定部門歸屬。' : '此人是系統管理員，但系統管理權限不會自動繼承業務工具權限。' }}
        </p>
      </div>

      <!-- Phase 03-C：部門歸屬可編輯；有效權限明細維持唯讀。 -->
      <section v-if="selectedUser && !usersLoading && detailsReady && !selectedIsSuperuser" class="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-slate-900">人員部門歸屬</h2>
            <p class="mt-1 text-sm leading-6 text-slate-500">
              一位人員可屬於多個部門，最終權限會合併所有已啟用部門的授權。
            </p>
          </div>
          <span v-if="departmentsReady" class="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            已選 {{ selectedDepartmentCount }} 個部門
          </span>
        </div>

        <p v-if="departmentsLoading" role="status" class="mt-5 text-sm text-slate-500">正在讀取部門歸屬…</p>
        <div v-else-if="departmentsError" class="mt-5 flex flex-wrap items-center gap-3" role="alert">
          <p class="text-sm text-rose-700">{{ departmentsError }}</p>
          <button type="button" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  @click="loadUserDepartments(selectedUserId)">重試</button>
        </div>
        <template v-else-if="departmentsReady">
          <p v-if="!selectedUser.is_active" class="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            此帳號尚未啟用，暫不可新增部門指派。請先透過日後的人員管理流程啟用帳號。
          </p>
          <div v-if="departments.length" class="mt-4 grid gap-3 lg:grid-cols-2">
            <label
              v-for="department in departments"
              :key="department.department_id"
              class="flex gap-3 rounded-xl border px-4 py-3 transition"
              :class="[
                checkedDepartmentIds.includes(department.department_id) ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white',
                canToggleDepartment(department) ? 'cursor-pointer hover:border-slate-400' : 'cursor-not-allowed opacity-65'
              ]"
            >
              <input
                type="checkbox"
                class="mt-1 h-4 w-4 shrink-0 accent-slate-900"
                :checked="checkedDepartmentIds.includes(department.department_id)"
                :disabled="!canToggleDepartment(department)"
                @change="toggleDepartment(department.department_id, $event.target.checked)"
              />
              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-semibold text-slate-800">{{ department.department_name }}</span>
                  <span v-if="!department.is_active" class="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">已停用</span>
                </span>
                <span class="mt-0.5 block font-mono text-xs text-slate-400">{{ department.department_code }}</span>
                <span v-if="department.department_description" class="mt-1 block text-xs leading-5 text-slate-500">
                  {{ department.department_description }}
                </span>
                <span class="mt-1 block text-xs text-slate-400">部門授權 {{ department.permission_count }} 項</span>
              </span>
            </label>
          </div>
          <p v-else class="mt-4 text-sm text-slate-500">尚未建立任何部門，請先到「部門管理」新增。</p>

          <p class="mt-3 text-xs leading-5 text-slate-500">
            停用部門不會立即刪除既有歸屬；原有指派可保留或取消，但不可新指派停用部門。
            部門重新啟用後，原本保留的歸屬會恢復權限繼承。
          </p>

          <div v-if="departmentChangesPending" class="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p class="text-sm font-semibold text-slate-800">部門歸屬已修改，尚未儲存</p>
            <label class="block space-y-2">
              <span class="block text-xs font-medium text-slate-600">異動原因 <span class="text-rose-600">*</span></span>
              <textarea
                v-model="departmentReason"
                :disabled="departmentSaving"
                rows="2"
                maxlength="500"
                placeholder="例：協助行銷活動期間兼任倉儲作業"
                class="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 disabled:opacity-60"
              ></textarea>
            </label>
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="departmentSaving || !departmentReason.trim() || !selectedUser.is_active"
                      @click="handleSaveDepartments">
                {{ departmentSaving ? '儲存中…' : '儲存部門歸屬' }}
              </button>
              <button type="button" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      :disabled="departmentSaving" @click="discardDepartmentChanges">取消修改</button>
            </div>
          </div>
          <p v-if="departmentSaveError" role="alert" class="mt-3 text-sm text-rose-700">{{ departmentSaveError }}</p>
          <p v-if="departmentSaveSuccess" role="status" class="mt-3 text-sm text-emerald-700">{{ departmentSaveSuccess }}</p>
        </template>
      </section>

      <div v-if="detailsLoading || usersLoading" class="rounded-xl border border-slate-200 bg-white px-6 py-8" role="status">
        <p class="text-sm text-slate-600">正在讀取人員及有效權限…</p>
      </div>
      <div v-else-if="otherPermissionsError && !viewingSelf" role="alert" class="rounded-xl border border-rose-200 bg-white px-6 py-8">
        <p class="text-sm text-rose-700">{{ otherPermissionsError }}</p>
      </div>
      <template v-else-if="detailsReady">
      <div class="grid gap-4 sm:grid-cols-3">
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium tracking-wide text-slate-500">權限項目</p>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
            {{ displayedPermissions.length }}
          </p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium tracking-wide text-slate-500">目前允許</p>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
            {{ permittedCount }}
          </p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium tracking-wide text-slate-500">目前禁止</p>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
            {{ deniedCount }}
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <p>{{ selectedIsSuperuser ? 'Superuser 自動取得所有已啟用業務權限。' : '一般系統管理員與業務工具權限分開計算。' }}</p>
        <p>最後同步：{{ lastUpdatedLabel }}</p>
      </div>

      <div class="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div class="flex flex-wrap items-center gap-3">
          <label class="min-w-[220px] flex-1">
            <span class="sr-only">搜尋權限</span>
            <input
              v-model="search"
              type="search"
              placeholder="搜尋工具名稱、操作或權限代碼"
              class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-400"
            />
          </label>
          <label>
            <span class="sr-only">權限狀態篩選</span>
            <select
              v-model="statusFilter"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              <option value="all">全部狀態</option>
              <option value="allowed">只看允許</option>
              <option value="denied">只看禁止</option>
            </select>
          </label>
        </div>
      </div>

      <div v-if="filteredGroups.length === 0" class="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
        <p class="font-medium text-slate-700">找不到符合條件的權限</p>
        <p class="mt-2 text-sm text-slate-500">試著清除搜尋文字，或將狀態切換為「全部狀態」。</p>
      </div>

      <div v-else class="space-y-4">
        <section
          v-for="group in filteredGroups"
          :key="group.key"
          class="overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          <header class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">{{ group.label }}</h2>
              <p class="mt-1 text-xs text-slate-400">{{ group.key }}</p>
            </div>
            <span class="text-xs text-slate-500">{{ group.permissions.length }} 項操作</span>
          </header>
          <div class="divide-y divide-slate-100">
            <div
              v-for="item in group.permissions"
              :key="item.permission_key"
              class="grid gap-3 px-5 py-4 md:grid-cols-[minmax(140px,1fr)_minmax(0,2fr)] md:gap-6"
            >
              <div class="flex flex-wrap items-start gap-2">
                <span class="min-w-[3rem] text-sm font-medium text-slate-800">
                  {{ actionNames[item.action_key] || item.action_key }}
                </span>
                <span
                  class="rounded-md px-2 py-0.5 text-xs font-semibold"
                  :class="item.is_allowed ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'"
                >
                  {{ item.is_allowed ? '允許' : '禁止' }}
                </span>
              </div>
              <div class="space-y-2">
                <p class="break-all font-mono text-xs text-slate-400">{{ item.permission_key }}</p>
                <div v-if="item.grant_sources?.length" class="flex flex-wrap gap-2">
                  <span
                    v-for="source in item.grant_sources"
                    :key="source"
                    class="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                  >
                    {{ sourceLabel(source) }}
                  </span>
                </div>
                <div v-if="item.blocked_by?.length" class="flex flex-wrap gap-2">
                  <span
                    v-for="reason in item.blocked_by"
                    :key="reason"
                    class="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600"
                  >
                    {{ blockerLabel(reason) }}
                  </span>
                </div>
                <p v-if="!item.grant_sources?.length && !item.blocked_by?.length" class="text-xs text-slate-400">
                  無額外授權說明
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <p class="text-xs leading-5 text-slate-400">
        有效權限明細僅供檢視；部門歸屬修改由管理員專用 RPC 驗證並記錄異動。資料保護仍須由後端與 Supabase RLS 執行。
      </p>
      </template>
    </template>
  </section>
</template>
