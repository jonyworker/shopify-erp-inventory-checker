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
      different: '不一致',
      sourceOnly: '基準資料獨有',
      targetOnly: '比對資料獨有'
    })
  }
})
</script>

<template>
  <section class="grid gap-4 md:grid-cols-5">
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
      <p class="text-sm text-slate-500">{{ props.labels.sourceOnly }}</p>
      <p class="mt-2 text-3xl font-bold text-sky-700">{{ props.summary.sourceOnly }}</p>
    </div>

    <div class="rounded-2xl bg-white p-5 shadow-sm">
      <p class="text-sm text-slate-500">{{ props.labels.targetOnly }}</p>
      <p class="mt-2 text-3xl font-bold text-rose-700">{{ props.summary.targetOnly }}</p>
    </div>
  </section>
</template>