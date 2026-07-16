/**
 * Shopify 價格更新 CSV 輸出欄位。
 *
 * 之後要增加或移除欄位，只需要調整這個陣列。
 *
 * 注意：
 * 欄位名稱必須與 Shopify CSV 原始欄位名稱完全相同。
 */
const EXPORT_COLUMNS = [
  'Handle',
  'Title',

  'Option1 Name',
  'Option1 Value',
  'Option1 Linked To',

  'Option2 Name',
  'Option2 Value',
  'Option2 Linked To',

  'Option3 Name',
  'Option3 Value',
  'Option3 Linked To',

  'Variant SKU',
  'Variant Price',
  'Variant Compare At Price'
]

function normalizeCode(value) {
  return String(value ?? '')
      .trim()
      .toUpperCase()
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

  return Number.isFinite(numberValue)
      ? numberValue
      : null
}

function formatShopifyPrice(value) {
  const numberValue = normalizePrice(value)

  if (numberValue === null) return ''

  return String(numberValue)
}

/**
 * 依照 EXPORT_COLUMNS 產生最終輸出資料列。
 *
 * @param {Object} sourceRow
 * @returns {Object}
 */
function pickExportColumns(sourceRow) {
  const result = {}

  EXPORT_COLUMNS.forEach(column => {
    result[column] = sourceRow[column] ?? ''
  })

  return result
}

/**
 * 建立 Shopify 價格更新 CSV 資料列。
 *
 * compareResults：
 * 完整比對結果。
 *
 * 用來建立所有「價格不一致」SKU 的價格更新資料。
 *
 * selectedResults：
 * 目前畫面篩選後的比對結果。
 *
 * 只用來決定哪些 SKU 所屬的 Handle 要輸出。
 *
 * 範例：
 *
 * 同一 Handle 有：
 *
 * SKU-A：價格不一致
 * SKU-B：價格不一致
 * SKU-C：價格一致
 *
 * 使用者搜尋 SKU-A 時：
 *
 * selectedResults 只包含 SKU-A
 * → 找出 SKU-A 所屬 Handle
 *
 * compareResults 仍包含 SKU-A、SKU-B、SKU-C
 * → SKU-A 與 SKU-B 都會更新價格
 * → SKU-C 保留原價
 *
 * @param {Object} params
 * @param {Array<Object>} params.shopifyRows
 * @param {Array<Object>} params.compareResults
 * @param {Array<Object>} [params.selectedResults]
 * @param {string} [params.skuColumn='Variant SKU']
 * @returns {Array<Object>}
 */
export function buildShopifyPriceImportRows({
                                              shopifyRows,
                                              compareResults,
                                              selectedResults = compareResults,
                                              skuColumn = 'Variant SKU'
                                            }) {
  if (!Array.isArray(shopifyRows)) {
    return []
  }

  if (!Array.isArray(compareResults)) {
    return []
  }

  if (!Array.isArray(selectedResults)) {
    return []
  }

  /**
   * 完整價格更新表。
   *
   * 這裡必須使用 compareResults，
   * 不能使用 selectedResults。
   *
   * 這樣同一 Handle 內其他價格不一致 SKU
   * 才能一起更新。
   */
  const priceUpdateMap = new Map()

  compareResults.forEach(item => {
    if (item.status !== '價格不一致') return

    const sku = normalizeCode(item.sku)
    const rrpPrice = normalizePrice(item.rrpPrice)
    const shopifyPrice = normalizePrice(item.shopifyPrice)

    if (
        !sku ||
        rrpPrice === null ||
        shopifyPrice === null
    ) {
      return
    }

    priceUpdateMap.set(sku, {
      rrpPrice,
      shopifyPrice
    })
  })

  if (!priceUpdateMap.size) {
    return []
  }

  /**
   * 目前篩選結果中的 SKU。
   *
   * selectedResults 只負責決定：
   * 哪些商品 Handle 要輸出。
   */
  const selectedSkuSet = new Set()

  selectedResults.forEach(item => {
    const sku = normalizeCode(item.sku)

    if (!sku) return

    selectedSkuSet.add(sku)
  })

  if (!selectedSkuSet.size) {
    return []
  }

  /**
   * 需要輸出的商品 Handle。
   */
  const targetHandles = new Set()

  /**
   * 各 Handle 的商品標題。
   */
  const titleByHandle = new Map()

  shopifyRows.forEach(row => {
    const handle = normalizeText(row.Handle)
    const sku = normalizeCode(row[skuColumn])
    const title = normalizeText(row.Title)

    if (
        handle &&
        title &&
        !titleByHandle.has(handle)
    ) {
      titleByHandle.set(handle, title)
    }

    /**
     * 只有篩選結果中的 SKU，
     * 才用來決定哪些 Handle 要輸出。
     */
    if (
        handle &&
        sku &&
        selectedSkuSet.has(sku)
    ) {
      targetHandles.add(handle)
    }
  })

  if (!targetHandles.size) {
    return []
  }

  /**
   * 只保留：
   *
   * 1. 屬於目標 Handle
   * 2. 有 Variant SKU 的款式列
   *
   * 沒有 SKU 的圖片專用列不輸出。
   *
   * filter 不會改變原始 Shopify 列順序。
   */
  const filteredRows = shopifyRows.filter(row => {
    const handle = normalizeText(row.Handle)
    const sku = normalizeCode(row[skuColumn])

    return (
        handle &&
        sku &&
        targetHandles.has(handle)
    )
  })

  /**
   * 記錄哪些 Handle 已經輸出過 Title。
   */
  const emittedTitleHandles = new Set()

  return filteredRows.map(row => {
    const handle = normalizeText(row.Handle)
    const sku = normalizeCode(row[skuColumn])

    /**
     * 這裡從完整 priceUpdateMap 查詢，
     * 所以同 Handle 下其他價格不一致 SKU
     * 也會更新。
     */
    const priceUpdate = priceUpdateMap.get(sku)

    /**
     * 預設保留 Shopify 原始價格。
     */
    let variantPrice =
        row['Variant Price'] ?? ''

    let variantCompareAtPrice =
        row['Variant Compare At Price'] ?? ''

    /**
     * 只有完整比對結果中屬於「價格不一致」的 SKU
     * 才更新價格。
     */
    if (priceUpdate) {
      const {
        rrpPrice,
        shopifyPrice
      } = priceUpdate

      /**
       * Variant Price 更新為 RRP Retail Price。
       */
      variantPrice =
          formatShopifyPrice(rrpPrice)

      /**
       * Variant Compare At Price 規則：
       *
       * RRP 大於 Shopify 原始 Variant Price
       * → 清空。
       *
       * RRP 小於或等於 Shopify 原始 Variant Price
       * → 保留 Shopify 原始值。
       */
      if (rrpPrice > shopifyPrice) {
        variantCompareAtPrice = ''
      }
    }

    /**
     * 同一個 Handle 只有第一列保留 Title。
     */
    let title = ''

    if (!emittedTitleHandles.has(handle)) {
      title =
          titleByHandle.get(handle) ||
          normalizeText(row.Title)

      emittedTitleHandles.add(handle)
    }

    /**
     * 建立完整的可輸出資料。
     */
    const outputRow = {
      Handle: handle,

      Title: title,

      'Option1 Name':
          row['Option1 Name'] ?? '',

      'Option1 Value':
          row['Option1 Value'] ?? '',

      'Option1 Linked To':
          row['Option1 Linked To'] ?? '',

      'Option2 Name':
          row['Option2 Name'] ?? '',

      'Option2 Value':
          row['Option2 Value'] ?? '',

      'Option2 Linked To':
          row['Option2 Linked To'] ?? '',

      'Option3 Name':
          row['Option3 Name'] ?? '',

      'Option3 Value':
          row['Option3 Value'] ?? '',

      'Option3 Linked To':
          row['Option3 Linked To'] ?? '',

      'Variant SKU':
          row[skuColumn] ?? '',

      'Variant Price':
      variantPrice,

      'Variant Compare At Price':
      variantCompareAtPrice
    }

    /**
     * 最後依 EXPORT_COLUMNS 決定：
     *
     * 1. 輸出哪些欄位
     * 2. 欄位排列順序
     */
    return pickExportColumns(outputRow)
  })
}