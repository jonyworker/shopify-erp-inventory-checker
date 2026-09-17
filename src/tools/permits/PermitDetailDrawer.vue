<script setup>
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue'

import {
  updatePermitApplicationNo
} from '@/utils/permits/permitRepository'

const isEditingApplicationNo = ref(false)
const applicationNoInput = ref('')
const applicationNoError = ref('')
const isSavingApplicationNo = ref(false)

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },

  permit: {
    type: Object,
    default: null
  },

  isLoading: {
    type: Boolean,
    default: false
  },

  error: {
    type: String,
    default: ''
  }
})

const emit = defineEmits([
  'close'
])

function closeDrawer() {
  emit('close')
}

function handleKeydown(event) {
  if (
      event.key === 'Escape' &&
      props.isOpen
  ) {
    closeDrawer()
  }
}

function getPermitStatus(expirationDate) {
  if (!expirationDate) {
    return {
      label: '未知',
      type: 'unknown',
      daysText: ''
    }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const expiration = new Date(expirationDate)
  expiration.setHours(0, 0, 0, 0)

  const diffTime =
      expiration.getTime() - today.getTime()

  const diffDays =
      Math.ceil(
          diffTime / (1000 * 60 * 60 * 24)
      )

  if (diffDays < 0) {
    return {
      label: '已過期',
      type: 'expired',
      daysText:
          `逾期 ${Math.abs(diffDays)} 天`
    }
  }

  if (diffDays === 0) {
    return {
      label: '即將到期',
      type: 'expiring',
      daysText: '今天到期'
    }
  }

  if (diffDays <= 45) {
    return {
      label: '即將到期',
      type: 'expiring',
      daysText: `剩 ${diffDays} 天`
    }
  }

  return {
    label: '有效',
    type: 'valid',
    daysText: `剩 ${diffDays} 天`
  }
}

function startEditApplicationNo() {
  applicationNoInput.value =
      props.permit?.application_no ?? ''

  applicationNoError.value = ''
  isEditingApplicationNo.value = true
}

function cancelEditApplicationNo() {
  applicationNoInput.value =
      props.permit?.application_no ?? ''

  applicationNoError.value = ''
  isEditingApplicationNo.value = false
}

async function saveApplicationNo() {
  applicationNoError.value = ''

  const value =
      applicationNoInput.value.trim()

  if (!/^\d{12}$/.test(value)) {
    applicationNoError.value =
        '申辦案號必須為 12 碼數字。'

    return
  }

  if (
      value ===
      props.permit?.application_no
  ) {
    isEditingApplicationNo.value = false
    return
  }

  const confirmed = window.confirm(
      `確定要將申辦案號\n${props.permit?.application_no}\n修改為\n${value}？`
  )

  if (!confirmed) {
    return
  }

  try {
    isSavingApplicationNo.value = true

    const updatedPermit =
        await updatePermitApplicationNo(
            props.permit.id,
            value
        )

    props.permit.application_no =
        updatedPermit.application_no

    isEditingApplicationNo.value = false
  } catch (error) {
    applicationNoError.value =
        error instanceof Error
            ? error.message
            : '修改申辦案號失敗'
  } finally {
    isSavingApplicationNo.value = false
  }
}

const permitStatus = computed(() => {
  return getPermitStatus(
      props.permit?.expiration_date
  )
})

watch(
    () => props.permit?.application_no,
    (value) => {
      applicationNoInput.value =
          value ?? ''
    },
    {
      immediate: true
    }
)

onMounted(() => {
  window.addEventListener(
      'keydown',
      handleKeydown
  )
})

onBeforeUnmount(() => {
  window.removeEventListener(
      'keydown',
      handleKeydown
  )
})
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div
          v-if="isOpen"
          class="fixed inset-0 z-50"
      >
        <!-- Overlay -->
        <button
            type="button"
            aria-label="關閉公文詳情"
            class="absolute inset-0 h-full w-full bg-slate-950/30"
            @click="closeDrawer"
        />

        <!-- Drawer -->
        <aside
            class="absolute right-0 top-0 flex h-full w-full max-w-[960px] flex-col bg-white shadow-2xl"
        >
          <!-- Header -->
          <div
              class="flex items-start justify-between border-b border-slate-200 px-6 py-5"
          >
            <div>
              <p
                  class="text-xs font-semibold uppercase tracking-wider text-slate-400"
              >
                Permit Detail
              </p>

              <h2
                  class="mt-1 text-xl font-bold text-slate-950"
              >
                公文詳情
              </h2>
            </div>

            <button
                type="button"
                class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                @click="closeDrawer"
            >
              關閉
            </button>
          </div>

          <!-- Content -->
          <div
              class="flex-1 overflow-y-auto p-6"
          >
            <!-- Loading -->
            <div
                v-if="isLoading"
                class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500"
            >
              公文資料讀取中...
            </div>

            <!-- Error -->
            <div
                v-else-if="error"
                class="rounded-xl bg-red-50 px-4 py-4 text-sm text-red-700"
            >
              {{ error }}
            </div>

            <template v-else-if="permit">
              <!-- Basic info -->
              <div
                  class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
              >
                <div
                    class="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <p
                      class="text-xs font-medium text-slate-500"
                  >
                    進口人
                  </p>

                  <p
                      class="mt-2 font-semibold text-slate-950"
                  >
                    {{ permit.applicant }}
                  </p>
                </div>

                <div
                    class="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div
                      class="flex items-center justify-between gap-3"
                  >
                    <p
                        class="text-xs font-medium text-slate-500"
                    >
                      申辦案號
                    </p>

                    <button
                        v-if="!isEditingApplicationNo"
                        type="button"
                        class="text-xs font-medium text-blue-600 hover:text-blue-700"
                        @click="startEditApplicationNo"
                    >
                      編輯
                    </button>
                  </div>

                  <template v-if="isEditingApplicationNo">
                    <input
                        v-model="applicationNoInput"
                        type="text"
                        inputmode="numeric"
                        maxlength="12"
                        class="
                          mt-2
                          w-full
                          rounded-lg
                          border
                          border-slate-300
                          bg-white
                          px-3
                          py-2
                          text-sm
                          font-medium
                          text-slate-950
                          outline-none
                          focus:border-blue-500
                        "
                        placeholder="請輸入 12 碼申辦案號"
                    >

                    <p
                        v-if="applicationNoError"
                        class="mt-2 text-xs text-red-600"
                    >
                      {{ applicationNoError }}
                    </p>

                    <div
                        class="mt-3 flex gap-2"
                    >
                      <button
                          type="button"
                          :disabled="isSavingApplicationNo"
                          class="
                            rounded-lg
                            bg-slate-900
                            px-3
                            py-2
                            text-xs
                            font-medium
                            text-white
                            disabled:cursor-not-allowed
                            disabled:opacity-50
                          "
                          @click="saveApplicationNo"
                      >
                        {{
                          isSavingApplicationNo
                              ? '儲存中...'
                              : '儲存'
                        }}
                      </button>

                      <button
                          type="button"
                          :disabled="isSavingApplicationNo"
                          class="
                            rounded-lg
                            border
                            border-slate-300
                            px-3
                            py-2
                            text-xs
                            font-medium
                            text-slate-600
                          "
                          @click="cancelEditApplicationNo"
                      >
                        取消
                      </button>
                    </div>
                  </template>

                  <p
                      v-else
                      class="mt-2 font-semibold text-slate-950"
                  >
                    {{ permit.application_no }}
                  </p>
                </div>

                <div
                    class="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <p
                      class="text-xs font-medium text-slate-500"
                  >
                    簽審核准文號
                  </p>

                  <p
                      class="mt-2 font-semibold text-slate-950"
                  >
                    {{ permit.certificate_no }}
                  </p>
                </div>

                <div
                    class="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <p
                      class="text-xs font-medium text-slate-500"
                  >
                    貨品類別
                  </p>

                  <p
                      class="mt-2 font-semibold text-slate-950"
                  >
                    {{ permit.goods_type }}
                  </p>
                </div>

                <div
                    class="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <p
                      class="text-xs font-medium text-slate-500"
                  >
                    核准日期
                  </p>

                  <p
                      class="mt-2 font-semibold text-slate-950"
                  >
                    {{ permit.issue_date }}
                  </p>
                </div>

                <div
                    class="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <p
                      class="text-xs font-medium text-slate-500"
                  >
                    有效日期
                  </p>

                  <p
                      class="mt-2 font-semibold text-slate-950"
                  >
                    {{ permit.expiration_date }}
                  </p>
                </div>
              </div>

              <!-- Status -->
              <div
                  class="mt-4"
              >
                <span
                    v-if="
                      permitStatus.type === 'valid'
                    "
                    class="inline-flex rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700"
                >
                  有效（{{ permitStatus.daysText }}）
                </span>

                <span
                    v-else-if="
                      permitStatus.type === 'expiring'
                    "
                    class="inline-flex rounded-full bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700"
                >
                  即將到期（{{ permitStatus.daysText }}）
                </span>

                <span
                    v-else-if="
                      permitStatus.type === 'expired'
                    "
                    class="inline-flex rounded-full bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700"
                >
                  已過期（{{ permitStatus.daysText }}）
                </span>

                <span
                    v-else
                    class="inline-flex rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600"
                >
                  未知
                </span>
              </div>

              <!-- Items -->
              <div class="mt-8">
                <div
                    class="mb-3 flex items-center justify-between"
                >
                  <h3
                      class="text-base font-semibold text-slate-950"
                  >
                    貨品明細
                  </h3>

                  <span
                      class="text-sm text-slate-500"
                  >
                    {{
                      permit.permit_items?.length ?? 0
                    }} 筆
                  </span>
                </div>

                <div
                    class="overflow-x-auto rounded-xl border border-slate-200"
                >
                  <table
                      class="w-full min-w-[1200px] border-collapse text-left text-sm"
                  >
                    <thead
                        class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                    <tr>
                      <th class="px-4 py-3">
                        證書項次
                      </th>

                      <th class="px-4 py-3">
                        C.C.C. Code
                      </th>

                      <th class="px-4 py-3">
                        稅率
                      </th>

                      <th class="px-4 py-3">
                        廠牌
                      </th>

                      <th class="px-4 py-3">
                        公文貨品名稱
                      </th>

                      <th class="px-4 py-3">
                        生產國別
                      </th>

                      <th class="px-4 py-3">
                        型號
                      </th>

                      <th class="px-4 py-3">
                        審核結果
                      </th>
                    </tr>
                    </thead>

                    <tbody
                        class="divide-y divide-slate-200 bg-white"
                    >
                    <tr
                        v-for="
                          item in permit.permit_items
                        "
                        :key="item.id"
                        class="align-top hover:bg-slate-50"
                    >
                      <td
                          class="whitespace-nowrap px-4 py-3 font-medium text-slate-900"
                      >
                        {{ item.item_no }}
                      </td>

                      <td
                          class="whitespace-nowrap px-4 py-3 font-mono text-slate-700"
                      >
                        {{ item.ccc_code }}
                      </td>

                      <td
                          class="whitespace-nowrap px-4 py-3 text-slate-700"
                      >
                        <span v-if="item.tax_rate !== null">
                          {{ item.tax_rate }}%
                        </span>

                                              <span
                                                  v-else
                                                  class="text-amber-600"
                                              >
                          尚未設定
                        </span>
                      </td>

                      <td
                          class="whitespace-nowrap px-4 py-3 text-slate-700"
                      >
                        {{ item.brand }}
                      </td>

                      <td
                          class="min-w-[320px] px-4 py-3 text-slate-700"
                      >
                        {{ item.goods_name }}
                      </td>

                      <td
                          class="whitespace-nowrap px-4 py-3 text-slate-700"
                      >
                        {{ item.country }}
                      </td>

                      <td
                          class="whitespace-nowrap px-4 py-3 font-medium text-slate-950"
                      >
                        {{ item.model }}
                      </td>

                      <td
                          class="whitespace-nowrap px-4 py-3 text-slate-700"
                      >
                        {{ item.review_result }}
                      </td>
                    </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </template>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
</style>