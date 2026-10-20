<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { supabase } from '@/lib/supabaseClient'
import { currentUser } from '@/stores/authState'
import {
  permissionReady,
  permissionUserId,
  isSystemAdmin
} from '@/stores/permissionState'

/**
 * Phase 03-D2：PTS 員工帳號管理（第一階段：建立待啟用帳號）。
 *
 * - 員工列表：使用資料庫管理員專用的 pts_admin_users RPC。
 * - 建立帳號：只透過 pts-admin-create-employee Edge Function。
 * - 不在瀏覽器建立 Auth 使用者，不接觸 service_role 金鑰。
 * - 一次性憑證只保留於當前元件的記憶體；離開或登出時清除。
 * - 此版本尚未提供首次設定密碼／啟用員工的介面（Phase 03-D3）。
 */
const verifiedAdmin = computed(() => Boolean(
  currentUser.value?.id &&
  permissionReady.value &&
  isSystemAdmin.value &&
  permissionUserId.value === currentUser.value.id
))

const users = ref([])
const usersLoading = ref(false)
const usersError = ref('')
const search = ref('')
const statusFilter = ref('all')
const updatedAt = ref(null)

const initialForm = () => ({
  username: '',
  display_name: '',
  email: ''
})
const form = ref(initialForm())
const reviewing = ref(false)
const creatingAccount = ref(false)
const createError = ref('')
const createdAccount = ref(null)
const showSecret = ref(false)
const copiedSecret = ref(false)
const clipboardMessage = ref('')

let listVersion = 0
let createVersion = 0

const activeCount = computed(() => users.value.filter(user => user.is_active).length)
const inactiveCount = computed(() => users.value.filter(user => !user.is_active).length)
const filteredUsers = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  return users.value.filter(user => {
    if (statusFilter.value === 'active' && !user.is_active) return false
    if (statusFilter.value === 'inactive' && user.is_active) return false
    if (!keyword) return true
    const values = [user.display_name, user.username]
    return values.some(value => String(value ?? '').toLocaleLowerCase().includes(keyword))
  })
})
const trimmedForm = computed(() => ({
  username: form.value.username.trim().toLowerCase(),
  display_name: form.value.display_name.trim(),
  email: form.value.email.trim().toLowerCase()
}))
const expiryLabel = computed(() => {
  if (!createdAccount.value?.temporary_password_expires_at) return '未提供'
  const parsed = new Date(createdAccount.value.temporary_password_expires_at)
  return Number.isNaN(parsed.getTime())
    ? '未提供'
    : parsed.toLocaleString('zh-TW', { hour12: false })
})

function clearCredential() {
  // 此憑證不會寫入 localStorage、sessionStorage 或管理員共用狀態。
  createdAccount.value = null
  showSecret.value = false
  copiedSecret.value = false
  clipboardMessage.value = ''
}

function clearForNewIdentity() {
  listVersion += 1
  createVersion += 1
  users.value = []
  usersLoading.value = false
  usersError.value = ''
  updatedAt.value = null
  search.value = ''
  statusFilter.value = 'all'
  form.value = initialForm()
  reviewing.value = false
  creatingAccount.value = false
  createError.value = ''
  clearCredential()
}

async function loadUsers() {
  if (!verifiedAdmin.value) return
  const version = ++listVersion
  const ownerId = currentUser.value.id
  usersLoading.value = true
  usersError.value = ''

  try {
    const { data, error } = await supabase.rpc('pts_admin_users')
    if (version !== listVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('人員清單資料格式不正確')
    users.value = data
    updatedAt.value = new Date()
  } catch (error) {
    if (version !== listVersion || currentUser.value?.id !== ownerId) return
    usersError.value = '無法讀取人員資料，請稍後重新整理。'
    if (import.meta.env.DEV) console.warn('[PTS 人員管理] 讀取帳號清單失敗：', error?.message)
  } finally {
    if (version === listVersion) usersLoading.value = false
  }
}

function validateForm() {
  if (!/^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/.test(trimmedForm.value.username)) {
    return 'Username 須為 3～32 個字元，以英文字母開頭、英文字母或數字結尾，中間可使用 .、_、-。'
  }
  if (trimmedForm.value.display_name.length < 1 || trimmedForm.value.display_name.length > 120) {
    return '請填寫 1～120 個字元的員工顯示名稱。'
  }
  if (trimmedForm.value.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedForm.value.email)) {
    return '請填寫有效的員工 Email。'
  }
  if (users.value.some(user => user.username?.toLowerCase() === trimmedForm.value.username)) {
    return '此 Username 已經存在，請使用另一個帳號。'
  }
  return ''
}

// 使用者重新修改表單時清除舊驗證結果，避免錯誤訊息與當前欄位不一致。
// 只在編輯模式清除；確認中及建立帳號中的流程維持原有保護。
watch(
  () => [form.value.username, form.value.display_name, form.value.email],
  () => {
    if (!reviewing.value && !creatingAccount.value && createError.value) {
      createError.value = ''
    }
  }
)

function beginReview() {
  if (!verifiedAdmin.value || creatingAccount.value || createdAccount.value) return
  createError.value = validateForm()
  if (createError.value) return
  reviewing.value = true
}

async function resolveCreateError(error) {
  const status = error?.context?.status
  if (status === 401) return '登入已失效，請重新登入後再試。'
  if (status === 403) return '目前帳號沒有建立員工的權限。'
  if (status === 409) return 'Username 或 Email 已被使用，請檢查後再試。'
  if (status === 429) return '操作過於頻繁，請稍後再試。'

  // Edge Function 不會傳回服務密鑰或密碼；仍只接受受控的安全錯誤文字。
  if (error?.context?.json) {
    try {
      const response = await error.context.clone().json()
      const approved = new Set([
        '帳號建立服務暫時無法使用',
        '無法安全鎖定新帳號，請管理員檢查帳號清單',
        '建立失敗且需管理員檢查殘留帳號，請暫停重試',
        '建立員工資料失敗，已回復帳號建立操作',
        '暫時無法驗證帳號是否重複'
      ])
      if (approved.has(response?.error)) return response.error
    } catch { /* 可能是網路錯誤或非 JSON 回應 */ }
  }
  return '建立員工帳號失敗，請確認網路狀態與資料後重試。'
}

async function createEmployee() {
  if (!reviewing.value || !verifiedAdmin.value || creatingAccount.value || createdAccount.value) return
  createError.value = validateForm()
  if (createError.value) {
    reviewing.value = false
    return
  }

  const ownerId = currentUser.value.id
  const version = ++createVersion
  const payload = { ...trimmedForm.value }
  creatingAccount.value = true
  createError.value = ''

  try {
    const { data, error } = await supabase.functions.invoke('pts-admin-create-employee', {
      body: payload
    })
    if (error) throw error
    if (!data || typeof data !== 'object' ||
      typeof data.user_id !== 'string' ||
      typeof data.temporary_password !== 'string' ||
      !data.temporary_password) {
      // 不可自動重試，因為後端可能已完成建帳但回應格式異常。
      throw new Error('帳號可能已建立，但回應格式無法確認。請先重新整理清單，勿直接重試。')
    }
    if (version !== createVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return

    createdAccount.value = {
      user_id: data.user_id,
      username: data.username,
      display_name: data.display_name,
      email: data.email,
      temporary_password: data.temporary_password,
      temporary_password_expires_at: data.temporary_password_expires_at
    }
    showSecret.value = false
    copiedSecret.value = false
    reviewing.value = false
    form.value = initialForm()
    await loadUsers()
  } catch (error) {
    if (version !== createVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    if (error?.message?.startsWith('帳號可能已建立')) {
      createError.value = error.message
    } else {
      createError.value = await resolveCreateError(error)
    }
  } finally {
    if (version === createVersion) creatingAccount.value = false
  }
}

async function copyTemporaryPassword() {
  if (!verifiedAdmin.value || !createdAccount.value?.temporary_password) return
  clipboardMessage.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(createdAccount.value.temporary_password)
    copiedSecret.value = true
    clipboardMessage.value = '已複製一次性憑證。請以公司核准的私密管道交付，並在完成後清除剪貼簿內容。'
  } catch {
    clipboardMessage.value = '無法自動複製，請點選「顯示」後手動選取憑證。'
  }
}

function closeCredential() {
  if (!createdAccount.value) return
  if (!window.confirm('確定關閉這組一次性憑證？離開後無法再次取得，且目前沒有重發功能。')) return
  clearCredential()
  createError.value = ''
}

// 更換登入者立即銷毀一次性憑證；權限重新讀取期間只暫時隱藏介面。
watch(() => currentUser.value?.id ?? null, () => {
  clearForNewIdentity()
}, { immediate: true })

watch(verifiedAdmin, (enabled) => {
  if (enabled) {
    void loadUsers()
  } else {
    listVersion += 1
    usersLoading.value = false
  }
}, { immediate: true })

// 已確定失去管理員資格時清除敏感資料；讀取中（permissionReady=false）暫不銷毀。
watch([permissionReady, isSystemAdmin], ([ready, admin]) => {
  if (ready && !admin) clearForNewIdentity()
})

onUnmounted(() => {
  clearForNewIdentity()
})
</script>

<template>
  <section class="space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">PTS / 系統管理</p>
        <h1 class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">人員管理</h1>
        <p class="mt-2 text-sm leading-6 text-slate-500">建立獨立的員工帳號，並管理首次設定密碼前的待啟用狀態。</p>
      </div>
      <button
        type="button"
        class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!verifiedAdmin || usersLoading || creatingAccount"
        @click="loadUsers"
      >
        {{ usersLoading ? '讀取中…' : '更新人員清單' }}
      </button>
    </div>

    <div v-if="!verifiedAdmin" class="rounded-xl border border-slate-200 bg-white p-6">
      <p class="text-sm font-medium text-slate-800">正在確認系統管理員權限，或目前帳號沒有管理資格。</p>
      <p class="mt-2 text-xs leading-6 text-slate-500">重新驗證完成前，不會顯示人員資料或一次性憑證。</p>
    </div>

    <template v-else>
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs text-slate-500">PTS 帳號</p>
          <p class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{{ users.length }}</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs text-slate-500">啟用帳號</p>
          <p class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{{ activeCount }}</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-5">
          <p class="text-xs text-slate-500">未啟用帳號</p>
          <p class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{{ inactiveCount }}</p>
        </div>
      </div>

      <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div class="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold text-slate-900">帳號清單</h2>
              <p class="mt-1 text-xs text-slate-500">從 Supabase 讀取目前的 PTS 帳號，不包含密碼。</p>
            </div>
            <span class="text-xs text-slate-400">{{ updatedAt ? '已同步' : '尚未同步' }}</span>
          </div>

          <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              v-model="search"
              type="search"
              placeholder="搜尋姓名或 Username"
              aria-label="搜尋姓名或 Username"
              class="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400"
            />
            <select
              v-model="statusFilter"
              aria-label="篩選帳號狀態"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400"
            >
              <option value="all">全部狀態</option>
              <option value="active">啟用</option>
              <option value="inactive">未啟用</option>
            </select>
          </div>

          <p v-if="usersError" role="alert" class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {{ usersError }}
          </p>
          <div v-if="usersLoading && !users.length" class="rounded-lg border border-slate-200 p-8 text-center text-sm text-slate-500">
            讀取帳號清單中…
          </div>
          <div v-else-if="!filteredUsers.length" class="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
            {{ users.length ? '沒有符合搜尋條件的帳號。' : '尚未載入帳號，或目前沒有帳號。' }}
          </div>
          <ul v-else class="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
            <li v-for="user in filteredUsers" :key="user.user_id" class="flex items-center justify-between gap-3 px-4 py-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-slate-900">{{ user.display_name || '未設定姓名' }}</p>
                <p class="mt-1 truncate text-xs text-slate-500">{{ user.username ? `@${user.username}` : '未設定 Username' }}</p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                <span v-if="user.is_system_admin" class="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">管理員</span>
                <span class="rounded-md px-2 py-0.5 text-[11px] font-medium"
                      :class="user.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'">
                  {{ user.is_active ? '已啟用' : '未啟用' }}
                </span>
              </div>
            </li>
          </ul>
          <p class="text-xs leading-5 text-slate-400">未啟用狀態可能包含舊帳號或待首次設定密碼的帳號。此階段僅供檢視，尚未開放修改帳號狀態。</p>
        </div>

        <div class="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <template v-if="createdAccount">
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-base font-semibold text-slate-900">帳號已建立</h2>
              <span class="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">待首次設定</span>
            </div>
            <p class="mt-3 text-sm leading-6 text-slate-600">
              已建立 <strong class="text-slate-900">{{ createdAccount.display_name }}</strong>
              （@{{ createdAccount.username }}），目前仍禁止登入與操作工具。
            </p>
            <div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
              <strong>重要：一次性憑證僅顯示這一次。</strong>
              離開頁面、重新整理或關閉此區塊後就無法再取得。
              Phase 03-D3 上線前，員工尚無法使用這組憑證進行首次密碼設定。
            </div>
            <dl class="mt-4 space-y-3 text-sm">
              <div>
                <dt class="text-xs text-slate-500">Username</dt>
                <dd class="font-medium text-slate-900">{{ createdAccount.username }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">員工 Email</dt>
                <dd class="break-all text-slate-700">{{ createdAccount.email }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">有效期限</dt>
                <dd class="text-slate-700">{{ expiryLabel }}</dd>
              </div>
            </dl>
            <label for="employee-first-password" class="mt-4 block text-xs font-medium text-slate-700">一次性憑證</label>
            <div class="mt-2 flex flex-wrap gap-2">
              <input
                id="employee-first-password"
                :type="showSecret ? 'text' : 'password'"
                :value="createdAccount.temporary_password"
                readonly
                spellcheck="false"
                autocomplete="off"
                aria-label="一次性憑證"
                class="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-900"
              />
              <button type="button" class="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" @click="showSecret = !showSecret">
                {{ showSecret ? '隱藏' : '顯示' }}
              </button>
              <button type="button" class="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800" @click="copyTemporaryPassword">
                {{ copiedSecret ? '已複製' : '複製' }}
              </button>
            </div>
            <p v-if="clipboardMessage" role="status" class="mt-2 text-xs leading-5 text-slate-500">{{ clipboardMessage }}</p>
            <p class="mt-3 text-xs leading-5 text-slate-500">請以公司核准的私密管道交付一次性憑證，避免貼在公開群組或納入長期文件。</p>
            <button type="button" class="mt-5 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50" @click="closeCredential">
              我已安全保存，關閉此憑證
            </button>
          </template>

          <template v-else>
            <div>
              <h2 class="text-base font-semibold text-slate-900">建立員工帳號</h2>
              <p class="mt-1 text-xs leading-5 text-slate-500">僅建立待啟用帳號；本次不會寄送任何 Email。</p>
            </div>

            <form class="mt-5 space-y-4" autocomplete="off" novalidate @submit.prevent="beginReview">
              <div>
                <label for="employee-username" class="block text-sm font-medium text-slate-700">Username <span class="text-rose-600">*</span></label>
                <input id="employee-username" v-model="form.username" type="text" maxlength="32" placeholder="例如：xiaoming"
                       autocapitalize="none" spellcheck="false" autocomplete="off" :disabled="reviewing || creatingAccount"
                       class="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50" />
                <p class="mt-1 text-xs leading-5 text-slate-400">3～32 字元，英文字母開頭，可用數字、點、底線及連字號。</p>
              </div>
              <div>
                <label for="employee-name" class="block text-sm font-medium text-slate-700">顯示名稱 <span class="text-rose-600">*</span></label>
                <input id="employee-name" v-model="form.display_name" type="text" maxlength="120" placeholder="例如：小明"
                       autocomplete="off" :disabled="reviewing || creatingAccount"
                       class="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50" />
              </div>
              <div>
                <label for="employee-email" class="block text-sm font-medium text-slate-700">員工 Email <span class="text-rose-600">*</span></label>
                <input id="employee-email" v-model="form.email" type="email" maxlength="254" placeholder="employee@example.com"
                       autocomplete="off" :disabled="reviewing || creatingAccount"
                       class="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50" />
                <p class="mt-1 text-xs leading-5 text-slate-400">僅作為 Supabase Auth 識別使用。PTS 仍使用 Username 登入。</p>
              </div>

              <p v-if="createError" role="alert" class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-700">{{ createError }}</p>

              <div v-if="reviewing" class="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p class="text-sm font-semibold text-amber-900">建立前再次確認</p>
                <p class="break-all text-xs leading-6 text-amber-900">
                  <strong>{{ trimmedForm.display_name }}</strong>
                  （@{{ trimmedForm.username }}）<br />{{ trimmedForm.email }}
                </p>
                <p class="text-xs leading-5 text-amber-800">
                  確認後將新增一個正式 Auth 帳號，但仍保持封鎖及待啟用狀態。
                  首次密碼設定尚未上線，請勿讓同事現在嘗試登入。
                </p>
                <div class="flex flex-wrap gap-2">
                  <button type="button" :disabled="creatingAccount" class="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50" @click="createEmployee">
                    {{ creatingAccount ? '建立中…' : '確認建立帳號' }}
                  </button>
                  <button type="button" :disabled="creatingAccount" class="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 disabled:opacity-50" @click="reviewing = false">
                    返回修改
                  </button>
                </div>
              </div>
              <button v-else type="submit" :disabled="creatingAccount" class="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
                檢查並建立帳號
              </button>
            </form>
          </template>
        </div>
      </div>
    </template>
  </section>
</template>