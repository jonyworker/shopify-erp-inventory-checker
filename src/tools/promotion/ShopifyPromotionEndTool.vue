<script setup>
import { computed, ref } from 'vue'
import FileUploadCard from '@/components/FileUploadCard.vue'
import { downloadCsv, parseDataFile } from '@/utils/fileParser'
import { buildShopifyPromotionEndRows } from '@/utils/shopifyPromotionImport'

const shopifyFileName = ref('')
const shopifyRows = ref([])

const removeTagInput = ref('')
const removedTags = ref([])

const errorMessage = ref('')
const keyword = ref('')

/**
 * 按下「產生下架預覽」後，
 * 才把當下的處理結果保存到這裡。
 */
const endImportRows = ref([])

const previewGenerated = ref(false)

/**
 * Shopify CSV 中實際 Variant 數量。
 */
const variantCount = computed(() =>
    shopifyRows.value.filter(row =>
        String(row['Variant SKU'] ?? '').trim()
    ).length
)

/**
 * 有 SKU，但 Compare At Price 為空白的 Variant。
 */
const compareAtMissingCount = computed(() =>
    shopifyRows.value.filter(row => {
      const sku = String(row['Variant SKU'] ?? '').trim()
      const compareAtPrice = String(
          row['Variant Compare At Price'] ?? ''
      ).trim()

      return sku && !compareAtPrice
    }).length
)

/**
 * 產生預覽用的來源 Variant。
 */
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

    if (
        handle &&
        title &&
        !titleByHandle.has(handle)
    ) {
      titleByHandle.set(handle, title)
    }
  })

  return endImportRows.value.map((importRow, index) => {
    const sourceRow =
        sourceVariantRows[index] || {}

    const handle = String(
        importRow.Handle ??
        sourceRow.Handle ??
        ''
    ).trim()

    const currentPrice = String(
        sourceRow['Variant Price'] ?? ''
    ).trim()

    const compareAtPrice = String(
        sourceRow['Variant Compare At Price'] ?? ''
    ).trim()

    const restoredPrice = String(
        importRow['Variant Price'] ?? ''
    ).trim()

    return {
      handle,

      sku: String(
          importRow['Variant SKU'] ??
          sourceRow['Variant SKU'] ??
          ''
      ).trim(),

      title:
          titleByHandle.get(handle) ||
          String(
              sourceRow.Title ??
              importRow.Title ??
              ''
          ).trim(),

      currentPrice,
      compareAtPrice,
      restoredPrice,

      canRestore: Boolean(compareAtPrice)
    }
  })
})

/**
 * 預覽搜尋。
 */
const filteredPreviewRows = computed(() => {
  const text =
      keyword.value
          .trim()
          .toLowerCase()

  if (!text) {
    return previewRows.value
  }

  return previewRows.value.filter(item =>
      [
        item.sku,
        item.title,
        item.handle
      ].some(value =>
          String(value ?? '')
              .toLowerCase()
              .includes(text)
      )
  )
})

/**
 * CSV 或 Tag 有任何修改時，
 * 舊的預覽結果就失效。
 *
 * 避免畫面顯示的結果，
 * 與使用者目前設定不一致。
 */
function invalidatePreview() {
  previewGenerated.value = false
  endImportRows.value = []
  keyword.value = ''
}

/**
 * 讀取 Shopify 活動商品 CSV。
 */
async function handleShopifyFile(file) {
  try {
    errorMessage.value = ''

    invalidatePreview()

    shopifyFileName.value = file.name

    shopifyRows.value =
        await parseDataFile(file)
  } catch (error) {
    console.error(error)

    errorMessage.value =
        'Shopify CSV 解析失敗，請確認檔案為 Shopify 匯出的商品 CSV。'
  }
}

/**
 * 新增要移除的活動 Tag。
 */
function addRemoveTag() {
  let changed = false

  removeTagInput.value
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean)
      .forEach(tag => {
        const exists =
            removedTags.value.some(
                current =>
                    current.toLowerCase() ===
                    tag.toLowerCase()
            )

        if (!exists) {
          removedTags.value.push(tag)
          changed = true
        }
      })

  removeTagInput.value = ''

  if (changed) {
    invalidatePreview()
  }
}

/**
 * Enter 或逗號加入 Tag。
 */
function handleRemoveTagKeydown(event) {
  if (
      event.key === 'Enter' ||
      event.key === ','
  ) {
    event.preventDefault()
    addRemoveTag()
  }
}

/**
 * 移除 Tag。
 */
function removeTag(index) {
  removedTags.value.splice(index, 1)

  invalidatePreview()
}

/**
 * 正式產生下架預覽。
 *
 * 這裡才執行：
 * Compare At Price → Variant Price
 * 移除指定 Tag
 */
function generateEndPreview() {
  if (!shopifyRows.value.length) {
    return
  }

  errorMessage.value = ''
  keyword.value = ''

  endImportRows.value =
      buildShopifyPromotionEndRows({
        shopifyRows: shopifyRows.value,
        removedTags: [
          ...removedTags.value
        ]
      })

  previewGenerated.value = true
}

/**
 * 清理來源檔名。
 *
 * 例如：
 *
 * Shopify_Promotion_END_SOURCE_VIPDAY_20260821.csv
 *
 * 會取得：
 *
 * VIPDAY_20260821
 */
function safeEndFileName() {
  const baseName =
      shopifyFileName.value
          .replace(/\.[^.]+$/, '')
          .replace(
              /^Shopify_Promotion_END_SOURCE_/i,
              ''
          )
          .replace(
              /^Shopify_Promotion_END_/i,
              ''
          )
          .replace(
              /^Shopify_Promotion_NORMAL_/i,
              ''
          )

  return (
      baseName.replace(
          /[^\w\-\u4e00-\u9fff]+/g,
          '_'
      ) ||
      'Promotion'
  )
}

/**
 * 預覽價格固定顯示兩位小數。
 */
function formatPrice(value) {
  const text =
      String(value ?? '').trim()

  if (!text) {
    return '—'
  }

  const number = Number(
      text.replace(/,/g, '')
  )

  return Number.isFinite(number)
      ? number.toFixed(2)
      : text
}

/**
 * 匯出 Shopify 商品下架 CSV。
 */
function exportEndCsv() {
  if (!endImportRows.value.length) {
    return
  }

  downloadCsv(
      `Shopify_Promotion_END_${safeEndFileName()}.csv`,
      endImportRows.value,
      {
        withBom: true
      }
  )
}
</script>

<template>
  <section class="space-y-6">
    <!-- Header -->
    <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p class="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
        Shopify Promotion
      </p>

      <h2 class="mt-2 text-2xl font-bold text-slate-950">
        Promotion 商品下架
      </h2>

      <p class="mt-2 text-sm leading-6 text-slate-500">
        活動結束時使用。先在 Shopify 用活動 Tag 篩選本次活動商品並匯出最新 CSV，再由工具恢復正常售價並移除活動 Tag。
      </p>
    </div>

    <!-- Error -->
    <div
        v-if="errorMessage"
        class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
    >
      {{ errorMessage }}
    </div>

    <!-- Input -->
    <div class="grid gap-5 lg:grid-cols-2">
      <FileUploadCard
          title="Shopify 活動商品 CSV"
          description="請先用活動 Tag 篩選商品，再從 Shopify 匯出最新資料，以保留活動期間變動後的庫存。"
          :filename="shopifyFileName"
          :row-count="shopifyRows.length"
          @change="handleShopifyFile"
      />

      <!-- Remove Tags -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label class="block text-sm font-semibold text-slate-800">
          移除活動 Tags
        </label>

        <div class="mt-2 flex gap-2">
          <input
              v-model="removeTagInput"
              type="text"
              placeholder="輸入要移除的活動 Tag"
              class="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
              @keydown="handleRemoveTagKeydown"
          >

          <button
              type="button"
              class="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
              @click="addRemoveTag"
          >
            新增
          </button>
        </div>

        <div
            v-if="removedTags.length"
            class="mt-3 flex flex-wrap gap-2"
        >
          <button
              v-for="(tag, index) in removedTags"
              :key="`${tag}-${index}`"
              type="button"
              class="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
              @click="removeTag(index)"
          >
            {{ tag }}

            <span class="text-slate-400">
              ×
            </span>
          </button>
        </div>

        <p class="mt-3 text-xs leading-5 text-slate-500">
          只移除你指定的 Tag，其他 Shopify Tags 原樣保留。
        </p>
      </section>
    </div>

    <!-- Generate Preview -->
    <div class="flex justify-end">
      <button
          type="button"
          :disabled="!shopifyRows.length"
          class="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          @click="generateEndPreview"
      >
        產生下架預覽
      </button>
    </div>

    <!-- Result -->
    <template v-if="previewGenerated">
      <!-- Summary -->
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="rounded-2xl bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">
            Variant 數量
          </p>

          <p class="mt-2 text-3xl font-bold">
            {{ variantCount }}
          </p>
        </div>

        <div class="rounded-2xl bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">
            Compare At Price 空白
          </p>

          <p
              class="mt-2 text-3xl font-bold"
              :class="
              compareAtMissingCount
                ? 'text-amber-700'
                : 'text-emerald-700'
            "
          >
            {{ compareAtMissingCount }}
          </p>

          <p class="mt-2 text-xs leading-5 text-slate-500">
            空白的 Variant 不會覆寫 Variant Price。
          </p>
        </div>
      </div>

      <!-- Preview -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <!-- Toolbar -->
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 class="text-base font-bold text-slate-900">
              下架商品預覽
            </h3>

            <p class="mt-1 text-xs leading-5 text-slate-500">
              匯出前確認目前活動價與恢復後售價，共
              {{ previewRows.length }}
              個 Variant。
            </p>
          </div>

          <div class="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <input
                v-model="keyword"
                type="search"
                placeholder="搜尋 SKU、商品名稱、Handle…"
                class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200 sm:min-w-80 lg:w-96"
            >

            <button
                type="button"
                :disabled="!endImportRows.length"
                class="whitespace-nowrap rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                @click="exportEndCsv"
            >
              匯出商品下架 CSV
            </button>
          </div>
        </div>

        <!-- Info -->
        <div class="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
          商品下架會把有效的
          <strong>
            Variant Compare At Price 複製到 Variant Price
          </strong>
          ；
          <strong>
            Variant Compare At Price 保持原值
          </strong>
          。庫存與其他資料採用最新 Shopify CSV，Variant Image 不輸出。
        </div>

        <!-- Table -->
        <div class="mt-5 overflow-x-auto">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-3 py-3">
                SKU
              </th>

              <th class="px-3 py-3">
                商品
              </th>

              <th class="px-3 py-3 text-right">
                目前活動價
              </th>

              <th class="px-3 py-3 text-right">
                Compare At Price
              </th>

              <th class="px-3 py-3 text-right">
                恢復後售價
              </th>

              <th class="px-3 py-3">
                狀態
              </th>
            </tr>
            </thead>

            <tbody class="divide-y divide-slate-100">
            <tr
                v-for="item in filteredPreviewRows"
                :key="`${item.handle}-${item.sku}`"
                class="align-top hover:bg-slate-50/70"
            >
              <!-- SKU -->
              <td class="whitespace-nowrap px-3 py-3 font-mono text-xs font-semibold text-slate-800">
                {{ item.sku || '—' }}
              </td>

              <!-- Product -->
              <td class="min-w-64 px-3 py-3 text-slate-700">
                <div>
                  {{ item.title || '—' }}
                </div>

                <div
                    v-if="item.handle"
                    class="mt-1 text-xs text-slate-400"
                >
                  {{ item.handle }}
                </div>
              </td>

              <!-- Current Price -->
              <td class="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                {{ formatPrice(item.currentPrice) }}
              </td>

              <!-- Compare At Price -->
              <td class="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                {{ formatPrice(item.compareAtPrice) }}
              </td>

              <!-- Restored Price -->
              <td class="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                {{ formatPrice(item.restoredPrice) }}
              </td>

              <!-- Status -->
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

            <!-- Empty -->
            <tr v-if="!filteredPreviewRows.length">
              <td
                  colspan="6"
                  class="px-3 py-8 text-center text-sm text-slate-400"
              >
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