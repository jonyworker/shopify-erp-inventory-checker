<script setup>
import {
  ref,
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  watch
} from 'vue'

import { supabase } from '@/lib/supabaseClient'

import {
  signInWithEmail,
  signInWithUsername,
  activateEmployeeAccount,
  signOut
} from '@/utils/auth/authService'

import {
  currentUser,
  isAuthReady
} from '@/stores/authState'

defineProps({
  collapsed: {
    type: Boolean,
    default: false
  }
})

const account = ref('')
const password = ref('')

const isLoading = ref(false)
const errorMessage = ref('')
const isLoginOpen = ref(false)

const loginPanelRef = ref(null)

// 只用登入者所屬的員工資料查詢 Username；不從 Email 猜帳號。
// 需要 employees.auth_user_id / employees.username，並由 RLS 限制讀取本人。
const authenticatedUsername = ref({ userId: null, username: '' })
const usernameStorageKey = (userId) => `pts_display_username_${userId}`
let usernameLookupVersion = 0

function readStoredUsername(userId) {
  if (!userId) return ''
  try {
    return sessionStorage.getItem(usernameStorageKey(userId)) || ''
  } catch {
    return ''
  }
}

function storeUsername(userId, username) {
  const safeUsername = String(username ?? '').trim().toLowerCase()
  if (!userId || !safeUsername) return
  authenticatedUsername.value = { userId, username: safeUsername }
  try {
    sessionStorage.setItem(usernameStorageKey(userId), safeUsername)
  } catch {
    // 瀏覽器拒絕暫存時，當前畫面仍可顯示。
  }
}

// 既有登入工作階段也會觸發讀取，不必先登出重登。
watch(() => currentUser.value?.id, async (userId) => {
  const lookupVersion = ++usernameLookupVersion
  authenticatedUsername.value = { userId: null, username: '' }
  if (!userId) return

  // 新登入的 Username 可能已由 handleLogin 記下；仍以員工資料為主。
  const { data, error } = await supabase
    .from('employees')
    .select('username')
    .eq('auth_user_id', userId)
    .maybeSingle()

  if (lookupVersion !== usernameLookupVersion || currentUser.value?.id !== userId) return

  if (error) {
    // 如果實際表名/欄位不同，不能默默把 Email 前綴當成 Username。
    console.warn('[PTS LoginPanel] 無法讀取員工 Username，請確認 employees、auth_user_id 與 RLS：', error.message)
    return
  }
  if (data?.username) storeUsername(userId, data.username)
}, { immediate: true })

const displayUsername = computed(() => {
  const user = currentUser.value
  if (!user) return ''
  return (authenticatedUsername.value.userId === user.id ? authenticatedUsername.value.username : '')
    || readStoredUsername(user.id)
    || user?.app_metadata?.username
    || user?.user_metadata?.username
    || '使用者'
})

const displayIdentity = computed(() => {
  const email = currentUser.value?.email
  return email ? `${displayUsername.value}\n(${email})` : displayUsername.value
})

const avatarLetter = computed(() => {
  const username = displayUsername.value
  return username === '使用者' ? '?' : username.charAt(0).toUpperCase()
})

// 首次設定密碼與一般登入完全分離。尚未啟用的員工沒有登入 Session。
const isActivationOpen = ref(false)
const activationUsername = ref('')
const activationCode = ref('')
const activationPassword = ref('')
const activationPasswordConfirm = ref('')
const activationError = ref('')
const activationSuccess = ref(false)
const isActivating = ref(false)
const showActivationCode = ref(false)
const showActivationPassword = ref(false)
const activationFirstInputRef = ref(null)
const activationLaunchRef = ref(null)

function clearActivationForm() {
  activationCode.value = ''
  activationPassword.value = ''
  activationPasswordConfirm.value = ''
  activationError.value = ''
  showActivationCode.value = false
  showActivationPassword.value = false
}

async function openActivation() {
  if (isLoading.value || isActivating.value) return
  activationUsername.value = account.value.includes('@') ? '' : account.value.trim().toLowerCase()
  clearActivationForm()
  activationSuccess.value = false
  isLoginOpen.value = false
  isActivationOpen.value = true
  await nextTick()
  activationFirstInputRef.value?.focus()
}

function closeActivation({ returnToLogin = false } = {}) {
  if (isActivating.value) return
  const successfulUsername = activationSuccess.value ? activationUsername.value.trim().toLowerCase() : ''
  isActivationOpen.value = false
  activationSuccess.value = false
  activationUsername.value = ''
  clearActivationForm()
  if (returnToLogin) {
    if (successfulUsername) account.value = successfulUsername
    password.value = ''
    errorMessage.value = ''
    isLoginOpen.value = true
    nextTick(() => activationLaunchRef.value?.focus())
  }
}

function handleActivationEscape(event) {
  if (event.key === 'Escape' && isActivationOpen.value && !isActivating.value) {
    closeActivation()
  }
}

function onActivationFieldChange() {
  activationError.value = ''
}

async function handleActivation() {
  if (isActivating.value || activationSuccess.value) return
  activationError.value = ''

  const username = activationUsername.value.trim().toLowerCase()
  const temporaryPassword = activationCode.value.trim()
  const newPassword = activationPassword.value
  const confirmedPassword = activationPasswordConfirm.value

  if (!/^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/.test(username)) {
    activationError.value = '請輸入有效的 Username（3–32 字元）'
    return
  }
  if (!temporaryPassword) {
    activationError.value = '請輸入管理員提供的一次性憑證'
    return
  }
  if (!/^[A-HJ-NP-Za-km-z2-9]{24}$/.test(temporaryPassword)) {
    activationError.value = '一次性憑證格式不正確，請確認是否完整複製 24 個字元'
    return
  }
  // 舊規則（暫停使用）：密碼需 12–128 字元、至少含英文字母及數字。
  // 如未來要恢復較嚴格的密碼政策，請同步修改 Edge Function。
  // if (
  //   newPassword.length < 12 || newPassword.length > 128 ||
  //   !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword) ||
  //   /[\x00-\x1f\x7f]/.test(newPassword)
  // ) {
  //   activationError.value = '新密碼需為 12–128 字元，包含英文字母及數字，不能有控制字元'
  //   return
  // }

  // 暫行規則：放寬至 6–128 字元，不限制英文字母大小寫或數字組合。
  // 保留基本長度限制、禁止控制字元；Supabase Auth 仍可能有額外政策。
  if (
    newPassword.length < 6 || newPassword.length > 128 ||
    /[\x00-\x1f\x7f]/.test(newPassword)
  ) {
    activationError.value = '新密碼請輸入至少 6 個字元（不需混合英文字母與數字），且不可包含控制字元'
    return
  }
  if (newPassword === temporaryPassword) {
    activationError.value = '新密碼不得與一次性憑證相同'
    return
  }
  if (newPassword !== confirmedPassword) {
    activationError.value = '兩次輸入的新密碼不一致'
    return
  }

  try {
    isActivating.value = true
    await activateEmployeeAccount({
      username,
      temporaryPassword,
      newPassword
    })
    // 不自動登入。使用者應另外用新密碼建立正式 Session。
    activationSuccess.value = true
    account.value = username
    password.value = ''
    clearActivationForm()
  } catch (error) {
    activationError.value = error?.message || '首次設定密碼失敗，請稍後再試'
    // 不輸出一次性憑證、新密碼或任何 API 回應到 Console。
  } finally {
    isActivating.value = false
  }
}

function handleClickOutside(event) {
  if (
    !isLoginOpen.value ||
    isActivationOpen.value ||
    !loginPanelRef.value
  ) {
    return
  }

  if (!loginPanelRef.value.contains(event.target)) {
    isLoginOpen.value = false
    errorMessage.value = ''
  }
}

onMounted(() => {
  document.addEventListener(
    'click',
    handleClickOutside
  )
  document.addEventListener('keydown', handleActivationEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener(
    'click',
    handleClickOutside
  )
  document.removeEventListener('keydown', handleActivationEscape)
})

async function handleLogin() {
  if (isLoading.value) return

  errorMessage.value = ''

  const identifier = account.value.trim()

  if (!identifier) {
    errorMessage.value = '請輸入帳號或 Email'
    return
  }

  if (!password.value) {
    errorMessage.value = '請輸入密碼'
    return
  }

  try {
    isLoading.value = true

    // 過渡期間：舊共用帳號仍可用 Email 登入。
    // 新管理員或新員工則使用 Username，密碼驗證由 Supabase Auth 處理。
    if (identifier.includes('@')) {
      await signInWithEmail(identifier, password.value)
    } else {
      const sessionData = await signInWithUsername(identifier, password.value)
      storeUsername(sessionData?.session?.user?.id, identifier.toLowerCase())
    }

    account.value = ''
    password.value = ''
    isLoginOpen.value = false
  } catch (error) {
    // 不在主控台輸出憑證或登入回應。
    errorMessage.value = error?.message || '登入失敗，請稍後再試'
  } finally {
    isLoading.value = false
  }
}

async function handleLogout() {
  errorMessage.value = ''

  try {
    isLoading.value = true
    const previousUserId = currentUser.value?.id
    await signOut()
    authenticatedUsername.value = { userId: null, username: '' }
    if (previousUserId) {
      try {
        sessionStorage.removeItem(usernameStorageKey(previousUserId))
      } catch {
        // 無法使用 sessionStorage 時不影響登出。
      }
    }
    isLoginOpen.value = false
  } catch (error) {
    console.error(error)

    errorMessage.value =
      `登出失敗：${error.message}`
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div
    ref="loginPanelRef"
    class="relative"
  >
    <!-- Auth 初始化中 -->
    <div
      v-if="!isAuthReady"
      class="flex items-center justify-center py-3"
    >
      <div
        class="
          h-4 w-4
          animate-spin
          rounded-full
          border-2
          border-slate-200
          border-t-slate-500
        "
      />
    </div>

    <!-- 已登入 -->
    <template v-else-if="currentUser">
      <!-- 展開模式 -->
      <div
        v-if="!collapsed"
        class="
          rounded-xl
          border border-slate-200
          bg-slate-50
          p-3
        "
      >
        <div class="flex items-center gap-3">
          <!-- Avatar -->
          <div
            class="
              flex h-9 w-9
              shrink-0
              items-center justify-center
              rounded-full
              bg-slate-900
              text-xs
              font-bold
              uppercase
              text-white
            "
          >
            {{ avatarLetter }}
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span
                class="
                  h-1.5 w-1.5
                  rounded-full
                  bg-emerald-500
                "
              />

              <span
                class="
                  text-xs
                  font-medium
                  text-slate-700
                  whitespace-pre-line
                  break-words
                "
                :title="displayIdentity"
              >
                {{ displayIdentity }}
              </span>
            </div>

          </div>
        </div>

        <button
          type="button"
          :disabled="isLoading"
          class="
            mt-3
            w-full
            rounded-lg
            border border-slate-200
            bg-white
            px-3 py-2
            text-xs
            font-medium
            text-slate-600
            transition
            hover:border-slate-300
            hover:bg-slate-100
            hover:text-slate-900
            disabled:cursor-not-allowed
            disabled:opacity-50
          "
          @click="handleLogout"
        >
          {{ isLoading ? '登出中...' : '登出' }}
        </button>
      </div>

      <!-- 收合模式 -->
      <div
        v-else
        class="flex justify-center"
      >
        <button
          type="button"
          :disabled="isLoading"
          class="
            relative
            flex h-10 w-10
            items-center justify-center
            rounded-full
            bg-slate-900
            text-xs
            font-bold
            uppercase
            text-white
            transition
            hover:bg-slate-700
            disabled:opacity-50
          "
          :title="`${displayIdentity}・點擊登出`"
          @click="handleLogout"
        >
          {{ avatarLetter }}

          <span
            class="
              absolute
              bottom-0 right-0
              h-2.5 w-2.5
              rounded-full
              border-2 border-white
              bg-emerald-500
            "
          />
        </button>
      </div>
    </template>

    <!-- 未登入 -->
    <template v-else>
      <!-- 展開模式 -->
      <button
        v-if="!collapsed"
        type="button"
        class="
          flex w-full
          items-center gap-3
          rounded-xl
          border border-slate-200
          bg-slate-50
          p-3
          text-left
          transition
          hover:bg-slate-100
        "
        @click="isLoginOpen = !isLoginOpen"
      >
        <div
          class="
            flex h-9 w-9
            shrink-0
            items-center justify-center
            rounded-full
            bg-white
            text-slate-500
            shadow-sm
            ring-1 ring-slate-200
          "
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            class="h-4 w-4"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
              d="
                M15.75 9
                V5.25
                A2.25 2.25 0 0 0 13.5 3h-6
                a2.25 2.25 0 0 0-2.25 2.25v13.5
                A2.25 2.25 0 0 0 7.5 21h6
                a2.25 2.25 0 0 0 2.25-2.25V15

                M18 15l3-3m0 0-3-3m3 3H9
              "
            />
          </svg>
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span
              class="
                h-1.5 w-1.5
                rounded-full
                bg-amber-400
              "
            />

            <span
              class="
                text-xs
                font-medium
                text-slate-500
              "
            >
              尚未登入
            </span>
          </div>

          <p
            class="
              mt-0.5
              text-xs
              font-medium
              text-slate-700
            "
          >
            點擊登入系統
          </p>
        </div>
      </button>

      <!-- 收合模式 -->
      <button
        v-else
        type="button"
        class="
          relative
          mx-auto
          flex h-10 w-10
          items-center justify-center
          rounded-full
          bg-slate-100
          text-slate-500
          transition
          hover:bg-slate-200
          hover:text-slate-900
        "
        title="登入系統"
        @click="isLoginOpen = !isLoginOpen"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          class="h-4 w-4"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
            d="
              M15.75 9
              V5.25
              A2.25 2.25 0 0 0 13.5 3h-6
              a2.25 2.25 0 0 0-2.25 2.25v13.5
              A2.25 2.25 0 0 0 7.5 21h6
              a2.25 2.25 0 0 0 2.25-2.25V15

              M18 15l3-3m0 0-3-3m3 3H9
            "
          />
        </svg>

        <span
          class="
            absolute
            bottom-0 right-0
            h-2.5 w-2.5
            rounded-full
            border-2 border-white
            bg-amber-400
          "
        />
      </button>
    </template>

    <!-- Login Popover -->
    <div
      v-if="
        isAuthReady &&
        !currentUser &&
        isLoginOpen
      "
      class="
        absolute
        bottom-0
        left-full
        z-50
        ml-3
        w-[320px]
        rounded-xl
        border border-slate-200
        bg-white
        p-4
        shadow-xl
      "
    >
      <div>
        <h2
          class="
            text-sm
            font-semibold
            text-slate-950
          "
        >
          系統登入
        </h2>

        <p
          class="
            mt-1
            text-xs
            leading-5
            text-slate-500
          "
        >
          使用 PTS 帳號登入；舊共用帳號暫時仍可使用 Email。
        </p>
      </div>

      <div class="mt-4 space-y-3">
        <div>
          <label
            class="
              mb-1.5 block
              text-xs font-medium
              text-slate-600
            "
          >
            帳號或 Email
          </label>

          <input
            v-model="account"
            type="text"
            placeholder="admin 或原有 Email"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            class="
              w-full
              rounded-lg
              border border-slate-300
              px-3 py-2
              text-sm
              outline-none
              transition
              focus:border-slate-500
              focus:ring-2
              focus:ring-slate-200
            "
            @keyup.enter="handleLogin"
          >
        </div>

        <div>
          <label
            class="
              mb-1.5 block
              text-xs font-medium
              text-slate-600
            "
          >
            密碼
          </label>

          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="
              w-full
              rounded-lg
              border border-slate-300
              px-3 py-2
              text-sm
              outline-none
              transition
              focus:border-slate-500
              focus:ring-2
              focus:ring-slate-200
            "
            @keyup.enter="handleLogin"
          >
        </div>

        <div
          v-if="errorMessage"
          class="
            rounded-lg
            bg-red-50
            px-3 py-2
            text-xs
            text-red-700
          "
        >
          {{ errorMessage }}
        </div>

        <button
          type="button"
          :disabled="isLoading"
          class="
            w-full
            rounded-lg
            bg-slate-900
            px-4 py-2
            text-sm
            font-medium
            text-white
            transition
            hover:bg-slate-800
            disabled:cursor-not-allowed
            disabled:opacity-50
          "
          @click="handleLogin"
        >
          {{ isLoading ? '登入中...' : '登入' }}
        </button>

        <button
          ref="activationLaunchRef"
          type="button"
          :disabled="isLoading"
          class="w-full py-1.5 text-center text-xs font-medium text-slate-600 underline-offset-4 transition hover:text-slate-900 hover:underline disabled:opacity-50"
          @click="openActivation"
        >
          第一次使用 PTS？設定個人密碼
        </button>
      </div>
    </div>
  </div>

  <!-- 獨立 Modal：四個輸入欄位避免讓側邊小視窗超出螢幕。 -->
  <Teleport to="body">
    <div
      v-if="isActivationOpen && !currentUser"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 px-4 py-6"
      role="presentation"
      @click.self="closeActivation()"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pts-activation-title"
        class="w-full max-w-[440px] max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">PTS / 帳號啟用</p>
            <h2 id="pts-activation-title" class="mt-1 text-lg font-semibold text-slate-950">
              {{ activationSuccess ? '首次設定完成' : '首次設定個人密碼' }}
            </h2>
            <p class="mt-1.5 text-xs leading-5 text-slate-500">
              {{ activationSuccess
              ? '你的個人帳號已完成啟用，現在可使用新密碼登入。'
              : '輸入管理員提供的一次性憑證，並設定只有你知道的新密碼。' }}
            </p>
          </div>
          <button
            type="button"
            aria-label="關閉首次設定視窗"
            :disabled="isActivating"
            class="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
            @click="closeActivation()"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="h-5 w-5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <template v-if="activationSuccess">
          <div class="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900" role="status">
            帳號啟用成功。請使用 Username 和剛設定的新密碼登入 PTS。
          </div>
          <button
            type="button"
            class="mt-5 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            @click="closeActivation({ returnToLogin: true })"
          >
            返回登入
          </button>
        </template>

        <form v-else class="mt-5 space-y-3.5" novalidate @submit.prevent="handleActivation">
          <div>
            <label for="pts-activate-username" class="mb-1.5 block text-xs font-semibold text-slate-700">Username</label>
            <input
              id="pts-activate-username"
              ref="activationFirstInputRef"
              v-model="activationUsername"
              type="text"
              maxlength="32"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              placeholder="例：xiaoming"
              :disabled="isActivating"
              class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-50"
              @input="onActivationFieldChange"
            >
          </div>
          <div>
            <label for="pts-activate-code" class="mb-1.5 block text-xs font-semibold text-slate-700">一次性憑證</label>
            <div class="flex gap-2">
              <input
                id="pts-activate-code"
                v-model="activationCode"
                :type="showActivationCode ? 'text' : 'password'"
                maxlength="24"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                placeholder="管理員提供的 24 字元憑證"
                :disabled="isActivating"
                class="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-50"
                @input="onActivationFieldChange"
              >
              <button
                type="button"
                :disabled="isActivating"
                :aria-label="showActivationCode ? '隱藏憑證' : '顯示憑證'"
                class="shrink-0 rounded-lg border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                @click="showActivationCode = !showActivationCode"
              >
                {{ showActivationCode ? '隱藏' : '顯示' }}
              </button>
            </div>
            <p class="mt-1 text-xs text-slate-500">由管理員建立，只能使用一次，有效期限為 30 天。</p>
          </div>
          <div>
            <label for="pts-activate-password" class="mb-1.5 block text-xs font-semibold text-slate-700">新密碼</label>
            <div class="flex gap-2">
              <input
                id="pts-activate-password"
                v-model="activationPassword"
                :type="showActivationPassword ? 'text' : 'password'"
                autocomplete="new-password"
                :disabled="isActivating"
                placeholder="至少 6 個字元，英數與符號自由搭配"
                class="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-50"
                @input="onActivationFieldChange"
              >
              <button
                type="button"
                :disabled="isActivating"
                :aria-label="showActivationPassword ? '隱藏新密碼' : '顯示新密碼'"
                class="shrink-0 rounded-lg border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                @click="showActivationPassword = !showActivationPassword"
              >
                {{ showActivationPassword ? '隱藏' : '顯示' }}
              </button>
            </div>
          </div>
          <div>
            <label for="pts-activate-confirm" class="mb-1.5 block text-xs font-semibold text-slate-700">再次輸入新密碼</label>
            <input
              id="pts-activate-confirm"
              v-model="activationPasswordConfirm"
              :type="showActivationPassword ? 'text' : 'password'"
              autocomplete="new-password"
              :disabled="isActivating"
              placeholder="再次輸入新密碼"
              class="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-50"
              @input="onActivationFieldChange"
            >
          </div>
          <div v-if="activationError" role="alert" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700">
            {{ activationError }}
          </div>
          <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
            安全提醒：首次設定完成後，一次性憑證會失效。請勿將新密碼分享給管理員或其他同事。
          </p>
          <button
            type="submit"
            :disabled="isActivating"
            class="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
          >
            {{ isActivating ? '正在安全啟用帳號...' : '設定密碼並啟用帳號' }}
          </button>
          <button
            type="button"
            :disabled="isActivating"
            class="w-full py-1 text-xs font-medium text-slate-500 transition hover:text-slate-900 disabled:opacity-50"
            @click="closeActivation({ returnToLogin: true })"
          >
            返回一般登入
          </button>
        </form>
      </section>
    </div>
  </Teleport>
</template>
