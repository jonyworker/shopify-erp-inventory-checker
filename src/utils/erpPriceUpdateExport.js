import * as XLSX from 'xlsx-js-style'

const ERP_PRICE_COLUMNS = [
  '品項編碼',
  '出庫單價/零售價',
  '出庫單價/零售價是否含稅',
  '95折 - 5%',
  '95折 - 5%是否含稅',
  '92折 - 8%',
  '92折 - 8%是否含稅',
  '9折 - 10%',
  '9折 - 10%是否含稅',
  '85折 - 15%',
  '85折 - 15%是否含稅',
  '88折 - 12%',
  '88折 - 12%是否含稅',
  '8折 - 20%',
  '8折 - 20%是否含稅',
  '7折 - 30%',
  '7折 - 30%是否含稅',
  '75折 - 25%',
  '75折 - 25%是否含稅'
]

const DISCOUNT_PERCENTS = [95, 92, 90, 85, 88, 80, 70, 75]

function normalizePrice(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function calculateDiscountPrice(retailPrice, percent) {
  return Math.round((retailPrice * percent) / 100)
}

/**
 * 將 RRP / ERP 比對結果整理成 ERP「更改品項」可貼上的價格資料。
 *
 * 只處理「價格不一致」：
 * - ERP 獨有：RRP 沒有新價格，不能更新
 * - RRP 獨有：ERP 尚無此品項，不屬於既有品項價格修改
 * - 一致：不需要更新
 */
export function buildErpPriceUpdateRows(compareResults) {
  return compareResults
    .filter(item => item.狀態 === '價格不一致')
    .map(item => {
      const retailPrice = normalizePrice(item.價目表價格)

      if (!item.品項編碼 || retailPrice === null) return null

      const discountPrices = DISCOUNT_PERCENTS.map(percent =>
        calculateDiscountPrice(retailPrice, percent)
      )

      return {
        '品項編碼': item.品項編碼,
        '出庫單價/零售價': retailPrice,
        '出庫單價/零售價是否含稅': 1,
        '95折 - 5%': discountPrices[0],
        '95折 - 5%是否含稅': 'Y',
        '92折 - 8%': discountPrices[1],
        '92折 - 8%是否含稅': 'Y',
        '9折 - 10%': discountPrices[2],
        '9折 - 10%是否含稅': 'Y',
        '85折 - 15%': discountPrices[3],
        '85折 - 15%是否含稅': 'Y',
        '88折 - 12%': discountPrices[4],
        '88折 - 12%是否含稅': 'Y',
        '8折 - 20%': discountPrices[5],
        '8折 - 20%是否含稅': 'Y',
        '7折 - 30%': discountPrices[6],
        '7折 - 30%是否含稅': 'Y',
        '75折 - 25%': discountPrices[7],
        '75折 - 25%是否含稅': 'Y'
      }
    })
    .filter(Boolean)
}

export function downloadErpPriceUpdateWorkbook(filename, compareResults) {
  const rows = buildErpPriceUpdateRows(compareResults)

  if (!rows.length) {
    throw new Error('目前沒有「價格不一致」的品項可匯出。')
  }

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ERP_PRICE_COLUMNS
  })
  const workbook = XLSX.utils.book_new()
  const range = XLSX.utils.decode_range(worksheet['!ref'])

  worksheet['!cols'] = ERP_PRICE_COLUMNS.map((column, index) => ({
    wch: index === 0
      ? 20
      : column.includes('是否含稅')
        ? 24
        : 16
  }))

  worksheet['!freeze'] = { xSplit: 0, ySplit: 1 }

  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const address = XLSX.utils.encode_cell({ r: 0, c: col })
    const cell = worksheet[address]
    if (!cell) continue

    cell.s = {
      fill: { fgColor: { rgb: 'E2E8F0' } },
      font: { bold: true, color: { rgb: '0F172A' } },
      alignment: {
        horizontal: 'center',
        vertical: 'center',
        wrapText: true
      },
      border: {
        top: { style: 'thin', color: { rgb: 'CBD5E1' } },
        bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
        left: { style: 'thin', color: { rgb: 'CBD5E1' } },
        right: { style: 'thin', color: { rgb: 'CBD5E1' } }
      }
    }
  }

  for (let row = 1; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col })
      const cell = worksheet[address]
      if (!cell) continue

      cell.s = {
        alignment: {
          horizontal: col === 0 ? 'left' : 'center',
          vertical: 'center'
        },
        border: {
          top: { style: 'thin', color: { rgb: 'E2E8F0' } },
          bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
          left: { style: 'thin', color: { rgb: 'E2E8F0' } },
          right: { style: 'thin', color: { rgb: 'E2E8F0' } }
        }
      }
    }
  }

  XLSX.utils.book_append_sheet(workbook, worksheet, '更改品項')
  XLSX.writeFile(workbook, filename)
}
