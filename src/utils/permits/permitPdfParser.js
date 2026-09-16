import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString()

export async function extractPdfText(file) {
    const arrayBuffer = await file.arrayBuffer()

    const pdf = await pdfjsLib.getDocument({
        data: arrayBuffer
    }).promise

    const pageTexts = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber)
        const textContent = await page.getTextContent()

        const text = textContent.items
            .map((item) => item.str)
            .join(' ')

        pageTexts.push(text)
    }

    return {
        pageCount: pdf.numPages,
        pages: pageTexts,
        fullText: pageTexts.join('\n')
    }
}

function normalizePdfText(value) {
    return String(value ?? '')
        .replace(/年/g, '年')
        .replace(/類/g, '類')
        .replace(/零/g, '零')
        .replace(/不/g, '不')
        .replace(/陸/g, '陸')
        .replace(/理/g, '理')
        .replace(/聯/g, '聯')
        .replace(/見/g, '見')
        .replace(/路/g, '路')
        .replace(/樓/g, '樓')
        .replace(/丹/g, '丹')
        .replace(/行/g, '行')
        .replace(/列/g, '列')

        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim()
}

function extractFirst(text, pattern) {
    const match = text.match(pattern)
    return match?.[1]?.trim() ?? ''
}

function rocDateToIso(rocYear, month, day) {
    const year = Number(rocYear) + 1911

    return [
        year,
        String(month).padStart(2, '0'),
        String(day).padStart(2, '0')
    ].join('-')
}

function parsePermitHeader(text) {
    const certificateNo = extractFirst(
        text,
        /同意書簽審核准文號\s*\(Certificate No\.\)\s*([A-Z0-9-]+)/
    )

    const issueDateMatch = text.match(
        /核准日期\s*\(Issue Date\)\s*中華民國(\d+)年(\d+)月(\d+)日/
    )

    const expirationDateMatch = text.match(
        /有效日期\s*\(Expiration Date\)\s*中華民國(\d+)年(\d+)月(\d+)日/
    )

    const goodsType = extractFirst(
        text,
        /貨物\(貨品\)類別\s*\(Goods Type\)\s*(.*?)\s*目的地國家/
    )

    const applicant = extractFirst(
        text,
        /申請人名稱\s*\(Applicant\)\s*(.*?)\s*統一編號/
    )

    return {
        certificateNo,

        issueDate: issueDateMatch
            ? rocDateToIso(
                issueDateMatch[1],
                issueDateMatch[2],
                issueDateMatch[3]
            )
            : '',

        expirationDate: expirationDateMatch
            ? rocDateToIso(
                expirationDateMatch[1],
                expirationDateMatch[2],
                expirationDateMatch[3]
            )
            : '',

        goodsType,
        applicant
    }
}

function parsePermitItems(text) {
    /**
     * 每筆商品的基本結構：
     *
     * 項次 (Item)
     * 貨品分類號列 (C.C.C.Code) ...
     * 生產國別 (Country) ...
     * 貨品名稱 (NP Goods Name) ...
     * 1001
     * 牌名(Brand) ...
     * 型號(Model) ...
     * 審核結果 ...
     */

    const itemBlocks = text.split(/項次\s*\(Item\)/i).slice(1)

    const items = []

    for (const block of itemBlocks) {
        const itemNoMatch = block.match(
            /貨品名稱\s*\(NP Goods Name\)\s*[\s\S]*?\s(\d+)\s+牌名\(Brand\)/
        )

        const itemNo = itemNoMatch?.[1]?.trim() ?? ''

        if (!itemNo) {
            continue
        }

        const cccCode = extractFirst(
            block,
            /貨品分類號列\s*\(C\.C\.C\.Code\)\s*([0-9]+)/
        )

        const country = extractFirst(
            block,
            /生產國別\s*\(Country\)\s*(.*?)\s*貨品名稱/
        )

        const goodsName = extractFirst(
            block,
            /貨品名稱\s*\(NP Goods Name\)\s*([\s\S]*?)\s+\d+\s+牌名\(Brand\)/
        )

        const brand = extractFirst(
            block,
            /牌名\(Brand\)\s*(.*?)\s*型號\(Model\)/
        )

        const model = extractFirst(
            block,
            /型號\(Model\)\s*(.*?)\s*審核結果/
        )

        const reviewResult = extractFirst(
            block,
            /審核結果\s*(核發進口同意書|核發不列管證明)/
        )

        items.push({
            itemNo,
            cccCode,
            country,
            brand,
            goodsName,
            model,
            reviewResult
        })
    }

    return items
}

export function parsePermitDocument(rawText, applicationNo = '') {
    const text = normalizePdfText(rawText)

    const document = parsePermitHeader(text)
    const items = parsePermitItems(text)

    return {
        applicationNo: String(applicationNo ?? '').trim(),

        ...document,

        items,

        summary: {
            itemCount: items.length
        }
    }
}

export function validatePermitData(data) {
    const errors = []

    if (!data.applicationNo) {
        errors.push('缺少申辦案號')
    }

    if (!/^\d{12}$/.test(data.applicationNo)) {
        errors.push('申辦案號格式不正確')
    }

    if (!data.certificateNo) {
        errors.push('缺少簽審核准文號')
    }

    if (!data.issueDate) {
        errors.push('缺少核准日期')
    }

    if (!data.expirationDate) {
        errors.push('缺少有效日期')
    }

    if (!data.goodsType) {
        errors.push('缺少貨品類別')
    }

    if (!data.applicant) {
        errors.push('缺少申請人')
    }

    if (!Array.isArray(data.items) || data.items.length === 0) {
        errors.push('未解析到任何商品明細')
    }

    data.items.forEach((item, index) => {
        const label = `第 ${index + 1} 筆商品`

        if (!item.itemNo) {
            errors.push(`${label}缺少 Item`)
        }

        if (!item.cccCode) {
            errors.push(`${label}缺少 C.C.C. Code`)
        }

        if (!item.country) {
            errors.push(`${label}缺少生產國別`)
        }

        if (!item.brand) {
            errors.push(`${label}缺少廠牌`)
        }

        if (!item.goodsName) {
            errors.push(`${label}缺少貨品名稱`)
        }

        if (!item.model) {
            errors.push(`${label}缺少型號`)
        }

        if (!item.reviewResult) {
            errors.push(`${label}缺少審核結果`)
        }
    })

    return {
        isValid: errors.length === 0,
        errors
    }
}