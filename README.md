# Shopify / ERP 庫存比對工具

這是一個 Vue 3 + JavaScript + TailwindCSS 製作的內部庫存比對工具。

## 功能

- 匯入 Shopify CSV / Excel
- 匯入 ERP CSV / Excel
- 選擇 SKU 欄位與庫存欄位
- 自動比對庫存差異
- 顯示一致、數量不一致、Shopify 獨有、ERP 獨有
- 搜尋 SKU (產品料號)
- 依狀態篩選
- 匯出目前結果 CSV / Excel
- 重複 SKU 會自動加總

## 安裝

```bash
npm install
```

## 開發

```bash
npm run dev
```

## 打包

```bash
npm run build
```

## 建議 CSV / Excel 欄位

Shopify 常見欄位：

- Variant SKU
- Variant Inventory Qty

ERP 常見欄位：

- SKU
- 品號
- 商品編號
- 庫存
- 庫存數量
