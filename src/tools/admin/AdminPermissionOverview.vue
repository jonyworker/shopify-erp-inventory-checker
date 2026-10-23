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
 * Phase 03-I3：管理員查看有效權限，並維護人員多組織與多部門歸屬。
 * - 自己的權限：沿用既有 permissionState，避免污染登入者的權限快照。
 * - 其他人的權限：只能由管理員呼叫後端受保護的 RPC 查詢。
 * - 選擇帳號、登出或管理員資格重新驗證時，舊請求不可以覆蓋新畫面。
 * - 可修改所屬組織與部門；組織歸屬不改變工具權限，有效權限仍為唯讀。
 * - 前端管理員判斷僅用於 UX，真正授權由 RPC 後端檢查。
 */

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

// 個人權限覆寫：以獨立 RPC 讀寫，不讓前端直接操作權限資料表。
const overrideRows = ref([])
const overrideLoadedUser = ref(null)
const overrideLoading = ref(false)
const overrideError = ref('')
const overrideSavingKey = ref('')
const overrideFeedback = ref('')
const showOverridePreview = ref(false)
const impactAcknowledged = ref(false)
// 以唯讀管理員 RPC 取得所有前置權限關係，支援尚未儲存的雙向模擬。
const dependencyRows = ref([])
const dependencyLoading = ref(false)
const dependencyError = ref('')
const dependencyReady = computed(() => !dependencyLoading.value && !dependencyError.value && dependencyRows.value.length > 0)
async function loadDependencies() {
  dependencyLoading.value = true
  dependencyError.value = ''
  dependencyRows.value = []
  try {
    const { data, error } = await supabase.rpc('pts_admin_permission_dependencies')
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('前置權限資料格式異常')
    dependencyRows.value = data
  } catch (error) {
    dependencyError.value = '無法取得完整權限依賴規則，請確認已部署 V5 Migration。'
    if (import.meta.env.DEV) console.warn('[PTS 管理員] 讀取權限依賴失敗：', error?.message || error)
  } finally {
    dependencyLoading.value = false
  }
}

const overrideEditing = ref({})
let overrideRequestVersion = 0
const overrideReady = computed(() => verifiedAdmin.value &&
  selectedUserId.value === overrideLoadedUser.value && !overrideLoading.value && !overrideError.value)
const overrideDirty = computed(() => overrideReady.value && overrideRows.value.some(overrideChanged))
const overrideGroups = computed(() => {
  const groups = new Map()
  for (const item of overrideRows.value) {
    if (!groups.has(item.tool_key)) {
      groups.set(item.tool_key, {
        key: item.tool_key,
        label: toolNames[item.tool_key] || item.tool_label || item.tool_key,
        items: []
      })
    }
    groups.get(item.tool_key).items.push(item)
  }
  // 檢視是其他操作常見的前置權限，固定排在每組最上方。
  // 其他操作維持原始順序，避免影響不同工具既有排列習慣。
  for (const group of groups.values()) {
    group.items.sort((a, b) => Number(b.action_key === 'view') - Number(a.action_key === 'view'))
  }
  return [...groups.values()]
})
const overrideChangedCount = computed(() => overrideRows.value.filter(overrideChanged).length)
function setOverrideEffect(item, effect) {
  if (!canEditOverrides.value || !item.is_available) return
  overrideEditing.value[item.permission_key].effect = effect
  overrideFeedback.value = ''
  showOverridePreview.value = false
  impactAcknowledged.value = false
}
// 繼承結果取自現有有效權限 RPC 的部門／角色來源，不能直接用最終 is_allowed，
// 因為個人覆寫已經可能改變 is_allowed。依賴權限仍以後端最終結果為準。
const inheritedGrantKeys = computed(() => {
  if (!detailsReady.value) return new Set()
  return new Set(displayedPermissions.value.filter(permission =>
    Array.isArray(permission.grant_sources) && permission.grant_sources.some(source =>
      source.startsWith('department:') || source.startsWith('role:')
    )
  ).map(permission => permission.permission_key))
})
const inheritanceReady = computed(() => detailsReady.value && overrideReady.value)
function toggleOverride(item, effect) {
  if (!canEditOverrides.value || !item.is_available) return
  const existing = overrideEditing.value[item.permission_key]?.effect || 'inherit'
  setOverrideEffect(item, existing === effect ? 'inherit' : effect)
}
function clearAllOverrides() {
  if (!canEditOverrides.value) return
  if (!window.confirm('確定清除這位員工的全部個人權限覆寫？請按「儲存個人權限」才會正式生效。')) return
  for (const item of overrideRows.value) {
    if (overrideEditing.value[item.permission_key]) overrideEditing.value[item.permission_key].effect = 'inherit'
  }
  showOverridePreview.value = false
  impactAcknowledged.value = false
  overrideFeedback.value = '已將全部個人覆寫標記為清除，請儲存後才會正式生效。'
}
const hasOverrideChoices = computed(() => overrideRows.value.some(item =>
  (overrideEditing.value[item.permission_key]?.effect || 'inherit') !== 'inherit'
))
const canEditOverrides = computed(() => overrideReady.value && dependencyReady.value && selectedUser.value?.is_active &&
  !selectedIsSuperuser.value && !organizationChangesPending.value && !departmentChangesPending.value &&
  !overrideSavingKey.value)
function resetOverrides() {
  overrideRequestVersion += 1
  overrideRows.value = []
  overrideLoadedUser.value = null
  overrideLoading.value = false
  overrideError.value = ''
  overrideSavingKey.value = ''
  overrideFeedback.value = ''
  showOverridePreview.value = false
  impactAcknowledged.value = false
  overrideEditing.value = {}
}
async function loadOverrides(userId) {
  if (!verifiedAdmin.value || !userId) return
  const version = ++overrideRequestVersion
  overrideLoading.value = true
  overrideError.value = ''
  overrideLoadedUser.value = null
  try {
    const { data, error } = await supabase.rpc('pts_admin_user_overrides', { p_target_user_id: userId })
    if (version !== overrideRequestVersion || !verifiedAdmin.value || selectedUserId.value !== userId) return
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('個人權限資料格式錯誤')
    overrideRows.value = data
    overrideEditing.value = Object.fromEntries(data.map(item => [item.permission_key, {
      effect: item.effect || 'inherit',
      until: item.valid_until || null
    }]))
    overrideLoadedUser.value = userId
  } catch (error) {
    if (version !== overrideRequestVersion || selectedUserId.value !== userId) return
    overrideError.value = error?.message || '無法讀取個人權限覆寫'
  } finally {
    if (version === overrideRequestVersion) overrideLoading.value = false
  }
}
function overrideChanged(item) {
  const draft = overrideEditing.value[item.permission_key]
  return !!draft && draft.effect !== (item.effect || 'inherit')
}
function discardOverrideChanges() {
  if (!overrideReady.value || overrideSavingKey.value) return
  overrideEditing.value = Object.fromEntries(overrideRows.value.map(item => [item.permission_key, {
    effect: item.effect || 'inherit', until: item.valid_until || null
  }]))
  overrideFeedback.value = ''
  overrideError.value = ''
  showOverridePreview.value = false
  impactAcknowledged.value = false
}
async function saveAllOverrides() {
  if (!canEditOverrides.value || !overrideDirty.value || unresolvedGrantConflicts.value.length || (newDownstreamImpacts.value.length && !impactAcknowledged.value)) return
  const userId = selectedUserId.value
  const changes = overrideRows.value.filter(overrideChanged).map(item => ({
    key: item.permission_key,
    effect: overrideEditing.value[item.permission_key].effect
  }))
  showOverridePreview.value = false
  overrideSavingKey.value = '__batch__'
  overrideFeedback.value = ''
  overrideError.value = ''
  let saved = 0
  try {
    // 沿用管理員專用 RPC。逐項寫入，發生錯誤即停止，避免顯示全部成功。
    for (const change of changes) {
      if (selectedUserId.value !== userId || !verifiedAdmin.value) break
      const { error } = await supabase.rpc('pts_admin_save_user_override', {
        p_target_user_id: userId,
        p_permission_key: change.key,
        p_effect: change.effect,
        p_valid_until_date: null
      })
      if (error) throw new Error(`${change.key}：${error.message}`)
      saved++
    }
    if (selectedUserId.value === userId) {
      await Promise.all([loadOverrides(userId), viewingSelf.value ? refreshPermissions() : loadOtherPermissions(userId)])
      overrideFeedback.value = `已儲存 ${saved} 項個人權限設定。`
    }
  } catch (error) {
    if (selectedUserId.value === userId) {
      // 失敗後保留未儲存的編輯，方便重新送出。
      const pending = Object.fromEntries(changes.slice(saved).map(change => [change.key, change.effect]))
      await Promise.all([loadOverrides(userId), viewingSelf.value ? refreshPermissions() : loadOtherPermissions(userId)])
      for (const [key, effect] of Object.entries(pending)) {
        if (overrideEditing.value[key]) overrideEditing.value[key].effect = effect
      }
      overrideError.value = `已完成 ${saved}/${changes.length} 項；其餘尚未儲存。${error?.message || '儲存失敗'}`
    }
  } finally {
    overrideSavingKey.value = ''
  }
}

// Phase 03-I3：組織歸屬維持自己的暫存狀態，與權限快照和部門歸屬互不干擾。
const organizations = ref([])
const organizationsLoading = ref(false)
const organizationsError = ref('')
const organizationsLoadedUserId = ref(null)
const checkedOrganizationIds = ref([])
const savedOrganizationIds = ref([])
const primaryOrganizationId = ref(null)
const savedPrimaryOrganizationId = ref(null)
const organizationSaving = ref(false)
const organizationSaveError = ref('')
const organizationSaveSuccess = ref('')

const organizationsReady = computed(() =>
  verifiedAdmin.value &&
  !!selectedUserId.value &&
  organizationsLoadedUserId.value === selectedUserId.value &&
  !organizationsLoading.value &&
  !organizationsError.value
)

const selectedOrganizationCount = computed(() => checkedOrganizationIds.value.length)
const organizationChangesPending = computed(() =>
  organizationsReady.value && (
    checkedOrganizationIds.value.slice().sort().join('|') !== savedOrganizationIds.value.slice().sort().join('|') ||
    primaryOrganizationId.value !== savedPrimaryOrganizationId.value
  )
)

const canSaveOrganizationChanges = computed(() =>
  organizationsReady.value &&
  organizationChangesPending.value &&
  !organizationSaving.value &&
  !departmentSaving.value &&
  Boolean(selectedUser.value?.is_active === true || checkedOrganizationIds.value.length === 0) &&
  Boolean(primaryOrganizationId.value
    ? checkedOrganizationIds.value.includes(primaryOrganizationId.value)
    : checkedOrganizationIds.value.length === 0)
)

// 部門歸屬僅存放在本頁，不污染登入者 permissionState 中的權限快照。
const departments = ref([])
const departmentsLoading = ref(false)
const departmentsError = ref('')
const departmentsLoadedUserId = ref(null)
const checkedDepartmentIds = ref([])
const savedDepartmentIds = ref([])
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

// 從實際選擇組出稽核摘要。詳細 IDs 與原始／新值仍由後端 old_value / new_value 保存。
function assignmentLabels(ids, options, idKey, labelKey) {
  if (!ids.length) return '未設定'
  const lookup = new Map(options.map(option => [option[idKey], option[labelKey]]))
  return ids.map(id => lookup.get(id) || id).join('、')
}

const organizationAuditDescription = computed(() => {
  const previous = assignmentLabels(savedOrganizationIds.value, organizations.value, 'organization_id', 'organization_name')
  const next = assignmentLabels(checkedOrganizationIds.value, organizations.value, 'organization_id', 'organization_name')
  const oldPrimary = savedPrimaryOrganizationId.value
    ? assignmentLabels([savedPrimaryOrganizationId.value], organizations.value, 'organization_id', 'organization_name')
    : '未設定'
  const newPrimary = primaryOrganizationId.value
    ? assignmentLabels([primaryOrganizationId.value], organizations.value, 'organization_id', 'organization_name')
    : '未設定'
  return `管理介面調整組織歸屬：${previous} → ${next}；主要組織：${oldPrimary} → ${newPrimary}`
})

const departmentAuditDescription = computed(() => {
  const previous = assignmentLabels(savedDepartmentIds.value, departments.value, 'department_id', 'department_name')
  const next = assignmentLabels(checkedDepartmentIds.value, departments.value, 'department_id', 'department_name')
  return `管理介面調整部門歸屬：${previous} → ${next}`
})

// 版本號讓晚回來的 API 回應失效，防止使用者切換帳號時混用資料。
let usersRequestVersion = 0
let detailsRequestVersion = 0
let departmentsRequestVersion = 0
let organizationsRequestVersion = 0

const viewingSelf = computed(() =>
  Boolean(selectedUserId.value && selectedUserId.value === currentUser.value?.id)
)

const selectedUser = computed(() =>
  users.value.find(user => user.user_id === selectedUserId.value) ?? null
)

// @admin 是專用系統管理帳號，無實際員工組織／部門歸屬需求。
// 只針對此具名帳號隱藏歸屬介面，不以 Superuser 身分推斷，
// 避免未來兼任 Superuser 的正式員工無法管理組織歸屬。
const selectedIsDedicatedAdmin = computed(() =>
  selectedUser.value?.is_system_admin === true &&
  selectedUser.value?.username?.trim().toLowerCase() === 'admin'
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


function resetOrganizationDetails() {
  organizationsRequestVersion += 1
  organizations.value = []
  organizationsLoadedUserId.value = null
  organizationsLoading.value = false
  organizationsError.value = ''
  checkedOrganizationIds.value = []
  savedOrganizationIds.value = []
  primaryOrganizationId.value = null
  savedPrimaryOrganizationId.value = null
  organizationSaveError.value = ''
  organizationSaveSuccess.value = ''
}

async function loadUserOrganizations(userId) {
  if (!verifiedAdmin.value || !userId || selectedUserId.value !== userId) return
  if (!users.value.some(user => user.user_id === userId)) return

  const version = ++organizationsRequestVersion
  organizationsLoading.value = true
  organizationsError.value = ''
  organizationsLoadedUserId.value = null
  organizationSaveError.value = ''
  organizationSaveSuccess.value = ''

  try {
    const { data, error } = await supabase.rpc('pts_admin_user_organizations', {
      p_target_user_id: userId
    })
    if (version !== organizationsRequestVersion ||
        !verifiedAdmin.value || selectedUserId.value !== userId) return
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('組織歸屬資料格式不正確')

    organizations.value = data
    const assigned = data.filter(item => item.is_assigned).map(item => item.organization_id)
    const primary = data.find(item => item.is_assigned && item.is_primary)?.organization_id ?? null
    checkedOrganizationIds.value = [...assigned]
    savedOrganizationIds.value = [...assigned]
    primaryOrganizationId.value = primary
    savedPrimaryOrganizationId.value = primary
    organizationsLoadedUserId.value = userId
  } catch (error) {
    if (version !== organizationsRequestVersion ||
        !verifiedAdmin.value || selectedUserId.value !== userId) return
    organizationsError.value = '無法讀取此人員的組織歸屬，請稍後重試。'
    if (import.meta.env.DEV) {
      console.warn('[PTS 管理員] 讀取組織歸屬失敗：', error?.message || error)
    }
  } finally {
    if (version === organizationsRequestVersion) organizationsLoading.value = false
  }
}

function canToggleOrganization(organization) {
  if (!verifiedAdmin.value || !organizationsReady.value || organizationSaving.value || departmentSaving.value) return false
  // 已停用的員工只允許取消現有組織歸屬，不能新指派；清空後才能儲存。
  if (selectedUser.value?.is_active !== true) {
    return Boolean(organization.is_assigned && checkedOrganizationIds.value.includes(organization.organization_id))
  }
  // 停用的組織不可新指派；原本已有歸屬者仍可維持或取消。
  return organization.is_active || organization.is_assigned
}

function toggleOrganization(id, checked) {
  const organization = organizations.value.find(item => item.organization_id === id)
  if (!organization || !canToggleOrganization(organization)) return
  const next = new Set(checkedOrganizationIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  checkedOrganizationIds.value = [...next]
  if (!next.has(primaryOrganizationId.value)) {
    primaryOrganizationId.value = checkedOrganizationIds.value[0] || null
  }
  organizationSaveError.value = ''
  organizationSaveSuccess.value = ''
}

function selectPrimaryOrganization(id) {
  if (!organizationsReady.value || organizationSaving.value || departmentSaving.value ||
      selectedUser.value?.is_active !== true || !checkedOrganizationIds.value.includes(id)) return
  primaryOrganizationId.value = id
  organizationSaveError.value = ''
  organizationSaveSuccess.value = ''
}

function discardOrganizationChanges() {
  checkedOrganizationIds.value = [...savedOrganizationIds.value]
  primaryOrganizationId.value = savedPrimaryOrganizationId.value
  organizationSaveError.value = ''
  organizationSaveSuccess.value = ''
}

function confirmDiscardAssignmentChanges() {
  const pending = []
  if (organizationChangesPending.value) pending.push('組織')
  if (departmentChangesPending.value) pending.push('部門')
  if (overrideDirty.value) pending.push('個人權限')
  return !pending.length || window.confirm(`此人員的${pending.join('、')}歸屬尚未儲存，確定捨棄修改嗎？`)
}

async function handleSaveOrganizations() {
  const userId = selectedUserId.value
  if (!canSaveOrganizationChanges.value) return
  // 後端仍要求 p_reason，但日常維護不必請管理員反覆手動填寫。
  // 稽核會同時保留操作人員、時間及 old_value/new_value 的實際差異。
  const reason = organizationAuditDescription.value.slice(0, 500)
  const newIds = [...checkedOrganizationIds.value]
  const newPrimaryId = primaryOrganizationId.value
  organizationSaving.value = true
  organizationSaveError.value = ''
  organizationSaveSuccess.value = ''

  try {
    const { error } = await supabase.rpc('pts_admin_save_user_organizations', {
      p_target_user_id: userId,
      p_organization_ids: newIds,
      p_primary_organization_id: newPrimaryId,
      p_reason: reason
    })
    if (error) throw error
    if (!verifiedAdmin.value || selectedUserId.value !== userId) return

    // 後端已完成儲存，以伺服器重新讀取的結果為準；組織不影響功能權限。
    await loadUserOrganizations(userId)
    if (!verifiedAdmin.value || selectedUserId.value !== userId) return
    if (!organizationsReady.value) {
      organizationSaveError.value = '異動已送出，但重新讀取結果失敗。請按「重試」核對，避免重複送出。'
      return
    }
    organizationSaveSuccess.value = '員工組織歸屬已儲存，異動紀錄已寫入稽核。'
  } catch (error) {
    if (!verifiedAdmin.value || selectedUserId.value !== userId) return
    organizationSaveError.value = error?.message || '儲存組織歸屬失敗，請稍後再試。'
    if (import.meta.env.DEV) {
      console.warn('[PTS 管理員] 更新組織歸屬失敗：', error?.message || error)
    }
  } finally {
    organizationSaving.value = false
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
  if (!verifiedAdmin.value || !departmentsReady.value || departmentSaving.value || organizationSaving.value ||
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
  departmentSaveError.value = ''
  departmentSaveSuccess.value = ''
}

function handleUserChange(event) {
  const nextUserId = event.target.value
  if (nextUserId === selectedUserId.value) return
  if (departmentSaving.value || organizationSaving.value || overrideSavingKey.value || !confirmDiscardAssignmentChanges()) {
    event.target.value = selectedUserId.value
    return
  }
  selectedUserId.value = nextUserId
}

async function handleSaveDepartments() {
  const userId = selectedUserId.value
  if (!departmentsReady.value || !departmentChangesPending.value ||
      departmentSaving.value || organizationSaving.value || selectedUser.value?.is_active !== true) return

  // 沿用現有 RPC / 稽核機制，前端自動提供異動摘要作為 p_reason。
  const reason = departmentAuditDescription.value.slice(0, 500)
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

    // 與「人員管理」一致：未建檔的歷史帳號不出現在人員選擇器。
    // 僅過濾畫面與查詢對象，不刪除 Auth / app_profiles 或變更任何權限。
    const visibleUsers = data.filter(user =>
      typeof user.username === 'string' && user.username.trim().length > 0 &&
      typeof user.display_name === 'string' && user.display_name.trim().length > 0
    )
    users.value = visibleUsers
    if (!visibleUsers.some(user => user.user_id === selectedUserId.value)) {
      // 人員確實變更時，交由 selectedUserId watcher 讀取新資料，避免重複請求。
      selectedUserId.value = currentUser.value?.id || ''
      return
    }

    // 身分重新驗證或手動重新整理後，保留原選取人員並同步權限、組織與部門。
    if (organizationsLoadedUserId.value !== selectedUserId.value &&
        !organizationsLoading.value) {
      void loadUserOrganizations(selectedUserId.value)
    }
    if (departmentsLoadedUserId.value !== selectedUserId.value &&
        !departmentsLoading.value) {
      void loadUserDepartments(selectedUserId.value)
    }
    if (overrideLoadedUser.value !== selectedUserId.value && !overrideLoading.value) {
      void loadOverrides(selectedUserId.value)
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
  if (!verifiedAdmin.value || refreshing.value || departmentSaving.value || organizationSaving.value) return
  if (!confirmDiscardAssignmentChanges()) return
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
    resetOrganizationDetails()
    resetDepartmentDetails()
    resetOverrides()
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
      resetOrganizationDetails()
      resetDepartmentDetails()
      resetOverrides()
      return
    }
    void loadUsers()
  },
  { immediate: true }
)

watch(selectedUserId, userId => {
  resetOtherDetails()
  resetOrganizationDetails()
  resetDepartmentDetails()
  resetOverrides()
  if (!verifiedAdmin.value) return
  if (userId !== currentUser.value?.id) {
    void loadOtherPermissions(userId)
  }
  if (users.value.some(user => user.user_id === userId)) {
    void loadUserOrganizations(userId)
    void loadUserDepartments(userId)
    void loadOverrides(userId)
  }
})

onUnmounted(() => {
  usersRequestVersion += 1
  detailsRequestVersion += 1
  departmentsRequestVersion += 1
  organizationsRequestVersion += 1
  overrideRequestVersion += 1
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

// 有效權限結果與來源只由後端快照決定，不採用尚未儲存的覆寫草稿。
const permissionByKey = computed(() => new Map(
  displayedPermissions.value.map(item => [item.permission_key, item])
))
function permissionSources(key) {
  const permission = permissionByKey.value.get(key)
  if (!permission || !Array.isArray(permission.grant_sources)) return []
  return [...new Set(permission.grant_sources.filter(source =>
    typeof source === 'string' && (source.startsWith('department:') || source.startsWith('role:'))
  ))]
}
function permissionBlockers(key) {
  const permission = permissionByKey.value.get(key)
  if (!permission || !Array.isArray(permission.blocked_by)) return []
  return permission.blocked_by.filter(reason =>
    typeof reason === 'string' && reason !== 'no_grant' && reason !== 'individual:deny'
  )
}
function effectiveAllowed(key) {
  return permissionByKey.value.get(key)?.is_allowed === true
}
// 編輯期間的預期授權狀態。權限依賴關係取自後端 blocked_by，避免前端另寫一套規則。
function draftGranted(key) {
  const effect = overrideEditing.value[key]?.effect || 'inherit'
  if (effect === 'allow') return true
  if (effect === 'deny') return false
  return inheritedGrantKeys.value.has(key)
}
// 由 permission_catalog 提供「完整」依賴規則，不再仰賴 blocked_by（只含目前失效的依賴）。
const dependencyMap = computed(() => new Map(dependencyRows.value.map(row => [row.permission_key, row.requires_permission_key || null])))
function allRequirementsFor(key) {
  const requirements = []
  const visited = new Set([key])
  let current = dependencyMap.value.get(key)
  while (current) {
    if (visited.has(current)) { requirements.push('__dependency_cycle__'); break }
    visited.add(current)
    requirements.push(current)
    current = dependencyMap.value.get(current)
  }
  return requirements
}
function missingRequirements(key) {
  if (!dependencyReady.value || !draftGranted(key)) return []
  return allRequirementsFor(key).filter(req => req === '__dependency_cycle__' || !draftGranted(req))
}
// 預覽草稿套用後受連帶阻擋的操作；這些不會寫成額外的個人 deny。
const draftImpacts = computed(() => {
  if (!dependencyReady.value) return []
  return overrideRows.value.filter(item => draftGranted(item.permission_key) && missingRequirements(item.permission_key).length)
    .map(item => ({ key: item.permission_key, missing: missingRequirements(item.permission_key) }))
})
// 只有「新增允許」造成的前置缺漏，才提供補齊允許的捷徑。
// 禁止檢視造成的下游失效，是反向影響，不應建議重新允許檢視。
function hasNewGrantIntent(key) {
  const row = overrideRows.value.find(item => item.permission_key === key)
  if (!row) return false
  return overrideEditing.value[key]?.effect === 'allow' && row.effect !== 'allow'
}
function canSuggestGrantRequirements(key) {
  return hasNewGrantIntent(key) && missingRequirements(key).length > 0
}
function isNewDownstreamImpact(key) {
  return newDownstreamImpacts.value.some(item => item.key === key)
}
function proposeDownstreamDeny(key) {
  if (!canEditOverrides.value || !isNewDownstreamImpact(key)) return
  const item = overrideRows.value.find(row => row.permission_key === key)
  if (!item?.is_available) return
  // 僅修改被連帶影響的操作本身，絕不反向修改檢視或其他前置權限。
  setOverrideEffect(item, 'deny')
  overrideFeedback.value = `已將「${readablePermission(key)}」的覆寫禁止加入草稿，尚未儲存。若希望未來恢復檢視時連帶恢復此操作，可取消這筆覆寫禁止。`
}
const newDownstreamImpacts = computed(() => draftImpacts.value.filter(item => {
  // 以已儲存覆寫與目前部門繼承模擬原狀態
  const priorGranted = req => {
    const row = overrideRows.value.find(r => r.permission_key === req)
    if (!row) return false
    return row.effect === 'allow' || (row.effect !== 'deny' && inheritedGrantKeys.value.has(req))
  }
  return priorGranted(item.key) && allRequirementsFor(item.key).every(req => req !== '__dependency_cycle__' && priorGranted(req))
}))
// V7：取消已儲存的下游「禁止」時，如果前置權限仍被個人明確禁止，
// 才於該前置權限的「覆寫禁止」欄位建議恢復繼承。
// 僅在繼承本身允許該前置權限時顯示，避免建議無法真正解鎖操作的變更。
const restoredDownstreamByRequirement = computed(() => {
  const results = new Map()
  if (!dependencyReady.value) return results
  for (const item of overrideRows.value) {
    const key = item.permission_key
    const draft = overrideEditing.value[key]?.effect || 'inherit'
    if (item.effect !== 'deny' || draft === 'deny' || !draftGranted(key)) continue
    for (const requirement of allRequirementsFor(key)) {
      if (requirement === '__dependency_cycle__' || draftGranted(requirement)) continue
      const parent = overrideRows.value.find(row => row.permission_key === requirement)
      if (!parent || !parent.is_available || !inheritedGrantKeys.value.has(requirement)) continue
      if ((overrideEditing.value[requirement]?.effect || 'inherit') !== 'deny') continue
      if (parent.effect !== 'deny') continue
      if (!results.has(requirement)) results.set(requirement, [])
      results.get(requirement).push(key)
    }
  }
  return results
})
function canSuggestRestoreInheritance(key) {
  return canEditOverrides.value && (restoredDownstreamByRequirement.value.get(key)?.length || 0) > 0
}
function proposeRestoreInheritance(key) {
  if (!canSuggestRestoreInheritance(key)) return
  const impacted = restoredDownstreamByRequirement.value.get(key) || []
  if (!window.confirm(`你已取消以下操作原本的個人禁止：\n${impacted.map(readablePermission).join('\n')}\n\n但它們的前置權限「${readablePermission(key)}」仍被個人禁止。\n\n是否將此項前置權限恢復「繼承」？（只修改草稿，儲存前仍可檢查差異）`)) return
  const item = overrideRows.value.find(row => row.permission_key === key)
  if (!item) return
  setOverrideEffect(item, 'inherit')
  overrideFeedback.value = `已把「${readablePermission(key)}」設為恢復繼承的草稿；請預覽差異再儲存。`
}
const pendingOverrideChanges = computed(() => overrideRows.value.filter(overrideChanged).map(item => ({
  key: item.permission_key,
  label: `${toolNames[item.tool_key] || item.tool_label || item.tool_key}／${actionNames[item.action_key] || item.action_label || item.action_key}`,
  before: item.effect || 'inherit',
  after: overrideEditing.value[item.permission_key]?.effect || 'inherit'
})))
const draftConflicts = computed(() => draftImpacts.value)
const unresolvedGrantConflicts = computed(() => draftImpacts.value.filter(item =>
  !newDownstreamImpacts.value.some(impact => impact.key === item.key)
))
function proposeRequirements(key) {
  if (!canEditOverrides.value) return
  const missing = missingRequirements(key)
  const unavailable = missing.filter(req => !overrideRows.value.find(item => item.permission_key === req && item.is_available))
  if (unavailable.length) {
    overrideError.value = `無法自動補齊：${unavailable.map(readablePermission).join('、')}。請確認功能是否啟用。`
    return
  }
  if (!missing.length) return
  if (!window.confirm(`此操作需要以下前置權限：\n${missing.map(readablePermission).join('\n')}\n\n是否一併加入「個人覆寫允許」待儲存項目？`)) return
  for (const req of missing) overrideEditing.value[req].effect = 'allow'
  overrideFeedback.value = '已加入前置權限草稿，請在差異預覽確認後再儲存。'
  showOverridePreview.value = false
}
function openOverridePreview() {
  if (!canEditOverrides.value || !overrideDirty.value) return
  impactAcknowledged.value = false
  showOverridePreview.value = true
}
watch(verifiedAdmin, ready => {
  if (ready) loadDependencies()
  else { dependencyRows.value = []; dependencyError.value = '' }
}, { immediate: true })
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
          選擇 PTS 人員、維護組織與多部門歸屬，並檢視實際權限與繼承來源。有效權限明細仍為唯讀。
        </p>
      </div>
      <button
        v-if="verifiedAdmin"
        type="button"
        class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
        :disabled="permissionLoading || usersLoading || detailsLoading || departmentsLoading || departmentSaving || organizationsLoading || organizationSaving || refreshing"
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
              :disabled="usersLoading || users.length === 0 || departmentSaving || organizationSaving"
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
        <p v-else-if="selectedIsDedicatedAdmin" class="mt-3 text-xs text-slate-500">
          此帳號為專用系統管理帳號，不需設定組織與部門歸屬；下方仍可檢視有效權限。
        </p>
        <p v-else-if="selectedUser?.is_system_admin" class="mt-3 text-xs text-slate-500">
          {{ selectedIsSuperuser ? '此帳號具有 Superuser 權限，所有已啟用的業務功能自動開放，不需要設定部門歸屬。' : '此人是系統管理員，但系統管理權限不會自動繼承業務工具權限。' }}
        </p>
      </div>

      <!-- Phase 03-I3D：只有專用 @admin 不顯示組織；兼任管理員的員工仍可設定。 -->
      <section v-if="selectedUser && !usersLoading && !selectedIsDedicatedAdmin" class="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-slate-900">人員組織歸屬</h2>
            <p class="mt-1 text-sm leading-6 text-slate-500">
              一位人員可同時屬於台灣及香港；如有歸屬，須指定一個主要組織。
            </p>
          </div>
          <span v-if="organizationsReady" class="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            已選 {{ selectedOrganizationCount }} 個組織
          </span>
        </div>

        <p v-if="organizationsLoading" role="status" class="mt-5 text-sm text-slate-500">正在讀取組織歸屬…</p>
        <div v-else-if="organizationsError" class="mt-5 flex flex-wrap items-center gap-3" role="alert">
          <p class="text-sm text-rose-700">{{ organizationsError }}</p>
          <button type="button" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  @click="loadUserOrganizations(selectedUserId)">重試</button>
        </div>
        <template v-else-if="organizationsReady">
          <p v-if="!selectedUser.is_active" class="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            此帳號未啟用，不可新增組織指派；如有歷史歸屬，只能全部清空後儲存。
          </p>
          <div v-if="organizations.length" class="mt-4 grid gap-3 sm:grid-cols-2">
            <div v-for="organization in organizations" :key="organization.organization_id"
                 class="rounded-xl border px-4 py-3 transition"
                 :class="checkedOrganizationIds.includes(organization.organization_id) ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white'">
              <label class="flex items-start gap-3"
                     :class="canToggleOrganization(organization) ? 'cursor-pointer' : 'cursor-not-allowed'">
                <input type="checkbox" class="mt-1 h-4 w-4 shrink-0 accent-slate-900"
                       :checked="checkedOrganizationIds.includes(organization.organization_id)"
                       :disabled="!canToggleOrganization(organization)"
                       @change="toggleOrganization(organization.organization_id, $event.target.checked)" />
                <span class="min-w-0 flex-1">
                  <span class="flex items-center flex-wrap gap-2">
                    <span class="text-sm font-semibold text-slate-800">{{ organization.organization_name }}</span>
                    <span v-if="!organization.is_active" class="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">已停用</span>
                  </span>
                  <span class="mt-0.5 block font-mono text-xs text-slate-400">{{ organization.organization_code }}</span>
                  <span v-if="organization.organization_description" class="mt-1 block text-xs leading-5 text-slate-500">{{ organization.organization_description }}</span>
                </span>
              </label>
              <label v-if="checkedOrganizationIds.includes(organization.organization_id)" class="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3 text-xs text-slate-600"
                     :class="selectedUser.is_active && !organizationSaving && !departmentSaving ? 'cursor-pointer' : 'cursor-not-allowed'">
                <input type="radio" name="pts-primary-organization" class="h-4 w-4 accent-slate-900"
                       :checked="primaryOrganizationId === organization.organization_id"
                       :disabled="!selectedUser.is_active || organizationSaving || departmentSaving"
                       @change="selectPrimaryOrganization(organization.organization_id)" />
                設為主要組織
              </label>
            </div>
          </div>
          <p v-else class="mt-4 text-sm text-slate-500">尚未建立任何組織，請先確認 Phase 03-I1 是否已部署。</p>
          <p class="mt-3 text-xs leading-5 text-slate-500">
            組織歸屬僅供員工資料與日後會議與會人員選擇器使用，不會增加功能權限；
            原有部門授權與個人權限覆寫保持不變。停用組織不可新增指派。
          </p>

          <div v-if="organizationChangesPending" class="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p class="text-sm font-semibold text-slate-800">組織歸屬已修改，尚未儲存</p>
            <p v-if="!selectedUser.is_active && checkedOrganizationIds.length > 0" class="text-xs text-amber-800">
              未啟用帳號不能儲存非空白的組織歸屬。如需清理，請將所有組織取消勾選。
            </p>
            <p class="text-xs leading-5 text-slate-500">
              系統將自動記錄異動前後的組織及主要組織、操作者與時間，不需手動填寫原因。
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                      :disabled="!canSaveOrganizationChanges"
                      @click="handleSaveOrganizations">
                {{ organizationSaving ? '儲存中…' : '儲存組織歸屬' }}
              </button>
              <button type="button" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      :disabled="organizationSaving" @click="discardOrganizationChanges">取消修改</button>
            </div>
          </div>
          <p v-if="organizationSaveError" role="alert" class="mt-3 text-sm text-rose-700">{{ organizationSaveError }}</p>
          <p v-if="organizationSaveSuccess" role="status" class="mt-3 text-sm text-emerald-700">{{ organizationSaveSuccess }}</p>
        </template>
      </section>

      <!-- Phase 03-C：部門歸屬可編輯；有效權限明細維持唯讀。 -->
      <section v-if="selectedUser && !usersLoading && detailsReady && !selectedIsSuperuser && !selectedIsDedicatedAdmin" class="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
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
            <p class="text-xs leading-5 text-slate-500">
              系統將自動記錄異動前後的部門、操作者與時間，不需手動填寫原因。
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="departmentSaving || organizationSaving || !selectedUser.is_active"
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

      <section v-if="selectedUser && !selectedIsDedicatedAdmin" class="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-slate-900">個人權限覆寫</h2>
            <p class="mt-1 text-sm text-slate-500">繼承權限與授權來源皆為唯讀；勾選「覆寫允許／覆寫禁止」來設定個人例外，取消勾選即可恢復繼承。</p>
          </div>
          <button type="button" class="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40" :disabled="!canEditOverrides || !hasOverrideChoices" @click="clearAllOverrides">清除全部覆寫</button>
        </div>
        <p v-if="dependencyLoading" class="text-sm text-slate-500">正在讀取前置權限規則…</p>
        <div v-if="dependencyError" role="alert" class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ dependencyError }} <button type="button" class="ml-2 underline" @click="loadDependencies">重試</button></div>
        <p v-if="overrideLoading" class="text-sm text-slate-500">正在讀取個人權限…</p>
        <div v-if="overrideError" role="alert" class="text-sm text-rose-700">{{ overrideError }} <button type="button" class="ml-2 underline" :disabled="!!overrideSavingKey" @click="loadOverrides(selectedUserId)">重新讀取</button></div>
        <p v-if="overrideFeedback" role="status" class="text-sm text-emerald-700">{{ overrideFeedback }}</p>
        <p v-if="selectedIsSuperuser" class="text-sm text-amber-700">Superuser 的權限由系統授予，無法以個人覆寫調整。</p>
        <p v-if="organizationChangesPending || departmentChangesPending" class="text-sm text-amber-700">請先儲存組織／部門變更，再調整個人權限。</p>
        <p v-if="overrideReady && !inheritanceReady" class="text-sm text-slate-500">正在讀取部門與角色繼承結果…</p>
        <div v-if="overrideReady && !detailsReady" class="text-sm text-slate-500">有效權限尚未載入，暫不顯示繼承結果及來源。</div>
        <div v-if="overrideReady && detailsReady" class="w-full overflow-x-auto rounded-lg border border-slate-200">
          <table class="w-full min-w-[690px] table-fixed border-collapse text-sm">
            <colgroup>
              <col style="width: 44%" />
              <col style="width: 14%" />
              <col style="width: 14%" />
              <col style="width: 14%" />
              <col style="width: 14%" />
            </colgroup>
            <thead class="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" class="px-4 py-3 text-left font-semibold">功能／操作</th>
                <th scope="col" class="px-2 py-3 text-center font-semibold">繼承允許</th>
                <th scope="col" class="px-2 py-3 text-center font-semibold">繼承禁止</th>
                <th scope="col" class="px-2 py-3 text-center font-semibold">覆寫允許</th>
                <th scope="col" class="px-2 py-3 text-center font-semibold">覆寫禁止</th>
              </tr>
            </thead>
            <tbody v-for="group in overrideGroups" :key="group.key" class="border-t border-slate-200">
              <tr class="bg-slate-50/80">
                <th colspan="5" scope="rowgroup" class="px-4 py-2.5 text-left font-semibold text-slate-800">
                  {{ group.label }} <span class="ml-2 font-mono text-xs font-normal text-slate-400">{{ group.key }}</span>
                </th>
              </tr>
              <tr v-for="item in group.items" :key="item.permission_key" class="border-t border-slate-100 hover:bg-slate-50/50" :class="{ 'bg-amber-50/60': overrideChanged(item) }">
                <td class="px-4 py-3 align-middle">
                  <span class="font-medium text-slate-800">{{ actionNames[item.action_key] || item.action_label || item.action_key }}</span>
                  <span v-if="overrideChanged(item)" class="ml-2 text-xs text-amber-700">已修改</span>
                  <p class="mt-0.5 break-all font-mono text-xs text-slate-400">{{ item.permission_key }}</p>
                  <div class="mt-1.5 flex flex-wrap items-center gap-1.5" v-if="permissionSources(item.permission_key).length">
                    <span v-for="source in permissionSources(item.permission_key)" :key="source"
                          class="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                      {{ sourceLabel(source) }}
                    </span>
                  </div>
                  <p v-else-if="!inheritedGrantKeys.has(item.permission_key)" class="mt-1 text-xs text-slate-400">未取得部門或角色授權</p>
                  <div v-if="missingRequirements(item.permission_key).length" class="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span class="inline-flex rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                      草稿預計無法使用，缺少前置權限：{{ missingRequirements(item.permission_key).map(readablePermission).join('、') }}
                    </span>
                  </div>
                  <p v-else-if="draftGranted(item.permission_key) && permissionBlockers(item.permission_key).some(reason => reason !== 'no_grant' && reason !== 'individual:deny' && !reason.startsWith('requires:'))"
                     class="mt-1 text-xs text-amber-700">此項授權仍可能受到帳號、功能狀態或其他後端限制。</p>
                  <p v-if="!overrideChanged(item) && (item.effect || 'inherit') !== 'inherit'"
                     class="mt-1 text-xs" :class="effectiveAllowed(item.permission_key) ? 'text-emerald-700' : 'text-slate-500'">
                    目前有效：{{ effectiveAllowed(item.permission_key) ? '允許' : '禁止' }}
                  </p>
                  <p v-if="!item.is_available" class="mt-1 text-xs text-amber-700">功能已停用</p>
                  <p v-else-if="item.valid_until" class="mt-1 text-xs text-slate-500">原設定有有效期限，更新覆寫後不再設定期限</p>
                </td>
                <td class="px-2 py-3 text-center align-middle">
                  <svg v-if="inheritanceReady && inheritedGrantKeys.has(item.permission_key)" class="mx-auto h-5 w-5 text-slate-800" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-label="繼承允許" role="img"><path stroke-linecap="round" stroke-linejoin="round" d="m5 12 4 4L19 6" /></svg>
                </td>
                <td class="px-2 py-3 text-center align-middle">
                  <svg v-if="inheritanceReady && !inheritedGrantKeys.has(item.permission_key)" class="mx-auto h-5 w-5 text-slate-600" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-label="繼承禁止" role="img"><path stroke-linecap="round" stroke-linejoin="round" d="m5 12 4 4L19 6" /></svg>
                </td>
                <td v-for="mode in ['allow','deny']" :key="mode" class="px-2 py-3 text-center align-middle">
                  <div class="flex flex-col items-center justify-center gap-1.5">
                    <input type="checkbox" class="h-4 w-4 cursor-pointer rounded border-slate-300 accent-slate-800 disabled:cursor-not-allowed disabled:opacity-40" :checked="overrideEditing[item.permission_key]?.effect === mode" :aria-label="`${item.permission_key}：覆寫${mode === 'allow' ? '允許' : '禁止'}`" :disabled="!canEditOverrides || !item.is_available" @change="toggleOverride(item, mode)" />
                    <button v-if="mode === 'allow' && canSuggestGrantRequirements(item.permission_key)"
                            type="button" class="rounded-md border border-amber-200 bg-white px-1.5 py-0.5 text-[11px] text-amber-800 hover:bg-amber-50 disabled:opacity-40"
                            :disabled="!canEditOverrides" @click="proposeRequirements(item.permission_key)">建議補齊</button>
                    <button v-if="mode === 'deny' && canSuggestRestoreInheritance(item.permission_key)"
                            type="button" class="rounded-md border border-sky-200 bg-white px-1.5 py-0.5 text-[11px] text-sky-800 hover:bg-sky-50 disabled:opacity-40"
                            :disabled="!canEditOverrides || !item.is_available" @click="proposeRestoreInheritance(item.permission_key)">建議恢復繼承</button>
                    <button v-if="mode === 'deny' && isNewDownstreamImpact(item.permission_key)"
                            type="button" class="rounded-md border border-amber-200 bg-white px-1.5 py-0.5 text-[11px] text-amber-800 hover:bg-amber-50 disabled:opacity-40"
                            :disabled="!canEditOverrides || !item.is_available" @click="proposeDownstreamDeny(item.permission_key)">建議禁止</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="newDownstreamImpacts.length" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p class="font-semibold">本次修改將連帶停用 {{ newDownstreamImpacts.length }} 項操作（不會自動勾選覆寫禁止）</p>
          <p v-for="impact in newDownstreamImpacts" :key="impact.key" class="mt-1">{{ readablePermission(impact.key) }}：依賴 {{ impact.missing.map(readablePermission).join('、') }}</p>
          <p class="mt-1 text-xs">這些操作已因前置權限遭禁止而無法使用，不需要額外覆寫禁止。若想明確保留個人禁止，才使用該列 Checkbox 下方的「建議禁止」。</p>
        </div>
        <p class="text-xs leading-relaxed text-slate-500">來源標籤顯示所有提供此操作授權的部門及角色；未取得授權時預設禁止。個人覆寫與前置權限限制仍以後端有效權限結果為準。</p>
        <div v-if="overrideReady" class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <span class="mr-auto text-xs text-slate-500">{{ overrideDirty ? `${overrideChangedCount} 項尚未儲存` : '目前沒有未儲存的變更' }}</span>
          <button type="button" class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-40" :disabled="!overrideDirty || !!overrideSavingKey" @click="discardOverrideChanges">還原修改</button>
          <button type="button" class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40" :disabled="!canEditOverrides || !overrideDirty" @click="openOverridePreview">預覽並儲存</button>
        </div>
        <div v-if="showOverridePreview" role="dialog" aria-label="個人權限儲存前預覽" class="rounded-lg border border-slate-300 bg-slate-50 p-4 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <h3 class="font-semibold text-slate-900">確認權限變更（{{ pendingOverrideChanges.length }} 項）</h3>
            <button type="button" class="text-sm text-slate-500 underline" @click="showOverridePreview = false">返回編輯</button>
          </div>
          <div v-for="change in pendingOverrideChanges" :key="change.key" class="flex flex-wrap justify-between gap-2 border-b border-slate-200 pb-2 text-sm">
            <span>{{ change.label }}</span>
            <span class="text-slate-600">{{ change.before === 'inherit' ? '繼承' : change.before === 'allow' ? '個人允許' : '個人禁止' }} → <strong>{{ change.after === 'inherit' ? '恢復繼承' : change.after === 'allow' ? '個人允許' : '個人禁止' }}</strong></span>
          </div>
          <div v-if="unresolvedGrantConflicts.length" class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p class="font-medium">仍有 {{ unresolvedGrantConflicts.length }} 項缺少前置權限，請先處理：</p>
            <p v-for="conflict in unresolvedGrantConflicts" :key="conflict.key" class="mt-1">{{ readablePermission(conflict.key) }}：缺少 {{ conflict.missing.map(readablePermission).join('、') }}</p>
            <p class="mt-2">如屬本次禁止前置權限造成的影響，可以在下方確認連帶停用，無需另外建立覆寫禁止。其他授權缺漏請返回編輯處理。</p>
          </div>
          <label v-if="newDownstreamImpacts.length" class="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <input v-model="impactAcknowledged" type="checkbox" class="mt-0.5" />
            <span>我了解此次設定將導致 {{ newDownstreamImpacts.length }} 項原本可用的操作連帶失效；不額外建立覆寫禁止。</span>
          </label>
          <p class="text-xs text-slate-500">系統僅在你確認後才寫入；儲存採逐項 RPC，若中途失敗會提示已完成項目。</p>
          <div class="flex justify-end gap-2">
            <button type="button" class="rounded-lg border border-slate-200 px-3 py-2 text-sm" @click="showOverridePreview = false">取消</button>
            <button type="button" class="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40" :disabled="!!overrideSavingKey || unresolvedGrantConflicts.length > 0 || (newDownstreamImpacts.length > 0 && !impactAcknowledged)" @click="saveAllOverrides">{{ overrideSavingKey ? '儲存中…' : '確認儲存' }}</button>
          </div>
        </div>
      </section>
      <div v-if="otherPermissionsError && !viewingSelf" role="alert" class="rounded-xl border border-rose-200 bg-white px-6 py-5">
        <p class="text-sm text-rose-700">有效權限載入失敗：{{ otherPermissionsError }}</p>
      </div>
      <div v-else-if="detailsLoading || usersLoading" class="rounded-xl border border-slate-200 bg-white px-6 py-5" role="status">
        <p class="text-sm text-slate-600">正在同步權限來源…</p>
      </div>
    </template>
  </section>
</template>
