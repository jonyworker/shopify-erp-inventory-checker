<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  modelValue: {
    type: String,
    required: true
  },
  groups: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:modelValue'])

const isOpen = ref(false)

const currentLabel = computed(() => {
  for (const group of props.groups) {
    const foundTool = group.tools.find((tool) => tool.value === props.modelValue)

    if (foundTool) return foundTool.label
  }

  return '請選擇工具'
})

function selectTool(tool) {
  if (tool.disabled) return

  emit('update:modelValue', tool.value)
  isOpen.value = false
}
</script>

<template>
  <div class="relative w-full sm:w-80">
    <p class="mb-1 text-sm font-medium text-slate-700">
      工具切換
    </p>

    <button
        type="button"
        class="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 outline-none transition hover:border-slate-400 focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
        @click="isOpen = !isOpen"
    >
      <span>{{ currentLabel }}</span>
      <span class="text-slate-400">⌄</span>
    </button>

    <div
        v-if="isOpen"
        class="absolute right-0 z-20 mt-2 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
    >
      <section
          v-for="group in groups"
          :key="group.label"
          class="py-2"
      >
        <p class="px-3 pb-1 text-xs font-bold tracking-wide text-slate-500">
          {{ group.label }}
        </p>

        <button
            v-for="tool in group.tools"
            :key="tool.value"
            type="button"
            class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition"
            :class="[
            modelValue === tool.value
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100',
            tool.disabled
              ? 'cursor-not-allowed opacity-40 hover:bg-transparent'
              : 'cursor-pointer'
          ]"
            :disabled="tool.disabled"
            @click="selectTool(tool)"
        >
          <span>{{ tool.label }}</span>

          <span
              v-if="modelValue === tool.value"
              class="text-xs text-white/80"
          >
            使用中
          </span>

          <span
              v-else-if="tool.disabled"
              class="text-xs text-slate-400"
          >
            未開放
          </span>
        </button>
      </section>
    </div>
  </div>
</template>