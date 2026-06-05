import Papa from 'papaparse'
import * as XLSX from 'xlsx-js-style'

const EXCEL_EXTENSIONS = ['xlsx', 'xls']
const CSV_EXTENSIONS = ['csv']

function getFileExtension(file) {
  return file.name.split('.').pop()?.toLowerCase() || ''
}

export function parseDataFile(file) {
  const extension = getFileExtension(file)

  if (CSV_EXTENSIONS.includes(extension)) {
    return parseCsvFile(file)
  }

  if (EXCEL_EXTENSIONS.includes(extension)) {
    return parseExcelFile(file)
  }

  return Promise.reject(new Error('不支援的檔案格式，請上傳 CSV、XLSX 或 XLS。'))
}

export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: header => String(header).trim(),
      complete: result => {
        if (result.errors?.length) {
          reject(result.errors)
          return
        }

        resolve(result.data)
      },
      error: error => reject(error)
    })
  })
}

export function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = event => {
      try {
        const data = new Uint8Array(event.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const firstSheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[firstSheetName]

        if (!worksheet) {
          reject(new Error('Excel 檔案沒有可讀取的工作表。'))
          return
        }

        const rawRows = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
          raw: false
        })

        const headerRowIndex = rawRows.findIndex(row => {
          return row.includes('可買編碼') ||
              row.includes('品項名稱') ||
              row.includes('合計')
        })

        if (headerRowIndex === -1) {
          reject(new Error('找不到 ERP 欄位標題列，請確認 Excel 是否包含「可買編碼」或「合計」。'))
          return
        }

        const headers = rawRows[headerRowIndex].map(header => String(header).trim())
        const dataRows = rawRows.slice(headerRowIndex + 1)

        const rows = dataRows
            .map(row => {
              const item = {}

              headers.forEach((header, index) => {
                if (!header) return
                item[header] = row[index] ?? ''
              })

              return item
            })
            .filter(item => {
              return Object.values(item).some(value => String(value).trim() !== '')
            })

        resolve(rows)
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

export function getColumns(rows) {
  if (!rows?.length) return []
  return Object.keys(rows[0]).map(column => String(column).trim())
}

export function downloadCsv(filename, rows) {
  const csv = Papa.unparse(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  link.click()

  URL.revokeObjectURL(url)
}

function getStatusStyle(status) {
  const styles = {
    一致: {
      fill: { fgColor: { rgb: 'DCFCE7' } },
      font: { color: { rgb: '166534' }, bold: true }
    },
    數量不一致: {
      fill: { fgColor: { rgb: 'FEF3C7' } },
      font: { color: { rgb: '92400E' }, bold: true }
    },
    Shopify獨有: {
      fill: { fgColor: { rgb: 'FFE4E6' } },
      font: { color: { rgb: 'BE123C' }, bold: true }
    },
    'Shopify 獨有': {
      fill: { fgColor: { rgb: 'FFE4E6' } },
      font: { color: { rgb: 'BE123C' }, bold: true }
    },
    ERP獨有: {
      fill: { fgColor: { rgb: 'DBEAFE' } },
      font: { color: { rgb: '1D4ED8' }, bold: true }
    },
    'ERP 獨有': {
      fill: { fgColor: { rgb: 'DBEAFE' } },
      font: { color: { rgb: '1D4ED8' }, bold: true }
    }
  }

  return styles[status] || {}
}

export function downloadExcel(filename, rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  const range = XLSX.utils.decode_range(worksheet['!ref'])

  worksheet['!cols'] = [
    { wch: 24 },
    { wch: 16 },
    { wch: 16 },
    { wch: 12 },
    { wch: 18 },
    { wch: 36 }
  ]

  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col })

    if (!worksheet[cellAddress]) continue

    worksheet[cellAddress].s = {
      fill: { fgColor: { rgb: 'E2E8F0' } },
      font: { bold: true, color: { rgb: '0F172A' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'thin', color: { rgb: 'CBD5E1' } },
        bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
        left: { style: 'thin', color: { rgb: 'CBD5E1' } },
        right: { style: 'thin', color: { rgb: 'CBD5E1' } }
      }
    }
  }

  for (let row = 1; row <= range.e.r; row += 1) {
    const statusCellAddress = XLSX.utils.encode_cell({ r: row, c: 4 })
    const statusCell = worksheet[statusCellAddress]

    if (!statusCell) continue

    const statusStyle = getStatusStyle(statusCell.v)

    statusCell.s = {
      ...statusStyle,
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'thin', color: { rgb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
        left: { style: 'thin', color: { rgb: 'E2E8F0' } },
        right: { style: 'thin', color: { rgb: 'E2E8F0' } }
      }
    }
  }

  XLSX.utils.book_append_sheet(workbook, worksheet, '比對結果')
  XLSX.writeFile(workbook, filename)
}