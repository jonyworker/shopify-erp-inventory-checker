<script setup>
import { computed, ref, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import {
  MEETING_RICH_TEXT_PREFIX,
  meetingContentToDocument,
  meetingDocumentToContent
} from '@/utils/meetings/meetingRichText'

const props = defineProps({
  modelValue: { type: String, default: '' },
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const editMode = ref('markdown')
const markdownSource = ref('')
const visualActive = computed(() => !props.readonly && editMode.value === 'visual')
let lastEmittedContent = null

function isRichContent(value) {
  return String(value ?? '').startsWith(MEETING_RICH_TEXT_PREFIX)
}

const editor = useEditor({
  extensions: [
    StarterKit.configure({ link: { openOnClick: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown.configure({ markedOptions: { gfm: true } })
  ],
  content: meetingContentToDocument(props.modelValue),
  editable: false,
  editorProps: {
    attributes: {
      class: 'pts-meeting-prose pts-meeting-readonly min-h-[300px] break-words px-4 py-4 text-sm outline-none'
    }
  },
  onUpdate: ({ editor: instance }) => {
    if (!visualActive.value) return
    emitDocument(instance.getJSON())
  }
})

function emitDocument(doc) {
  const encoded = meetingDocumentToContent(doc)
  lastEmittedContent = encoded
  emit('update:modelValue', encoded)
}

function toMarkdown(value) {
  if (!isRichContent(value)) return String(value ?? '')
  try {
    return editor.value?.markdown.serialize(meetingContentToDocument(value)) ?? ''
  } catch (error) {
    console.warn('無法將會議內容轉為 Markdown', error)
    return ''
  }
}

function toPreviewDocument(value) {
  if (isRichContent(value)) return meetingContentToDocument(value)
  const text = String(value ?? '')
  if (/(^|\n)\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/m.test(text)) {
    try { return editor.value.markdown.parse(text) } catch { /* 使用原始純文字 */ }
  }
  return meetingContentToDocument(text)
}

function setEditorDocument(doc) {
  if (!editor.value) return
  editor.value.commands.setContent(doc, { emitUpdate: false })
}

function syncExternalContent(value) {
  if (!editor.value) return
  setEditorDocument(toPreviewDocument(value))
  markdownSource.value = toMarkdown(value)
}

function updateMarkdown(value) {
  markdownSource.value = value
  if (!editor.value) return
  try {
    emitDocument(editor.value.markdown.parse(value))
  } catch (error) {
    // 仍保留使用者輸入中的 Markdown，避免在打字途中覆寫內容。
    console.warn('Markdown 解析暫時失敗', error)
  }
}

function switchMode(nextMode) {
  if (props.readonly || nextMode === editMode.value || !editor.value) return
  if (nextMode === 'visual') {
    try {
      setEditorDocument(editor.value.markdown.parse(markdownSource.value))
    } catch (error) {
      window.alert('目前 Markdown 無法解析，請先檢查內容。')
      console.warn(error)
      return
    }
  } else {
    markdownSource.value = editor.value.markdown.serialize(editor.value.getJSON())
  }
  editMode.value = nextMode
  editor.value.setEditable(nextMode === 'visual')
}

function isActive(tool) {
  if (!editor.value) return false
  if (tool.active === 'heading') return editor.value.isActive('heading', { level: tool.level })
  return editor.value.isActive(tool.active)
}

const tools = computed(() => [
  { label: '粗體', text: 'B', active: 'bold', run: () => editor.value?.chain().focus().toggleBold().run() },
  { label: '斜體', text: 'I', active: 'italic', run: () => editor.value?.chain().focus().toggleItalic().run() },
  { label: '底線', text: 'U̲', active: 'underline', run: () => editor.value?.chain().focus().toggleUnderline().run() },
  { label: '刪除線', text: 'S̶', active: 'strike', run: () => editor.value?.chain().focus().toggleStrike().run() },
  { label: '標題一', text: 'H1', active: 'heading', level: 1, run: () => editor.value?.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: '標題二', text: 'H2', active: 'heading', level: 2, run: () => editor.value?.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: '標題三', text: 'H3', active: 'heading', level: 3, run: () => editor.value?.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: '項目清單', text: '• 清單', active: 'bulletList', run: () => editor.value?.chain().focus().toggleBulletList().run() },
  { label: '編號清單', text: '1. 清單', active: 'orderedList', run: () => editor.value?.chain().focus().toggleOrderedList().run() },
  { label: '待辦清單', text: '☑ 待辦', active: 'taskList', run: () => editor.value?.chain().focus().toggleTaskList().run() },
  { label: '引言', text: '❝', active: 'blockquote', run: () => editor.value?.chain().focus().toggleBlockquote().run() },
  { label: '分隔線', text: '―', active: 'horizontalRule', run: () => editor.value?.chain().focus().setHorizontalRule().run() }
])

function editLink() {
  if (!editor.value) return
  const old = editor.value.getAttributes('link').href || ''
  const next = window.prompt('貼上網址（留空可移除連結）', old)
  if (next === null) return
  if (!next.trim()) {
    editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  try {
    const parsed = new URL(next.trim())
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) throw new Error('unsupported')
    editor.value.chain().focus().extendMarkRange('link').setLink({ href: parsed.href }).run()
  } catch {
    window.alert('請輸入 http、https 或 mailto 網址。')
  }
}

// 父層 v-model 回傳的內容不要再次同步，避免打字時游標跳動。
watch(
  [editor, () => props.modelValue],
  ([instance, value]) => {
    if (!instance) return
    if (lastEmittedContent === value) {
      lastEmittedContent = null
      return
    }
    lastEmittedContent = null
    syncExternalContent(value)
  },
  { immediate: true }
)

watch(
  [() => props.readonly, editMode],
  ([readonly, mode]) => {
    if (!editor.value) return
    editor.value.setEditable(!readonly && mode === 'visual')
    editor.value.setOptions({
      editorProps: {
        attributes: {
          class: readonly
            ? 'pts-meeting-prose pts-meeting-readonly break-words outline-none'
            : 'pts-meeting-prose min-h-[300px] break-words px-4 py-4 text-sm outline-none'
        }
      }
    })
    if (readonly) setEditorDocument(toPreviewDocument(props.modelValue))
  },
  { immediate: true }
)
</script>

<template>
  <div v-if="!readonly" class="overflow-hidden rounded-lg border border-slate-200 focus-within:border-slate-500">
    <div class="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <span class="text-xs font-medium text-slate-500">會議內容</span>
      <div class="inline-flex rounded-md border border-slate-200 bg-white p-0.5" role="group" aria-label="編輯模式">
        <button type="button" :aria-pressed="editMode === 'markdown'"
          :class="editMode === 'markdown' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'"
          class="rounded px-3 py-1.5 text-xs font-medium transition"
          @click="switchMode('markdown')">Markdown 原始碼</button>
        <button type="button" :aria-pressed="editMode === 'visual'"
          :class="editMode === 'visual' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'"
          class="rounded px-3 py-1.5 text-xs font-medium transition"
          @click="switchMode('visual')">視覺化編輯</button>
      </div>
    </div>

    <div v-if="editMode === 'visual'" class="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-2"
      role="toolbar" aria-label="文字格式工具列">
      <button v-for="tool in tools" :key="tool.label" type="button" :title="tool.label"
        :aria-label="tool.label" :aria-pressed="tool.active === 'horizontalRule' ? undefined : Boolean(isActive(tool))" :disabled="!editor"
        class="min-h-8 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-40"
        :class="tool.active !== 'horizontalRule' && isActive(tool) ? 'bg-slate-200 text-slate-950' : ''" @click="tool.run">{{ tool.text }}</button>
      <span class="mx-1 h-5 w-px bg-slate-200" aria-hidden="true"></span>
      <button type="button" title="設定或移除連結" :disabled="!editor"
        class="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
        @click="editLink">連結</button>
      <button type="button" title="復原" :disabled="!editor?.can().undo()"
        class="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-35"
        @click="editor?.chain().focus().undo().run()">復原</button>
      <button type="button" title="重做" :disabled="!editor?.can().redo()"
        class="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-35"
        @click="editor?.chain().focus().redo().run()">重做</button>
    </div>

    <textarea v-if="editMode === 'markdown'"
      :value="markdownSource" aria-label="會議內容 Markdown 編輯器" spellcheck="false"
      class="block min-h-[300px] w-full resize-y bg-white px-4 py-4 font-mono text-sm leading-7 text-slate-700 outline-none"
      placeholder="## 會議議題&#10;&#10;- 討論事項&#10;- 待辦工作"
      @input="updateMarkdown($event.target.value)"
    ></textarea>
    <EditorContent v-else :editor="editor" aria-label="會議內容視覺化編輯器" />
  </div>
  <div v-else class="pts-meeting-view">
    <EditorContent :editor="editor" aria-label="會議內容" />
  </div>
</template>

<style scoped>
:deep(.pts-meeting-prose) { color: #334155; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }
:deep(.pts-meeting-prose > * + *) { margin-top: .75em; }
:deep(.pts-meeting-prose h1) { font-size: 1.5rem; font-weight: 750; line-height: 1.45; color: #0f172a; }
:deep(.pts-meeting-prose h2) { font-size: 1.25rem; font-weight: 700; line-height: 1.5; color: #0f172a; }
:deep(.pts-meeting-prose h3) { font-size: 1.1rem; font-weight: 700; color: #0f172a; }
:deep(.pts-meeting-prose ul) { list-style: disc; padding-left: 1.6em; }
:deep(.pts-meeting-prose ol) { list-style: decimal; padding-left: 1.6em; }
:deep(.pts-meeting-prose li p) { margin: 0; }
:deep(.pts-meeting-prose ul[data-type='taskList']) { list-style: none; padding-left: 0; }
:deep(.pts-meeting-prose ul[data-type='taskList'] li) { display: flex; align-items: flex-start; gap: .55rem; margin: .35rem 0; }
:deep(.pts-meeting-prose ul[data-type='taskList'] li > label) { flex: none; margin-top: .2rem; }
:deep(.pts-meeting-prose ul[data-type='taskList'] li > label input) { width: 1rem; height: 1rem; accent-color: #334155; }
:deep(.pts-meeting-prose ul[data-type='taskList'] li > div) { flex: 1; min-width: 0; }
:deep(.pts-meeting-prose ul[data-type='taskList'] ul[data-type='taskList']) { margin-left: 1rem; }
:deep(.pts-meeting-prose hr) { border: 0; border-top: 1px solid #cbd5e1; margin: 1.25rem 0; }
:deep(.pts-meeting-readonly ul[data-type='taskList'] input) { pointer-events: none; }
:deep(.pts-meeting-prose blockquote) { border-left: 3px solid #cbd5e1; padding-left: 1em; color: #64748b; }
:deep(.pts-meeting-prose a) { color: #2563eb; text-decoration: underline; }
:deep(.pts-meeting-prose code) { border-radius: 3px; background: #f1f5f9; padding: .1em .3em; }
:deep(.pts-meeting-prose pre) { background: #f1f5f9; padding: .75rem; border-radius: .5rem; overflow-x: auto; }
:deep(.pts-meeting-prose p.is-editor-empty:first-child::before) { content: '在這裡記錄會議內容…'; color: #94a3b8; pointer-events: none; height: 0; float: left; }
:deep(.pts-meeting-readonly) { font-size: 15px; }
</style>
