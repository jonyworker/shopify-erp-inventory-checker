<script setup>
import {
  computed,
  ref,
  onMounted
} from 'vue'

import { initializeAuth } from '@/stores/authState'

import AppSidebar from './components/AppSidebar.vue'

import InventoryShopifyChecker from './tools/inventory/InventoryShopifyChecker.vue'
import InventoryRutenChecker from './tools/inventory/InventoryRutenChecker.vue'

import PriceErpChecker from './tools/price/PriceErpChecker.vue'
import PriceShopifyChecker from './tools/price/PriceShopifyChecker.vue'
import PriceRutenChecker from './tools/price/PriceRutenChecker.vue'

import PromotionPriceBuilderTool from './tools/promotion/PromotionPriceBuilderTool.vue'
import ShopifyPromotionLaunchTool from './tools/promotion/ShopifyPromotionLaunchTool.vue'
import ShopifyPromotionEndTool from './tools/promotion/ShopifyPromotionEndTool.vue'

import CustomsDeclarationParser from './tools/customs/CustomsDeclarationParser.vue'

import PermitPdfParser from './tools/permits/PermitPdfParser.vue'
import PermitSearch from './tools/permits/PermitSearch.vue'


/* ========================================
   App State
======================================== */

const currentTool = ref('inventoryShopify')

const sidebarCollapsed = ref(false)

const mobileSidebarOpen = ref(false)


/* ========================================
   Tool Groups
======================================== */

const toolGroups = [
  {
    label: '庫存工具',
    icon: 'inventory',
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
    icon: 'price',
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
    icon: 'shopify',
    description: '活動商品上架與下架管理',
    tools: [
      {
        label: 'Promotion 價格產生器',
        value: 'promotionPriceBuilder'
      },
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
    icon: 'customs',
    description: '整理進出口報單與 Invoice 紀錄',
    tools: [
      {
        label: '進出口報單整理',
        value: 'customsDeclarationParser'
      }
    ]
  },

  {
    label: '公文工具',
    icon: 'permit',
    description: '管理警政署槍砲彈藥簽審核准公文',
    tools: [
      {
        label: '簽審資料查詢',
        value: 'permitSearch'
      },
      {
        label: '簽審公文匯入',
        value: 'permitPdfParser'
      }
    ]
  }

  // 未來工具可以繼續加在這裡
]


/* ========================================
   Current Tool
======================================== */

const currentToolInfo = computed(() => {
  return toolGroups
      .flatMap(group => group.tools)
      .find(tool => tool.value === currentTool.value)
})

const currentToolLabel = computed(() => {
  return currentToolInfo.value?.label ?? 'PTS Internal Tools'
})


/* ========================================
   Current Component
======================================== */

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

    case 'promotionPriceBuilder':
      return PromotionPriceBuilderTool

    case 'shopifyPromotionLaunch':
      return ShopifyPromotionLaunchTool

    case 'shopifyPromotionEnd':
      return ShopifyPromotionEndTool

    case 'customsDeclarationParser':
      return CustomsDeclarationParser

    case 'permitPdfParser':
      return PermitPdfParser

    case 'permitSearch':
      return PermitSearch

    default:
      return InventoryShopifyChecker
  }
})


/* ========================================
   Auth
======================================== */

onMounted(() => {
  initializeAuth()
})
</script>


<template>
  <div class="min-h-screen bg-slate-50">

    <!-- ========================================
         Sidebar
    ========================================= -->

    <AppSidebar
        v-model="currentTool"
        v-model:mobile-open="mobileSidebarOpen"
        :groups="toolGroups"
        @update:collapsed="sidebarCollapsed = $event"
    />


    <!-- ========================================
         Main
    ========================================= -->

    <main
        class="
        min-h-screen
        transition-[padding]
        duration-200
      "
        :class="
        sidebarCollapsed
          ? 'lg:pl-[72px]'
          : 'lg:pl-72'
      "
    >

      <!-- ========================================
           Mobile Header
      ========================================= -->

      <header
          class="
          sticky
          top-0
          z-30
          flex
          h-16
          items-center
          border-b
          border-slate-200
          bg-white/95
          px-4
          backdrop-blur
          lg:hidden
        "
      >
        <!-- Hamburger -->
        <button
            type="button"
            class="
            -ml-1
            flex
            h-10
            w-10
            shrink-0
            items-center
            justify-center
            rounded-lg
            text-slate-600
            transition
            hover:bg-slate-100
            hover:text-slate-950
          "
            aria-label="開啟選單"
            @click="mobileSidebarOpen = true"
        >
          <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              class="h-5 w-5"
          >
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
                d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>


        <!-- Current Tool -->
        <div class="ml-3 min-w-0">
          <p
              class="
              text-[9px]
              font-bold
              uppercase
              tracking-[0.2em]
              text-slate-400
            "
          >
            PTS Internal Tools
          </p>

          <p
              class="
              mt-0.5
              truncate
              text-sm
              font-semibold
              text-slate-900
            "
          >
            {{ currentToolLabel }}
          </p>
        </div>
      </header>


      <!-- ========================================
           Content
      ========================================= -->

      <div
          class="
          mx-auto
          max-w-7xl
          px-4
          py-6
          md:px-8
          md:py-8
        "
      >

        <!-- Current Tool Component -->
        <component :is="currentComponent" />

      </div>
    </main>
  </div>
</template>