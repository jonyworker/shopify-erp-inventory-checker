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
      materialStatus: null,
      note: ''
    },

    barrel: {
      materialStatus: null,
      note: ''
    },

    magazine_top: {
      materialStatus: null,
      note: ''
    },

    slide_internal: {
      materialStatus: null,
      note: ''
    },

    bolt: {
      materialStatus: null,
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
    imageLabel: '槍膛照',
    notApplicableNote: '無槍膛'
  },

  {
    type: 'barrel',
    label: '槍管',
    imageLabel: '槍管照',
    notApplicableNote: '無槍管'
  },

  {
    type: 'magazine_top',
    label: '彈匣頂面（或轉輪）',
    imageLabel: '彈匣頂面（或轉輪）照',
    notApplicableNote: '無彈匣或轉輪'
  },

  {
    type: 'slide_internal',
    label: '滑套內部',
    imageLabel: '滑套內部照',
    notApplicableNote: '無滑套'
  },

  {
    type: 'bolt',
    label: '槍機',
    imageLabel: '槍機照',
    notApplicableNote: '無槍機'
  }
]


const gunDocumentDefinitions = [
  {
    type: 'certification_statement',
    label: '認證標章說明文件',
    description: '上傳申請使用的認證標章說明文件'
  },

  {
    type: 'traditional_chinese_translation',
    label: '中文正體字譯本',
    description: '上傳原廠文件所對應的中文正體字譯本'
  },

  {
    type: 'energy_report',
    label: '動能輸出檢測報告',
    description: '上傳本產品的動能輸出檢測報告'
  }
]


const DOCUMENT_MIME_TYPES = [
  'application/pdf',

  'application/msword',

  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

  'image/jpeg',
  'image/png'
]


// =========================================================
// Form
// =========================================================

const form = ref({
  name: '',

  productType: null,

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


// ---------------------------------------------------------
// Modal
// ---------------------------------------------------------

const isModalOpen =
    ref(false)

const modalStep =
    ref('type')


// ---------------------------------------------------------
// Loading
// ---------------------------------------------------------

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


// ---------------------------------------------------------
// Filters
// ---------------------------------------------------------

const searchKeyword =
    ref('')

const typeFilter =
    ref('all')

const statusFilter =
    ref('all')


// ---------------------------------------------------------
// Messages
// ---------------------------------------------------------

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


const modalTitle =
    computed(() => {
      if (isEditing.value) {
        return '編輯產品'
      }

      if (modalStep.value === 'type') {
        return '新增產品'
      }

      return isPart.value
          ? '新增零件'
          : '新增全槍'
    })


const filteredProducts =
    computed(() => {
      const keyword =
          searchKeyword.value
              .trim()
              .toLowerCase()


      return products.value.filter(
          product => {
            const matchesSearch =
                !keyword ||
                String(
                    product.name ?? ''
                )
                    .toLowerCase()
                    .includes(keyword)


            const matchesType =
                typeFilter.value ===
                'all' ||
                product.product_type ===
                typeFilter.value


            const matchesStatus =
                statusFilter.value ===
                'all' ||
                (
                    statusFilter.value ===
                    'active' &&
                    product.is_active
                ) ||
                (
                    statusFilter.value ===
                    'inactive' &&
                    !product.is_active
                )


            return (
                matchesSearch &&
                matchesType &&
                matchesStatus
            )
          }
      )
    })


// =========================================================
// Asset Helpers
// =========================================================

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


function isComponentNotApplicable(
    componentType
) {
  return (
      form.value
          .gunComponents[
          componentType
          ]
          .materialStatus ===
      'not_applicable'
  )
}


function handleMaterialStatusChange(
    component
) {
  const spec =
      form.value
          .gunComponents[
          component.type
          ]


  const autoNote =
      component.notApplicableNote


  if (
      spec.materialStatus ===
      'not_applicable'
  ) {
    if (!spec.note.trim()) {
      spec.note =
          autoNote
    }

    return
  }


  if (
      spec.note.trim() ===
      autoNote
  ) {
    spec.note = ''
  }
}


function formatFileSize(
    bytes
) {
  if (
      bytes === null ||
      bytes === undefined
  ) {
    return ''
  }


  if (bytes < 1024) {
    return `${bytes} B`
  }


  if (
      bytes <
      1024 * 1024
  ) {
    return `${(
        bytes /
        1024
    ).toFixed(1)} KB`
  }


  return `${(
      bytes /
      1024 /
      1024
  ).toFixed(1)} MB`
}


function getAssetFileName(
    asset
) {
  return (
      asset.original_file_name ||
      asset.file_path
          ?.split('/')
          .pop() ||
      '未命名文件'
  )
}


// =========================================================
// Completeness
// =========================================================

const completenessItems =
    computed(() => {
      if (!form.value.productType) {
        return []
      }


      if (isPart.value) {
        return [
          {
            key:
                'part_category',

            label:
                '零件種類',

            complete:
                Boolean(
                    form.value.partCategory
                ) &&
                (
                    form.value.partCategory !==
                    'other' ||
                    Boolean(
                        form.value
                            .partCategoryOther
                            .trim()
                    )
                )
          },

          {
            key:
                'part_is_metal',

            label:
                '金屬材質',

            complete:
                form.value.partIsMetal !==
                null
          },

          {
            key:
                'main_image',

            label:
                '商品照片',

            complete:
                hasAssetType(
                    'main'
                )
          }
        ]
      }


      const componentItems =
          gunComponentDefinitions.flatMap(
              component => {
                const spec =
                    form.value
                        .gunComponents[
                        component.type
                        ]


                const notApplicable =
                    spec.materialStatus ===
                    'not_applicable'


                return [
                  {
                    key:
                        `${component.type}_material_status`,

                    label:
                        `${component.label}金屬材質`,

                    complete:
                        Boolean(
                            spec.materialStatus
                        )
                  },

                  {
                    key:
                        `${component.type}_image`,

                    label:
                    component.imageLabel,

                    complete:
                        notApplicable ||
                        hasAssetType(
                            component.type
                        )
                  }
                ]
              }
          )


      const documentItems =
          gunDocumentDefinitions.map(
              document => {
                return {
                  key:
                  document.type,

                  label:
                  document.label,

                  complete:
                      hasAssetType(
                          document.type
                      )
                }
              }
          )


      return [
        {
          key:
              'full_gun',

          label:
              '全槍照',

          complete:
              hasAssetType(
                  'full_gun'
              )
        },

        ...componentItems,

        {
          key:
              'exploded_diagram',

          label:
              '爆炸結構圖',

          complete:
              hasAssetType(
                  'exploded_diagram'
              )
        },

        ...documentItems
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
          completenessTotalCount.value ===
          0
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
          completenessTotalCount.value > 0 &&
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
        `讀取附件失敗：${error.message}`
  } finally {
    isLoadingAssets.value =
        false
  }
}


// =========================================================
// Modal
// =========================================================

function resetForm() {
  form.value = {
    name: '',

    productType: null,

    partCategory: '',
    partCategoryOther: '',
    partIsMetal: null,

    gunComponents:
        createEmptyGunComponents()
  }


  editingProductId.value =
      null

  productAssets.value = []


  errorMessage.value = ''
  successMessage.value = ''

  assetErrorMessage.value = ''
  assetSuccessMessage.value = ''
}


function openCreateModal() {
  resetForm()

  modalStep.value =
      'type'

  isModalOpen.value =
      true
}


function selectProductType(
    type
) {
  form.value.productType =
      type

  modalStep.value =
      'form'
}


function goBackToTypeSelection() {
  if (isEditing.value) {
    return
  }


  form.value.productType =
      null

  form.value.partCategory =
      ''

  form.value.partCategoryOther =
      ''

  form.value.partIsMetal =
      null

  form.value.gunComponents =
      createEmptyGunComponents()

  productAssets.value = []

  errorMessage.value = ''
  successMessage.value = ''

  modalStep.value =
      'type'
}


function closeModal() {
  isModalOpen.value =
      false

  resetForm()

  modalStep.value =
      'type'
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
    for (
        const file
        of files
        ) {
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
// Document Upload
// =========================================================

async function handleDocumentFiles(
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
    for (
        const file
        of files
        ) {
      if (
          !DOCUMENT_MIME_TYPES.includes(
              file.type
          )
      ) {
        throw new Error(
            `${file.name} 的檔案格式不支援`
        )
      }


      if (
          file.size >
          10 * 1024 * 1024
      ) {
        throw new Error(
            `${file.name} 超過 10 MB`
        )
      }


      await uploadProductAsset(
          editingProductId.value,
          assetType,
          file
      )
    }


    await loadAssets(
        editingProductId.value
    )


    assetSuccessMessage.value =
        files.length > 1
            ? `成功上傳 ${files.length} 份文件`
            : '文件上傳成功'
  } catch (error) {
    console.error(error)

    assetErrorMessage.value =
        `文件上傳失敗：${error.message}`
  } finally {
    uploadingAssetType.value =
        null
  }
}


// =========================================================
// Delete Asset
// =========================================================

async function handleDeleteAsset(
    asset
) {
  const confirmed =
      window.confirm(
          '確定要刪除這個檔案嗎？'
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
        '檔案已刪除'
  } catch (error) {
    console.error(error)

    assetErrorMessage.value =
        `刪除檔案失敗：${error.message}`
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
// Validation
// =========================================================

function validateForm() {
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
          !spec.materialStatus
      ) {
        return `請選擇「${component.label}」的材質狀態`
      }
    }
  }


  return ''
}


// =========================================================
// Edit
// =========================================================

async function openEditModal(
    product
) {
  resetForm()


  editingProductId.value =
      product.id


  form.value = {
    name:
        product.name ?? '',

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


  modalStep.value =
      'form'

  isModalOpen.value =
      true


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


      for (
          const spec
          of specs
          ) {
        const component =
            form.value
                .gunComponents[
                spec.component_type
                ]


        if (component) {
          component.materialStatus =
              spec.material_status ??
              (
                  spec.is_metal === true
                      ? 'metal'
                      : spec.is_metal === false
                          ? 'non_metal'
                          : null
              )


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
          '產品建立成功，現在可以繼續上傳照片與附件'
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

    errorMessage.value =
        `儲存產品失敗：${error.message}`
  } finally {
    isSaving.value =
        false
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

    <header
        class="
        mb-8
        flex
        flex-col
        gap-5
        lg:flex-row
        lg:items-end
        lg:justify-between
      "
    >
      <div>
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
          管理申請書所需的產品資料、照片與附件。
        </p>
      </div>


      <button
          type="button"
          class="
          inline-flex
          items-center
          justify-center
          self-start
          rounded-lg
          bg-slate-900
          px-4
          py-2.5
          text-sm
          font-semibold
          text-white
          hover:bg-slate-800
          lg:self-auto
        "
          @click="
          openCreateModal
        "
      >
        ＋ 新增產品
      </button>
    </header>


    <!-- =================================================== -->
    <!-- Filters -->
    <!-- =================================================== -->

    <section
        class="
        mb-5
        rounded-2xl
        border
        border-slate-200
        bg-white
        p-4
        shadow-sm
      "
    >
      <div
          class="
          grid
          gap-3
          lg:grid-cols-[1fr_180px_180px]
        "
      >
        <div>
          <label
              class="
              sr-only
            "
          >
            搜尋產品
          </label>

          <input
              v-model="
              searchKeyword
            "
              type="search"
              placeholder="搜尋品名..."
              class="
              w-full
              rounded-lg
              border
              border-slate-300
              px-3
              py-2.5
              text-sm
              outline-none
              focus:border-slate-500
            "
          >
        </div>


        <select
            v-model="
            typeFilter
          "
            class="
            rounded-lg
            border
            border-slate-300
            bg-white
            px-3
            py-2.5
            text-sm
          "
        >
          <option value="all">
            全部類型
          </option>

          <option value="part">
            零件
          </option>

          <option value="gun">
            全槍
          </option>
        </select>


        <select
            v-model="
            statusFilter
          "
            class="
            rounded-lg
            border
            border-slate-300
            bg-white
            px-3
            py-2.5
            text-sm
          "
        >
          <option value="all">
            全部狀態
          </option>

          <option value="active">
            啟用
          </option>

          <option value="inactive">
            已停用
          </option>
        </select>
      </div>
    </section>


    <!-- =================================================== -->
    <!-- Product List -->
    <!-- =================================================== -->

    <section
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
          flex
          flex-wrap
          items-center
          justify-between
          gap-4
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
              text-slate-900
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
            顯示
            {{ filteredProducts.length }}
            /
            {{ products.length }}
            筆產品
          </p>
        </div>


        <button
            type="button"
            class="
            text-sm
            font-semibold
            text-slate-600
            hover:text-slate-950
          "
            @click="
            loadProducts
          "
        >
          重新整理
        </button>
      </div>


      <!-- Loading -->

      <div
          v-if="
          isLoadingProducts
        "
          class="
          px-6
          py-16
          text-center
          text-sm
          text-slate-500
        "
      >
        正在讀取產品資料...
      </div>


      <!-- Error -->

      <div
          v-else-if="
          productListError
        "
          class="
          px-6
          py-8
        "
      >
        <div
            class="
            rounded-lg
            bg-red-50
            px-4
            py-3
            text-sm
            text-red-700
          "
        >
          {{ productListError }}
        </div>
      </div>


      <!-- Empty -->

      <div
          v-else-if="
          filteredProducts.length === 0
        "
          class="
          px-6
          py-16
          text-center
        "
      >
        <p
            class="
            text-sm
            font-semibold
            text-slate-700
          "
        >
          找不到符合條件的產品
        </p>

        <p
            class="
            mt-1
            text-sm
            text-slate-400
          "
        >
          可以調整搜尋條件，或建立新的產品。
        </p>
      </div>


      <!-- Table -->

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
          <tr
              class="
                text-xs
                uppercase
                tracking-wide
                text-slate-500
              "
          >
            <th
                class="
                  px-6
                  py-3
                  text-left
                  font-semibold
                "
            >
              品名
            </th>

            <th
                class="
                  px-6
                  py-3
                  text-left
                  font-semibold
                "
            >
              類型
            </th>

            <th
                class="
                  px-6
                  py-3
                  text-left
                  font-semibold
                "
            >
              狀態
            </th>

            <th
                class="
                  px-6
                  py-3
                  text-left
                  font-semibold
                "
            >
              建立日期
            </th>

            <th
                class="
                  px-6
                  py-3
                  text-right
                  font-semibold
                "
            >
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
                product
                in filteredProducts
              "
              :key="
                product.id
              "
              :class="[
                'transition hover:bg-slate-50',

                !product.is_active
                  ? 'opacity-60'
                  : ''
              ]"
          >
            <td
                class="
                  px-6
                  py-4
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
            </td>


            <td
                class="
                  px-6
                  py-4
                "
            >
                <span
                    class="
                    inline-flex
                    rounded-full
                    bg-slate-100
                    px-2.5
                    py-1
                    text-xs
                    font-semibold
                    text-slate-700
                  "
                >
                  {{
                    getProductTypeLabel(
                        product.product_type
                    )
                  }}
                </span>
            </td>


            <td
                class="
                  px-6
                  py-4
                "
            >
                <span
                    :class="[
                    'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold',

                    product.is_active
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                  ]"
                >
                  {{
                    product.is_active
                        ? '啟用'
                        : '已停用'
                  }}
                </span>
            </td>


            <td
                class="
                  whitespace-nowrap
                  px-6
                  py-4
                  text-sm
                  text-slate-500
                "
            >
              {{
                formatDate(
                    product.created_at
                )
              }}
            </td>


            <td
                class="
                  px-6
                  py-4
                "
            >
              <div
                  class="
                    flex
                    items-center
                    justify-end
                    gap-4
                  "
              >
                <button
                    type="button"
                    class="
                      text-sm
                      font-semibold
                      text-slate-800
                      hover:text-blue-700
                    "
                    @click="
                      openEditModal(
                        product
                      )
                    "
                >
                  編輯
                </button>


                <button
                    type="button"
                    :disabled="
                      isUpdatingStatus ===
                      product.id
                    "
                    :class="[
                      'text-sm font-semibold disabled:opacity-50',

                      product.is_active
                        ? 'text-red-600'
                        : 'text-emerald-600'
                    ]"
                    @click="
                      toggleProductActive(
                        product
                      )
                    "
                >
                  {{
                    isUpdatingStatus ===
                    product.id
                        ? '處理中...'
                        : product.is_active
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


    <!-- =================================================== -->
    <!-- Modal -->
    <!-- =================================================== -->

    <Teleport to="body">
      <div
          v-if="
          isModalOpen
        "
          class="
          fixed
          inset-0
          z-50
          flex
          items-center
          justify-center
          bg-slate-950/45
          p-4
          backdrop-blur-[2px]
        "
          @click.self="
          closeModal
        "
      >
        <div
            class="
            flex
            max-h-[92vh]
            w-full
            max-w-6xl
            flex-col
            overflow-hidden
            rounded-2xl
            bg-white
            shadow-2xl
          "
        >
          <!-- Modal Header -->

          <header
              class="
              flex
              shrink-0
              items-center
              justify-between
              border-b
              border-slate-200
              px-6
              py-5
            "
          >
            <div>
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

              <h2
                  class="
                  mt-1
                  text-xl
                  font-bold
                  text-slate-950
                "
              >
                {{ modalTitle }}
              </h2>

              <p
                  v-if="
                  isEditing
                "
                  class="
                  mt-1
                  text-sm
                  text-slate-500
                "
              >
                {{ form.name }}
              </p>
            </div>


            <button
                type="button"
                class="
                flex
                h-9
                w-9
                items-center
                justify-center
                rounded-lg
                text-xl
                text-slate-400
                hover:bg-slate-100
                hover:text-slate-800
              "
                @click="
                closeModal
              "
            >
              ×
            </button>
          </header>


          <!-- =============================================== -->
          <!-- Type Selection -->
          <!-- =============================================== -->

          <div
              v-if="
              modalStep === 'type'
            "
              class="
              overflow-y-auto
              p-6
              md:p-8
            "
          >
            <div
                class="
                mx-auto
                max-w-3xl
              "
            >
              <div
                  class="
                  text-center
                "
              >
                <h3
                    class="
                    text-xl
                    font-bold
                    text-slate-950
                  "
                >
                  請選擇商品類型
                </h3>

                <p
                    class="
                    mt-2
                    text-sm
                    text-slate-500
                  "
                >
                  選擇後會顯示對應的產品資料欄位。
                </p>
              </div>


              <div
                  class="
                  mt-8
                  grid
                  gap-4
                  md:grid-cols-2
                "
              >
                <!-- Part -->

                <button
                    type="button"
                    class="
                    group
                    rounded-2xl
                    border
                    border-slate-200
                    bg-white
                    p-7
                    text-left
                    transition
                    hover:border-slate-400
                    hover:bg-slate-50
                    hover:shadow-sm
                  "
                    @click="
                    selectProductType(
                      'part'
                    )
                  "
                >
                  <div
                      class="
                      flex
                      h-11
                      w-11
                      items-center
                      justify-center
                      rounded-xl
                      bg-slate-100
                      text-xl
                    "
                  >
                    ◇
                  </div>

                  <h4
                      class="
                      mt-5
                      text-lg
                      font-bold
                      text-slate-950
                    "
                  >
                    零件
                  </h4>

                  <p
                      class="
                      mt-2
                      text-sm
                      leading-6
                      text-slate-500
                    "
                  >
                    建立槍身、滑套、槍管、彈匣、槍機或其他零件資料。
                  </p>

                  <p
                      class="
                      mt-5
                      text-sm
                      font-semibold
                      text-slate-700
                      group-hover:text-slate-950
                    "
                  >
                    建立零件 →
                  </p>
                </button>


                <!-- Gun -->

                <button
                    type="button"
                    class="
                    group
                    rounded-2xl
                    border
                    border-slate-200
                    bg-white
                    p-7
                    text-left
                    transition
                    hover:border-slate-400
                    hover:bg-slate-50
                    hover:shadow-sm
                  "
                    @click="
                    selectProductType(
                      'gun'
                    )
                  "
                >
                  <div
                      class="
                      flex
                      h-11
                      w-11
                      items-center
                      justify-center
                      rounded-xl
                      bg-slate-100
                      text-xl
                    "
                  >
                    ◎
                  </div>

                  <h4
                      class="
                      mt-5
                      text-lg
                      font-bold
                      text-slate-950
                    "
                  >
                    全槍
                  </h4>

                  <p
                      class="
                      mt-2
                      text-sm
                      leading-6
                      text-slate-500
                    "
                  >
                    建立完整槍械資料、各部位照片、爆炸圖與申請附件。
                  </p>

                  <p
                      class="
                      mt-5
                      text-sm
                      font-semibold
                      text-slate-700
                      group-hover:text-slate-950
                    "
                  >
                    建立全槍 →
                  </p>
                </button>
              </div>
            </div>
          </div>


          <!-- =============================================== -->
          <!-- Product Form -->
          <!-- =============================================== -->

          <template
              v-else
          >
            <div
                class="
                flex-1
                overflow-y-auto
                px-6
                py-6
                md:px-8
              "
            >
              <!-- Back -->

              <button
                  v-if="
                  !isEditing
                "
                  type="button"
                  class="
                  mb-6
                  text-sm
                  font-semibold
                  text-slate-500
                  hover:text-slate-950
                "
                  @click="
                  goBackToTypeSelection
                "
              >
                ← 返回選擇商品類型
              </button>


              <!-- Loading Edit -->

              <div
                  v-if="
                  isLoadingEditData
                "
                  class="
                  py-16
                  text-center
                  text-sm
                  text-slate-500
                "
              >
                正在讀取產品資料...
              </div>


              <form
                  v-else
                  id="product-form"
                  class="
                  space-y-8
                "
                  @submit.prevent="
                  handleSubmit
                "
              >
                <!-- Basic -->

                <section>
                  <h3
                      class="
                      text-base
                      font-bold
                      text-slate-950
                    "
                  >
                    基本資料
                  </h3>

                  <div
                      class="
                      mt-4
                    "
                  >
                    <label
                        class="
                        block
                      "
                    >
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
                          v-model="
                          form.name
                        "
                          type="text"
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


                  <div
                      class="
                      mt-4
                      flex
                      items-center
                      gap-2
                    "
                  >
                    <span
                        class="
                        text-sm
                        text-slate-500
                      "
                    >
                      商品類型
                    </span>

                    <span
                        class="
                        rounded-full
                        bg-slate-100
                        px-2.5
                        py-1
                        text-xs
                        font-semibold
                        text-slate-700
                      "
                    >
                      {{
                        getProductTypeLabel(
                            form.productType
                        )
                      }}
                    </span>
                  </div>
                </section>


                <!-- ========================================= -->
                <!-- Part -->
                <!-- ========================================= -->

                <section
                    v-if="
                    isPart
                  "
                    class="
                    border-t
                    border-slate-200
                    pt-8
                  "
                >
                  <h3
                      class="
                      text-base
                      font-bold
                      text-slate-950
                    "
                  >
                    零件資料
                  </h3>


                  <div
                      class="
                      mt-4
                      grid
                      gap-5
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
                          text-slate-700
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


                  <div
                      class="
                      mt-5
                    "
                  >
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
                            form.partIsMetal
                          "
                            type="radio"
                            :value="
                            true
                          "
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
                            form.partIsMetal
                          "
                            type="radio"
                            :value="
                            false
                          "
                        >

                        否
                      </label>
                    </div>
                  </div>


                  <!-- Part Image -->

                  <div
                      class="
                      mt-7
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
                        <h4
                            class="
                            text-sm
                            font-bold
                            text-slate-900
                          "
                        >
                          商品照片
                        </h4>

                        <p
                            class="
                            mt-1
                            text-xs
                            text-slate-500
                          "
                        >
                          可上傳多張產品照片
                        </p>
                      </div>


                      <label
                          v-if="
                          isEditing
                        "
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
                        !isEditing
                      "
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
                      建立產品後即可上傳圖片
                    </div>


                    <div
                        v-else-if="
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
                          :key="
                          asset.id
                        "
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
                            border-slate-200
                            px-3
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
                      尚未上傳商品照片
                    </div>
                  </div>
                </section>


                <!-- ========================================= -->
                <!-- Gun -->
                <!-- ========================================= -->

                <section
                    v-if="
                    isGun
                  "
                    class="
                    border-t
                    border-slate-200
                    pt-8
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
                      全槍資料
                    </h3>

                    <p
                        class="
                        mt-1
                        text-sm
                        text-slate-500
                      "
                    >
                      每個部位的材質、備註、照片與申請附件集中於同一產品。
                    </p>
                  </div>


                  <!-- Full Gun -->

                  <section
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
                        <h4
                            class="
                            text-sm
                            font-bold
                            text-slate-900
                          "
                        >
                          全槍照
                        </h4>

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
                          v-if="
                          isEditing
                        "
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
                        !isEditing
                      "
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
                      建立產品後即可上傳全槍照
                    </div>


                    <div
                        v-else-if="
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
                          :key="
                          asset.id
                        "
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
                            items-center
                            justify-between
                            border-t
                            border-slate-200
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
                      尚未上傳全槍照
                    </div>
                  </section>


                  <!-- Components -->

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
                      <div
                          class="
                          flex
                          items-center
                          justify-between
                          gap-4
                          border-b
                          border-slate-200
                          bg-slate-50
                          px-5
                          py-4
                        "
                      >
                        <h4
                            class="
                            text-base
                            font-bold
                            text-slate-900
                          "
                        >
                          {{ component.label }}
                        </h4>


                        <span
                            v-if="
                            isComponentNotApplicable(
                              component.type
                            )
                          "
                            class="
                            rounded-full
                            bg-slate-200
                            px-2.5
                            py-1
                            text-xs
                            font-semibold
                            text-slate-600
                          "
                        >
                          無此部件
                        </span>


                        <span
                            v-else-if="
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


                      <div
                          class="
                          p-5
                        "
                      >
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
                                flex-wrap
                                gap-x-6
                                gap-y-3
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
                                      .materialStatus
                                  "
                                    type="radio"
                                    value="metal"
                                    @change="
                                    handleMaterialStatusChange(
                                      component
                                    )
                                  "
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
                                      .materialStatus
                                  "
                                    type="radio"
                                    value="non_metal"
                                    @change="
                                    handleMaterialStatusChange(
                                      component
                                    )
                                  "
                                >

                                否
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
                                      .materialStatus
                                  "
                                    type="radio"
                                    value="not_applicable"
                                    @change="
                                    handleMaterialStatusChange(
                                      component
                                    )
                                  "
                                >

                                無此部件
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


                        <!-- Component Images -->

                        <div
                            class="
                            mt-5
                            border-t
                            border-slate-200
                            pt-5
                          "
                        >
                          <div
                              v-if="
                              isComponentNotApplicable(
                                component.type
                              )
                            "
                              class="
                              rounded-lg
                              bg-slate-50
                              px-4
                              py-5
                              text-sm
                              text-slate-500
                            "
                          >
                            此產品無{{ component.label }}，不需要上傳{{ component.imageLabel }}。
                          </div>


                          <template
                              v-else
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
                                  v-if="
                                  isEditing
                                "
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
                                !isEditing
                              "
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
                              建立產品後即可上傳{{ component.imageLabel }}
                            </div>


                            <div
                                v-else-if="
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
                                  bg-white
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
                                    rel="noopener noreferrer"
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
                          </template>
                        </div>
                      </div>
                    </section>
                  </div>


                  <!-- Exploded Diagram -->

                  <section
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
                        <h4
                            class="
                            text-sm
                            font-bold
                            text-slate-900
                          "
                        >
                          爆炸結構圖
                        </h4>

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
                          v-if="
                          isEditing
                        "
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
                        !isEditing
                      "
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
                      建立產品後即可上傳爆炸結構圖
                    </div>


                    <div
                        v-else-if="
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
                          :key="
                          asset.id
                        "
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
                            items-center
                            justify-between
                            border-t
                            border-slate-200
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
                      尚未上傳爆炸結構圖
                    </div>
                  </section>


                  <!-- Application Documents -->

                  <section
                      class="
                      mt-8
                      border-t
                      border-slate-200
                      pt-8
                    "
                  >
                    <h3
                        class="
                        text-base
                        font-bold
                        text-slate-950
                      "
                    >
                      申請附件
                    </h3>

                    <p
                        class="
                        mt-1
                        text-sm
                        text-slate-500
                      "
                    >
                      上傳全槍申請時所需的相關文件。
                    </p>


                    <div
                        class="
                        mt-5
                        space-y-4
                      "
                    >
                      <section
                          v-for="
                          document
                          in gunDocumentDefinitions
                        "
                          :key="
                          document.type
                        "
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
                            <div
                                class="
                                flex
                                flex-wrap
                                items-center
                                gap-2
                              "
                            >
                              <h4
                                  class="
                                  text-sm
                                  font-bold
                                  text-slate-900
                                "
                              >
                                {{ document.label }}
                              </h4>

                              <span
                                  v-if="
                                  hasAssetType(
                                    document.type
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
                                已上傳
                              </span>
                            </div>

                            <p
                                class="
                                mt-1
                                text-xs
                                text-slate-500
                              "
                            >
                              {{ document.description }}
                            </p>

                            <p
                                class="
                                mt-1
                                text-xs
                                text-slate-400
                              "
                            >
                              支援 PDF、Word、JPG、PNG，單檔最大 10 MB。
                            </p>
                          </div>


                          <label
                              v-if="
                              isEditing
                            "
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
                              document.type
                                  ? '上傳中...'
                                  : '+ 新增文件'
                            }}

                            <input
                                type="file"
                                multiple
                                accept="
                                application/pdf,
                                application/msword,
                                application/vnd.openxmlformats-officedocument.wordprocessingml.document,
                                image/jpeg,
                                image/png
                              "
                                class="hidden"
                                @change="
                                handleDocumentFiles(
                                  document.type,
                                  $event
                                )
                              "
                            >
                          </label>
                        </div>


                        <div
                            v-if="
                            !isEditing
                          "
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
                          建立產品後即可上傳{{ document.label }}
                        </div>


                        <div
                            v-else-if="
                            getAssetsByType(
                              document.type
                            ).length
                          "
                            class="
                            mt-4
                            space-y-2
                          "
                        >
                          <div
                              v-for="
                              asset
                              in getAssetsByType(
                                document.type
                              )
                            "
                              :key="
                              asset.id
                            "
                              class="
                              flex
                              flex-wrap
                              items-center
                              justify-between
                              gap-4
                              rounded-lg
                              border
                              border-slate-200
                              bg-white
                              px-4
                              py-3
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
                                  truncate
                                  text-sm
                                  font-semibold
                                  text-slate-800
                                "
                              >
                                {{
                                  getAssetFileName(
                                      asset
                                  )
                                }}
                              </p>

                              <div
                                  class="
                                  mt-1
                                  flex
                                  flex-wrap
                                  gap-x-3
                                  text-xs
                                  text-slate-400
                                "
                              >
                                <span
                                    v-if="
                                    asset.file_size !==
                                    null
                                  "
                                >
                                  {{
                                    formatFileSize(
                                        asset.file_size
                                    )
                                  }}
                                </span>
                              </div>
                            </div>


                            <div
                                class="
                                flex
                                items-center
                                gap-4
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
                                  rel="noopener noreferrer"
                                  class="
                                  text-sm
                                  font-semibold
                                  text-blue-700
                                "
                              >
                                開啟
                              </a>

                              <button
                                  type="button"
                                  :disabled="
                                  deletingAssetId ===
                                  asset.id
                                "
                                  class="
                                  text-sm
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
                          尚未上傳{{ document.label }}
                        </div>
                      </section>
                    </div>
                  </section>
                </section>


                <!-- Messages -->

                <div
                    v-if="
                    errorMessage ||
                    successMessage ||
                    assetErrorMessage ||
                    assetSuccessMessage
                  "
                    class="
                    space-y-3
                  "
                >
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


                <!-- Completeness -->

                <section
                    v-if="
                    isEditing
                  "
                    class="
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
                        <h3
                            class="
                            text-base
                            font-bold
                            text-slate-900
                          "
                        >
                          申請資料完整度
                        </h3>

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
              </form>
            </div>


            <!-- Modal Footer -->

            <footer
                class="
                flex
                shrink-0
                items-center
                justify-between
                gap-4
                border-t
                border-slate-200
                bg-white
                px-6
                py-4
                md:px-8
              "
            >
              <p
                  class="
                  hidden
                  text-xs
                  text-slate-400
                  sm:block
                "
              >
                {{
                  isEditing
                      ? '照片與附件會立即上傳，文字資料請記得儲存修改。'
                      : '建立產品後即可繼續上傳照片與附件。'
                }}
              </p>


              <div
                  class="
                  ml-auto
                  flex
                  items-center
                  gap-3
                "
              >
                <button
                    type="button"
                    class="
                    rounded-lg
                    border
                    border-slate-300
                    px-5
                    py-2.5
                    text-sm
                    font-semibold
                    text-slate-700
                    hover:bg-slate-50
                  "
                    @click="
                    closeModal
                  "
                >
                  關閉
                </button>


                <button
                    type="submit"
                    form="product-form"
                    :disabled="
                    isSaving ||
                    isLoadingEditData
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
            </footer>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>