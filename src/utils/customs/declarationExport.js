import * as XLSX from 'xlsx-js-style'

export const INVOICE_COLUMNS = [
  'Item No.',
  'Description',
  'HS CODE',
  '同意書號碼',
  '同意書對應項次',
  '進口報單號碼',
  '進口報單項次',
  'Qty',
  'Unit',
  'Price(USD)',
  'Amount(USD)',
  '淨重(pcs)',
]

export function buildInvoiceRows(rows) {
  return rows.map(row => ({
    'Item No.': row.itemNo || '',
    Description: row.description || '',
    'HS CODE': row.hsCode || '',
    同意書號碼: row.permitNo || '',
    同意書對應項次: '',
    進口報單號碼: row.declarationNo || '',
    進口報單項次: row.declarationItem || '',
    Qty: '',
    Unit: '',
    'Price(USD)': '',
    'Amount(USD)': '',
    '淨重(pcs)': row.netWeight || '',
  }))
}

export function downloadInvoiceExcel(filename, rows) {
  const data = buildInvoiceRows(rows)
  const worksheet = XLSX.utils.json_to_sheet(data, { header: INVOICE_COLUMNS })
  worksheet['!cols'] = [
    { wch: 18 }, { wch: 54 }, { wch: 18 }, { wch: 22 },
    { wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 10 },
    { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
  ]

  const range = XLSX.utils.decode_range(worksheet['!ref'])
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: 0, c })]
    if (cell) {
      cell.s = {
        font: { bold: true },
        alignment: { horizontal: 'center', vertical: 'center' },
        fill: { fgColor: { rgb: 'E2E8F0' } },
        border: {
          top: { style: 'thin', color: { rgb: 'CBD5E1' } },
          bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
          left: { style: 'thin', color: { rgb: 'CBD5E1' } },
          right: { style: 'thin', color: { rgb: 'CBD5E1' } },
        },
      }
    }
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Invoice紀錄')
  XLSX.writeFile(workbook, filename)
}
