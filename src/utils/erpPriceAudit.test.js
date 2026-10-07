import { describe, expect, it } from 'vitest'
import { comparePrice } from './erpPriceAudit.js'
import { buildErpPriceUpdateRows } from './erpPriceUpdateExport.js'
import { buildRrpReviewWorkbook } from './rrpReviewExport.js'
import * as XLSX from 'xlsx-js-style'
const columns = { officialCodeColumn: 'Item', officialPriceColumn: 'Price', officialNameColumn: 'Name', officialSkuColumn: 'SKU', erpCodeColumn: 'Code', erpPriceColumn: 'Price', erpNameColumn: 'Name', erpSkuColumn: 'SKU' }
const compare = (officialRows, erpRows) => comparePrice({ ...columns, officialRows, erpRows })
describe('ERP audit workflow', () => {
  it('retains known products with invalid prices instead of reporting missing products', () => {
    const r = compare([{ Item: 'A', Price: '' }], [{ Code: 'A', Price: 100 }])
    expect(r.results[0].狀態).toBe('資料異常待確認')
    expect(buildErpPriceUpdateRows(r.results)).toEqual([])
  })
  it('exports missing codes, zero prices, source rows and fallback ERP metadata', () => {
    const r = compare([{ Item: '', SKU: 'original', Name: 'pending', Price: 0, 來源列號: 17 }], [{ Code: 'AP013490326', Price: 1500, SKU: '55152', '產品中文名稱(官網)': '冷霜色' }])
    expect(r.issues).toContainEqual(expect.objectContaining({ 品項編碼: '', RRP原廠編碼: 'original', RRP價格: '0', 來源列號: 17 }))
    expect(r.results[0]).toMatchObject({ ERP原廠編碼: '55152', ERP品項名稱: '冷霜色', 狀態: 'ERP 獨有' })
  })
  it('preserves every conflict and blocks updates while allowing a valid mismatch', () => {
    const r = compare([{ Item: 'A', Price: 100, 來源列號: 7 }, { Item: 'A', Price: 200, 來源列號: 8 }, { Item: 'B', Price: 300 }], [{ Code: 'A', Price: 100 }, { Code: 'B', Price: 200 }])
    expect(r.issues.filter(i => i.資料來源 === 'RRP' && i.品項編碼 === 'A').map(i => [i.RRP價格, i.來源列號])).toEqual([['100', 7], ['200', 8]])
    expect(buildErpPriceUpdateRows(r.results).map(i => i.品項編碼)).toEqual(['B'])
    const workbook = buildRrpReviewWorkbook(r.issues, { priceColumn: '零售價' })
    const roundtrip = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json(roundtrip.Sheets['香港確認清單'], { defval: '' })
    expect(rows).toHaveLength(r.issues.length)
    expect(rows.find(i => i.來源列號 === 8)).toMatchObject({ RRP價格: '200', 香港回覆: '', 處理狀態: '待確認' })
  })
})
