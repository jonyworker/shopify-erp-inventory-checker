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

    if (!cleanedValue) {
        return null
    }

    const numberValue = Number(cleanedValue)

    return Number.isFinite(numberValue)
        ? numberValue
        : null
}

/**
 * 從 Promotion 折扣文字取得 Shopify Tag。
 *
 * 範例：
 *
 * 12% OFF → 12%
 * 20% OFF → 20%
 * 30% OFF → 30%
 * 7.5% OFF → 7.5%
 */
function getDiscountTag(discountLabel) {
    const text = normalizeText(discountLabel)

    if (!text) {
        return ''
    }

    const match = text.match(
        /(\d+(?:\.\d+)?)\s*%/i
    )

    if (!match) {
        return ''
    }

    const percent = Number(match[1])

    if (!Number.isFinite(percent)) {
        return ''
    }

    return `${percent}%`
}

/**
 * Shopify 價格格式統一。
 *
 * 注意：
 * 目前 Promotion START / END
 * 都不會修改價格。
 *
 * 這裡只是在輸出 CSV 時，
 * 保持既有價格欄位格式一致。
 */
function formatShopifyPrice(value) {
    const price = normalizePrice(value)

    return price === null
        ? ''
        : price.toFixed(2)
}

function firstNonEmpty(rows, column) {
    for (const row of rows) {
        const value = normalizeText(
            row[column]
        )

        if (value) {
            return value
        }
    }

    return ''
}

/**
 * 解析 Promotion Excel。
 *
 * 支援香港原版格式：
 *
 * 12% OFF
 * SKU001
 * SKU002
 *
 * 30% OFF
 * SKU003
 * SKU004
 *
 * 也仍保留對舊版自轉 Promotion 的相容性。
 *
 * 注意：
 * Promotion 不再需要 Retail Price
 * 或 Promotion Price 才能使用。
 */
export function parsePromotionRows(rawRows, sheetName) {
    const rows = []

    let headerIndexes = null
    let currentDiscountLabel = ''

    function normalizeHeader(value) {
        return normalizeText(value)
            .replace(/\s+/g, ' ')
            .trim()
    }

    function findColumnIndex(row, patterns) {
        return row.findIndex(cell => {
            const text = normalizeHeader(cell)

            return patterns.some(pattern =>
                pattern.test(text)
            )
        })
    }

    function findDiscountLabel(row) {
        for (const cell of row) {
            const text = normalizeText(cell)

            if (!text) {
                continue
            }

            const match = text.match(
                /(\d+(?:\.\d+)?)\s*%/i
            )

            if (!match) {
                continue
            }

            return `${match[1]}% OFF`
        }

        return ''
    }

    function looksLikeHeader(row) {
        const skuHeaderIndex = findColumnIndex(
            row,
            [
                /^品項編碼$/,
                /^item$/i,
                /^item code$/i,
                /^sku$/i,
                /^product code$/i
            ]
        )

        if (skuHeaderIndex < 0) {
            return null
        }

        return {
            sku: skuHeaderIndex,

            name:
                findColumnIndex(
                    row,
                    [
                        /^品項名稱$/,
                        /^商品名稱$/,
                        /product name/i,
                        /item name/i,
                        /^description$/i
                    ]
                ),

            twg:
                findColumnIndex(
                    row,
                    [
                        /^TWG-/i,
                        /^TWG$/i
                    ]
                ),

            occupy:
                findColumnIndex(
                    row,
                    [
                        /^TWOCY/i,
                        /occupy/i,
                        /交易佔存/,
                        /佔存/
                    ]
                ),

            ruten:
                findColumnIndex(
                    row,
                    [
                        /^TWRT-/i,
                        /^TWRT$/i,
                        /露天/
                    ]
                ),

            steelShop:
                findColumnIndex(
                    row,
                    [
                        /^TWSS-/i,
                        /^TWSS$/i,
                        /STEEL SHOP/i
                    ]
                ),

            retail:
                findColumnIndex(
                    row,
                    [
                        /retail price/i,
                        /零售價/,
                        /建議售價/,
                        /含稅.*價格/
                    ]
                )
        }
    }

    rawRows.forEach((rawRow, index) => {
        const row =
            Array.isArray(rawRow)
                ? rawRow
                : []

        /**
         * 1. 先判斷是不是新表頭。
         *
         * 香港版有時會在同一張工作表中
         * 再出現第二個表頭。
         */
        const detectedHeader =
            looksLikeHeader(row)

        if (detectedHeader) {
            headerIndexes =
                detectedHeader

            /**
             * 如果表頭本身就帶折扣：
             *
             * Retail Price | 12% off
             */
            const headerDiscount =
                findDiscountLabel(row)

            if (headerDiscount) {
                currentDiscountLabel =
                    headerDiscount
            }

            return
        }

        /**
         * 還沒找到 SKU 欄以前，
         * 不處理其他內容。
         */
        if (!headerIndexes) {
            return
        }

        /**
         * 2. 判斷是否出現新的折扣區段。
         *
         * 不限制一定要是：
         *
         * 12% OFF
         *
         * 也接受：
         *
         * VIP 12%
         * Discount 12%
         * 12% Promotion
         */
        const discountLabel =
            findDiscountLabel(row)

        if (discountLabel) {
            const nonEmptyCells =
                row.filter(cell =>
                    normalizeText(cell)
                )

            /**
             * 折扣列通常不是正常商品資料列。
             *
             * 這裡用「內容欄位數少」作為保守判斷，
             * 避免商品名稱中偶然出現 % 被誤判。
             */
            if (nonEmptyCells.length <= 3) {
                currentDiscountLabel =
                    discountLabel

                return
            }
        }

        /**
         * 3. 一般商品資料列。
         */
        const sku =
            normalizeSku(
                row[
                    headerIndexes.sku
                    ]
            )

        if (!sku) {
            return
        }

        /**
         * 沒有折扣資訊的 SKU，
         * 不納入 Promotion。
         */
        if (!currentDiscountLabel) {
            return
        }

        const retailPrice =
            headerIndexes.retail >= 0
                ? normalizePrice(
                    row[
                        headerIndexes.retail
                        ]
                )
                : null

        rows.push({
            sku,

            name:
                headerIndexes.name >= 0
                    ? normalizeText(
                        row[
                            headerIndexes.name
                            ]
                    )
                    : '',

            twgStock:
                headerIndexes.twg >= 0
                    ? normalizeText(
                        row[
                            headerIndexes.twg
                            ]
                    )
                    : '',

            occupyStock:
                headerIndexes.occupy >= 0
                    ? normalizeText(
                        row[
                            headerIndexes.occupy
                            ]
                    )
                    : '',

            rutenStock:
                headerIndexes.ruten >= 0
                    ? normalizeText(
                        row[
                            headerIndexes.ruten
                            ]
                    )
                    : '',

            steelShopStock:
                headerIndexes.steelShop >= 0
                    ? normalizeText(
                        row[
                            headerIndexes.steelShop
                            ]
                    )
                    : '',

            /**
             * 舊格式相容用。
             *
             * 現在不會拿這個值去改 Shopify 價格。
             */
            retailPrice,

            discountLabel:
            currentDiscountLabel,

            discountTag:
                getDiscountTag(
                    currentDiscountLabel
                ),

            sourceSheet:
            sheetName,

            sourceRow:
                index + 1
        })
    })

    return rows
}

export async function parsePromotionWorkbook(file) {
    const data =
        await file.arrayBuffer()

    const workbook =
        XLSX.read(
            data,
            {
                type: 'array'
            }
        )

    const sheets =
        workbook.SheetNames
            .map(
                sheetName => {
                    const worksheet =
                        workbook.Sheets[
                            sheetName
                            ]

                    const rawRows =
                        XLSX.utils
                            .sheet_to_json(
                                worksheet,
                                {
                                    header: 1,
                                    defval: '',
                                    raw: false
                                }
                            )

                    return {
                        name:
                        sheetName,

                        rows:
                            parsePromotionRows(
                                rawRows,
                                sheetName
                            )
                    }
                }
            )
            .filter(
                sheet =>
                    sheet.rows.length
            )

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
    const rowsByHandle =
        new Map()

    const rowsBySku =
        new Map()

    shopifyRows.forEach(
        (row, index) => {
            const handle =
                normalizeText(
                    row.Handle
                )

            const sku =
                normalizeSku(
                    row[
                        skuColumn
                        ]
                )

            const indexedRow = {
                row,
                index,
                handle,
                sku
            }

            if (handle) {
                if (
                    !rowsByHandle.has(
                        handle
                    )
                ) {
                    rowsByHandle.set(
                        handle,
                        []
                    )
                }

                rowsByHandle
                    .get(handle)
                    .push(
                        indexedRow
                    )
            }

            if (sku) {
                if (
                    !rowsBySku.has(
                        sku
                    )
                ) {
                    rowsBySku.set(
                        sku,
                        []
                    )
                }

                rowsBySku
                    .get(sku)
                    .push(
                        indexedRow
                    )
            }
        }
    )

    const productMetaByHandle =
        new Map()

    rowsByHandle.forEach(
        (
            indexedRows,
            handle
        ) => {
            const sourceRows =
                indexedRows.map(
                    item =>
                        item.row
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
        normalizeText(
            meta?.published
        ).toLowerCase() ===
        'true' &&

        normalizeText(
            meta?.status
        ).toLowerCase() ===
        'active'
    )
}

/**
 * Promotion SKU 與 Shopify All Product 比對。
 *
 * 注意：
 *
 * 現在只負責：
 *
 * - SKU 是否存在
 * - 是否重複
 * - 商品是否正常上架
 * - 對應 Handle
 * - 取得 Shopify 原始價格供畫面參考
 *
 * 不再計算或決定 Promotion 售價。
 */
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

    promotionRows.forEach(
        item => {
            const sku =
                normalizeSku(
                    item.sku
                )

            if (!sku) {
                return
            }

            promotionSkuCount.set(
                sku,
                (
                    promotionSkuCount
                        .get(sku) ||
                    0
                ) + 1
            )
        }
    )

    const results =
        promotionRows.map(
            item => {
                const sku =
                    normalizeSku(
                        item.sku
                    )

                const matches =
                    indexes
                        .rowsBySku
                        .get(sku) ||
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
                        promotionSkuCount
                            .get(sku) ||
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
                            '同一活動資料內有重複 SKU，請先確認 Promotion 資料。',

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
                        handles.map(
                            handle =>
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
                            match.handle ===
                            handle
                    )?.row ||
                    {}

                const publishedActive =
                    isPublishedActive(
                        meta
                    )

                return {
                    ...item,
                    sku,
                    handle,

                    shopifyTitle:
                        meta.title ||
                        normalizeText(
                            variantRow.Title
                        ),

                    /**
                     * 僅供畫面 / 問題報表參考。
                     *
                     * 不會拿來修改售價。
                     */
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
            }
        )

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
    const seen =
        new Set()

    ;[
        ...splitTags(
            existingTags
        ),
        ...(addedTags || [])
    ].forEach(
        rawTag => {
            const tag =
                normalizeText(
                    rawTag
                )

            if (!tag) {
                return
            }

            const key =
                tag.toLocaleLowerCase()

            if (
                seen.has(key)
            ) {
                return
            }

            seen.add(key)
            merged.push(tag)
        }
    )

    return merged.join(', ')
}

export function removeTags(
    existingTags,
    removedTags
) {
    const removed =
        new Set(
            (
                removedTags ||
                []
            )
                .map(
                    tag =>
                        normalizeText(
                            tag
                        )
                            .toLocaleLowerCase()
                )
                .filter(Boolean)
        )

    return splitTags(
        existingTags
    )
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
    const seen =
        new Set()

    shopifyRows.forEach(
        row => {
            Object
                .keys(
                    row || {}
                )
                .forEach(
                    column => {
                        if (
                            seen.has(
                                column
                            )
                        ) {
                            return
                        }

                        seen.add(column)
                        columns.push(column)
                    }
                )
        }
    )

    return columns
}

function findLinkedMetafieldColumns(
    shopifyRows,
    targetHandles
) {
    const shopifyColumns =
        getShopifyColumns(
            shopifyRows
        )

    const linkedTargets =
        new Set()

    shopifyRows.forEach(
        row => {
            const handle =
                normalizeText(
                    row.Handle
                )

            if (
                !targetHandles.has(
                    handle
                )
            ) {
                return
            }

            LINKED_TO_COLUMNS.forEach(
                column => {
                    const linkedTo =
                        normalizeText(
                            row[
                                column
                                ]
                        )

                    if (linkedTo) {
                        linkedTargets.add(
                            linkedTo
                        )
                    }
                }
            )
        }
    )

    return shopifyColumns.filter(
        column =>
            [
                ...linkedTargets
            ].some(
                linkedTo =>
                    column.includes(
                        `(${linkedTo})`
                    )
            )
    )
}

/**
 * Shopify CSV 輸出欄位整理。
 *
 * 價格沒有被修改，
 * 只做格式整理。
 */
function pickExportColumns(
    sourceRow,
    exportColumns
) {
    const result = {}

    exportColumns.forEach(
        column => {
            const value =
                sourceRow[
                    column
                    ] ?? ''

            if (
                PRICE_COLUMNS.includes(
                    column
                )
            ) {
                result[column] =
                    formatShopifyPrice(
                        value
                    )

                return
            }

            result[column] =
                value
        }
    )

    return result
}

/**
 * START
 *
 * 活動開始時：
 *
 * ✅ 保留 Variant Price
 * ✅ 保留 Variant Compare At Price
 * ✅ 保留原 Tags
 * ✅ 加入活動 Tag
 * ✅ 自動加入折扣 Tag
 *
 * 例如：
 *
 * 12% OFF
 * → Tag 加入 12%
 *
 * 30% OFF
 * → Tag 加入 30%
 *
 * Promotion 工具不再修改任何商品價格。
 */
export function buildShopifyPromotionImportRows({
                                                    shopifyRows,
                                                    compareResults,
                                                    addedTags = [],
                                                    skuColumn = 'Variant SKU'
                                                }) {
    const eligibleResults =
        compareResults.filter(
            item =>
                item.status ===
                'ready' ||
                item.status ===
                'not-published'
        )

    /**
     * Handle → 折扣 Tag
     */
    const discountTagsByHandle =
        new Map()

    const targetHandles =
        new Set()

    eligibleResults.forEach(
        item => {
            const handle =
                normalizeText(
                    item.handle
                )

            if (!handle) {
                return
            }

            targetHandles.add(handle)

            const discountTag =
                item.discountTag ||
                getDiscountTag(
                    item.discountLabel
                )

            if (!discountTag) {
                return
            }

            if (
                !discountTagsByHandle.has(
                    handle
                )
            ) {
                discountTagsByHandle.set(
                    handle,
                    new Set()
                )
            }

            discountTagsByHandle
                .get(handle)
                .add(discountTag)
        }
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
        .filter(
            row => {
                const handle =
                    normalizeText(
                        row.Handle
                    )

                const sku =
                    normalizeSku(
                        row[
                            skuColumn
                            ]
                    )

                return (
                    handle &&
                    sku &&
                    targetHandles.has(
                        handle
                    )
                )
            }
        )

        .map(
            row => {
                const handle =
                    normalizeText(
                        row.Handle
                    )

                const meta =
                    indexes
                        .productMetaByHandle
                        .get(handle) ||
                    {}

                const firstRowForHandle =
                    !emittedHandles.has(
                        handle
                    )

                if (
                    firstRowForHandle
                ) {
                    emittedHandles.add(
                        handle
                    )
                }

                const discountTags = [
                    ...(
                        discountTagsByHandle
                            .get(handle) ||
                        []
                    )
                ]

                const tagsToAdd = [
                    ...(addedTags || []),
                    ...discountTags
                ]

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
                                tagsToAdd
                            )
                            : '',

                    'Variant SKU':
                        row[
                            skuColumn
                            ] ?? '',

                    /**
                     * 價格完全保留 Shopify 原值。
                     */
                    'Variant Price':
                        row[
                            'Variant Price'
                            ] ?? '',

                    'Variant Compare At Price':
                        row[
                            'Variant Compare At Price'
                            ] ?? ''
                }

                return pickExportColumns(
                    sourceRow,
                    exportColumns
                )
            }
        )
}

/**
 * END
 *
 * 活動結束時：
 *
 * ✅ Variant Price 不動
 * ✅ Variant Compare At Price 不動
 * ✅ 只移除指定 Tag
 *
 * START / END 現在完全對稱：
 *
 * START = 加 Tag
 * END   = 移除 Tag
 */
export function buildShopifyPromotionEndRows({
                                                 shopifyRows,
                                                 removedTags = [],
                                                 skuColumn = 'Variant SKU'
                                             }) {
    const targetHandles =
        new Set(
            shopifyRows
                .map(
                    row =>
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
        .filter(
            row => {
                const handle =
                    normalizeText(
                        row.Handle
                    )

                const sku =
                    normalizeSku(
                        row[
                            skuColumn
                            ]
                    )

                return (
                    handle &&
                    sku
                )
            }
        )

        .map(
            row => {
                const handle =
                    normalizeText(
                        row.Handle
                    )

                const meta =
                    indexes
                        .productMetaByHandle
                        .get(handle) ||
                    {}

                const firstRowForHandle =
                    !emittedHandles.has(
                        handle
                    )

                if (
                    firstRowForHandle
                ) {
                    emittedHandles.add(
                        handle
                    )
                }

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
                        row[
                            skuColumn
                            ] ?? '',

                    /**
                     * END 同樣完全不碰價格。
                     */
                    'Variant Price':
                        row[
                            'Variant Price'
                            ] ?? '',

                    'Variant Compare At Price':
                        row[
                            'Variant Compare At Price'
                            ] ?? ''
                }

                return pickExportColumns(
                    sourceRow,
                    exportColumns
                )
            }
        )
}

export function buildPromotionIssueRows(
    compareResults
) {
    return compareResults
        .filter(
            item =>
                item.status !==
                'ready'
        )

        .map(
            item => ({
                '活動工作表':
                item.sourceSheet,

                'SKU':
                item.sku,

                'Promotion商品名稱':
                item.name,

                '折扣區段':
                item.discountLabel,

                '折扣Tag':
                    item.discountTag || '',

                'ShopifyPrice':
                    item.shopifyPrice ?? '',

                'CompareAtPrice':
                    item.compareAtPrice ?? '',

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
            })
        )
}