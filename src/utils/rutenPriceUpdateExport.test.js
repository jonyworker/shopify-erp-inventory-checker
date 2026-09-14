import { describe, expect, it } from 'vitest'
import { buildRutenPriceUpdateRows } from './rutenPriceUpdateExport.js'

const baseRutenRow = {
  商品編號: '123',
  規格編號: '',
  賣家自用料號: 'SKU-001',
  商品名稱: '測試商品',
  規格項目狀態: '',
  規格名稱: '',
  項目名稱: '',
  售價: '800',
  庫存: '3',
  修改售價: '',
  修改庫存: ''
}

describe('buildRutenPriceUpdateRows', () => {
  it('只輸出價格不一致，並把 RRP 價格寫入修改售價', () => {
    const rows = buildRutenPriceUpdateRows([
      { 品項編碼: 'SKU-001', RRP價格: 900, Ruten售價: 800, 狀態: '價格不一致' },
      { 品項編碼: 'SKU-002', RRP價格: 700, Ruten售價: 700, 狀態: '一致' }
    ], [
      baseRutenRow,
      { ...baseRutenRow, 商品編號: '124', 賣家自用料號: 'SKU-002', 售價: '700' }
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]['售價']).toBe('800')
    expect(rows[0]['修改售價']).toBe(900)
    expect(rows[0]['庫存']).toBe('3')
  })


  it('同一賣家自用料號出現在多筆露天商品時，會保留每一筆並各自填入修改售價', () => {
    const rows = buildRutenPriceUpdateRows([
      { 品項編碼: 'SKU-001', RRP價格: 900, Ruten售價: 800, 狀態: '價格不一致' }
    ], [
      baseRutenRow,
      { ...baseRutenRow, 商品編號: '456', 規格編號: 'VAR-002', 商品名稱: '另一個露天商品' }
    ])

    expect(rows).toHaveLength(2)
    expect(rows.map(row => row['商品編號'])).toEqual(['123', '456'])
    expect(rows.every(row => row['修改售價'] === 900)).toBe(true)
  })

  it('即使比對結果誤標為不一致，新舊價格相同仍不輸出', () => {
    const rows = buildRutenPriceUpdateRows([
      { 品項編碼: 'SKU-001', RRP價格: 800, Ruten售價: 800, 狀態: '價格不一致' }
    ], [baseRutenRow])

    expect(rows).toHaveLength(0)
  })

  it('找不到原始 Ruten SKU 時不輸出', () => {
    const rows = buildRutenPriceUpdateRows([
      { 品項編碼: 'SKU-404', RRP價格: 900, Ruten售價: 800, 狀態: '價格不一致' }
    ], [baseRutenRow])

    expect(rows).toHaveLength(0)
  })
})
