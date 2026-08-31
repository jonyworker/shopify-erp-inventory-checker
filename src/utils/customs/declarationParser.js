const REPORT_NO_PATTERNS = [
  /報單號碼\s*\(?3\)?\s*[:：]?\s*([A-Z]{1,3}\s*[A-Z0-9]{8,18})/i,
  /報單號碼\s*[:：]?\s*([A-Z]{1,3}\s*[A-Z0-9]{8,18})/i,
  /\*\s*([A-Z]{2})\s*(\d{2}[A-Z]\d{7})\s*\*/i,
]

const HS_CODE_PATTERN = /\b(\d{4}\s*\.\s*\d{2}\s*\.\s*\d{2}\s*\.\s*\d{2}\s*-\s*\d)\b/
const PERMIT_PATTERN = /((?:內\s*授\s*警\s*字|警\s*署\s*保\s*字)\s*第\s*\d+\s*號)/
const NET_WEIGHT_PATTERN = /(\d+(?:\.\d+)?)\s*KGM\b/i
const PIECE_QTY_PATTERN = /(?:^|\s)(\d+(?:\.\d+)?)\s*(EAC|EA|PCE|PCS)\b/i
const ITEM_NO_PATTERN = /^[A-Z][A-Z0-9._\/-]{2,24}$/i
const CUSTOMS_REF_PATTERN = /^CI\d{8,}$/i

function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/[｜|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeReportNo(value) {
  return cleanText(value)
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

function extractSlashReportNo(source) {
  // 預審進口報單頁首常見：CW/ /15/C09/08104
  // 正規化為 CW 15C0908104。
  const match = String(source ?? '').toUpperCase().match(
    /\b([A-Z]{2})\s*\/\s*\/?\s*(\d{2})\s*\/\s*([A-Z]\d{2})\s*\/\s*(\d{5})\b/,
  )
  if (!match) return ''
  return `${match[1]} ${match[2]}${match[3]}${match[4]}`
}

function extractOcrReportNo(source) {
  const normalized = String(source ?? '')
    .toUpperCase()
    .replace(/[｜|]/g, ' ')

  const anchorIndex = normalized.search(/報\s*單\s*號\s*碼/)
  if (anchorIndex < 0) return ''
  const nearby = normalized.slice(anchorIndex, anchorIndex + 180)
  const compact = nearby.replace(/[^A-Z0-9]/g, '')
  const match = compact.match(/(?:報單號碼)?([A-Z]{2})(\d{2}[A-Z]\d{7})/)
  if (!match) return ''
  return `${match[1]} ${match[2]}`
}

export function extractReportNo(text, fallback = '') {
  const source = String(text ?? '')
  for (const pattern of REPORT_NO_PATTERNS) {
    const match = source.match(pattern)
    if (!match) continue
    if (match[2]) return normalizeReportNo(`${match[1]} ${match[2]}`)
    if (match[1]) return normalizeReportNo(match[1])
  }

  const slashReportNo = extractSlashReportNo(source)
  if (slashReportNo) return normalizeReportNo(slashReportNo)

  const ocrReportNo = extractOcrReportNo(source)
  if (ocrReportNo) return normalizeReportNo(ocrReportNo)

  return normalizeReportNo(fallback)
}

function splitLines(text) {
  return String(text ?? '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(cleanText)
    .filter(Boolean)
}

function looksLikeNoise(line) {
  return [
    /^進口報單$/,
    /^出口報單$/,
    /^UNITED STATES-US$/i,
    /^CHINA-CN$/i,
    /^CAMBODIA-KH$/i,
    /^US$/i,
    /^CN$/i,
    /^NO BRAND$/i,
    /^TOTAL:?$/i,
    /^CFR\s+USD$/i,
  ].some(pattern => pattern.test(line))
}

function isLikelyItemNo(value) {
  const normalized = String(value ?? '').toUpperCase()
  if (!ITEM_NO_PATTERN.test(normalized)) return false
  if (!/[A-Z]/.test(normalized) || !/\d/.test(normalized)) return false
  if (/^(USD|TWD|CFR|FOB|CIF|KGM|EAC|PCE|PCS)$/i.test(normalized)) return false
  if (CUSTOMS_REF_PATTERN.test(normalized)) return false
  return true
}

function findItemNo(lines, start, end) {
  // 進口報單文字層通常會有「MAG001 60EAC 0%」這種 SKU + 數量列。
  // 先利用數量單位鎖定該列，可避免把 CI999999... 誤認為 Item No.。
  for (let i = start; i < end; i += 1) {
    const line = cleanText(lines[i])
    if (!PIECE_QTY_PATTERN.test(` ${line}`)) continue
    const firstToken = line.split(/\s+/)[0]?.replace(/^[^A-Z0-9]+|[^A-Z0-9._\/-]+$/gi, '')
    if (isLikelyItemNo(firstToken)) return { value: firstToken.toUpperCase(), index: i }
  }

  for (let i = start; i < end; i += 1) {
    const line = cleanText(lines[i])
    if (!line || looksLikeNoise(line)) continue
    if (HS_CODE_PATTERN.test(line)) continue
    if (/^\d+(?:\.\d+)?\s*KGM/i.test(line)) continue

    const tokens = line.split(/\s+/)
    for (const token of tokens) {
      const normalized = token.replace(/^[^A-Z0-9]+|[^A-Z0-9._\/-]+$/gi, '')
      if (isLikelyItemNo(normalized)) {
        return { value: normalized.toUpperCase(), index: i }
      }
    }
  }

  return { value: '', index: start }
}

function findHsCode(lines, start, end) {
  for (let i = start; i < end; i += 1) {
    const match = lines[i].match(HS_CODE_PATTERN)
    if (match) return { value: match[1].replace(/\s+/g, ''), index: i }
  }
  return { value: '', index: end }
}

function findPermit(lines, start, end) {
  for (let i = start; i < end; i += 1) {
    const match = lines[i].match(PERMIT_PATTERN)
    if (match) return match[1].replace(/\s+/g, '')
  }
  return ''
}

function findTotalNetWeight(lines, start, end) {
  // 進口報單的總淨重通常就在項次起始列，例如：
  // 3 UNITED STATES-US CFR USD 0.56KGM 2,205 31
  for (let i = start; i < Math.min(end, start + 3); i += 1) {
    if (/TOTAL/i.test(lines[i])) continue
    const kgmMatch = lines[i].match(NET_WEIGHT_PATTERN)
    if (kgmMatch) return kgmMatch[1]
  }

  // 出口報單文字層可能把 KGM 標題與數值拆開，保留舊版小數 fallback。
  for (let i = start; i < Math.min(end, start + 4); i += 1) {
    const decimals = [...lines[i].matchAll(/\b(\d+\.\d+)\b/g)]
      .map(match => match[1])
      .filter(value => Number(value) > 0 && Number(value) < 10000)
    if (decimals.length) return decimals[0]
  }

  for (let i = start; i < end; i += 1) {
    if (/TOTAL/i.test(lines[i])) continue
    const match = lines[i].match(NET_WEIGHT_PATTERN)
    if (match) return match[1]
  }

  return ''
}

function findPieceQuantity(lines, start, end) {
  for (let i = start; i < end; i += 1) {
    if (/TOTAL/i.test(lines[i])) continue
    const match = (` ${lines[i]}`).match(PIECE_QTY_PATTERN)
    if (!match) continue

    const quantity = Number(match[1])
    if (Number.isFinite(quantity) && quantity > 0) return quantity
  }

  return null
}

function findNetWeightPerPiece(lines, start, end) {
  const totalNetWeight = Number(findTotalNetWeight(lines, start, end))
  const quantity = findPieceQuantity(lines, start, end)

  if (!Number.isFinite(totalNetWeight) || totalNetWeight <= 0) return ''
  if (!Number.isFinite(quantity) || quantity <= 0) return ''

  return (Math.round((totalNetWeight / quantity + Number.EPSILON) * 100) / 100).toFixed(2)
}

function cleanDescriptionLine(line, itemNo) {
  let value = cleanText(line)
  if (!value) return ''
  if (PERMIT_PATTERN.test(value)) return ''
  if (/警.*字第\s*\d+\s*號/.test(value)) return ''
  if (looksLikeNoise(value)) return ''

  if (itemNo) {
    const escaped = itemNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    value = value.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'i'), ' ')
  }

  // 若 HS CODE 與商品名稱同列，只保留 HS CODE 左側的商品文字。
  const hsMatch = value.match(HS_CODE_PATTERN)
  if (hsMatch?.index != null) {
    value = value.slice(0, hsMatch.index)
  }

  value = value
    .replace(/\bCI\d{8,}\b/gi, ' ')
    .replace(/\b(?:CFR|FOB|CIF|USD|TWD)\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*KGM\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:EAC|EA|PCE|PCS|SET|BOX|CTN)\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*%/g, ' ')
    .replace(/\b\d{1,3}(?:,\d{3})+\b/g, ' ')
    .replace(/^\d{1,4}\s+/, ' ')
    .replace(/\b(?:UNITED STATES-US|CHINA-CN|CAMBODIA-KH)\b/gi, ' ')
    .replace(/\b(?:US|CN|KH)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!value) return ''
  if (/^\d+(?:\.\d+)?$/.test(value)) return ''
  if (/^O\.APP:/i.test(value)) return ''
  if (CUSTOMS_REF_PATTERN.test(value)) return ''
  if (/^(?:31|50|81)$/.test(value)) return ''

  return value
}

function buildDescription(lines, itemIndex, hsIndex, end, itemNo) {
  const descriptionLines = []
  const isExportStyle = lines.slice(itemIndex, end).some(line => /^O\.APP:/i.test(cleanText(line)))

  if (isExportStyle) {
    const upper = Math.min(hsIndex + 1, end)
    for (let i = itemIndex; i < upper; i += 1) {
      let rawLine = cleanText(lines[i])
      if (!rawLine || /^O\.APP:/i.test(rawLine)) continue

      if (itemNo) {
        const escaped = itemNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        rawLine = rawLine.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'i'), ' ')
      }

      rawLine = rawLine
        .replace(/\bNO BRAND\b/gi, ' ')
        .replace(/\b(?:USD|TWD|CFR|FOB|CIF)\b/gi, ' ')
        .replace(/\b\d+(?:\.\d+)?\s*(?:EAC|EA|PCE|PCS|SET|BOX|CTN)\b/gi, ' ')
        .replace(/\(\s*0\s*\)/g, ' ')
        .replace(/\b\d{1,3}(?:,\d{3})+\b/g, ' ')
        .replace(HS_CODE_PATTERN, ' ')
        .replace(/^(sample)\s+\d+(?:\.\d+)?$/i, '$1')
        .replace(/\s+/g, ' ')
        .trim()

      if (!rawLine || /^\d+(?:\.\d+)?$/.test(rawLine)) continue
      descriptionLines.push(rawLine)
    }

    return descriptionLines.join(' ').replace(/\s+/g, ' ').trim()
  }

  for (let i = itemIndex; i < end; i += 1) {
    const rawLine = cleanText(lines[i])

    // 報單項次結束後的分隔線，例如：
    // --------------------
    // -------------------- --------------------
    if (/^(?:-+\s*)+$/.test(rawLine)) break

    // 報單頁尾資訊，不屬於商品 Description。
    if (
        /^(?:TOTAL\s*:|N\/M$|長期委任書號|委任到期日期|資料代碼:|\(\*+續列其它申報資料\*+\))/i.test(rawLine)
    ) {
      break
    }

    if (/營業稅|USER:|推廣貿易服務費/.test(rawLine)) break
    if (/^\d+\s+SKD\b/i.test(rawLine)) break

    const cleaned = cleanDescriptionLine(rawLine, itemNo)
    if (!cleaned) continue
    if (/^NO BRAND$/i.test(cleaned)) continue

    descriptionLines.push(cleaned)
  }

  return descriptionLines.join(' ').replace(/\s+/g, ' ').trim()
}

function itemBoundaries(lines) {
  const indexes = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = cleanText(lines[i])

    // 最可靠的進口報單列：項次 + 國別/US/CN + CFR... + KGM。
    const importRow = line.match(/^(\d{1,4})\s+.*\b(?:CFR|FOB|CIF)\b.*KGM\b/i)
    if (importRow) {
      indexes.push({ item: importRow[1], index: i })
      continue
    }

    // 出口報單可能把項次獨立成一列。
    const direct = line.match(/^(\d{1,4})\s*$/)
    if (direct) {
      indexes.push({ item: direct[1], index: i })
      continue
    }

    // 文字型出口報單同一 Y 軸可能變成「1 NO BRAND 2.84 81」。
    const rowStart = line.match(/^(\d{1,4})(?:\s+|$)/)
    if (rowStart && (/\bNO BRAND\b/i.test(line) || /\bKGM\b/i.test(line))) {
      indexes.push({ item: rowStart[1], index: i })
    }
  }

  // 只去除同一頁同一位置的重複候選，不以「項次號碼」全頁去重。
  // 避免特殊報單中相同項次號碼出現在不同報單區塊時被吃掉。
  return indexes.filter((entry, index, source) => (
    source.findIndex(other => other.index === entry.index && other.item === entry.item) === index
  ))
}

export function parseDeclarationPage({ text, pageNumber, reportNo: inheritedReportNo = '' }) {
  const lines = splitLines(text)
  const reportNo = extractReportNo(text, inheritedReportNo)
  const boundaries = itemBoundaries(lines)
  const rows = []

  boundaries.forEach((boundary, index) => {
    const start = boundary.index
    const end = boundaries[index + 1]?.index ?? lines.length
    if (end - start < 2) return

    const itemNoInfo = findItemNo(lines, start, end)
    const hsInfo = findHsCode(lines, start, end)

    if (!itemNoInfo.value || !hsInfo.value) return

    rows.push({
      id: `${pageNumber}-${boundary.item}-${rows.length}`,
      sourcePage: pageNumber,
      itemNo: itemNoInfo.value,
      description: buildDescription(lines, itemNoInfo.index, hsInfo.index, end, itemNoInfo.value),
      hsCode: hsInfo.value,
      permitNo: findPermit(lines, start, end),
      permitItem: '',
      declarationNo: reportNo,
      declarationItem: boundary.item,
      qty: '',
      unit: '',
      priceUsd: '',
      amountUsd: '',
      netWeight: findNetWeightPerPiece(lines, start, end),
      rawText: lines.slice(start, end).join('\n'),
      issues: [],
    })
  })

  return {
    reportNo,
    rows,
    diagnostics: {
      lineCount: lines.length,
      boundaryCount: boundaries.length,
      rowCount: rows.length,
    },
  }
}

export function dedupeRows(rows) {
  const seen = new Set()
  return rows.filter(row => {
    const key = `${row.declarationNo}|${row.declarationItem}|${row.itemNo}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
