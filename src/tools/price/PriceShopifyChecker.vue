<script setup>
import { computed, ref } from 'vue'
import FileUploadCard from '@/components/FileUploadCard.vue'
import ColumnMapper from '@/components/ColumnMapper.vue'
import SummaryCards from '@/components/SummaryCards.vue'
import { SHOPIFY_EXPORT_RULES } from '@/config/exportRules'
import { useCompareResultScroll } from '@/composables/useCompareResultScroll'
import {
  downloadCsv,
  downloadExcel,
  getColumns,
  parseDataFile
} from '@/utils/fileParser'
import { comparePriceWithShopify } from '@/utils/priceCompare'
import { buildShopifyPriceImportRows } from '@/utils/shopifyPriceImport'

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

const invalidRows = ref({
  official: [],
  shopify: []
})

const statusFilter = ref('all')
const keyword = ref('')
const errorMessage = ref('')
const exportType = ref('xlsx')
const shopifyExportMessage = ref('')

const {
  summarySection,
  scrollToSummary
} = useCompareResultScroll()

const canCompare = computed(() => {
  return Boolean(
      officialRows.value.length &&
      shopifyRows.value.length &&
      officialCodeColumn.value &&
      officialPriceColumn.value &&
      shopifyCodeColumn.value &&
      shopifyPriceColumn.value
  )
})

function normalizeStatus(value) {
  return String(value ?? '')
      .trim()
      .toLowerCase()
}

function normalizeHandle(value) {
  return String(value ?? '').trim()
}

function normalizeCode(value) {
  return String(value ?? '')
      .trim()
      .toUpperCase()
}

const excludedStatuses = computed(() => {
  return new Set(
      SHOPIFY_EXPORT_RULES.excludedStatuses.map(normalizeStatus)
  )
})

const excludedShopifyHandles = computed(() => {
  const excludedHandles = new Set()

  shopifyRows.value.forEach(row => {
    const handle = normalizeHandle(row.Handle)
    const status = normalizeStatus(row.Status)

    if (!handle) return

    if (excludedStatuses.value.has(status)) {
      excludedHandles.add(handle)
    }
  })

  return excludedHandles
})

const exportableShopifyRows = computed(() => {
  return shopifyRows.value.filter(row => {
    const handle = normalizeHandle(row.Handle)

    if (!handle) return false

    return !excludedShopifyHandles.value.has(handle)
  })
})

const filteredResults = computed(() => {
  return results.value.filter(item => {
    const keywordText = keyword.value
        .toLowerCase()
        .trim()

    const matchStatus =
        statusFilter.value === 'all' ||
        item.status === statusFilter.value

    const matchKeyword =
        !keywordText ||
        String(item.sku ?? '')
            .toLowerCase()
            .includes(keywordText) ||
        String(item.rrpName ?? '')
            .toLowerCase()
            .includes(keywordText) ||
        String(item.shopifyName ?? '')
            .toLowerCase()
            .includes(keywordText) ||
        String(item.sourceSheet ?? '')
            .toLowerCase()
            .includes(keywordText)

    return matchStatus && matchKeyword
  })
})

/**
 * 建立 Shopify 價格更新 CSV。
 *
 * 即使只篩選出一個 SKU，
 * buildShopifyPriceImportRows 仍會帶出該 SKU
 * 所屬 Handle 下的所有款式。
 */
const shopifyImportRows = computed(() => {
  return buildShopifyPriceImportRows({
    shopifyRows: exportableShopifyRows.value,

    /**
     * 完整比對結果。
     *
     * 用來決定同一 Handle 裡，
     * 所有價格不一致 SKU 的新價格。
     */
    compareResults: results.value,

    /**
     * 畫面篩選結果。
     *
     * 只用來決定這次要輸出哪些 Handle。
     */
    selectedResults: filteredResults.value,

    skuColumn: shopifyCodeColumn.value
  })
})

/**
 * 目前篩選結果命中的 Shopify Handle。
 *
 * filteredResults 只負責選擇商品範圍，
 * 不負責限制同系列內哪些 SKU 可以更新。
 */
const selectedShopifyHandles = computed(() => {
  const selectedSkuSet = new Set(
      filteredResults.value
          .map(item => normalizeCode(item.sku))
          .filter(Boolean)
  )

  const handles = new Set()

  exportableShopifyRows.value.forEach(row => {
    const sku = normalizeCode(row[shopifyCodeColumn.value])
    const handle = normalizeHandle(row.Handle)

    if (
        sku &&
        handle &&
        selectedSkuSet.has(sku)
    ) {
      handles.add(handle)
    }
  })

  return handles
})

/**
 * 目前匯出範圍內，實際會更新價格的 SKU 數量。
 *
 * 篩選結果先決定 Handle，
 * 再從完整 results 中計算該 Handle 內所有價格不一致 SKU。
 */
const priceMismatchCount = computed(() => {
  if (!selectedShopifyHandles.value.size) {
    return 0
  }

  const skuHandleMap = new Map()

  exportableShopifyRows.value.forEach(row => {
    const sku = normalizeCode(row[shopifyCodeColumn.value])
    const handle = normalizeHandle(row.Handle)

    if (sku && handle) {
      skuHandleMap.set(sku, handle)
    }
  })

  return results.value.filter(item => {
    if (item.status !== '價格不一致') {
      return false
    }

    const sku = normalizeCode(item.sku)
    const handle = skuHandleMap.get(sku)

    return (
        handle &&
        selectedShopifyHandles.value.has(handle)
    )
  }).length
})

const excludedProductCount = computed(() => {
  return excludedShopifyHandles.value.size
})

const exportResults = computed(() => {
  return filteredResults.value.map(item => ({
    品項編碼: item.sku,
    來源工作表: item.sourceSheet,
    RRP品項名稱: item.rrpName,
    Shopify商品名稱: item.shopifyName,
    RRP價格: item.rrpPrice,
    Shopify價格: item.shopifyPrice,
    差異: item.diff,
    狀態: item.status,
    備註: item.note
  }))
})

const summary = computed(() => {
  const total = results.value.length

  const matched = results.value.filter(item => {
    return item.status === '一致'
  }).length

  const different = results.value.filter(item => {
    return item.status === '價格不一致'
  }).length

  const sourceOnly = results.value.filter(item => {
    return item.status === 'RRP 獨有'
  }).length

  const targetOnly = results.value.filter(item => {
    return item.status === 'Shopify 獨有'
  }).length

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
      headerKeywords: [
        'Item',
        'SKU',
        'Retail Price (TWD) (含稅) (含運費, 營業稅, 入口稅)'
      ]
    })

    officialColumns.value = getColumns(officialRows.value)

    autoPickColumns('official')
  } catch (error) {
    errorMessage.value =
        'RRP 價目表解析失敗，請確認檔案是否包含 Item 與 Retail Price 欄位。'

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
    errorMessage.value =
        'Shopify CSV 解析失敗，請確認檔案是否包含 Variant SKU、Variant Price、Handle 與 Status 欄位。'

    console.error(error)
  }
}

function resetCompareResult() {
  results.value = []

  invalidRows.value = {
    official: [],
    shopify: []
  }

  statusFilter.value = 'all'
  keyword.value = ''
  shopifyExportMessage.value = ''
}

function findFirstMatchedColumn(columns, candidates) {
  return candidates.find(candidate => {
    return columns.includes(candidate)
  }) || ''
}

function findRetailPriceColumn(columns) {
  return columns.find(column => {
    return column.includes('Retail Price') ||
        column.includes('RRP') ||
        column.includes('零售價')
  }) || ''
}

function autoPickColumns(type) {
  if (type === 'official') {
    officialCodeColumn.value = findFirstMatchedColumn(
        officialColumns.value,
        [
          'Item',
          '品項編碼',
          '商品編號',
          '可買編碼'
        ]
    )

    officialPriceColumn.value = findRetailPriceColumn(
        officialColumns.value
    )

    officialNameColumn.value = findFirstMatchedColumn(
        officialColumns.value,
        [
          'Description',
          '品項名稱',
          '商品名稱',
          'Title'
        ]
    )

    return
  }

  shopifyCodeColumn.value = findFirstMatchedColumn(
      shopifyColumns.value,
      [
        'Variant SKU',
        'SKU',
        'Item',
        '品項編碼'
      ]
  )

  shopifyPriceColumn.value = findFirstMatchedColumn(
      shopifyColumns.value,
      [
        'Variant Price',
        'Price / 台灣',
        '價格',
        '售價'
      ]
  )

  shopifyNameColumn.value = findFirstMatchedColumn(
      shopifyColumns.value,
      [
        'Title',
        '商品名稱',
        '品項名稱',
        'Description'
      ]
  )
}

async function handleCompare() {
  if (!canCompare.value) return

  shopifyExportMessage.value = ''

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

  await scrollToSummary()
}

function handleExport() {
  if (!exportResults.value.length) return

  if (exportType.value === 'csv') {
    downloadCsv(
        'rrp-shopify-price-compare-result.csv',
        exportResults.value
    )

    return
  }

  downloadExcel(
      'rrp-shopify-price-compare-result.xlsx',
      exportResults.value
  )
}

function handleShopifyImportExport() {
  if (!shopifyImportRows.value.length) return

  const now = new Date()

  const yyyy = now.getFullYear()
  const MM = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')

  const HH = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')

  const timestamp =
      `${yyyy}${MM}${dd}_${HH}${mm}`

  let filterText = ''

  if (keyword.value.trim()) {
    filterText = keyword.value.trim()
  } else if (statusFilter.value !== 'all') {
    filterText = statusFilter.value
  }

  filterText = filterText
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')

  const fileName = filterText
      ? `shopify_price_update_${filterText}_${timestamp}.csv`
      : `shopify_price_update_${timestamp}.csv`

  downloadCsv(
      fileName,
      shopifyImportRows.value,
      {
        withBom: true
      }
  )

  const excludedText = excludedProductCount.value
      ? `，另已排除 ${excludedProductCount.value} 個不匯出的 Shopify 商品`
      : ''

  shopifyExportMessage.value =
      `已產生 ${shopifyImportRows.value.length} 筆 Shopify CSV 資料列，` +
      `比對結果共有 ${priceMismatchCount.value} 個價格不一致 SKU` +
      `${excludedText}。`
}

function displayValue(value) {
  if (
      value === '' ||
      value === null ||
      value === undefined
  ) {
    return '-'
  }

  if (typeof value === 'number') {
    return value.toLocaleString('zh-TW')
  }

  return value
}

function getStatusClass(status) {
  const classes = {
    '一致':
        'bg-emerald-50 text-emerald-700 ring-emerald-600/20',

    '價格不一致':
        'bg-amber-50 text-amber-700 ring-amber-600/20',

    'RRP 獨有':
        'bg-rose-50 text-rose-700 ring-rose-600/20',

    'Shopify 獨有':
        'bg-sky-50 text-sky-700 ring-sky-600/20'
  }

  return classes[status] ||
      'bg-slate-50 text-slate-700 ring-slate-600/20'
}
</script>

<template>
  <div>
    <header class="mb-8 rounded-2xl bg-white p-6 shadow-sm">
      <div
          class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between"
      >
        <div>
          <p
              class="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500"
          >
            Price Tool
          </p>

          <h1
              class="mt-2 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl"
          >
            RRP / Shopify 價格比對工具
          </h1>

          <p class="mt-3 max-w-3xl text-slate-600">
            匯入 RRP 多工作表價目表與 Shopify 商品 CSV，
            選擇 Item、Retail Price、Variant SKU 與 Variant Price 欄位，
            系統會自動比對 Shopify 售價是否與 RRP 一致。
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
        <option value="xlsx">
          匯出 XLSX
        </option>

        <option value="csv">
          匯出 CSV
        </option>
      </select>

      <button
          class="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          :disabled="!exportResults.length"
          @click="handleExport"
      >
        匯出結果
      </button>

      <button
          class="ml-auto rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          :disabled="!shopifyImportRows.length"
          @click="handleShopifyImportExport"
      >
        匯出 Shopify 價格更新 CSV
      </button>
    </section>

    <div
        v-if="results.length"
        class="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800"
    >
      <p>
        Shopify 匯入檔會輸出 UTF-8 BOM、逗號分隔 CSV；
        搜尋或狀態篩選只用來決定要輸出的商品 Handle，
        同一 Handle 內其他價格不一致 SKU 也會一併更新。
      </p>

      <p class="mt-1">
        狀態為
        <strong>
          {{ SHOPIFY_EXPORT_RULES.excludedStatuses.join('、') }}
        </strong>
        的商品，會連同相同 Handle 下的所有款式一起排除。
      </p>

      <p class="mt-1 font-medium">
        目前選中的商品共有 {{ priceMismatchCount }} 個 SKU 會更新價格，
        預計輸出 {{ shopifyImportRows.length }} 筆 CSV 資料列。
      </p>

      <p
          v-if="excludedProductCount"
          class="mt-1 font-medium text-amber-700"
      >
        已排除 {{ excludedProductCount }} 個 Shopify 商品。
      </p>

      <p
          v-if="shopifyExportMessage"
          class="mt-1 text-emerald-700"
      >
        {{ shopifyExportMessage }}
      </p>
    </div>

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
          targetOnly: 'Shopify 獨有'
        }"
      />

      <section class="rounded-2xl bg-white p-5 shadow-sm">
        <div
            class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
        >
          <div>
            <h2 class="text-lg font-semibold text-slate-900">
              比對結果
            </h2>

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
              <option value="all">
                全部狀態
              </option>

              <option value="一致">
                一致
              </option>

              <option value="價格不一致">
                價格不一致
              </option>

              <option value="RRP 獨有">
                RRP 獨有
              </option>

              <option value="Shopify 獨有">
                Shopify 獨有
              </option>
            </select>
          </div>
        </div>

        <div class="mt-5 overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead
                class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"
            >
            <tr>
              <th class="px-4 py-3">
                品項編碼
              </th>

              <th class="px-4 py-3">
                來源工作表
              </th>

              <th class="px-4 py-3">
                RRP 品項名稱
              </th>

              <th class="px-4 py-3">
                Shopify 商品名稱
              </th>

              <th class="px-4 py-3 text-right">
                RRP 價格
              </th>

              <th class="px-4 py-3 text-right">
                Shopify 價格
              </th>

              <th class="px-4 py-3 text-right">
                差異
              </th>

              <th class="px-4 py-3">
                狀態
              </th>

              <th class="px-4 py-3">
                備註
              </th>
            </tr>
            </thead>

            <tbody class="divide-y divide-slate-100 bg-white">
            <tr
                v-for="item in filteredResults"
                :key="`${item.sku}-${item.status}`"
                class="hover:bg-slate-50"
            >
              <td
                  class="whitespace-nowrap px-4 py-3 font-medium text-slate-900"
              >
                {{ item.sku }}
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-slate-600">
                {{ displayValue(item.sourceSheet) }}
              </td>

              <td class="min-w-80 px-4 py-3 text-slate-700">
                {{ displayValue(item.rrpName) }}
              </td>

              <td class="min-w-80 px-4 py-3 text-slate-700">
                {{ displayValue(item.shopifyName) }}
              </td>

              <td
                  class="whitespace-nowrap px-4 py-3 text-right text-slate-700"
              >
                {{ displayValue(item.rrpPrice) }}
              </td>

              <td
                  class="whitespace-nowrap px-4 py-3 text-right text-slate-700"
              >
                {{ displayValue(item.shopifyPrice) }}
              </td>

              <td
                  class="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-900"
              >
                {{ displayValue(item.diff) }}
              </td>

              <td class="whitespace-nowrap px-4 py-3">
                  <span
                      class="inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset"
                      :class="getStatusClass(item.status)"
                  >
                    {{ item.status }}
                  </span>
              </td>

              <td class="min-w-64 px-4 py-3 text-slate-500">
                {{ displayValue(item.note) }}
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
        <h2 class="font-semibold">
          有部分資料未納入比對
        </h2>

        <p class="mt-1">
          RRP 無效資料 {{ invalidRows.official.length }} 筆，
          Shopify 無效資料 {{ invalidRows.shopify.length }} 筆。
          常見原因是品項編碼空白、價格空白，或價格格式無法轉成數字。
        </p>
      </section>
    </section>
  </div>
</template>
