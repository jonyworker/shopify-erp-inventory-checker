import {
    AlignmentType,
    BorderStyle,
    Document,
    HeightRule,
    ImageRun,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableLayoutType,
    TableRow,
    TextRun,
    VerticalAlign,
    WidthType
} from 'docx'

import {
    getProductAssets,
    getProductComponentSpecs
} from '@/utils/products/productRepository'


// =========================================================
// Constants
// =========================================================

const TABLE_WIDTH =
    9498

const LEFT_COLUMN_WIDTH =
    2700

const RIGHT_COLUMN_WIDTH =
    6798


// 新細明體
const FONT_NAME =
    'PMingLiU'


// docx 的 size 單位為 half-point。
// 24 = 12 pt
// 28 = 14 pt
const DEFAULT_FONT_SIZE =
    24

const HEADING_FONT_SIZE =
    28


const BORDER = {
    style:
    BorderStyle.SINGLE,

    size:
        4,

    color:
        '000000'
}


const TABLE_BORDERS = {
    top:
    BORDER,

    bottom:
    BORDER,

    left:
    BORDER,

    right:
    BORDER,

    insideHorizontal:
    BORDER,

    insideVertical:
    BORDER
}


const COMPONENT_DEFINITIONS = [
    {
        type:
            'chamber',

        label:
            '槍膛照'
    },

    {
        type:
            'barrel',

        label:
            '槍管照'
    },

    {
        type:
            'magazine_top',

        label:
            '彈匣頂面(或轉輪)照'
    },

    {
        type:
            'slide_internal',

        label:
            '滑套內部照'
    },

    {
        type:
            'bolt',

        label:
            '槍機照'
    }
]


const DOCUMENT_DEFINITIONS = [
    {
        type:
            'certification_statement',

        label:
            '認證標章說明文件'
    },

    {
        type:
            'traditional_chinese_translation',

        label:
            '中文正體字譯本'
    },

    {
        type:
            'energy_report',

        label:
            '動能輸出檢測報告'
    }
]


// =========================================================
// Generate DOCX
// =========================================================

export async function generateApplicationDocx({
                                                  applicationNumber,
                                                  products
                                              }) {
    if (
        !applicationNumber?.trim()
    ) {
        throw new Error(
            '缺少申辦案號'
        )
    }


    if (
        !Array.isArray(products) ||
        products.length === 0
    ) {
        throw new Error(
            '尚未選擇產品'
        )
    }


    // -------------------------------------------------------
    // Step 3 可以自由混排。
    //
    // Word 最後仍分成：
    //
    // (一) 全槍進口
    // (二) 零件進口
    //
    // 同類型產品之間保留使用者原本設定的相對順序。
    // -------------------------------------------------------

    const hydratedProducts = []


    for (
        const product
        of products
        ) {
        hydratedProducts.push(
            await hydrateProduct(
                product
            )
        )
    }


    const gunProducts =
        hydratedProducts.filter(
            product =>
                product.product_type ===
                'gun'
        )


    const partProducts =
        hydratedProducts.filter(
            product =>
                product.product_type ===
                'part'
        )


    const children = [
        createApplicationNumberParagraph(
            applicationNumber
        ),

        createTitleTable()
    ]


    // =======================================================
    // (一) 全槍進口
    // =======================================================

    for (
        let index = 0;
        index < gunProducts.length;
        index++
    ) {
        const product =
            gunProducts[index]


        children.push(
            createGunTable(
                product,
                index + 1,
                {
                    showSectionHeader:
                        index === 0
                }
            )
        )


        children.push(
            createSpacerParagraph()
        )
    }


    // =======================================================
    // (二) 零件進口
    // =======================================================

    for (
        let index = 0;
        index < partProducts.length;
        index++
    ) {
        const product =
            partProducts[index]


        children.push(
            createPartTable(
                product,
                index + 1,
                {
                    showSectionHeader:
                        index === 0
                }
            )
        )


        children.push(
            createSpacerParagraph()
        )
    }


    const doc =
        new Document({
            sections: [
                {
                    properties: {
                        page: {
                            size: {
                                width:
                                    11906,

                                height:
                                    16838
                            },

                            margin: {
                                top:
                                    1134,

                                bottom:
                                    1134,

                                left:
                                    1304,

                                right:
                                    1134
                            }
                        }
                    },

                    children
                }
            ]
        })


    return Packer.toBlob(
        doc
    )
}


// =========================================================
// Download
// =========================================================

export function downloadApplicationDocx(
    blob,
    applicationNumber
) {
    const safeNumber =
        String(
            applicationNumber ??
            ''
        )
            .trim()
            .replace(
                /[\\/:*?"<>|]/g,
                '-'
            )


    const fileName =
        safeNumber
            ? `彙整明細圖片檔案_申辦案號_${safeNumber}.docx`
            : '彙整明細圖片檔案.docx'


    const url =
        URL.createObjectURL(
            blob
        )


    const anchor =
        document.createElement(
            'a'
        )


    anchor.href =
        url

    anchor.download =
        fileName


    document.body.appendChild(
        anchor
    )


    anchor.click()

    anchor.remove()


    window.setTimeout(
        () => {
            URL.revokeObjectURL(
                url
            )
        },
        1000
    )
}


// =========================================================
// Hydrate Product
// =========================================================

async function hydrateProduct(
    product
) {
    const assets =
        await getProductAssets(
            product.id
        )


    const preparedAssets = []


    for (
        const asset
        of assets
        ) {
        preparedAssets.push({
            ...asset,

            wordImage:
                await prepareAssetImage(
                    asset
                )
        })
    }


    let componentSpecs = []


    if (
        product.product_type ===
        'gun'
    ) {
        componentSpecs =
            await getProductComponentSpecs(
                product.id
            )
    }


    return {
        ...product,

        assets:
        preparedAssets,

        componentSpecs
    }
}


// =========================================================
// Application Header
// =========================================================

function createApplicationNumberParagraph(
    applicationNumber
) {
    return new Paragraph({
        alignment:
        AlignmentType.LEFT,

        spacing: {
            after:
                120
        },

        children: [
            createTextRun(
                `申辦案號：${applicationNumber}`
            )
        ]
    })
}


function createTitleTable() {
    return new Table({
        width: {
            size:
            TABLE_WIDTH,

            type:
            WidthType.DXA
        },

        layout:
        TableLayoutType.FIXED,

        borders:
        TABLE_BORDERS,

        rows: [
            new TableRow({
                height: {
                    value:
                        460,

                    rule:
                    HeightRule.ATLEAST
                },

                children: [
                    new TableCell({
                        columnSpan:
                            2,

                        width: {
                            size:
                            TABLE_WIDTH,

                            type:
                            WidthType.DXA
                        },

                        verticalAlign:
                        VerticalAlign.CENTER,

                        margins:
                            createCellMargins(),

                        children: [
                            new Paragraph({
                                alignment:
                                AlignmentType.LEFT,

                                children: [
                                    createTextRun(
                                        '低動能槍枝(零件)輸入申請表彙整明細圖片',
                                        {
                                            bold:
                                                true,

                                            size:
                                            HEADING_FONT_SIZE
                                        }
                                    )
                                ]
                            })
                        ]
                    })
                ]
            })
        ]
    })
}


function createSpacerParagraph() {
    return new Paragraph({
        spacing: {
            after:
                100
        }
    })
}


// =========================================================
// Part Table
// =========================================================

function createPartTable(
    product,
    itemNumber,
    {
        showSectionHeader =
        false
    } = {}
) {
    const rows = []


    if (
        showSectionHeader
    ) {
        rows.push(
            createSectionHeaderRow(
                '(二)零件進口'
            )
        )
    }


    rows.push(
        createProductHeaderRow(
            itemNumber,
            product.name
        )
    )


    rows.push(
        new TableRow({
            height: {
                value:
                    5670,

                rule:
                HeightRule.ATLEAST
            },

            children: [
                createLeftCell(
                    createPartInfoParagraphs(
                        product
                    )
                ),

                createAssetCell(
                    getAssetsByType(
                        product.assets,
                        'main'
                    )
                )
            ]
        })
    )


    return new Table({
        width: {
            size:
            TABLE_WIDTH,

            type:
            WidthType.DXA
        },

        layout:
        TableLayoutType.FIXED,

        borders:
        TABLE_BORDERS,

        rows
    })
}


// =========================================================
// Gun Table
// =========================================================

function createGunTable(
    product,
    itemNumber,
    {
        showSectionHeader =
        false
    } = {}
) {
    const rows = []


    if (
        showSectionHeader
    ) {
        rows.push(
            createSectionHeaderRow(
                '(一)全槍進口'
            )
        )
    }


    rows.push(
        createProductHeaderRow(
            itemNumber,
            product.name
        )
    )


    // -------------------------------------------------------
    // Full Gun
    // -------------------------------------------------------

    rows.push(
        createAssetRow({
            label:
                '全槍照',

            assets:
                getAssetsByType(
                    product.assets,
                    'full_gun'
                ),

            minHeight:
                2250
        })
    )


    // -------------------------------------------------------
    // Components
    // -------------------------------------------------------

    for (
        const component
        of COMPONENT_DEFINITIONS
        ) {
        const spec =
            getComponentSpec(
                product.componentSpecs,
                component.type
            )


        rows.push(
            createAssetRow({
                label:
                component.label,

                materialStatus:
                    spec
                        ?.material_status ??
                    null,

                note:
                    spec?.note ??
                    '',

                assets:
                    getAssetsByType(
                        product.assets,
                        component.type
                    ),

                minHeight:
                    2500
            })
        )
    }


    // -------------------------------------------------------
    // Exploded Diagram
    // -------------------------------------------------------

    rows.push(
        createAssetRow({
            label:
                '爆炸結構圖',

            assets:
                getAssetsByType(
                    product.assets,
                    'exploded_diagram'
                ),

            minHeight:
                3000
        })
    )


    // -------------------------------------------------------
    // Application Documents
    // -------------------------------------------------------

    for (
        const definition
        of DOCUMENT_DEFINITIONS
        ) {
        rows.push(
            createAssetRow({
                label:
                definition.label,

                assets:
                    getAssetsByType(
                        product.assets,
                        definition.type
                    ),

                minHeight:
                    2600,

                showDocumentName:
                    true
            })
        )
    }


    return new Table({
        width: {
            size:
            TABLE_WIDTH,

            type:
            WidthType.DXA
        },

        layout:
        TableLayoutType.FIXED,

        borders:
        TABLE_BORDERS,

        rows
    })
}


// =========================================================
// Rows
// =========================================================

function createSectionHeaderRow(
    text
) {
    return new TableRow({
        height: {
            value:
                520,

            rule:
            HeightRule.ATLEAST
        },

        children: [
            new TableCell({
                columnSpan:
                    2,

                width: {
                    size:
                    TABLE_WIDTH,

                    type:
                    WidthType.DXA
                },

                verticalAlign:
                VerticalAlign.CENTER,

                margins:
                    createCellMargins(),

                children: [
                    new Paragraph({
                        alignment:
                        AlignmentType.LEFT,

                        children: [
                            createTextRun(
                                text,
                                {
                                    bold:
                                        true,

                                    size:
                                    HEADING_FONT_SIZE
                                }
                            )
                        ]
                    })
                ]
            })
        ]
    })
}


function createProductHeaderRow(
    itemNumber,
    productName
) {
    return new TableRow({
        height: {
            value:
                500,

            rule:
            HeightRule.ATLEAST
        },

        children: [
            createLeftCell([
                new Paragraph({
                    alignment:
                    AlignmentType.LEFT,

                    children: [
                        createTextRun(
                            `項次：${itemNumber}`
                        )
                    ]
                }),

                new Paragraph({
                    alignment:
                    AlignmentType.LEFT,

                    children: [
                        createTextRun(
                            `品名：${productName}`
                        )
                    ]
                })
            ]),

            createRightCell([
                new Paragraph({
                    alignment:
                    AlignmentType.LEFT,

                    children: [
                        createTextRun(
                            '照片',
                            {
                                bold:
                                    true
                            }
                        )
                    ]
                })
            ])
        ]
    })
}


function createAssetRow({
                            label,
                            materialStatus = null,
                            note = '',
                            assets = [],
                            minHeight = 2200,
                            showDocumentName = false
                        }) {
    const isNotApplicable =
        materialStatus ===
        'not_applicable'


    // -------------------------------------------------------
    // Left Column
    // -------------------------------------------------------

    const leftParagraphs = [
        new Paragraph({
            alignment:
            AlignmentType.LEFT,

            children: [
                createTextRun(
                    label,
                    {
                        bold:
                            true
                    }
                )
            ]
        })
    ]


    if (
        materialStatus !==
        null
    ) {
        leftParagraphs.push(
            new Paragraph({
                alignment:
                AlignmentType.LEFT,

                spacing: {
                    before:
                        100
                },

                children: [
                    createTextRun(
                        `金屬材質：${getMaterialStatusText(
                            materialStatus
                        )}`
                    )
                ]
            })
        )
    }


    if (
        !isNotApplicable &&
        note?.trim()
    ) {
        leftParagraphs.push(
            new Paragraph({
                alignment:
                AlignmentType.LEFT,

                spacing: {
                    before:
                        80
                },

                children: [
                    createTextRun(
                        note.trim()
                    )
                ]
            })
        )
    }


    // -------------------------------------------------------
    // Right Column
    // -------------------------------------------------------

    const rightCell =
        isNotApplicable
            ? createNotApplicableCell(
                note
            )
            : createAssetCell(
                assets,
                {
                    showDocumentName
                }
            )


    return new TableRow({
        height: {
            value:
            minHeight,

            rule:
            HeightRule.ATLEAST
        },

        children: [
            createLeftCell(
                leftParagraphs
            ),

            rightCell
        ]
    })
}


// =========================================================
// Cells
// =========================================================

function createLeftCell(
    children
) {
    return new TableCell({
        width: {
            size:
            LEFT_COLUMN_WIDTH,

            type:
            WidthType.DXA
        },

        verticalAlign:
        VerticalAlign.CENTER,

        margins:
            createCellMargins(),

        children
    })
}


function createRightCell(
    children
) {
    return new TableCell({
        width: {
            size:
            RIGHT_COLUMN_WIDTH,

            type:
            WidthType.DXA
        },

        verticalAlign:
        VerticalAlign.CENTER,

        margins:
            createCellMargins(),

        children
    })
}


function createCellMargins() {
    return {
        top:
            100,

        bottom:
            100,

        left:
            100,

        right:
            100
    }
}


// =========================================================
// Not Applicable Cell
// =========================================================

function createNotApplicableCell(
    note
) {
    const text =
        note?.trim() ||
        '無此部件'


    return createRightCell([
        new Paragraph({
            alignment:
            AlignmentType.LEFT,

            children: [
                createTextRun(
                    text
                )
            ]
        })
    ])
}


// =========================================================
// Asset Cell
// =========================================================

function createAssetCell(
    assets,
    {
        showDocumentName =
        false
    } = {}
) {
    if (
        !assets?.length
    ) {
        return createRightCell([
            new Paragraph({
                alignment:
                AlignmentType.LEFT,

                children: [
                    createTextRun(
                        '尚未上傳',
                        {
                            color:
                                '999999'
                        }
                    )
                ]
            })
        ])
    }


    const paragraphs = []


    for (
        const asset
        of assets
        ) {
        if (
            asset.wordImage
        ) {
            paragraphs.push(
                new Paragraph({
                    alignment:
                    AlignmentType.LEFT,

                    spacing: {
                        after:
                            100
                    },

                    children: [
                        new ImageRun({
                            type:
                            asset
                                .wordImage
                                .type,

                            data:
                            asset
                                .wordImage
                                .data,

                            transformation:
                            asset
                                .wordImage
                                .transformation
                        })
                    ]
                })
            )

            continue
        }


        // 舊資料若仍是 PDF / Word，
        // 暫時顯示檔名。
        if (
            showDocumentName
        ) {
            paragraphs.push(
                new Paragraph({
                    alignment:
                    AlignmentType.LEFT,

                    spacing: {
                        after:
                            80
                    },

                    children: [
                        createTextRun(
                            getAssetDisplayName(
                                asset
                            ),
                            {
                                color:
                                    '666666'
                            }
                        )
                    ]
                })
            )
        }
    }


    if (
        paragraphs.length ===
        0
    ) {
        paragraphs.push(
            new Paragraph({
                alignment:
                AlignmentType.LEFT,

                children: [
                    createTextRun(
                        '無法顯示檔案',
                        {
                            color:
                                '999999'
                        }
                    )
                ]
            })
        )
    }


    return createRightCell(
        paragraphs
    )
}


// =========================================================
// Part Information
// =========================================================

function createPartInfoParagraphs(
    product
) {
    const categories = [
        {
            key:
                'body',

            label:
                '槍身'
        },

        {
            key:
                'slide',

            label:
                '滑套'
        },

        {
            key:
                'barrel',

            label:
                '槍管'
        },

        {
            key:
                'magazine',

            label:
                '彈匣'
        },

        {
            key:
                'bolt',

            label:
                '槍機'
        }
    ]


    const paragraphs = [
        new Paragraph({
            alignment:
            AlignmentType.LEFT,

            children: [
                createTextRun(
                    '零件種類',
                    {
                        bold:
                            true
                    }
                )
            ]
        })
    ]


    for (
        const category
        of categories
        ) {
        const isSelected =
            product.part_category ===
            category.key


        paragraphs.push(
            new Paragraph({
                alignment:
                AlignmentType.LEFT,

                children: [
                    createCheckboxRun(
                        isSelected
                    ),

                    createTextRun(
                        category.label
                    )
                ]
            })
        )
    }


    const isOther =
        product.part_category ===
        'other'


    const otherChildren = [
        createCheckboxRun(
            isOther
        ),

        createTextRun(
            isOther &&
            product
                .part_category_other
                ?.trim()
                ? '其他_'
                : '其他'
        )
    ]


    if (
        isOther &&
        product
            .part_category_other
            ?.trim()
    ) {
        otherChildren.push(
            createTextRun(
                ` ${
                    product
                        .part_category_other
                        .trim()
                }`
            )
        )
    }


    paragraphs.push(
        new Paragraph({
            alignment:
            AlignmentType.LEFT,

            children:
            otherChildren
        })
    )


    paragraphs.push(
        new Paragraph({
            alignment:
            AlignmentType.LEFT,

            spacing: {
                before:
                    200
            },

            children:
                createMaterialCheckboxRuns(
                    product.part_is_metal
                )
        })
    )


    return paragraphs
}


// =========================================================
// Component
// =========================================================

function getComponentSpec(
    specs,
    componentType
) {
    return (
        specs.find(
            spec =>
                spec.component_type ===
                componentType
        ) ??
        null
    )
}


// =========================================================
// Checkboxes
// =========================================================

// 方塊與一般文字共用相同字型與 12 pt。
// 避免方塊在 Word 中比旁邊文字明顯大一圈。

function createCheckboxRun(
    checked
) {
    return createTextRun(
        checked
            ? '■'
            : '□',
        {
            size:
            DEFAULT_FONT_SIZE
        }
    )
}


function createMaterialCheckboxRuns(
    value
) {
    return [
        createTextRun(
            '金屬材質：'
        ),

        createCheckboxRun(
            value === true
        ),

        createTextRun(
            '是 '
        ),

        createCheckboxRun(
            value === false
        ),

        createTextRun(
            '否'
        )
    ]
}


function createComponentMaterialCheckboxRuns(
    status
) {
    return [
        createTextRun(
            '金屬材質：'
        ),

        createCheckboxRun(
            status ===
            'metal'
        ),

        createTextRun(
            '是 '
        ),

        createCheckboxRun(
            status ===
            'non_metal'
        ),

        createTextRun(
            '否'
        )
    ]
}


// =========================================================
// Material Labels
// =========================================================

function getMaterialStatusText(
    status
) {
    if (
        status ===
        'metal'
    ) {
        return '■是/□否'
    }


    if (
        status ===
        'non_metal'
    ) {
        return '□是/■否'
    }


    return '□是/□否'
}


// =========================================================
// Assets
// =========================================================

function getAssetsByType(
    assets,
    type
) {
    return (
        assets
            ?.filter(
                asset =>
                    asset.asset_type ===
                    type
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    a.sort_order -
                    b.sort_order
            ) ??
        []
    )
}


function isImageAsset(
    asset
) {
    const mime =
        String(
            asset.mime_type ??
            ''
        )
            .toLowerCase()


    if (
        mime.startsWith(
            'image/'
        )
    ) {
        return true
    }


    const path =
        String(
            asset.file_path ??
            ''
        )
            .toLowerCase()


    return (
        path.endsWith('.jpg') ||
        path.endsWith('.jpeg') ||
        path.endsWith('.png')
    )
}


// =========================================================
// Prepare Image
// =========================================================

async function prepareAssetImage(
    asset
) {
    if (
        !isImageAsset(
            asset
        ) ||
        !asset.preview_url
    ) {
        return null
    }


    try {
        const response =
            await fetch(
                asset.preview_url
            )


        if (
            !response.ok
        ) {
            throw new Error(
                `HTTP ${response.status}`
            )
        }


        const blob =
            await response.blob()


        const dimensions =
            await getImageDimensions(
                blob
            )


        return {
            type:
                getDocxImageType(
                    blob.type,
                    asset.file_path
                ),

            data:
                new Uint8Array(
                    await blob.arrayBuffer()
                ),

            transformation:
                fitImage(
                    dimensions.width,
                    dimensions.height
                )
        }
    } catch (error) {
        console.error(
            '準備 Word 圖片失敗',
            asset,
            error
        )

        return null
    }
}


// =========================================================
// Image Dimensions
// =========================================================

async function getImageDimensions(
    blob
) {
    if (
        typeof createImageBitmap ===
        'function'
    ) {
        const bitmap =
            await createImageBitmap(
                blob
            )


        const dimensions = {
            width:
            bitmap.width,

            height:
            bitmap.height
        }


        bitmap.close()


        return dimensions
    }


    return new Promise(
        (
            resolve,
            reject
        ) => {
            const url =
                URL.createObjectURL(
                    blob
                )


            const image =
                new Image()


            image.onload =
                () => {
                    resolve({
                        width:
                        image.naturalWidth,

                        height:
                        image.naturalHeight
                    })


                    URL.revokeObjectURL(
                        url
                    )
                }


            image.onerror =
                () => {
                    URL.revokeObjectURL(
                        url
                    )


                    reject(
                        new Error(
                            '無法取得圖片尺寸'
                        )
                    )
                }


            image.src =
                url
        }
    )
}


// =========================================================
// Image Fit
// =========================================================

function fitImage(
    width,
    height
) {
    const maxWidth =
        430

    const maxHeight =
        500


    if (
        !width ||
        !height
    ) {
        return {
            width:
            maxWidth,

            height:
                300
        }
    }


    const scale =
        Math.min(
            maxWidth /
            width,

            maxHeight /
            height,

            1
        )


    return {
        width:
            Math.max(
                1,
                Math.round(
                    width *
                    scale
                )
            ),

        height:
            Math.max(
                1,
                Math.round(
                    height *
                    scale
                )
            )
    }
}


// =========================================================
// Image Type
// =========================================================

function getDocxImageType(
    mimeType,
    filePath
) {
    if (
        mimeType ===
        'image/png'
    ) {
        return 'png'
    }


    const path =
        String(
            filePath ??
            ''
        )
            .toLowerCase()


    if (
        path.endsWith(
            '.png'
        )
    ) {
        return 'png'
    }


    return 'jpg'
}


// =========================================================
// Asset File Name
// =========================================================

function getAssetDisplayName(
    asset
) {
    return (
        asset.original_file_name ||
        asset.file_path
            ?.split('/')
            .pop() ||
        '已上傳文件'
    )
}


// =========================================================
// Text
// =========================================================

function createTextRun(
    text,
    {
        bold = false,
        color = '000000',
        size = DEFAULT_FONT_SIZE
    } = {}
) {
    return new TextRun({
        text,

        bold,

        color,

        size,

        font: {
            name:
            FONT_NAME,

            ascii:
            FONT_NAME,

            eastAsia:
            FONT_NAME,

            hAnsi:
            FONT_NAME
        }
    })
}