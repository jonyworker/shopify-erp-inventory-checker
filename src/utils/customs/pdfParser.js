import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { createWorker } from 'tesseract.js'
import { dedupeRows, parseDeclarationPage } from './declarationParser'
import { validateDeclarationRows } from './declarationValidator'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

function textItemsToLines(items) {
  const positioned = items
    .filter(item => String(item.str ?? '').trim())
    .map(item => ({
      text: String(item.str).trim(),
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }))
    .sort((a, b) => {
      const yDiff = b.y - a.y
      if (Math.abs(yDiff) > 2.2) return yDiff
      return a.x - b.x
    })

  const lines = []
  for (const item of positioned) {
    // 文字型報單的同一視覺列可能有極小的 Y 誤差。
    // 2.2pt 可把同列欄位合起來，又不至於大量吃掉相鄰列。
    const target = lines.find(line => Math.abs(line.y - item.y) <= 2.2)
    if (target) target.items.push(item)
    else lines.push({ y: item.y, items: [item] })
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map(line => line.items
      .sort((a, b) => a.x - b.x)
      .map(item => item.text)
      .join(' '))
    .join('\n')
}

async function renderPageToCanvas(page, scale = 4.2) {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvasContext: context, viewport }).promise
  return canvas
}

function preprocessCanvasForOcr(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = imageData.data

  // 這批掃描報單的字很細，而且紙張背景並不是純白。
  // 舊版把 >205 的像素直接洗成白色，會把細筆畫一起擦掉，造成 OCR 只剩幾行文字。
  // 這裡改成「溫和灰階 + 小幅對比」，保留灰色筆畫，不做硬閾值二值化。
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = (pixels[i] * 0.299) + (pixels[i + 1] * 0.587) + (pixels[i + 2] * 0.114)
    const contrasted = Math.max(0, Math.min(255, ((gray - 128) * 1.18) + 128))
    pixels[i] = contrasted
    pixels[i + 1] = contrasted
    pixels[i + 2] = contrasted
  }

  context.putImageData(imageData, 0, 0)
  return canvas
}

async function createOcrWorker(onProgress) {
  const worker = await createWorker('eng+chi_tra', 1, {
    logger: message => {
      if (message.status === 'recognizing text') {
        onProgress?.(message.progress ?? 0)
      }
    },
  })

  // 海關報單屬於密集表格。預設 Auto PSM 很容易只抓到零星文字；
  // SINGLE_BLOCK(6) 對這批掃描報單穩定很多，並保留欄位間空白。
  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    preserve_interword_spaces: '1',
  })

  return worker
}

function ocrSignalScore(text) {
  const source = String(text ?? '')
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const itemStarts = lines.filter(line => /^\d{1,4}(?:\s|$)/.test(line)).length
  const hsCodes = (source.match(/\d{4}\s*\.\s*\d{2}\s*\.\s*\d{2}\s*\.\s*\d{2}\s*-\s*\d/g) || []).length
  const skuLike = lines.filter(line => /\b[A-Z]{2,}[A-Z0-9._\/-]*\d[A-Z0-9._\/-]*\b/i.test(line)).length
  return (itemStarts * 12) + (hsCodes * 18) + (skuLike * 4) + Math.min(lines.length, 120)
}

async function recognizeScannedPage(worker, page) {
  const canvas = await renderPageToCanvas(page, 4.2)
  preprocessCanvasForOcr(canvas)

  // PSM 6 適合整張密集表格，正常情況下可以保留「項次 + SKU + HS CODE」的列關係。
  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    preserve_interword_spaces: '1',
  })
  const blockResult = await worker.recognize(canvas)
  const blockText = blockResult.data.text || ''

  // 某些掃描頁因表格線太重，PSM 6 會只辨識出 2~10 行。
  // 若訊號太少，再用 Sparse Text (PSM 11) 重跑一次，讓項次 / SKU / HS CODE 分開被抓出來。
  const blockLines = blockText.split(/\r?\n/).map(line => line.trim()).filter(Boolean).length
  if (blockLines >= 18 && ocrSignalScore(blockText) >= 45) return blockText

  await worker.setParameters({
    tessedit_pageseg_mode: '11',
    preserve_interword_spaces: '1',
  })
  const sparseResult = await worker.recognize(canvas)
  const sparseText = sparseResult.data.text || ''

  return ocrSignalScore(sparseText) > ocrSignalScore(blockText)
    ? sparseText
    : blockText
}

export async function parseDeclarationPdf(file, options = {}) {
  const {
    forceOcr = false,
    onPageStart,
    onPageProgress,
    onPageComplete,
  } = options

  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  let ocrWorker = null
  let inheritedReportNo = ''
  const allRows = []
  const pageResults = []

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onPageStart?.({ pageNumber, totalPages: pdf.numPages })
      const page = await pdf.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const nativeText = textItemsToLines(textContent.items)
      const nativeCharCount = nativeText.replace(/\s/g, '').length
      const shouldOcr = forceOcr || nativeCharCount < 80
      let text = nativeText
      let mode = 'text'

      if (shouldOcr) {
        mode = 'ocr'
        if (!ocrWorker) {
          ocrWorker = await createOcrWorker(progress => {
            onPageProgress?.({ pageNumber, totalPages: pdf.numPages, progress })
          })
        }
        text = await recognizeScannedPage(ocrWorker, page)
      }

      let parsed = parseDeclarationPage({
        text,
        pageNumber,
        reportNo: inheritedReportNo,
      })

      // 有文字層但抓不到品項時，不立刻宣告失敗。
      // 這通常代表 PDF 文字層排序特殊，改以 OCR 作為第二條保險路徑。
      let fallbackOcrUsed = false
      if (!forceOcr && mode === 'text' && parsed.rows.length === 0 && nativeCharCount >= 80) {
        if (!ocrWorker) {
          ocrWorker = await createOcrWorker(progress => {
            onPageProgress?.({ pageNumber, totalPages: pdf.numPages, progress })
          })
        }
        const ocrText = await recognizeScannedPage(ocrWorker, page)
        const ocrParsed = parseDeclarationPage({
          text: ocrText,
          pageNumber,
          reportNo: parsed.reportNo || inheritedReportNo,
        })
        if (ocrParsed.rows.length > parsed.rows.length) {
          parsed = ocrParsed
          text = ocrText
          mode = 'ocr-fallback'
          fallbackOcrUsed = true
        }
      }

      if (parsed.reportNo) inheritedReportNo = parsed.reportNo
      allRows.push(...parsed.rows)
      pageResults.push({
        pageNumber,
        mode,
        fallbackOcrUsed,
        reportNo: parsed.reportNo,
        rowCount: parsed.rows.length,
        textLength: text.length,
        nativeCharCount,
        nativeTextItemCount: textContent.items.filter(item => String(item.str ?? '').trim()).length,
        lineCount: parsed.diagnostics?.lineCount ?? 0,
        boundaryCount: parsed.diagnostics?.boundaryCount ?? 0,
      })
      onPageComplete?.({ pageNumber, totalPages: pdf.numPages, mode, rowCount: parsed.rows.length })
    }
  } finally {
    if (ocrWorker) await ocrWorker.terminate()
  }

  return {
    totalPages: pdf.numPages,
    pages: pageResults,
    rows: validateDeclarationRows(dedupeRows(allRows)),
  }
}
