<script setup>
import {
  ref,
  computed,
  onMounted
} from 'vue'

import {
  getProducts
} from '@/utils/products/productRepository'

import {
  generateApplicationDocx,
  downloadApplicationDocx
} from '@/utils/products/applicationDocxBuilder'


// =========================================================
// Definitions
// =========================================================

const partCategoryDefinitions = [
  {
    value: 'body',
    label: '槍身'
  },

  {
    value: 'slide',
    label: '滑套'
  },

  {
    value: 'barrel',
    label: '槍管'
  },

  {
    value: 'magazine',
    label: '彈匣'
  },

  {
    value: 'bolt',
    label: '槍機'
  },

  {
    value: 'other',
    label: '其他'
  }
]


// =========================================================
// State
// =========================================================

const applicationNumber =
    ref('')

const products =
    ref([])

const selectedGunIds =
    ref([])

const selectedPartIds =
    ref([])

const searchKeyword =
    ref('')

const activeLibraryTab =
    ref('gun')

const expandedPartCategories =
    ref({
      body: false,
      slide: false,
      barrel: false,
      magazine: false,
      bolt: false,
      other: false
    })

const isLoading =
    ref(false)

const isGeneratingWord =
    ref(false)

const errorMessage =
    ref('')

const successMessage =
    ref('')


// =========================================================
// Computed
// =========================================================

const activeProducts =
    computed(() => {
      return products.value.filter(
          product =>
              product.is_active
      )
    })


const allGunProducts =
    computed(() => {
      return activeProducts.value.filter(
          product =>
              product.product_type ===
              'gun'
      )
    })


const allPartProducts =
    computed(() => {
      return activeProducts.value.filter(
          product =>
              product.product_type ===
              'part'
      )
    })


const libraryProducts =
    computed(() => {
      const source =
          activeLibraryTab.value === 'gun'
              ? allGunProducts.value
              : allPartProducts.value


      const keyword =
          searchKeyword.value
              .trim()
              .toLowerCase()


      if (!keyword) {
        return source
      }


      return source.filter(
          product => {
            const name =
                String(
                    product.name ?? ''
                )
                    .toLowerCase()


            const category =
                getPartCategoryLabel(
                    product
                )
                    .toLowerCase()


            return (
                name.includes(
                    keyword
                ) ||
                category.includes(
                    keyword
                )
            )
          }
      )
    })


const groupedPartProducts =
    computed(() => {
      if (
          activeLibraryTab.value !==
          'part'
      ) {
        return []
      }


      return partCategoryDefinitions
          .map(
              category => {
                return {
                  ...category,

                  products:
                      libraryProducts.value.filter(
                          product =>
                              product.part_category ===
                              category.value
                      )
                }
              }
          )
          .filter(
              category =>
                  category.products.length >
                  0
          )
    })


const selectedGunProducts =
    computed(() => {
      return selectedGunIds.value
          .map(
              productId =>
                  products.value.find(
                      product =>
                          product.id ===
                          productId
                  )
          )
          .filter(Boolean)
    })


const selectedPartProducts =
    computed(() => {
      return selectedPartIds.value
          .map(
              productId =>
                  products.value.find(
                      product =>
                          product.id ===
                          productId
                  )
          )
          .filter(Boolean)
    })


const selectedProductCount =
    computed(() => {
      return (
          selectedGunIds.value.length +
          selectedPartIds.value.length
      )
    })


const canGenerateWord =
    computed(() => {
      return (
          Boolean(
              applicationNumber.value.trim()
          ) &&
          selectedProductCount.value > 0 &&
          !isGeneratingWord.value
      )
    })


// =========================================================
// Load
// =========================================================

async function loadProducts() {
  isLoading.value = true
  errorMessage.value = ''


  try {
    products.value =
        await getProducts()
  } catch (error) {
    console.error(error)

    errorMessage.value =
        `讀取產品資料失敗：${error.message}`
  } finally {
    isLoading.value = false
  }
}


// =========================================================
// Library Tab
// =========================================================

function selectLibraryTab(
    type
) {
  activeLibraryTab.value =
      type

  searchKeyword.value =
      ''
}


function isPartCategoryExpanded(
    category
) {
  return (
      expandedPartCategories.value[
          category
          ] !== false
  )
}


function togglePartCategory(
    category
) {
  expandedPartCategories.value[
      category
      ] =
      !isPartCategoryExpanded(
          category
      )
}


// =========================================================
// Product Helpers
// =========================================================

function isProductSelected(
    product
) {
  if (
      product.product_type ===
      'gun'
  ) {
    return selectedGunIds.value.includes(
        product.id
    )
  }


  if (
      product.product_type ===
      'part'
  ) {
    return selectedPartIds.value.includes(
        product.id
    )
  }


  return false
}


function addProduct(
    product
) {
  if (
      !product ||
      isProductSelected(
          product
      )
  ) {
    return
  }


  errorMessage.value = ''
  successMessage.value = ''


  if (
      product.product_type ===
      'gun'
  ) {
    selectedGunIds.value.push(
        product.id
    )

    return
  }


  if (
      product.product_type ===
      'part'
  ) {
    selectedPartIds.value.push(
        product.id
    )
  }
}


function addPartCategoryProducts(
    categoryProducts
) {
  if (
      !Array.isArray(
          categoryProducts
      ) ||
      categoryProducts.length ===
      0
  ) {
    return
  }


  errorMessage.value = ''
  successMessage.value = ''


  const currentIds =
      new Set(
          selectedPartIds.value
      )


  for (
      const product
      of categoryProducts
      ) {
    if (
        product.product_type ===
        'part'
    ) {
      currentIds.add(
          product.id
      )
    }
  }


  selectedPartIds.value =
      Array.from(
          currentIds
      )
}


function areAllPartCategoryProductsSelected(
    categoryProducts
) {
  if (
      !Array.isArray(
          categoryProducts
      ) ||
      categoryProducts.length ===
      0
  ) {
    return false
  }


  return categoryProducts.every(
      product =>
          selectedPartIds.value.includes(
              product.id
          )
  )
}


function removeProduct(
    product
) {
  errorMessage.value = ''
  successMessage.value = ''


  if (
      product.product_type ===
      'gun'
  ) {
    selectedGunIds.value =
        selectedGunIds.value.filter(
            id =>
                id !==
                product.id
        )

    return
  }


  if (
      product.product_type ===
      'part'
  ) {
    selectedPartIds.value =
        selectedPartIds.value.filter(
            id =>
                id !==
                product.id
        )
  }
}


// =========================================================
// Reorder
// =========================================================

function moveSelectedProduct(
    type,
    index,
    direction
) {
  const ids =
      type === 'gun'
          ? [
            ...selectedGunIds.value
          ]
          : [
            ...selectedPartIds.value
          ]


  const targetIndex =
      index + direction


  if (
      targetIndex < 0 ||
      targetIndex >=
      ids.length
  ) {
    return
  }


  const currentId =
      ids[index]


  ids[index] =
      ids[targetIndex]

  ids[targetIndex] =
      currentId


  if (
      type === 'gun'
  ) {
    selectedGunIds.value =
        ids
  } else {
    selectedPartIds.value =
        ids
  }


  successMessage.value = ''
}


// =========================================================
// Word Generation
// =========================================================

async function handleGenerateWord() {
  if (
      isGeneratingWord.value
  ) {
    return
  }


  if (
      !applicationNumber.value.trim()
  ) {
    errorMessage.value =
        '請輸入申辦案號'

    return
  }


  if (
      selectedProductCount.value ===
      0
  ) {
    errorMessage.value =
        '請至少加入一項產品'

    return
  }


  errorMessage.value = ''
  successMessage.value = ''

  isGeneratingWord.value =
      true


  try {
    const outputProducts = [
      ...selectedGunProducts.value,
      ...selectedPartProducts.value
    ]


    const blob =
        await generateApplicationDocx({
          applicationNumber:
              applicationNumber.value
                  .trim(),

          products:
          outputProducts
        })


    downloadApplicationDocx(
        blob,
        applicationNumber.value.trim()
    )


    successMessage.value =
        'Word 已產生完成'
  } catch (error) {
    console.error(error)

    errorMessage.value =
        `產生 Word 失敗：${error.message}`
  } finally {
    isGeneratingWord.value =
        false
  }
}


// =========================================================
// Labels
// =========================================================

function getPartCategoryLabel(
    product
) {
  if (
      product.product_type !==
      'part'
  ) {
    return ''
  }


  const labels = {
    body:
        '槍身',

    slide:
        '滑套',

    barrel:
        '槍管',

    magazine:
        '彈匣',

    bolt:
        '槍機'
  }


  if (
      product.part_category ===
      'other'
  ) {
    return (
        product.part_category_other ||
        '其他'
    )
  }


  return (
      labels[
          product.part_category
          ] ||
      '未分類'
  )
}


function getProductMetaLabel(
    product
) {
  if (
      product.product_type ===
      'gun'
  ) {
    return '全槍'
  }


  return getPartCategoryLabel(
      product
  )
}


// =========================================================
// Init
// =========================================================

onMounted(() => {
  loadProducts()
})
</script>


<template>
  <div>
    <!-- =================================================== -->
    <!-- Header -->
    <!-- =================================================== -->

    <header
        class="
        mb-6
      "
    >
      <p
          class="
          text-xs
          font-bold
          uppercase
          tracking-[0.2em]
          text-slate-400
        "
      >
        APPLICATION
      </p>

      <h1
          class="
          mt-2
          text-2xl
          font-bold
          text-slate-950
          md:text-3xl
        "
      >
        申請書建立器
      </h1>

      <p
          class="
          mt-2
          text-sm
          text-slate-500
        "
      >
        從左側產品素材庫加入本次申請內容，右側可調整 Word 的輸出順序。
      </p>
    </header>


    <!-- =================================================== -->
    <!-- Application Bar -->
    <!-- =================================================== -->

    <section
        class="
        mb-4
        rounded-2xl
        border
        border-slate-200
        bg-white
        p-5
        shadow-sm
      "
    >
      <div
          class="
          flex
          flex-col
          gap-4
          lg:flex-row
          lg:items-end
        "
      >
        <label
            class="
            min-w-0
            flex-1
          "
        >
          <span
              class="
              mb-2
              block
              text-sm
              font-semibold
              text-slate-700
            "
          >
            申辦案號
          </span>

          <input
              v-model="
              applicationNumber
            "
              type="text"
              placeholder="例如：115070902250"
              class="
              w-full
              rounded-xl
              border
              border-slate-300
              bg-white
              px-4
              py-3
              text-base
              text-slate-900
              outline-none
              transition
              focus:border-slate-500
            "
          >
        </label>


        <div
            class="
            flex
            flex-wrap
            items-center
            gap-3
          "
        >
          <div
              class="
              rounded-xl
              bg-slate-50
              px-4
              py-3
              text-sm
              text-slate-600
            "
          >
            <span
                class="
                font-semibold
                text-slate-900
              "
            >
              {{ selectedProductCount }}
            </span>
            項

            <span
                class="
                mx-2
                text-slate-300
              "
            >
              /
            </span>

            全槍
            <span
                class="
                font-semibold
                text-slate-900
              "
            >
              {{ selectedGunProducts.length }}
            </span>

            <span
                class="
                mx-2
                text-slate-300
              "
            >
              /
            </span>

            零件
            <span
                class="
                font-semibold
                text-slate-900
              "
            >
              {{ selectedPartProducts.length }}
            </span>
          </div>


          <button
              type="button"
              :disabled="
              !canGenerateWord
            "
              class="
              rounded-xl
              bg-slate-900
              px-5
              py-3
              text-sm
              font-semibold
              text-white
              transition
              hover:bg-slate-800
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
              @click="
              handleGenerateWord
            "
          >
            {{
              isGeneratingWord
                  ? 'Word 產生中...'
                  : '產生 Word'
            }}
          </button>
        </div>
      </div>
    </section>


    <!-- =================================================== -->
    <!-- Messages -->
    <!-- =================================================== -->

    <div
        v-if="
        errorMessage
      "
        class="
        mb-5
        rounded-xl
        bg-red-50
        px-4
        py-3
        text-sm
        text-red-700
      "
    >
      {{ errorMessage }}
    </div>


    <div
        v-if="
        successMessage
      "
        class="
        mb-5
        rounded-xl
        bg-emerald-50
        px-4
        py-3
        text-sm
        text-emerald-700
      "
    >
      {{ successMessage }}
    </div>


    <!-- =================================================== -->
    <!-- Workspace -->
    <!-- =================================================== -->

    <div
        class="
        grid
        items-start
        gap-4
        xl:grid-cols-[minmax(300px,0.75fr)_minmax(0,1.65fr)]
      "
    >
      <!-- ================================================= -->
      <!-- Left: Product Library -->
      <!-- ================================================= -->

      <aside
          class="
          overflow-hidden
          rounded-2xl
          border
          border-slate-200
          bg-white
          shadow-sm
        "
      >
        <!-- Header -->

        <div
            class="
            border-b
            border-slate-200
            p-5
          "
        >
          <div
              class="
              flex
              items-center
              justify-between
              gap-3
            "
          >
            <div>
              <h2
                  class="
                  text-lg
                  font-bold
                  text-slate-950
                "
              >
                產品素材庫
              </h2>

              <p
                  class="
                  mt-1
                  text-xs
                  text-slate-500
                "
              >
                選擇分類後加入本次申請。
              </p>
            </div>


            <span
                class="
                rounded-full
                bg-slate-100
                px-2.5
                py-1
                text-xs
                font-semibold
                text-slate-500
              "
            >
              {{ activeProducts.length }}
            </span>
          </div>


          <!-- Tabs -->

          <div
              class="
              mt-5
              grid
              grid-cols-2
              rounded-xl
              bg-slate-100
              p-1
            "
          >
            <button
                type="button"
                :class="[
                  'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition',

                  activeLibraryTab === 'gun'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                ]"
                @click="
                selectLibraryTab(
                  'gun'
                )
              "
            >
              <span>
                全槍
              </span>

              <span
                  :class="[
                    'rounded-full px-2 py-0.5 text-xs',

                    activeLibraryTab === 'gun'
                      ? 'bg-slate-100 text-slate-700'
                      : 'bg-slate-200/70 text-slate-500'
                  ]"
              >
                {{ allGunProducts.length }}
              </span>
            </button>


            <button
                type="button"
                :class="[
                  'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition',

                  activeLibraryTab === 'part'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                ]"
                @click="
                selectLibraryTab(
                  'part'
                )
              "
            >
              <span>
                零件
              </span>

              <span
                  :class="[
                    'rounded-full px-2 py-0.5 text-xs',

                    activeLibraryTab === 'part'
                      ? 'bg-slate-100 text-slate-700'
                      : 'bg-slate-200/70 text-slate-500'
                  ]"
              >
                {{ allPartProducts.length }}
              </span>
            </button>
          </div>


          <!-- Search -->

          <div
              class="
              mt-4
            "
          >
            <input
                v-model="
                searchKeyword
              "
                type="search"
                :placeholder="
                activeLibraryTab === 'gun'
                    ? '搜尋全槍...'
                    : '搜尋零件...'
              "
                class="
                w-full
                rounded-xl
                border
                border-slate-300
                px-3.5
                py-2.5
                text-sm
                outline-none
                focus:border-slate-500
              "
            >
          </div>
        </div>


        <!-- Loading -->

        <div
            v-if="
            isLoading
          "
            class="
            px-5
            py-16
            text-center
            text-sm
            text-slate-400
          "
        >
          正在讀取產品資料...
        </div>


        <!-- Product List -->

        <div
            v-else
            class="
            max-h-[70vh]
            overflow-y-auto
            p-5
          "
        >
          <!-- ============================================= -->
          <!-- Gun List -->
          <!-- ============================================= -->

          <template
              v-if="
              activeLibraryTab ===
              'gun'
            "
          >
            <div
                v-if="
                libraryProducts.length
              "
                class="
                space-y-2
              "
            >
              <div
                  v-for="
                  product
                  in libraryProducts
                "
                  :key="
                  product.id
                "
                  :class="[
                    'rounded-xl border p-3 transition',

                    isProductSelected(
                      product
                    )
                      ? 'border-slate-200 bg-slate-50 opacity-60'
                      : 'border-slate-200 bg-white hover:border-slate-400'
                  ]"
              >
                <div
                    class="
                    flex
                    items-start
                    gap-3
                  "
                >
                  <div
                      class="
                      min-w-0
                      flex-1
                    "
                  >
                    <p
                        class="
                        text-sm
                        font-semibold
                        leading-5
                        text-slate-900
                      "
                    >
                      {{ product.name }}
                    </p>

                    <p
                        class="
                        mt-1
                        text-xs
                        text-slate-400
                      "
                    >
                      全槍
                    </p>
                  </div>


                  <button
                      type="button"
                      :disabled="
                      isProductSelected(
                        product
                      )
                    "
                      class="
                      shrink-0
                      rounded-lg
                      border
                      border-slate-300
                      px-2.5
                      py-1.5
                      text-xs
                      font-semibold
                      text-slate-700
                      disabled:cursor-default
                      disabled:border-slate-200
                      disabled:text-slate-400
                    "
                      @click="
                      addProduct(
                        product
                      )
                    "
                  >
                    {{
                      isProductSelected(
                          product
                      )
                          ? '已加入'
                          : '加入 →'
                    }}
                  </button>
                </div>
              </div>
            </div>


            <div
                v-else
                class="
                rounded-xl
                border
                border-dashed
                border-slate-300
                px-4
                py-12
                text-center
                text-sm
                text-slate-400
              "
            >
              {{
                searchKeyword
                    ? '找不到符合搜尋條件的全槍產品。'
                    : '目前沒有啟用中的全槍產品。'
              }}
            </div>
          </template>


          <!-- ============================================= -->
          <!-- Part Groups -->
          <!-- ============================================= -->

          <template v-else>
            <div
                v-if="
                groupedPartProducts.length
              "
                class="
                space-y-3
              "
            >
              <section
                  v-for="
                  category
                  in groupedPartProducts
                "
                  :key="
                  category.value
                "
                  class="
                  overflow-hidden
                  rounded-xl
                  border
                  border-slate-200
                  bg-white
                "
              >
                <!-- Category Header -->

                <div
                    class="
                    flex
                    items-center
                    gap-2
                    px-3
                    py-2.5
                    transition
                    hover:bg-slate-50
                  "
                >
                  <button
                      type="button"
                      class="
                      flex
                      min-w-0
                      flex-1
                      items-center
                      gap-3
                      rounded-lg
                      px-1
                      py-1
                      text-left
                    "
                      @click="
                      togglePartCategory(
                        category.value
                      )
                    "
                  >
                    <span
                        class="
                        min-w-0
                        flex-1
                        text-sm
                        font-bold
                        text-slate-900
                      "
                    >
                      {{ category.label }}
                    </span>

                    <span
                        class="
                        rounded-full
                        bg-slate-100
                        px-2
                        py-0.5
                        text-xs
                        font-semibold
                        text-slate-500
                      "
                    >
                      {{ category.products.length }}
                    </span>

                    <span
                        class="
                        text-sm
                        text-slate-400
                        transition-transform
                        duration-200
                      "
                        :class="
                        isPartCategoryExpanded(
                          category.value
                        )
                          ? 'rotate-90'
                          : ''
                      "
                    >
                      ›
                    </span>
                  </button>


                  <button
                      type="button"
                      :disabled="
                      areAllPartCategoryProductsSelected(
                        category.products
                      )
                    "
                      class="
                      shrink-0
                      rounded-lg
                      border
                      border-slate-300
                      bg-white
                      px-2.5
                      py-1.5
                      text-xs
                      font-semibold
                      text-slate-700
                      transition
                      hover:border-slate-400
                      hover:bg-slate-50
                      disabled:cursor-default
                      disabled:border-slate-200
                      disabled:bg-slate-50
                      disabled:text-slate-400
                    "
                      @click.stop="
                      addPartCategoryProducts(
                        category.products
                      )
                    "
                  >
                    {{
                      areAllPartCategoryProductsSelected(
                          category.products
                      )
                          ? '已全加入'
                          : '全系列加入'
                    }}
                  </button>
                </div>


                <!-- Category Products -->

                <div
                    v-show="
                    isPartCategoryExpanded(
                      category.value
                    )
                  "
                    class="
                    space-y-2
                    border-t
                    border-slate-100
                    bg-slate-50/40
                    p-3
                  "
                >
                  <div
                      v-for="
                      product
                      in category.products
                    "
                      :key="
                      product.id
                    "
                      :class="[
                        'rounded-xl border p-3 transition',

                        isProductSelected(
                          product
                        )
                          ? 'border-slate-200 bg-white opacity-60'
                          : 'border-slate-200 bg-white hover:border-slate-400'
                      ]"
                  >
                    <div
                        class="
                        flex
                        items-start
                        gap-3
                      "
                    >
                      <div
                          class="
                          min-w-0
                          flex-1
                        "
                      >
                        <p
                            class="
                            text-sm
                            font-semibold
                            leading-5
                            text-slate-900
                          "
                        >
                          {{ product.name }}
                        </p>

                        <p
                            class="
                            mt-1
                            text-xs
                            text-slate-400
                          "
                        >
                          {{
                            getProductMetaLabel(
                                product
                            )
                          }}
                        </p>
                      </div>


                      <button
                          type="button"
                          :disabled="
                          isProductSelected(
                            product
                          )
                        "
                          class="
                          shrink-0
                          rounded-lg
                          border
                          border-slate-300
                          px-2.5
                          py-1.5
                          text-xs
                          font-semibold
                          text-slate-700
                          disabled:cursor-default
                          disabled:border-slate-200
                          disabled:text-slate-400
                        "
                          @click="
                          addProduct(
                            product
                          )
                        "
                      >
                        {{
                          isProductSelected(
                              product
                          )
                              ? '已加入'
                              : '加入 →'
                        }}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>


            <div
                v-else
                class="
                rounded-xl
                border
                border-dashed
                border-slate-300
                px-4
                py-12
                text-center
                text-sm
                text-slate-400
              "
            >
              {{
                searchKeyword
                    ? '找不到符合搜尋條件的零件產品。'
                    : '目前沒有啟用中的零件產品。'
              }}
            </div>
          </template>
        </div>
      </aside>


      <!-- ================================================= -->
      <!-- Right: Word Output -->
      <!-- ================================================= -->

      <main
          class="
          overflow-hidden
          rounded-2xl
          border
          border-slate-200
          bg-white
          shadow-sm
        "
      >
        <div
            class="
            border-b
            border-slate-200
            px-6
            py-5
          "
        >
          <p
              class="
              text-xs
              font-bold
              uppercase
              tracking-[0.16em]
              text-slate-400
            "
          >
            WORD OUTPUT
          </p>

          <h2
              class="
              mt-1
              text-lg
              font-bold
              text-slate-950
            "
          >
            Word 輸出內容
          </h2>

          <p
              class="
              mt-1
              text-sm
              text-slate-500
            "
          >
            使用上下按鈕調整同類產品的輸出順序。
          </p>
        </div>


        <div
            class="
            space-y-8
            p-6
          "
        >
          <!-- Gun -->

          <section>
            <div
                class="
                mb-3
                flex
                items-center
                justify-between
              "
            >
              <div>
                <h3
                    class="
                    text-base
                    font-bold
                    text-slate-950
                  "
                >
                  (一) 全槍進口
                </h3>

                <p
                    class="
                    mt-1
                    text-xs
                    text-slate-400
                  "
                >
                  {{ selectedGunProducts.length }} 項
                </p>
              </div>
            </div>


            <div
                class="
                min-h-28
                space-y-3
                rounded-xl
                border
                border-dashed
                border-slate-300
                bg-slate-50/50
                p-3
              "
            >
              <div
                  v-for="
                  (
                    product,
                    index
                  )
                  in selectedGunProducts
                "
                  :key="
                  product.id
                "
                  class="
                  flex
                  items-center
                  gap-3
                  rounded-xl
                  border
                  border-slate-200
                  bg-white
                  px-4
                  py-3
                "
              >
                <div
                    class="
                    flex
                    h-9
                    w-9
                    shrink-0
                    items-center
                    justify-center
                    rounded-lg
                    bg-slate-900
                    text-sm
                    font-bold
                    text-white
                  "
                >
                  {{ index + 1 }}
                </div>


                <div
                    class="
                    min-w-0
                    flex-1
                  "
                >
                  <p
                      class="
                      font-semibold
                      text-slate-900
                    "
                  >
                    {{ product.name }}
                  </p>

                  <p
                      class="
                      mt-1
                      text-xs
                      text-slate-400
                    "
                  >
                    全槍
                  </p>
                </div>


                <div
                    class="
                    flex
                    shrink-0
                    items-center
                    gap-1
                  "
                >
                  <button
                      type="button"
                      :disabled="
                      index === 0
                    "
                      class="
                      flex
                      h-8
                      w-8
                      items-center
                      justify-center
                      rounded-lg
                      text-sm
                      text-slate-500
                      hover:bg-slate-100
                      disabled:opacity-25
                    "
                      @click="
                      moveSelectedProduct(
                        'gun',
                        index,
                        -1
                      )
                    "
                  >
                    ↑
                  </button>

                  <button
                      type="button"
                      :disabled="
                      index ===
                      selectedGunProducts.length - 1
                    "
                      class="
                      flex
                      h-8
                      w-8
                      items-center
                      justify-center
                      rounded-lg
                      text-sm
                      text-slate-500
                      hover:bg-slate-100
                      disabled:opacity-25
                    "
                      @click="
                      moveSelectedProduct(
                        'gun',
                        index,
                        1
                      )
                    "
                  >
                    ↓
                  </button>

                  <button
                      type="button"
                      class="
                      ml-2
                      text-xs
                      font-semibold
                      text-red-600
                    "
                      @click="
                      removeProduct(
                        product
                      )
                    "
                  >
                    移除
                  </button>
                </div>
              </div>


              <div
                  v-if="
                  !selectedGunProducts.length
                "
                  class="
                  flex
                  min-h-24
                  items-center
                  justify-center
                  px-4
                  text-center
                  text-sm
                  text-slate-400
                "
              >
                從左側加入全槍產品
              </div>
            </div>
          </section>


          <!-- Parts -->

          <section>
            <div
                class="
                mb-3
                flex
                items-center
                justify-between
              "
            >
              <div>
                <h3
                    class="
                    text-base
                    font-bold
                    text-slate-950
                  "
                >
                  (二) 零件進口
                </h3>

                <p
                    class="
                    mt-1
                    text-xs
                    text-slate-400
                  "
                >
                  {{ selectedPartProducts.length }} 項
                </p>
              </div>
            </div>


            <div
                class="
                min-h-28
                space-y-3
                rounded-xl
                border
                border-dashed
                border-slate-300
                bg-slate-50/50
                p-3
              "
            >
              <div
                  v-for="
                  (
                    product,
                    index
                  )
                  in selectedPartProducts
                "
                  :key="
                  product.id
                "
                  class="
                  flex
                  items-center
                  gap-3
                  rounded-xl
                  border
                  border-slate-200
                  bg-white
                  px-4
                  py-3
                "
              >
                <div
                    class="
                    flex
                    h-9
                    w-9
                    shrink-0
                    items-center
                    justify-center
                    rounded-lg
                    bg-slate-900
                    text-sm
                    font-bold
                    text-white
                  "
                >
                  {{ index + 1 }}
                </div>


                <div
                    class="
                    min-w-0
                    flex-1
                  "
                >
                  <p
                      class="
                      font-semibold
                      text-slate-900
                    "
                  >
                    {{ product.name }}
                  </p>

                  <p
                      class="
                      mt-1
                      text-xs
                      text-slate-400
                    "
                  >
                    {{
                      getPartCategoryLabel(
                          product
                      )
                    }}
                  </p>
                </div>


                <div
                    class="
                    flex
                    shrink-0
                    items-center
                    gap-1
                  "
                >
                  <button
                      type="button"
                      :disabled="
                      index === 0
                    "
                      class="
                      flex
                      h-8
                      w-8
                      items-center
                      justify-center
                      rounded-lg
                      text-sm
                      text-slate-500
                      hover:bg-slate-100
                      disabled:opacity-25
                    "
                      @click="
                      moveSelectedProduct(
                        'part',
                        index,
                        -1
                      )
                    "
                  >
                    ↑
                  </button>

                  <button
                      type="button"
                      :disabled="
                      index ===
                      selectedPartProducts.length - 1
                    "
                      class="
                      flex
                      h-8
                      w-8
                      items-center
                      justify-center
                      rounded-lg
                      text-sm
                      text-slate-500
                      hover:bg-slate-100
                      disabled:opacity-25
                    "
                      @click="
                      moveSelectedProduct(
                        'part',
                        index,
                        1
                      )
                    "
                  >
                    ↓
                  </button>

                  <button
                      type="button"
                      class="
                      ml-2
                      text-xs
                      font-semibold
                      text-red-600
                    "
                      @click="
                      removeProduct(
                        product
                      )
                    "
                  >
                    移除
                  </button>
                </div>
              </div>


              <div
                  v-if="
                  !selectedPartProducts.length
                "
                  class="
                  flex
                  min-h-24
                  items-center
                  justify-center
                  px-4
                  text-center
                  text-sm
                  text-slate-400
                "
              >
                從左側加入零件產品
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  </div>
</template>