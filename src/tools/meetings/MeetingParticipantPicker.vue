<script setup>
import { computed, ref, watch } from 'vue'

// Controlled selection: modelValue stores stable Supabase Auth user UUIDs, never names.
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  people: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  error: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'open'])
const open = ref(false)
const query = ref('')
const working = ref([])
const groups = [{ key: 'tw', label: '台灣' }, { key: 'hk', label: '香港' }, { key: 'other', label: '其他' }]
const normalizedPeople = computed(() => {
  const seen = new Set()
  return props.people.filter(p => {
    if (!p?.user_id || !p?.display_name || p.is_admin || p.username === 'admin' || p.is_active === false || seen.has(p.user_id)) return false
    seen.add(p.user_id)
    return true
  })
})
const selectedPeople = computed(() => normalizedPeople.value.filter(p => props.modelValue.includes(p.user_id)))
const matches = computed(() => normalizedPeople.value.filter(p => String(p.display_name).toLowerCase().includes(query.value.trim().toLowerCase())))
function belongs(p, group) {
  const codes = Array.isArray(p.regions) ? p.regions : (p.region ? [p.region] : [])
  return group === 'other' ? !codes.includes('tw') && !codes.includes('hk') : codes.includes(group)
}
function groupPeople(group) { return matches.value.filter(p => {
  if (group === 'hk' && belongs(p, 'tw')) return false // 跨地區使用者只呈現一次
  return belongs(p, group)
}) }
function removeSelected(id) {
  if (props.disabled) return
  emit('update:modelValue', props.modelValue.filter(value => value !== id))
}
function toggle(id) { working.value = working.value.includes(id) ? working.value.filter(x => x !== id) : [...working.value, id] }
function toggleAll(ids) {
  working.value = ids.every(id => working.value.includes(id))
    ? working.value.filter(id => !ids.includes(id))
    : [...new Set([...working.value, ...ids])]
}
function show() { if (props.disabled) return; working.value = [...props.modelValue]; query.value = ''; open.value = true; emit('open') }
function apply() { emit('update:modelValue', normalizedPeople.value.filter(p => working.value.includes(p.user_id)).map(p => p.user_id)); open.value = false }
watch(() => props.disabled, value => { if (value) open.value = false })
</script>

<template>
  <div>
    <label class="mb-2 block text-sm font-medium text-slate-700">與會人員 *</label>
    <div class="flex min-h-12 w-full flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm focus-within:ring-2 focus-within:ring-slate-400" :class="disabled ? 'opacity-50' : ''">
      <template v-if="selectedPeople.length">
        <span v-for="person in selectedPeople" :key="person.user_id" class="inline-flex items-center gap-1 rounded-md bg-slate-100 py-1 pl-2 pr-1 text-slate-700">
          <span>{{ person.display_name }}</span>
          <button type="button" :disabled="disabled" :aria-label="`移除 ${person.display_name}`" :title="`移除 ${person.display_name}`" class="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-600 disabled:cursor-not-allowed" @click.stop="removeSelected(person.user_id)">✕</button>
        </span>
      </template>
      <button type="button" :disabled="disabled" class="flex min-h-7 flex-1 items-center justify-end gap-2 text-slate-400 disabled:cursor-not-allowed" @click="show">
        <span v-if="!selectedPeople.length" class="mr-auto">點擊選擇與會人員</span>
        <span class="ml-auto text-xs">{{ selectedPeople.length }} 人 ▾</span>
      </button>
    </div>
    <p v-if="error" class="mt-2 text-xs text-red-600">{{ error }}</p>

    <div v-if="open" class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4" @click.self="open = false">
      <div role="dialog" aria-modal="true" aria-label="選擇與會人員" class="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header class="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div><h3 class="text-lg font-bold text-slate-900">選擇與會人員</h3><p class="mt-1 text-xs text-slate-500">已選擇 {{ working.length }} 人</p></div>
          <button type="button" class="rounded px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="關閉" @click="open = false">✕</button>
        </header>
        <div class="space-y-4 overflow-y-auto p-5">
          <input v-model="query" type="search" placeholder="搜尋人員姓名…" class="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" />
          <div class="flex flex-wrap gap-2">
            <button type="button" class="rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50" @click="toggleAll(matches.map(p => p.user_id))">全選 / 取消全選</button>
            <button v-for="group in groups.slice(0, 2)" :key="group.key" type="button" class="rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50" @click="toggleAll(matches.filter(p => belongs(p, group.key)).map(p => p.user_id))">{{ group.label }}全選 / 取消</button>
          </div>
          <p v-if="loading" class="text-sm text-slate-500">正在讀取人員…</p>
          <p v-else-if="!matches.length" class="text-sm text-slate-500">沒有符合的人員</p>
          <section v-for="group in groups" :key="group.key" class="space-y-3">
            <template v-if="groupPeople(group.key).length">
              <h4 class="border-b border-slate-100 pb-2 text-sm font-semibold text-slate-800">{{ group.label }}</h4>
              <div class="grid gap-3 sm:grid-cols-2">
                <label v-for="person in groupPeople(group.key)" :key="person.user_id" class="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" :checked="working.includes(person.user_id)" class="h-4 w-4 accent-indigo-700" @change="toggle(person.user_id)" />
                  {{ person.display_name }}
                </label>
              </div>
            </template>
          </section>
        </div>
        <footer class="flex justify-end gap-3 border-t border-slate-100 px-5 py-4">
          <button type="button" class="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100" @click="open = false">取消</button>
          <button type="button" :disabled="loading || !!error" class="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" @click="apply">確認 {{ working.length }} 人</button>
        </footer>
      </div>
    </div>
  </div>
</template>
