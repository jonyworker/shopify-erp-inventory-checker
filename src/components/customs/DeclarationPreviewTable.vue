<script setup>
import { computed } from 'vue'

const props = defineProps({
  rows: { type: Array, required: true },
  keyword: { type: String, default: '' },
  issueOnly: { type: Boolean, default: false },
})

const emit = defineEmits(['update:row'])

const filteredRows = computed(() => {
  const keyword = props.keyword.trim().toLowerCase()
  return props.rows.filter(row => {
    if (props.issueOnly && !row.issues?.length) return false
    if (!keyword) return true
    return [
      row.itemNo, row.description, row.hsCode, row.permitNo,
      row.declarationNo, row.declarationItem,
    ].some(value => String(value ?? '').toLowerCase().includes(keyword))
  })
})

function updateField(row, field, value) {
  emit('update:row', { id: row.id, field, value })
}
</script>

<template>
  <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div class="overflow-x-auto">
      <table class="min-w-[1500px] w-full text-left text-sm">
        <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-3 py-3">狀態</th>
            <th class="px-3 py-3">頁</th>
            <th class="px-3 py-3">Item No.</th>
            <th class="px-3 py-3 min-w-[320px]">Description</th>
            <th class="px-3 py-3">HS CODE</th>
            <th class="px-3 py-3">同意書號碼</th>
            <th class="px-3 py-3">進口報單號碼</th>
            <th class="px-3 py-3">進口報單項次</th>
            <th class="px-3 py-3">淨重(pcs)</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="row in filteredRows" :key="row.id" class="align-top">
            <td class="px-3 py-3">
              <span
                v-if="row.issues?.length"
                class="inline-flex rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20"
                :title="row.issues.join('、')"
              >需確認</span>
              <span v-else class="inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">正常</span>
            </td>
            <td class="px-3 py-3 text-slate-500">{{ row.sourcePage }}</td>
            <td class="px-3 py-3">
              <input class="w-36 rounded-lg border border-slate-200 px-2 py-1.5" :value="row.itemNo" @input="updateField(row, 'itemNo', $event.target.value)" />
            </td>
            <td class="px-3 py-3">
              <textarea class="min-h-16 w-full rounded-lg border border-slate-200 px-2 py-1.5" :value="row.description" @input="updateField(row, 'description', $event.target.value)" />
            </td>
            <td class="px-3 py-3">
              <input class="w-40 rounded-lg border border-slate-200 px-2 py-1.5" :value="row.hsCode" @input="updateField(row, 'hsCode', $event.target.value)" />
            </td>
            <td class="px-3 py-3">
              <input class="w-52 rounded-lg border border-slate-200 px-2 py-1.5" :value="row.permitNo" @input="updateField(row, 'permitNo', $event.target.value)" />
            </td>
            <td class="px-3 py-3">
              <input class="w-48 rounded-lg border border-slate-200 px-2 py-1.5" :value="row.declarationNo" @input="updateField(row, 'declarationNo', $event.target.value)" />
            </td>
            <td class="px-3 py-3">
              <input class="w-24 rounded-lg border border-slate-200 px-2 py-1.5" :value="row.declarationItem" @input="updateField(row, 'declarationItem', $event.target.value)" />
            </td>
            <td class="px-3 py-3">
              <input class="w-24 rounded-lg border border-slate-200 px-2 py-1.5" :value="row.netWeight" @input="updateField(row, 'netWeight', $event.target.value)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="!filteredRows.length" class="px-6 py-12 text-center text-sm text-slate-500">
      沒有符合目前篩選條件的資料。
    </div>
  </div>
</template>
