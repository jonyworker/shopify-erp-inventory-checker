const text = value => String(value ?? '').trim()
const code = value => text(value).toUpperCase()
function price(value) {
  const cleaned = text(value).replace(/,/g, '').replace(/NT\$|TWD|\$/gi, '').trim()
  if (!cleaned) return null
  const number = Number(cleaned)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export function comparePrice(options) {
  const invalidRows = { official: [], erp: [] }
  const issues = []
  function collect(rows, side) {
    const map = new Map()
    const prefix = side === 'official' ? 'official' : 'erp'
    rows.forEach((raw, index) => {
      const item = {
        itemCode: code(raw[options[`${prefix}CodeColumn`]]),
        name: text(raw[options[`${prefix}NameColumn`]]) || (side === 'erp' ? ['產品中文名稱(官網)', '產品英文名稱(官網)', '廠商產品英文名稱', '品項名稱'].map(key => text(raw[key])).find(Boolean) || '' : ''),
        sku: text(raw[options[`${prefix}SkuColumn`]]),
        price: price(raw[options[`${prefix}PriceColumn`]]),
        rawPrice: text(raw[options[`${prefix}PriceColumn`]]),
        note: Object.entries(raw).filter(([key]) => key.startsWith('未命名欄') || /備註|note/i.test(key)).map(([key, value]) => `${key}：${text(value)}`).join('；'),
        sheet: text(raw['來源工作表']),
        row: raw['來源列號'] ?? index + 2
      }
      const reasons = []
      if (!item.itemCode) reasons.push('內部料號空白')
      if (item.price === null) reasons.push('價格空白或格式異常')
      if (reasons.length) {
        invalidRows[side].push({ rowNumber: item.row, reason: reasons.join('；'), raw })
        issues.push(issue(side, item, reasons.join('；')))
      }
      // Keep invalid-price records keyed by code so they cannot appear as missing products.
      if (item.itemCode) map.set(item.itemCode, [...(map.get(item.itemCode) || []), item])
    })
    return map
  }
  function issue(side, item, reason) {
    return {
      品項編碼: item.itemCode, 問題類型: `${side === 'official' ? 'RRP' : 'ERP'} ${reason}`,
      RRP品項名稱: side === 'official' ? item.name : '', ERP品項名稱: side === 'erp' ? item.name : '',
      RRP原廠編碼: side === 'official' ? item.sku : '', ERP原廠編碼: side === 'erp' ? item.sku : '',
      RRP價格: side === 'official' ? item.rawPrice : '', ERP價格: side === 'erp' ? item.rawPrice : '',
      資料來源: side === 'official' ? 'RRP' : 'ERP', 來源工作表: item.sheet, 來源列號: item.row,
      來源備註: item.note, 建議處理: '確認原始資料後補齊或更正', 香港回覆: '', 確認價格: '', 處理狀態: '待確認'
    }
  }
  const official = collect(options.officialRows, 'official')
  const erp = collect(options.erpRows, 'erp')
  const results = []
  for (const itemCode of new Set([...official.keys(), ...erp.keys()])) {
    const os = official.get(itemCode) || [], es = erp.get(itemCode) || []
    const o = os[0], e = es[0]
    const invalid = [...os, ...es].some(item => item.price === null)
    const duplicate = os.length > 1 || es.length > 1
    const conflict = [os, es].some(items => new Set(items.map(item => item.price).filter(p => p !== null)).size > 1)
    const status = invalid ? '資料異常待確認' : conflict ? '價格衝突待確認' : duplicate ? '重複料號待確認' : !o ? 'ERP 獨有' : !e ? 'RRP 獨有' : o.price === e.price ? '一致' : '價格不一致'
    const note = [os.length > 1 ? `RRP ${os.length} 筆` : '', es.length > 1 ? `ERP ${es.length} 筆` : '', duplicate ? '全部來源列於香港確認清單，暫不產生更新價格' : ''].filter(Boolean).join('；')
    const result = {
      品項編碼: itemCode, 來源工作表: os.map(i => i.sheet).filter(Boolean).join('；'),
      品項名稱: o?.name || e?.name || '', RRP品項名稱: o?.name || '', ERP品項名稱: e?.name || '',
      RRP原廠編碼: o?.sku || '', ERP原廠編碼: e?.sku || '',
      RRP來源列號: os.map(i => i.row).join('；'), ERP來源列號: es.map(i => i.row).join('；'),
      價目表價格: os.length === 1 && o.price !== null ? o.price : '',
      ERP出庫單價: es.length === 1 && e.price !== null ? e.price : '',
      差異: !invalid && !duplicate && o && e ? e.price - o.price : '', 狀態: status, 備註: note
    }
    results.push(result)
    if (status !== '一致') {
      const action = status === 'ERP 獨有' ? '確認是否需補建 RRP，或列為不適用' : status === 'RRP 獨有' ? '確認台灣適用範圍、料號與 ERP 建檔狀態' : status === '價格不一致' ? '確認核准價格、生效日與應修改哪一邊' : '確認全部來源，釐清重複、出清價或異常資料'
      // One row for each source occurrence preserves every conflicting price and its location.
      for (const [side, items] of [['official', os], ['erp', es]]) {
        for (const item of items) issues.push({
          ...issue(side, item, status), 問題類型: status,
          RRP品項名稱: side === 'official' ? item.name : o?.name || '',
          ERP品項名稱: side === 'erp' ? item.name : e?.name || '',
          RRP原廠編碼: side === 'official' ? item.sku : o?.sku || '',
          ERP原廠編碼: side === 'erp' ? item.sku : e?.sku || '',
          RRP價格: side === 'official' ? item.rawPrice : os.length === 1 ? o?.rawPrice || '' : '',
          ERP價格: side === 'erp' ? item.rawPrice : es.length === 1 ? e?.rawPrice || '' : '',
          資料來源: side === 'official' ? 'RRP' : 'ERP', 建議處理: action
        })
      }
    }
  }
  return { results, invalidRows, issues }
}
