<script setup>
const props = defineProps({
  filename: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['change'])

function handleChange(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  emit('change', file)
}
</script>

<template>
  <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div class="mb-4">
      <h2 class="text-lg font-semibold text-slate-900">報單 PDF</h2>
      <p class="mt-1 text-sm leading-6 text-slate-500">
        支援文字型與掃描型 PDF。掃描頁會在瀏覽器內進行 OCR，資料不會上傳到本工具的伺服器。
      </p>
    </div>

    <label
      class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-9 text-center transition"
      :class="disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-slate-400 hover:bg-slate-100'"
    >
      <span class="text-sm font-semibold text-slate-800">選擇報單 PDF</span>
      <span class="mt-1 text-xs text-slate-500">支援 .pdf</span>
      <input class="hidden" type="file" accept="application/pdf,.pdf" :disabled="disabled" @change="handleChange" />
    </label>

    <div v-if="props.filename" class="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
      <p class="font-medium">{{ props.filename }}</p>
    </div>
  </section>
</template>
