function normalizeSku(value) {
  return String(value ?? '').trim()
}

function isIgnoredSku(value) {
  return value === '合計' || /^\d{4}\/\d{2}\/\d{2}/.test(value)
}

function normalizeQty(value) {
  const cleanedValue = String(value ?? '')
    .replace(/,/g, '')
    .trim()

  const numberValue = Number(cleanedValue)

  return Number.isFinite(numberValue) ? numberValue : 0
}

function toInventoryMap(rows, skuColumn, qtyColumn, sourceLabel = '來源') {
  const map = new Map()
  const invalidRows = []

  rows.forEach((row, index) => {
    const sku = normalizeSku(row[skuColumn])
    const qty = normalizeQty(row[qtyColumn])

    if (!sku || isIgnoredSku(sku)) {
      invalidRows.push({
        rowNumber: index + 2,
        reason: !sku ? `${sourceLabel} SKU 空白` : `${sourceLabel} 非商品資料列`,
        raw: row
      })
      return
    }

    if (map.has(sku)) {
      const current = map.get(sku)
      current.qty += qty
      current.duplicated = true
      current.sources.push(row)
      return
    }

    map.set(sku, {
      sku,
      qty,
      duplicated: false,
      sources: [row]
    })
  })

  return { map, invalidRows }
}

export function compareInventoryBySource({
  sourceRows,
  targetRows,
  sourceSkuColumn,
  sourceQtyColumn,
  targetSkuColumn,
  targetQtyColumn,
  sourceLabel = '來源',
  targetLabel = 'ERP',
  sourceQtyKey = 'sourceQty',
  targetQtyKey = 'targetQty'
}) {
  const source = toInventoryMap(sourceRows, sourceSkuColumn, sourceQtyColumn, sourceLabel)
  const target = toInventoryMap(targetRows, targetSkuColumn, targetQtyColumn, targetLabel)
  const comparedSkuSet = new Set()
  const results = []

  source.map.forEach((sourceItem, sku) => {
    const targetItem = target.map.get(sku)
    comparedSkuSet.add(sku)

    if (!targetItem) {
      results.push({
        sku,
        [sourceQtyKey]: sourceItem.qty,
        [targetQtyKey]: '',
        diff: '',
        status: `${sourceLabel} 獨有`,
        note: sourceItem.duplicated ? `${sourceLabel} SKU 重複，已加總` : ''
      })
      return
    }

    const diff = sourceItem.qty - targetItem.qty

    results.push({
      sku,
      [sourceQtyKey]: sourceItem.qty,
      [targetQtyKey]: targetItem.qty,
      diff,
      status: diff === 0 ? '一致' : '數量不一致',
      note: [
        sourceItem.duplicated ? `${sourceLabel} SKU 重複，已加總` : '',
        targetItem.duplicated ? `${targetLabel} SKU 重複，已加總` : ''
      ].filter(Boolean).join('；')
    })
  })

  target.map.forEach((targetItem, sku) => {
    if (comparedSkuSet.has(sku)) return

    results.push({
      sku,
      [sourceQtyKey]: '',
      [targetQtyKey]: targetItem.qty,
      diff: '',
      status: `${targetLabel} 獨有`,
      note: targetItem.duplicated ? `${targetLabel} SKU 重複，已加總` : ''
    })
  })

  return {
    results,
    invalidRows: {
      source: source.invalidRows,
      target: target.invalidRows
    }
  }
}

export function compareInventory({
  shopifyRows,
  erpRows,
  shopifySkuColumn,
  shopifyQtyColumn,
  erpSkuColumn,
  erpQtyColumn
}) {
  const compared = compareInventoryBySource({
    sourceRows: shopifyRows,
    targetRows: erpRows,
    sourceSkuColumn: shopifySkuColumn,
    sourceQtyColumn: shopifyQtyColumn,
    targetSkuColumn: erpSkuColumn,
    targetQtyColumn: erpQtyColumn,
    sourceLabel: 'Shopify',
    targetLabel: 'ERP',
    sourceQtyKey: 'shopifyQty',
    targetQtyKey: 'erpQty'
  })

  return {
    results: compared.results,
    invalidRows: {
      shopify: compared.invalidRows.source,
      erp: compared.invalidRows.target
    }
  }
}
