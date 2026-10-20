<script setup>
import { computed, ref, watch } from 'vue'
import { currentUser, isAuthReady } from '@/stores/authState'
import { supabase } from '@/lib/supabaseClient'
import {
  permissionReady,
  permissionUserId,
  can
} from '@/stores/permissionState'

const records = ref([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const search = ref('')
const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth())
const selectedDate = ref('')
const selectedId = ref(null)
const editing = ref(false)
const isNew = ref(false)
const draft = ref(emptyDraft())

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function emptyDraft() {
  return { title: '', meeting_date: localDate(), category: '', attendees: '', content: '' }
}
// 權限一定要屬於當前登入者；尚未載入或重新整理期間採預設禁止。
const isPermissionOwner = computed(() => Boolean(
  currentUser.value?.id &&
  isAuthReady.value &&
  permissionReady.value &&
  permissionUserId.value === currentUser.value.id
))
const canUse = computed(() => isPermissionOwner.value && can('meetingArchive.view'))
const canCreate = computed(() => canUse.value && can('meetingArchive.create'))
const canEdit = computed(() => canUse.value && can('meetingArchive.edit'))
const canDelete = computed(() => canUse.value && can('meetingArchive.delete'))

// 權限被撤銷或使用者切換時，使晚回來的非同步結果失效。
let fetchVersion = 0
let mutationVersion = 0

const keyword = computed(() => search.value.trim().toLocaleLowerCase())
const searching = computed(() => Boolean(keyword.value))
const searched = computed(() => {
  if (!keyword.value) return records.value
  return records.value.filter(record =>
    [record.title, record.category, record.attendees, record.content]
      .some(value => String(value ?? '').toLocaleLowerCase().includes(keyword.value))
  )
})
const visibleRecords = computed(() => keyword.value ? searched.value : searched.value.filter(r => r.meeting_date === selectedDate.value))
const selectedRecord = computed(() => records.value.find(r => r.id === selectedId.value) ?? null)
const monthLabel = computed(() => `${year.value} 年 ${month.value + 1} 月`)
const firstWeekday = computed(() => new Date(year.value, month.value, 1).getDay())
const daysInMonth = computed(() => new Date(year.value, month.value + 1, 0).getDate())
const calendarCells = computed(() => Array.from({ length: Math.ceil((firstWeekday.value + daysInMonth.value) / 7) * 7 }, (_, i) => i - firstWeekday.value + 1))
const countsByDate = computed(() => records.value.reduce((acc, r) => {
  acc[r.meeting_date] = (acc[r.meeting_date] ?? 0) + 1
  return acc
}, {}))
function dayKey(day) { return `${year.value}-${String(month.value + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` }
function moveMonth(diff) {
  if (editing.value && !confirm('尚未儲存的內容將會遺失，確定切換月份？')) return
  const date = new Date(year.value, month.value + diff, 1)
  year.value = date.getFullYear()
  month.value = date.getMonth()
  selectedDate.value = ''
  selectedId.value = null
  editing.value = false
}
function chooseDate(date) {
  if (editing.value && !confirm('尚未儲存的內容將會遺失，確定切換日期？')) return
  search.value = ''
  selectedDate.value = date
  selectedId.value = null
  editing.value = false
  const first = records.value.find(r => r.meeting_date === date)
  if (first) selectedId.value = first.id
}
function chooseRecord(record) {
  if (editing.value && !confirm('尚未儲存的內容將會遺失，確定切換會議？')) return
  selectedId.value = record.id
  selectedDate.value = record.meeting_date
  const [y, m] = record.meeting_date.split('-').map(Number)
  year.value = y
  month.value = m - 1
  editing.value = false
}
function startNew() {
  if (!canCreate.value) return
  if (editing.value && !confirm('尚未儲存的內容將會遺失，確定建立新紀錄？')) return
  draft.value = { ...emptyDraft(), meeting_date: selectedDate.value || localDate() }
  isNew.value = true
  editing.value = true
  selectedId.value = null
}
function startEdit() {
  if (!canEdit.value || !selectedRecord.value) return
  draft.value = {
    title: selectedRecord.value.title,
    meeting_date: selectedRecord.value.meeting_date,
    category: selectedRecord.value.category ?? '',
    attendees: selectedRecord.value.attendees ?? '',
    content: selectedRecord.value.content ?? ''
  }
  isNew.value = false
  editing.value = true
}
function cancelEdit() { editing.value = false; isNew.value = false }
async function fetchRecords() {
  if (!canUse.value) {
    records.value = []
    return
  }
  const version = ++fetchVersion
  const ownerId = currentUser.value.id
  loading.value = true
  error.value = ''

  try {
    const { data, error: fetchError } = await supabase.from('meeting_records')
      .select('id,title,meeting_date,category,attendees,content,created_at,updated_at,created_by')
      .order('meeting_date', { ascending: false }).order('created_at', { ascending: false })

    // 禁止舊登入者或舊權限下的結果重新出現在畫面。
    if (version !== fetchVersion || !canUse.value || currentUser.value?.id !== ownerId) return
    if (fetchError) {
      records.value = []
      error.value = `無法讀取紀錄：${fetchError.message}`
      return
    }

    records.value = data ?? []
    if (!selectedDate.value && !keyword.value) {
      const date = records.value[0]?.meeting_date ?? localDate()
      selectedDate.value = date
      const [y, m] = date.split('-').map(Number)
      year.value = y
      month.value = m - 1
    }
    if (selectedId.value && !records.value.some(r => r.id === selectedId.value)) selectedId.value = null
    if (!selectedId.value && !editing.value && !keyword.value) {
      selectedId.value = records.value.find(r => r.meeting_date === selectedDate.value)?.id ?? null
    }
  } catch {
    if (version === fetchVersion && canUse.value && currentUser.value?.id === ownerId) {
      records.value = []
      error.value = '無法讀取會議紀錄，請稍後再試。'
    }
  } finally {
    if (version === fetchVersion) loading.value = false
  }
}

async function saveRecord() {
  const allowed = isNew.value ? canCreate : canEdit
  if (!canUse.value || !allowed.value || saving.value) return
  if (!draft.value.title.trim() || !draft.value.meeting_date || !draft.value.content.trim()) {
    error.value = '請填寫會議名稱、日期及紀錄內容。'
    return
  }

  const ownerId = currentUser.value.id
  const version = ++mutationVersion
  saving.value = true
  error.value = ''
  const payload = {
    title: draft.value.title.trim(), meeting_date: draft.value.meeting_date,
    category: draft.value.category.trim(), attendees: draft.value.attendees.trim(),
    content: draft.value.content.trim()
  }

  try {
    const request = isNew.value
      ? supabase.from('meeting_records').insert({ ...payload, created_by: ownerId }).select('id').single()
      : supabase.from('meeting_records').update(payload).eq('id', selectedId.value).select('id').single()
    const { data, error: saveError } = await request
    if (version !== mutationVersion || currentUser.value?.id !== ownerId || !canUse.value || !allowed.value) return
    if (saveError) {
      error.value = `儲存失敗：${saveError.message}`
      return
    }
    selectedId.value = data.id
    selectedDate.value = payload.meeting_date
    const [y, m] = payload.meeting_date.split('-').map(Number)
    year.value = y
    month.value = m - 1
    search.value = ''
    editing.value = false
    isNew.value = false
    await fetchRecords()
  } catch {
    if (version === mutationVersion && canUse.value && allowed.value) {
      error.value = '儲存會議紀錄時發生錯誤，請稍後再試。'
    }
  } finally {
    if (version === mutationVersion) saving.value = false
  }
}

async function deleteRecord() {
  if (!canDelete.value || !selectedRecord.value || saving.value) return
  const recordId = selectedRecord.value.id
  if (!confirm(`確定刪除「${selectedRecord.value.title}」？這項操作無法復原。`)) return
  if (!canDelete.value || selectedRecord.value?.id !== recordId) return

  const ownerId = currentUser.value.id
  const version = ++mutationVersion
  saving.value = true
  error.value = ''
  try {
    const { data, error: deleteError } = await supabase.from('meeting_records')
      .delete().eq('id', recordId).select('id')
    if (version !== mutationVersion || currentUser.value?.id !== ownerId || !canDelete.value) return
    if (deleteError) {
      error.value = `刪除失敗：${deleteError.message}`
      return
    }
    if (!data?.length) {
      error.value = '找不到可刪除的會議紀錄，請重新整理或確認權限。'
      return
    }
    selectedId.value = null
    await fetchRecords()
  } catch {
    if (version === mutationVersion && canDelete.value) {
      error.value = '刪除會議紀錄時發生錯誤，請稍後再試。'
    }
  } finally {
    if (version === mutationVersion) saving.value = false
  }
}
function highlightParts(text) {
  const value = String(text ?? '')
  const term = search.value.trim()
  if (!term) return [{ text: value, matched: false }]
  const index = value.toLocaleLowerCase().indexOf(term.toLocaleLowerCase())
  if (index < 0) return [{ text: value, matched: false }]
  return [
    { text: value.slice(0, index), matched: false },
    { text: value.slice(index, index + term.length), matched: true },
    { text: value.slice(index + term.length), matched: false }
  ]
}
function excerpt(record) {
  if (!keyword.value) return (record.content ?? '').slice(0, 90)
  const text = record.content ?? ''
  const index = text.toLocaleLowerCase().indexOf(keyword.value)
  return index < 0 ? text.slice(0, 90) : `…${text.slice(Math.max(0, index - 26), index + keyword.value.length + 54)}…`
}
watch(
  [canUse, () => currentUser.value?.id],
  ([allowed]) => {
    // 放棄舊請求、立即清除資料及未儲存編輯，避免權限撤銷後還能看到舊資料。
    fetchVersion += 1
    mutationVersion += 1
    records.value = []
    loading.value = false
    saving.value = false
    error.value = ''
    selectedDate.value = ''
    selectedId.value = null
    editing.value = false
    isNew.value = false
    draft.value = emptyDraft()
    if (allowed) void fetchRecords()
  },
  { immediate: true, flush: 'sync' }
)

watch([canCreate, canEdit], () => {
  if (editing.value && !(isNew.value ? canCreate.value : canEdit.value)) {
    editing.value = false
    isNew.value = false
    draft.value = emptyDraft()
    error.value = '編輯權限已變更，未儲存的內容已關閉。'
  }
}, { flush: 'sync' })

watch(search, () => {
  if (keyword.value && !searched.value.some(r => r.id === selectedId.value)) selectedId.value = null
})
</script>

<template>
  <section class="mx-auto max-w-[1600px] space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
      <div>
        <p class="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Meeting Archive / 會議管理</p>
        <h1 class="mt-2 text-3xl font-bold tracking-tight text-slate-950">會議紀錄</h1>
        <p class="mt-2 text-sm leading-6 text-slate-500">從日期找回討論，也能用關鍵字搜尋歷史會議的完整內容。</p>
      </div>
      <button
        v-if="canUse"
        type="button"
        :disabled="!canCreate"
        :title="canCreate ? '新增會議紀錄' : '沒有新增會議紀錄的權限'"
        class="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        :class="canCreate ? 'bg-slate-950 text-white hover:bg-slate-800' : 'border border-slate-200 bg-slate-100 text-slate-400'"
        @click="startNew"
      >
        <span aria-hidden="true" class="text-lg leading-none">＋</span> 新增紀錄
      </button>
    </header>

    <div v-if="error" role="alert" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{{ error }}</div>
    <div v-if="!isAuthReady" class="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">正在確認登入狀態…</div>
    <div v-else-if="!canUse" class="rounded-lg border border-slate-200 bg-white p-10 text-center">
      <h2 class="font-semibold text-slate-900">目前沒有檢視會議紀錄的權限</h2>
      <p class="mt-2 text-sm text-slate-500">請聯絡管理員設定部門或個人權限。</p>
    </div>

    <div v-else class="grid items-start gap-7 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)]">
      <aside class="min-w-0 space-y-6 lg:sticky lg:top-5" aria-label="會議日期與搜尋導航">
        <!-- 搜尋獨立於月曆：搜尋時跨所有日期，清空後回到日期瀏覽 -->
        <div class="space-y-2">
          <label for="meeting-search" class="block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">搜尋會議紀錄</label>
          <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 transition focus-within:border-slate-500 focus-within:ring-2 focus-within:ring-slate-100">
            <svg class="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
            <input id="meeting-search" v-model="search" type="search" placeholder="搜尋標題、與會人員、內文…" class="min-w-0 w-full bg-transparent py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400" />
            <button v-if="search" type="button" aria-label="清除搜尋" title="清除搜尋" class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800" @click="search = ''">✕</button>
          </div>
          <p class="text-xs text-slate-400">{{ searching ? `已找到 ${searched.length} 筆符合的紀錄` : '搜尋範圍：所有日期的會議名稱與內文' }}</p>
        </div>

        <div class="border-t border-slate-200 pt-5">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-sm font-bold text-slate-900">{{ monthLabel }}</h2>
            <div class="flex items-center gap-1">
              <button type="button" aria-label="上個月" class="flex h-8 w-8 items-center justify-center rounded-md text-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900" @click="moveMonth(-1)">‹</button>
              <button type="button" aria-label="下個月" class="flex h-8 w-8 items-center justify-center rounded-md text-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900" @click="moveMonth(1)">›</button>
            </div>
          </div>
          <div class="grid grid-cols-7 gap-1 text-center">
            <span v-for="w in ['日','一','二','三','四','五','六']" :key="w" class="py-2 text-xs font-medium text-slate-400">{{ w }}</span>
            <template v-for="(day, i) in calendarCells" :key="i">
              <button v-if="day > 0 && day <= daysInMonth" type="button"
                class="flex min-h-10 flex-col items-center justify-center rounded-lg text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-600"
                :class="selectedDate === dayKey(day) && !searching ? 'bg-slate-100 font-semibold text-slate-950 ring-1 ring-inset ring-slate-200' : 'text-slate-700 hover:bg-slate-50'"
                :aria-label="`${dayKey(day)}，${countsByDate[dayKey(day)] ?? 0} 筆會議`"
                :aria-pressed="selectedDate === dayKey(day) && !searching"
                @click="chooseDate(dayKey(day))">
                {{ day }}
                <span class="mt-1 h-1.5 w-1.5 rounded-full" :class="countsByDate[dayKey(day)] ? 'bg-blue-500' : 'bg-transparent'" aria-hidden="true"></span>
              </button>
              <span v-else aria-hidden="true"></span>
            </template>
          </div>
          <div class="mt-4 flex items-center gap-2 text-xs text-slate-500"><span class="h-1.5 w-1.5 rounded-full bg-blue-500"></span>有會議紀錄的日期</div>
        </div>

        <div class="border-t border-slate-200 pt-5">
          <div class="mb-3 flex items-baseline justify-between gap-2">
            <h2 class="text-sm font-bold text-slate-900">{{ searching ? '搜尋結果' : selectedDate ? `${selectedDate} 的會議` : '選擇日期' }}</h2>
            <span class="shrink-0 text-xs text-slate-400">{{ visibleRecords.length }} 筆</span>
          </div>
          <p v-if="loading" class="py-5 text-sm text-slate-500">正在讀取紀錄…</p>
          <div v-else-if="!visibleRecords.length" class="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm leading-6 text-slate-400">{{ searching ? '找不到符合關鍵字的紀錄' : '這一天尚無會議紀錄' }}</div>
          <div v-else class="max-h-[440px] space-y-1 overflow-y-auto pr-1">
            <button v-for="record in visibleRecords" :key="record.id" type="button" class="w-full rounded-lg px-3 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-600"
              :class="selectedId === record.id ? 'bg-slate-100' : 'hover:bg-slate-50'" @click="chooseRecord(record)">
              <span class="block text-sm font-semibold leading-6 text-slate-900">{{ record.title }}</span>
              <span class="mt-0.5 block text-xs text-slate-500">{{ record.meeting_date }}<template v-if="record.category"> · {{ record.category }}</template></span>
              <span v-if="searching" class="mt-2 block break-words text-xs leading-5 text-slate-500"><template v-for="(part, index) in highlightParts(excerpt(record))" :key="index"><mark v-if="part.matched" class="rounded bg-amber-100 px-0.5 text-slate-900">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
            </button>
          </div>
        </div>
      </aside>

      <article class="min-w-0 min-h-[560px] border-t border-slate-200 bg-white pt-6 lg:border-l lg:border-t-0 lg:py-2 lg:pl-9 xl:pl-12">
        <form v-if="editing" class="mx-auto max-w-[850px] space-y-6" @submit.prevent="saveRecord">
          <div class="flex items-center justify-between gap-4 border-b border-slate-100 pb-5">
            <div><p class="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Editor</p><h2 class="mt-1 text-xl font-bold text-slate-900">{{ isNew ? '新增會議紀錄' : '編輯會議紀錄' }}</h2></div>
            <button type="button" class="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900" @click="cancelEdit">取消</button>
          </div>
          <div><label for="meeting-title" class="mb-2 block text-sm font-medium text-slate-700">會議名稱 *</label><input id="meeting-title" v-model="draft.title" maxlength="200" required class="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" placeholder="例如：營運例會" /></div>
          <div class="grid gap-4 sm:grid-cols-2"><div><label for="meeting-date" class="mb-2 block text-sm font-medium text-slate-700">會議日期 *</label><input id="meeting-date" v-model="draft.meeting_date" type="date" required class="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" /></div><div><label for="meeting-category" class="mb-2 block text-sm font-medium text-slate-700">會議分類</label><input id="meeting-category" v-model="draft.category" maxlength="100" class="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" placeholder="例如：跨部門、營運例會" /></div></div>
          <div><label for="meeting-attendees" class="mb-2 block text-sm font-medium text-slate-700">與會人員</label><input id="meeting-attendees" v-model="draft.attendees" class="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" placeholder="例如：Sam、Kelvin" /></div>
          <div><label for="meeting-content" class="mb-2 block text-sm font-medium text-slate-700">會議內容 *</label><textarea id="meeting-content" v-model="draft.content" required rows="18" class="w-full resize-y rounded-lg border border-slate-200 px-4 py-3 text-sm leading-8 outline-none focus:border-slate-500" placeholder="在這裡記錄會議內容，可自由換行及分段…"></textarea><p class="mt-2 text-xs text-slate-400">支援純文字與換行。此階段不變更資料格式。</p></div>
          <div class="border-t border-slate-100 pt-5"><button type="submit" :disabled="saving || !(isNew ? canCreate : canEdit)" class="rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">{{ saving ? '儲存中…' : '儲存紀錄' }}</button></div>
        </form>

        <div v-else-if="selectedRecord" class="mx-auto max-w-[850px]">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <p class="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Meeting Record / {{ selectedRecord.meeting_date }}</p>
              <h2 class="mt-3 break-words text-2xl font-bold leading-tight tracking-tight text-slate-950 md:text-3xl">{{ selectedRecord.title }}</h2>
              <div class="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-500"><span>{{ selectedRecord.meeting_date }}</span><template v-if="selectedRecord.category"><span class="text-slate-300">/</span><span class="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{{ selectedRecord.category }}</span></template></div>
            </div>
            <div class="flex shrink-0 gap-1">
              <button type="button" :disabled="!canEdit" :title="canEdit ? '編輯會議紀錄' : '沒有編輯會議紀錄的權限'"
                class="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                @click="startEdit">編輯</button>
              <button type="button" :disabled="!canDelete || saving" :title="canDelete ? '刪除會議紀錄' : '沒有刪除會議紀錄的權限'"
                class="rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                @click="deleteRecord">刪除</button>
            </div>
          </div>
          <div v-if="selectedRecord.attendees" class="mt-7 border-y border-slate-100 py-4"><p class="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">與會人員</p><p class="break-words text-sm leading-6 text-slate-700">{{ selectedRecord.attendees }}</p></div>
          <div class="mt-8 whitespace-pre-wrap break-words text-[15px] leading-[2] text-slate-700">{{ selectedRecord.content }}</div>
          <footer class="mt-12 border-t border-slate-100 pt-4 text-xs text-slate-400">最後更新：{{ new Date(selectedRecord.updated_at).toLocaleString('zh-TW') }}</footer>
        </div>
        <div v-else class="flex min-h-[450px] flex-col items-center justify-center px-4 text-center">
          <svg class="h-10 w-10 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5zm0 12A2.5 2.5 0 0 1 6.5 15H20"/><path d="M8 7h8M8 10h5"/></svg>
          <h2 class="mt-4 font-semibold text-slate-700">選擇一筆會議紀錄</h2>
          <p class="mt-2 max-w-xs text-sm leading-6 text-slate-400">使用左側月曆尋找日期，或輸入關鍵字搜尋過去討論的內容。</p>
        </div>
      </article>
    </div>
  </section>
</template>
