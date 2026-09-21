<script setup>
import {
  ref,
  computed,
  onMounted
} from 'vue'

import {
  getAllPermitRecords,
  getPermitById
} from '@/utils/permits/permitRepository'

import PermitDetailDrawer
  from '@/tools/permits/PermitDetailDrawer.vue'

const keyword = ref('')
const isSearching = ref(false)
const searchError = ref('')
const results = ref([])
const selectedStatus = ref('all')
const selectedPermit = ref(null)
const isPermitDetailOpen = ref(false)
const isPermitDetailLoading = ref(false)
const permitDetailError = ref('')

function handleClear() {
  keyword.value = ''
  selectedStatus.value = 'all'
  searchError.value = ''
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

function isExpiredMoreThan30Days(expirationDate) {
  if (!expirationDate) {
    return false
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const expiration = new Date(expirationDate)
  expiration.setHours(0, 0, 0, 0)

  const diffTime =
      today.getTime() - expiration.getTime()

  const expiredDays =
      Math.floor(
          diffTime / (1000 * 60 * 60 * 24)
      )

  return expiredDays > 30
}

const filteredResults = computed(() => {
  const keywords = keyword.value
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)

  return results.value.filter((item) => {
    if (
        isExpiredMoreThan30Days(
            item.permits?.expiration_date
        )
    ) {
      return false
    }

    const status = getPermitStatus(
        item.permits?.expiration_date
    )

    const matchesStatus =
        selectedStatus.value === 'all' ||
        status.type === selectedStatus.value

    if (!matchesStatus) {
      return false
    }

    if (keywords.length === 0) {
      return true
    }

    const searchableFields = [
      item.permits?.applicant,
      item.permits?.application_no,
      item.permits?.certificate_no,
      item.item_no,
      item.ccc_code,
      item.brand,
      item.goods_name,
      item.country,
      item.model,
      item.review_result,
      item.permits?.issue_date,
      item.permits?.expiration_date
    ].map((value) =>
        String(value ?? '').toLowerCase()
    )

    return keywords.every((keyword) =>
        searchableFields.some((field) =>
            field.includes(keyword)
        )
    )
  })
})

async function loadAllPermitRecords() {
  searchError.value = ''

  try {
    isSearching.value = true

    results.value =
        await getAllPermitRecords()
  } catch (error) {
    console.error(error)

    searchError.value =
        `讀取簽審資料失敗：${error.message}`
  } finally {
    isSearching.value = false
  }
}

async function openPermitDetail(permitId) {
  if (!permitId) {
    return
  }

  permitDetailError.value = ''
  selectedPermit.value = null
  isPermitDetailOpen.value = true

  try {
    isPermitDetailLoading.value = true

    selectedPermit.value =
        await getPermitById(permitId)
  } catch (error) {
    console.error(error)

    permitDetailError.value =
        `讀取公文詳情失敗：${error.message}`
  } finally {
    isPermitDetailLoading.value = false
  }
}

function closePermitDetail() {
  isPermitDetailOpen.value = false
}

onMounted(() => {
  loadAllPermitRecords()
})
</script>

<template>
  <header class="mb-8">
    <p
        class="
          text-xs
          font-bold
          uppercase
          tracking-[0.2em]
          text-slate-400
        "
    >
      PERMIT
    </p>

    <h1
        class="
          mt-2
          text-2xl
          font-bold
          tracking-tight
          text-slate-950
          md:text-3xl
        "
    >
      簽審資料查詢
    </h1>

    <p
        class="
          mt-2
          max-w-2xl
          text-sm
          leading-6
          text-slate-500
        "
    >
      輸入申辦案號並上傳警政署簽審 PDF，系統將自動解析公文與商品明細存入PTS資料庫。
    </p>
  </header>
  <section
      class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
  >
    <!-- 標題 / 查詢 -->
    <div
        class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
    >
      <div>
        <p class="mt-2 text-sm text-slate-500">
          目前顯示
          <span class="font-semibold text-slate-900">
            {{ filteredResults.length }}
          </span>
          筆資料
        </p>
      </div>

      <div
          class="flex w-full flex-col gap-3 lg:w-auto lg:flex-row"
      >
        <input
            v-model="keyword"
            type="text"
            placeholder="搜尋資料，可輸入多個關鍵字並以空格分隔"
            class="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 lg:w-[420px]"
        >

        <select
            v-model="selectedStatus"
            class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        >
          <option value="all">
            全部狀態
          </option>

          <option value="valid">
            有效
          </option>

          <option value="expiring">
            即將到期
          </option>

          <option value="expired">
            已過期
          </option>
        </select>

        <button
            type="button"
            class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            @click="handleClear"
        >
          清除
        </button>
      </div>
    </div>

    <!-- 錯誤 -->
    <div
        v-if="searchError"
        class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ searchError }}
    </div>

    <!-- Loading -->
    <div
        v-if="isSearching"
        class="mt-8 rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500"
    >
      資料讀取中...
    </div>

    <!-- 無資料 -->
    <div
        v-else-if="
        !searchError &&
        filteredResults.length === 0
      "
        class="mt-8 rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600"
    >
      查無符合目前條件的資料。
    </div>

    <!-- Table -->
    <div
        v-else-if="filteredResults.length"
        class="mt-8"
    >
      <div
          class="overflow-x-auto rounded-xl border border-slate-200"
      >
        <table
            class="w-full min-w-[2100px] border-collapse text-left text-sm"
        >
          <thead
              class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
          <tr>
            <th class="px-4 py-3">
              進口人
            </th>

            <th class="px-4 py-3">
              申辦案號
            </th>

            <th class="px-4 py-3">
              簽審核准文號
            </th>

            <th class="px-4 py-3">
              證書項次
            </th>

            <th class="px-4 py-3">
              C.C.C. Code
            </th>

            <th class="px-4 py-3">
              稅率
            </th>

            <th class="px-4 py-3">
              廠牌
            </th>

            <th class="px-4 py-3">
              公文貨品名稱
            </th>

            <th class="px-4 py-3">
              生產國別
            </th>

            <th class="px-4 py-3">
              型號
            </th>

            <th class="px-4 py-3">
              審核結果
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
          </tr>
          </thead>

          <tbody
              class="divide-y divide-slate-200 bg-white"
          >
          <tr
              v-for="item in filteredResults"
              :key="item.id"
              class="align-top hover:bg-slate-50"
          >
            <!-- 進口人 -->
            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              {{ item.permits?.applicant }}
            </td>

            <!-- 申辦案號 -->
            <td
                class="whitespace-nowrap px-4 py-3"
            >
              <button
                  type="button"
                  class="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 transition hover:text-blue-600 hover:decoration-blue-400"
                  @click="
                    openPermitDetail(
                      item.permits?.id
                    )
                  "
              >
                {{ item.permits?.application_no }}
              </button>
            </td>

            <!-- 簽審核准文號 -->
            <td
                class="whitespace-nowrap px-4 py-3"
            >
              <button
                  type="button"
                  class="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 transition hover:text-blue-600 hover:decoration-blue-400"
                  @click="
                    openPermitDetail(
                      item.permits?.id
                    )
                  "
              >
                {{ item.permits?.certificate_no }}
              </button>
            </td>

            <!-- 證書項次 -->
            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              {{ item.item_no }}
            </td>

            <!-- C.C.C. Code -->
            <td
                class="whitespace-nowrap px-4 py-3 font-mono text-slate-700"
            >
              {{ item.ccc_code }}
            </td>

            <!-- 稅率 -->
            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              <div
                  v-if="item.tax_rate !== null"
                  class="group relative inline-flex"
              >
                <span
                    class="cursor-help border-b border-dashed border-slate-400"
                >
                  {{ item.tax_rate }}%
                </span>

                <div
                    v-if="item.tax_description"
                    class="
                      pointer-events-none
                      absolute
                      left-1/2
                      top-full
                      z-50
                      mt-2
                      hidden
                      w-96
                      -translate-x-1/2
                      whitespace-normal
                      break-words
                      rounded-lg
                      bg-slate-900
                      px-4
                      py-3
                      text-left
                      text-xs
                      leading-5
                      text-white
                      shadow-lg
                      group-hover:block
                    "
                >
                  {{ item.tax_description }}

                  <div
                      class="
                        absolute
                        -top-1
                        left-1/2
                        h-2
                        w-2
                        -translate-x-1/2
                        rotate-45
                        bg-slate-900
                      "
                  />
                </div>
              </div>

              <span
                  v-else
                  class="text-amber-600"
              >
                尚未設定
              </span>
            </td>

            <!-- 廠牌 -->
            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              {{ item.brand }}
            </td>

            <!-- 公文貨品名稱 -->
            <td
                class="min-w-[360px] px-4 py-3 text-slate-700"
            >
              {{ item.goods_name }}
            </td>

            <!-- 生產國別 -->
            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              {{ item.country }}
            </td>

            <!-- 型號 -->
            <td
                class="whitespace-nowrap px-4 py-3 font-medium text-slate-950"
            >
              {{ item.model }}
            </td>

            <!-- 審核結果 -->
            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              {{ item.review_result }}
            </td>

            <!-- 核准日期 -->
            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              {{ item.permits?.issue_date }}
            </td>

            <!-- 有效日期 -->
            <td
                class="whitespace-nowrap px-4 py-3 text-slate-700"
            >
              {{ item.permits?.expiration_date }}
            </td>

            <!-- 狀態 -->
            <td
                class="whitespace-nowrap px-4 py-3"
            >
        <span
            v-if="
            getPermitStatus(
              item.permits?.expiration_date
            ).type === 'valid'
          "
            class="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
        >
          有效
        </span>

              <span
                  v-else-if="
            getPermitStatus(
              item.permits?.expiration_date
            ).type === 'expiring'
          "
                  class="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
              >
          即將到期（{{
                  getPermitStatus(
                      item.permits?.expiration_date
                  ).daysText
                }}）
        </span>

              <span
                  v-else-if="
            getPermitStatus(
              item.permits?.expiration_date
            ).type === 'expired'
          "
                  class="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"
              >
          已過期（{{
                  getPermitStatus(
                      item.permits?.expiration_date
                  ).daysText
                }}）
        </span>

              <span
                  v-else
                  class="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
              >
          未知
        </span>
            </td>
          </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
  <PermitDetailDrawer
      :is-open="isPermitDetailOpen"
      :permit="selectedPermit"
      :is-loading="isPermitDetailLoading"
      :error="permitDetailError"
      @close="closePermitDetail"
  />
</template>