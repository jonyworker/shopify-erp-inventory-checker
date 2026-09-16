<script setup>
import { ref } from 'vue'

import {
  extractPdfText,
  parsePermitDocument,
  validatePermitData
} from '@/utils/permits/permitPdfParser'

import {
  getPermits,
  createPermitWithItems
} from '@/utils/permits/permitRepository'

import { currentUser } from '@/stores/authState'

const applicationNo = ref('')
const selectedFile = ref(null)

const isParsing = ref(false)
const isSaving = ref(false)

const parseError = ref('')
const saveError = ref('')
const saveSuccess = ref('')

const parsedPdf = ref(null)
const permitData = ref(null)
const validationResult = ref(null)

function resetParsedResult() {
  parsedPdf.value = null
  permitData.value = null
  validationResult.value = null

  parseError.value = ''
  saveError.value = ''
  saveSuccess.value = ''
}

function handleFileChange(event) {
  const file = event.target.files?.[0]

  selectedFile.value = file ?? null

  resetParsedResult()
}

async function handleParse() {
  parseError.value = ''
  saveError.value = ''
  saveSuccess.value = ''

  parsedPdf.value = null
  permitData.value = null
  validationResult.value = null

  const normalizedApplicationNo = applicationNo.value.trim()

  if (!normalizedApplicationNo) {
    parseError.value = '請先輸入申辦案號'
    return
  }

  if (!/^\d{12}$/.test(normalizedApplicationNo)) {
    parseError.value = '申辦案號應為 12 碼數字'
    return
  }

  if (!selectedFile.value) {
    parseError.value = '請選擇 PDF 檔案'
    return
  }

  if (selectedFile.value.type !== 'application/pdf') {
    parseError.value = '請上傳 PDF 格式檔案'
    return
  }

  try {
    isParsing.value = true

    parsedPdf.value = await extractPdfText(
        selectedFile.value
    )

    permitData.value = parsePermitDocument(
        parsedPdf.value.fullText,
        normalizedApplicationNo
    )

    validationResult.value = validatePermitData(
        permitData.value
    )

    console.log(
        'permitData',
        permitData.value
    )

    console.log(
        'validationResult',
        validationResult.value
    )
  } catch (error) {
    console.error(error)

    parseError.value =
        'PDF 解析失敗，請確認檔案是否正常'
  } finally {
    isParsing.value = false
  }
}

async function handleTestSupabase() {
  try {
    const data = await getPermits()

    alert(
        `Supabase 連線成功，共讀到 ${data.length} 筆 permits`
    )
  } catch (error) {
    console.error(error)

    alert(
        `Supabase 讀取失敗：${error.message}`
    )
  }
}

function handleReset() {
  applicationNo.value = ''
  selectedFile.value = null

  resetParsedResult()
}

async function handleSaveToDatabase() {
  saveError.value = ''
  saveSuccess.value = ''

  if (!currentUser.value) {
    saveError.value =
        '請先登入後再寫入資料庫'

    return
  }

  if (!permitData.value) {
    saveError.value =
        '目前沒有可寫入的公文資料'

    return
  }

  if (!validationResult.value?.isValid) {
    saveError.value =
        '資料驗證尚未通過，請先確認解析結果'

    return
  }

  try {
    isSaving.value = true

    const result = await createPermitWithItems(
        permitData.value
    )

    saveSuccess.value =
        `寫入成功：公文 1 筆，商品明細 ${result.itemCount} 筆`

    console.log(
        'createPermitWithItems result',
        result
    )
  } catch (error) {
    console.error(error)

    if (error.code === '23505') {
      saveError.value =
          '寫入失敗：申辦案號或簽審核准文號已存在，請確認是否重複匯入'

      return
    }

    saveError.value =
        `寫入資料庫失敗：${error.message}`
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <section
      class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
  >
    <div>
      <h2 class="text-xl font-bold text-slate-950">
        槍砲彈藥簽審公文管理
      </h2>

      <p class="mt-2 text-sm text-slate-500">
        輸入申辦案號並上傳警政署簽審 PDF，系統將自動解析公文與商品明細。
      </p>
    </div>

    <!-- 輸入區 -->
    <div class="mt-6 space-y-5">
      <div>
        <label
            class="mb-2 block text-sm font-medium text-slate-700"
        >
          申辦案號
          <span class="text-red-500">
            *
          </span>
        </label>

        <input
            v-model="applicationNo"
            type="text"
            maxlength="12"
            placeholder="例如：113090903217"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        >
      </div>

      <div>
        <label
            class="mb-2 block text-sm font-medium text-slate-700"
        >
          警政署簽審 PDF
          <span class="text-red-500">
            *
          </span>
        </label>

        <input
            type="file"
            accept="application/pdf"
            class="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            @change="handleFileChange"
        >
      </div>

      <div
          v-if="selectedFile"
          class="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600"
      >
        已選擇：

        <span class="font-medium text-slate-900">
          {{ selectedFile.name }}
        </span>
      </div>

      <div
          v-if="parseError"
          class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {{ parseError }}
      </div>

      <div class="flex flex-wrap gap-3">
        <button
            type="button"
            :disabled="isParsing"
            class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            @click="handleParse"
        >
          {{
            isParsing
                ? '解析中...'
                : '解析 PDF'
          }}
        </button>

        <!-- 開發階段暫時保留 -->
        <button
            type="button"
            class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            @click="handleTestSupabase"
        >
          測試 Supabase 連線
        </button>

        <button
            v-if="selectedFile || applicationNo"
            type="button"
            class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            @click="handleReset"
        >
          清除
        </button>
      </div>
    </div>

    <!-- 驗證結果 -->
    <div
        v-if="validationResult"
        class="mt-6"
    >
      <div
          v-if="validationResult.isValid"
          class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
      >
        資料檢查完成，未發現缺漏。
      </div>

      <div
          v-else
          class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        <p class="font-medium">
          發現以下問題：
        </p>

        <ul class="mt-2 list-disc space-y-1 pl-5">
          <li
              v-for="error in validationResult.errors"
              :key="error"
          >
            {{ error }}
          </li>
        </ul>
      </div>
    </div>

    <!-- 公文預覽 -->
    <div
        v-if="permitData"
        class="mt-8 border-t border-slate-200 pt-8"
    >
      <div
          class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <p class="text-sm font-medium text-slate-500">
            解析結果
          </p>

          <h3 class="mt-1 text-lg font-bold text-slate-950">
            公文資料預覽
          </h3>
        </div>

        <div class="text-sm text-slate-500">
          共

          <span class="font-semibold text-slate-900">
            {{ permitData.summary.itemCount }}
          </span>

          筆商品
        </div>
      </div>

      <!-- 公文資料 -->
      <div
          class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div
            class="rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <p
              class="text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            申辦案號
          </p>

          <p
              class="mt-2 break-all font-semibold text-slate-950"
          >
            {{ permitData.applicationNo }}
          </p>
        </div>

        <div
            class="rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <p
              class="text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            簽審核准文號
          </p>

          <p
              class="mt-2 break-all font-semibold text-slate-950"
          >
            {{ permitData.certificateNo }}
          </p>
        </div>

        <div
            class="rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <p
              class="text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            貨品類別
          </p>

          <p
              class="mt-2 font-semibold text-slate-950"
          >
            {{ permitData.goodsType }}
          </p>
        </div>

        <div
            class="rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <p
              class="text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            核准日期
          </p>

          <p
              class="mt-2 font-semibold text-slate-950"
          >
            {{ permitData.issueDate }}
          </p>
        </div>

        <div
            class="rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <p
              class="text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            有效日期
          </p>

          <p
              class="mt-2 font-semibold text-slate-950"
          >
            {{ permitData.expirationDate }}
          </p>
        </div>

        <div
            class="rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <p
              class="text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            申請人
          </p>

          <p
              class="mt-2 font-semibold text-slate-950"
          >
            {{ permitData.applicant }}
          </p>
        </div>
      </div>

      <!-- 商品明細 -->
      <div class="mt-8">
        <div
            class="mb-3 flex items-center justify-between"
        >
          <h4 class="font-semibold text-slate-950">
            商品明細
          </h4>

          <span class="text-sm text-slate-500">
            {{ permitData.items.length }} 筆
          </span>
        </div>

        <div
            class="overflow-x-auto rounded-xl border border-slate-200"
        >
          <table
              class="w-full min-w-[1200px] border-collapse text-left text-sm"
          >
            <thead
                class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
            <tr>
              <th class="px-4 py-3">
                Item
              </th>

              <th class="px-4 py-3">
                C.C.C. Code
              </th>

              <th class="px-4 py-3">
                生產國別
              </th>

              <th class="px-4 py-3">
                廠牌
              </th>

              <th class="px-4 py-3">
                貨品名稱
              </th>

              <th class="px-4 py-3">
                型號
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
                v-for="item in permitData.items"
                :key="`${item.itemNo}-${item.model}`"
                class="align-top hover:bg-slate-50"
            >
              <td
                  class="whitespace-nowrap px-4 py-3 font-medium text-slate-900"
              >
                {{ item.itemNo }}
              </td>

              <td
                  class="whitespace-nowrap px-4 py-3 font-mono text-slate-700"
              >
                {{ item.cccCode }}
              </td>

              <td
                  class="whitespace-nowrap px-4 py-3 text-slate-700"
              >
                {{ item.country }}
              </td>

              <td
                  class="whitespace-nowrap px-4 py-3 text-slate-700"
              >
                {{ item.brand }}
              </td>

              <td
                  class="min-w-[320px] px-4 py-3 text-slate-700"
              >
                {{ item.goodsName }}
              </td>

              <td
                  class="whitespace-nowrap px-4 py-3 font-medium text-slate-900"
              >
                {{ item.model }}
              </td>

              <td
                  class="whitespace-nowrap px-4 py-3 text-slate-700"
              >
                {{ item.reviewResult }}
              </td>
            </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 未登入提示 -->
      <p
          v-if="!currentUser"
          class="mt-6 text-sm text-amber-700"
      >
        PDF 可先解析與預覽，但寫入公文資料庫前需先登入。
      </p>

      <!-- 資料庫寫入結果 -->
      <div
          v-if="saveSuccess"
          class="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
      >
        {{ saveSuccess }}
      </div>

      <div
          v-if="saveError"
          class="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {{ saveError }}
      </div>

      <!-- 操作按鈕 -->
      <div
          class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end"
      >
        <button
            type="button"
            :disabled="isSaving"
            class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            @click="handleReset"
        >
          重新選擇
        </button>

        <button
            type="button"
            :disabled="
            !validationResult?.isValid ||
            !currentUser ||
            isSaving
          "
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            @click="handleSaveToDatabase"
        >
          {{
            !currentUser
                ? '請先登入後寫入資料庫'
                : isSaving
                    ? '寫入中...'
                    : '確認寫入資料庫'
          }}
        </button>
      </div>
    </div>

    <!-- 開發除錯 -->
    <details
        v-if="permitData"
        class="mt-8 rounded-xl border border-slate-200 bg-white"
    >
      <summary
          class="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700"
      >
        開發除錯資訊
      </summary>

      <div
          class="space-y-6 border-t border-slate-200 p-4"
      >
        <div>
          <p
              class="mb-2 text-sm font-medium text-slate-700"
          >
            結構化解析結果
          </p>

          <pre
              class="max-h-[600px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100"
          >{{ JSON.stringify(permitData, null, 2) }}</pre>
        </div>

        <div v-if="parsedPdf">
          <div
              class="mb-3 flex items-center justify-between"
          >
            <p
                class="text-sm font-medium text-slate-700"
            >
              PDF 原始文字
            </p>

            <span class="text-sm text-slate-500">
              {{ parsedPdf.pageCount }} 頁
            </span>
          </div>

          <pre
              class="max-h-[500px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100"
          >{{ parsedPdf.fullText }}</pre>
        </div>
      </div>
    </details>
  </section>
</template>