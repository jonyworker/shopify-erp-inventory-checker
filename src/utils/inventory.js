function normalizeSku(value) {
  return String(value ?? '').trim()
}

function normalizeQty(value) {
  const cleanedValue = String(value ?? '')
    .replace(/,/g, '')
    .trim()

  const numberValue = Number(cleanedValue)

  return Number.isFinite(numberValue) ? numberValue : 0
}

function toInventoryMap(rows, skuColumn, qtyColumn) {
  const map = new Map()
  const invalidRows = []

  rows.forEach((row, index) => {
    const sku = normalizeSku(row[skuColumn])
    const qty = normalizeQty(row[qtyColumn])

    if (!sku) {
      invalidRows.push({
        rowNumber: index + 2,
        reason: 'SKU 空白',
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

export function compareInventory({
  shopifyRows,
  erpRows,
  shopifySkuColumn,
  shopifyQtyColumn,
  erpSkuColumn,
  erpQtyColumn
}) {
  const shopify = toInventoryMap(shopifyRows, shopifySkuColumn, shopifyQtyColumn)
  const erp = toInventoryMap(erpRows, erpSkuColumn, erpQtyColumn)
  const comparedSkuSet = new Set()
  const results = []

  shopify.map.forEach((shopifyItem, sku) => {
    const erpItem = erp.map.get(sku)
    comparedSkuSet.add(sku)

    if (!erpItem) {
      results.push({
        sku,
        shopifyQty: shopifyItem.qty,
        erpQty: '',
        diff: '',
        status: 'Shopify 獨有',
        note: shopifyItem.duplicated ? 'Shopify SKU 重複，已加總' : ''
      })
      return
    }

    const diff = shopifyItem.qty - erpItem.qty

    results.push({
      sku,
      shopifyQty: shopifyItem.qty,
      erpQty: erpItem.qty,
      diff,
      status: diff === 0 ? '一致' : '數量不一致',
      note: [
        shopifyItem.duplicated ? 'Shopify SKU 重複，已加總' : '',
        erpItem.duplicated ? 'ERP SKU 重複，已加總' : ''
      ].filter(Boolean).join('；')
    })
  })

  erp.map.forEach((erpItem, sku) => {
    if (comparedSkuSet.has(sku)) return

    results.push({
      sku,
      shopifyQty: '',
      erpQty: erpItem.qty,
      diff: '',
      status: 'ERP 獨有',
      note: erpItem.duplicated ? 'ERP SKU 重複，已加總' : ''
    })
  })

  return {
    results,
    invalidRows: {
      shopify: shopify.invalidRows,
      erp: erp.invalidRows
    }
  }
}
