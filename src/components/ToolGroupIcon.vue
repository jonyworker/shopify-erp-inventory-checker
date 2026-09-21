<script setup>
defineProps({
  type: {
    type: String,
    required: true
  }
})
</script>

<template>
  <!-- 庫存 -->
  <svg
      v-if="type === 'inventory'"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
  >
    <path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" />
    <path d="M4 12l8 4.5 8-4.5" />
    <path d="M4 16.5 12 21l8-4.5" />
  </svg>

  <!-- 價格 -->
  <svg
      v-else-if="type === 'price'"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
  >
    <path d="M12 2v20" />
    <path
        d="
        M17 6.5
        C15.8 5.5 14.2 5 12.5 5
        C9.8 5 8 6.3 8 8.3
        C8 10.2 9.6 11.1 12.4 11.8
        C15.4 12.6 17 13.6 17 15.8
        C17 18 15 19.3 12.2 19.3
        C10.1 19.3 8.2 18.6 7 17.3
      "
    />
  </svg>

  <!-- Shopify / 商店 -->
  <svg
      v-else-if="type === 'shopify'"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
  >
    <path d="M5 9h14l-1 12H6L5 9Z" />
    <path d="M9 9V7a3 3 0 0 1 6 0v2" />
  </svg>

  <!-- 報關 / 文件 -->
  <svg
      v-else-if="type === 'customs'"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
  >
    <path d="M6 3h8l4 4v14H6V3Z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6" />
    <path d="M9 17h6" />
  </svg>

  <!-- 公文 / 核准 -->
  <svg
      v-else-if="type === 'permit'"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
  >
    <path d="M12 3 19 6v5c0 4.5-2.8 8.2-7 10-4.2-1.8-7-5.5-7-10V6l7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>

  <!-- fallback -->
  <svg
      v-else
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      class="h-5 w-5"
      aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8" />
  </svg>
</template>