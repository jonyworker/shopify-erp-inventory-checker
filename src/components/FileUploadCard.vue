<script setup>
const props = defineProps({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  filename: {
    type: String,
    default: ''
  },
  rowCount: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['change'])

function handleChange(event) {
  const file = event.target.files?.[0]
  if (!file) return
  emit('change', file)
}
</script>

<template>
  <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div class="mb-4">
      <h2 class="text-lg font-semibold text-slate-900">
        {{ props.title }}
      </h2>
      <p class="mt-1 text-sm text-slate-500">
        {{ props.description }}
      </p>
    </div>

    <label class="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition hover:border-slate-400 hover:bg-slate-100">
      <span class="text-sm font-medium text-slate-700">選擇檔案</span>
      <span class="mt-1 text-xs text-slate-500">支援 .csv / .xlsx / .xls</span>
      <input class="hidden" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="handleChange" />
    </label>

    <div v-if="props.filename" class="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
      <p class="font-medium">{{ props.filename }}</p>
      <p class="mt-1 text-slate-500">已讀取 {{ props.rowCount }} 筆資料</p>
    </div>
  </section>
</template>
