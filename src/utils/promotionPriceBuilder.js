import * as XLSX from 'xlsx-js-style'

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function normalizeSku(value) {
  return normalizeText(value).toUpperCase()
}

export function normalizePrice(value) {
  const cleaned = normalizeText(value)
    .replace(/,/g, '')
    .replace(/NT\$/gi, '')
    .replace(/TWD/gi, '')
    .replace(/\$/g, '')

  if (!cleaned) return null
  const numberValue = Number(cleaned)
  return Number.isFinite(numberValue) ? numberValue : null
}

export function parseDiscountPercent(value) {
  const text = normalizeText(value)
  if (!text) return null

  const match = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:OFF)?/i)
  if (!match) return null

  const percent = Number(match[1])
  return Number.isFinite(percent) && percent >= 0 && percent < 100 ? percent : null
}

function isEmptyRow(row) {
  return !row?.some(value => normalizeText(value))
}

function findHeaderIndexes(row) {
  const normalized = row.map(normalizeText)
  const skuIndex = normalized.findIndex(value => value === '品項編碼' || /^item$/i.test(value))
  const nameIndex = normalized.findIndex(value => value === '品項名稱' || /品名|product name/i.test(value))

  return { skuIndex, nameIndex }
}

function findDiscountInRow(row) {
  for (const cell of row) {
    const percent = parseDiscountPercent(cell)
    if (percent !== null) return percent
  }
  return null
}

export async function parsePromotionSourceWorkbook(file) {
  const data = await file.arrayBuffer()
  const workbook = XLSX.read(data, { type: 'array' })

  const sheets = workbook.SheetNames.map(sheetName => {
    const worksheet = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false
    })

    let header = []
    let skuIndex = -1
    let nameIndex = -1
    let currentDiscount = null
    let blockIndex = 0
    const rows = []

    rawRows.forEach((rawRow, index) => {
      const row = Array.isArray(rawRow) ? rawRow : []
      if (isEmptyRow(row)) return

      const headerIndexes = findHeaderIndexes(row)
      if (headerIndexes.skuIndex >= 0) {
        header = row.map(normalizeText)
        skuIndex = headerIndexes.skuIndex
        nameIndex = headerIndexes.nameIndex
        const headerDiscount = findDiscountInRow(row)
        if (headerDiscount !== null) currentDiscount = headerDiscount
        blockIndex += 1
        return
      }

      const rowDiscount = findDiscountInRow(row)
      const firstNonEmptyIndex = row.findIndex(value => normalizeText(value))
      if (rowDiscount !== null && (firstNonEmptyIndex === 0 || row.filter(value => normalizeText(value)).length <= 2)) {
        currentDiscount = rowDiscount
        return
      }

      if (skuIndex < 0) return

      const sku = normalizeSku(row[skuIndex])
      if (!sku) return

      const sourceValues = {}
      header.forEach((column, columnIndex) => {
        if (!column) return
        sourceValues[column] = row[columnIndex] ?? ''
      })

      rows.push({
        sku,
        name: nameIndex >= 0 ? normalizeText(row[nameIndex]) : '',
        discountPercent: currentDiscount,
        sourceSheet: sheetName,
        sourceRow: index + 1,
        blockIndex,
        sourceValues
      })
    })

    return { name: sheetName, rows }
  }).filter(sheet => sheet.rows.length)

  if (!sheets.length) {
    throw new Error('找不到 Promotion 商品資料。請確認檔案內有「品項編碼」欄位。')
  }

  return sheets
}

export function buildRrpIndex(rows, { skuColumn, priceColumn, nameColumn }) {
  const map = new Map()

  rows.forEach((row, index) => {
    const sku = normalizeSku(row[skuColumn])
    const price = normalizePrice(row[priceColumn])
    const name = normalizeText(row[nameColumn])

    if (!sku || price === null) return

    if (!map.has(sku)) {
      map.set(sku, {
        sku,
        price,
        name,
        duplicated: false,
        hasPriceConflict: false,
        sourceRows: [index + 2]
      })
      return
    }

    const current = map.get(sku)
    current.duplicated = true
    current.sourceRows.push(index + 2)
    if (current.price !== price) current.hasPriceConflict = true
  })

  return map
}

export function calculatePromotionRows({ promotionRows, rrpRows, skuColumn, priceColumn, nameColumn }) {
  const rrpMap = buildRrpIndex(rrpRows, { skuColumn, priceColumn, nameColumn })

  return promotionRows.map(item => {
    const rrp = rrpMap.get(normalizeSku(item.sku))

    if (item.discountPercent === null) {
      return {
        ...item,
        retailPrice: rrp?.price ?? null,
        promotionPrice: null,
        status: 'discount-missing',
        statusLabel: '找不到折扣',
        note: '此 SKU 所屬區段沒有辨識到像 12% OFF 的折扣標示。'
      }
    }

    if (!rrp) {
      return {
        ...item,
        retailPrice: null,
        promotionPrice: null,
        status: 'rrp-missing',
        statusLabel: 'RRP 找不到',
        note: 'Promotion 有此 SKU，但 RRP 找不到相同品項編碼。'
      }
    }

    if (rrp.hasPriceConflict) {
      return {
        ...item,
        rrpName: rrp.name,
        retailPrice: rrp.price,
        promotionPrice: null,
        status: 'rrp-conflict',
        statusLabel: 'RRP 價格衝突',
        note: `RRP 內同一 SKU 有不同價格，來源列：${rrp.sourceRows.join(', ')}。`
      }
    }

    const promotionPrice = Math.round(rrp.price * (1 - item.discountPercent / 100))

    return {
      ...item,
      rrpName: rrp.name,
      retailPrice: rrp.price,
      promotionPrice,
      status: 'ready',
      statusLabel: '可匯出',
      note: rrp.duplicated ? 'RRP 有重複 SKU，但價格一致，已使用該價格。' : ''
    }
  })
}

function outputStockColumns(rows) {
  const preferred = [
    'TWG-共榮庫存',
    'TWOCY - 交易佔存倉(Occupy)',
    'TWRT-露天倉庫',
    'TWSS-STEEL SHOP'
  ]

  const columns = []
  const seen = new Set()

  preferred.forEach(column => {
    if (rows.some(item => Object.prototype.hasOwnProperty.call(item.sourceValues, column))) {
      columns.push(column)
      seen.add(column)
    }
  })

  rows.forEach(item => {
    Object.keys(item.sourceValues || {}).forEach(column => {
      if (seen.has(column)) return
      if (column === '品項編碼' || column === '品項名稱') return
      if (/retail price/i.test(column) || parseDiscountPercent(column) !== null) return
      if (!/庫存|occupy|stock/i.test(column)) return
      seen.add(column)
      columns.push(column)
    })
  })

  return columns
}

function buildOutputSheetRows(rows) {
  const readyRows = rows.filter(item => item.status === 'ready')
  const stockColumns = outputStockColumns(readyRows)
  const output = []

  let currentBlockKey = ''

  readyRows.forEach(item => {
    const blockKey = `${item.blockIndex}-${item.discountPercent}`

    if (blockKey !== currentBlockKey) {
      if (output.length) output.push([])

      output.push([
        '品項編碼',
        '品項名稱',
        ...stockColumns,
        'Retail Price (TWD)\n(含稅)',
        `${item.discountPercent}% off`
      ])
      currentBlockKey = blockKey
    }

    output.push([
      item.sku,
      item.name || item.rrpName || '',
      ...stockColumns.map(column => item.sourceValues?.[column] ?? ''),
      item.retailPrice,
      item.promotionPrice
    ])
  })

  return output
}

export function downloadPromotionPriceWorkbook(filename, sheetsWithResults) {
  const workbook = XLSX.utils.book_new()

  sheetsWithResults.forEach(sheet => {
    const rows = buildOutputSheetRows(sheet.rows)
    if (!rows.length) return

    const worksheet = XLSX.utils.aoa_to_sheet(rows)
    const range = XLSX.utils.decode_range(worksheet['!ref'])

    // 所有有內容的 cell 加外框
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const address = XLSX.utils.encode_cell({ r, c })
        const cell = worksheet[address]

        if (!cell) continue
        if (cell.v === null || cell.v === undefined || cell.v === '') continue

        cell.s = {
          ...(cell.s || {}),
          border: {
            top: { style: 'thin', color: { rgb: 'CBD5E1' } },
            bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
            left: { style: 'thin', color: { rgb: 'CBD5E1' } },
            right: { style: 'thin', color: { rgb: 'CBD5E1' } }
          }
        }
      }
    }

    // 設定欄寬
    worksheet['!cols'] = [
      { wch: 14 }, // A 品項編碼
      { wch: 48 }, // B 品項名稱
      { wch: 5 },  // C TWG-共榮庫存
      { wch: 5 }, // D TWOCY-交易佔存倉
      { wch: 5 },  // E TWRT-露天倉庫
      { wch: 5 },  // F TWSS-STEEL SHOP
      { wch: 10 }, // G Retail Price
      { wch: 10 }, // H Promotion Price
    ]

    // 標題列樣式
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const firstCell = worksheet[XLSX.utils.encode_cell({ r, c: 0 })]

      if (!firstCell || normalizeText(firstCell.v) !== '品項編碼') continue

      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const address = XLSX.utils.encode_cell({ r, c })
        if (!worksheet[address]) continue

        worksheet[address].s = {
          ...(worksheet[address].s || {}),
          fill: { fgColor: { rgb: 'E2E8F0' } },
          font: {
            bold: true,
            color: { rgb: '0F172A' }
          },
          alignment: {
            horizontal: 'center',
            vertical: 'center',
            wrapText: true
          },
          border: {
            top: { style: 'thin', color: { rgb: 'CBD5E1' } },
            bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
            left: { style: 'thin', color: { rgb: 'CBD5E1' } },
            right: { style: 'thin', color: { rgb: 'CBD5E1' } }
          }
        }
      }
    }

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        sheet.name.slice(0, 31)
    )
  })

  if (!workbook.SheetNames.length) {
    throw new Error('沒有可匯出的正常資料。')
  }

  XLSX.writeFile(workbook, filename)
}
