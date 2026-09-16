<script setup>
import { ref } from 'vue'
import {
  signInWithEmail,
  signOut,
  getCurrentUser
} from '@/utils/auth/authService'
import { currentUser } from '@/stores/authState'

const email = ref('')
const password = ref('')

const isLoading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

async function handleLogin() {
  errorMessage.value = ''
  successMessage.value = ''

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

    successMessage.value = '登入成功'
  } catch (error) {
    console.error(error)

    errorMessage.value = `登入失敗：${error.message}`
  } finally {
    isLoading.value = false
  }
}

async function handleLogout() {
  errorMessage.value = ''
  successMessage.value = ''

  try {
    isLoading.value = true

    await signOut()

    successMessage.value = '已登出'
  } catch (error) {
    console.error(error)

    errorMessage.value = `登出失敗：${error.message}`
  } finally {
    isLoading.value = false
  }
}

async function handleCheckUser() {
  errorMessage.value = ''
  successMessage.value = ''

  try {
    user.value = await getCurrentUser()

    if (user.value) {
      successMessage.value = `目前登入：${user.value.email}`
    } else {
      successMessage.value = '目前尚未登入'
    }
  } catch (error) {
    console.error(error)

    errorMessage.value = `取得使用者失敗：${error.message}`
  }
}
</script>

<template>
  <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div>
      <h2 class="text-lg font-bold text-slate-950">
        系統登入
      </h2>

      <p class="mt-1 text-sm text-slate-500">
        登入後才能存取公文資料庫。
      </p>
    </div>

    <div
        v-if="!currentUser"
        class="mt-5 space-y-4"
    >
      <div>
        <label class="mb-2 block text-sm font-medium text-slate-700">
          Email
        </label>

        <input
            v-model="email"
            type="email"
            autocomplete="email"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        >
      </div>

      <div>
        <label class="mb-2 block text-sm font-medium text-slate-700">
          密碼
        </label>

        <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        >
      </div>

      <button
          type="button"
          :disabled="isLoading"
          class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          @click="handleLogin"
      >
        {{ isLoading ? '登入中...' : '登入' }}
      </button>
    </div>

    <div
        v-else
        class="mt-5"
    >
      <div class="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        已登入：
        <strong>{{ currentUser.email }}</strong>
      </div>

      <div class="mt-4 flex gap-3">
        <button
            type="button"
            class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
            @click="handleCheckUser"
        >
          確認登入狀態
        </button>

        <button
            type="button"
            class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            @click="handleLogout"
        >
          登出
        </button>
      </div>
    </div>

    <div
        v-if="successMessage"
        class="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
    >
      {{ successMessage }}
    </div>

    <div
        v-if="errorMessage"
        class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ errorMessage }}
    </div>
  </section>
</template>