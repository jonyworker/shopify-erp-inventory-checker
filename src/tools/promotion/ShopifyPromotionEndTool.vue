<script setup>
import { computed, ref } from 'vue'
import FileUploadCard from '@/components/FileUploadCard.vue'
import { downloadCsv, parseDataFile } from '@/utils/fileParser'
import { buildShopifyPromotionNormalRows } from '@/utils/shopifyPromotionImport'

const shopifyFileName = ref('')
const shopifyRows = ref([])
const removeTagInput = ref('')
const removedTags = ref([])
const errorMessage = ref('')
const keyword = ref('')

const importRows = computed(() =>
  buildShopifyPromotionNormalRows({
    shopifyRows: shopifyRows.value,
    removedTags: removedTags.value
  })
)

const variantCount = computed(() =>
  shopifyRows.value.filter(row => String(row['Variant SKU'] ?? '').trim()).length
)

const compareAtMissingCount = computed(() =>
  shopifyRows.value.filter(row => {
    const sku = String(row['Variant SKU'] ?? '').trim()
    const compareAtPrice = String(row['Variant Compare At Price'] ?? '').trim()
    return sku && !compareAtPrice
  }).length
)

const previewRows = computed(() => {
  const sourceVariantRows = shopifyRows.value.filter(row => {
    const handle = String(row.Handle ?? '').trim()
    const sku = String(row['Variant SKU'] ?? '').trim()
    return handle && sku
  })

  const titleByHandle = new Map()

  shopifyRows.value.forEach(row => {
    const handle = String(row.Handle ?? '').trim()
    const title = String(row.Title ?? '').trim()

    if (handle && title && !titleByHandle.has(handle)) {
      titleByHandle.set(handle, title)
    }
  })

  return importRows.value.map((importRow, index) => {
    const sourceRow = sourceVariantRows[index] || {}
    const handle = String(importRow.Handle ?? sourceRow.Handle ?? '').trim()
    const currentPrice = String(sourceRow['Variant Price'] ?? '').trim()
    const compareAtPrice = String(sourceRow['Variant Compare At Price'] ?? '').trim()
    const restoredPrice = String(importRow['Variant Price'] ?? '').trim()

    return {
      handle,
      sku: String(importRow['Variant SKU'] ?? sourceRow['Variant SKU'] ?? '').trim(),
      title: titleByHandle.get(handle) || String(sourceRow.Title ?? importRow.Title ?? '').trim(),
      currentPrice,
      compareAtPrice,
      restoredPrice,
      canRestore: Boolean(compareAtPrice)
    }
  })
})

const filteredPreviewRows = computed(() => {
  const text = keyword.value.trim().toLowerCase()

  if (!text) return previewRows.value

  return previewRows.value.filter(item =>
    [item.sku, item.title, item.handle]
      .some(value => String(value ?? '').toLowerCase().includes(text))
  )
})

async function handleShopifyFile(file) {
  try {
    errorMessage.value = ''
    keyword.value = ''
    shopifyFileName.value = file.name
    shopifyRows.value = await parseDataFile(file)
  } catch (error) {
    console.error(error)
    errorMessage.value = 'Shopify CSV 解析失敗，請確認檔案為 Shopify 匯出的商品 CSV。'
  }
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

function removeTag(index) {
  removedTags.value.splice(index, 1)
}

function safeFileName() {
  const baseName = shopifyFileName.value.replace(/\.[^.]+$/, '')
  return baseName.replace(/[^\w\-\u4e00-\u9fff]+/g, '_') || 'Promotion'
}

function exportNormalCsv() {
  if (!importRows.value.length) return

  downloadCsv(
    `Shopify_Promotion_NORMAL_${safeFileName()}.csv`,
    importRows.value,
    { withBom: true }
  )
}
</script>

<template>
  <section class="space-y-6">
    <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p class="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Shopify Promotion</p>
      <h2 class="mt-2 text-2xl font-bold text-slate-950">Promotion 商品下架</h2>
      <p class="mt-2 text-sm leading-6 text-slate-500">
        活動結束時使用。先在 Shopify 用活動 Tag 篩選本次活動商品並匯出最新 CSV，再由工具恢復正常售價並移除活動 Tag。
      </p>
    </div>

    <div v-if="errorMessage" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {{ errorMessage }}
    </div>

    <div class="grid gap-5 lg:grid-cols-2">
      <FileUploadCard
        title="Shopify 活動商品 CSV"
        description="請先用活動 Tag 篩選商品，再從 Shopify 匯出最新資料，以保留活動期間變動後的庫存。"
        :filename="shopifyFileName"
        :row-count="shopifyRows.length"
        @change="handleShopifyFile"
      />

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
            class="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
            @click="removeTag(index)"
          >
            {{ tag }} <span class="text-slate-400">×</span>
          </button>
        </div>

        <p class="mt-3 text-xs leading-5 text-slate-500">只移除你指定的 Tag，其他 Shopify Tags 原樣保留。</p>
      </section>
    </div>

    <div class="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
      商品下架會把有效的 <strong>Variant Compare At Price 複製到 Variant Price</strong>，Compare At Price 本身保持不變；庫存與其他資料採用最新 Shopify CSV，Variant Image 不輸出。
    </div>

    <div class="flex justify-end">
      <button
        type="button"
        :disabled="!importRows.length"
        class="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        @click="exportNormalCsv"
      >
        匯出商品下架 CSV
      </button>
    </div>

    <template v-if="shopifyRows.length">
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="rounded-2xl bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Variant 數量</p>
          <p class="mt-2 text-3xl font-bold">{{ variantCount }}</p>
        </div>

        <div class="rounded-2xl bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Compare At Price 空白</p>
          <p class="mt-2 text-3xl font-bold" :class="compareAtMissingCount ? 'text-amber-700' : 'text-emerald-700'">
            {{ compareAtMissingCount }}
          </p>
          <p class="mt-2 text-xs leading-5 text-slate-500">空白的 Variant 不會覆寫 Variant Price。</p>
        </div>
      </div>

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 class="text-base font-bold text-slate-900">下架商品預覽</h3>
            <p class="mt-1 text-xs leading-5 text-slate-500">
              匯出前確認目前活動價與恢復後售價，共 {{ previewRows.length }} 個 Variant。
            </p>
          </div>

          <input
              v-model="keyword"
              type="search"
              placeholder="搜尋 SKU、商品名稱、Handle…"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200 sm:max-w-sm"
          >
        </div>

        <div class="mt-5 overflow-x-auto">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-3 py-3">SKU</th>
              <th class="px-3 py-3">商品</th>
              <th class="px-3 py-3 text-right">目前活動價</th>
              <th class="px-3 py-3 text-right">Compare At Price</th>
              <th class="px-3 py-3 text-right">恢復後售價</th>
              <th class="px-3 py-3">狀態</th>
            </tr>
            </thead>

            <tbody class="divide-y divide-slate-100">
            <tr
                v-for="item in filteredPreviewRows"
                :key="`${item.handle}-${item.sku}`"
                class="align-top hover:bg-slate-50/70"
            >
              <td class="whitespace-nowrap px-3 py-3 font-mono text-xs font-semibold text-slate-800">
                {{ item.sku || '—' }}
              </td>

              <td class="min-w-64 px-3 py-3 text-slate-700">
                <div>{{ item.title || '—' }}</div>
                <div v-if="item.handle" class="mt-1 text-xs text-slate-400">{{ item.handle }}</div>
              </td>

              <td class="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                {{ item.currentPrice || '—' }}
              </td>

              <td class="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                {{ item.compareAtPrice || '—' }}
              </td>

              <td class="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                {{ item.restoredPrice || '—' }}
              </td>

              <td class="whitespace-nowrap px-3 py-3">
                  <span
                      v-if="item.canRestore"
                      class="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
                  >
                    恢復正常售價
                  </span>
                <span
                    v-else
                    class="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20"
                >
                    維持目前售價
                  </span>
              </td>
            </tr>

            <tr v-if="!filteredPreviewRows.length">
              <td colspan="6" class="px-3 py-8 text-center text-sm text-slate-400">
                找不到符合條件的商品。
              </td>
            </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </section>
</template>
