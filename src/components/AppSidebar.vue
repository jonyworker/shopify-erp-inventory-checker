<script setup>
import {
  computed,
  ref,
  watch,
  onBeforeUnmount
} from 'vue'

import LoginPanel from '@/components/auth/LoginPanel.vue'
import ToolGroupIcon from '@/components/ToolGroupIcon.vue'

const props = defineProps({
  modelValue: {
    type: String,
    required: true
  },

  groups: {
    type: Array,
    required: true
  },

  mobileOpen: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'update:modelValue',
  'update:collapsed',
  'update:mobileOpen'
])

const collapsed = ref(false)

const currentTool = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})


const expandedGroups =
    ref({})


function ensureGroupStates() {
  for (
      const group
      of props.groups
      ) {
    if (
        expandedGroups.value[
            group.label
            ] === undefined
    ) {
      expandedGroups.value[
          group.label
          ] = true
    }
  }
}


function isGroupExpanded(
    group
) {
  return (
      expandedGroups.value[
          group.label
          ] !== false
  )
}


function toggleGroup(
    group
) {
  expandedGroups.value[
      group.label
      ] =
      !isGroupExpanded(
          group
      )
}


function openActiveGroup() {
  for (
      const group
      of props.groups
      ) {
    if (
        groupHasActiveTool(
            group
        )
    ) {
      expandedGroups.value[
          group.label
          ] = true
    }
  }
}


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


function groupHasActiveTool(
    group
) {
  return getGroupTools(
      group
  )
      .some(
          tool =>
              tool.value ===
              currentTool.value
      )
}

function selectTool(tool) {
  if (tool.disabled) return

  currentTool.value = tool.value

  // Mobile 選擇工具後，自動關閉 Drawer
  emit('update:mobileOpen', false)
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value
  emit('update:collapsed', collapsed.value)
}

function closeMobileDrawer() {
  emit('update:mobileOpen', false)
}

function handleEscape(event) {
  if (event.key === 'Escape') {
    closeMobileDrawer()
  }
}

watch(
    () => props.groups,
    () => {
      ensureGroupStates()
      openActiveGroup()
    },
    {
      immediate: true,
      deep: true
    }
)


watch(
    () => currentTool.value,
    () => {
      openActiveGroup()
    }
)


watch(
    () => props.mobileOpen,
    (isOpen) => {
      if (isOpen) {
        document.addEventListener('keydown', handleEscape)
        document.body.style.overflow = 'hidden'
      } else {
        document.removeEventListener('keydown', handleEscape)
        document.body.style.overflow = ''
      }
    }
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleEscape)
  document.body.style.overflow = ''
})
</script>

<template>
  <div>
    <!-- ========================================
         Desktop Sidebar
    ========================================= -->
    <aside
        class="
        fixed inset-y-0 left-0 z-40
        hidden flex-col
        border-r border-slate-200
        bg-white
        transition-[width] duration-200
        lg:flex
      "
        :class="collapsed ? 'w-[72px]' : 'w-72'"
    >
      <!-- Brand -->
      <div
          class="
          flex h-[96px]
          items-center
          border-b border-slate-200
          px-4
        "
          :class="collapsed ? 'justify-center' : 'justify-between'"
      >
        <div v-if="!collapsed">
          <p
              class="
              text-xs font-bold uppercase
              tracking-[0.22em]
              text-slate-400
            "
          >
            PTS
          </p>

          <h1
              class="
              mt-1
              text-xl font-bold
              tracking-tight
              text-slate-950
            "
          >
            Internal Tools
          </h1>
        </div>

        <span
            v-else
            class="
            text-sm font-black
            tracking-tight
            text-slate-900
          "
        >
          PTS
        </span>

        <button
            v-if="!collapsed"
            type="button"
            class="
            flex h-8 w-8
            items-center justify-center
            rounded-lg
            text-slate-400
            transition
            hover:bg-slate-100
            hover:text-slate-900
          "
            title="收合側邊欄"
            @click="toggleCollapsed"
        >
          ‹
        </button>
      </div>

      <!-- Collapsed Toggle -->
      <button
          v-if="collapsed"
          type="button"
          class="
          mx-auto mt-4
          flex h-9 w-9
          items-center justify-center
          rounded-lg
          text-slate-400
          transition
          hover:bg-slate-100
          hover:text-slate-900
        "
          title="展開側邊欄"
          @click="toggleCollapsed"
      >
        ›
      </button>

      <!-- Navigation -->
      <nav
          class="flex-1 overflow-y-auto"
          :class="collapsed ? 'px-2 py-4' : 'px-4 py-5'"
      >
        <div
            v-for="group in groups"
            :key="group.label"
            class="relative mb-6"
        >
          <!-- Expanded -->
          <template v-if="!collapsed">
            <button
                type="button"
                class="
                mb-2
                flex
                w-full
                items-center
                gap-2
                rounded-lg
                px-3
                py-1.5
                text-left
                text-slate-400
                transition
                hover:bg-slate-50
                hover:text-slate-600
              "
                @click="
                toggleGroup(
                  group
                )
              "
            >
              <ToolGroupIcon :type="group.icon" />

              <span
                  class="
                  min-w-0
                  flex-1
                  text-xs
                  font-bold
                  tracking-wide
                "
              >
                {{ group.label }}
              </span>

              <span
                  class="
                  text-sm
                  transition-transform
                  duration-200
                "
                  :class="
                  isGroupExpanded(
                    group
                  )
                    ? 'rotate-90'
                    : ''
                "
              >
                ›
              </span>
            </button>

            <div
                v-if="
                group.sections?.length
              "
                v-show="
                isGroupExpanded(
                  group
                )
              "
                class="
                space-y-5
                pl-7
              "
            >
              <section
                  v-for="
                  section
                  in group.sections
                "
                  :key="
                  section.label
                "
              >
                <p
                    class="
                    mb-1.5
                    px-3
                    py-1.5
                    text-[11px]
                    font-bold
                    tracking-wide
                    text-slate-400
                  "
                >
                  {{ section.label }}
                </p>

                <div
                    class="
                    space-y-1
                  "
                >
                  <button
                      v-for="
                      tool
                      in section.tools
                    "
                      :key="
                      tool.value
                    "
                      type="button"
                      :disabled="
                      tool.disabled
                    "
                      class="
                      flex w-full
                      items-center
                      rounded-xl
                      px-3 py-2.5
                      text-left text-sm
                      transition
                    "
                      :class="[
                      currentTool === tool.value
                        ? 'bg-slate-900 font-medium text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',

                      tool.disabled
                        ? 'cursor-not-allowed opacity-40'
                        : ''
                    ]"
                      @click="
                      selectTool(
                        tool
                      )
                    "
                  >
                    <span
                        class="
                        min-w-0
                        flex-1
                      "
                    >
                      {{ tool.label }}
                    </span>

                    <span
                        v-if="
                        currentTool ===
                        tool.value
                      "
                        class="
                        ml-3
                        h-1.5 w-1.5
                        shrink-0
                        rounded-full
                        bg-white
                      "
                    />
                  </button>
                </div>
              </section>
            </div>

            <div
                v-else
                v-show="
                isGroupExpanded(
                  group
                )
              "
                class="
                space-y-1
                pl-7
              "
            >
              <button
                  v-for="
                  tool
                  in group.tools
                "
                  :key="
                  tool.value
                "
                  type="button"
                  :disabled="
                  tool.disabled
                "
                  class="
                  flex w-full
                  items-center
                  rounded-xl
                  px-3 py-2.5
                  text-left text-sm
                  transition
                "
                  :class="[
                  currentTool === tool.value
                    ? 'bg-slate-900 font-medium text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',

                  tool.disabled
                    ? 'cursor-not-allowed opacity-40'
                    : ''
                ]"
                  @click="
                  selectTool(
                    tool
                  )
                "
              >
                <span
                    class="
                    min-w-0
                    flex-1
                  "
                >
                  {{ tool.label }}
                </span>

                <span
                    v-if="
                    currentTool ===
                    tool.value
                  "
                    class="
                    ml-3
                    h-1.5 w-1.5
                    shrink-0
                    rounded-full
                    bg-white
                  "
                />
              </button>
            </div>
          </template>

          <!-- Collapsed -->
          <template v-else>
            <div class="group relative flex justify-center">
              <button
                  type="button"
                  class="
    flex h-11 w-11
    items-center justify-center
    rounded-xl
    text-slate-500
    transition
    hover:bg-slate-100
    hover:text-slate-950
  "
                  :class="
                  groupHasActiveTool(
                    group
                  )
                    ? 'bg-slate-900 text-white hover:bg-slate-900 hover:text-white'
                    : ''
                "
                  :title="group.label"
              >
                <ToolGroupIcon :type="group.icon" />
              </button>

              <!-- Flyout -->
              <div
                  class="
                  invisible absolute
                  left-full top-0 z-50
                  ml-2 w-64
                  translate-x-1
                  rounded-xl
                  border border-slate-200
                  bg-white
                  p-2
                  opacity-0
                  shadow-xl
                  transition
                  group-hover:visible
                  group-hover:translate-x-0
                  group-hover:opacity-100
                "
              >
                <p
                    class="
                    px-3 pb-2 pt-1
                    text-xs font-bold
                    text-slate-400
                  "
                >
                  {{ group.label }}
                </p>

                <template
                    v-if="
                    group.sections?.length
                  "
                >
                  <section
                      v-for="
                      section
                      in group.sections
                    "
                      :key="
                      section.label
                    "
                      class="
                      mb-3
                      last:mb-0
                    "
                  >
                    <p
                        class="
                        px-3
                        pb-1.5
                        pt-1
                        text-[11px]
                        font-bold
                        tracking-wide
                        text-slate-400
                      "
                    >
                      {{ section.label }}
                    </p>

                    <button
                        v-for="
                        tool
                        in section.tools
                      "
                        :key="
                        tool.value
                      "
                        type="button"
                        :disabled="
                        tool.disabled
                      "
                        class="
                        flex w-full
                        items-center
                        rounded-lg
                        px-3 py-2.5
                        text-left text-sm
                        transition
                      "
                        :class="[
                        currentTool === tool.value
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',

                        tool.disabled
                          ? 'cursor-not-allowed opacity-40'
                          : ''
                      ]"
                        @click="
                        selectTool(
                          tool
                        )
                      "
                    >
                      {{ tool.label }}
                    </button>
                  </section>
                </template>

                <template v-else>
                  <button
                      v-for="
                      tool
                      in group.tools
                    "
                      :key="
                      tool.value
                    "
                      type="button"
                      :disabled="
                      tool.disabled
                    "
                      class="
                      flex w-full
                      items-center
                      rounded-lg
                      px-3 py-2.5
                      text-left text-sm
                      transition
                    "
                      :class="[
                      currentTool === tool.value
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',

                      tool.disabled
                        ? 'cursor-not-allowed opacity-40'
                        : ''
                    ]"
                      @click="
                      selectTool(
                        tool
                      )
                    "
                  >
                    {{ tool.label }}
                  </button>
                </template>
              </div>
            </div>
          </template>
        </div>
      </nav>

      <!-- Account -->
      <div
          class="
          shrink-0
          border-t
          border-slate-200
        "
          :class="collapsed ? 'p-3' : 'p-4'"
      >
        <LoginPanel :collapsed="collapsed" />
      </div>
    </aside>

    <!-- ========================================
         Mobile / Tablet Drawer
    ========================================= -->
    <Teleport to="body">
      <Transition name="drawer">
        <div
            v-if="mobileOpen"
            class="
            fixed inset-0
            z-[100]
            lg:hidden
          "
        >
          <!-- Overlay -->
          <div
              class="
              absolute inset-0
              bg-slate-950/40
              backdrop-blur-[1px]
            "
              @click="closeMobileDrawer"
          />

          <!-- Drawer -->
          <aside
              class="
              absolute inset-y-0 left-0
              flex
              w-[min(320px,85vw)]
              flex-col
              bg-white
              shadow-2xl
            "
          >
            <!-- Drawer Header -->
            <div
                class="
                flex h-20
                shrink-0
                items-center
                justify-between
                border-b
                border-slate-200
                px-5
              "
            >
              <div>
                <p
                    class="
                    text-[10px]
                    font-bold
                    uppercase
                    tracking-[0.22em]
                    text-slate-400
                  "
                >
                  PTS
                </p>

                <h2
                    class="
                    mt-0.5
                    text-lg
                    font-bold
                    tracking-tight
                    text-slate-950
                  "
                >
                  Internal Tools
                </h2>
              </div>

              <button
                  type="button"
                  class="
                  flex h-9 w-9
                  items-center justify-center
                  rounded-lg
                  text-slate-400
                  transition
                  hover:bg-slate-100
                  hover:text-slate-900
                "
                  aria-label="關閉選單"
                  @click="closeMobileDrawer"
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
                      d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <!-- Drawer Navigation -->
            <nav
                class="
                flex-1
                overflow-y-auto
                px-4 py-5
              "
            >
              <div
                  v-for="group in groups"
                  :key="group.label"
                  class="mb-6"
              >
                <button
                    type="button"
                    class="
                    mb-2
                    flex
                    w-full
                    items-center
                    gap-2
                    rounded-lg
                    px-3
                    py-1.5
                    text-left
                    text-slate-400
                    transition
                    hover:bg-slate-50
                    hover:text-slate-600
                  "
                    @click="
                    toggleGroup(
                      group
                    )
                  "
                >
                  <ToolGroupIcon :type="group.icon" />

                  <span
                      class="
                      min-w-0
                      flex-1
                      text-xs
                      font-bold
                      tracking-wide
                    "
                  >
                    {{ group.label }}
                  </span>

                  <span
                      class="
                      text-sm
                      transition-transform
                      duration-200
                    "
                      :class="
                      isGroupExpanded(
                        group
                      )
                        ? 'rotate-90'
                        : ''
                    "
                  >
                    ›
                  </span>
                </button>

                <div
                    v-if="
                    group.sections?.length
                  "
                    v-show="
                    isGroupExpanded(
                      group
                    )
                  "
                    class="
                    space-y-5
                  "
                >
                  <section
                      v-for="
                      section
                      in group.sections
                    "
                      :key="
                      section.label
                    "
                  >
                    <p
                        class="
                        mb-1.5
                        px-3
                        py-1.5
                        text-[11px]
                        font-bold
                        tracking-wide
                        text-slate-400
                      "
                    >
                      {{ section.label }}
                    </p>

                    <div
                        class="
                        space-y-1
                      "
                    >
                      <button
                          v-for="
                          tool
                          in section.tools
                        "
                          :key="
                          tool.value
                        "
                          type="button"
                          :disabled="
                          tool.disabled
                        "
                          class="
                          flex w-full
                          items-center
                          rounded-xl
                          px-3 py-2.5
                          text-left
                          text-sm
                          transition
                        "
                          :class="[
                          currentTool === tool.value
                            ? 'bg-slate-900 font-medium text-white shadow-sm'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',

                          tool.disabled
                            ? 'cursor-not-allowed opacity-40'
                            : ''
                        ]"
                          @click="
                          selectTool(
                            tool
                          )
                        "
                      >
                        <span
                            class="
                            min-w-0
                            flex-1
                          "
                        >
                          {{ tool.label }}
                        </span>

                        <span
                            v-if="
                            currentTool ===
                            tool.value
                          "
                            class="
                            ml-3
                            h-1.5 w-1.5
                            shrink-0
                            rounded-full
                            bg-white
                          "
                        />
                      </button>
                    </div>
                  </section>
                </div>

                <div
                    v-else
                    v-show="
                    isGroupExpanded(
                      group
                    )
                  "
                    class="
                    space-y-1
                  "
                >
                  <button
                      v-for="
                      tool
                      in group.tools
                    "
                      :key="
                      tool.value
                    "
                      type="button"
                      :disabled="
                      tool.disabled
                    "
                      class="
                      flex w-full
                      items-center
                      rounded-xl
                      px-3 py-2.5
                      text-left
                      text-sm
                      transition
                    "
                      :class="[
                      currentTool === tool.value
                        ? 'bg-slate-900 font-medium text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',

                      tool.disabled
                        ? 'cursor-not-allowed opacity-40'
                        : ''
                    ]"
                      @click="
                      selectTool(
                        tool
                      )
                    "
                  >
                    <span
                        class="
                        min-w-0
                        flex-1
                      "
                    >
                      {{ tool.label }}
                    </span>

                    <span
                        v-if="
                        currentTool ===
                        tool.value
                      "
                        class="
                        ml-3
                        h-1.5 w-1.5
                        shrink-0
                        rounded-full
                        bg-white
                      "
                    />
                  </button>
                </div>
              </div>
            </nav>

            <!-- Drawer Account -->
            <div
                class="
                shrink-0
                border-t
                border-slate-200
                bg-white
                p-4
              "
            >
              <LoginPanel :collapsed="false" />
            </div>
          </aside>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 200ms ease;
}

.drawer-enter-active aside,
.drawer-leave-active aside {
  transition: transform 200ms ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from aside,
.drawer-leave-to aside {
  transform: translateX(-100%);
}
</style>