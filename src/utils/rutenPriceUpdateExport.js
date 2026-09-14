import * as XLSX from 'xlsx-js-style'

const RUTEN_COLUMNS = [
  '商品編號',
  '規格編號',
  '賣家自用料號',
  '商品名稱',
  '規格項目狀態',
  '規格名稱',
  '項目名稱',
  '售價',
  '庫存',
  '修改售價',
  '修改庫存'
]

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeSku(value) {
  return normalizeText(value).toUpperCase()
}

function normalizePrice(value) {
  const cleaned = normalizeText(value)
    .replace(/,/g, '')
    .replace(/NT\$/gi, '')
    .replace(/TWD/gi, '')
    .replace(/\$/g, '')

  if (!cleaned) return null

  const numberValue = Number(cleaned)
  return Number.isFinite(numberValue) ? numberValue : null
}

function validateRutenColumns(rutenRows) {
  if (!rutenRows?.length) {
    throw new Error('Ruten 原始資料為空，無法建立價格更新檔。')
  }

  const columns = new Set(
    rutenRows.flatMap(row => Object.keys(row || {}).map(column => normalizeText(column)))
  )

  const requiredColumns = ['賣家自用料號', '售價', '修改售價']
  const missingColumns = requiredColumns.filter(column => !columns.has(column))

  if (missingColumns.length) {
    throw new Error(`Ruten 原始 Excel 缺少必要欄位：${missingColumns.join('、')}。`)
  }
}

/**
 * 依 RRP / Ruten 比對結果建立露天價格更新資料。
 *
 * 規則：
 * - 僅處理「價格不一致」
 * - 以 Ruten 原始資料為範本，保留原欄位值
 * - 只寫入「修改售價」，「售價」保持原值
 * - 若新售價與目前售價相同，仍會再次排除，避免露天拒絕匯入
 */
export function buildRutenPriceUpdateRows(compareResults, rutenRows) {
  validateRutenColumns(rutenRows)

  const rutenRowsBySku = new Map()

  rutenRows.forEach(row => {
    const sku = normalizeSku(row?.['賣家自用料號'])
    if (!sku) return

    if (!rutenRowsBySku.has(sku)) {
      rutenRowsBySku.set(sku, [])
    }

    rutenRowsBySku.get(sku).push(row)
  })

  return (compareResults || [])
    .filter(item => item?.狀態 === '價格不一致')
    .flatMap(item => {
      const sku = normalizeSku(item?.品項編碼)
      const newPrice = normalizePrice(item?.RRP價格)
      const originalRows = rutenRowsBySku.get(sku) || []

      if (!sku || newPrice === null || !originalRows.length) return []

      return originalRows
        .map(originalRow => {
          const currentPrice = normalizePrice(originalRow['售價'])

          // 露天不接受「修改售價」與目前「售價」相同的資料列。
          if (currentPrice !== null && currentPrice === newPrice) return null

          const outputRow = {}

          RUTEN_COLUMNS.forEach(column => {
            outputRow[column] = originalRow[column] ?? ''
          })

          outputRow['修改售價'] = newPrice

          return outputRow
        })
        .filter(Boolean)
    })
}

export function downloadRutenPriceUpdateWorkbook(filename, compareResults, rutenRows) {
  const rows = buildRutenPriceUpdateRows(compareResults, rutenRows)

  if (!rows.length) {
    throw new Error('目前沒有可匯出的 Ruten 價格更新品項。')
  }

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: RUTEN_COLUMNS
  })
  const workbook = XLSX.utils.book_new()

  worksheet['!cols'] = RUTEN_COLUMNS.map(column => {
    if (column === '商品名稱') return { wch: 42 }
    if (column === '賣家自用料號') return { wch: 22 }
    if (['售價', '庫存', '修改售價', '修改庫存'].includes(column)) return { wch: 14 }
    return { wch: 18 }
  })

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
  XLSX.writeFile(workbook, filename)
}
