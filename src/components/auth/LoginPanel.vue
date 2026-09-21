<script setup>
import {
  ref,
  onMounted,
  onBeforeUnmount
} from 'vue'

import {
  signInWithEmail,
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

const email = ref('')
const password = ref('')

const isLoading = ref(false)
const errorMessage = ref('')
const isLoginOpen = ref(false)

const loginPanelRef = ref(null)

function handleClickOutside(event) {
  if (
      !isLoginOpen.value ||
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
})

onBeforeUnmount(() => {
  document.removeEventListener(
      'click',
      handleClickOutside
  )
})

async function handleLogin() {
  errorMessage.value = ''

  if (!email.value.trim()) {
    errorMessage.value = '請輸入 Email'
    return
  }

  if (!password.value) {
    errorMessage.value = '請輸入密碼'
    return
  }

  try {
    isLoading.value = true

    await signInWithEmail(
        email.value.trim(),
        password.value
    )

    email.value = ''
    password.value = ''
    isLoginOpen.value = false
  } catch (error) {
    console.error(error)

    errorMessage.value =
        `登入失敗：${error.message}`
  } finally {
    isLoading.value = false
  }
}

async function handleLogout() {
  errorMessage.value = ''

  try {
    isLoading.value = true
    await signOut()
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
            {{ currentUser.email?.charAt(0) }}
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
                  text-slate-500
                "
              >
                已登入
              </span>
            </div>

            <p
                class="
                mt-0.5
                truncate
                text-xs
                font-medium
                text-slate-700
              "
                :title="currentUser.email"
            >
              {{ currentUser.email }}
            </p>
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
            :title="`${currentUser.email}・點擊登出`"
            @click="handleLogout"
        >
          {{ currentUser.email?.charAt(0) }}

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
          登入後才能存取公文資料庫。
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
            Email
          </label>

          <input
              v-model="email"
              type="email"
              autocomplete="email"
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
      </div>
    </div>
  </div>
</template>