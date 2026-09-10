import * as XLSX from 'xlsx-js-style'

const BASE_EXPORT_COLUMNS = [
    'Handle',
    'Title',
    'Tags',

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
    // 'Variant Inventory Qty',
    'Variant Price',
    'Variant Compare At Price'
]

const LINKED_TO_COLUMNS = [
    'Option1 Linked To',
    'Option2 Linked To',
    'Option3 Linked To'
]

const PRICE_COLUMNS = [
    'Variant Price',
    'Variant Compare At Price'
]

function normalizeText(value) {
    return String(value ?? '').trim()
}

export function normalizeSku(value) {
    return normalizeText(value).toUpperCase()
}

export function normalizePrice(value) {
    const cleanedValue = normalizeText(value)
        .replace(/,/g, '')
        .replace(/NT\$/gi, '')
        .replace(/TWD/gi, '')
        .replace(/\$/g, '')

    if (!cleanedValue) return null

    const numberValue = Number(cleanedValue)

    return Number.isFinite(numberValue)
        ? numberValue
        : null
}

/**
 * Shopify 價格輸出格式。
 *
 * 有效價格固定輸出兩位小數：
 *
 * 4200 → 4200.00
 * 3696 → 3696.00
 *
 * 空白維持空白。
 */
function formatShopifyPrice(value) {
    const price = normalizePrice(value)

    return price === null
        ? ''
        : price.toFixed(2)
}

function firstNonEmpty(rows, column) {
    for (const row of rows) {
        const value = normalizeText(row[column])

        if (value) {
            return value
        }
    }

    return ''
}

export function parsePromotionRows(rawRows, sheetName) {
  const rows = []
  let header = []
  let headerIndexes = null
  let currentDiscountLabel = ''

  const normalizeHeader = value => normalizeText(value).replace(/\s+/g, ' ')
  const findHeaderIndex = (patterns) => header.findIndex(column =>
    patterns.some(pattern => pattern.test(normalizeHeader(column)))
  )
  const findDiscountLabel = row => {
    for (const cell of row) {
      const text = normalizeText(cell)
      if (/\d+(?:\.\d+)?\s*%\s*(?:OFF)?/i.test(text)) return text
    }
    return ''
  }

  rawRows.forEach((rawRow, index) => {
    const row = Array.isArray(rawRow) ? rawRow : []
    const normalizedRow = row.map(normalizeHeader)
    const skuHeaderIndex = normalizedRow.findIndex(value => value === '品項編碼' || /^item$/i.test(value))

    if (skuHeaderIndex >= 0) {
      header = normalizedRow

      const retailIndex = findHeaderIndex([
        /retail price/i,
        /零售價/,
        /建議售價/,
        /含稅.*價格/
      ])

      const promotionIndex = header.findIndex(column => /\d+(?:\.\d+)?\s*%\s*(?:OFF)?/i.test(column))

      headerIndexes = {
        sku: skuHeaderIndex,
        name: findHeaderIndex([/^品項名稱$/, /product name/i, /item name/i]),
        twg: findHeaderIndex([/^TWG-/i]),
        ruten: findHeaderIndex([/^TWRT-/i, /露天/]),
        steelShop: findHeaderIndex([/^TWSS-/i, /STEEL SHOP/i]),
        retail: retailIndex,
        promotion: promotionIndex
      }

      const headerDiscount = findDiscountLabel(row)
      if (headerDiscount) currentDiscountLabel = headerDiscount
      return
    }

    const discountOnly = findDiscountLabel(row)
    const nonEmptyCount = row.filter(cell => normalizeText(cell)).length
    if (discountOnly && nonEmptyCount <= 2) {
      currentDiscountLabel = discountOnly
      return
    }

    if (!headerIndexes) return

    const sku = normalizeSku(row[headerIndexes.sku])
    if (!sku) return

    const promotionPrice = headerIndexes.promotion >= 0
      ? normalizePrice(row[headerIndexes.promotion])
      : null

    if (promotionPrice === null) return

    rows.push({
      sku,
      name: headerIndexes.name >= 0 ? normalizeText(row[headerIndexes.name]) : '',
      twgStock: headerIndexes.twg >= 0 ? normalizeText(row[headerIndexes.twg]) : '',
      rutenStock: headerIndexes.ruten >= 0 ? normalizeText(row[headerIndexes.ruten]) : '',
      steelShopStock: headerIndexes.steelShop >= 0 ? normalizeText(row[headerIndexes.steelShop]) : '',
      retailPrice: headerIndexes.retail >= 0 ? normalizePrice(row[headerIndexes.retail]) : null,
      promotionPrice,
      discountLabel: currentDiscountLabel || (headerIndexes.promotion >= 0 ? header[headerIndexes.promotion] : ''),
      sourceSheet: sheetName,
      sourceRow: index + 1
    })
  })

  return rows
}

export async function parsePromotionWorkbook(file) {
    const data = await file.arrayBuffer()

    const workbook = XLSX.read(
        data,
        {
            type: 'array'
        }
    )

    const sheets = workbook.SheetNames
        .map(sheetName => {
            const worksheet =
                workbook.Sheets[sheetName]

            const rawRows =
                XLSX.utils.sheet_to_json(
                    worksheet,
                    {
                        header: 1,
                        defval: '',
                        raw: false
                    }
                )

            return {
                name: sheetName,
                rows: parsePromotionRows(
                    rawRows,
                    sheetName
                )
            }
        })
        .filter(sheet => sheet.rows.length)

    if (!sheets.length) {
        throw new Error(
            '找不到 Promotion 商品資料。'
        )
    }

    return sheets
}

function buildShopifyIndexes(
    shopifyRows,
    skuColumn = 'Variant SKU'
) {
    const rowsByHandle = new Map()
    const rowsBySku = new Map()

    shopifyRows.forEach((row, index) => {
        const handle =
            normalizeText(row.Handle)

        const sku =
            normalizeSku(row[skuColumn])

        const indexedRow = {
            row,
            index,
            handle,
            sku
        }

        if (handle) {
            if (!rowsByHandle.has(handle)) {
                rowsByHandle.set(
                    handle,
                    []
                )
            }

            rowsByHandle
                .get(handle)
                .push(indexedRow)
        }

        if (sku) {
            if (!rowsBySku.has(sku)) {
                rowsBySku.set(
                    sku,
                    []
                )
            }

            rowsBySku
                .get(sku)
                .push(indexedRow)
        }
    })

    const productMetaByHandle =
        new Map()

    rowsByHandle.forEach(
        (indexedRows, handle) => {
            const sourceRows =
                indexedRows.map(
                    item => item.row
                )

            productMetaByHandle.set(
                handle,
                {
                    handle,

                    title:
                        firstNonEmpty(
                            sourceRows,
                            'Title'
                        ),

                    tags:
                        firstNonEmpty(
                            sourceRows,
                            'Tags'
                        ),

                    published:
                        firstNonEmpty(
                            sourceRows,
                            'Published'
                        ),

                    status:
                        firstNonEmpty(
                            sourceRows,
                            'Status'
                        )
                }
            )
        }
    )

    return {
        rowsByHandle,
        rowsBySku,
        productMetaByHandle
    }
}

function isPublishedActive(meta) {
    return (
        normalizeText(meta?.published)
            .toLowerCase() === 'true' &&
        normalizeText(meta?.status)
            .toLowerCase() === 'active'
    )
}

export function comparePromotionWithShopify({
                                                promotionRows,
                                                shopifyRows,
                                                skuColumn = 'Variant SKU'
                                            }) {
    const indexes =
        buildShopifyIndexes(
            shopifyRows,
            skuColumn
        )

    const promotionSkuCount =
        new Map()

    promotionRows.forEach(item => {
        const sku =
            normalizeSku(item.sku)

        if (!sku) {
            return
        }

        promotionSkuCount.set(
            sku,
            (
                promotionSkuCount.get(sku) ||
                0
            ) + 1
        )
    })

    const results =
        promotionRows.map(item => {
            const sku =
                normalizeSku(item.sku)

            const matches =
                indexes.rowsBySku.get(sku) ||
                []

            const handles = [
                ...new Set(
                    matches
                        .map(
                            match =>
                                match.handle
                        )
                        .filter(Boolean)
                )
            ]

            if (
                (
                    promotionSkuCount.get(sku) ||
                    0
                ) > 1
            ) {
                return {
                    ...item,
                    sku,

                    status:
                        'promotion-duplicate',

                    statusLabel:
                        'Promotion SKU 重複',

                    note:
                        '同一活動工作表內有重複 SKU，請先確認 Promotion 資料。',

                    handles: []
                }
            }

            if (
                !matches.length ||
                !handles.length
            ) {
                return {
                    ...item,
                    sku,

                    status:
                        'missing',

                    statusLabel:
                        'Shopify 找不到',

                    note:
                        'Promotion 有此 SKU，但 Shopify All Products 沒有相同 Variant SKU。',

                    handles: []
                }
            }

            if (handles.length > 1) {
                const products =
                    handles.map(handle =>
                        indexes
                            .productMetaByHandle
                            .get(handle)
                    )

                return {
                    ...item,
                    sku,

                    status:
                        'duplicate-shopify',

                    statusLabel:
                        'Shopify SKU 重複',

                    note:
                        `同一 SKU 對應 ${handles.length} 個 Shopify 商品，已排除自動匯出。`,

                    handles,
                    products
                }
            }

            const handle =
                handles[0]

            const meta =
                indexes
                    .productMetaByHandle
                    .get(handle) ||
                {}

            const variantRow =
                matches.find(
                    match =>
                        match.handle === handle
                )?.row ||
                {}

            const publishedActive =
                isPublishedActive(meta)

            return {
                ...item,
                sku,
                handle,

                shopifyTitle:
                    meta.title ||
                    normalizeText(
                        variantRow.Title
                    ),

                shopifyPrice:
                    normalizePrice(
                        variantRow[
                            'Variant Price'
                            ]
                    ),

                compareAtPrice:
                    normalizePrice(
                        variantRow[
                            'Variant Compare At Price'
                            ]
                    ),

                published:
                meta.published,

                shopifyStatus:
                meta.status,

                status:
                    publishedActive
                        ? 'ready'
                        : 'not-published',

                statusLabel:
                    publishedActive
                        ? '正常上架'
                        : '未正常上架',

                note:
                    publishedActive
                        ? ''
                        : `Published: ${meta.published || '空白'}；Status: ${meta.status || '空白'}`,

                handles: [
                    handle
                ]
            }
        })

    return {
        results,
        indexes
    }
}

function splitTags(value) {
    return normalizeText(value)
        .split(',')
        .map(
            tag =>
                tag.trim()
        )
        .filter(Boolean)
}

export function mergeTags(
    existingTags,
    addedTags
) {
    const merged = []
    const seen = new Set()

    ;[
        ...splitTags(existingTags),
        ...(addedTags || [])
    ].forEach(rawTag => {
        const tag =
            normalizeText(rawTag)

        if (!tag) {
            return
        }

        const key =
            tag.toLocaleLowerCase()

        if (seen.has(key)) {
            return
        }

        seen.add(key)
        merged.push(tag)
    })

    return merged.join(', ')
}

export function removeTags(
    existingTags,
    removedTags
) {
    const removed = new Set(
        (removedTags || [])
            .map(
                tag =>
                    normalizeText(tag)
                        .toLocaleLowerCase()
            )
            .filter(Boolean)
    )

    return splitTags(existingTags)
        .filter(
            tag =>
                !removed.has(
                    tag.toLocaleLowerCase()
                )
        )
        .join(', ')
}

function getShopifyColumns(
    shopifyRows
) {
    const columns = []
    const seen = new Set()

    shopifyRows.forEach(row => {
        Object
            .keys(row || {})
            .forEach(column => {
                if (seen.has(column)) {
                    return
                }

                seen.add(column)
                columns.push(column)
            })
    })

    return columns
}

function findLinkedMetafieldColumns(
    shopifyRows,
    targetHandles
) {
    const shopifyColumns =
        getShopifyColumns(shopifyRows)

    const linkedTargets =
        new Set()

    shopifyRows.forEach(row => {
        const handle =
            normalizeText(row.Handle)

        if (!targetHandles.has(handle)) {
            return
        }

        LINKED_TO_COLUMNS.forEach(
            column => {
                const linkedTo =
                    normalizeText(
                        row[column]
                    )

                if (linkedTo) {
                    linkedTargets.add(
                        linkedTo
                    )
                }
            }
        )
    })

    return shopifyColumns.filter(
        column => {
            return [
                ...linkedTargets
            ].some(
                linkedTo =>
                    column.includes(
                        `(${linkedTo})`
                    )
            )
        }
    )
}

/**
 * 只保留 Shopify 匯出需要的欄位。
 *
 * Variant Price 與 Variant Compare At Price
 * 在這裡統一格式為兩位小數。
 *
 * 因此 START / END 產生的 CSV，
 * 不論價格是否有被修改，
 * 都會維持一致格式。
 */
function pickExportColumns(
    sourceRow,
    exportColumns
) {
    const result = {}

    exportColumns.forEach(column => {
        const value =
            sourceRow[column] ?? ''

        if (
            PRICE_COLUMNS.includes(column)
        ) {
            result[column] =
                formatShopifyPrice(value)

            return
        }

        result[column] =
            value
    })

    return result
}

/**
 * START
 *
 * 活動開始時使用。
 *
 * - 活動 SKU：
 *   Variant Price = Promotion 優惠價
 *
 * - Variant Compare At Price：
 *   保留 Shopify 原值，視為公司 RRP
 *
 * - Tags：
 *   加入活動 Tag
 *
 * - 同一商品其他 Variant：
 *   一併輸出，但價格維持原值
 *
 * - Variant Image：
 *   不輸出
 */
export function buildShopifyPromotionImportRows({
                                                    shopifyRows,
                                                    compareResults,
                                                    addedTags = [],
                                                    skuColumn = 'Variant SKU'
                                                }) {
    const eligibleResults =
        compareResults.filter(item => {
            return (
                item.status === 'ready' ||
                item.status === 'not-published'
            )
        })

    const priceUpdateMap =
        new Map()

    const targetHandles =
        new Set()

    eligibleResults.forEach(item => {
        const sku =
            normalizeSku(item.sku)

        const price =
            normalizePrice(
                item.promotionPrice
            )

        const handle =
            normalizeText(item.handle)

        if (
            sku &&
            price !== null
        ) {
            priceUpdateMap.set(
                sku,
                price
            )
        }

        if (handle) {
            targetHandles.add(handle)
        }
    })

    if (!targetHandles.size) {
        return []
    }

    const indexes =
        buildShopifyIndexes(
            shopifyRows,
            skuColumn
        )

    const linkedMetafieldColumns =
        findLinkedMetafieldColumns(
            shopifyRows,
            targetHandles
        )

    const exportColumns = [
        ...BASE_EXPORT_COLUMNS,
        ...linkedMetafieldColumns
    ]

    const emittedHandles =
        new Set()

    return shopifyRows
        .filter(row => {
            const handle =
                normalizeText(row.Handle)

            const sku =
                normalizeSku(
                    row[skuColumn]
                )

            // 只輸出目標商品的 Variant 列。
            //
            // Variant Image 刻意不輸出，
            // 避免 Shopify 匯入時要求圖片原始來源。
            return (
                handle &&
                sku &&
                targetHandles.has(handle)
            )
        })

        .map(row => {
            const handle =
                normalizeText(row.Handle)

            const sku =
                normalizeSku(
                    row[skuColumn]
                )

            const meta =
                indexes
                    .productMetaByHandle
                    .get(handle) ||
                {}

            const firstRowForHandle =
                !emittedHandles.has(handle)

            if (firstRowForHandle) {
                emittedHandles.add(handle)
            }

            const promotionPrice =
                priceUpdateMap.get(sku)

            const variantPrice =
                promotionPrice === undefined
                    ? row['Variant Price'] ?? ''
                    : formatShopifyPrice(
                        promotionPrice
                    )

            const sourceRow = {
                ...row,

                Handle:
                handle,

                Title:
                    firstRowForHandle
                        ? (
                            meta.title ||
                            normalizeText(
                                row.Title
                            )
                        )
                        : '',

                Tags:
                    firstRowForHandle
                        ? mergeTags(
                            meta.tags,
                            addedTags
                        )
                        : '',

                'Variant SKU':
                    row[skuColumn] ?? '',

                'Variant Price':
                variantPrice,

                // Compare At Price 視為公司 RRP。
                // START 時完全保留 Shopify 原值。
                'Variant Compare At Price':
                    row[
                        'Variant Compare At Price'
                        ] ?? ''
            }

            return pickExportColumns(
                sourceRow,
                exportColumns
            )
        })
}

/**
 * END
 *
 * 活動結束時使用。
 *
 * 輸入資料應為：
 * 活動結束後從 Shopify 重新匯出的最新商品 CSV。
 *
 * 建議先利用活動 Tag，
 * 在 Shopify 找出本次活動商品再匯出。
 *
 * - Variant Price：
 *   複製 Variant Compare At Price
 *
 * - Variant Compare At Price：
 *   保持不變
 *
 * - Tags：
 *   移除指定活動 Tag
 *
 * - Variant Inventory Qty：
 *   使用活動結束當下最新值
 *
 * - Variant Image：
 *   不輸出
 */
export function buildShopifyPromotionEndRows({
                                                 shopifyRows,
                                                 removedTags = [],
                                                 skuColumn = 'Variant SKU'
                                             }) {
    const targetHandles =
        new Set(
            shopifyRows
                .map(row =>
                    normalizeText(
                        row.Handle
                    )
                )
                .filter(Boolean)
        )

    if (!targetHandles.size) {
        return []
    }

    const indexes =
        buildShopifyIndexes(
            shopifyRows,
            skuColumn
        )

    const linkedMetafieldColumns =
        findLinkedMetafieldColumns(
            shopifyRows,
            targetHandles
        )

    const exportColumns = [
        ...BASE_EXPORT_COLUMNS,
        ...linkedMetafieldColumns
    ]

    const emittedHandles =
        new Set()

    return shopifyRows
        .filter(row => {
            const handle =
                normalizeText(row.Handle)

            const sku =
                normalizeSku(
                    row[skuColumn]
                )

            return (
                handle &&
                sku
            )
        })

        .map(row => {
            const handle =
                normalizeText(row.Handle)

            const meta =
                indexes
                    .productMetaByHandle
                    .get(handle) ||
                {}

            const firstRowForHandle =
                !emittedHandles.has(handle)

            if (firstRowForHandle) {
                emittedHandles.add(handle)
            }

            const compareAtPrice =
                normalizePrice(
                    row[
                        'Variant Compare At Price'
                        ]
                )

            /**
             * 有有效 RRP 才恢復售價。
             *
             * 如果 Compare At Price 是空白，
             * 不要把 Variant Price 洗成空值。
             */
            const variantPrice =
                compareAtPrice === null
                    ? row['Variant Price'] ?? ''
                    : formatShopifyPrice(
                        compareAtPrice
                    )

            const sourceRow = {
                ...row,

                Handle:
                handle,

                Title:
                    firstRowForHandle
                        ? (
                            meta.title ||
                            normalizeText(
                                row.Title
                            )
                        )
                        : '',

                Tags:
                    firstRowForHandle
                        ? removeTags(
                            meta.tags,
                            removedTags
                        )
                        : '',

                'Variant SKU':
                    row[skuColumn] ?? '',

                'Variant Price':
                variantPrice,

                // RRP 保持不動。
                'Variant Compare At Price':
                    row[
                        'Variant Compare At Price'
                        ] ?? ''
            }

            return pickExportColumns(
                sourceRow,
                exportColumns
            )
        })
}

export function buildPromotionIssueRows(
    compareResults
) {
    return compareResults
        .filter(
            item =>
                item.status !== 'ready'
        )

        .map(item => ({
            '活動工作表':
            item.sourceSheet,

            'SKU':
            item.sku,

            'Promotion商品名稱':
            item.name,

            '折扣區段':
            item.discountLabel,

            'RetailPrice':
                item.retailPrice ?? '',

            'PromotionPrice':
                item.promotionPrice ?? '',

            'ShopifyHandle':
                item.handle ||
                (
                    item.handles ||
                    []
                ).join(' / '),

            'Shopify商品名稱':
                item.shopifyTitle ||
                (
                    item.products ||
                    []
                )
                    .map(
                        p =>
                            p?.title
                    )
                    .filter(Boolean)
                    .join(' / '),

            'Published':
                item.published ||
                (
                    item.products ||
                    []
                )
                    .map(
                        p =>
                            p?.published
                    )
                    .filter(Boolean)
                    .join(' / '),

            'Status':
                item.shopifyStatus ||
                (
                    item.products ||
                    []
                )
                    .map(
                        p =>
                            p?.status
                    )
                    .filter(Boolean)
                    .join(' / '),

            '問題':
            item.statusLabel,

            '備註':
            item.note
        }))
}