/**
 * 會議紀錄富文本格式 v1。
 * 現階段沿用 meeting_records.content TEXT，毋須更動 Supabase schema。
 * 舊資料為純文字；新資料使用帶版本前綴的 Tiptap JSON。
 */
export const MEETING_RICH_TEXT_PREFIX = 'PTS_TIPTAP_JSON_V1:'

function plainTextDocument(value) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n')
  return {
    type: 'doc',
    content: lines.map(line => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {})
    }))
  }
}

export function meetingContentToDocument(value) {
  const content = String(value ?? '')
  if (content.startsWith(MEETING_RICH_TEXT_PREFIX)) {
    try {
      const doc = JSON.parse(content.slice(MEETING_RICH_TEXT_PREFIX.length))
      if (doc && doc.type === 'doc' && Array.isArray(doc.content)) return doc
    } catch { /* 舊資料或異常資料改以文字顯示，不執行任何 HTML */ }
  }
  return plainTextDocument(content)
}

export function meetingDocumentToContent(doc) {
  return `${MEETING_RICH_TEXT_PREFIX}${JSON.stringify(doc)}`
}

export function meetingContentToPlainText(value) {
  if (!String(value ?? '').startsWith(MEETING_RICH_TEXT_PREFIX)) return String(value ?? '')
  const doc = meetingContentToDocument(value)
  const parts = []
  function walk(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'text') parts.push(String(node.text ?? ''))
    if (node.type === 'hardBreak') parts.push('\n')
    if (Array.isArray(node.content)) node.content.forEach(walk)
    if (['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'].includes(node.type)) parts.push('\n')
  }
  walk(doc)
  return parts.join('').trim()
}

export function isMeetingContentEmpty(value) {
  return !meetingContentToPlainText(value).trim()
}
