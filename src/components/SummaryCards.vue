<script setup>
defineProps({
  summary: {
    type: Object,
    required: true
  }
})
</script>

<template>
  <section class="grid gap-4 md:grid-cols-4">
    <div class="rounded-2xl bg-white p-5 shadow-sm">
      <p class="text-sm text-slate-500">總筆數</p>
      <p class="mt-2 text-3xl font-bold text-slate-900">{{ summary.total }}</p>
    </div>
    <div class="rounded-2xl bg-white p-5 shadow-sm">
      <p class="text-sm text-slate-500">一致</p>
      <p class="mt-2 text-3xl font-bold text-emerald-700">{{ summary.matched }}</p>
    </div>
    <div class="rounded-2xl bg-white p-5 shadow-sm">
      <p class="text-sm text-slate-500">數量不一致</p>
      <p class="mt-2 text-3xl font-bold text-amber-700">{{ summary.different }}</p>
    </div>
    <div class="rounded-2xl bg-white p-5 shadow-sm">
      <p class="text-sm text-slate-500">缺少 SKU</p>
      <p class="mt-2 text-3xl font-bold text-rose-700">{{ summary.missing }}</p>
    </div>
  </section>
</template>
