<script setup>
const props = defineProps({
  title: {
    type: String,
    required: true
  },
  columns: {
    type: Array,
    default: () => []
  },
  skuColumn: {
    type: String,
    default: ''
  },
  qtyColumn: {
    type: String,
    default: ''
  },
  skuLabel: {
    type: String,
    default: 'SKU 欄位'
  },
  qtyLabel: {
    type: String,
    default: '庫存數量欄位'
  }
})

const emit = defineEmits(['update:skuColumn', 'update:qtyColumn'])
</script>

<template>
  <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 class="mb-4 text-lg font-semibold text-slate-900">
      {{ props.title }}
    </h2>

    <div class="grid gap-4 md:grid-cols-2">
      <label class="block">
        <span class="mb-1 block text-sm font-medium text-slate-700">{{ props.skuLabel }}</span>
        <select
          class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
          :value="props.skuColumn"
          @change="emit('update:skuColumn', $event.target.value)"
        >
          <option value="">請選擇</option>
          <option v-for="column in props.columns" :key="column" :value="column">
            {{ column }}
          </option>
        </select>
      </label>

      <label class="block">
        <span class="mb-1 block text-sm font-medium text-slate-700">{{ props.qtyLabel }}</span>
        <select
          class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
          :value="props.qtyColumn"
          @change="emit('update:qtyColumn', $event.target.value)"
        >
          <option value="">請選擇</option>
          <option v-for="column in props.columns" :key="column" :value="column">
            {{ column }}
          </option>
        </select>
      </label>
    </div>
  </section>
</template>
