<script setup>
import { computed, ref } from 'vue'
import FileUploadCard from '../../components/FileUploadCard.vue'
import ColumnMapper from '../../components/ColumnMapper.vue'
import SummaryCards from '../../components/SummaryCards.vue'
import { downloadCsv, downloadExcel, getColumns, parseDataFile } from '../../utils/fileParser'
import { compareInventory } from '../../utils/inventory'

const shopifyFileName = ref('')
const erpFileName = ref('')
const shopifyRows = ref([])
const erpRows = ref([])
const shopifyColumns = ref([])
const erpColumns = ref([])
const shopifySkuColumn = ref('')
const shopifyQtyColumn = ref('')
const erpSkuColumn = ref('')
const erpQtyColumn = ref('')
const results = ref([])
const invalidRows = ref({ shopify: [], erp: [] })
const statusFilter = ref('all')
const keyword = ref('')
const errorMessage = ref('')
const exportType = ref('xlsx')

const canCompare = computed(() => {
  return shopifyRows.value.length &&
      erpRows.value.length &&
      shopifySkuColumn.value &&
      shopifyQtyColumn.value &&
      erpSkuColumn.value &&
      erpQtyColumn.value
})

const filteredResults = computed(() => {
  return results.value.filter(item => {
    const matchStatus = statusFilter.value === 'all' || item.status === statusFilter.value
    const matchKeyword = !keyword.value || item.sku.toLowerCase().includes(keyword.value.toLowerCase())

    return matchStatus && matchKeyword
  })
})

const summary = computed(() => {
  const total = results.value.length

  const matched =
      results.value.filter(item => item.status === '一致').length

  const different =
      results.value.filter(item => item.status === '數量不一致').length

  const sourceOnly =
      results.value.filter(item => item.status === 'ERP 獨有').length

  const targetOnly =
      results.value.filter(item => item.status === 'Shopify 獨有').length

  return {
    total,
    matched,
    different,
    sourceOnly,
    targetOnly
  }
})

async function handleShopifyFile(file) {
  try {
    errorMessage.value = ''
    shopifyFileName.value = file.name
    shopifyRows.value = await parseDataFile(file)
    shopifyColumns.value = getColumns(shopifyRows.value)
    autoPickColumns('shopify')
  } catch (error) {
    errorMessage.value = 'Shopify 檔案解析失敗，請確認檔案格式。'
    console.error(error)
  }
}

async function handleErpFile(file) {
  try {
    errorMessage.value = ''
    erpFileName.value = file.name
    erpRows.value = await parseDataFile(file)
    erpColumns.value = getColumns(erpRows.value)
    autoPickColumns('erp')
  } catch (error) {
    errorMessage.value = 'ERP 檔案解析失敗，請確認是否為 CSV、XLSX 或 XLS。'
    console.error(error)
  }
}

function autoPickColumns(type) {
  const columns = type === 'shopify' ? shopifyColumns.value : erpColumns.value
  const skuCandidates = ['Variant SKU', 'SKU', 'sku', '品號', '商品編號', '可買編碼']
  const qtyCandidates = ['Variant Inventory Qty', 'Inventory', 'Qty', 'qty', '庫存', '庫存數量', '數量', '合計']

  const matchedSku = columns.find(column => skuCandidates.includes(column)) || ''
  const matchedQty = columns.find(column => qtyCandidates.includes(column)) || ''

  if (type === 'shopify') {
    shopifySkuColumn.value = matchedSku
    shopifyQtyColumn.value = matchedQty
    return
  }

  erpSkuColumn.value = columns.includes('品項編碼')
      ? '品項編碼'
      : ''

  erpQtyColumn.value = columns.includes('TWSS-STEEL SHOP')
      ? 'TWSS-STEEL SHOP'
      : ''
}

function handleCompare() {
  if (!canCompare.value) return

  const compared = compareInventory({
    shopifyRows: shopifyRows.value,
    erpRows: erpRows.value,
    shopifySkuColumn: shopifySkuColumn.value,
    shopifyQtyColumn: shopifyQtyColumn.value,
    erpSkuColumn: erpSkuColumn.value,
    erpQtyColumn: erpQtyColumn.value
  })

  results.value = compared.results
  invalidRows.value = compared.invalidRows
}

function handleExport() {
  if (!filteredResults.value.length) return

  if (exportType.value === 'csv') {
    downloadCsv('inventory-compare-result.csv', filteredResults.value)
    return
  }

  downloadExcel('inventory-compare-result.xlsx', filteredResults.value)
}

function displayValue(value) {
  return value === '' ? '-' : value
}

function getStatusClass(status) {
  const classes = {
    '一致': 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    '數量不一致': 'bg-amber-50 text-amber-700 ring-amber-600/20',
    'Shopify 獨有': 'bg-rose-50 text-rose-700 ring-rose-600/20',
    'ERP 獨有': 'bg-sky-50 text-sky-700 ring-sky-600/20'
  }

  return classes[status] || 'bg-slate-50 text-slate-700 ring-slate-600/20'
}
</script>

<template>
  <div>
    <header class="mb-8 rounded-2xl bg-white p-6 shadow-sm">
        <p class="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Inventory Tool</p>

        <h1 class="mt-2 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
          ERP / Shopify 庫存比對工具
        </h1>

        <p class="mt-3 max-w-2xl text-slate-600">
          匯入 ERP Excel 與 Shopify CSV，系統會以 ERP 庫存作為比對基準， 快速找出一致、數量不一致、ERP 獨有與 Shopify 獨有的資料。
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
            title="ERP Excel"
            description="請上傳 ERP 匯出的庫存 CSV、XLSX 或 XLS。"
            :filename="erpFileName"
            :row-count="erpRows.length"
            @change="handleErpFile"
        />

        <FileUploadCard
            title="Shopify CSV"
            description="請上傳從 Shopify 匯出的商品或庫存 CSV。"
            :filename="shopifyFileName"
            :row-count="shopifyRows.length"
            @change="handleShopifyFile"
        />
      </section>

      <section class="mt-4 grid gap-4 lg:grid-cols-2">
        <ColumnMapper
            title="ERP 欄位對應"
            :columns="erpColumns"
            v-model:sku-column="erpSkuColumn"
            v-model:qty-column="erpQtyColumn"
        />

        <ColumnMapper
            title="Shopify 欄位對應"
            :columns="shopifyColumns"
            v-model:sku-column="shopifySkuColumn"
            v-model:qty-column="shopifyQtyColumn"
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
            class="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-700 outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:text-slate-300"
            :disabled="!filteredResults.length"
        >
          <option value="xlsx">Excel</option>
          <option value="csv">CSV</option>
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
                  placeholder="搜尋 SKU"
              />

              <select
                  v-model="statusFilter"
                  class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
              >
                <option value="all">全部狀態</option>
                <option value="一致">一致</option>
                <option value="數量不一致">數量不一致</option>
                <option value="ERP 獨有">ERP 獨有</option>
                <option value="Shopify 獨有">Shopify 獨有</option>
              </select>
            </div>
          </div>

          <div class="mt-5 overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-200 text-sm">
              <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-4 py-3">SKU</th>
                <th class="px-4 py-3 text-right">ERP 庫存</th>
                <th class="px-4 py-3 text-right">Shopify 庫存</th>
                <th class="px-4 py-3 text-right">差異</th>
                <th class="px-4 py-3">狀態</th>
                <th class="px-4 py-3">備註</th>
              </tr>
              </thead>

              <tbody class="divide-y divide-slate-100 bg-white">
              <tr
                  v-for="item in filteredResults"
                  :key="`${item.sku}-${item.status}`"
                  class="hover:bg-slate-50"
              >
                <td class="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                  {{ item.sku }}
                </td>

                <td class="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                  {{ displayValue(item.erpQty) }}
                </td>

                <td class="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                  {{ displayValue(item.shopifyQty) }}
                </td>

                <td class="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-900">
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

                <td class="px-4 py-3 text-slate-500">
                  {{ item.note }}
                </td>
              </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section
            v-if="invalidRows.shopify.length || invalidRows.erp.length"
            class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800"
        >
          <h2 class="font-semibold">有部分資料未納入比對</h2>

          <p class="mt-1">
            Shopify SKU 空白 {{ invalidRows.shopify.length }} 筆，ERP SKU 空白 {{ invalidRows.erp.length }} 筆。
          </p>
        </section>
      </section>
  </div>
</template>