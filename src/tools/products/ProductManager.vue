<script setup>
import {
  ref,
  computed,
  onMounted
} from 'vue'

import {
  getProducts,
  createProduct,
  updateProduct,
  updateProductActiveStatus,

  getProductComponentSpecs,
  saveProductComponentSpecs,
  deleteProductComponentSpecs,

  getProductAssets,
  uploadProductAsset,
  deleteProductAsset
} from '@/utils/products/productRepository'

import {
  compressProductImage,
  getImageCompressionOptions
} from '@/utils/products/productImageUtils'


// =========================================================
// Helpers
// =========================================================

function createEmptyGunComponents() {
  return {
    chamber: {
      isMetal: null,
      note: ''
    },

    barrel: {
      isMetal: null,
      note: ''
    },

    magazine_top: {
      isMetal: null,
      note: ''
    },

    slide_internal: {
      isMetal: null,
      note: ''
    },

    bolt: {
      isMetal: null,
      note: ''
    }
  }
}


// =========================================================
// Definitions
// =========================================================

const gunComponentDefinitions = [
  {
    type: 'chamber',
    label: '槍膛',
    imageLabel: '槍膛照'
  },

  {
    type: 'barrel',
    label: '槍管',
    imageLabel: '槍管照'
  },

  {
    type: 'magazine_top',
    label: '彈匣頂面（或轉輪）',
    imageLabel: '彈匣頂面（或轉輪）照'
  },

  {
    type: 'slide_internal',
    label: '滑套內部',
    imageLabel: '滑套內部照'
  },

  {
    type: 'bolt',
    label: '槍機',
    imageLabel: '槍機照'
  }
]


// =========================================================
// Form
// =========================================================

const form = ref({
  sku: '',
  name: '',
  brand: '',
  model: '',
  color: '',

  productType: 'part',

  partCategory: '',
  partCategoryOther: '',
  partIsMetal: null,

  gunComponents:
    createEmptyGunComponents()
})


// =========================================================
// State
// =========================================================

const products = ref([])

const editingProductId =
  ref(null)

const productAssets =
  ref([])


const isSaving =
  ref(false)

const isLoadingProducts =
  ref(false)

const isLoadingEditData =
  ref(false)

const isLoadingAssets =
  ref(false)

const isUpdatingStatus =
  ref(null)

const uploadingAssetType =
  ref(null)

const deletingAssetId =
  ref(null)


const errorMessage =
  ref('')

const successMessage =
  ref('')

const productListError =
  ref('')

const assetErrorMessage =
  ref('')

const assetSuccessMessage =
  ref('')


// =========================================================
// Computed
// =========================================================

const isEditing =
  computed(() => {
    return Boolean(
      editingProductId.value
    )
  })


const isPart =
  computed(() => {
    return (
      form.value.productType ===
      'part'
    )
  })


const isGun =
  computed(() => {
    return (
      form.value.productType ===
      'gun'
    )
  })


// =========================================================
// Completeness
// =========================================================

const completenessItems =
  computed(() => {
    if (isPart.value) {
      return [
        {
          key: 'part_category',
          label: '零件種類',
          complete:
            Boolean(
              form.value.partCategory
            ) &&
            (
              form.value.partCategory !== 'other' ||
              Boolean(
                form.value
                  .partCategoryOther
                  .trim()
              )
            )
        },

        {
          key: 'part_is_metal',
          label: '金屬材質',
          complete:
            form.value.partIsMetal !==
            null
        },

        {
          key: 'main_image',
          label: '商品照片',
          complete:
            hasAssetType('main')
        }
      ]
    }


    return [
      {
        key: 'full_gun',
        label: '全槍照',
        complete:
          hasAssetType('full_gun')
      },

      {
        key: 'chamber_metal',
        label: '槍膛金屬材質',
        complete:
          form.value
            .gunComponents
            .chamber
            .isMetal !== null
      },

      {
        key: 'chamber_image',
        label: '槍膛照',
        complete:
          hasAssetType('chamber')
      },

      {
        key: 'barrel_metal',
        label: '槍管金屬材質',
        complete:
          form.value
            .gunComponents
            .barrel
            .isMetal !== null
      },

      {
        key: 'barrel_image',
        label: '槍管照',
        complete:
          hasAssetType('barrel')
      },

      {
        key: 'magazine_top_metal',
        label: '彈匣頂面金屬材質',
        complete:
          form.value
            .gunComponents
            .magazine_top
            .isMetal !== null
      },

      {
        key: 'magazine_top_image',
        label: '彈匣頂面（或轉輪）照',
        complete:
          hasAssetType('magazine_top')
      },

      {
        key: 'slide_internal_metal',
        label: '滑套內部金屬材質',
        complete:
          form.value
            .gunComponents
            .slide_internal
            .isMetal !== null
      },

      {
        key: 'slide_internal_image',
        label: '滑套內部照',
        complete:
          hasAssetType('slide_internal')
      },

      {
        key: 'bolt_metal',
        label: '槍機金屬材質',
        complete:
          form.value
            .gunComponents
            .bolt
            .isMetal !== null
      },

      {
        key: 'bolt_image',
        label: '槍機照',
        complete:
          hasAssetType('bolt')
      },

      {
        key: 'exploded_diagram',
        label: '爆炸結構圖',
        complete:
          hasAssetType(
            'exploded_diagram'
          )
      }
    ]
  })


const completenessCompletedCount =
  computed(() => {
    return completenessItems.value
      .filter(
        item =>
          item.complete
      )
      .length
  })


const completenessTotalCount =
  computed(() => {
    return completenessItems.value.length
  })


const completenessPercent =
  computed(() => {
    if (
      completenessTotalCount.value === 0
    ) {
      return 0
    }

    return Math.round(
      (
        completenessCompletedCount.value /
        completenessTotalCount.value
      ) *
      100
    )
  })


const isApplicationDataComplete =
  computed(() => {
    return (
      completenessCompletedCount.value ===
      completenessTotalCount.value
    )
  })


const incompleteItems =
  computed(() => {
    return completenessItems.value
      .filter(
        item =>
          !item.complete
      )
  })


// =========================================================
// Products
// =========================================================

async function loadProducts() {
  productListError.value = ''
  isLoadingProducts.value = true

  try {
    products.value =
      await getProducts()
  } catch (error) {
    console.error(error)

    productListError.value =
      `讀取產品失敗：${error.message}`
  } finally {
    isLoadingProducts.value =
      false
  }
}


// =========================================================
// Assets
// =========================================================

async function loadAssets(
  productId
) {
  assetErrorMessage.value = ''
  isLoadingAssets.value = true

  try {
    productAssets.value =
      await getProductAssets(
        productId
      )
  } catch (error) {
    console.error(error)

    assetErrorMessage.value =
      `讀取圖片失敗：${error.message}`
  } finally {
    isLoadingAssets.value =
      false
  }
}


function getAssetsByType(
  assetType
) {
  return productAssets.value
    .filter(
      asset =>
        asset.asset_type ===
        assetType
    )
    .sort(
      (a, b) =>
        a.sort_order -
        b.sort_order
    )
}


function hasAssetType(
  assetType
) {
  return productAssets.value.some(
    asset =>
      asset.asset_type ===
      assetType
  )
}


// =========================================================
// Image Upload
// =========================================================

async function handleAssetFiles(
  assetType,
  event
) {
  const input =
    event.target

  const files =
    Array.from(
      input.files ?? []
    )


  input.value = ''


  if (
    !editingProductId.value ||
    files.length === 0
  ) {
    return
  }


  assetErrorMessage.value = ''
  assetSuccessMessage.value = ''

  uploadingAssetType.value =
    assetType


  try {
    for (const file of files) {
      const options =
        getImageCompressionOptions(
          assetType
        )


      const compressedFile =
        await compressProductImage(
          file,
          options
        )


      if (
        compressedFile.size >
        5 * 1024 * 1024
      ) {
        throw new Error(
          `${file.name} 壓縮後仍超過 5 MB`
        )
      }


      await uploadProductAsset(
        editingProductId.value,
        assetType,
        compressedFile
      )
    }


    await loadAssets(
      editingProductId.value
    )


    assetSuccessMessage.value =
      files.length > 1
        ? `成功上傳 ${files.length} 張圖片`
        : '圖片上傳成功'
  } catch (error) {
    console.error(error)

    assetErrorMessage.value =
      `圖片上傳失敗：${error.message}`
  } finally {
    uploadingAssetType.value =
      null
  }
}


// =========================================================
// Delete Image
// =========================================================

async function handleDeleteAsset(
  asset
) {
  const confirmed =
    window.confirm(
      '確定要刪除這張圖片嗎？'
    )


  if (!confirmed) {
    return
  }


  assetErrorMessage.value = ''
  assetSuccessMessage.value = ''


  try {
    deletingAssetId.value =
      asset.id


    await deleteProductAsset(
      asset
    )


    await loadAssets(
      editingProductId.value
    )


    assetSuccessMessage.value =
      '圖片已刪除'
  } catch (error) {
    console.error(error)

    assetErrorMessage.value =
      `刪除圖片失敗：${error.message}`
  } finally {
    deletingAssetId.value =
      null
  }
}


// =========================================================
// Labels
// =========================================================

function getProductTypeLabel(
  type
) {
  if (type === 'part') {
    return '零件'
  }

  if (type === 'gun') {
    return '全槍'
  }

  return type ?? '-'
}


function getPartCategoryLabel(
  category
) {
  const labels = {
    body: '槍身',
    slide: '滑套',
    barrel: '槍管',
    magazine: '彈匣',
    bolt: '槍機',
    other: '其他'
  }

  return (
    labels[category] ??
    '-'
  )
}


function formatDate(
  value
) {
  if (!value) {
    return '-'
  }

  return new Intl.DateTimeFormat(
    'zh-TW',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).format(
    new Date(value)
  )
}


// =========================================================
// Reset
// =========================================================

function resetForm() {
  form.value = {
    sku: '',
    name: '',
    brand: '',
    model: '',
    color: '',

    productType: 'part',

    partCategory: '',
    partCategoryOther: '',
    partIsMetal: null,

    gunComponents:
      createEmptyGunComponents()
  }

  productAssets.value = []

  editingProductId.value =
    null
}


// =========================================================
// Validation
// =========================================================

function validateForm() {
  if (!form.value.sku.trim()) {
    return '請輸入 SKU'
  }

  if (!form.value.name.trim()) {
    return '請輸入品名'
  }


  if (isPart.value) {
    if (
      !form.value.partCategory
    ) {
      return '請選擇零件種類'
    }


    if (
      form.value.partCategory ===
      'other' &&
      !form.value
        .partCategoryOther
        .trim()
    ) {
      return '請輸入其他零件種類'
    }


    if (
      form.value.partIsMetal ===
      null
    ) {
      return '請選擇是否為金屬材質'
    }
  }


  if (isGun.value) {
    for (
      const component
      of gunComponentDefinitions
      ) {
      const spec =
        form.value
          .gunComponents[
          component.type
          ]


      if (
        spec.isMetal === null
      ) {
        return `請選擇「${component.label}」是否為金屬材質`
      }
    }
  }


  return ''
}


// =========================================================
// Edit
// =========================================================

async function editProduct(
  product
) {
  editingProductId.value =
    product.id

  errorMessage.value = ''
  successMessage.value = ''

  assetErrorMessage.value = ''
  assetSuccessMessage.value = ''

  productAssets.value = []


  form.value = {
    sku:
      product.sku ?? '',

    name:
      product.name ?? '',

    brand:
      product.brand ?? '',

    model:
      product.model ?? '',

    color:
      product.color ?? '',

    productType:
      product.product_type ??
      'part',

    partCategory:
      product.part_category ??
      '',

    partCategoryOther:
      product
        .part_category_other ??
      '',

    partIsMetal:
    product.part_is_metal,

    gunComponents:
      createEmptyGunComponents()
  }


  try {
    isLoadingEditData.value =
      true


    if (
      product.product_type ===
      'gun'
    ) {
      const specs =
        await getProductComponentSpecs(
          product.id
        )


      for (const spec of specs) {
        const component =
          form.value
            .gunComponents[
            spec.component_type
            ]


        if (component) {
          component.isMetal =
            spec.is_metal

          component.note =
            spec.note ?? ''
        }
      }
    }


    await loadAssets(
      product.id
    )
  } catch (error) {
    console.error(error)

    errorMessage.value =
      `讀取產品資料失敗：${error.message}`
  } finally {
    isLoadingEditData.value =
      false
  }


  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  })
}


function cancelEdit() {
  resetForm()

  errorMessage.value = ''
  successMessage.value = ''

  assetErrorMessage.value = ''
  assetSuccessMessage.value = ''
}


// =========================================================
// Save
// =========================================================

async function handleSubmit() {
  errorMessage.value = ''
  successMessage.value = ''


  const validationError =
    validateForm()


  if (validationError) {
    errorMessage.value =
      validationError

    return
  }


  try {
    isSaving.value = true

    let savedProduct


    if (isEditing.value) {
      savedProduct =
        await updateProduct(
          editingProductId.value,
          form.value
        )


      if (isGun.value) {
        await saveProductComponentSpecs(
          savedProduct.id,
          form.value.gunComponents
        )
      } else {
        await deleteProductComponentSpecs(
          savedProduct.id
        )
      }


      successMessage.value =
        '產品修改成功'
    } else {
      savedProduct =
        await createProduct(
          form.value
        )


      if (isGun.value) {
        await saveProductComponentSpecs(
          savedProduct.id,
          form.value.gunComponents
        )
      }


      editingProductId.value =
        savedProduct.id


      successMessage.value =
        '產品建立成功，現在可以上傳產品圖片'
    }


    await loadProducts()


    if (
      editingProductId.value
    ) {
      await loadAssets(
        editingProductId.value
      )
    }
  } catch (error) {
    console.error(error)

    if (
      error.code === '23505'
    ) {
      errorMessage.value =
        '這個 SKU 已經存在'
    } else {
      errorMessage.value =
        `儲存產品失敗：${error.message}`
    }
  } finally {
    isSaving.value = false
  }
}


// =========================================================
// Active Status
// =========================================================

async function toggleProductActive(
  product
) {
  const nextActiveStatus =
    !product.is_active


  const actionLabel =
    nextActiveStatus
      ? '重新啟用'
      : '停用'


  const confirmed =
    window.confirm(
      nextActiveStatus
        ? `確定要重新啟用「${product.name}」嗎？`
        : `確定要停用「${product.name}」嗎？\n\n停用後產品資料仍會保留。`
    )


  if (!confirmed) {
    return
  }


  try {
    isUpdatingStatus.value =
      product.id


    await updateProductActiveStatus(
      product.id,
      nextActiveStatus
    )


    await loadProducts()
  } catch (error) {
    console.error(error)

    productListError.value =
      `${actionLabel}產品失敗：${error.message}`
  } finally {
    isUpdatingStatus.value =
      null
  }
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

    <header class="mb-8">
      <p
        class="
          text-xs
          font-bold
          uppercase
          tracking-[0.2em]
          text-slate-400
        "
      >
        PRODUCT
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
        產品管理
      </h1>

      <p
        class="
          mt-2
          text-sm
          text-slate-500
        "
      >
        建立申請書所需的產品資料與圖片。
      </p>
    </header>


    <!-- =================================================== -->
    <!-- Form -->
    <!-- =================================================== -->

    <section
      class="
        max-w-5xl
        rounded-2xl
        border
        border-slate-200
        bg-white
        p-6
        shadow-sm
      "
    >
      <form
        class="space-y-6"
        @submit.prevent="
          handleSubmit
        "
      >
        <!-- Edit Status -->

        <div
          v-if="isEditing"
          class="
            flex
            items-center
            justify-between
            rounded-lg
            bg-blue-50
            px-4
            py-3
          "
        >
          <div>
            <p
              class="
                text-sm
                font-semibold
                text-blue-800
              "
            >
              正在編輯產品
            </p>

            <p
              class="
                mt-0.5
                text-xs
                text-blue-600
              "
            >
              商品資料與申請照片可在同一頁完成。
            </p>
          </div>

          <button
            type="button"
            class="
              text-sm
              font-medium
              text-blue-700
            "
            @click="
              cancelEdit
            "
          >
            完成編輯
          </button>
        </div>


        <!-- =============================================== -->
        <!-- Basic -->
        <!-- =============================================== -->

        <div>
          <h2
            class="
              text-base
              font-bold
              text-slate-900
            "
          >
            基本資料
          </h2>

          <div
            class="
              mt-4
              grid
              gap-4
              md:grid-cols-2
            "
          >
            <label>
              <span
                class="
                  mb-1.5
                  block
                  text-sm
                  font-medium
                  text-slate-700
                "
              >
                SKU *
              </span>

              <input
                v-model="form.sku"
                class="
                  w-full
                  rounded-lg
                  border
                  border-slate-300
                  px-3
                  py-2.5
                  text-sm
                "
              >
            </label>


            <label>
              <span
                class="
                  mb-1.5
                  block
                  text-sm
                  font-medium
                  text-slate-700
                "
              >
                品名 *
              </span>

              <input
                v-model="form.name"
                class="
                  w-full
                  rounded-lg
                  border
                  border-slate-300
                  px-3
                  py-2.5
                  text-sm
                "
              >
            </label>


            <label>
              <span
                class="
                  mb-1.5
                  block
                  text-sm
                  font-medium
                  text-slate-700
                "
              >
                品牌
              </span>

              <input
                v-model="form.brand"
                class="
                  w-full
                  rounded-lg
                  border
                  border-slate-300
                  px-3
                  py-2.5
                  text-sm
                "
              >
            </label>


            <label>
              <span
                class="
                  mb-1.5
                  block
                  text-sm
                  font-medium
                  text-slate-700
                "
              >
                型號
              </span>

              <input
                v-model="form.model"
                class="
                  w-full
                  rounded-lg
                  border
                  border-slate-300
                  px-3
                  py-2.5
                  text-sm
                "
              >
            </label>


            <label>
              <span
                class="
                  mb-1.5
                  block
                  text-sm
                  font-medium
                  text-slate-700
                "
              >
                顏色
              </span>

              <input
                v-model="form.color"
                class="
                  w-full
                  rounded-lg
                  border
                  border-slate-300
                  px-3
                  py-2.5
                  text-sm
                "
              >
            </label>
          </div>
        </div>


        <!-- =============================================== -->
        <!-- Type -->
        <!-- =============================================== -->

        <div
          class="
            border-t
            border-slate-200
            pt-6
          "
        >
          <h2
            class="
              text-base
              font-bold
              text-slate-900
            "
          >
            商品類型
          </h2>

          <div
            class="
              mt-4
              flex
              gap-6
            "
          >
            <label
              class="
                flex
                items-center
                gap-2
              "
            >
              <input
                v-model="
                  form.productType
                "
                type="radio"
                value="part"
                :disabled="
                  isEditing
                "
              >

              零件
            </label>


            <label
              class="
                flex
                items-center
                gap-2
              "
            >
              <input
                v-model="
                  form.productType
                "
                type="radio"
                value="gun"
                :disabled="
                  isEditing
                "
              >

              全槍
            </label>
          </div>
        </div>


        <!-- =============================================== -->
        <!-- Part -->
        <!-- =============================================== -->

        <div
          v-if="isPart"
          class="
            border-t
            border-slate-200
            pt-6
          "
        >
          <h2
            class="
              text-base
              font-bold
              text-slate-900
            "
          >
            零件資料
          </h2>

          <div
            class="
              mt-4
              grid
              gap-4
              md:grid-cols-2
            "
          >
            <label>
              <span
                class="
                  mb-1.5
                  block
                  text-sm
                  font-medium
                "
              >
                零件種類
              </span>

              <select
                v-model="
                  form.partCategory
                "
                class="
                  w-full
                  rounded-lg
                  border
                  border-slate-300
                  bg-white
                  px-3
                  py-2.5
                  text-sm
                "
              >
                <option value="">
                  請選擇
                </option>

                <option value="body">
                  槍身
                </option>

                <option value="slide">
                  滑套
                </option>

                <option value="barrel">
                  槍管
                </option>

                <option value="magazine">
                  彈匣
                </option>

                <option value="bolt">
                  槍機
                </option>

                <option value="other">
                  其他
                </option>
              </select>
            </label>


            <label
              v-if="
                form.partCategory ===
                'other'
              "
            >
              <span
                class="
                  mb-1.5
                  block
                  text-sm
                  font-medium
                "
              >
                其他說明
              </span>

              <input
                v-model="
                  form.partCategoryOther
                "
                class="
                  w-full
                  rounded-lg
                  border
                  border-slate-300
                  px-3
                  py-2.5
                  text-sm
                "
              >
            </label>
          </div>


          <div class="mt-4">
            <span
              class="
                mb-2
                block
                text-sm
                font-medium
              "
            >
              金屬材質
            </span>

            <div class="flex gap-6">
              <label>
                <input
                  v-model="
                    form.partIsMetal
                  "
                  type="radio"
                  :value="true"
                >
                是
              </label>

              <label>
                <input
                  v-model="
                    form.partIsMetal
                  "
                  type="radio"
                  :value="false"
                >
                否
              </label>
            </div>
          </div>


          <!-- Part Image -->

          <div
            v-if="isEditing"
            class="
              mt-6
              rounded-xl
              border
              border-slate-200
              bg-slate-50
              p-4
            "
          >
            <AssetUploader
              v-if="false"
            />

            <div
              class="
                flex
                flex-wrap
                items-center
                justify-between
                gap-3
              "
            >
              <div>
                <h3
                  class="
                    text-sm
                    font-bold
                    text-slate-900
                  "
                >
                  商品照片
                </h3>

                <p
                  class="
                    mt-1
                    text-xs
                    text-slate-500
                  "
                >
                  可上傳多張
                </p>
              </div>

              <label
                class="
                  cursor-pointer
                  rounded-lg
                  border
                  border-slate-300
                  bg-white
                  px-3
                  py-2
                  text-sm
                  font-semibold
                  text-slate-700
                "
              >
                {{
                  uploadingAssetType ===
                  'main'
                    ? '上傳中...'
                    : '+ 新增圖片'
                }}

                <input
                  type="file"
                  multiple
                  accept="
                    image/jpeg,
                    image/png,
                    image/webp
                  "
                  class="hidden"
                  @change="
                    handleAssetFiles(
                      'main',
                      $event
                    )
                  "
                >
              </label>
            </div>

            <div
              v-if="
                getAssetsByType(
                  'main'
                ).length
              "
              class="
                mt-4
                grid
                grid-cols-2
                gap-3
                sm:grid-cols-4
              "
            >
              <div
                v-for="
                  asset
                  in getAssetsByType(
                    'main'
                  )
                "
                :key="asset.id"
                class="
                  overflow-hidden
                  rounded-lg
                  border
                  border-slate-200
                  bg-white
                "
              >
                <img
                  v-if="
                    asset.preview_url
                  "
                  :src="
                    asset.preview_url
                  "
                  class="
                    aspect-square
                    w-full
                    object-contain
                    p-2
                  "
                >

                <div
                  class="
                    flex
                    justify-end
                    border-t
                    px-2
                    py-2
                  "
                >
                  <button
                    type="button"
                    class="
                      text-xs
                      font-semibold
                      text-red-600
                    "
                    @click="
                      handleDeleteAsset(
                        asset
                      )
                    "
                  >
                    刪除
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>


        <!-- =============================================== -->
        <!-- Gun -->
        <!-- =============================================== -->

        <div
          v-if="isGun"
          class="
            border-t
            border-slate-200
            pt-6
          "
        >
          <div>
            <h2
              class="
                text-base
                font-bold
                text-slate-900
              "
            >
              全槍資料
            </h2>

            <p
              class="
                mt-1
                text-sm
                text-slate-500
              "
            >
              每個部位的材質、備註與照片集中在同一區塊。
            </p>
          </div>


          <!-- Full Gun -->

          <div
            v-if="isEditing"
            class="
              mt-5
              rounded-xl
              border
              border-slate-200
              bg-slate-50
              p-5
            "
          >
            <div
              class="
                flex
                flex-wrap
                items-center
                justify-between
                gap-4
              "
            >
              <div>
                <h3
                  class="
                    text-sm
                    font-bold
                    text-slate-900
                  "
                >
                  全槍照
                </h3>

                <p
                  class="
                    mt-1
                    text-xs
                    text-slate-500
                  "
                >
                  完整外觀照片，可上傳多張
                </p>
              </div>

              <label
                class="
                  cursor-pointer
                  rounded-lg
                  border
                  border-slate-300
                  bg-white
                  px-3
                  py-2
                  text-sm
                  font-semibold
                  text-slate-700
                "
              >
                {{
                  uploadingAssetType ===
                  'full_gun'
                    ? '上傳中...'
                    : '+ 新增圖片'
                }}

                <input
                  type="file"
                  multiple
                  accept="
                    image/jpeg,
                    image/png,
                    image/webp
                  "
                  class="hidden"
                  @change="
                    handleAssetFiles(
                      'full_gun',
                      $event
                    )
                  "
                >
              </label>
            </div>


            <div
              v-if="
                getAssetsByType(
                  'full_gun'
                ).length
              "
              class="
                mt-4
                grid
                grid-cols-2
                gap-3
                sm:grid-cols-4
              "
            >
              <div
                v-for="
                  asset
                  in getAssetsByType(
                    'full_gun'
                  )
                "
                :key="asset.id"
                class="
                  overflow-hidden
                  rounded-lg
                  border
                  border-slate-200
                  bg-white
                "
              >
                <img
                  v-if="
                    asset.preview_url
                  "
                  :src="
                    asset.preview_url
                  "
                  class="
                    aspect-square
                    w-full
                    object-contain
                    p-2
                  "
                >

                <div
                  class="
                    flex
                    justify-between
                    border-t
                    px-2
                    py-2
                  "
                >
                  <span
                    class="
                      text-xs
                      text-slate-400
                    "
                  >
                    #{{ asset.sort_order + 1 }}
                  </span>

                  <button
                    type="button"
                    class="
                      text-xs
                      font-semibold
                      text-red-600
                    "
                    @click="
                      handleDeleteAsset(
                        asset
                      )
                    "
                  >
                    刪除
                  </button>
                </div>
              </div>
            </div>
          </div>


          <!-- Gun Components -->

          <div
            class="
              mt-5
              space-y-5
            "
          >
            <section
              v-for="
                component
                in gunComponentDefinitions
              "
              :key="
                component.type
              "
              class="
                overflow-hidden
                rounded-xl
                border
                border-slate-200
              "
            >
              <!-- Header -->

              <div
                class="
                  border-b
                  border-slate-200
                  bg-slate-50
                  px-5
                  py-4
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
                  <h3
                    class="
                      text-base
                      font-bold
                      text-slate-900
                    "
                  >
                    {{ component.label }}
                  </h3>

                  <span
                    v-if="
                      isEditing &&
                      hasAssetType(
                        component.type
                      )
                    "
                    class="
                      rounded-full
                      bg-emerald-100
                      px-2.5
                      py-1
                      text-xs
                      font-semibold
                      text-emerald-700
                    "
                  >
                    已有照片
                  </span>
                </div>
              </div>


              <!-- Data -->

              <div class="p-5">
                <div
                  class="
                    grid
                    gap-5
                    md:grid-cols-2
                  "
                >
                  <div>
                    <span
                      class="
                        mb-2
                        block
                        text-sm
                        font-medium
                        text-slate-700
                      "
                    >
                      金屬材質
                    </span>

                    <div
                      class="
                        flex
                        gap-6
                      "
                    >
                      <label
                        class="
                          flex
                          items-center
                          gap-2
                        "
                      >
                        <input
                          v-model="
                            form
                              .gunComponents[
                                component.type
                              ]
                              .isMetal
                          "
                          type="radio"
                          :value="true"
                        >
                        是
                      </label>

                      <label
                        class="
                          flex
                          items-center
                          gap-2
                        "
                      >
                        <input
                          v-model="
                            form
                              .gunComponents[
                                component.type
                              ]
                              .isMetal
                          "
                          type="radio"
                          :value="false"
                        >
                        否
                      </label>
                    </div>
                  </div>


                  <label>
                    <span
                      class="
                        mb-1.5
                        block
                        text-sm
                        font-medium
                        text-slate-700
                      "
                    >
                      備註
                    </span>

                    <input
                      v-model="
                        form
                          .gunComponents[
                            component.type
                          ]
                          .note
                      "
                      placeholder="非必填"
                      class="
                        w-full
                        rounded-lg
                        border
                        border-slate-300
                        px-3
                        py-2.5
                        text-sm
                      "
                    >
                  </label>
                </div>


                <!-- Images -->

                <div
                  v-if="isEditing"
                  class="
                    mt-5
                    border-t
                    border-slate-200
                    pt-5
                  "
                >
                  <div
                    class="
                      flex
                      flex-wrap
                      items-center
                      justify-between
                      gap-3
                    "
                  >
                    <div>
                      <p
                        class="
                          text-sm
                          font-semibold
                          text-slate-800
                        "
                      >
                        {{ component.imageLabel }}
                      </p>

                      <p
                        class="
                          mt-1
                          text-xs
                          text-slate-500
                        "
                      >
                        可上傳多張照片
                      </p>
                    </div>

                    <label
                      class="
                        cursor-pointer
                        rounded-lg
                        border
                        border-slate-300
                        bg-white
                        px-3
                        py-2
                        text-sm
                        font-semibold
                        text-slate-700
                        hover:bg-slate-50
                      "
                    >
                      {{
                        uploadingAssetType ===
                        component.type
                          ? '上傳中...'
                          : '+ 新增圖片'
                      }}

                      <input
                        type="file"
                        multiple
                        accept="
                          image/jpeg,
                          image/png,
                          image/webp
                        "
                        class="hidden"
                        @change="
                          handleAssetFiles(
                            component.type,
                            $event
                          )
                        "
                      >
                    </label>
                  </div>


                  <div
                    v-if="
                      getAssetsByType(
                        component.type
                      ).length
                    "
                    class="
                      mt-4
                      grid
                      grid-cols-2
                      gap-3
                      sm:grid-cols-3
                      lg:grid-cols-4
                    "
                  >
                    <div
                      v-for="
                        asset
                        in getAssetsByType(
                          component.type
                        )
                      "
                      :key="
                        asset.id
                      "
                      class="
                        overflow-hidden
                        rounded-lg
                        border
                        border-slate-200
                        bg-slate-50
                      "
                    >
                      <a
                        v-if="
                          asset.preview_url
                        "
                        :href="
                          asset.preview_url
                        "
                        target="_blank"
                      >
                        <img
                          :src="
                            asset.preview_url
                          "
                          :alt="
                            component.imageLabel
                          "
                          class="
                            aspect-square
                            w-full
                            object-contain
                            p-2
                          "
                        >
                      </a>

                      <div
                        class="
                          flex
                          items-center
                          justify-between
                          border-t
                          border-slate-200
                          bg-white
                          px-3
                          py-2
                        "
                      >
                        <span
                          class="
                            text-xs
                            text-slate-400
                          "
                        >
                          #{{ asset.sort_order + 1 }}
                        </span>

                        <button
                          type="button"
                          :disabled="
                            deletingAssetId ===
                            asset.id
                          "
                          class="
                            text-xs
                            font-semibold
                            text-red-600
                            disabled:opacity-50
                          "
                          @click="
                            handleDeleteAsset(
                              asset
                            )
                          "
                        >
                          {{
                            deletingAssetId ===
                            asset.id
                              ? '刪除中...'
                              : '刪除'
                          }}
                        </button>
                      </div>
                    </div>
                  </div>


                  <div
                    v-else
                    class="
                      mt-4
                      rounded-lg
                      border
                      border-dashed
                      border-slate-300
                      px-4
                      py-5
                      text-center
                      text-sm
                      text-slate-400
                    "
                  >
                    尚未上傳{{ component.imageLabel }}
                  </div>
                </div>
              </div>
            </section>
          </div>


          <!-- Exploded Diagram -->

          <section
            v-if="isEditing"
            class="
              mt-5
              rounded-xl
              border
              border-slate-200
              bg-slate-50
              p-5
            "
          >
            <div
              class="
                flex
                flex-wrap
                items-center
                justify-between
                gap-4
              "
            >
              <div>
                <h3
                  class="
                    text-sm
                    font-bold
                    text-slate-900
                  "
                >
                  爆炸結構圖
                </h3>

                <p
                  class="
                    mt-1
                    text-xs
                    text-slate-500
                  "
                >
                  可上傳多張，系統會保留較高解析度
                </p>
              </div>

              <label
                class="
                  cursor-pointer
                  rounded-lg
                  border
                  border-slate-300
                  bg-white
                  px-3
                  py-2
                  text-sm
                  font-semibold
                  text-slate-700
                "
              >
                {{
                  uploadingAssetType ===
                  'exploded_diagram'
                    ? '上傳中...'
                    : '+ 新增圖片'
                }}

                <input
                  type="file"
                  multiple
                  accept="
                    image/jpeg,
                    image/png,
                    image/webp
                  "
                  class="hidden"
                  @change="
                    handleAssetFiles(
                      'exploded_diagram',
                      $event
                    )
                  "
                >
              </label>
            </div>


            <div
              v-if="
                getAssetsByType(
                  'exploded_diagram'
                ).length
              "
              class="
                mt-4
                grid
                grid-cols-2
                gap-3
                sm:grid-cols-4
              "
            >
              <div
                v-for="
                  asset
                  in getAssetsByType(
                    'exploded_diagram'
                  )
                "
                :key="asset.id"
                class="
                  overflow-hidden
                  rounded-lg
                  border
                  border-slate-200
                  bg-white
                "
              >
                <img
                  v-if="
                    asset.preview_url
                  "
                  :src="
                    asset.preview_url
                  "
                  class="
                    aspect-square
                    w-full
                    object-contain
                    p-2
                  "
                >

                <div
                  class="
                    flex
                    justify-between
                    border-t
                    px-3
                    py-2
                  "
                >
                  <span
                    class="
                      text-xs
                      text-slate-400
                    "
                  >
                    #{{ asset.sort_order + 1 }}
                  </span>

                  <button
                    type="button"
                    class="
                      text-xs
                      font-semibold
                      text-red-600
                    "
                    @click="
                      handleDeleteAsset(
                        asset
                      )
                    "
                  >
                    刪除
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>


        <!-- =============================================== -->
        <!-- Messages -->
        <!-- =============================================== -->

        <p
          v-if="
            errorMessage
          "
          class="
            rounded-lg
            bg-red-50
            px-4
            py-3
            text-sm
            text-red-700
          "
        >
          {{ errorMessage }}
        </p>

        <p
          v-if="
            successMessage
          "
          class="
            rounded-lg
            bg-emerald-50
            px-4
            py-3
            text-sm
            text-emerald-700
          "
        >
          {{ successMessage }}
        </p>


        <!-- =============================================== -->
        <!-- Save -->
        <!-- =============================================== -->

        <div
          class="
            flex
            justify-end
            gap-3
            border-t
            border-slate-200
            pt-6
          "
        >
          <button
            v-if="isEditing"
            type="button"
            class="
              rounded-lg
              border
              border-slate-300
              px-5
              py-2.5
              text-sm
              font-semibold
            "
            @click="
              cancelEdit
            "
          >
            完成編輯
          </button>

          <button
            type="submit"
            :disabled="
              isSaving
            "
            class="
              rounded-lg
              bg-slate-900
              px-5
              py-2.5
              text-sm
              font-semibold
              text-white
              disabled:opacity-50
            "
          >
            {{
              isSaving
                ? '儲存中...'
                : isEditing
                  ? '儲存修改'
                  : '建立產品'
            }}
          </button>
        </div>
      </form>


      <!-- =============================================== -->
      <!-- Asset Message -->
      <!-- =============================================== -->

      <div
        v-if="
          isEditing &&
          (
            assetErrorMessage ||
            assetSuccessMessage
          )
        "
        class="
          mt-6
        "
      >
        <p
          v-if="
            assetErrorMessage
          "
          class="
            rounded-lg
            bg-red-50
            px-4
            py-3
            text-sm
            text-red-700
          "
        >
          {{ assetErrorMessage }}
        </p>

        <p
          v-if="
            assetSuccessMessage
          "
          class="
            rounded-lg
            bg-emerald-50
            px-4
            py-3
            text-sm
            text-emerald-700
          "
        >
          {{ assetSuccessMessage }}
        </p>
      </div>


      <!-- =============================================== -->
      <!-- Completeness -->
      <!-- =============================================== -->

      <section
        v-if="isEditing"
        class="
          mt-8
          border-t
          border-slate-200
          pt-8
        "
      >
        <div
          class="
            rounded-xl
            border
            border-slate-200
            bg-slate-50
            p-5
          "
        >
          <div
            class="
              flex
              flex-wrap
              items-start
              justify-between
              gap-4
            "
          >
            <div>
              <h2
                class="
                  text-base
                  font-bold
                  text-slate-900
                "
              >
                申請資料完整度
              </h2>

              <p
                class="
                  mt-1
                  text-sm
                  text-slate-500
                "
              >
                {{
                  completenessCompletedCount
                }}
                /
                {{
                  completenessTotalCount
                }}
                項完成
              </p>
            </div>

            <span
              :class="[
                'rounded-full px-3 py-1 text-sm font-semibold',
                isApplicationDataComplete
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700'
              ]"
            >
              {{
                isApplicationDataComplete
                  ? '資料完整'
                  : `${completenessPercent}%`
              }}
            </span>
          </div>


          <div
            class="
              mt-4
              h-2
              overflow-hidden
              rounded-full
              bg-slate-200
            "
          >
            <div
              class="
                h-full
                rounded-full
                bg-slate-800
                transition-all
              "
              :style="{
                width:
                  `${completenessPercent}%`
              }"
            />
          </div>


          <div
            v-if="
              isApplicationDataComplete
            "
            class="
              mt-5
              rounded-lg
              bg-emerald-50
              px-4
              py-3
              text-sm
              font-medium
              text-emerald-700
            "
          >
            ✓ 申請資料已完整
          </div>


          <div
            v-else
            class="
              mt-5
            "
          >
            <p
              class="
                text-sm
                font-semibold
                text-slate-700
              "
            >
              尚缺少
            </p>

            <div
              class="
                mt-3
                grid
                gap-2
                sm:grid-cols-2
              "
            >
              <div
                v-for="
                  item
                  in incompleteItems
                "
                :key="
                  item.key
                "
                class="
                  rounded-lg
                  bg-white
                  px-3
                  py-2
                  text-sm
                  text-slate-600
                "
              >
                <span
                  class="
                    mr-2
                    text-amber-500
                  "
                >
                  !
                </span>

                {{ item.label }}
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>


    <!-- =================================================== -->
    <!-- Product List -->
    <!-- =================================================== -->

    <section
      class="
        mt-8
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
          flex
          items-center
          justify-between
          border-b
          border-slate-200
          px-6
          py-5
        "
      >
        <div>
          <h2
            class="
              text-base
              font-bold
            "
          >
            產品列表
          </h2>

          <p
            class="
              mt-1
              text-sm
              text-slate-500
            "
          >
            共
            {{ products.length }}
            筆產品
          </p>
        </div>

        <button
          type="button"
          class="
            text-sm
            font-medium
            text-slate-700
          "
          @click="
            loadProducts
          "
        >
          重新整理
        </button>
      </div>


      <div
        v-if="
          isLoadingProducts
        "
        class="
          px-6
          py-12
          text-center
        "
      >
        正在讀取產品資料...
      </div>


      <div
        v-else-if="
          productListError
        "
        class="
          px-6
          py-6
        "
      >
        {{ productListError }}
      </div>


      <div
        v-else
        class="
          overflow-x-auto
        "
      >
        <table
          class="
            min-w-full
            divide-y
            divide-slate-200
          "
        >
          <thead
            class="
              bg-slate-50
            "
          >
          <tr>
            <th class="px-6 py-3 text-left">
              SKU
            </th>

            <th class="px-6 py-3 text-left">
              品名
            </th>

            <th class="px-6 py-3 text-left">
              品牌
            </th>

            <th class="px-6 py-3 text-left">
              類型
            </th>

            <th class="px-6 py-3 text-left">
              狀態
            </th>

            <th class="px-6 py-3 text-left">
              建立日期
            </th>

            <th class="px-6 py-3 text-right">
              操作
            </th>
          </tr>
          </thead>


          <tbody
            class="
              divide-y
              divide-slate-100
            "
          >
          <tr
            v-for="
                product in products
              "
            :key="
                product.id
              "
            :class="{
                'opacity-60':
                  !product.is_active
              }"
          >
            <td class="px-6 py-4">
              {{ product.sku }}
            </td>

            <td class="px-6 py-4">
              {{ product.name }}
            </td>

            <td class="px-6 py-4">
              {{
                product.brand ||
                '-'
              }}
            </td>

            <td class="px-6 py-4">
              {{
                getProductTypeLabel(
                  product.product_type
                )
              }}
            </td>

            <td class="px-6 py-4">
              {{
                product.is_active
                  ? '啟用'
                  : '已停用'
              }}
            </td>

            <td class="px-6 py-4">
              {{
                formatDate(
                  product.created_at
                )
              }}
            </td>

            <td class="px-6 py-4">
              <div
                class="
                    flex
                    justify-end
                    gap-4
                  "
              >
                <button
                  type="button"
                  class="
                      text-sm
                      font-semibold
                    "
                  @click="
                      editProduct(
                        product
                      )
                    "
                >
                  編輯
                </button>

                <button
                  type="button"
                  :class="
                      product.is_active
                        ? 'text-red-600'
                        : 'text-emerald-600'
                    "
                  @click="
                      toggleProductActive(
                        product
                      )
                    "
                >
                  {{
                    product.is_active
                      ? '停用'
                      : '重新啟用'
                  }}
                </button>
              </div>
            </td>
          </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>