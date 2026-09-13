# Repository architecture

This is a Vue 3 application bundled by Vite. App.vue eagerly imports nine active tools and selects one with a computed dynamic component. Tools own reactive input, mapping, result, filter and export state. The diagram is a conceptual data flow: tools call utility functions and receive their results; the utilities are not independent services.

Primary flow: Local file → Vue tool → parser → business logic → preview → export. Unlabeled main arrows express this already-named progression; dashed arrows express supporting UI and policy dependencies.

- **components/** supplies file upload, column mapping, summaries, tool selection and customs preview UI. Most other result tables live in tools themselves.
- **composables/** currently contains useCompareResultScroll, a nextTick-based scroll helper used by comparison tools. Its preview edge represents this UI behavior, not business state storage.
- **config/exportRules.js** supplies SHOPIFY_EXPORT_RULES to PriceShopifyChecker. excludedStatuses is currently empty. Its business-logic edge represents policy applied by that tool.
- **utils/fileParser.js** reads CSV via Papa Parse and Excel via xlsx-js-style, finds headers, optionally reads multiple worksheets, discovers columns and writes CSV/Excel. The parser and export nodes depict two roles of this same module.
- **Inventory:** tools/inventory calls utils/inventory.js to normalize SKU/quantity data, compare ERP with Shopify or Ruten, and return differences plus invalid rows.
- **Price:** tools/price calls utils/priceCompare.js to compare RRP against ERP, Shopify or Ruten. Shopify and ERP have specialized import/update builders in shopifyPriceImport.js and erpPriceUpdateExport.js.
- **Promotion:** tools/promotion uses specialized workbook parsers in promotionPriceBuilder.js and shopifyPromotionImport.js, plus fileParser for ordinary tabular inputs. Price generation, launch and end are separate active tools; transferring the generated workbook between tools is a manual file handoff. Launch matches promotion rows to Shopify and builds an import CSV; end generates restoration/removal rows.
- **Customs:** CustomsDeclarationParser bypasses fileParser. utils/customs/pdfParser.js reads PDF text using PDF.js and falls back to Tesseract OCR; declarationParser.js extracts and deduplicates items; declarationValidator.js flags issues. Users can edit and revalidate rows before declarationExport.js writes Invoice Excel.

All depicted processing runs in the browser. Export means downloading files for subsequent use; it does not mean a direct Shopify/ERP API update. The diagram groups specialized parsers in the parser node and the four domains in business logic to stay at 10 core nodes.

Evidence: src/App.vue; src/tools/inventory/*.vue; src/tools/price/*.vue; src/tools/promotion/{PromotionPriceBuilderTool,ShopifyPromotionLaunchTool,ShopifyPromotionEndTool}.vue; src/tools/customs/CustomsDeclarationParser.vue; src/components/; src/composables/useCompareResultScroll.js; src/config/exportRules.js; src/utils/fileParser.js; src/utils/{inventory,priceCompare,promotionPriceBuilder,shopifyPromotionImport,shopifyPriceImport,erpPriceUpdateExport}.js; src/utils/customs/*.js.
