<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { supabase } from '@/lib/supabaseClient'
import { currentUser } from '@/stores/authState'
import {
  permissionReady,
  permissionUserId,
  isSystemAdmin
} from '@/stores/permissionState'

/**
 * PTS 人員管理：建立員工帳號 + Phase 03-H2 停用／重新啟用。
 *
 * - 清單使用管理員專用的 pts_admin_users RPC。
 * - 建立帳號僅呼叫 pts-admin-create-employee Edge Function。
 * - 狀態操作先呼叫 pts_admin_employee_lifecycle_preview 唯讀預檢，
 *   確認操作原因後交由 pts-admin-employee-status Edge Function 執行。
 * - 後端再次驗證身分與權限；前端不接觸 service_role 金鑰。
 * - 一次性憑證只存在元件記憶體，離開或登出立即清除。
 * - H3C 永久刪除：先預檢、核對 Username、確認備份及不可逆風險，再呼叫 H3B Edge Function。
 */
const verifiedAdmin = computed(() => Boolean(
  currentUser.value?.id &&
  permissionReady.value &&
  isSystemAdmin.value &&
  permissionUserId.value === currentUser.value.id
))

// 僅管理員可修改顯示名稱；後端 RPC 再次驗證系統管理員身分。
const editingNameUser = ref(null)
const editingNameValue = ref('')
const nameSaving = ref(false)
const nameError = ref('')
const nameNotice = ref('')
let nameEditVersion = 0

function closeNameEditor() {
  nameEditVersion += 1
  editingNameUser.value = null
  editingNameValue.value = ''
  nameError.value = ''
}

function openNameEditor(user) {
  if (!verifiedAdmin.value || nameSaving.value || !user?.user_id) return
  editingNameUser.value = { user_id: user.user_id, username: user.username }
  editingNameValue.value = user.display_name || ''
  nameError.value = ''
  nameNotice.value = ''
}

async function saveDisplayName() {
  if (!verifiedAdmin.value || nameSaving.value || !editingNameUser.value) return
  const name = editingNameValue.value.trim()
  if (!name || name.length > 120) {
    nameError.value = '顯示名稱須為 1～120 個字元。'
    return
  }
  const target = { ...editingNameUser.value }
  const ownerId = currentUser.value?.id
  const version = ++nameEditVersion
  nameSaving.value = true
  nameError.value = ''
  try {
    const { data, error } = await supabase.rpc('pts_admin_update_display_name', {
      p_target_user_id: target.user_id,
      p_display_name: name
    })
    if (error) throw error
    if (version !== nameEditVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    if (data !== name) throw new Error('更新結果不符合預期')
    users.value = users.value.map(user => user.user_id === target.user_id ? { ...user, display_name: name } : user)
    editingNameUser.value = null
    editingNameValue.value = ''
    nameNotice.value = `@${target.username} 的顯示名稱已更新為「${name}」。`
  } catch (error) {
    if (version !== nameEditVersion || currentUser.value?.id !== ownerId) return
    nameError.value = '名稱更新失敗，請確認已套用最新 SQL migration，或稍後重試。'
    if (import.meta.env.DEV) console.warn('[PTS 人員管理] 修改顯示名稱失敗：', error?.message)
  } finally {
    if (version === nameEditVersion) nameSaving.value = false
  }
}

const users = ref([])
const usersLoading = ref(false)
const usersError = ref('')
const pendingIds = ref([]) // 只由管理員專用 RPC 提供，避免把已停用員工誤認為待首次設定
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
// 一次性憑證通知範本只在瀏覽器記憶體中組合，不存入資料庫。
// 正式部署的 Vite base 為 /shopify-erp-inventory-checker/。
const PTS_LOGIN_URL = 'https://jonyworker.github.io/shopify-erp-inventory-checker/'
const showEmailDraft = ref(false)
const copiedEmailDraft = ref(false)
const emailCopyMessage = ref('')

// Phase 03-H2：狀態管理採「預檢 → 原因及確認 → 執行」兩階段。
const statusAction = ref(null)
const statusPanelRef = ref(null)
const statusPreview = ref(null)
const statusReason = ref('')
const statusAcknowledged = ref(false)
const statusPreviewLoading = ref(false)
const statusSubmitting = ref(false)
const statusError = ref('')
const statusNotice = ref('')
// 待首次設定帳號：重新核發憑證，而不是停用／重新啟用／永久刪除。
const reissueAction = ref(null)
const reissuePanelRef = ref(null)
const reissueReason = ref('')
const reissueUsername = ref('')
const reissueAcknowledged = ref(false)
const reissueSubmitting = ref(false)
const reissueError = ref('')
const reissueNotice = ref('')
const isPendingUser = user => Boolean(user?.user_id && pendingIds.value.includes(user.user_id))
const canSubmitReissue = computed(() => Boolean(
  verifiedAdmin.value && reissueAction.value && !reissueSubmitting.value &&
  !creatingAccount.value && !statusSubmitting.value && !deleteSubmitting.value &&
  !createdAccount.value && reissueUsername.value === reissueAction.value.username &&
  reissueReason.value.trim().length >= 1 && reissueReason.value.trim().length <= 500 &&
  reissueAcknowledged.value && pendingIds.value.includes(reissueAction.value.user_id)
))

const canSubmitStatus = computed(() => {
  const entry = statusAction.value
  const preview = statusPreview.value
  if (!entry || !preview || !verifiedAdmin.value || statusPreviewLoading.value || statusSubmitting.value) return false
  const permitted = entry.action === 'deactivate' ? preview.can_deactivate === true : preview.can_reactivate === true
  const length = statusReason.value.trim().length
  return permitted && statusAcknowledged.value && length >= 1 && length <= 500
})

// H3C：永久刪除必須獨立預檢，不依賴舊的員工清單狀態直接執行。
const deleteTarget = ref(null)
const deletePanelRef = ref(null)
const deletePreview = ref(null)
const deletePreviewLoading = ref(false)
const deleteReason = ref('')
const deleteUsername = ref('')
const deleteBackupConfirmed = ref(false)
const deleteAcknowledged = ref(false)
const deleteSubmitting = ref(false)
const deleteError = ref('')
const deleteNotice = ref('')
// 後端回覆不明確、但名單已移除目標時，顯示待核對訊息（不可宣告刪除成功）。
const deleteReviewNotice = ref('')
let deleteVersion = 0
const canSubmitDelete = computed(() => Boolean(
  verifiedAdmin.value && deleteTarget.value && deletePreview.value?.can_delete_after_archive === true &&
  deletePreview.value?.user_id === deleteTarget.value.user_id && !deleteTarget.value.is_active &&
  !deletePreviewLoading.value && !deleteSubmitting.value && !usersLoading.value &&
  deleteUsername.value === deleteTarget.value.username &&
  deleteReason.value.trim().length >= 1 && deleteReason.value.trim().length <= 500 &&
  deleteBackupConfirmed.value && deleteAcknowledged.value
))

let listVersion = 0
let createVersion = 0
let statusVersion = 0

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
    : parsed.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })
})
// Admin 更新員工清單後，若該員工已完成首次啟用，憑證立即從記憶體清除。
const createdAccountIsActive = computed(() => Boolean(
  createdAccount.value?.user_id &&
  users.value.some(user => user.user_id === createdAccount.value.user_id && user.is_active)
))
watch(createdAccountIsActive, (active) => {
  if (!active || !createdAccount.value?.temporary_password) return
  createdAccount.value = { ...createdAccount.value, temporary_password: '' }
  showSecret.value = false
  showEmailDraft.value = false
  copiedSecret.value = false
  copiedEmailDraft.value = false
  clipboardMessage.value = ''
  emailCopyMessage.value = ''
})

const onboardingEmailSubject = '【PTS Internal Tools】首次登入與密碼設定通知'
const onboardingEmailBody = computed(() => {
  const account = createdAccount.value
  if (!account?.temporary_password || createdAccountIsActive.value) return ''
  return [
    `${account.display_name || '同仁'} 您好：`,
    '',
    '已為您建立 PTS Internal Tools 帳號，請點擊以下連結開啟系統：',
    PTS_LOGIN_URL,
    '',
    '首次使用請在登入畫面點選「首次設定個人密碼」，並依照畫面輸入：',
    `Username：${account.username}`,
    `一次性憑證：${account.temporary_password}`,
    '',
    '接著設定您的個人密碼，即可完成帳號啟用。',
    '',
    `一次性憑證最晚使用期限：${expiryLabel.value}（台灣時間）`,
    '此憑證僅能使用一次；設定完成後即失效。往後請使用 Username 與您設定的密碼登入。',
    '',
    '若有任何問題，請聯絡系統管理員。',
    '',
    'PTS Internal Tools'
  ].join('\n')
})
const onboardingEmailFullText = computed(() =>
  `主旨：${onboardingEmailSubject}\n\n${onboardingEmailBody.value}`
)

function clearCredential() {
  // 此憑證不會寫入 localStorage、sessionStorage 或管理員共用狀態。
  createdAccount.value = null
  showSecret.value = false
  copiedSecret.value = false
  clipboardMessage.value = ''
  showEmailDraft.value = false
  copiedEmailDraft.value = false
  emailCopyMessage.value = ''
}

function clearForNewIdentity() {
  closeNameEditor()
  nameSaving.value = false
  nameNotice.value = '' 
  listVersion += 1
  createVersion += 1
  users.value = []
  pendingIds.value = []
  usersLoading.value = false
  usersError.value = ''
  updatedAt.value = null
  search.value = ''
  statusFilter.value = 'all'
  form.value = initialForm()
  reviewing.value = false
  creatingAccount.value = false
  createError.value = ''
  statusVersion += 1
  statusAction.value = null
  statusPreview.value = null
  statusReason.value = ''
  statusAcknowledged.value = false
  statusPreviewLoading.value = false
  statusSubmitting.value = false
  statusError.value = ''
  statusNotice.value = ''
  reissueAction.value = null
  reissueReason.value = ''
  reissueUsername.value = ''
  reissueAcknowledged.value = false
  reissueSubmitting.value = false
  reissueError.value = ''
  reissueNotice.value = ''
  deleteVersion += 1
  deleteTarget.value = null
  deletePreview.value = null
  deletePreviewLoading.value = false
  deleteReason.value = ''
  deleteUsername.value = ''
  deleteBackupConfirmed.value = false
  deleteAcknowledged.value = false
  deleteSubmitting.value = false
  deleteError.value = ''
  deleteNotice.value = ''
  deleteReviewNotice.value = ''
  clearCredential()
}

async function loadUsers() {
  if (!verifiedAdmin.value) return
  const version = ++listVersion
  const ownerId = currentUser.value.id
  usersLoading.value = true
  usersError.value = ''

  try {
    const [{ data, error }, pendingResult] = await Promise.all([
      supabase.rpc('pts_admin_users'),
      supabase.rpc('pts_admin_pending_onboarding_users')
    ])
    if (version !== listVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('人員清單資料格式不正確')
    // 僅將具備正式基本資料的 PTS 員工顯示於人員管理清單。
    // 開發初期的舊 Auth / app_profiles 資料仍保留在資料庫，
    // 不影響它們的會議紀錄、Storage 所有權或安全刪除檢查。
    users.value = data.filter(user =>
      typeof user.username === 'string' && user.username.trim().length > 0 &&
      typeof user.display_name === 'string' && user.display_name.trim().length > 0
    )
    if (pendingResult.error || !Array.isArray(pendingResult.data)) {
      // 待啟用清單讀取失敗時採 fail-closed，不顯示重新核發入口。
      pendingIds.value = []
      usersError.value = '無法確認哪些帳號仍待首次設定，重新核發功能暫停。請更新清單後再試。'
    } else {
      pendingIds.value = pendingResult.data.map(row => row.user_id)
    }
    updatedAt.value = new Date()
    return true
  } catch (error) {
    if (version !== listVersion || currentUser.value?.id !== ownerId) return
    pendingIds.value = []
    usersError.value = '無法讀取人員資料，請稍後重新整理。'
    if (import.meta.env.DEV) console.warn('[PTS 人員管理] 讀取帳號清單失敗：', error?.message)
    return false
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
    showEmailDraft.value = false
    copiedEmailDraft.value = false
    emailCopyMessage.value = ''
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
  if (!verifiedAdmin.value || createdAccountIsActive.value || !createdAccount.value?.temporary_password) return
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

async function copyOnboardingEmail() {
  if (!verifiedAdmin.value || createdAccountIsActive.value || !onboardingEmailBody.value) return
  emailCopyMessage.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(onboardingEmailFullText.value)
    copiedEmailDraft.value = true
    emailCopyMessage.value = '已複製信件全文（包含真正的一次性憑證）。請只透過公司核准的管道寄送給正確的員工。'
  } catch {
    showEmailDraft.value = true
    emailCopyMessage.value = '無法自動複製，請在展開的範本中手動選取內容。'
  }
}

function closeCredential() {
  if (!createdAccount.value) return
  if (!window.confirm('確定關閉這組一次性憑證？關閉後無法再次取得原始憑證；如遺失可由管理員重新核發新憑證。')) return
  clearCredential()
  createError.value = ''
}

function closeReissueAction() {
  if (reissueSubmitting.value) return
  reissueAction.value = null
  reissueReason.value = ''
  reissueUsername.value = ''
  reissueAcknowledged.value = false
  reissueError.value = ''
}

function openReissueAction(user) {
  if (!verifiedAdmin.value || !isPendingUser(user) || createdAccount.value || usersLoading.value ||
      creatingAccount.value || statusSubmitting.value || deleteSubmitting.value || reissueSubmitting.value) return
  closeStatusAction()
  closeDeleteAction()
  reissueAction.value = { user_id: user.user_id, username: user.username, display_name: user.display_name }
  reissueReason.value = ''
  reissueUsername.value = ''
  reissueAcknowledged.value = false
  reissueError.value = ''
  reissueNotice.value = ''
  void nextTick(() => reissuePanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}

async function submitReissue() {
  if (!canSubmitReissue.value) return
  const target = { ...reissueAction.value }
  const ownerId = currentUser.value?.id
  reissueSubmitting.value = true
  reissueError.value = ''
  reissueNotice.value = ''
  try {
    const { data, error } = await supabase.functions.invoke('pts-admin-reissue-onboarding', {
      body: { user_id: target.user_id, confirm_username: reissueUsername.value, reason: reissueReason.value.trim() }
    })
    if (error) throw error
    if (data?.success !== true || data.user_id !== target.user_id ||
        data.username !== target.username || !data.temporary_password ||
        typeof data.temporary_password_expires_at !== 'string') {
      throw new Error('Credential reissue result uncertain')
    }
    if (!verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    createdAccount.value = {
      user_id: data.user_id, username: data.username, display_name: data.display_name,
      email: data.email || '', temporary_password: data.temporary_password,
      temporary_password_expires_at: data.temporary_password_expires_at,
      reissued: true
    }
    showSecret.value = false
    copiedSecret.value = false
    showEmailDraft.value = false
    copiedEmailDraft.value = false
    emailCopyMessage.value = ''
    reissueSubmitting.value = false
    closeReissueAction()
    reissueNotice.value = `已重新核發 @${target.username} 的一次性憑證。舊憑證立即失效，請立即保存新憑證或複製通知 Email。`
    await loadUsers()
  } catch (error) {
    if (!verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    reissueError.value = '無法確認是否已核發新憑證。請先檢查帳號狀態及通知，勿立即連續重試。'
    if (import.meta.env.DEV) console.warn('[PTS 人員管理] 重新核發未確認：', error?.message)
  } finally {
    reissueSubmitting.value = false
  }
}

// 關閉狀態操作面板；執行中不可中斷確認（後端作業仍可能已提交）。
function closeStatusAction() {
  if (statusSubmitting.value) return
  statusVersion += 1
  statusAction.value = null
  statusPreview.value = null
  statusReason.value = ''
  statusAcknowledged.value = false
  statusPreviewLoading.value = false
  statusError.value = ''
}

async function openStatusAction(user) {
  if (!verifiedAdmin.value || !user?.user_id || user.user_id === currentUser.value?.id ||
    user.is_system_admin || creatingAccount.value || usersLoading.value || statusSubmitting.value || deleteSubmitting.value) return
  closeDeleteAction()
  closeReissueAction()

  const action = user.is_active ? 'deactivate' : 'reactivate'
  const ownerId = currentUser.value.id
  const version = ++statusVersion
  statusAction.value = {
    user_id: user.user_id,
    username: user.username,
    display_name: user.display_name,
    action
  }
  statusPreview.value = null
  statusReason.value = ''
  statusAcknowledged.value = false
  statusError.value = ''
  statusNotice.value = ''
  statusPreviewLoading.value = true
  void nextTick(() => {
    if (version === statusVersion) {
      statusPanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  })

  try {
    // H1 安全預檢是唯讀，後端 H2 執行時仍會再次驗證。
    const { data, error } = await supabase.rpc('pts_admin_employee_lifecycle_preview', {
      p_target_user_id: user.user_id
    })
    if (version !== statusVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    if (error || !data || typeof data !== 'object' || data.user_id !== user.user_id) {
      throw error || new Error('預檢資料格式不正確')
    }
    statusPreview.value = data
    const permitted = action === 'deactivate' ? data.can_deactivate === true : data.can_reactivate === true
    if (!permitted) {
      statusError.value = action === 'reactivate' && data.must_change_password
        ? '此帳號尚未完成首次密碼設定，不能透過「重新啟用」跳過首次設定程序。'
        : '此帳號目前不符合操作條件，或受到系統管理員／Superuser 保護。'
    }
  } catch (error) {
    if (version !== statusVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    statusError.value = '無法確認員工帳號狀態，請更新人員清單後再試。'
    if (import.meta.env.DEV) console.warn('[PTS 人員管理] 狀態預檢失敗：', error?.code || error?.message)
  } finally {
    if (version === statusVersion) statusPreviewLoading.value = false
  }
}

// 只採納已知的後端安全錯誤；網路故障與不確定的結果必須重新核對狀態。
async function resolveStatusError(error) {
  const status = error?.context?.status
  if (status === 401) return '管理員登入已失效，請重新登入。'
  if (status === 403) return '目前帳號沒有執行此操作的資格。'
  if (status === 404) return '找不到這位員工，請更新清單。'
  if (status === 409) return '帳號狀態已變更或正在處理其他操作，請稍後重新整理。'
  if (status === 429) return '操作過於頻繁，請稍後再試。'

  try {
    if (error?.context?.clone) {
      const response = await error.context.clone().json()
      const approved = new Set([
        '僅系統管理員可執行員工帳號管理',
        '不能操作自己的帳號',
        '不可操作此帳號（可能為管理員或尚未啟用的員工）',
        '員工狀態不符合此次操作，請重新整理',
        '此帳號正在處理其他操作，請稍候再試',
        '找不到員工帳號',
        'PTS 資料權限已停用，但 Auth 封鎖尚未完成，請稍後重試「停用」',
        'Auth 解除封鎖失敗，員工仍為停用狀態',
        'Auth 帳號狀態驗證失敗，PTS 帳號仍維持停用，請聯絡管理員',
        '狀態更新尚未完整完成，PTS 存取仍被停用，請稍後重試或聯絡管理員',
        '無法開始員工帳號操作，請稍後再試',
        '無法驗證管理員身分',
        '員工帳號管理服務暫時無法使用'
      ])
      if (approved.has(response?.error)) return response.error
    }
  } catch { /* 非 JSON 或網路中斷，請勿使用不可信的訊息。 */ }
  return '未能確認帳號操作結果，請更新人員清單核對實際狀態，勿立即重複執行。'
}

async function submitStatusChange() {
  if (!canSubmitStatus.value) return
  const ownerId = currentUser.value?.id
  const version = statusVersion
  const target = statusAction.value
  const payload = {
    user_id: target.user_id,
    action: target.action,
    reason: statusReason.value.trim()
  }
  statusSubmitting.value = true
  statusError.value = ''
  statusNotice.value = ''
  try {
    const { data, error } = await supabase.functions.invoke('pts-admin-employee-status', {
      body: payload
    })
    if (error) throw error
    if (!data || data.success !== true || data.user_id !== payload.user_id ||
      data.action !== payload.action || data.is_active !== (payload.action === 'reactivate')) {
      throw new Error('伺服器回覆的帳號狀態無法確認')
    }
    if (version !== statusVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return

    const name = target.display_name || `@${target.username}`
    statusAction.value = null
    statusPreview.value = null
    statusReason.value = ''
    statusAcknowledged.value = false
    const refreshed = await loadUsers()
    if (version !== statusVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    statusNotice.value = payload.action === 'deactivate'
      ? `已停用「${name}」；員工無法再登入或存取受保護的 PTS 資料。`
      : `已重新啟用「${name}」；請員工重新登入，取得新的登入憑證。`
    if (!refreshed) statusNotice.value += ' 人員清單更新失敗，請稍後再手動更新。'
  } catch (error) {
    if (version !== statusVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    statusError.value = await resolveStatusError(error)
    if (version !== statusVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    // Edge Function 可能已部分完成；先重新讀取，禁止沿用過期的預檢結果重試。
    statusPreview.value = null
    statusAcknowledged.value = false
    await loadUsers()
    if (import.meta.env.DEV) console.warn('[PTS 人員管理] 員工狀態操作未確認：', error?.message)
  } finally {
    if (version === statusVersion) statusSubmitting.value = false
  }
}

function closeDeleteAction() {
  if (deleteSubmitting.value) return
  deleteVersion += 1
  deleteTarget.value = null
  deletePreview.value = null
  deletePreviewLoading.value = false
  deleteReason.value = ''
  deleteUsername.value = ''
  deleteBackupConfirmed.value = false
  deleteAcknowledged.value = false
  deleteError.value = ''
}

async function openDeleteAction(user) {
  if (!verifiedAdmin.value || !user?.user_id || !user.username || !user.display_name ||
    user.is_active || user.is_system_admin || user.user_id === currentUser.value?.id ||
    usersLoading.value || creatingAccount.value || statusSubmitting.value || deleteSubmitting.value ||
    !!createdAccount.value) return
  closeStatusAction()
  closeReissueAction()
  const version = ++deleteVersion
  const ownerId = currentUser.value.id
  deleteTarget.value = { ...user }
  deletePreview.value = null
  deletePreviewLoading.value = true
  deleteReason.value = ''
  deleteUsername.value = ''
  deleteBackupConfirmed.value = false
  deleteAcknowledged.value = false
  deleteError.value = ''
  deleteNotice.value = ''
  deleteReviewNotice.value = ''
  void nextTick(() => { if (version === deleteVersion) deletePanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) })
  try {
    const { data, error } = await supabase.rpc('pts_admin_employee_delete_preview', { p_target_user_id: user.user_id })
    if (version !== deleteVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    if (error || !data || typeof data !== 'object' || data.user_id !== user.user_id) throw error || new Error('預檢結果不正確')
    deletePreview.value = data
    if (data.can_delete_after_archive !== true) deleteError.value = '目前尚不符合永久刪除條件，請勿強制刪除。'
  } catch (error) {
    if (version !== deleteVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    deleteError.value = '無法完成永久刪除的安全預檢，請重新讀取清單再試。'
    if (import.meta.env.DEV) console.warn('[PTS 人員管理] 永久刪除預檢失敗', error?.code || error?.message)
  } finally { if (version === deleteVersion) deletePreviewLoading.value = false }
}

async function submitDelete() {
  if (!canSubmitDelete.value) return
  const version = deleteVersion
  const ownerId = currentUser.value.id
  const target = { ...deleteTarget.value }
  deleteSubmitting.value = true
  deleteError.value = ''
  deleteNotice.value = ''
  deleteReviewNotice.value = ''
  try {
    const { data, error } = await supabase.functions.invoke('pts-admin-delete-employee', {
      body: {
        user_id: target.user_id,
        confirm_username: deleteUsername.value,
        reason: deleteReason.value.trim(),
        confirm_permanent_delete: true
      }
    })
    if (error) throw error
    if (!data || data.success !== true || typeof data.archive_id !== 'string' || data.username !== target.username) {
      throw new Error('永久刪除回傳無法確認')
    }
    if (version !== deleteVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return

    // Edge Function 已明確回報刪除及封存成功，才可收起表單。
    // closeDeleteAction() 會防止「送出中」手動關閉，因此先結束送出狀態。
    deleteSubmitting.value = false
    closeDeleteAction()
    // 即使重新讀取名單失敗，也不能讓已確認刪除的帳號殘留在本地清單。
    users.value = users.value.filter(user => user.user_id !== target.user_id)
    const refreshed = await loadUsers()
    if (!verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    deleteNotice.value = `已永久刪除 @${target.username}，並保存稽核封存紀錄。${refreshed ? '' : ' 清單更新失敗，請手動刷新。'}`
  } catch (error) {
    if (version !== deleteVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return
    // 網路中斷、回覆不完整或刪除流程部分成功時，先重新讀取清單，不可盲目重試。
    deletePreview.value = null
    deleteAcknowledged.value = false
    deleteBackupConfirmed.value = false
    const refreshed = await loadUsers()
    if (version !== deleteVersion || !verifiedAdmin.value || currentUser.value?.id !== ownerId) return

    if (refreshed && !users.value.some(user => user.user_id === target.user_id)) {
      // 只有「名單已移除」的證據，無法直接證明 Auth 刪除和稽核封存均完成。
      // 收起已失效的表單，但用待確認訊息要求管理員核對後端結果。
      deleteSubmitting.value = false
      closeDeleteAction()
      deleteReviewNotice.value = `@${target.username} 已不在人員清單中，但伺服器未回傳完整的刪除成功確認。請至 Supabase 核對 Auth 帳號及稽核封存紀錄，勿重複執行刪除。`
    } else {
      deleteError.value = '刪除結果尚無法確認。請勿再次點擊！請管理員檢查 Auth 帳號及封存狀態後再處理。'
    }
    if (import.meta.env.DEV) console.warn('[PTS 人員管理] 刪除狀態未確認', error?.message)
  } finally { if (version === deleteVersion) deleteSubmitting.value = false }
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
    if (!nameSaving.value) closeNameEditor()
    // 登入權限重新檢查時，不保留尚未送出的帳號狀態操作。
    if (!statusSubmitting.value) closeStatusAction()
    if (!deleteSubmitting.value) closeDeleteAction()
    if (!reissueSubmitting.value) closeReissueAction()
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
        <p class="mt-2 text-sm leading-6 text-slate-500">建立員工帳號、修改顯示名稱、重新核發首次憑證，管理啟用狀態與安全永久刪除。</p>
      </div>
      <button
        type="button"
        class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!verifiedAdmin || usersLoading || creatingAccount || statusSubmitting || deleteSubmitting || reissueSubmitting"
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
          <p class="text-xs text-slate-500">未啟用／已停用</p>
          <p class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{{ inactiveCount }}</p>
        </div>
      </div>

      <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div class="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold text-slate-900">帳號清單</h2>
              <p class="mt-1 text-xs text-slate-500">從 Supabase 讀取已設定 Username 與姓名的 PTS 帳號，不包含密碼。</p>
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
              <option value="inactive">未啟用／已停用</option>
            </select>
          </div>

          <p v-if="reissueNotice" role="status" class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-800">{{ reissueNotice }}</p>
          <p v-if="deleteNotice" role="status" class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-800">{{ deleteNotice }}</p>
          <p v-if="deleteReviewNotice" role="alert" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">{{ deleteReviewNotice }}</p>
          <p v-if="statusNotice" role="status" class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-800">
            {{ statusNotice }}
          </p>
          <p v-if="nameNotice" role="status" class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{{ nameNotice }}</p>
          <p v-if="usersError" role="alert" class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {{ usersError }}
          </p>
          <div v-if="usersLoading && !users.length" class="rounded-lg border border-slate-200 p-8 text-center text-sm text-slate-500">
            讀取帳號清單中…
          </div>
          <div v-else-if="!filteredUsers.length" class="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
            {{ users.length ? '沒有符合搜尋條件的帳號。' : '尚未載入帳號，或目前沒有帳號。' }}
          </div>
          <!--
            Phase 03-H2 UI：帳號狀態緊鄰姓名，操作放在最右側。
            系統管理員只顯示小型鎖頭，不顯示操作按鈕。
            未建妥 Username 或姓名的歷史帳號會在載入階段排除，不在清單顯示。
          -->
          <ul v-else class="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            <li v-for="user in filteredUsers" :key="user.user_id" class="px-4 py-3.5 sm:px-5">
              <div class="flex min-w-0 items-center justify-between gap-3">
                <!-- 主資訊：狀態在姓名前，管理員鎖頭緊鄰姓名；Username 固定在下方。 -->
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      class="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
                      :class="user.is_active
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'"
                    >
                      <span class="size-1.5 rounded-full" :class="user.is_active ? 'bg-emerald-500' : 'bg-slate-400'"></span>
                      {{ user.is_active ? '已啟用' : isPendingUser(user) ? '待首次設定' : '未啟用' }}
                    </span>
                    <span
                      v-if="user.is_system_admin"
                      class="inline-flex size-4 shrink-0 items-center justify-center text-slate-500"
                      title="系統管理員：不開放停用或刪除"
                      role="img"
                      aria-label="系統管理員，帳號受保護"
                    >
                      <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="5" y="10" width="14" height="11" rx="2" />
                        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                      </svg>
                    </span>
                    <span class="min-w-0 break-words text-sm font-semibold leading-6 text-slate-900">
                      {{ user.display_name || '未設定姓名' }}
                    </span>
                  </div>
                  <p class="mt-0.5 break-all text-xs leading-5 text-slate-500">
                    {{ user.username ? `@${user.username}` : '尚未設定 Username' }}
                  </p>
                </div>

                <button type="button"
                  class="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="!verifiedAdmin || nameSaving || usersLoading || creatingAccount || statusSubmitting || deleteSubmitting || reissueSubmitting || !!createdAccount"
                  @click="openNameEditor(user)">修改名稱</button>

                <!-- 日常操作與永久刪除入口分離；刪除需額外預檢與確認。 -->
                <div v-if="!user.is_system_admin && user.user_id !== currentUser?.id && user.username && user.display_name"
                     class="flex shrink-0 flex-wrap justify-end gap-2">
                  <button v-if="isPendingUser(user)" type="button"
                    class="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="usersLoading || creatingAccount || statusSubmitting || deleteSubmitting || reissueSubmitting || !!createdAccount"
                    @click="openReissueAction(user)">重新核發憑證</button>
                  <button v-else type="button"
                    class="rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
                    :class="user.is_active
                      ? 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'"
                    :disabled="usersLoading || creatingAccount || statusSubmitting || statusPreviewLoading || deleteSubmitting || deletePreviewLoading || !!createdAccount"
                    @click="openStatusAction(user)">
                    {{ user.is_active ? '停用帳號' : '重新啟用' }}
                  </button>
                  <button v-if="!user.is_active && !isPendingUser(user)" type="button"
                    class="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="usersLoading || creatingAccount || statusSubmitting || statusPreviewLoading || deleteSubmitting || deletePreviewLoading || !!createdAccount"
                    @click="openDeleteAction(user)">永久刪除</button>
                </div>
                <button
                  v-else-if="!user.is_system_admin && (!user.username || !user.display_name)"
                  type="button"
                  class="shrink-0 cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-400"
                  disabled
                  title="基本資料不完整，請先確認來源"
                >
                  不可操作
                </button>
              </div>

              <form v-if="editingNameUser?.user_id === user.user_id" class="mt-3 space-y-2 rounded-lg bg-slate-50 p-3" @submit.prevent="saveDisplayName">
                <label :for="`pts-name-${user.user_id}`" class="block text-xs font-semibold text-slate-700">編輯顯示名稱（不更改 Username）</label>
                <input :id="`pts-name-${user.user_id}`" v-model="editingNameValue" type="text" maxlength="120"
                  autocomplete="off" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                  :disabled="nameSaving" />
                <p v-if="nameError" role="alert" class="text-xs text-rose-700">{{ nameError }}</p>
                <div class="flex justify-end gap-2">
                  <button type="button" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600" :disabled="nameSaving" @click="closeNameEditor">取消</button>
                  <button type="submit" class="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-40"
                    :disabled="nameSaving || !editingNameValue.trim() || editingNameValue.trim() === user.display_name">{{ nameSaving ? '儲存中…' : '儲存名稱' }}</button>
                </div>
              </form>

              <!-- 歷史異常帳號不可按「重新啟用」；不要猜測其真實帳號用途。 -->
              <p v-if="!user.username || !user.display_name" class="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                <span class="font-medium text-slate-700">資料待確認：</span>
                此帳號缺少基本資料，請先確認來源，暫不提供狀態操作。
              </p>
            </li>
          </ul>
          <div v-if="reissueAction" ref="reissuePanelRef" class="space-y-4 rounded-xl border border-amber-200 bg-white p-4" aria-live="polite">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-slate-900">重新核發一次性憑證</p>
                <p class="mt-1 text-xs text-slate-600">{{ reissueAction.display_name }}（@{{ reissueAction.username }}）</p>
              </div>
              <button type="button" :disabled="reissueSubmitting" class="text-xs text-slate-500 hover:underline disabled:opacity-40" @click="closeReissueAction">取消</button>
            </div>
            <p class="text-xs leading-6 text-amber-900">核發新憑證後，舊憑證立即失效，新憑證只顯示一次，必須交由員工完成首次密碼設定；此操作不會變更登入密碼或直接啟用員工。</p>
            <div>
              <label for="pts-reissue-username" class="block text-xs font-semibold text-slate-700">請輸入完整 Username：{{ reissueAction.username }}</label>
              <input id="pts-reissue-username" v-model="reissueUsername" :disabled="reissueSubmitting" autocomplete="off" spellcheck="false" placeholder="確認完整 Username"
                class="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400" />
            </div>
            <div>
              <label for="pts-reissue-reason" class="block text-xs font-semibold text-slate-700">核發原因 *</label>
              <textarea id="pts-reissue-reason" v-model="reissueReason" :disabled="reissueSubmitting" maxlength="500" rows="2"
                placeholder="例如：原一次性憑證未保存，重新核發" class="mt-1.5 w-full resize-y rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-slate-400"></textarea>
            </div>
            <label class="flex items-start gap-2 text-xs leading-6 text-slate-700">
              <input v-model="reissueAcknowledged" :disabled="reissueSubmitting" type="checkbox" class="mt-1" />
              我確認員工身分，了解舊憑證將立即失效，並會安全保存新憑證。
            </label>
            <p v-if="reissueError" role="alert" class="rounded-lg bg-rose-50 p-3 text-xs leading-6 text-rose-800">{{ reissueError }}</p>
            <div class="flex flex-wrap gap-2">
              <button type="button" :disabled="!canSubmitReissue" @click="submitReissue"
                class="rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed"
                :class="canSubmitReissue ? 'bg-amber-700 text-white hover:bg-amber-800' : 'border border-slate-200 bg-slate-100 text-slate-500'">
                {{ reissueSubmitting ? '核發中…' : '確認重新核發憑證' }}
              </button>
              <button type="button" :disabled="reissueSubmitting" class="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600" @click="closeReissueAction">返回</button>
            </div>
          </div>
          <div v-if="deleteTarget" ref="deletePanelRef" class="space-y-4 rounded-xl border border-rose-200 bg-white p-4" aria-live="polite">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-rose-800">永久刪除員工帳號</p>
                <p class="mt-1 text-xs text-slate-600">{{ deleteTarget.display_name }}（@{{ deleteTarget.username }}）</p>
              </div>
              <button type="button" class="text-xs text-slate-500 hover:underline disabled:opacity-40" :disabled="deleteSubmitting" @click="closeDeleteAction">取消</button>
            </div>
            <p class="text-xs leading-6 text-rose-700">永久刪除將移除 Supabase Auth 登入帳號與權限設定，無法還原。必要的稽核快照仍會保留。</p>
            <p v-if="deletePreviewLoading" class="text-xs text-slate-600">正在執行安全預檢…</p>
            <template v-else>
              <p v-if="deleteError" role="alert" class="rounded-lg bg-rose-50 p-3 text-xs leading-6 text-rose-700">{{ deleteError }}</p>
              <div v-if="deletePreview" class="rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600">
                <p class="font-medium text-slate-800">刪除前檢查：{{ deletePreview.can_delete_after_archive ? '暫時符合前置條件' : '不允許刪除' }}</p>
                <p>需封存稽核：{{ deletePreview.audit_count ?? '未提供' }} 筆；部門：{{ deletePreview.department_count ?? '未提供' }} 個</p>
                <p>會議：{{ deletePreview.meeting_count ?? '未提供' }} 筆；Storage 檔案：{{ deletePreview.storage_owned_count ?? '未提供' }} 個；Session：{{ deletePreview.session_count ?? '未提供' }} 個</p>
                <p v-for="blocker in (deletePreview.delete_blockers || [])" :key="blocker" class="text-rose-700">{{ blocker }}</p>
              </div>
              <template v-if="deletePreview?.can_delete_after_archive === true">
                <div>
                  <label for="pts-delete-username" class="block text-xs font-semibold text-slate-700">請輸入完整 Username：<strong class="text-slate-900">{{ deleteTarget.username }}</strong></label>
                  <input id="pts-delete-username" v-model="deleteUsername" type="text" spellcheck="false" autocomplete="off" :disabled="deleteSubmitting" placeholder="請輸入完整 Username"
                    class="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50" />
                </div>
                <div>
                  <label for="pts-delete-reason" class="block text-xs font-semibold text-slate-700">永久刪除原因 <span class="text-rose-600">*</span></label>
                  <textarea id="pts-delete-reason" v-model="deleteReason" rows="3" maxlength="500" :disabled="deleteSubmitting"
                    placeholder="例如：測試帳號清理，確認無需保留登入帳號" class="mt-1.5 w-full resize-y rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"></textarea>
                  <p class="mt-1 text-right text-[11px] text-slate-400">{{ deleteReason.trim().length }} / 500</p>
                </div>
                <label class="flex items-start gap-2 text-xs leading-6 text-slate-700">
                  <input v-model="deleteBackupConfirmed" type="checkbox" class="mt-1.5 size-4 shrink-0 accent-slate-900" :disabled="deleteSubmitting" />
                  <span>已確認公司備份與封存需求，並確認刪除目標正確。</span>
                </label>
                <label class="flex items-start gap-2 text-xs leading-6 text-rose-800">
                  <input v-model="deleteAcknowledged" type="checkbox" class="mt-1.5 size-4 shrink-0 accent-rose-700" :disabled="deleteSubmitting" />
                  <span>我了解這是永久刪除，不能透過「重新啟用」恢復帳號。</span>
                </label>
                <div class="flex flex-wrap gap-2">
                  <!-- 未通過驗證時使用清晰的灰底深字，不套用透明度；通過後才顯示紅色危險操作。 -->
                  <button
                    type="button"
                    class="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors"
                    :class="canSubmitDelete
                      ? 'bg-rose-700 text-white hover:bg-rose-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700'
                      : 'cursor-not-allowed border border-slate-300 bg-slate-100 text-slate-600'"
                    :disabled="!canSubmitDelete"
                    @click="submitDelete"
                  >{{ deleteSubmitting ? '刪除處理中…' : '確認永久刪除帳號' }}</button>
                  <button type="button" class="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-700 disabled:opacity-40" :disabled="deleteSubmitting" @click="closeDeleteAction">返回</button>
                </div>
              </template>
            </template>
          </div>
          <div v-if="statusAction" ref="statusPanelRef" class="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4" aria-live="polite">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-slate-900">
                  {{ statusAction.action === 'deactivate' ? '確認停用員工' : '確認重新啟用員工' }}
                </p>
                <p class="mt-1 text-xs leading-5 text-slate-600">
                  {{ statusAction.display_name || '未設定姓名' }}（@{{ statusAction.username }}）
                </p>
              </div>
              <button type="button" class="text-xs text-slate-500 underline-offset-2 hover:underline disabled:opacity-40"
                      :disabled="statusSubmitting" @click="closeStatusAction">取消</button>
            </div>

            <p v-if="statusPreviewLoading" class="text-xs leading-6 text-slate-600">正在檢查帳號狀態與操作資格…</p>
            <template v-else>
              <p v-if="statusError" role="alert" class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-6 text-rose-700">{{ statusError }}</p>
              <template v-if="statusPreview && (statusAction.action === 'deactivate' ? statusPreview.can_deactivate : statusPreview.can_reactivate)">
                <p class="text-xs leading-6 text-slate-600">
                  {{ statusAction.action === 'deactivate'
                    ? '停用後員工將無法登入，已取得的舊憑證也無法繼續存取受保護資料。部門及歷史紀錄會保留。'
                    : '重新啟用後員工可使用原密碼登入，但必須重新登入以取得新的登入憑證。' }}
                </p>
                <div>
                  <label for="pts-employee-status-reason" class="block text-xs font-semibold text-slate-700">操作原因 <span class="text-rose-600">*</span></label>
                  <textarea
                    id="pts-employee-status-reason"
                    v-model="statusReason"
                    rows="3"
                    maxlength="500"
                    :disabled="statusSubmitting"
                    placeholder="例如：測試權限停用流程／員工恢復工作權限"
                    class="mt-1.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 disabled:bg-slate-100"
                  ></textarea>
                  <p class="mt-1 text-right text-[11px] text-slate-400">{{ statusReason.trim().length }} / 500</p>
                </div>
                <label class="flex cursor-pointer items-start gap-2 text-xs leading-6 text-slate-600">
                  <input v-model="statusAcknowledged" type="checkbox" :disabled="statusSubmitting"
                         class="mt-1.5 size-4 shrink-0 accent-slate-900" />
                  <span>我已確認員工身分及操作原因，了解本次操作將變更帳號登入與資料存取狀態。</span>
                </label>
                <div class="flex flex-wrap gap-2">
                  <!-- H3C UI 修正：停用中保持灰底深字，避免白字配合 opacity 造成按鈕幾乎不可見。 -->
                  <button
                    type="button"
                    class="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors"
                    :class="canSubmitStatus
                      ? (statusAction.action === 'deactivate'
                          ? 'bg-rose-700 text-white hover:bg-rose-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700'
                          : 'bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700')
                      : 'cursor-not-allowed border border-slate-300 bg-slate-100 text-slate-600'"
                    :disabled="!canSubmitStatus"
                    @click="submitStatusChange"
                  >
                    {{ statusSubmitting ? '處理中…' : (statusAction.action === 'deactivate' ? '確認停用帳號' : '確認重新啟用') }}
                  </button>
                  <button type="button" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-700 disabled:opacity-40"
                          :disabled="statusSubmitting" @click="closeStatusAction">返回</button>
                </div>
              </template>
            </template>
          </div>
          <p class="text-xs leading-5 text-slate-400">「未啟用」可能是待首次設定或已停用帳號，必須通過預檢才能重新啟用。管理員及 Superuser 帳號不開放此處操作；永久刪除需額外安全預檢並輸入 Username 確認。</p>
        </div>

        <div class="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <template v-if="createdAccount">
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-base font-semibold text-slate-900">{{ createdAccount.reissued ? '一次性憑證已重新核發' : '帳號已建立' }}</h2>
              <span class="rounded-md px-2 py-1 text-xs font-semibold"
                    :class="createdAccountIsActive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'">
                {{ createdAccountIsActive ? '已啟用' : '待首次設定' }}
              </span>
            </div>
            <p class="mt-3 text-sm leading-6 text-slate-600">
              {{ createdAccount.reissued ? '已為' : '已建立' }} <strong class="text-slate-900">{{ createdAccount.display_name }}</strong>
              （@{{ createdAccount.username }}），{{ createdAccountIsActive ? '已完成首次密碼設定，可使用個人密碼登入。' : '目前仍禁止登入與操作工具。' }}
            </p>
            <div v-if="createdAccountIsActive" class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs leading-6 text-emerald-800">
              員工已完成首次設定。一次性憑證已失效，系統不再顯示或提供複製。
            </div>
            <div v-else class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
              <strong>重要：一次性憑證僅顯示這一次。</strong>
              離開頁面、重新整理或關閉此區塊後就無法再取得。
              請員工從登入畫面選擇「首次設定個人密碼」，輸入 Username、一次性憑證及新密碼完成啟用。
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
              <div v-if="!createdAccountIsActive">
                <dt class="text-xs text-slate-500">一次性憑證最晚使用期限（台灣時間）</dt>
                <dd class="text-slate-700">{{ expiryLabel }}</dd>
              </div>
            </dl>
            <label v-if="!createdAccountIsActive" for="employee-first-password" class="mt-4 block text-xs font-medium text-slate-700">一次性憑證</label>
            <div v-if="!createdAccountIsActive" class="mt-2 flex flex-wrap gap-2">
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
            <p v-if="clipboardMessage && !createdAccountIsActive" role="status" class="mt-2 text-xs leading-5 text-slate-500">{{ clipboardMessage }}</p>
            <p v-if="!createdAccountIsActive" class="mt-3 text-xs leading-5 text-slate-500">請以公司核准的私密管道交付一次性憑證，避免貼在公開群組或納入長期文件。</p>

            <!-- 一次性憑證專用 Email 範本：僅在尚未完成首次啟用時可檢視／複製。 -->
            <div v-if="!createdAccountIsActive" class="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="text-sm font-semibold text-slate-900">員工啟用通知 Email 範本</h3>
                  <p class="mt-1 text-xs leading-5 text-slate-500">自動帶入登入網址、Username、一次性憑證及期限。</p>
                </div>
                <button type="button"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                  @click="showEmailDraft = !showEmailDraft">
                  {{ showEmailDraft ? '隱藏範本' : '預覽範本' }}
                </button>
              </div>
              <div v-if="showEmailDraft" class="mt-3 space-y-2">
                <p class="break-all text-xs text-slate-600"><span class="font-medium text-slate-700">收件者：</span>{{ createdAccount.email }}</p>
                <p class="text-xs text-slate-700"><span class="font-medium">主旨：</span>{{ onboardingEmailSubject }}</p>
                <textarea
                  :value="onboardingEmailBody"
                  readonly rows="14" spellcheck="false" aria-label="員工啟用 Email 範本（含一次性憑證）"
                  class="w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-xs leading-6 text-slate-800 outline-none"
                ></textarea>
              </div>
              <button type="button"
                class="mt-3 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                @click="copyOnboardingEmail">
                {{ copiedEmailDraft ? '已複製信件全文' : '複製信件全文（含憑證）' }}
              </button>
              <p v-if="emailCopyMessage" class="mt-2 text-xs leading-5 text-slate-700" role="status">{{ emailCopyMessage }}</p>
              <p class="mt-2 text-xs leading-5 text-slate-500">本功能只產生範本，不會自動寄信。內容含有效的一次性憑證，請確認收件者正確並以公司核准的管道傳送。</p>
            </div>
            <button type="button" class="mt-4 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    :disabled="usersLoading" @click="loadUsers">
              {{ usersLoading ? '更新中…' : '更新員工啟用狀態' }}
            </button>
            <button type="button" class="mt-3 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50" @click="closeCredential">
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
                  員工須先使用一次性憑證完成首次密碼設定，才能使用 Username 與個人密碼登入。
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