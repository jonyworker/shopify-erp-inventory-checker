import { describe, expect, it } from 'vitest'
import {
  comparePrice,
  comparePriceWithRuten,
  comparePriceWithShopify
} from './priceCompare.js'

const officialColumns = {
  officialCodeColumn: 'Item',
  officialPriceColumn: 'Retail Price',
  officialNameColumn: 'Description'
}

function compareWithErp(officialRows, erpRows) {
  return comparePrice({
    officialRows,
    erpRows,
    ...officialColumns,
    erpCodeColumn: '品項編碼',
    erpPriceColumn: '出庫單價',
    erpNameColumn: '品項名稱'
  })
}

describe('comparePrice', () => {
  it('normalizes SKU and formatted prices before reporting a match', () => {
    const result = compareWithErp(
      [{ Item: ' sku-1 ', 'Retail Price': 'NT$1,200', Description: 'RRP product', 來源工作表: 'Sheet A' }],
      [{ 品項編碼: 'SKU-1', 出庫單價: 'TWD 1,200', 品項名稱: 'ERP product' }]
    )

    expect(result).toEqual({
      results: [{
        品項編碼: 'SKU-1',
        來源工作表: 'Sheet A',
        品項名稱: 'RRP product',
        價目表價格: 1200,
        ERP出庫單價: 1200,
        差異: 0,
        狀態: '一致',
        備註: ''
      }],
      invalidRows: { official: [], erp: [] }
    })
  })

  it('reports the target-minus-source difference when prices do not match', () => {
    const { results } = compareWithErp(
      [{ Item: 'SKU-1', 'Retail Price': 100, Description: 'Product' }],
      [{ 品項編碼: 'SKU-1', 出庫單價: 125, 品項名稱: 'Product' }]
    )

    expect(results[0]).toMatchObject({
      品項編碼: 'SKU-1',
      價目表價格: 100,
      ERP出庫單價: 125,
      差異: 25,
      狀態: '價格不一致'
    })
  })

  it('returns both RRP-only and ERP-only rows', () => {
    const { results } = compareWithErp(
      [{ Item: 'RRP-ONLY', 'Retail Price': 100, Description: 'RRP product' }],
      [{ 品項編碼: 'ERP-ONLY', 出庫單價: 200, 品項名稱: 'ERP product' }]
    )

    expect(results).toEqual([
      {
        品項編碼: 'RRP-ONLY',
        來源工作表: '',
        品項名稱: 'RRP product',
        價目表價格: 100,
        ERP出庫單價: '',
        差異: '',
        狀態: 'RRP 獨有',
        備註: ''
      },
      {
        品項編碼: 'ERP-ONLY',
        來源工作表: '',
        品項名稱: 'ERP product',
        價目表價格: '',
        ERP出庫單價: 200,
        差異: '',
        狀態: 'ERP 獨有',
        備註: ''
      }
    ])
  })

  it('keeps the first price and marks duplicate SKUs with the same price', () => {
    const { results } = compareWithErp(
      [
        { Item: 'SKU-1', 'Retail Price': 100, Description: 'First name' },
        { Item: 'sku-1', 'Retail Price': 100, Description: 'Second name' }
      ],
      [{ 品項編碼: 'SKU-1', 出庫單價: 100, 品項名稱: 'ERP name' }]
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      品項名稱: 'First name',
      價目表價格: 100,
      狀態: '一致',
      備註: '價目表品項重複，已取第一筆價格'
    })
  })

  it('keeps the first duplicate price and reports a source price conflict', () => {
    const { results } = compareWithErp(
      [
        { Item: 'SKU-1', 'Retail Price': 100, Description: 'Product' },
        { Item: 'SKU-1', 'Retail Price': 110, Description: 'Product' }
      ],
      [{ 品項編碼: 'SKU-1', 出庫單價: 100, 品項名稱: 'Product' }]
    )

    expect(results[0]).toMatchObject({
      價目表價格: 100,
      差異: 0,
      狀態: '一致',
      備註: '價目表品項重複，已取第一筆價格；價目表重複品項價格不同，請人工確認'
    })
  })

  it('keeps the first duplicate ERP price and reports a target price conflict', () => {
    const { results } = compareWithErp(
      [{ Item: 'SKU-1', 'Retail Price': 100, Description: 'Product' }],
      [
        { 品項編碼: 'SKU-1', 出庫單價: 120, 品項名稱: 'Product' },
        { 品項編碼: 'SKU-1', 出庫單價: 130, 品項名稱: 'Product' }
      ]
    )

    expect(results[0]).toMatchObject({
      ERP出庫單價: 120,
      差異: 20,
      狀態: '價格不一致',
      備註: 'ERP 品項重複，已取第一筆價格；ERP 重複品項價格不同，請人工確認'
    })
  })
})

describe('channel-specific comparison entries', () => {
  it('returns the current English result contract for Shopify comparisons', () => {
    const result = comparePriceWithShopify({
      officialRows: [{ Item: 'SKU-1', 'Retail Price': 100, Description: 'RRP name', 來源工作表: 'RRP' }],
      shopifyRows: [
        { 'Variant SKU': 'sku-1', 'Variant Price': 120, Title: 'Shopify name' },
        { 'Variant SKU': 'SHOPIFY-ONLY', 'Variant Price': 300, Title: 'Only on Shopify' }
      ],
      ...officialColumns,
      shopifyCodeColumn: 'Variant SKU',
      shopifyPriceColumn: 'Variant Price',
      shopifyNameColumn: 'Title'
    })

    expect(result).toEqual({
      results: [
        {
          sku: 'SKU-1',
          sourceSheet: 'RRP',
          rrpName: 'RRP name',
          shopifyName: 'Shopify name',
          rrpPrice: 100,
          shopifyPrice: 120,
          diff: 20,
          status: '價格不一致',
          note: ''
        },
        {
          sku: 'SHOPIFY-ONLY',
          sourceSheet: '',
          rrpName: '',
          shopifyName: 'Only on Shopify',
          rrpPrice: '',
          shopifyPrice: 300,
          diff: '',
          status: 'Shopify 獨有',
          note: ''
        }
      ],
      invalidRows: { official: [], shopify: [] }
    })
  })

  it('returns the current Chinese result contract for Ruten comparisons', () => {
    const result = comparePriceWithRuten({
      officialRows: [{ Item: 'SKU-1', 'Retail Price': 100, Description: 'RRP name', 來源工作表: 'RRP' }],
      rutenRows: [
        { 賣家自用料號: 'sku-1', 售價: 100, 商品名稱: 'Ruten name' },
        { 賣家自用料號: 'RUTEN-ONLY', 售價: 250, 商品名稱: 'Only on Ruten' }
      ],
      ...officialColumns,
      rutenCodeColumn: '賣家自用料號',
      rutenPriceColumn: '售價',
      rutenNameColumn: '商品名稱'
    })

    expect(result).toEqual({
      results: [
        {
          品項編碼: 'SKU-1',
          來源工作表: 'RRP',
          RRP品項名稱: 'RRP name',
          Ruten商品名稱: 'Ruten name',
          RRP價格: 100,
          Ruten售價: 100,
          差異: 0,
          狀態: '一致',
          備註: ''
        },
        {
          品項編碼: 'RUTEN-ONLY',
          來源工作表: '',
          RRP品項名稱: '',
          Ruten商品名稱: 'Only on Ruten',
          RRP價格: '',
          Ruten售價: 250,
          差異: '',
          狀態: 'Ruten 獨有',
          備註: ''
        }
      ],
      invalidRows: { official: [], ruten: [] }
    })
  })
})
