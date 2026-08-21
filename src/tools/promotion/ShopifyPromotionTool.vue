<script setup>
import { computed, ref } from 'vue'
import FileUploadCard from '@/components/FileUploadCard.vue'
import { downloadCsv, downloadExcel, parseDataFile } from '@/utils/fileParser'
import {
  buildPromotionIssueRows,
  buildShopifyPromotionImportRows,
  buildShopifyPromotionEndRows,
  comparePromotionWithShopify,
  parsePromotionWorkbook
} from '@/utils/shopifyPromotionImport'

const promotionFileName = ref('')
const shopifyFileName = ref('')
const promotionSheets = ref([])
const selectedSheet = ref('')
const shopifyRows = ref([])
const results = ref([])
const errorMessage = ref('')
const keyword = ref('')
const statusFilter = ref('all')
const tagInput = ref('')
const addedTags = ref([])

const endShopifyFileName = ref('')
const endShopifyRows = ref([])
const removeTagInput = ref('')
const removedTags = ref([])
const endErrorMessage = ref('')

const selectedPromotionRows = computed(() => promotionSheets.value.find(sheet => sheet.name === selectedSheet.value)?.rows || [])
const canCompare = computed(() => selectedPromotionRows.value.length > 0 && shopifyRows.value.length > 0)

const summary = computed(() => ({
  total: results.value.length,
  ready: results.value.filter(item => item.status === 'ready').length,
  notPublished: results.value.filter(item => item.status === 'not-published').length,
  missing: results.value.filter(item => item.status === 'missing').length,
  duplicate: results.value.filter(item => item.status === 'duplicate-shopify' || item.status === 'promotion-duplicate').length
}))

const filteredResults = computed(() => {
  const text = keyword.value.trim().toLowerCase()

  return results.value.filter(item => {
    const matchStatus = statusFilter.value === 'all' || item.status === statusFilter.value
    const matchKeyword = !text || [item.sku, item.name, item.shopifyTitle, item.handle, item.statusLabel]
        .some(value => String(value ?? '').toLowerCase().includes(text))

    return matchStatus && matchKeyword
  })
})

const startImportRows = computed(() =>
    buildShopifyPromotionImportRows({
      shopifyRows: shopifyRows.value,
      compareResults: results.value,
      addedTags: addedTags.value
    })
)

const endImportRows = computed(() =>
    buildShopifyPromotionEndRows({
      shopifyRows: endShopifyRows.value,
      removedTags: removedTags.value
    })
)

const endVariantCount = computed(() =>
    endShopifyRows.value.filter(row => String(row['Variant SKU'] ?? '').trim()).length
)

const endCompareAtMissingCount = computed(() =>
    endShopifyRows.value.filter(row => {
      const sku = String(row['Variant SKU'] ?? '').trim()
      const compareAtPrice = String(row['Variant Compare At Price'] ?? '').trim()
      return sku && !compareAtPrice
    }).length
)

const issueRows = computed(() =>
    buildPromotionIssueRows(results.value)
)

function resetResults() {
  results.value = []
  keyword.value = ''
  statusFilter.value = 'all'
}

async function handlePromotionFile(file) {
  try {
    errorMessage.value = ''
    resetResults()
    promotionFileName.value = file.name
    promotionSheets.value = await parsePromotionWorkbook(file)
    selectedSheet.value = promotionSheets.value[0]?.name || ''
  } catch (error) {
    console.error(error)
    errorMessage.value = 'Promotion Excel 解析失敗，請確認工作表包含「品項編碼」與活動價格欄位。'
  }
}

async function handleShopifyFile(file) {
  try {
    errorMessage.value = ''
    resetResults()
    shopifyFileName.value = file.name
    shopifyRows.value = await parseDataFile(file)
  } catch (error) {
    console.error(error)
    errorMessage.value = 'Shopify CSV 解析失敗，請確認檔案為 Shopify All Products 匯出格式。'
  }
}

async function handleEndShopifyFile(file) {
  try {
    endErrorMessage.value = ''
    endShopifyFileName.value = file.name
    endShopifyRows.value = await parseDataFile(file)
  } catch (error) {
    console.error(error)
    endErrorMessage.value = '活動結束 CSV 解析失敗，請確認檔案為 Shopify 匯出的商品 CSV。'
  }
}

function runCompare() {
  if (!canCompare.value) return

  results.value = comparePromotionWithShopify({
    promotionRows: selectedPromotionRows.value,
    shopifyRows: shopifyRows.value
  }).results
}

function addTag() {
  tagInput.value
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean)
      .forEach(tag => {
        const exists = addedTags.value.some(current => current.toLowerCase() === tag.toLowerCase())
        if (!exists) addedTags.value.push(tag)
      })

  tagInput.value = ''
}

function handleTagKeydown(event) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    addTag()
  }
}

function removeTag(index) {
  addedTags.value.splice(index, 1)
}

function addRemoveTag() {
  removeTagInput.value
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean)
      .forEach(tag => {
        const exists = removedTags.value.some(current => current.toLowerCase() === tag.toLowerCase())
        if (!exists) removedTags.value.push(tag)
      })

  removeTagInput.value = ''
}

function handleRemoveTagKeydown(event) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    addRemoveTag()
  }
}

function removeEndTag(index) {
  removedTags.value.splice(index, 1)
}

function safeSheetName() {
  return selectedSheet.value.replace(/[^\w\-\u4e00-\u9fff]+/g, '_')
}

function safeEndFileName() {
  const baseName = endShopifyFileName.value
      .replace(/\.[^.]+$/, '')
      .replace(/^Shopify_Promotion_END_SOURCE_/i, '')
      .replace(/^Shopify_Promotion_END_/i, '')
      .replace(/^Shopify_Promotion_NORMAL_/i, '')

  return baseName.replace(/[^\w\-\u4e00-\u9fff]+/g, '_') || 'Promotion'
}

function exportStartCsv() {
  if (!startImportRows.value.length) return

  downloadCsv(
      `Shopify_Promotion_START_${safeSheetName()}.csv`,
      startImportRows.value,
      { withBom: true }
  )
}

function exportEndCsv() {
  if (!endImportRows.value.length) return

  downloadCsv(
      `Shopify_Promotion_END_${safeEndFileName()}.csv`,
      endImportRows.value,
      { withBom: true }
  )
}

function exportIssues() {
  if (!issueRows.value.length) return

  downloadExcel(
      `Promotion_Issues_${safeSheetName()}.xlsx`,
      issueRows.value
  )
}

function badgeClass(status) {
  const classes = {
    ready: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    'not-published': 'bg-amber-50 text-amber-700 ring-amber-600/20',
    missing: 'bg-rose-50 text-rose-700 ring-rose-600/20',
    'duplicate-shopify': 'bg-violet-50 text-violet-700 ring-violet-600/20',
    'promotion-duplicate': 'bg-violet-50 text-violet-700 ring-violet-600/20'
  }

  return classes[status] || 'bg-slate-50 text-slate-700 ring-slate-600/20'
}
</script>

<template>
  <section class="space-y-6">
    <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p class="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Shopify Promotion</p>
      <h2 class="mt-2 text-2xl font-bold text-slate-950">活動商品上架</h2>
      <p class="mt-2 text-sm leading-6 text-slate-500">
        START 用 Promotion 優惠價啟動活動；END 使用活動結束時 Shopify 最新匯出資料恢復正常售價。
      </p>
    </div>

    <section class="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Start</p>
        <h3 class="mt-1 text-xl font-bold text-slate-950">活動開始</h3>
        <p class="mt-2 text-sm leading-6 text-slate-500">
          Variant Price 改為 Promotion 優惠價；Variant Compare At Price 視為公司 RRP 並保持不變。
        </p>
      </div>

      <div v-if="errorMessage" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {{ errorMessage }}
      </div>

      <div class="grid gap-5 lg:grid-cols-2">
        <FileUploadCard
            title="Promotion Excel"
            description="讀取活動 SKU 與表格中的優惠價格；支援同工作表多個折扣區段。"
            :filename="promotionFileName"
            :row-count="selectedPromotionRows.length"
            @change="handlePromotionFile"
        />

        <FileUploadCard
            title="Shopify All Products"
            description="使用 Shopify 匯出的完整商品 CSV，比對 Variant SKU、商品狀態與 Tags。"
            :filename="shopifyFileName"
            :row-count="shopifyRows.length"
            @change="handleShopifyFile"
        />
      </div>

      <div class="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <section class="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
          <label class="block text-sm font-semibold text-slate-800">選擇 Promotion Excel 工作表</label>
          <select
              v-model="selectedSheet"
              class="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
              @change="resetResults"
          >
            <option v-for="sheet in promotionSheets" :key="sheet.name" :value="sheet.name">
              {{ sheet.name }}（{{ sheet.rows.length }} SKU）
            </option>
          </select>
          <p class="mt-3 text-xs leading-5 text-slate-500">價格直接採用 Promotion 表格中的活動價格，不自行計算折扣。</p>
        </section>

        <section class="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
          <label class="block text-sm font-semibold text-slate-800">新增活動 Tags</label>
          <div class="mt-2 flex gap-2">
            <input
                v-model="tagInput"
                type="text"
                placeholder="例如：2026_AUG_DOUBLE"
                class="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
                @keydown="handleTagKeydown"
            >
            <button type="button" class="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700" @click="addTag">
              新增
            </button>
          </div>

          <div v-if="addedTags.length" class="mt-3 flex flex-wrap gap-2">
            <button
                v-for="(tag, index) in addedTags"
                :key="`${tag}-${index}`"
                type="button"
                class="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                @click="removeTag(index)"
            >
              {{ tag }} <span class="text-slate-400">×</span>
            </button>
          </div>

          <p class="mt-3 text-xs leading-5 text-slate-500">活動 Tag 會追加到原 Tags；活動結束後可用同一 Tag 找出商品並移除。</p>
        </section>
      </div>

      <div class="flex justify-start">
        <button
            type="button"
            :disabled="!canCompare"
            class="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            @click="runCompare"
        >
          開始比對
        </button>
      </div>

      <template v-if="results.length">
        <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <div class="rounded-2xl bg-slate-50 p-5"><p class="text-sm text-slate-500">活動 SKU</p><p class="mt-2 text-3xl font-bold">{{ summary.total }}</p></div>
          <div class="rounded-2xl bg-slate-50 p-5"><p class="text-sm text-slate-500">正常上架</p><p class="mt-2 text-3xl font-bold text-emerald-700">{{ summary.ready }}</p></div>
          <div class="rounded-2xl bg-slate-50 p-5"><p class="text-sm text-slate-500">未正常上架</p><p class="mt-2 text-3xl font-bold text-amber-700">{{ summary.notPublished }}</p></div>
          <div class="rounded-2xl bg-slate-50 p-5"><p class="text-sm text-slate-500">Shopify 找不到</p><p class="mt-2 text-3xl font-bold text-rose-700">{{ summary.missing }}</p></div>
          <div class="rounded-2xl bg-slate-50 p-5"><p class="text-sm text-slate-500">重複 SKU</p><p class="mt-2 text-3xl font-bold text-violet-700">{{ summary.duplicate }}</p></div>
        </section>

        <section class="rounded-2xl border border-slate-200 p-5">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="flex flex-1 flex-col gap-3 sm:flex-row">
              <input v-model="keyword" type="search" placeholder="搜尋 SKU、商品名稱、Handle…" class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200 sm:max-w-md">
              <select v-model="statusFilter" class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none">
                <option value="all">全部狀態</option>
                <option value="ready">正常上架</option>
                <option value="not-published">未正常上架</option>
                <option value="missing">Shopify 找不到</option>
                <option value="duplicate-shopify">Shopify SKU 重複</option>
                <option value="promotion-duplicate">Promotion SKU 重複</option>
              </select>
            </div>

            <div class="flex flex-wrap gap-2">
              <button type="button" :disabled="!issueRows.length" class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40" @click="exportIssues">
                匯出異常清單 Excel
              </button>
              <button type="button" :disabled="!startImportRows.length" class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40" @click="exportStartCsv">
                匯出 START CSV
              </button>
            </div>
          </div>

          <div class="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
            START 只把活動 SKU 的 <strong>Variant Price</strong> 改成 Promotion 優惠價；<strong>Variant Compare At Price 保持原值</strong>。同商品其他 Variant 會一併帶出但價格不變，Variant Image 不輸出。
          </div>

          <div class="mt-5 overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr><th class="px-3 py-3">SKU</th><th class="px-3 py-3">Promotion 商品</th><th class="px-3 py-3">Shopify 商品</th><th class="px-3 py-3 text-right">Shopify 價格</th><th class="px-3 py-3 text-right">活動價</th><th class="px-3 py-3">狀態</th></tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
              <tr v-for="item in filteredResults" :key="`${item.sku}-${item.sourceRow}`" class="align-top hover:bg-slate-50/70">
                <td class="whitespace-nowrap px-3 py-3 font-mono text-xs font-semibold text-slate-800">{{ item.sku }}</td>
                <td class="min-w-64 px-3 py-3 text-slate-700"><div>{{ item.name || '—' }}</div><div class="mt-1 text-xs text-slate-400">{{ item.discountLabel }}</div></td>
                <td class="min-w-64 px-3 py-3 text-slate-700"><div>{{ item.shopifyTitle || '—' }}</div><div v-if="item.handle" class="mt-1 text-xs text-slate-400">{{ item.handle }}</div><div v-else-if="item.handles?.length" class="mt-1 text-xs text-slate-400">{{ item.handles.join(' / ') }}</div></td>
                <td class="whitespace-nowrap px-3 py-3 text-right tabular-nums">{{ item.shopifyPrice ?? '—' }}</td>
                <td class="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">{{ item.promotionPrice }}</td>
                <td class="min-w-48 px-3 py-3"><span class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset" :class="badgeClass(item.status)">{{ item.statusLabel }}</span><div v-if="item.note" class="mt-2 text-xs leading-5 text-slate-500">{{ item.note }}</div></td>
              </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </section>

    <section class="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">End</p>
        <h3 class="mt-1 text-xl font-bold text-slate-950">活動結束</h3>
        <p class="mt-2 text-sm leading-6 text-slate-500">
          先在 Shopify 用活動 Tag 篩選本次活動商品並重新匯出最新 CSV。這份最新資料會保留活動期間變動後的庫存。
        </p>
      </div>

      <div v-if="endErrorMessage" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {{ endErrorMessage }}
      </div>

      <div class="grid gap-5 lg:grid-cols-2">
        <FileUploadCard
            title="活動結束 Shopify CSV"
            description="請先用活動 Tag 篩選商品，再從 Shopify 匯出最新資料。"
            :filename="endShopifyFileName"
            :row-count="endShopifyRows.length"
            @change="handleEndShopifyFile"
        />

        <section class="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
          <label class="block text-sm font-semibold text-slate-800">移除活動 Tags</label>
          <div class="mt-2 flex gap-2">
            <input
                v-model="removeTagInput"
                type="text"
                placeholder="輸入要移除的活動 Tag"
                class="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
                @keydown="handleRemoveTagKeydown"
            >
            <button type="button" class="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700" @click="addRemoveTag">
              新增
            </button>
          </div>

          <div v-if="removedTags.length" class="mt-3 flex flex-wrap gap-2">
            <button
                v-for="(tag, index) in removedTags"
                :key="`${tag}-${index}`"
                type="button"
                class="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                @click="removeEndTag(index)"
            >
              {{ tag }} <span class="text-slate-400">×</span>
            </button>
          </div>

          <p class="mt-3 text-xs leading-5 text-slate-500">只移除你指定的 Tag，其他 Shopify Tags 原樣保留。</p>
        </section>
      </div>

      <div v-if="endShopifyRows.length" class="grid gap-4 sm:grid-cols-2">
        <div class="rounded-2xl bg-slate-50 p-5">
          <p class="text-sm text-slate-500">Variant 數量</p>
          <p class="mt-2 text-3xl font-bold">{{ endVariantCount }}</p>
        </div>
        <div class="rounded-2xl bg-slate-50 p-5">
          <p class="text-sm text-slate-500">Compare At Price 空白</p>
          <p class="mt-2 text-3xl font-bold" :class="endCompareAtMissingCount ? 'text-amber-700' : 'text-emerald-700'">{{ endCompareAtMissingCount }}</p>
          <p class="mt-2 text-xs leading-5 text-slate-500">空白的 Variant 不會覆寫 Variant Price。</p>
        </div>
      </div>

      <div class="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
        END 會把有效的 <strong>Variant Compare At Price 複製到 Variant Price</strong>，Compare At Price 本身保持不變；庫存與其他目前資料採用你剛匯出的最新 Shopify CSV，Variant Image 不輸出。
      </div>

      <div class="flex justify-start">
        <button
            type="button"
            :disabled="!endImportRows.length"
            class="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            @click="exportEndCsv"
        >
          匯出 END CSV
        </button>
      </div>
    </section>
  </section>
</template>
