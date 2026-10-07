<script setup>
import { computed, ref, watch } from 'vue'
import FileUploadCard from '@/components/FileUploadCard.vue'
import ColumnMapper from '@/components/ColumnMapper.vue'
import SummaryCards from '@/components/SummaryCards.vue'
import { useCompareResultScroll } from '@/composables/useCompareResultScroll.js'
import { downloadCsv, downloadExcel, getColumns, parseDataFile } from '@/utils/fileParser.js'
import { downloadRrpReview } from '@/utils/rrpReviewExport.js'
import { comparePrice } from '@/utils/priceCompare.js'
import { buildErpPriceUpdateRows, downloadErpPriceUpdateWorkbook } from '@/utils/erpPriceUpdateExport.js'

const officialFileName = ref('')
const erpFileName = ref('')
const officialRows = ref([])
const erpRows = ref([])
const officialColumns = ref([])
const erpColumns = ref([])
const officialCodeColumn = ref('')
const officialPriceColumn = ref('')
const officialNameColumn = ref('')
const erpCodeColumn = ref('')
const erpPriceColumn = ref('')
const erpNameColumn = ref('')
const officialSkuColumn = ref('')
const erpSkuColumn = ref('')
const issues = ref([])
const results = ref([])
const invalidRows = ref({ official: [], erp: [] })
const statusFilter = ref('all')
const keyword = ref('')
const errorMessage = ref('')
const exportType = ref('xlsx')
const erpExportError = ref('')

const {
  summarySection,
  scrollToSummary
} = useCompareResultScroll()

const canCompare = computed(() => {
  return officialRows.value.length &&
      erpRows.value.length &&
      officialCodeColumn.value &&
      officialPriceColumn.value &&
      erpCodeColumn.value &&
      erpPriceColumn.value
})

const filteredResults = computed(() => {
  return results.value.filter(item => {
    const keywordText = keyword.value.toLowerCase().trim()
    const matchStatus = statusFilter.value === 'all' || item.狀態 === statusFilter.value
    const matchKeyword = !keywordText ||
        String(item.品項編碼).toLowerCase().includes(keywordText) ||
        String(item.品項名稱).toLowerCase().includes(keywordText) ||
        String(item.來源工作表).toLowerCase().includes(keywordText)

    return matchStatus && matchKeyword
  })
})

const erpUpdateRows = computed(() => buildErpPriceUpdateRows(results.value))

const canExport = computed(() => {
  if (!results.value.length && !issues.value.length) return false

  if (exportType.value === 'review-xlsx') return issues.value.length > 0

  if (exportType.value === 'erp-xlsx') {
    return erpUpdateRows.value.length > 0
  }

  return filteredResults.value.length > 0
})

watch([officialCodeColumn, officialPriceColumn, officialNameColumn, officialSkuColumn, erpCodeColumn, erpPriceColumn, erpNameColumn, erpSkuColumn], resetCompareResult)

const summary = computed(() => {
  const total = results.value.length

  const matched =
      results.value.filter(item => item.狀態 === '一致').length

  const different =
      results.value.filter(item => item.狀態 === '價格不一致').length

  const sourceOnly =
      results.value.filter(item => item.狀態 === 'RRP 獨有').length

  const targetOnly =
      results.value.filter(item => item.狀態 === 'ERP 獨有').length

  return {
    total,
    matched,
    different,
    sourceOnly,
    targetOnly
  }
})

async function handleOfficialFile(file) {
  try {
    resetCompareResult()
    errorMessage.value = ''
    officialFileName.value = file.name
    officialRows.value = await parseDataFile(file, {
      readAllSheets: true,
      includeSheetName: true,
      includeRowNumber: true,
      includeUnheadedColumns: true,
      headerKeywords: ['Item', 'SKU', 'Retail Price (TWD) (含稅) (含運費, 營業稅, 入口稅)']
    })
    officialColumns.value = getColumns(officialRows.value)
    autoPickColumns('official')
  } catch (error) {
    errorMessage.value = 'PTS TW RRP 價目表解析失敗，請確認檔案是否包含 Item 與 Retail Price 欄位。'
    console.error(error)
  }
}

async function handleErpFile(file) {
  try {
    resetCompareResult()
    errorMessage.value = ''
    erpFileName.value = file.name
    erpRows.value = await parseDataFile(file, {
      includeSheetName: true,
      includeRowNumber: true,
      includeUnheadedColumns: true,
      headerKeywords: ['品項編碼']
    })
    erpColumns.value = getColumns(erpRows.value)
    autoPickColumns('erp')
  } catch (error) {
    errorMessage.value = 'ERP 檔案解析失敗，請確認是否為 CSV、XLSX 或 XLS，並包含品項編碼與出庫單價欄位。'
    console.error(error)
  }
}

function resetCompareResult() {
  results.value = []
  issues.value = []
  erpExportError.value = ''
  invalidRows.value = { official: [], erp: [] }
  statusFilter.value = 'all'
  keyword.value = ''
}

function findFirstMatchedColumn(columns, candidates) {
  return candidates.find(candidate => columns.includes(candidate)) || ''
}

function findRetailPriceColumn(columns) {
  return columns.find(column => {
    return column.includes('Retail Price') || column.includes('RRP') || column.includes('零售價')
  }) || ''
}

function autoPickColumns(type) {
  if (type === 'official') {
    officialCodeColumn.value = findFirstMatchedColumn(officialColumns.value, ['Item', '品項編碼', '商品編號', '可買編碼'])
    officialPriceColumn.value = findRetailPriceColumn(officialColumns.value)
    officialSkuColumn.value = findFirstMatchedColumn(officialColumns.value, ['SKU', '原廠編碼'])
    officialNameColumn.value = findFirstMatchedColumn(officialColumns.value, ['Description', '品項名稱', '商品名稱'])
    return
  }

  erpCodeColumn.value = findFirstMatchedColumn(erpColumns.value, ['品項編碼', 'Item', 'SKU', '商品編號'])
  erpPriceColumn.value = findFirstMatchedColumn(erpColumns.value, ['零售價', '出庫單價', '價格', 'Retail Price'])
  erpNameColumn.value = findFirstMatchedColumn(erpColumns.value, ['廠商產品英文名稱', '產品中文名稱(官網)', '產品英文名稱(官網)', '品項名稱', 'Description', '商品名稱'])
  erpSkuColumn.value = findFirstMatchedColumn(erpColumns.value, ['廠商產品編碼', '原廠編碼', 'SKU'])
}

async function handleCompare() {
  if (!canCompare.value) return

  const compared = comparePrice({
    officialRows: officialRows.value,
    erpRows: erpRows.value,
    officialCodeColumn: officialCodeColumn.value,
    officialPriceColumn: officialPriceColumn.value,
    officialNameColumn: officialNameColumn.value,
    erpCodeColumn: erpCodeColumn.value,
    erpPriceColumn: erpPriceColumn.value,
    erpNameColumn: erpNameColumn.value,
    officialSkuColumn: officialSkuColumn.value,
    erpSkuColumn: erpSkuColumn.value
  })

  issues.value = compared.issues
  results.value = compared.results
  invalidRows.value = compared.invalidRows

  await scrollToSummary()
}

function handleExport() {
  if (exportType.value === 'review-xlsx') {
    downloadRrpReview('RRP-HK-review.xlsx', issues.value, { official: officialFileName.value, erp: erpFileName.value, priceColumn: erpPriceColumn.value })
    return
  }
  if (!results.value.length) return

  if (exportType.value === 'erp-xlsx') {
    if (!erpUpdateRows.value.length) return

    try {
      erpExportError.value = ''
      downloadErpPriceUpdateWorkbook(
        'ERP-price-update.xlsx',
        results.value
      )
    } catch (error) {
      console.error(error)
      erpExportError.value = error?.message || 'ERP 價格更新檔匯出失敗。'
    }
    return
  }

  if (!filteredResults.value.length) return

  if (exportType.value === 'csv') {
    downloadCsv('price-compare-result.csv', exportResultRows(), { withBom: true })
    return
  }

  downloadExcel('price-compare-result.xlsx', exportResultRows())
}

function exportResultRows() {
  return filteredResults.value.map(({ ERP出庫單價, ...rest }) => ({ ...rest, [`ERP價格（${erpPriceColumn.value}）`]: ERP出庫單價 }))
}

function displayValue(value) {
  if (value === '' || value === null || value === undefined) return '-'

  if (typeof value === 'number') {
    return value.toLocaleString('zh-TW')
  }

  return value
}

function getStatusClass(status) {
  const classes = {
    '一致': 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    '價格不一致': 'bg-amber-50 text-amber-700 ring-amber-600/20',
    'RRP 獨有': 'bg-sky-50 text-sky-700 ring-sky-600/20',
    'ERP 獨有': 'bg-rose-50 text-rose-700 ring-rose-600/20'
  }

  return classes[status] || 'bg-slate-50 text-slate-700 ring-slate-600/20'
}
</script>

<template>
  <div>
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
        PRICE
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
        RRP / ERP 價格比對
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
        匯入 PTS TW RRP 多工作表價目表與 ERP 價格檔，
        選擇品項編碼與價格欄位，系統會自動比對 ERP 價格是否與官方價目表一致。
      </p>
    </header>

    <div
        v-if="errorMessage"
        class="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
    >
      {{ errorMessage }}
    </div>

    <section class="grid gap-4 lg:grid-cols-2">
      <FileUploadCard
          title="RRP 價目表"
          description="請上傳官方價目表，系統會讀取所有工作表，並保留來源工作表名稱。"
          :filename="officialFileName"
          :row-count="officialRows.length"
          @change="handleOfficialFile"
      />

      <FileUploadCard
          title="ERP 價格檔"
          description="請上傳 ERP 匯出的價格 Excel，請先匯出品項類型＝商品的資料，預設比對零售價。"
          :filename="erpFileName"
          :row-count="erpRows.length"
          @change="handleErpFile"
      />
    </section>

    <section class="mt-4 grid gap-4 lg:grid-cols-2">
      <ColumnMapper
          title="RRP 欄位對應"
          :columns="officialColumns"
          sku-label="品項編碼欄位"
          qty-label="價目表價格欄位"
          v-model:sku-column="officialCodeColumn"
          v-model:qty-column="officialPriceColumn"
      />

      <ColumnMapper
          title="ERP 欄位對應"
          :columns="erpColumns"
          sku-label="品項編碼欄位"
          qty-label="ERP 價格欄位"
          v-model:sku-column="erpCodeColumn"
          v-model:qty-column="erpPriceColumn"
      />
    </section>

    <section class="mt-4 grid gap-4 lg:grid-cols-2">
      <div v-for="side in ['official', 'erp']" :key="side" class="rounded-2xl bg-white p-5 shadow-sm">
        <h2 class="mb-3 font-semibold">{{ side === 'official' ? 'RRP 商品資訊' : 'ERP 商品資訊' }}</h2>
        <label class="block text-sm">商品名稱欄位</label>
        <select v-if="side === 'official'" v-model="officialNameColumn" class="my-2 w-full rounded border p-2"><option value="">不指定</option><option v-for="col in officialColumns" :key="col">{{ col }}</option></select>
        <select v-else v-model="erpNameColumn" class="my-2 w-full rounded border p-2"><option value="">不指定</option><option v-for="col in erpColumns" :key="col">{{ col }}</option></select>
        <label class="block text-sm">原廠編碼欄位</label>
        <select v-if="side === 'official'" v-model="officialSkuColumn" class="my-2 w-full rounded border p-2"><option value="">不指定</option><option v-for="col in officialColumns" :key="col">{{ col }}</option></select>
        <select v-else v-model="erpSkuColumn" class="my-2 w-full rounded border p-2"><option value="">不指定</option><option v-for="col in erpColumns" :key="col">{{ col }}</option></select>
      </div>
    </section>
    <p class="mt-4 text-sm text-slate-600">ERP 選取價格欄位：{{ erpPriceColumn || '尚未選取' }}。香港確認清單包含所有問題，不受搜尋或狀態篩選影響。重複或異常品項不會匯出至 ERP 更新檔。</p>
    <section class="mt-6 flex flex-wrap items-center gap-3">
      <button
          class="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          :disabled="!canCompare"
          @click="handleCompare"
      >
        開始比對
      </button>

      <select
          v-model="exportType"
          class="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-700 outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:text-slate-300"
          :disabled="!results.length && !issues.length"
      >
        <option value="review-xlsx">香港確認清單（{{ issues.length }} 列）</option>
        <option value="xlsx">比對結果 Excel</option>
        <option value="csv">比對結果 CSV</option>
        <option value="erp-xlsx">ERP 價格更新檔（{{ erpUpdateRows.length }}）</option>
      </select>

      <button
          class="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          :disabled="!canExport"
          @click="handleExport"
      >
        匯出結果
      </button>
    </section>

    <section
        v-if="results.length"
        class="mt-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm leading-6 text-blue-800"
    >
      ERP 價格更新檔只會匯出沒有重複或資料異常的「價格不一致」品項；請先確認 RRP 是已核准且適用的價格，並依 RRP 自動計算 95、92、90、85、88、80、70、75 折價格。欄位順序與 ERP「更改品項」Excel 範本一致，可直接複製資料貼入 ERP。
    </section>

    <section
        v-if="erpExportError"
        class="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
    >
      {{ erpExportError }}
    </section>

    <p v-if="issues.length" class="mt-4 text-sm text-amber-800">共有 {{ issues.length }} 列問題來源可匯出香港確認清單；包含未納入一般結果的缺料號資料。</p>
    <section
        v-if="results.length"
        ref="summarySection"
        class="mt-8 space-y-6 scroll-mt-6"
    >
      <SummaryCards
          :summary="summary"
          :labels="{
            total: '比對品項總數',
            matched: '一致',
            different: '價格不一致',
            sourceOnly: 'RRP 獨有',
            targetOnly: 'ERP 獨有'
          }"
      />

      <section class="rounded-2xl bg-white p-5 shadow-sm">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-slate-900">比對結果</h2>
            <p class="mt-1 text-sm text-slate-500">
              目前顯示 {{ filteredResults.length }} 筆資料
            </p>
          </div>

          <div class="flex flex-col gap-3 md:flex-row">
            <input
                v-model="keyword"
                class="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
                type="search"
                placeholder="搜尋品項編碼、品名或工作表"
            />

            <select
                v-model="statusFilter"
                class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
            >
              <option value="all">全部狀態</option>
              <option value="資料異常待確認">資料異常待確認</option>
              <option value="價格衝突待確認">價格衝突待確認</option>
              <option value="重複料號待確認">重複料號待確認</option>
              <option value="一致">一致</option>
              <option value="價格不一致">價格不一致</option>
              <option value="RRP 獨有">RRP 獨有</option>
              <option value="ERP 獨有">ERP 獨有</option>
            </select>
          </div>
        </div>

        <div class="mt-5 overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">品項編碼</th>
              <th class="px-4 py-3">來源工作表</th>
              <th class="px-4 py-3">品項名稱</th>
              <th class="px-4 py-3 text-right">RRP 價格</th>
              <th class="px-4 py-3 text-right">ERP 價格</th>
              <th class="px-4 py-3 text-right">差異</th>
              <th class="px-4 py-3">狀態</th>
              <th class="px-4 py-3">備註</th>
            </tr>
            </thead>

            <tbody class="divide-y divide-slate-100 bg-white">
            <tr
                v-for="item in filteredResults"
                :key="`${item.品項編碼}-${item.狀態}`"
                class="hover:bg-slate-50"
            >
              <td class="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                {{ item.品項編碼 }}
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-slate-600">
                {{ displayValue(item.來源工作表) }}
              </td>

              <td class="min-w-80 px-4 py-3 text-slate-700">
                {{ displayValue(item.品項名稱) }}
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                {{ displayValue(item.價目表價格) }}
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                {{ displayValue(item.ERP出庫單價) }}
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-900">
                {{ displayValue(item.差異) }}
              </td>

              <td class="whitespace-nowrap px-4 py-3">
                    <span
                        class="inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset"
                        :class="getStatusClass(item.狀態)"
                    >
                      {{ item.狀態 }}
                    </span>
              </td>

              <td class="min-w-64 px-4 py-3 text-slate-500">
                {{ item.備註 }}
              </td>
            </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
          v-if="invalidRows.official.length || invalidRows.erp.length"
          class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800"
      >
        <h2 class="font-semibold">有部分資料未納入比對</h2>

        <p class="mt-1">
          價目表無效資料 {{ invalidRows.official.length }} 筆，ERP 無效資料 {{ invalidRows.erp.length }} 筆。常見原因是品項編碼空白、價格空白，或價格格式無法轉成數字。
        </p>
      </section>
    </section>
  </div>
</template>
