<script setup>
import { computed, ref, watch } from 'vue'
import { supabase } from '@/lib/supabaseClient'
import { currentUser } from '@/stores/authState'
import {
  permissionReady,
  permissionLoading as authPermissionLoading,
  permissionUserId,
  isSystemAdmin
} from '@/stores/permissionState'

/**
 * Phase 03-B：部門基本資料與功能授權維護。
 * 僅透過管理員專用 Supabase RPC 讀寫，不直接操作 public.departments 或 department_permissions。
 * 前端驗證與顯示僅供 UX 使用；真正授權由 RPC 的後端檢查。
 */
const verifiedAdmin = computed(() => Boolean(
  currentUser.value?.id &&
  permissionReady.value &&
  isSystemAdmin.value &&
  permissionUserId.value === currentUser.value.id
))

const departments = ref([])
const listLoading = ref(false)
const listError = ref('')
const operationLoading = ref(false)
const operationError = ref('')
const notice = ref('')
const search = ref('')
const statusFilter = ref('all')
const selectedId = ref(null)
const creating = ref(false)

const emptyForm = () => ({
  code: '',
  name: '',
  description: '',
  sort_order: 0
})
const form = ref(emptyForm())
const savedForm = ref(emptyForm())

// 部門權限採用獨立草稿，絕不寫入登入者本人的 permissionState。
const permissionRows = ref([])
const permissionDraft = ref([])
const permissionSaved = ref([])
const permissionForDepartmentId = ref(null)
const permissionLoading = ref(false)
const permissionSaving = ref(false)
const permissionError = ref('')
const permissionNotice = ref('')
let permissionRequestVersion = 0
let permissionOperationVersion = 0

const permissionDirty = computed(() => {
  if (!permissionForDepartmentId.value || permissionForDepartmentId.value !== selectedId.value) return false
  const a = [...permissionDraft.value].sort()
  const b = [...permissionSaved.value].sort()
  return JSON.stringify(a) !== JSON.stringify(b)
})
const permissionBusy = computed(() => permissionLoading.value || permissionSaving.value)
const editorBusy = computed(() => operationLoading.value || permissionSaving.value)
const permissionTotal = computed(() => permissionRows.value.length)
const permissionSelectedCount = computed(() => permissionDraft.value.length)

const groupNames = {
  inventory: '庫存工具',
  price: '價格工具',
  shopify: 'Shopify 工具',
  customs: '報關工具',
  permit: '公文工具',
  meeting: '會議管理'
}
const permissionGroups = computed(() => {
  const groups = new Map()
  for (const row of permissionRows.value) {
    if (!groups.has(row.group_key)) {
      groups.set(row.group_key, {
        key: row.group_key,
        label: groupNames[row.group_key] || row.group_key,
        tools: new Map()
      })
    }
    const group = groups.get(row.group_key)
    if (!group.tools.has(row.tool_key)) {
      group.tools.set(row.tool_key, { key: row.tool_key, label: row.tool_label, actions: [] })
    }
    group.tools.get(row.tool_key).actions.push(row)
  }
  return [...groups.values()].map(group => ({
    key: group.key,
    label: group.label,
    tools: [...group.tools.values()],
    grantCount: [...group.tools.values()].flatMap(tool => tool.actions)
      .filter(row => permissionDraft.value.includes(row.permission_key)).length
  }))
})

// 切換部門、登出或切換管理員後，使尚未完成的舊請求立即失效。
function clearPermissionEditor() {
  permissionRequestVersion += 1
  permissionOperationVersion += 1
  permissionRows.value = []
  permissionDraft.value = []
  permissionSaved.value = []
  permissionForDepartmentId.value = null
  permissionLoading.value = false
  permissionSaving.value = false
  permissionError.value = ''
  permissionNotice.value = ''
}

async function loadDepartmentPermissions(departmentId) {
  if (!verifiedAdmin.value || !departmentId || creating.value) return
  const requestId = ++permissionRequestVersion
  const ownerId = currentUser.value.id
  permissionLoading.value = true
  permissionForDepartmentId.value = null // 讀取未完成前不顯示可能過時的權限
  permissionError.value = ''
  permissionNotice.value = ''
  try {
    const { data, error } = await supabase.rpc('pts_admin_department_permissions', {
      p_department_id: departmentId
    })
    if (requestId !== permissionRequestVersion || currentUser.value?.id !== ownerId ||
        !verifiedAdmin.value || selectedId.value !== departmentId || creating.value) return
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('權限清單資料格式錯誤')

    permissionRows.value = data
    permissionForDepartmentId.value = departmentId
    const fromDatabase = data.filter(item => item.is_granted).map(item => item.permission_key)
    permissionSaved.value = fromDatabase
    permissionDraft.value = [...fromDatabase]
  } catch (error) {
    if (requestId !== permissionRequestVersion || !verifiedAdmin.value ||
        currentUser.value?.id !== ownerId) return
    permissionError.value = '無法取得部門功能權限，請重新整理後再試。'
    if (import.meta.env.DEV) console.warn('[PTS 部門權限] 讀取失敗：', error)
  } finally {
    if (requestId === permissionRequestVersion) permissionLoading.value = false
  }
}

// 勾選需要前置權限的操作時自動勾選前置項目，取消檢視時也一併取消下層操作。
function togglePermission(row, checked) {
  if (!verifiedAdmin.value || !selectedDepartment.value?.is_active ||
      permissionBusy.value || editorBusy.value ||
      permissionForDepartmentId.value !== selectedId.value) return
  if (checked && !row.is_available) return

  const next = new Set(permissionDraft.value)
  const catalog = new Map(permissionRows.value.map(item => [item.permission_key, item]))
  if (checked) {
    const visited = new Set()
    let current = row
    while (current) {
      if (visited.has(current.permission_key) || !current.is_available) {
        permissionError.value = '此操作所需的前置權限不可用，無法授權。'
        return
      }
      visited.add(current.permission_key)
      next.add(current.permission_key)
      current = current.requires_permission_key
        ? catalog.get(current.requires_permission_key)
        : null
      if (current === undefined) {
        permissionError.value = '找不到此操作所需的前置權限，請重新整理。'
        return
      }
    }
  } else {
    next.delete(row.permission_key)
    let changed = true
    while (changed) {
      changed = false
      for (const item of permissionRows.value) {
        if (next.has(item.permission_key) && item.requires_permission_key &&
            !next.has(item.requires_permission_key)) {
          next.delete(item.permission_key)
          changed = true
        }
      }
    }
  }
  permissionDraft.value = [...next]
  permissionError.value = ''
  permissionNotice.value = ''
}

function revertPermissionDraft() {
  if (permissionBusy.value || editorBusy.value) return
  permissionDraft.value = [...permissionSaved.value]
  permissionError.value = ''
  permissionNotice.value = ''
}

function friendlyPermissionError(error) {
  if (error?.code === '42501') return '目前帳號沒有權限維護資格，請確認管理員身分。'
  if (error?.code === 'P0002') return '找不到該部門，請重新整理後再試。'
  if (error?.code === '22023') return error.message || '權限資料不符合規則，請檢查後重試。'
  return '部門權限儲存失敗，請稍後重試。'
}

async function saveDepartmentPermissions() {
  if (!verifiedAdmin.value || !selectedDepartment.value?.is_active ||
      permissionBusy.value || editorBusy.value ||
      permissionForDepartmentId.value !== selectedId.value || !permissionDirty.value) return
  // RPC 仍要求原因，改由系統根據實際權限差異產生稽核摘要。
  const before = new Set(permissionSaved.value)
  const after = new Set(permissionDraft.value)
  const added = [...after].filter(key => !before.has(key))
  const removed = [...before].filter(key => !after.has(key))
  const reason = `部門功能權限調整：新增 ${added.length} 項、移除 ${removed.length} 項。` +
    ` 新增：${added.join(', ') || '無'}；移除：${removed.join(', ') || '無'}`
  const auditReason = reason.slice(0, 500)
  if (isDirty.value) {
    permissionError.value = '請先儲存或還原上方的部門基本資料，再儲存功能授權。'
    return
  }
  const ownerId = currentUser.value.id
  const departmentId = selectedId.value
  const operationId = ++permissionOperationVersion
  const keys = [...permissionDraft.value].sort()
  permissionSaving.value = true
  permissionError.value = ''
  permissionNotice.value = ''
  try {
    const { error } = await supabase.rpc('pts_admin_save_department_permissions', {
      p_department_id: departmentId,
      p_permission_keys: keys,
      p_reason: auditReason
    })
    if (error) throw error
    if (operationId !== permissionOperationVersion || currentUser.value?.id !== ownerId ||
        !verifiedAdmin.value || selectedId.value !== departmentId) return
    permissionSaved.value = keys
    permissionDraft.value = [...keys]
    await loadDepartmentPermissions(departmentId)
    await loadDepartments()
    if (operationId !== permissionOperationVersion || !verifiedAdmin.value ||
        selectedId.value !== departmentId) return
    permissionNotice.value = '部門功能權限已儲存，異動紀錄已建立。'
  } catch (error) {
    if (operationId !== permissionOperationVersion || currentUser.value?.id !== ownerId) return
    permissionError.value = friendlyPermissionError(error)
    if (import.meta.env.DEV) console.warn('[PTS 部門權限] 儲存失敗：', error)
  } finally {
    if (operationId === permissionOperationVersion) permissionSaving.value = false
  }
}

const pendingStatus = ref(null) // true: enable, false: disable, null: closed
const statusReason = ref('')
let requestVersion = 0
let operationVersion = 0

const selectedDepartment = computed(() =>
  departments.value.find(item => item.id === selectedId.value) ?? null
)
const hasEditor = computed(() => creating.value || Boolean(selectedDepartment.value))
const isDirty = computed(() =>
  hasEditor.value && JSON.stringify(form.value) !== JSON.stringify(savedForm.value)
)
const activeCount = computed(() => departments.value.filter(row => row.is_active).length)
const inactiveCount = computed(() => departments.value.length - activeCount.value)
const filteredDepartments = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  return departments.value.filter(row => {
    if (statusFilter.value === 'active' && !row.is_active) return false
    if (statusFilter.value === 'inactive' && row.is_active) return false
    return !keyword || [row.code, row.name, row.description || '']
      .join(' ').toLocaleLowerCase().includes(keyword)
  })
})

function formFromDepartment(department) {
  return {
    code: department.code,
    name: department.name,
    description: department.description || '',
    sort_order: department.sort_order
  }
}

function resetStatusConfirmation() {
  pendingStatus.value = null
  statusReason.value = ''
}

function confirmDiscardIfNeeded() {
  if (!isDirty.value && !permissionDirty.value) return true
  return window.confirm('目前有尚未儲存的部門資料或功能權限修改，確定要放棄並切換嗎？')
}

function selectDepartment(row) {
  if (editorBusy.value || permissionSaving.value) return
  if (!creating.value && selectedId.value === row.id) return
  if (!confirmDiscardIfNeeded()) return
  creating.value = false
  selectedId.value = row.id
  form.value = formFromDepartment(row)
  savedForm.value = formFromDepartment(row)
  operationError.value = ''
  notice.value = ''
  resetStatusConfirmation()
  clearPermissionEditor()
  void loadDepartmentPermissions(row.id)
}

function startCreate() {
  if (editorBusy.value || !confirmDiscardIfNeeded()) return
  selectedId.value = null
  creating.value = true
  form.value = emptyForm()
  savedForm.value = emptyForm()
  operationError.value = ''
  notice.value = ''
  resetStatusConfirmation()
  clearPermissionEditor()
}

function resetEditor() {
  // 僅重設基本資料表單，不影響下方獨立的功能權限草稿。
  if (editorBusy.value) return
  if (creating.value) {
    creating.value = false
    selectedId.value = null
    form.value = emptyForm()
    savedForm.value = emptyForm()
    clearPermissionEditor()
  } else if (selectedDepartment.value) {
    form.value = formFromDepartment(selectedDepartment.value)
    savedForm.value = formFromDepartment(selectedDepartment.value)
  }
  operationError.value = ''
  resetStatusConfirmation()
}

async function loadDepartments({ refreshEditor = false } = {}) {
  if (!verifiedAdmin.value) return
  const requestId = ++requestVersion
  const ownerId = currentUser.value.id
  listLoading.value = true
  listError.value = ''

  try {
    const { data, error } = await supabase.rpc('pts_admin_departments')
    if (requestId !== requestVersion || !verifiedAdmin.value ||
        currentUser.value?.id !== ownerId) return
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('部門清單格式錯誤')

    departments.value = data
    if (selectedId.value && !data.some(item => item.id === selectedId.value)) {
      selectedId.value = null
      creating.value = false
      clearPermissionEditor()
    }
    if (!creating.value && selectedDepartment.value &&
        (refreshEditor || !isDirty.value)) {
      form.value = formFromDepartment(selectedDepartment.value)
      savedForm.value = formFromDepartment(selectedDepartment.value)
    }
  } catch (error) {
    if (requestId !== requestVersion || !verifiedAdmin.value) return
    listError.value = '無法取得部門資料，請稍後重新整理。'
    if (import.meta.env.DEV) console.warn('[PTS 部門] 讀取失敗：', error)
  } finally {
    if (requestId === requestVersion) listLoading.value = false
  }
}

async function handleRefresh() {
  if (listLoading.value || editorBusy.value || permissionLoading.value || !verifiedAdmin.value) return
  if ((isDirty.value || permissionDirty.value) && !confirmDiscardIfNeeded()) return
  operationError.value = ''
  notice.value = ''
  resetStatusConfirmation()
  await loadDepartments({ refreshEditor: true })
  if (!creating.value && selectedId.value) await loadDepartmentPermissions(selectedId.value)
}

function validateForm() {
  const name = form.value.name.trim()
  const code = form.value.code.trim().toLowerCase()
  const description = form.value.description.trim()
  const order = Number(form.value.sort_order)

  if (creating.value && !/^[a-z][a-z0-9_]{0,49}$/.test(code)) {
    return '部門代碼限 1–50 個英文字母、數字或底線，且須以英文字母開頭。'
  }
  if (!name || name.length > 120) return '部門名稱須為 1–120 個字元。'
  if (description.length > 1000) return '部門說明最多 1000 個字元。'
  if (!Number.isInteger(order) || order < 0 || order > 9999) {
    return '排序必須是 0–9999 的整數。'
  }
  return ''
}

function friendlyError(error) {
  if (error?.code === '23505') return '部門代碼已存在，請使用其他代碼。'
  if (error?.code === '42501') return '目前帳號沒有管理部門的權限，請重新登入或確認管理員資格。'
  if (error?.code === 'P0002') return '找不到該部門，請重新整理後再試。'
  return '儲存失敗，請檢查資料後重試。'
}

async function saveDepartment() {
  if (!verifiedAdmin.value || !hasEditor.value || editorBusy.value) return
  const validationError = validateForm()
  operationError.value = validationError
  notice.value = ''
  if (validationError) return
  if (!creating.value && !isDirty.value) {
    notice.value = '資料沒有變更。'
    return
  }

  const ownerId = currentUser.value.id
  const operationId = ++operationVersion
  operationLoading.value = true
  const adding = creating.value
  const targetId = selectedId.value
  const args = adding
    ? {
        p_code: form.value.code.trim().toLowerCase(),
        p_name: form.value.name.trim(),
        p_description: form.value.description.trim() || null,
        p_sort_order: Number(form.value.sort_order)
      }
    : {
        p_department_id: targetId,
        p_name: form.value.name.trim(),
        p_description: form.value.description.trim() || null,
        p_sort_order: Number(form.value.sort_order)
      }

  try {
    const { data, error } = await supabase.rpc(
      adding ? 'pts_admin_create_department' : 'pts_admin_update_department',
      args
    )
    if (error) throw error
    if (operationId !== operationVersion || !verifiedAdmin.value ||
        currentUser.value?.id !== ownerId) return

    creating.value = false
    if (adding) selectedId.value = data
    savedForm.value = { ...form.value, ...(
      adding ? { code: args.p_code } : { code: form.value.code }
    ) }
    await loadDepartments({ refreshEditor: true })
    if (adding) await loadDepartmentPermissions(data)
    notice.value = adding ? '部門建立成功。' : '部門資料已更新。'
    resetStatusConfirmation()
  } catch (error) {
    if (operationId !== operationVersion || currentUser.value?.id !== ownerId) return
    operationError.value = friendlyError(error)
    if (import.meta.env.DEV) console.warn('[PTS 部門] 儲存失敗：', error)
  } finally {
    if (operationId === operationVersion) operationLoading.value = false
  }
}

function beginStatusChange(newActive) {
  if (!verifiedAdmin.value || editorBusy.value || isDirty.value || permissionDirty.value) return
  pendingStatus.value = newActive
  statusReason.value = ''
  operationError.value = ''
  notice.value = ''
}

async function saveStatusChange() {
  if (!verifiedAdmin.value || !selectedDepartment.value ||
      pendingStatus.value === null || editorBusy.value || permissionDirty.value) return

  const reason = statusReason.value.trim()
  if (reason.length < 1 || reason.length > 500) {
    operationError.value = '請填寫 1–500 個字元的狀態變更原因。'
    return
  }
  const ownerId = currentUser.value.id
  const operationId = ++operationVersion
  const newActive = pendingStatus.value
  operationLoading.value = true
  operationError.value = ''
  try {
    const { error } = await supabase.rpc('pts_admin_set_department_active', {
      p_department_id: selectedId.value,
      p_is_active: newActive,
      p_reason: reason
    })
    if (error) throw error
    if (operationId !== operationVersion || !verifiedAdmin.value ||
        currentUser.value?.id !== ownerId) return
    resetStatusConfirmation()
    await loadDepartments({ refreshEditor: true })
    notice.value = newActive ? '部門已重新啟用。' : '部門已停用，該部門的繼承授權將暫停生效。'
  } catch (error) {
    if (operationId !== operationVersion || currentUser.value?.id !== ownerId) return
    operationError.value = friendlyError(error)
    if (import.meta.env.DEV) console.warn('[PTS 部門] 狀態變更失敗：', error)
  } finally {
    if (operationId === operationVersion) operationLoading.value = false
  }
}

// 退出帳號時立即清掉可能屬於前一位使用者的部門資料與表單。
watch(() => currentUser.value?.id ?? null, () => {
  requestVersion += 1
  operationVersion += 1
  departments.value = []
  selectedId.value = null
  creating.value = false
  form.value = emptyForm()
  savedForm.value = emptyForm()
  listError.value = ''
  operationError.value = ''
  notice.value = ''
  listLoading.value = false
  operationLoading.value = false
  clearPermissionEditor()
  resetStatusConfirmation()
}, { immediate: true })

watch(verifiedAdmin, value => {
  if (value) {
    void loadDepartments()
    if (selectedId.value && !creating.value) void loadDepartmentPermissions(selectedId.value)
  } else {
    // 權限重新載入期間採預設禁止，不顯示已取得的部門資料。
    requestVersion += 1
    permissionRequestVersion += 1
    listLoading.value = false
    permissionLoading.value = false
  }
}, { immediate: true })
</script>

<template>
  <section class="space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="space-y-2">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          SYSTEM ADMINISTRATION
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">部門管理</h1>
        <p class="max-w-2xl text-sm leading-6 text-slate-500">
          建立部門、維護基本資料與功能授權。部門停用後，所屬的繼承授權會暫停生效，重新啟用後恢復。
        </p>
      </div>
      <button
        v-if="verifiedAdmin"
        type="button"
        class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        :disabled="listLoading || editorBusy || permissionLoading"
        @click="handleRefresh"
      >
        {{ listLoading ? '讀取中…' : '重新整理' }}
      </button>
    </header>

    <div v-if="!verifiedAdmin" class="rounded-xl border border-slate-200 bg-white p-6">
      <p class="font-semibold text-slate-900">
        {{ authPermissionLoading ? '正在驗證管理員身分…' : '無法顯示部門管理資料' }}
      </p>
      <p class="mt-2 text-sm text-slate-500">此頁僅供已驗證的 PTS 系統管理員使用。</p>
    </div>

    <template v-else>
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium text-slate-500">部門總數</p>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{{ departments.length }}</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium text-slate-500">使用中</p>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{{ activeCount }}</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium text-slate-500">已停用</p>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{{ inactiveCount }}</p>
        </div>
      </div>

      <p v-if="listError" role="alert" class="rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-700">
        {{ listError }}
      </p>

      <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <!-- 左側：部門清單 -->
        <div class="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">部門清單</h2>
              <p class="mt-1 text-xs text-slate-400">{{ filteredDepartments.length }} 個符合條件的部門</p>
            </div>
            <button
              type="button"
              class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
              :disabled="editorBusy"
              @click="startCreate"
            >新增部門</button>
          </div>
          <div class="flex flex-wrap gap-2">
            <label class="min-w-[180px] flex-1">
              <span class="sr-only">搜尋部門</span>
              <input v-model="search" type="search" placeholder="搜尋名稱、代碼或說明"
                     class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-slate-400" />
            </label>
            <label>
              <span class="sr-only">部門狀態</span>
              <select v-model="statusFilter" class="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
                <option value="all">全部狀態</option>
                <option value="active">使用中</option>
                <option value="inactive">已停用</option>
              </select>
            </label>
          </div>

          <div v-if="listLoading && !departments.length" class="py-10 text-center text-sm text-slate-500">
            正在讀取部門清單…
          </div>
          <div v-else-if="!filteredDepartments.length" class="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center">
            <p class="text-sm font-medium text-slate-700">
              {{ departments.length ? '找不到符合條件的部門' : '尚未建立部門' }}
            </p>
            <p class="mt-2 text-xs text-slate-400">可以從右上方的「新增部門」開始。</p>
          </div>
          <div v-else class="divide-y divide-slate-100">
            <button
              v-for="department in filteredDepartments"
              :key="department.id"
              type="button"
              :disabled="editorBusy"
              class="w-full rounded-lg px-3 py-3 text-left transition hover:bg-slate-50 disabled:opacity-60"
              :class="selectedId === department.id && !creating ? 'bg-slate-100' : ''"
              :aria-current="selectedId === department.id && !creating ? 'true' : undefined"
              @click="selectDepartment(department)"
            >
              <span class="flex flex-wrap items-start justify-between gap-2">
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium text-slate-900">{{ department.name }}</span>
                  <span class="mt-1 block break-all font-mono text-xs text-slate-400">{{ department.code }}</span>
                </span>
                <span class="rounded-md px-2 py-1 text-xs font-medium"
                      :class="department.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'">
                  {{ department.is_active ? '使用中' : '已停用' }}
                </span>
              </span>
              <span class="mt-2 block text-xs text-slate-500">
                成員 {{ department.member_count }} 人 · 授權 {{ department.permission_count }} 項 · 排序 {{ department.sort_order }}
              </span>
              <span v-if="department.description" class="mt-1 block truncate text-xs text-slate-400">{{ department.description }}</span>
            </button>
          </div>
        </div>

        <!-- 右側：部門資料編輯 -->
        <div class="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <template v-if="hasEditor">
            <div class="mb-5 flex items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {{ creating ? 'NEW DEPARTMENT' : 'DEPARTMENT DETAILS' }}
                </p>
                <h2 class="mt-2 text-lg font-semibold text-slate-900">
                  {{ creating ? '新增部門' : '編輯部門' }}
                </h2>
              </div>
              <span v-if="!creating" class="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
                {{ selectedDepartment?.is_active ? '使用中' : '已停用' }}
              </span>
            </div>

            <form class="space-y-4" @submit.prevent="saveDepartment">
              <label class="block space-y-1.5">
                <span class="text-sm font-medium text-slate-700">部門代碼 <span class="text-rose-600">*</span></span>
                <input v-model="form.code" type="text" maxlength="50" :readonly="!creating"
                       autocomplete="off" placeholder="例如：sales"
                       class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400 read-only:bg-slate-50 read-only:text-slate-500" />
                <span class="block text-xs text-slate-400">以英文字母開頭，可用小寫英數與底線。建立後不可修改。</span>
              </label>
              <label class="block space-y-1.5">
                <span class="text-sm font-medium text-slate-700">部門名稱 <span class="text-rose-600">*</span></span>
                <input v-model="form.name" type="text" maxlength="120" placeholder="例如：業務部"
                       class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
              </label>
              <label class="block space-y-1.5">
                <span class="text-sm font-medium text-slate-700">說明</span>
                <textarea v-model="form.description" rows="3" maxlength="1000" placeholder="負責範圍或備註"
                          class="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400"></textarea>
              </label>
              <label class="block space-y-1.5">
                <span class="text-sm font-medium text-slate-700">顯示排序</span>
                <input v-model.number="form.sort_order" type="number" min="0" max="9999" step="1"
                       class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                <span class="block text-xs text-slate-400">數字越小，排列越前面。</span>
              </label>

              <div v-if="operationError" role="alert" class="rounded-lg border border-rose-200 p-3 text-sm text-rose-700">
                {{ operationError }}
              </div>
              <div v-if="notice" role="status" class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {{ notice }}
              </div>

              <div class="flex flex-wrap gap-2 pt-1">
                <button type="submit" :disabled="editorBusy"
                        class="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
                  {{ operationLoading ? '儲存中…' : creating ? '建立部門' : '儲存變更' }}
                </button>
                <button type="button" :disabled="editorBusy" @click="resetEditor"
                        class="rounded-lg border border-slate-200 px-5 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                  {{ creating ? '取消' : '還原修改' }}
                </button>
              </div>
            </form>

            <div v-if="!creating && selectedDepartment" class="mt-7 border-t border-slate-200 pt-5">
              <h3 class="text-sm font-semibold text-slate-900">部門狀態</h3>
              <p class="mt-2 text-xs leading-5 text-slate-500">
                停用後，系統會暫停此部門的繼承授權，但保留部門、成員與權限關聯；重新啟用可恢復繼承。
              </p>
              <div v-if="isDirty || permissionDirty" class="mt-3 text-xs text-amber-700">請先儲存或還原基本資料及功能權限修改，才能變更部門狀態。</div>
              <button v-if="pendingStatus === null" type="button"
                      :disabled="editorBusy || isDirty || permissionDirty"
                      class="mt-4 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                      @click="beginStatusChange(!selectedDepartment.is_active)">
                {{ selectedDepartment.is_active ? '停用部門' : '重新啟用部門' }}
              </button>

              <div v-else class="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p class="text-sm font-semibold text-slate-900">
                  {{ pendingStatus ? '確認重新啟用此部門？' : '確認停用此部門？' }}
                </p>
                <label class="block space-y-1.5">
                  <span class="text-xs font-medium text-slate-600">異動原因（必填）</span>
                  <textarea v-model="statusReason" rows="2" maxlength="500" placeholder="請說明原因"
                            class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"></textarea>
                </label>
                <div class="flex flex-wrap gap-2">
                  <button type="button" :disabled="editorBusy || !statusReason.trim()"
                          class="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                          @click="saveStatusChange">{{ operationLoading ? '處理中…' : '確認變更' }}</button>
                  <button type="button" :disabled="editorBusy" @click="resetStatusConfirmation"
                          class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">取消</button>
                </div>
              </div>
            </div>

            <!-- Phase 03-B：部門功能權限草稿，與上方基本資料分開儲存。 -->
            <section v-if="!creating && selectedDepartment" class="mt-7 border-t border-slate-200 pt-6">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 class="text-base font-semibold text-slate-900">部門功能權限</h3>
                  <p class="mt-1 text-xs leading-5 text-slate-500">
                    僅勾選此部門允許的操作，未勾選代表不授權；人員權限另依多部門、角色及個人設定綜合計算。
                  </p>
                </div>
                <span class="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
                  {{ permissionSelectedCount }} / {{ permissionTotal }} 項
                </span>
              </div>

              <p v-if="!selectedDepartment.is_active" class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                此部門目前已停用，繼承授權暫停生效。請先重新啟用部門才能調整功能權限。
              </p>

              <div v-if="permissionLoading || permissionForDepartmentId !== selectedId" class="mt-4 rounded-lg border border-slate-200 p-5 text-sm text-slate-500">
                {{ permissionLoading ? '正在讀取部門權限…' : permissionError || '尚未取得權限資料，請點選上方「重新整理」。' }}
              </div>
              <template v-else>
                <div v-if="!permissionRows.length" class="mt-4 rounded-lg border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                  尚無可設定的功能權限。
                </div>
                <div v-else class="mt-4 space-y-3">
                  <details
                    v-for="group in permissionGroups"
                    :key="group.key"
                    class="overflow-hidden rounded-lg border border-slate-200"
                    :open="group.key === 'inventory'"
                  >
                    <summary class="flex cursor-pointer list-none items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
                      <span>{{ group.label }}</span>
                      <span class="text-xs font-normal text-slate-500">已勾選 {{ group.grantCount }} 項</span>
                    </summary>
                    <div class="divide-y divide-slate-100 px-4">
                      <div v-for="tool in group.tools" :key="tool.key" class="py-3">
                        <p class="text-sm font-medium text-slate-800">{{ tool.label }}</p>
                        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                          <label v-for="action in tool.actions" :key="action.permission_key"
                                 class="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700"
                                 :class="(!selectedDepartment.is_active || editorBusy || permissionBusy || (!action.is_available && !permissionDraft.includes(action.permission_key))) ? 'opacity-50' : ''">
                            <input type="checkbox" class="h-4 w-4 rounded border-slate-300 accent-slate-900"
                                   :checked="permissionDraft.includes(action.permission_key)"
                                   :disabled="!selectedDepartment.is_active || editorBusy || permissionBusy || (!action.is_available && !permissionDraft.includes(action.permission_key))"
                                   @change="togglePermission(action, $event.target.checked)" />
                            {{ action.action_label }}
                            <span v-if="!action.is_available" class="text-slate-400">(停用)</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </details>
                </div>
                <p class="mt-3 text-xs leading-5 text-slate-500">
                  勾選「匯出、編輯、新增」等操作時，自動加入所需的「檢視」權限；取消檢視時會連帶取消相依操作。
                </p>

                <div v-if="permissionDirty" class="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p class="text-sm font-semibold text-slate-800">尚有未儲存的權限變更</p>
                  <div class="flex flex-wrap gap-2">
                    <button type="button" :disabled="editorBusy || permissionBusy || !selectedDepartment.is_active || isDirty"
                            class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                            @click="saveDepartmentPermissions">
                      {{ permissionSaving ? '儲存中…' : '儲存功能權限' }}
                    </button>
                    <button type="button" :disabled="editorBusy || permissionBusy" @click="revertPermissionDraft"
                            class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 disabled:opacity-50">
                      還原勾選
                    </button>
                  </div>
                </div>
                <p v-else class="mt-4 text-xs text-slate-400">目前的勾選內容已與資料庫同步。</p>
              </template>
              <p v-if="permissionError && permissionForDepartmentId === selectedId" role="alert" class="mt-3 rounded-lg border border-rose-200 p-3 text-sm text-rose-700">
                {{ permissionError }}
              </p>
              <p v-if="permissionNotice" role="status" class="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {{ permissionNotice }}
              </p>
            </section>
          </template>

          <div v-else class="py-14 text-center">
            <p class="text-sm font-semibold text-slate-800">選擇部門或新增部門</p>
            <p class="mt-2 text-xs leading-5 text-slate-500">在左側選擇一個部門即可查看及修改基本資料。</p>
          </div>
        </div>
      </div>
      <p class="text-xs leading-5 text-slate-400">
        部門基本資料與功能授權分開儲存並留下異動紀錄；成員指派及個人權限維護將於後續階段加入。
      </p>
    </template>
  </section>
</template>
