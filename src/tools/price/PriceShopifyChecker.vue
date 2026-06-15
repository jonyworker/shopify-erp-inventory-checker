<script setup>
import { computed, ref } from 'vue'
import FileUploadCard from '../../components/FileUploadCard.vue'
import ColumnMapper from '../../components/ColumnMapper.vue'
import SummaryCards from '../../components/SummaryCards.vue'
import { downloadCsv, downloadExcel, getColumns, parseDataFile } from '../../utils/fileParser'
import { comparePriceWithShopify } from '../../utils/priceCompare'

const officialFileName = ref('')
const shopifyFileName = ref('')
const officialRows = ref([])
const shopifyRows = ref([])
const officialColumns = ref([])
const shopifyColumns = ref([])
const officialCodeColumn = ref('')
const officialPriceColumn = ref('')
const officialNameColumn = ref('')
const shopifyCodeColumn = ref('')
const shopifyPriceColumn = ref('')
const shopifyNameColumn = ref('')
const results = ref([])
const invalidRows = ref({ official: [], shopify: [] })
const statusFilter = ref('all')
const keyword = ref('')
const errorMessage = ref('')
const exportType = ref('xlsx')

const canCompare = computed(() => {
  return officialRows.value.length &&
    shopifyRows.value.length &&
    officialCodeColumn.value &&
    officialPriceColumn.value &&
    shopifyCodeColumn.value &&
    shopifyPriceColumn.value
})

const filteredResults = computed(() => {
  return results.value.filter(item => {
    const keywordText = keyword.value.toLowerCase().trim()
    const matchStatus = statusFilter.value === 'all' || item.狀態 === statusFilter.value
    const matchKeyword = !keywordText ||
      String(item.品項編碼).toLowerCase().includes(keywordText) ||
      String(item.RRP品項名稱).toLowerCase().includes(keywordText) ||
      String(item.Shopify商品名稱).toLowerCase().includes(keywordText) ||
      String(item.來源工作表).toLowerCase().includes(keywordText)

    return matchStatus && matchKeyword
  })
})

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
      headerKeywords: ['Item', 'SKU', 'Retail Price (TWD) (含稅) (含運費, 營業稅, 入口稅)']
    })
    officialColumns.value = getColumns(officialRows.value)
    autoPickColumns('official')
  } catch (error) {
    errorMessage.value = 'RRP 價目表解析失敗，請確認檔案是否包含 Item 與 Retail Price 欄位。'
    console.error(error)
  }
}

async function handleShopifyFile(file) {
  try {
    resetCompareResult()
    errorMessage.value = ''
    shopifyFileName.value = file.name
    shopifyRows.value = await parseDataFile(file)
    shopifyColumns.value = getColumns(shopifyRows.value)
    autoPickColumns('shopify')
  } catch (error) {
    errorMessage.value = 'Shopify CSV 解析失敗，請確認檔案是否包含 Variant SKU 與 Variant Price 欄位。'
    console.error(error)
  }
}

function resetCompareResult() {
  results.value = []
  invalidRows.value = { official: [], shopify: [] }
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
    officialNameColumn.value = findFirstMatchedColumn(officialColumns.value, ['Description', '品項名稱', '商品名稱', 'Title'])
    return
  }

  shopifyCodeColumn.value = findFirstMatchedColumn(shopifyColumns.value, ['Variant SKU', 'SKU', 'Item', '品項編碼'])
  shopifyPriceColumn.value = findFirstMatchedColumn(shopifyColumns.value, ['Variant Price', 'Price / 台灣', '價格', '售價'])
  shopifyNameColumn.value = findFirstMatchedColumn(shopifyColumns.value, ['Title', '商品名稱', '品項名稱', 'Description'])
}

function handleCompare() {
  if (!canCompare.value) return

  const compared = comparePriceWithShopify({
    officialRows: officialRows.value,
    shopifyRows: shopifyRows.value,
    officialCodeColumn: officialCodeColumn.value,
    officialPriceColumn: officialPriceColumn.value,
    officialNameColumn: officialNameColumn.value,
    shopifyCodeColumn: shopifyCodeColumn.value,
    shopifyPriceColumn: shopifyPriceColumn.value,
    shopifyNameColumn: shopifyNameColumn.value
  })

  results.value = compared.results
  invalidRows.value = compared.invalidRows
}

function handleExport() {
  if (!filteredResults.value.length) return

  if (exportType.value === 'csv') {
    downloadCsv('rrp-shopify-price-compare-result.csv', filteredResults.value)
    return
  }

  downloadExcel('rrp-shopify-price-compare-result.xlsx', filteredResults.value)
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
    'RRP 獨有': 'bg-rose-50 text-rose-700 ring-rose-600/20',
    'Shopify 獨有': 'bg-sky-50 text-sky-700 ring-sky-600/20'
  }

  return classes[status] || 'bg-slate-50 text-slate-700 ring-slate-600/20'
}
</script>

<template>
  <div>
    <header class="mb-8 rounded-2xl bg-white p-6 shadow-sm">
      <div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Price Tool</p>

          <h1 class="mt-2 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
            RRP / Shopify 價格比對工具
          </h1>

          <p class="mt-3 max-w-3xl text-slate-600">
            匯入 RRP 多工作表價目表與 Shopify 商品 CSV，選擇 Item、Retail Price、Variant SKU 與 Variant Price 欄位，系統會自動比對 Shopify 售價是否與 RRP 一致。
          </p>
        </div>
      </div>
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
        description="請上傳 RRP 官方價目表，系統會讀取所有工作表，並保留來源工作表名稱。"
        :filename="officialFileName"
        :row-count="officialRows.length"
        @change="handleOfficialFile"
      />

      <FileUploadCard
        title="Shopify 商品 CSV"
        description="請上傳 Shopify 匯出的商品 CSV，預設比對 Variant SKU 與 Variant Price。"
        :filename="shopifyFileName"
        :row-count="shopifyRows.length"
        @change="handleShopifyFile"
      />
    </section>

    <section class="mt-4 grid gap-4 lg:grid-cols-2">
      <ColumnMapper
        title="RRP 欄位對應"
        :columns="officialColumns"
        sku-label="Item 欄位"
        qty-label="Retail Price 欄位"
        v-model:sku-column="officialCodeColumn"
        v-model:qty-column="officialPriceColumn"
      />

      <ColumnMapper
        title="Shopify 欄位對應"
        :columns="shopifyColumns"
        sku-label="Variant SKU 欄位"
        qty-label="Variant Price 欄位"
        v-model:sku-column="shopifyCodeColumn"
        v-model:qty-column="shopifyPriceColumn"
      />
    </section>

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
        class="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-700 outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
      >
        <option value="xlsx">匯出 XLSX</option>
        <option value="csv">匯出 CSV</option>
      </select>

      <button
        class="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
        :disabled="!filteredResults.length"
        @click="handleExport"
      >
        匯出結果
      </button>
    </section>

    <section v-if="results.length" class="mt-8 space-y-6">
      <SummaryCards
        :summary="summary"
        :labels="{
          total: '比對品項總數',
          matched: '一致',
          different: '數量不一致',
          sourceOnly: 'ERP 獨有',
          targetOnly: 'Shopify 獨有'
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
              <option value="一致">一致</option>
              <option value="價格不一致">價格不一致</option>
              <option value="RRP 獨有">RRP 獨有</option>
              <option value="Shopify 獨有">Shopify 獨有</option>
            </select>
          </div>
        </div>

        <div class="mt-5 overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-4 py-3">品項編碼</th>
                <th class="px-4 py-3">來源工作表</th>
                <th class="px-4 py-3">RRP 品項名稱</th>
                <th class="px-4 py-3">Shopify 商品名稱</th>
                <th class="px-4 py-3 text-right">RRP 價格</th>
                <th class="px-4 py-3 text-right">Shopify 價格</th>
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
                  {{ displayValue(item.RRP品項名稱) }}
                </td>

                <td class="min-w-80 px-4 py-3 text-slate-700">
                  {{ displayValue(item.Shopify商品名稱) }}
                </td>

                <td class="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                  {{ displayValue(item.RRP價格) }}
                </td>

                <td class="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                  {{ displayValue(item.Shopify價格) }}
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
        v-if="invalidRows.official.length || invalidRows.shopify.length"
        class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800"
      >
        <h2 class="font-semibold">有部分資料未納入比對</h2>

        <p class="mt-1">
          RRP 無效資料 {{ invalidRows.official.length }} 筆，Shopify 無效資料 {{ invalidRows.shopify.length }} 筆。常見原因是品項編碼空白、價格空白，或價格格式無法轉成數字。
        </p>
      </section>
    </section>
  </div>
</template>
