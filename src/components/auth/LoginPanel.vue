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
import { currentUser } from '@/stores/authState'

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

  if (
      !loginPanelRef.value.contains(event.target)
  ) {
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
  <div ref="loginPanelRef" class="relative">
    <!-- 已登入 -->
    <div
      v-if="currentUser"
      class="
        flex
        h-[56px]
        items-center
        gap-3
        rounded-xl
        border
        border-slate-200
        bg-white
        px-4
      "
    >
      <div
          class="
            flex
            min-w-0
            items-center
            gap-2
          "
      >
        <span
            class="
              h-2
              w-2
              shrink-0
              rounded-full
              bg-emerald-500
            "
        />

        <span
            class="
              shrink-0
              font-medium
              text-slate-600
            "
        >
          已登入
        </span>

<!--        <span-->
<!--            class="-->
<!--              max-w-[220px]-->
<!--              truncate-->
<!--              text-slate-500-->
<!--            "-->
<!--            :title="currentUser.email"-->
<!--        >-->
<!--          {{ currentUser.email }}-->
<!--        </span>-->
      </div>

      <button
          type="button"
          :disabled="isLoading"
          class="
            shrink-0
            rounded-lg
            border
            border-slate-300
            bg-white
            px-3
            py-1.5
            text-xs
            font-medium
            text-slate-600
            transition
            hover:bg-slate-50
            disabled:cursor-not-allowed
            disabled:opacity-50
          "
          @click="handleLogout"
      >
        {{ isLoading ? '登出中...' : '登出' }}
      </button>
    </div>

    <!-- 未登入 -->
    <div
        v-else
        class="flex justify-end"
    >
      <button
          type="button"
          class="
            inline-flex
            h-[56px]
            items-center
            gap-2
            rounded-xl
            border
            border-slate-300
            bg-white
            px-4
            text-sm
            font-medium
            text-slate-700
            transition
            hover:bg-slate-50
          "
          @click="isLoginOpen = !isLoginOpen"
      >
        <span
            class="
              h-2
              w-2
              rounded-full
              bg-amber-400
            "
        />

        尚未登入
      </button>
    </div>

    <!-- Login Popover -->
    <div
        v-if="!currentUser && isLoginOpen"
        class="
          absolute
          right-0
          top-full
          z-50
          mt-3
          w-[320px]
          rounded-xl
          border
          border-slate-200
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
                mb-1.5
                block
                text-xs
                font-medium
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
                border
                border-slate-300
                px-3
                py-2
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
                mb-1.5
                block
                text-xs
                font-medium
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
                border
                border-slate-300
                px-3
                py-2
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
              px-3
              py-2
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
              px-4
              py-2
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