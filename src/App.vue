<script setup>
import { computed, ref } from 'vue'
import ToolSwitcher from './components/ToolSwitcher.vue'
import InventoryShopifyChecker from './tools/inventory/InventoryShopifyChecker.vue'
import InventoryRutenChecker from './tools/inventory/InventoryRutenChecker.vue'
import PriceErpChecker from './tools/price/PriceErpChecker.vue'
import PriceShopifyChecker from './tools/price/PriceShopifyChecker.vue'
import PriceRutenChecker from './tools/price/PriceRutenChecker.vue'
import ShopifyPromotionLaunchTool from './tools/promotion/ShopifyPromotionLaunchTool.vue'
import ShopifyPromotionEndTool from './tools/promotion/ShopifyPromotionEndTool.vue'
import CustomsDeclarationParser from './tools/customs/CustomsDeclarationParser.vue'

const currentTool = ref('inventoryShopify')

const toolGroups = [
  {
    label: '庫存工具',
    description: '比對 ERP 與通路庫存資料',
    tools: [
      {
        label: 'ERP / Shopify 庫存比對',
        value: 'inventoryShopify'
      },
      {
        label: 'ERP / Ruten 庫存比對',
        value: 'inventoryRuten'
      }
    ]
  },
  {
    label: '價格工具',
    description: '比對 RRP、ERP 與通路價格資料',
    tools: [
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
      }
    ]
  },
  {
    label: 'Shopify 工具',
    description: '活動商品上架與下架管理',
    tools: [
      {
        label: 'Promotion 商品上架',
        value: 'shopifyPromotionLaunch'
      },
      {
        label: 'Promotion 商品下架',
        value: 'shopifyPromotionEnd'
      }
    ]
  },

  {
    label: '報關工具',
    description: '整理進出口報單與 Invoice 紀錄',
    tools: [
      {
        label: '進出口報單整理',
        value: 'customsDeclarationParser'
      }
    ]
  },
  // {
  //   label: '未來工具',
  //   description: '預留後續擴充功能',
  //   tools: [
  //     {
  //       label: '未來工具一',
  //       value: 'future-1',
  //       disabled: true
  //     },
  //     {
  //       label: '未來工具二',
  //       value: 'future-2',
  //       disabled: true
  //     }
  //   ]
  // }
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

    case 'shopifyPromotionLaunch':
      return ShopifyPromotionLaunchTool

    case 'shopifyPromotionEnd':
      return ShopifyPromotionEndTool

    case 'customsDeclarationParser':
      return CustomsDeclarationParser

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
            庫存、價格、Shopify 活動與報關工具集中管理。
          </p>
        </div>

        <ToolSwitcher
            v-model="currentTool"
            :groups="toolGroups"
        />
      </section>

      <component :is="currentComponent" />
    </div>
  </main>
</template>