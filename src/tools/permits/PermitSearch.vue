<script setup>
import { ref } from 'vue'

import {
  searchPermitRecords
} from '@/utils/permits/permitRepository'

const keyword = ref('')
const isSearching = ref(false)
const searchError = ref('')
const results = ref([])
const hasSearched = ref(false)

async function handleSearch() {
  searchError.value = ''
  results.value = []

  const normalizedKeyword = keyword.value.trim()

  if (!normalizedKeyword) {
    searchError.value = '請輸入型號'
    return
  }

  try {
    isSearching.value = true
    hasSearched.value = true

    results.value = await searchPermitRecords(
        normalizedKeyword
    )
  } catch (error) {
    console.error(error)

    searchError.value =
        `查詢失敗：${error.message}`
  } finally {
    isSearching.value = false
  }
}

function handleClear() {
  keyword.value = ''
  results.value = []
  searchError.value = ''
  hasSearched.value = false
}

function getPermitStatus(expirationDate) {
  if (!expirationDate) {
    return {
      label: '未知',
      type: 'unknown',
      daysText: ''
    }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const expiration = new Date(expirationDate)
  expiration.setHours(0, 0, 0, 0)

  const diffTime =
      expiration.getTime() - today.getTime()

  const diffDays =
      Math.ceil(
          diffTime / (1000 * 60 * 60 * 24)
      )

  if (diffDays < 0) {
    return {
      label: '已過期',
      type: 'expired',
      daysText: `逾期 ${Math.abs(diffDays)} 天`
    }
  }

  if (diffDays === 0) {
    return {
      label: '即將到期',
      type: 'expiring',
      daysText: '今天到期'
    }
  }

  if (diffDays <= 45) {
    return {
      label: '即將到期',
      type: 'expiring',
      daysText: `剩 ${diffDays} 天`
    }
  }

  return {
    label: '有效',
    type: 'valid',
    daysText: `剩 ${diffDays} 天`
  }
}
</script>

<template>
  <section
      class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
  >
    <div>
      <h2 class="text-xl font-bold text-slate-950">
        簽審資料查詢
      </h2>

      <p class="mt-2 text-sm text-slate-500">
        可輸入型號、廠牌、貨品名稱、C.C.C. Code、申辦案號或簽審核准文號查詢。
      </p>
    </div>

    <div class="mt-6 flex flex-col gap-3 sm:flex-row">
      <input
          v-model="keyword"
          type="text"
          placeholder="例如：ME115490307、PTS、113090903217"
          class="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          @keyup.enter="handleSearch"
      >

      <button
          type="button"
          :disabled="isSearching"
          class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          @click="handleSearch"
      >
        {{
          isSearching
              ? '查詢中...'
              : '查詢'
        }}
      </button>

      <button
          v-if="keyword || results.length"
          type="button"
          class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          @click="handleClear"
      >
        清除
      </button>
    </div>

    <div
        v-if="searchError"
        class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ searchError }}
    </div>

    <div
        v-if="
          hasSearched &&
          !isSearching &&
          !searchError &&
          results.length === 0
        "
        class="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600"
    >
      查無符合資料。
    </div>

    <div
        v-if="results.length"
        class="mt-8"
    >
      <div class="mb-4 flex items-end justify-between">
        <div>
          <p class="text-sm font-medium text-slate-500">
            查詢結果
          </p>

          <h3 class="mt-1 text-lg font-bold text-slate-950">
            共 {{ results.length }} 筆
          </h3>
        </div>
      </div>

      <div
          class="overflow-x-auto rounded-xl border border-slate-200"
      >
        <table
            class="w-full min-w-[1400px] border-collapse text-left text-sm"
        >
          <thead
              class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
          <tr>
            <th class="px-4 py-3">
              型號
            </th>

            <th class="px-4 py-3">
              貨品名稱
            </th>

            <th class="px-4 py-3">
              廠牌
            </th>

            <th class="px-4 py-3">
              申辦案號
            </th>

            <th class="px-4 py-3">
              簽審核准文號
            </th>

            <th class="px-4 py-3">
              核准日期
            </th>

            <th class="px-4 py-3">
              有效日期
            </th>

            <th class="px-4 py-3">
              狀態
            </th>

            <th class="px-4 py-3">
              審核結果
            </th>
          </tr>
          </thead>

          <tbody
              class="divide-y divide-slate-200 bg-white"
          >
          <tr
              v-for="item in results"
              :key="item.id"
              class="align-top hover:bg-slate-50"
          >
            <td
                class="whitespace-nowrap px-4 py-3 font-medium text-slate-950"
            >
              {{ item.model }}
            </td>

            <td
                class="min-w-[320px] px-4 py-3 text-slate-700"
            >
              {{ item.goods_name }}
            </td>

            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              {{ item.brand }}
            </td>

            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              {{ item.permits?.application_no }}
            </td>

            <td
                class="whitespace-nowrap px-4 py-3 font-medium text-slate-900"
            >
              {{ item.permits?.certificate_no }}
            </td>

            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              {{ item.permits?.issue_date }}
            </td>

            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              {{ item.permits?.expiration_date }}
            </td>

            <td class="whitespace-nowrap px-4 py-3">
              <div class="flex flex-col items-start gap-1">
    <span
        :class="{
        'bg-emerald-50 text-emerald-700':
          getPermitStatus(item.permits?.expiration_date).type === 'valid',

        'bg-amber-50 text-amber-700':
          getPermitStatus(item.permits?.expiration_date).type === 'expiring',

        'bg-red-50 text-red-700':
          getPermitStatus(item.permits?.expiration_date).type === 'expired',

        'bg-slate-100 text-slate-600':
          getPermitStatus(item.permits?.expiration_date).type === 'unknown'
      }"
        class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium"
    >
      {{
        getPermitStatus(
            item.permits?.expiration_date
        ).label
      }}
    </span>

                <span class="text-xs text-slate-500">
      {{
                    getPermitStatus(
                        item.permits?.expiration_date
                    ).daysText
                  }}
    </span>
              </div>
            </td>

            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              {{ item.review_result }}
            </td>
          </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>