# PTS 電商資料比對工具

這是一套使用 **Vue 3 + JavaScript + Tailwind CSS** 開發的內部電商資料處理工具。

主要用於整合與比對 **ERP、Shopify、露天拍賣、RRP 價格資料與 Promotion 活動資料**，協助處理庫存同步、價格更新、活動商品上架／下架，以及 Shopify 匯入檔案產生等日常電商作業。

所有資料皆於瀏覽器端處理，不需要將商品資料上傳至額外的後端伺服器。

---

## 功能

### Shopify / ERP 庫存比對

匯入 Shopify 與 ERP 商品資料後，依 SKU 比對雙方庫存數量。

支援：

* Shopify CSV / Excel
* ERP CSV / Excel
* 自訂 SKU 欄位
* 自訂庫存欄位
* SKU 自動標準化
* 重複 SKU 庫存自動加總
* 搜尋 SKU
* 依比對狀態篩選
* 匯出目前結果

比對狀態包含：

* 庫存一致
* 庫存數量不一致
* Shopify 獨有
* ERP 獨有

---

### 露天 / ERP 庫存比對

比對露天拍賣與 ERP 的商品庫存資料，用於確認平台庫存與 ERP 實際庫存是否一致。

支援：

* CSV / Excel 匯入
* SKU 比對
* 庫存差異檢查
* 搜尋與篩選
* 結果匯出

---

### RRP / ERP 價格比對

比對 RRP Retail Price 與 ERP 商品價格資料。

可快速找出：

* 價格一致商品
* 價格不一致商品
* RRP 獨有商品
* ERP 獨有商品

並支援搜尋、狀態篩選與結果匯出。

---

### RRP / Shopify 價格比對

比對 RRP Retail Price 與 Shopify 商品價格。

當價格不一致時，可產生 Shopify 可重新匯入的價格更新檔案。

Shopify 更新檔主要包含：

```text
Handle
Title

Option1 Name
Option1 Value
Option1 Linked To

Option2 Name
Option2 Value
Option2 Linked To

Option3 Name
Option3 Value
Option3 Linked To

Variant SKU
Variant Price
Variant Compare At Price
```

如果 Shopify Option Linked To 使用 Shopify metafield，例如：

```text
product.metafields.shopify.color-pattern
```

工具會自動保留對應的 metafield 欄位。

價格輸出統一使用兩位小數格式，例如：

```text
4200.00
3696.00
```

---

## Shopify Promotion 活動工具

用於處理 Shopify 特價活動商品的批次上架與活動結束作業。

### Promotion START

匯入：

1. Promotion 活動商品 Excel
2. Shopify All Products CSV

工具會依 Promotion 內的 SKU 找出 Shopify 對應商品，並使用 Promotion 表格提供的優惠價格產生 Shopify 活動更新檔。

優惠價格以 Promotion 表格內容為準，不另外計算折扣。

主要處理：

* 活動 SKU 比對
* Promotion 優惠價格
* Variant Price 更新
* Variant Compare At Price
* 活動 Tags
* Shopify Option 資料
* Linked To metafield
* Promotion 有資料但 Shopify 找不到的商品
* 排除 archived 等不需要處理的商品

產生的檔案可直接作為 Shopify CSV 匯入資料。

---

### Promotion END

用於活動結束後恢復商品正常價格。

建議流程：

1. Shopify 使用活動 Tag 找出本次活動商品
2. 重新匯出最新 Shopify 商品 CSV
3. 將 CSV 匯入 Promotion END 工具
4. 工具恢復正常售價
5. 移除指定活動 Tag
6. 產生 Shopify 更新 CSV
7. 重新匯入 Shopify

活動結束時：

```text
Variant Price
```

會恢復為：

```text
Variant Compare At Price
```

藉此避免使用活動開始前的舊資料恢復商品，確保庫存、Variant 與其他 Shopify 商品資訊以最新匯出資料為基礎。

---

## Shopify CSV 安全原則

Shopify CSV 匯入可能影響商品資料，因此工具輸出的更新檔會盡可能只保留實際需要的欄位。

價格或活動更新時，不應任意輸出：

```text
Variant Inventory Qty
Variant Image
```

避免價格更新作業意外影響：

* Shopify 庫存
* Variant 圖片
* 商品 Option
* Shopify metafield 關聯

需要保留 Option 關聯時，工具會一併輸出：

```text
Option1 Linked To
Option2 Linked To
Option3 Linked To
```

以及 Linked To 所指向的對應 metafield 欄位。

---

## 支援格式

目前主要支援：

```text
.csv
.xlsx
.xls
```

不同來源的檔案可以使用不同欄位名稱，部分工具提供欄位選擇或自動辨識功能。

---

## 常見 Shopify 欄位

```text
Handle
Title
Tags

Option1 Name
Option1 Value
Option1 Linked To

Option2 Name
Option2 Value
Option2 Linked To

Option3 Name
Option3 Value
Option3 Linked To

Variant SKU
Variant Price
Variant Compare At Price
Variant Inventory Qty
```

實際輸出時不一定會包含所有欄位，會依工具用途選擇必要欄位。

---

## 常見 ERP 欄位

依 ERP 匯出格式不同，常見欄位可能包含：

```text
SKU
品號
商品編號
庫存
庫存數量
價格
售價
```

實際使用欄位依各比對工具設定為準。

---

## 開發環境

* Vue 3
* JavaScript
* Vite
* Tailwind CSS
* PapaParse
* XLSX / Excel 處理工具

---

## 安裝

Clone 專案後安裝 dependencies：

```bash
npm install
```

---

## 開發

啟動本機開發環境：

```bash
npm run dev
```

Vite 啟動後依終端機顯示的網址開啟工具。

通常為：

```text
http://localhost:5173
```

---

## 打包

建立 Production Build：

```bash
npm run build
```

輸出結果會建立於：

```text
dist/
```

---

## 建置預覽

需要在本機確認 Production Build 時：

```bash
npm run preview
```

---

## 基本操作流程

大部分比對工具皆採用類似流程：

```text
匯入來源 A
      ↓
匯入來源 B
      ↓
選擇／確認比對欄位
      ↓
執行比對
      ↓
查看 Summary
      ↓
搜尋／篩選結果
      ↓
匯出 CSV / Excel
```

Shopify 更新工具則會進一步產生：

```text
原始資料
    ↓
SKU 比對
    ↓
建立 Shopify 更新資料
    ↓
預覽更新內容
    ↓
匯出 Shopify CSV
    ↓
Shopify Admin 匯入
```

---

## 開發注意事項

修改 Shopify 匯出功能時，請特別注意：

1. Shopify CSV 欄位名稱必須與 Shopify 原始欄位名稱完全一致。
2. 不需要修改的 Shopify 欄位盡量不要輸出。
3. 不要因價格更新而輸出或覆蓋庫存欄位。
4. 不要因價格更新而移除 Variant Image。
5. Option 使用 Linked To 時，需要保留其對應 metafield。
6. SKU 比對前應進行 trim 與大小寫標準化。
7. 價格資料應先移除貨幣符號與千分位後再進行數值比較。
8. 修改 Shopify CSV 輸出邏輯後，應先使用少量測試商品進行 Shopify 匯入測試。

---

## 專案用途

此專案主要用於 PTS 內部電商與商品資料管理流程，目標是將原本需要大量人工操作 Excel 的工作轉換成：

**匯入 → 比對 → 檢查 → 匯出**

藉此降低人工複製資料、SKU 比對與 Shopify 批次更新時發生錯誤的機率。
