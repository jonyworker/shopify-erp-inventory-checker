<script setup>
import { computed, ref } from 'vue'
import DeclarationUploadCard from '@/components/customs/DeclarationUploadCard.vue'
import DeclarationPreviewTable from '@/components/customs/DeclarationPreviewTable.vue'
import { parseDeclarationPdf } from '@/utils/customs/pdfParser'
import { validateDeclarationRow } from '@/utils/customs/declarationValidator'
import { downloadInvoiceExcel } from '@/utils/customs/declarationExport'

const filename = ref('')
const rows = ref([])
const pages = ref([])
const totalPages = ref(0)
const currentPage = ref(0)
const currentPageProgress = ref(0)
const currentMode = ref('')
const isParsing = ref(false)
const errorMessage = ref('')
const keyword = ref('')
const issueOnly = ref(false)
const showDiagnostics = ref(false)

const summary = computed(() => ({
  total: rows.value.length,
  normal: rows.value.filter(row => !row.issues?.length).length,
  issue: rows.value.filter(row => row.issues?.length).length,
  reports: new Set(rows.value.map(row => row.declarationNo).filter(Boolean)).size,
}))

const progressPercent = computed(() => {
  if (!isParsing.value || !totalPages.value) return 0
  const completed = Math.max(currentPage.value - 1, 0)
  const pagePart = currentMode.value === 'ocr' ? currentPageProgress.value : 0.4
  return Math.min(100, Math.round(((completed + pagePart) / totalPages.value) * 100))
})

function reset() {
  rows.value = []
  pages.value = []
  totalPages.value = 0
  currentPage.value = 0
  currentPageProgress.value = 0
  currentMode.value = ''
  errorMessage.value = ''
  keyword.value = ''
  issueOnly.value = false
  showDiagnostics.value = false
}

async function handleFile(file) {
  reset()
  filename.value = file.name
  isParsing.value = true

  try {
    const result = await parseDeclarationPdf(file, {
      onPageStart: ({ pageNumber, totalPages: count }) => {
        currentPage.value = pageNumber
        totalPages.value = count
        currentPageProgress.value = 0
        currentMode.value = 'text'
      },
      onPageProgress: ({ progress }) => {
        currentMode.value = 'ocr'
        currentPageProgress.value = progress
      },
      onPageComplete: ({ mode }) => {
        currentMode.value = mode
        currentPageProgress.value = 1
      },
    })

    rows.value = result.rows
    pages.value = result.pages
    totalPages.value = result.totalPages

    if (!rows.value.length) {
      errorMessage.value = 'PDF 已完成解析，但沒有辨識到報單品項。請展開下方「解析診斷」查看每頁文字層、候選項次與 OCR 狀態。'
    }
  } catch (error) {
    console.error(error)
    errorMessage.value = `PDF 解析失敗：${error?.message || '未知錯誤'}`
  } finally {
    isParsing.value = false
  }
}

function updateRow({ id, field, value }) {
  const index = rows.value.findIndex(row => row.id === id)
  if (index < 0) return
  const updated = { ...rows.value[index], [field]: value }
  updated.issues = validateDeclarationRow(updated)
  rows.value[index] = updated
}

function exportExcel() {
  if (!rows.value.length) return
  const base = filename.value.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_')
  downloadInvoiceExcel(`Invoice紀錄_${base}.xlsx`, rows.value)
}
</script>

<template>
  <section class="space-y-6">
    <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p class="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Customs Tools</p>
      <h2 class="mt-2 text-2xl font-bold text-slate-950">進出口報單整理</h2>
      <p class="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
        從報單 PDF 擷取 Item No.、Description、HS CODE、警字同意書號碼、報單號碼、報單項次與單件淨重，整理成 Invoice 紀錄 Excel。淨重(pcs) 會以該項次總淨重 ÷ EA / PCE / PCS 數量計算並四捨五入至小數點後 2 位；Qty、Unit、Price 與 Amount 保持空白，由人員後續補齊。
      </p>
    </div>

    <div v-if="errorMessage" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {{ errorMessage }}
    </div>

    <DeclarationUploadCard :filename="filename" :disabled="isParsing" @change="handleFile" />

    <section v-if="isParsing" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm font-semibold text-slate-900">正在解析 PDF</p>
          <p class="mt-1 text-xs text-slate-500">
            第 {{ currentPage }} / {{ totalPages }} 頁
            <span v-if="currentMode === 'ocr'">・掃描頁 OCR 中</span>
          </p>
        </div>
        <p class="text-sm font-semibold text-slate-700">{{ progressPercent }}%</p>
      </div>
      <div class="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div class="h-full bg-slate-900 transition-all" :style="{ width: `${progressPercent}%` }" />
      </div>
      <p class="mt-3 text-xs leading-5 text-slate-500">
        第一次處理掃描 PDF 時，OCR 套件可能需要下載繁中與英文辨識模型，因此會比之後稍慢。
      </p>
    </section>



    <section v-if="pages.length" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-4 text-left"
        @click="showDiagnostics = !showDiagnostics"
      >
        <div>
          <p class="text-sm font-semibold text-slate-900">解析診斷</p>
          <p class="mt-1 text-xs text-slate-500">用來確認 PDF 文字層、OCR 與項次辨識卡在哪一層。</p>
        </div>
        <span class="text-sm font-semibold text-slate-500">{{ showDiagnostics ? '收合' : '展開' }}</span>
      </button>

      <div v-if="showDiagnostics" class="mt-4 overflow-x-auto">
        <table class="min-w-[900px] w-full text-left text-xs">
          <thead class="border-b border-slate-200 text-slate-500">
            <tr>
              <th class="px-2 py-2">頁</th>
              <th class="px-2 py-2">模式</th>
              <th class="px-2 py-2">文字區塊</th>
              <th class="px-2 py-2">原生字元</th>
              <th class="px-2 py-2">整理後行數</th>
              <th class="px-2 py-2">候選項次</th>
              <th class="px-2 py-2">成功品項</th>
              <th class="px-2 py-2">報單號碼</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-slate-700">
            <tr v-for="page in pages" :key="page.pageNumber">
              <td class="px-2 py-2">{{ page.pageNumber }}</td>
              <td class="px-2 py-2">{{ page.mode }}</td>
              <td class="px-2 py-2">{{ page.nativeTextItemCount }}</td>
              <td class="px-2 py-2">{{ page.nativeCharCount }}</td>
              <td class="px-2 py-2">{{ page.lineCount }}</td>
              <td class="px-2 py-2">{{ page.boundaryCount }}</td>
              <td class="px-2 py-2" :class="page.rowCount ? 'text-emerald-700' : 'text-rose-700'">{{ page.rowCount }}</td>
              <td class="px-2 py-2">{{ page.reportNo || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <template v-if="rows.length">
      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-2xl bg-white p-5 shadow-sm"><p class="text-sm text-slate-500">報單數</p><p class="mt-2 text-3xl font-bold text-slate-900">{{ summary.reports }}</p></div>
        <div class="rounded-2xl bg-white p-5 shadow-sm"><p class="text-sm text-slate-500">解析品項</p><p class="mt-2 text-3xl font-bold text-slate-900">{{ summary.total }}</p></div>
        <div class="rounded-2xl bg-white p-5 shadow-sm"><p class="text-sm text-slate-500">正常</p><p class="mt-2 text-3xl font-bold text-emerald-700">{{ summary.normal }}</p></div>
        <div class="rounded-2xl bg-white p-5 shadow-sm"><p class="text-sm text-slate-500">需確認</p><p class="mt-2 text-3xl font-bold text-amber-700">{{ summary.issue }}</p></div>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div class="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div class="flex-1">
              <label class="text-xs font-semibold text-slate-600">搜尋</label>
              <input v-model="keyword" type="search" placeholder="Item No.、Description、HS CODE、報單號碼…" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200" />
            </div>
            <label class="mt-5 inline-flex items-center gap-2 text-sm font-medium text-slate-700">
              <input v-model="issueOnly" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
              只看需確認
            </label>
          </div>

          <button type="button" class="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700" @click="exportExcel">
            匯出 Invoice紀錄.xlsx
          </button>
        </div>
      </section>

      <DeclarationPreviewTable :rows="rows" :keyword="keyword" :issue-only="issueOnly" @update:row="updateRow" />

      <section class="rounded-2xl border border-slate-200 bg-white p-5 text-xs leading-6 text-slate-500 shadow-sm">
        <p class="font-semibold text-slate-700">本版規則</p>
        <p class="mt-1">同意書號碼只擷取「警字第xxxx號」；同意書對應項次、Qty、Unit、Price(USD)、Amount(USD) 一律留空。進口報單號碼依每筆所屬報單取得，進口報單項次直接使用 PDF 的項次(32)，不重新編號。</p>
      </section>
    </template>
  </section>
</template>
