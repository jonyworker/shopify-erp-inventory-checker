const HS_CODE_PATTERN = /^\d{4}\.\d{2}\.\d{2}\.\d{2}-\d$/
const PERMIT_PATTERN = /^(?:內授警字|警署保字)第\d+號$/
const ITEM_PATTERN = /^[A-Z][A-Z0-9._\/-]{2,24}$/

export function validateDeclarationRow(row) {
  const issues = []

  if (!row.itemNo) issues.push('缺少 Item No.')
  else if (!ITEM_PATTERN.test(row.itemNo)) issues.push('Item No. 格式可能異常')

  if (!row.description) issues.push('缺少 Description')

  if (!row.hsCode) issues.push('缺少 HS CODE')
  else if (!HS_CODE_PATTERN.test(row.hsCode)) issues.push('HS CODE 格式可能異常')

  if (row.permitNo && !PERMIT_PATTERN.test(row.permitNo)) {
    issues.push('同意書號碼格式可能異常')
  }

  if (!row.declarationNo) issues.push('缺少報單號碼')
  if (!row.declarationItem) issues.push('缺少報單項次')

  if (row.netWeight && Number.isNaN(Number(row.netWeight))) {
    issues.push('淨重格式可能異常')
  }

  return issues
}

export function validateDeclarationRows(rows) {
  return rows.map(row => ({
    ...row,
    issues: validateDeclarationRow(row),
  }))
}
