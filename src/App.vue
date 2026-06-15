<script setup>
import { computed, ref } from 'vue'
import ToolSwitcher from './components/ToolSwitcher.vue'
import InventoryShopifyChecker from './tools/inventory/InventoryShopifyChecker.vue'
import InventoryRutenChecker from './tools/inventory/InventoryRutenChecker.vue'
import PriceErpChecker from './tools/price/PriceErpChecker.vue'
import PriceShopifyChecker from './tools/price/PriceShopifyChecker.vue'
import PriceRutenChecker from './tools/price/PriceRutenChecker.vue'

const currentTool = ref('inventoryShopify')

const toolOptions = [
  {
    label: 'ERP / Shopify 庫存比對',
    value: 'inventoryShopify'
  },
  {
    label: 'ERP / Ruten 庫存比對',
    value: 'inventoryRuten'
  },
  {
    label: 'RRP / ERP 價格比對',
    value: 'priceErp'
  },
  {
    label: 'RRP / Shopify 價格比對',
    value: 'priceShopify'
  },
  {
    label: 'RRP / Ruten 價格比對',
    value: 'priceRuten'
  },
  {
    label: '未來工具一',
    value: 'future-1',
    disabled: true
  },
  {
    label: '未來工具二',
    value: 'future-2',
    disabled: true
  }
]

const currentComponent = computed(() => {
  switch (currentTool.value) {
    case 'inventoryShopify':
      return InventoryShopifyChecker

    case 'inventoryRuten':
      return InventoryRutenChecker

    case 'priceErp':
      return PriceErpChecker

    case 'priceShopify':
      return PriceShopifyChecker

    case 'priceRuten':
      return PriceRutenChecker

    default:
      return InventoryShopifyChecker
  }
})
</script>

<template>
  <main class="min-h-screen px-4 py-8 md:px-8">
    <div class="mx-auto max-w-7xl">
      <section class="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
            Internal Tools
          </p>

          <h1 class="mt-2 text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">
            公司內部工具箱
          </h1>

          <p class="mt-2 text-sm text-slate-500">
            庫存、價格與未來資料比對工具集中管理。
          </p>
        </div>

        <ToolSwitcher
            v-model="currentTool"
            :options="toolOptions"
        />
      </section>

      <component :is="currentComponent" />
    </div>
  </main>
</template>
