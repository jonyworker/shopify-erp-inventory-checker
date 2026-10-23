<script setup>
import { computed, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import {
  meetingContentToDocument,
  meetingDocumentToContent
} from '@/utils/meetings/meetingRichText'

const props = defineProps({
  modelValue: { type: String, default: '' },
  readonly: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])
const editor = useEditor({
  extensions: [StarterKit.configure({ link: { openOnClick: false } })],
  content: meetingContentToDocument(props.modelValue),
  editable: !props.readonly,
  editorProps: {
    attributes: {
      class: props.readonly
        ? 'pts-meeting-prose pts-meeting-readonly break-words outline-none'
        : 'pts-meeting-prose min-h-[300px] break-words px-4 py-4 text-sm outline-none'
    }
  },
  onUpdate: ({ editor: instance }) => {
    if (props.readonly) return
    emit('update:modelValue', meetingDocumentToContent(instance.getJSON()))
  }
})

watch(() => props.modelValue, value => {
  if (!editor.value) return
  // 僅在資料真的不同時替換，以免輸入時游標跳到開頭。
  const current = meetingDocumentToContent(editor.value.getJSON())
  if (value !== current) {
    const next = meetingContentToDocument(value)
    if (JSON.stringify(editor.value.getJSON()) !== JSON.stringify(next)) {
      editor.value.commands.setContent(next, { emitUpdate: false })
    }
  }
})
watch(() => props.readonly, value => {
  if (!editor.value) return
  editor.value.setEditable(!value)
  editor.value.setOptions({
    editorProps: {
      attributes: {
        class: value
          ? 'pts-meeting-prose pts-meeting-readonly break-words outline-none'
          : 'pts-meeting-prose min-h-[300px] break-words px-4 py-4 text-sm outline-none'
      }
    }
  })
})

const tools = computed(() => [
  { label: '粗體', title: '粗體', text: 'B', active: 'bold', run: () => editor.value?.chain().focus().toggleBold().run() },
  { label: '斜體', title: '斜體', text: 'I', active: 'italic', run: () => editor.value?.chain().focus().toggleItalic().run() },
  { label: '標題一', title: '標題一', text: 'H1', active: 'heading', level: 1, run: () => editor.value?.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: '標題二', title: '標題二', text: 'H2', active: 'heading', level: 2, run: () => editor.value?.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: '標題三', title: '標題三', text: 'H3', active: 'heading', level: 3, run: () => editor.value?.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: '項目清單', title: '項目清單', text: '• 清單', active: 'bulletList', run: () => editor.value?.chain().focus().toggleBulletList().run() },
  { label: '編號清單', title: '編號清單', text: '1. 清單', active: 'orderedList', run: () => editor.value?.chain().focus().toggleOrderedList().run() },
  { label: '引言', title: '引用段落', text: '❝', active: 'blockquote', run: () => editor.value?.chain().focus().toggleBlockquote().run() }
])
function isActive(tool) {
  if (tool.active === 'heading') return editor.value?.isActive('heading', { level: tool.level })
  return editor.value?.isActive(tool.active)
}
function editLink() {
  if (!editor.value) return
  const old = editor.value.getAttributes('link').href || ''
  const next = window.prompt('貼上網址（留空可移除連結）', old)
  if (next === null) return
  if (!next.trim()) { editor.value.chain().focus().extendMarkRange('link').unsetLink().run(); return }
  try {
    const parsed = new URL(next.trim())
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) throw new Error('unsupported')
    editor.value.chain().focus().extendMarkRange('link').setLink({ href: parsed.href }).run()
  } catch { window.alert('請輸入 http、https 或 mailto 網址。') }
}
</script>

<template>
  <div :class="readonly ? 'pts-meeting-view' : 'overflow-hidden rounded-lg border border-slate-200 focus-within:border-slate-500'">
    <div v-if="!readonly" class="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-2" role="toolbar" aria-label="文字格式工具列">
      <button v-for="tool in tools" :key="tool.label" type="button" :title="tool.title" :aria-label="tool.label"
        :aria-pressed="Boolean(isActive(tool))" :disabled="!editor" @click="tool.run"
        class="min-h-8 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-40"
        :class="isActive(tool) ? 'bg-slate-200 text-slate-950' : ''">{{ tool.text }}</button>
      <span class="mx-1 h-5 w-px bg-slate-200" aria-hidden="true"></span>
      <button type="button" title="設定或移除連結" class="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200" @click="editLink">連結</button>
      <button type="button" title="復原" :disabled="!editor?.can().undo()" class="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-35" @click="editor?.chain().focus().undo().run()">復原</button>
      <button type="button" title="重做" :disabled="!editor?.can().redo()" class="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-35" @click="editor?.chain().focus().redo().run()">重做</button>
    </div>
    <EditorContent :editor="editor" :aria-label="readonly ? '會議內容' : '會議內容編輯器'" />
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
:deep(.pts-meeting-prose blockquote) { border-left: 3px solid #cbd5e1; padding-left: 1em; color: #64748b; }
:deep(.pts-meeting-prose a) { color: #2563eb; text-decoration: underline; }
:deep(.pts-meeting-prose code) { border-radius: 3px; background: #f1f5f9; padding: .1em .3em; }
:deep(.pts-meeting-prose pre) { background: #f1f5f9; padding: .75rem; border-radius: .5rem; overflow-x: auto; }
:deep(.pts-meeting-prose p.is-editor-empty:first-child::before) { content: '在這裡記錄會議內容…'; color: #94a3b8; pointer-events: none; height: 0; float: left; }
:deep(.pts-meeting-readonly) { font-size: 15px; }
</style>
