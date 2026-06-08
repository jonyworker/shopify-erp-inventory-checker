<script setup>
defineProps({
  modelValue: {
    type: String,
    required: true
  },
  options: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:modelValue'])

function handleChange(event) {
  emit('update:modelValue', event.target.value)
}
</script>

<template>
  <label class="w-full sm:w-72">
    <span class="mb-1 block text-sm font-medium text-slate-700">工具切換</span>
    <select
      :value="modelValue"
      class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition hover:border-slate-400 focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
      @change="handleChange"
    >
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>
  </label>
</template>
