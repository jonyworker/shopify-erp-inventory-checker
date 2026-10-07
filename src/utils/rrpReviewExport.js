import * as XLSX from 'xlsx-js-style'

export function buildRrpReviewWorkbook(issues, context = {}) {
  const workbook = XLSX.utils.book_new()
  const headers = ['品項編碼', '問題類型', 'RRP品項名稱', 'ERP品項名稱', 'RRP原廠編碼', 'ERP原廠編碼', 'RRP價格', 'ERP價格', '資料來源', '來源工作表', '來源列號', '來源備註', '建議處理', '香港回覆', '確認價格', '處理狀態']
  const sheet = XLSX.utils.json_to_sheet(issues, { header: headers })
  sheet['!cols'] = headers.map(h => ({ wch: h.includes('名稱') || h === '建議處理' || h === '香港回覆' ? 45 : h === '問題類型' ? 30 : 20 }))
  sheet['!autofilter'] = { ref: sheet['!ref'] }
  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) continue
    const cell = sheet[address]
    const isHeader = XLSX.utils.decode_cell(address).r === 0
    cell.s = { font: { name: 'Microsoft JhengHei', sz: 11, bold: isHeader, color: { rgb: isHeader ? 'FFFFFF' : '0F172A' } }, alignment: { vertical: 'top', wrapText: true }, ...(isHeader ? { fill: { fgColor: { rgb: '334155' } } } : {}) }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, '香港確認清單')
  const notes = [['項目', '說明'], ['RRP來源檔', context.official || ''], ['ERP來源檔', context.erp || ''], ['ERP選取價格欄位', context.priceColumn || ''], ['匯出時間', new Date().toISOString()], ['範圍', '請使用 ERP 品項類型＝商品的匯出資料。本工具不依料號符號排除資料。'], ['問題列數', issues.length], ['讀法', '同料號可能有多列，每列保留一個來源位置與原始價格。列數不等於商品數。'], ['價格依據', 'ERP 現價不代表核准 RRP；價格差異須確認核准價格、生效日與適用範圍。'], ['回覆欄位', '請填香港回覆、確認價格與處理狀態；此檔不是系統更新檔。']]
  const noteSheet = XLSX.utils.aoa_to_sheet(notes)
  noteSheet['!cols'] = [{ wch: 24 }, { wch: 100 }]
  XLSX.utils.book_append_sheet(workbook, noteSheet, '使用說明')
  return workbook
}

export function downloadRrpReview(filename, issues, context) {
  if (!issues.length) return
  XLSX.writeFile(buildRrpReviewWorkbook(issues, context), filename)
}
