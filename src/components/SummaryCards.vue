<script setup>
const props = defineProps({
  summary: {
    type: Object,
    required: true
  },
  labels: {
    type: Object,
    default: () => ({
      total: '總筆數',
      matched: '一致',
      different: '價格不一致',
      missing: '缺少品項'
    })
  }
})
</script>

<template>
  <section class="grid gap-4 md:grid-cols-4">
    <div class="rounded-2xl bg-white p-5 shadow-sm">
      <p class="text-sm text-slate-500">{{ props.labels.total }}</p>
      <p class="mt-2 text-3xl font-bold text-slate-900">{{ props.summary.total }}</p>
    </div>
    <div class="rounded-2xl bg-white p-5 shadow-sm">
      <p class="text-sm text-slate-500">{{ props.labels.matched }}</p>
      <p class="mt-2 text-3xl font-bold text-emerald-700">{{ props.summary.matched }}</p>
    </div>
    <div class="rounded-2xl bg-white p-5 shadow-sm">
      <p class="text-sm text-slate-500">{{ props.labels.different }}</p>
      <p class="mt-2 text-3xl font-bold text-amber-700">{{ props.summary.different }}</p>
    </div>
    <div class="rounded-2xl bg-white p-5 shadow-sm">
      <p class="text-sm text-slate-500">{{ props.labels.missing }}</p>
      <p class="mt-2 text-3xl font-bold text-rose-700">{{ props.summary.missing }}</p>
    </div>
  </section>
</template>
