<script setup>
import { computed, ref } from 'vue'
import FileUploadCard from '@/components/FileUploadCard.vue'
import { getColumns, parseDataFile } from '@/utils/fileParser'
import {
  calculatePromotionRows,
  downloadPromotionPriceWorkbook,
  parsePromotionSourceWorkbook
} from '@/utils/promotionPriceBuilder'

const promotionFileName = ref('')
const rrpFileName = ref('')
const promotionSheets = ref([])
const rrpRows = ref([])
const rrpColumns = ref([])
const rrpSkuColumn = ref('')
const rrpPriceColumn = ref('')
const rrpNameColumn = ref('')
const resultsBySheet = ref([])
const errorMessage = ref('')

const promotionCount = computed(() =>
  promotionSheets.value.reduce((sum, sheet) => sum + sheet.rows.length, 0)
)

const resultRows = computed(() => resultsBySheet.value.flatMap(sheet => sheet.rows))

const summary = computed(() => ({
  total: resultRows.value.length,
  ready: resultRows.value.filter(item => item.status === 'ready').length,
  missing: resultRows.value.filter(item => item.status === 'rrp-missing').length,
  discountMissing: resultRows.value.filter(item => item.status === 'discount-missing').length,
  conflict: resultRows.value.filter(item => item.status === 'rrp-conflict').length
}))

const canBuild = computed(() => Boolean(
  promotionCount.value &&
  rrpRows.value.length &&
  rrpSkuColumn.value &&
  rrpPriceColumn.value
))

const canExport = computed(() => summary.value.ready > 0)

function normalizeColumn(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function guessColumn(columns, patterns) {
  return columns.find(column => {
    const value = normalizeColumn(column)
    return patterns.some(pattern => pattern.test(value))
  }) || ''
}

function resetResults() {
  resultsBySheet.value = []
}

async function handlePromotionFile(file) {
  try {
    errorMessage.value = ''
    resetResults()
    promotionFileName.value = file.name
    promotionSheets.value = await parsePromotionSourceWorkbook(file)
  } catch (error) {
    console.error(error)
    errorMessage.value = error?.message || 'Promotion Excel 解析失敗。'
  }
}

async function handleRrpFile(file) {
  try {
    errorMessage.value = ''
    resetResults()
    rrpFileName.value = file.name
    rrpRows.value = await parseDataFile(file, {
      readAllSheets: true,
      includeSheetName: true
    })
    rrpColumns.value = getColumns(rrpRows.value)

    rrpSkuColumn.value = guessColumn(rrpColumns.value, [
      /^品項編碼$/,
      /^item$/,
      /item code/,
      /sku/
    ])

    rrpPriceColumn.value = guessColumn(rrpColumns.value, [
      /retail price/,
      /零售價/,
      /建議售價/,
      /含稅.*價格/,
      /price/
    ])

    rrpNameColumn.value = guessColumn(rrpColumns.value, [
      /^品項名稱$/,
      /product name/,
      /item name/,
      /description/
    ])
  } catch (error) {
    console.error(error)
    errorMessage.value = 'RRP 解析失敗，請確認檔案格式。'
  }
}

function runBuild() {
  if (!canBuild.value) return

  resultsBySheet.value = promotionSheets.value.map(sheet => ({
    name: sheet.name,
    rows: calculatePromotionRows({
      promotionRows: sheet.rows,
      rrpRows: rrpRows.value,
      skuColumn: rrpSkuColumn.value,
      priceColumn: rrpPriceColumn.value,
      nameColumn: rrpNameColumn.value
    })
  }))
}

function safeBaseName() {
  return promotionFileName.value
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\-\u4e00-\u9fff.]+/g, '_') || 'Promotion'
}

function exportWorkbook() {
  if (!canExport.value) return

  downloadPromotionPriceWorkbook(
    `${safeBaseName()}_with_price.xlsx`,
    resultsBySheet.value
  )
}

function badgeClass(status) {
  const classes = {
    ready: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    'rrp-missing': 'bg-rose-50 text-rose-700 ring-rose-600/20',
    'discount-missing': 'bg-amber-50 text-amber-700 ring-amber-600/20',
    'rrp-conflict': 'bg-violet-50 text-violet-700 ring-violet-600/20'
  }

  return classes[status] || 'bg-slate-50 text-slate-700 ring-slate-600/20'
}
</script>

<template>
  <section class="space-y-6">
    <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p class="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Promotion Price Builder</p>
      <h2 class="mt-2 text-2xl font-bold text-slate-950">Promotion 價格產生器</h2>
      <p class="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
        香港新版 Promotion 只有 SKU 與折扣百分比時使用。系統會用 SKU 到 RRP 取得 Retail Price，再依 12% OFF 等區段折扣計算優惠價，產生可直接匯入「Promotion 商品上架」的 Excel。
      </p>
    </div>

    <div v-if="errorMessage" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {{ errorMessage }}
    </div>

    <div class="grid gap-5 lg:grid-cols-2">
      <FileUploadCard
        title="香港 Promotion Excel"
        description="讀取品項編碼、品項名稱、庫存欄位，以及 12% OFF 這類折扣區段。"
        :filename="promotionFileName"
        :row-count="promotionCount"
        @change="handlePromotionFile"
      />

      <FileUploadCard
        title="PTS TW RRP"
        description="讀取所有工作表，用 SKU 對應 Retail Price。"
        :filename="rrpFileName"
        :row-count="rrpRows.length"
        @change="handleRrpFile"
      />
    </div>

    <section v-if="rrpColumns.length" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="mb-4">
        <h3 class="text-lg font-semibold text-slate-900">RRP 欄位確認</h3>
        <p class="mt-1 text-sm text-slate-500">系統會先自動猜欄位；若香港或 RRP 欄名改動，可在這裡手動指定。</p>
      </div>

      <div class="grid gap-4 md:grid-cols-3">
        <label class="block">
          <span class="mb-1 block text-sm font-medium text-slate-700">SKU / 品項編碼</span>
          <select v-model="rrpSkuColumn" class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
            <option value="">請選擇</option>
            <option v-for="column in rrpColumns" :key="column" :value="column">{{ column }}</option>
          </select>
        </label>

        <label class="block">
          <span class="mb-1 block text-sm font-medium text-slate-700">Retail Price</span>
          <select v-model="rrpPriceColumn" class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
            <option value="">請選擇</option>
            <option v-for="column in rrpColumns" :key="column" :value="column">{{ column }}</option>
          </select>
        </label>

        <label class="block">
          <span class="mb-1 block text-sm font-medium text-slate-700">品項名稱（選填）</span>
          <select v-model="rrpNameColumn" class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
            <option value="">不指定</option>
            <option v-for="column in rrpColumns" :key="column" :value="column">{{ column }}</option>
          </select>
        </label>
      </div>
    </section>

    <div class="flex flex-wrap gap-3">
      <button
        type="button"
        :disabled="!canBuild"
        class="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        @click="runBuild"
      >
        計算 Promotion 價格
      </button>

      <button
        v-if="resultRows.length"
        type="button"
        :disabled="!canExport"
        class="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        @click="exportWorkbook"
      >
        匯出可上架 Promotion Excel
      </button>
    </div>

    <template v-if="resultRows.length">
      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div class="rounded-2xl bg-white p-5 shadow-sm"><p class="text-sm text-slate-500">Promotion SKU</p><p class="mt-2 text-3xl font-bold text-slate-900">{{ summary.total }}</p></div>
        <div class="rounded-2xl bg-white p-5 shadow-sm"><p class="text-sm text-slate-500">可匯出</p><p class="mt-2 text-3xl font-bold text-emerald-700">{{ summary.ready }}</p></div>
        <div class="rounded-2xl bg-white p-5 shadow-sm"><p class="text-sm text-slate-500">RRP 找不到</p><p class="mt-2 text-3xl font-bold text-rose-700">{{ summary.missing }}</p></div>
        <div class="rounded-2xl bg-white p-5 shadow-sm"><p class="text-sm text-slate-500">折扣缺失</p><p class="mt-2 text-3xl font-bold text-amber-700">{{ summary.discountMissing }}</p></div>
        <div class="rounded-2xl bg-white p-5 shadow-sm"><p class="text-sm text-slate-500">RRP 衝突</p><p class="mt-2 text-3xl font-bold text-violet-700">{{ summary.conflict }}</p></div>
      </section>

      <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="min-w-[980px] w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th class="px-4 py-3">工作表</th>
                <th class="px-4 py-3">SKU</th>
                <th class="px-4 py-3">品項名稱</th>
                <th class="px-4 py-3 text-right">RRP</th>
                <th class="px-4 py-3 text-right">折扣</th>
                <th class="px-4 py-3 text-right">優惠價</th>
                <th class="px-4 py-3">狀態</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-slate-700">
              <tr v-for="item in resultRows" :key="`${item.sourceSheet}-${item.sourceRow}-${item.sku}`">
                <td class="px-4 py-3 text-xs text-slate-500">{{ item.sourceSheet }}</td>
                <td class="px-4 py-3 font-medium text-slate-900">{{ item.sku }}</td>
                <td class="max-w-[360px] px-4 py-3">{{ item.name || item.rrpName || '—' }}</td>
                <td class="px-4 py-3 text-right tabular-nums">{{ item.retailPrice ?? '—' }}</td>
                <td class="px-4 py-3 text-right tabular-nums">{{ item.discountPercent !== null ? `${item.discountPercent}%` : '—' }}</td>
                <td class="px-4 py-3 text-right font-semibold tabular-nums">{{ item.promotionPrice ?? '—' }}</td>
                <td class="px-4 py-3">
                  <span class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset" :class="badgeClass(item.status)">
                    {{ item.statusLabel }}
                  </span>
                  <p v-if="item.note" class="mt-1 max-w-[260px] text-xs leading-5 text-slate-500">{{ item.note }}</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white p-5 text-xs leading-6 text-slate-500 shadow-sm">
        <p class="font-semibold text-slate-700">計算規則</p>
        <p class="mt-1">優惠價 = RRP × (1 − 折扣百分比)，最後四捨五入到新台幣 1 元。RRP 找不到、折扣缺失或同 SKU 有價格衝突的資料不會匯出。</p>
      </section>
    </template>
  </section>
</template>
