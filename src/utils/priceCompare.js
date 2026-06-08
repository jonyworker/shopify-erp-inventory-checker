function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase()
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizePrice(value) {
  const cleanedValue = String(value ?? '')
    .replace(/,/g, '')
    .replace(/NT\$/gi, '')
    .replace(/TWD/gi, '')
    .replace(/\$/g, '')
    .trim()

  if (!cleanedValue) return null

  const numberValue = Number(cleanedValue)

  return Number.isFinite(numberValue) ? numberValue : null
}

function toPriceMap(rows, options) {
  const map = new Map()
  const invalidRows = []

  rows.forEach((row, index) => {
    const itemCode = normalizeCode(row[options.codeColumn])
    const price = normalizePrice(row[options.priceColumn])
    const name = normalizeText(row[options.nameColumn])
    const sourceSheet = normalizeText(row['來源工作表'])

    if (!itemCode) {
      invalidRows.push({
        rowNumber: index + 2,
        reason: '品項編碼空白',
        raw: row
      })
      return
    }

    if (price === null) {
      invalidRows.push({
        rowNumber: index + 2,
        reason: '價格空白或格式無法辨識',
        raw: row
      })
      return
    }

    if (map.has(itemCode)) {
      const current = map.get(itemCode)
      current.duplicated = true
      current.sources.push(row)

      if (current.price !== price) {
        current.hasPriceConflict = true
      }

      return
    }

    map.set(itemCode, {
      itemCode,
      price,
      name,
      sourceSheet,
      duplicated: false,
      hasPriceConflict: false,
      sources: [row]
    })
  })

  return { map, invalidRows }
}

export function comparePrice({
  officialRows,
  erpRows,
  officialCodeColumn,
  officialPriceColumn,
  officialNameColumn,
  erpCodeColumn,
  erpPriceColumn,
  erpNameColumn
}) {
  const official = toPriceMap(officialRows, {
    codeColumn: officialCodeColumn,
    priceColumn: officialPriceColumn,
    nameColumn: officialNameColumn
  })

  const erp = toPriceMap(erpRows, {
    codeColumn: erpCodeColumn,
    priceColumn: erpPriceColumn,
    nameColumn: erpNameColumn
  })

  const comparedCodeSet = new Set()
  const results = []

  official.map.forEach((officialItem, itemCode) => {
    const erpItem = erp.map.get(itemCode)
    comparedCodeSet.add(itemCode)

    if (!erpItem) {
      results.push({
        品項編碼: itemCode,
        來源工作表: officialItem.sourceSheet,
        品項名稱: officialItem.name,
        價目表價格: officialItem.price,
        ERP出庫單價: '',
        差異: '',
        狀態: 'RRP 獨有',
        備註: officialItem.duplicated ? '價目表品項重複，已取第一筆價格' : ''
      })
      return
    }

    const diff = erpItem.price - officialItem.price

    results.push({
      品項編碼: itemCode,
      來源工作表: officialItem.sourceSheet,
      品項名稱: officialItem.name || erpItem.name,
      價目表價格: officialItem.price,
      ERP出庫單價: erpItem.price,
      差異: diff,
      狀態: diff === 0 ? '一致' : '價格不一致',
      備註: [
        officialItem.duplicated ? '價目表品項重複，已取第一筆價格' : '',
        officialItem.hasPriceConflict ? '價目表重複品項價格不同，請人工確認' : '',
        erpItem.duplicated ? 'ERP 品項重複，已取第一筆價格' : '',
        erpItem.hasPriceConflict ? 'ERP 重複品項價格不同，請人工確認' : ''
      ].filter(Boolean).join('；')
    })
  })

  erp.map.forEach((erpItem, itemCode) => {
    if (comparedCodeSet.has(itemCode)) return

    results.push({
      品項編碼: itemCode,
      來源工作表: '',
      品項名稱: erpItem.name,
      價目表價格: '',
      ERP出庫單價: erpItem.price,
      差異: '',
      狀態: 'ERP 獨有',
      備註: erpItem.duplicated ? 'ERP 品項重複，已取第一筆價格' : ''
    })
  })

  return {
    results,
    invalidRows: {
      official: official.invalidRows,
      erp: erp.invalidRows
    }
  }
}

export function comparePriceWithShopify({
  officialRows,
  shopifyRows,
  officialCodeColumn,
  officialPriceColumn,
  officialNameColumn,
  shopifyCodeColumn,
  shopifyPriceColumn,
  shopifyNameColumn
}) {
  const official = toPriceMap(officialRows, {
    codeColumn: officialCodeColumn,
    priceColumn: officialPriceColumn,
    nameColumn: officialNameColumn
  })

  const shopify = toPriceMap(shopifyRows, {
    codeColumn: shopifyCodeColumn,
    priceColumn: shopifyPriceColumn,
    nameColumn: shopifyNameColumn
  })

  const comparedCodeSet = new Set()
  const results = []

  official.map.forEach((officialItem, itemCode) => {
    const shopifyItem = shopify.map.get(itemCode)
    comparedCodeSet.add(itemCode)

    if (!shopifyItem) {
      results.push({
        品項編碼: itemCode,
        來源工作表: officialItem.sourceSheet,
        RRP品項名稱: officialItem.name,
        Shopify商品名稱: '',
        RRP價格: officialItem.price,
        Shopify價格: '',
        差異: '',
        狀態: 'RRP 獨有',
        備註: officialItem.duplicated ? 'RRP 品項重複，已取第一筆價格' : ''
      })
      return
    }

    const diff = shopifyItem.price - officialItem.price

    results.push({
      品項編碼: itemCode,
      來源工作表: officialItem.sourceSheet,
      RRP品項名稱: officialItem.name,
      Shopify商品名稱: shopifyItem.name,
      RRP價格: officialItem.price,
      Shopify價格: shopifyItem.price,
      差異: diff,
      狀態: diff === 0 ? '一致' : '價格不一致',
      備註: [
        officialItem.duplicated ? 'RRP 品項重複，已取第一筆價格' : '',
        officialItem.hasPriceConflict ? 'RRP 重複品項價格不同，請人工確認' : '',
        shopifyItem.duplicated ? 'Shopify SKU 重複，已取第一筆價格' : '',
        shopifyItem.hasPriceConflict ? 'Shopify 重複 SKU 價格不同，請人工確認' : ''
      ].filter(Boolean).join('；')
    })
  })

  shopify.map.forEach((shopifyItem, itemCode) => {
    if (comparedCodeSet.has(itemCode)) return

    results.push({
      品項編碼: itemCode,
      來源工作表: '',
      RRP品項名稱: '',
      Shopify商品名稱: shopifyItem.name,
      RRP價格: '',
      Shopify價格: shopifyItem.price,
      差異: '',
      狀態: 'Shopify 獨有',
      備註: shopifyItem.duplicated ? 'Shopify SKU 重複，已取第一筆價格' : ''
    })
  })

  return {
    results,
    invalidRows: {
      official: official.invalidRows,
      shopify: shopify.invalidRows
    }
  }
}
