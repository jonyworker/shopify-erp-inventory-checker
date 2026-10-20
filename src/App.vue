<script setup>
import {
  computed,
  ref,
  watch,
  onMounted
} from 'vue'

import {
  currentUser,
  initializeAuth
} from '@/stores/authState'

import AppSidebar from './components/AppSidebar.vue'
import AdminPermissionOverview from './tools/admin/AdminPermissionOverview.vue'
import AdminDepartmentManager from './tools/admin/AdminDepartmentManager.vue'
import AdminEmployeeManager from './tools/admin/AdminEmployeeManager.vue'
import {
  permissionReady,
  permissionUserId,
  isSystemAdmin,
  can,
  canViewTool
} from '@/stores/permissionState'

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

import ProductManager from './tools/products/ProductManager.vue'
import ApplicationBuilder from './tools/products/ApplicationBuilder.vue'
import MeetingArchive from './tools/meetings/MeetingArchive.vue'


/* ========================================
   App State
======================================== */

const currentTool =
    ref('')

const sidebarCollapsed =
    ref(false)

const mobileSidebarOpen =
    ref(false)

// 管理權限與一般業務權限分離。
// 僅在後端回傳的管理員身分與當前 Auth 使用者一致時顯示入口。
const ADMIN_PERMISSION_PAGE_KEY = 'adminPermissionOverview'
const ADMIN_DEPARTMENT_PAGE_KEY = 'adminDepartmentManager'
const ADMIN_EMPLOYEE_PAGE_KEY = 'adminEmployeeManager'
const ADMIN_PAGE_KEYS = new Set([
  ADMIN_PERMISSION_PAGE_KEY,
  ADMIN_DEPARTMENT_PAGE_KEY,
  ADMIN_EMPLOYEE_PAGE_KEY
])

// 記錄進入管理頁面時已驗證的使用者 ID。
// 權限重新整理會暫時將 permissionReady / isSystemAdmin 清為 false，
// 這期間不能卸載管理頁面，否則選取的人員也會被重設。
const adminPageUserId = ref(null)

// 確保權限快照真正屬於目前登入者，切換帳號／重新載入時一律 fail-closed。
const isPermissionOwner = computed(() => Boolean(
  currentUser.value?.id &&
  permissionReady.value &&
  permissionUserId.value === currentUser.value.id
))

const canViewMeeting = computed(() =>
  isPermissionOwner.value && can('meetingArchive.view')
)

const isVerifiedAdmin = computed(() =>
  Boolean(
    currentUser.value?.id &&
    permissionReady.value &&
    isSystemAdmin.value &&
    permissionUserId.value === currentUser.value.id
  )
)

const adminToolGroup = {
  label: '系統管理',
  icon: 'admin',
  description: '管理人員與部門，並查看有效權限',
  tools: [
    {
      label: '人員管理',
      value: ADMIN_EMPLOYEE_PAGE_KEY
    },
    {
      label: '有效權限總覽',
      value: ADMIN_PERMISSION_PAGE_KEY
    },
    {
      label: '部門管理',
      value: ADMIN_DEPARTMENT_PAGE_KEY
    }
  ]
}


/* ========================================
   Tool Groups
======================================== */

const allToolGroups = [
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
    description: '建立產品申請文件與管理簽審公文',

    sections: [
      {
        label: '產品申請',

        tools: [
          {
            label: '產品資料管理',
            value: 'productManager'
          },

          {
            label: '申請書建立器',
            value: 'applicationBuilder'
          }
        ]
      },

      {
        label: '簽審管理',

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
    ]
  },

  {
    label: '會議管理',
    icon: 'meeting',
    description: '會議紀錄與全文搜尋',
    tools: [{ label: '會議紀錄', value: 'meetingArchive' }]
  }

  // 未來工具可以繼續加在這裡
]


// Sidebar 是有效檢視權限的投影。沒有 view 權限的工具直接從資料結構移除，
// 而非給 AppSidebar 傳 disabled:true (那會顯示灰色工具)。
// 依序過濾「工具 → 區段 → 群組」，避免空標題出現在展開及收合選單。
const toolGroups = computed(() => {
  const groups = []

  if (isPermissionOwner.value) {
    for (const group of allToolGroups) {
      if (Array.isArray(group.sections)) {
        const sections = group.sections
          .map(section => ({
            ...section,
            tools: (section.tools ?? []).filter(tool => canViewTool(tool.value))
          }))
          .filter(section => section.tools.length > 0)

        if (sections.length > 0) {
          groups.push({ ...group, sections, locked: false })
        }
        continue
      }

      const tools = (group.tools ?? []).filter(tool => canViewTool(tool.value))
      if (tools.length > 0) {
        groups.push({ ...group, tools, locked: false })
      }
    }
  }

  // 系統管理是獨立權限，不受業務工具的 view 權限影響。
  if (isVerifiedAdmin.value) groups.push(adminToolGroup)
  return groups
})


/* ========================================
   Current Tool
======================================== */

function getGroupTools(
    group
) {
  if (
      Array.isArray(
          group.sections
      )
  ) {
    return group.sections.flatMap(
        section =>
            section.tools ?? []
    )
  }


  return group.tools ?? []
}


const accessibleBusinessToolKeys = computed(() => new Set(
  toolGroups.value
    .filter(group => group !== adminToolGroup)
    .flatMap(group => getGroupTools(group).map(tool => tool.value))
))

const canRenderCurrentBusinessTool = computed(() =>
  isPermissionOwner.value && accessibleBusinessToolKeys.value.has(currentTool.value)
)

const firstAccessibleTool = computed(() => {
  const firstBusinessTool = toolGroups.value
    .filter(group => group !== adminToolGroup)
    .flatMap(group => getGroupTools(group))[0]

  // 即使管理員沒有業務權限，仍然可以進入系統管理。
  return firstBusinessTool?.value ?? (isVerifiedAdmin.value ? ADMIN_EMPLOYEE_PAGE_KEY : '')
})

const currentToolInfo =
    computed(() => {
      return toolGroups.value
          .flatMap(
              group =>
                  getGroupTools(
                      group
                  )
          )
          .find(
              tool =>
                  tool.value ===
                  currentTool.value
          )
    })


const currentToolLabel =
    computed(() => {
      return (
          currentToolInfo.value
              ?.label ??
          'PTS Internal Tools'
      )
    })


/* ========================================
   Current Component
======================================== */

const currentComponent =
    computed(() => {
      // 沒有有效 view 權限，不得掛載任何業務元件。
      // 不只要在 Sidebar 隱藏入口，也要避免保留上一個帳號的舊頁面。
      if (!ADMIN_PAGE_KEYS.has(currentTool.value) && !canRenderCurrentBusinessTool.value) {
        return null
      }


      // 只有已驗證的管理員，或同一位「曾經驗證成功」的管理員，
      // 才維持管理頁面元件的掛載，避免重新整理權限時丟失人員選擇。
      // 管理頁內仍以 verifiedAdmin 決定是否顯示資料，後端 RPC 也會再次授權。
      if (ADMIN_PAGE_KEYS.has(currentTool.value)) {
        const isSameAdminSession = Boolean(
          currentUser.value?.id &&
          adminPageUserId.value === currentUser.value.id
        )

        if (!isVerifiedAdmin.value && !isSameAdminSession) {
          return null
        }

        if (currentTool.value === ADMIN_EMPLOYEE_PAGE_KEY) return AdminEmployeeManager
        if (currentTool.value === ADMIN_DEPARTMENT_PAGE_KEY) return AdminDepartmentManager
        return AdminPermissionOverview
      }

      switch (
          currentTool.value
          ) {
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

        case 'productManager':
          return ProductManager

        case 'applicationBuilder':
          return ApplicationBuilder

        case 'permitPdfParser':
          return PermitPdfParser

        case 'permitSearch':
          return PermitSearch

        case 'meetingArchive':
          return canViewMeeting.value ? MeetingArchive : null

        default:
          return null
      }
    })


/* ========================================
   All business routes: authorization
======================================== */

// 權限重新載入期間不渲染業務元件，但不急著切頁，避免 UI 閃爍。
// 當新快照已確認後，如果原工具已被撤銷，轉到第一個仍有檢視權的工具。
// 沒有任何工具可用時停在空白頁並顯示明確狀態，不可退回未授權的預設工具。
watch(
  [currentTool, () => currentUser.value?.id, permissionReady, permissionUserId, toolGroups],
  () => {
    if (ADMIN_PAGE_KEYS.has(currentTool.value)) return // 由原本管理員專用 watcher 處理

    if (!currentUser.value?.id) {
      if (currentTool.value) currentTool.value = ''
      return
    }
    if (!isPermissionOwner.value) return

    if (!canRenderCurrentBusinessTool.value) {
      currentTool.value = firstAccessibleTool.value
    }
  },
  { immediate: true }
)

/* ========================================
   Auth
======================================== */

watch(
  [currentTool, () => currentUser.value?.id, permissionReady, isSystemAdmin, permissionUserId],
  () => {
    if (!ADMIN_PAGE_KEYS.has(currentTool.value)) {
      adminPageUserId.value = null
      return
    }

    const userId = currentUser.value?.id ?? null

    // 登出或在管理頁面中切換為其他帳號：立即離開並清除頁面持有人。
    if (!userId || (adminPageUserId.value && adminPageUserId.value !== userId)) {
      adminPageUserId.value = null
      currentTool.value = ''
      return
    }

    if (isVerifiedAdmin.value) {
      // 記下已成功驗證的管理員，之後重新載入權限時沿用同一頁面。
      adminPageUserId.value = userId
      return
    }

    // 只有「已完成查詢並確定不是管理員」才自動退出。
    // permissionReady=false 包含讀取中與讀取失敗，不能用來判定權限被撤銷。
    // 此時管理頁會暫停顯示受保護資料，不會向非管理員洩漏資訊。
    if (permissionReady.value) {
      adminPageUserId.value = null
      currentTool.value = ''
    }
  },
  { immediate: true }
)


onMounted(() => {
  initializeAuth()
})
</script>


<template>
  <div
      class="
      min-h-screen
      bg-slate-50
    "
  >
    <!-- ========================================
         Sidebar
    ========================================= -->

    <AppSidebar
        v-model="currentTool"
        v-model:mobile-open="mobileSidebarOpen"
        :groups="toolGroups"
        @update:collapsed="
        sidebarCollapsed =
          $event
      "
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
            @click="
            mobileSidebarOpen =
              true
          "
        >
          <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              class="
              h-5
              w-5
            "
          >
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
                d="
                M4 6h16
                M4 12h16
                M4 18h16
              "
            />
          </svg>
        </button>


        <!-- Current Tool -->

        <div
            class="
            ml-3
            min-w-0
          "
        >
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

        <div
            v-if="!ADMIN_PAGE_KEYS.has(currentTool) && !canRenderCurrentBusinessTool"
            role="status"
            class="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-600"
        >
          <template v-if="!currentUser?.id">
            請先登入，才能使用 PTS 工具。
          </template>
          <template v-else-if="!isPermissionOwner">
            正在確認您的功能權限，請稍候…
          </template>
          <template v-else>
            目前沒有獲得任何可使用工具的檢視權限，請聯絡系統管理員。
          </template>
        </div>
        <component
            v-else
            :is="currentComponent"
        />
      </div>
    </main>
  </div>
</template>