-- PTS Authorization System | Phase 01-D: initial catalog and user profiles
-- Project: PTS_tools (fdlfzvtjehoaiaunclhn)
-- IMPORTANT: Already applied to remote as a migration. Keep as local migration history.
-- No administrator assigned. Existing app access rules remain unchanged.
-- Only catalog rows and disabled-by-default profiles are created.

-- Register all 14 tool keys exactly as found in src/App.vue.
insert into public.tool_catalog (tool_key, label, group_key, sort_order)
values
    ('inventoryShopify', 'ERP / Shopify 庫存比對', 'inventory', 10),
    ('inventoryRuten', 'ERP / Ruten 庫存比對', 'inventory', 20),
    ('priceErp', 'RRP / ERP 價格比對', 'price', 30),
    ('priceShopify', 'RRP / Shopify 價格比對', 'price', 40),
    ('priceRuten', 'RRP / Ruten 價格比對', 'price', 50),
    ('promotionPriceBuilder', 'Promotion 價格產生器', 'shopify', 60),
    ('shopifyPromotionLaunch', 'Promotion 商品上架', 'shopify', 70),
    ('shopifyPromotionEnd', 'Promotion 商品下架', 'shopify', 80),
    ('customsDeclarationParser', '進出口報單整理', 'customs', 90),
    ('productManager', '產品資料管理', 'permit', 100),
    ('applicationBuilder', '申請書建立器', 'permit', 110),
    ('permitSearch', '簽審資料查詢', 'permit', 120),
    ('permitPdfParser', '簽審公文匯入', 'permit', 130),
    ('meetingArchive', '會議紀錄', 'meeting', 140)
on conflict (tool_key) do nothing;

-- Register supported operations for each tool.
-- The tool view permission is the prerequisite for all other operations.
-- Seed view permissions first.
insert into public.permission_catalog (tool_id, permission_key, action_key, label)
select t.id, t.tool_key || '.view', 'view', '檢視'
from public.tool_catalog t
where t.tool_key in ('inventoryShopify', 'inventoryRuten', 'priceErp', 'priceShopify', 'priceRuten', 'promotionPriceBuilder', 'shopifyPromotionLaunch', 'shopifyPromotionEnd', 'customsDeclarationParser', 'productManager', 'applicationBuilder', 'permitSearch', 'permitPdfParser', 'meetingArchive')
on conflict (permission_key) do nothing;

-- Seed non-view actions with their prerequisite lookup.
with actions (tool_key, action_key, label) as (
    values
        ('inventoryShopify', 'export', '匯出'),
        ('inventoryRuten', 'export', '匯出'),
        ('priceErp', 'export', '匯出'),
        ('priceShopify', 'export', '匯出'),
        ('priceRuten', 'export', '匯出'),
        ('promotionPriceBuilder', 'export', '匯出'),
        ('shopifyPromotionLaunch', 'export', '匯出'),
        ('shopifyPromotionEnd', 'export', '匯出'),
        ('customsDeclarationParser', 'export', '匯出'),
        ('productManager', 'create', '新增'),
        ('productManager', 'edit', '編輯'),
        ('productManager', 'manage_assets', '附件管理'),
        ('applicationBuilder', 'export', '匯出'),
        ('permitSearch', 'edit', '編輯'),
        ('permitPdfParser', 'create', '新增'),
        ('meetingArchive', 'create', '新增'),
        ('meetingArchive', 'edit', '編輯'),
        ('meetingArchive', 'delete', '刪除')
)
insert into public.permission_catalog
    (tool_id, permission_key, action_key, label, requires_permission_id)
select t.id, t.tool_key || '.' || a.action_key, a.action_key, a.label, p.id
from actions a
join public.tool_catalog t on t.tool_key = a.tool_key
join public.permission_catalog p on p.tool_id = t.id and p.action_key = 'view'
on conflict (permission_key) do nothing;

-- Attach profiles to existing Supabase Auth identities.
-- Explicitly disabled until an authorized person approves accounts.
-- Do not derive authorization from user_metadata or email.
insert into public.app_profiles (user_id, is_active)
select u.id, false from auth.users u
on conflict (user_id) do nothing;

-- No department assignments, role grants, user overrides,
-- or system administrators are written in this migration.;
