-- PTS Phase 03-I1 | 組織與員工多組織歸屬：資料結構
-- 目標 Supabase project: PTS_tools (fdlfzvtjehoaiaunclhn)
-- 此 Migration 不改變既有員工權限、不新增員工歸屬、不修改會議資料及 RLS。
-- 注意：不要直接在 SQL Editor 先執行這份檔案；請先以 CLI 產生 Migration，再進行 dry-run。

-- 1. 組織主檔：採「組織」而非「法人／分公司」用語，避免未確認的法律隸屬假設。
CREATE TABLE public.organizations (
                                      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                                      code text NOT NULL UNIQUE,
                                      name text NOT NULL,
                                      description text,
                                      sort_order integer NOT NULL DEFAULT 0,
                                      is_active boolean NOT NULL DEFAULT true,
                                      created_at timestamptz NOT NULL DEFAULT now(),
                                      updated_at timestamptz NOT NULL DEFAULT now(),
                                      CONSTRAINT pts_org_code_format CHECK (code ~ '^[a-z][a-z0-9_-]{1,31}$'),
  CONSTRAINT pts_org_name_nonblank CHECK (length(btrim(name)) BETWEEN 1 AND 120)
);
COMMENT ON TABLE public.organizations IS 'PTS 所屬組織主檔。初始 tw / hk，與功能權限、業務部門分開管理。';
COMMENT ON COLUMN public.organizations.code IS '穩定識別碼，例 tw / hk；請勿以中文名稱當關聯鍵。';
-- 2. 員工與組織：一人多組織，且同一人最多一個主要組織。
-- 注意！此階段尚不指派任何員工，後續 I2 完成稽核封存整合後才開放寫入。
-- 對 app_profiles 採 ON DELETE RESTRICT：避免帳號被永久刪除時，自動抹除尚未封存的組織歸屬。
CREATE TABLE public.user_organizations (
                                           user_id uuid NOT NULL REFERENCES public.app_profiles(user_id) ON DELETE RESTRICT,
                                           organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
                                           is_primary boolean NOT NULL DEFAULT false,
                                           assigned_at timestamptz NOT NULL DEFAULT now(),
                                           PRIMARY KEY (user_id, organization_id)
);
CREATE UNIQUE INDEX pts_user_organizations_one_primary
    ON public.user_organizations(user_id)
    WHERE is_primary;
CREATE INDEX pts_user_organizations_org_lookup
    ON public.user_organizations(organization_id, user_id);
COMMENT ON TABLE public.user_organizations IS 'PTS 員工與組織多對多關聯。I1 只建表；I2 管理 API 將處理權限、稽核與永久刪除整合。';
COMMENT ON COLUMN public.user_organizations.is_primary IS '一位員工最多一個主要組織；I2 管理 API 會處理主要組織必選規則。';
-- 3. 新表第一天就開啟 RLS，拒絕客戶端直接竄改組織與歸屬。
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organizations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.user_organizations FROM PUBLIC, anon, authenticated;
-- 只提供已啟用員工 SELECT；沒有 INSERT / UPDATE / DELETE 權限。
GRANT SELECT ON TABLE public.organizations TO authenticated;
GRANT SELECT ON TABLE public.user_organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_organizations TO service_role;
CREATE POLICY pts_org_select_active_employee
  ON public.organizations
  FOR SELECT TO authenticated
                 USING ((SELECT pts_private.pts_employee_business_session_active()));
-- 一般員工只看自己的組織；已啟用的系統管理員可查看全部。
-- 會議與會人員選擇器將在 J 階段透過獨立、受限的清單 API 取得跨組織員工。
CREATE POLICY pts_user_org_select_self_or_admin
  ON public.user_organizations
  FOR SELECT TO authenticated
                 USING (
                 (SELECT pts_private.pts_employee_business_session_active())
                 AND (
                 user_id = (SELECT auth.uid())
                 OR (SELECT pts_private.pts_my_is_system_admin())
                 )
                 );
-- 4. 初始組織（不變更既有員工或部門資料）。
INSERT INTO public.organizations (code, name, description, sort_order, is_active)
VALUES
    ('tw', '台灣', 'PTS 台灣組織', 10, true),
    ('hk', '香港', 'PTS 香港組織', 20, true)
    ON CONFLICT (code) DO NOTHING;
-- I2 待辦：建立組織歸屬管理 RPC、操作稽核，並讓 H3 安全刪除
-- 封存 user_organizations 後才能移除帳號。目前 ON DELETE RESTRICT 是刻意的保護。;
