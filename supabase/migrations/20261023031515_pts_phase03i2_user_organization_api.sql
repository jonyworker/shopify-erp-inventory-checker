-- PTS Phase 03-I2
-- Admin-only read / replace user organization memberships, with primary organization.
-- Does not grant tool permissions; leaves Phase H3 safe deletion fail-closed.
-- Apply through a new timestamped migration; never edit earlier migrations.

CREATE OR REPLACE FUNCTION pts_private.pts_admin_list_user_organizations(p_target_user_id uuid)
RETURNS TABLE (
  organization_id uuid,
  organization_code text,
  organization_name text,
  organization_description text,
  is_active boolean,
  is_assigned boolean,
  is_primary boolean,
  sort_order integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT coalesce(pts_private.pts_my_is_system_admin(), false)
     OR NOT coalesce(pts_private.pts_employee_business_session_active(), false) THEN
    RAISE EXCEPTION 'PTS administrator authorization required' USING ERRCODE = '42501';
END IF;

  IF p_target_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.app_profiles ap WHERE ap.user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'PTS profile not found' USING ERRCODE = 'P0002';
END IF;

RETURN QUERY
SELECT o.id, o.code, o.name, o.description, o.is_active,
       (uo.user_id IS NOT NULL), coalesce(uo.is_primary, false), o.sort_order
FROM public.organizations o
         LEFT JOIN public.user_organizations uo
                   ON uo.organization_id = o.id AND uo.user_id = p_target_user_id
ORDER BY o.sort_order, o.name, o.id;
END;
$$;
CREATE OR REPLACE FUNCTION public.pts_admin_user_organizations(p_target_user_id uuid)
RETURNS TABLE (
  organization_id uuid,
  organization_code text,
  organization_name text,
  organization_description text,
  is_active boolean,
  is_assigned boolean,
  is_primary boolean,
  sort_order integer
)
LANGUAGE sql STABLE SET search_path = ''
AS $$
SELECT * FROM pts_private.pts_admin_list_user_organizations(p_target_user_id);
$$;
CREATE OR REPLACE FUNCTION pts_private.pts_admin_replace_user_organizations(
  p_target_user_id uuid,
  p_organization_ids uuid[],
  p_primary_organization_id uuid,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
v_target public.app_profiles%ROWTYPE;
  v_actor uuid := (SELECT auth.uid());
  v_old_ids uuid[];
  v_new_ids uuid[];
  v_old_primary uuid;
  v_bad_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF NOT coalesce(pts_private.pts_my_is_system_admin(), false)
     OR NOT coalesce(pts_private.pts_employee_business_session_active(), false) THEN
    RAISE EXCEPTION 'PTS administrator authorization required' USING ERRCODE = '42501';
END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'PTS profile not found' USING ERRCODE = 'P0002';
END IF;
  IF p_organization_ids IS NULL THEN
    RAISE EXCEPTION 'Organization IDs required; use empty array to clear memberships'
      USING ERRCODE = '22023';
END IF;
  IF cardinality(p_organization_ids) > 64
    OR EXISTS(SELECT 1 FROM unnest(p_organization_ids) x(id) WHERE x.id IS NULL)
    OR cardinality(p_organization_ids) <> (
      SELECT count(DISTINCT x.id)::integer FROM unnest(p_organization_ids) x(id)
    ) THEN
    RAISE EXCEPTION 'Organization IDs must be unique, non-null, and at most 64'
      USING ERRCODE = '22023';
END IF;
  IF (cardinality(p_organization_ids) = 0 AND p_primary_organization_id IS NOT NULL)
     OR (cardinality(p_organization_ids) > 0 AND
        (p_primary_organization_id IS NULL OR
         NOT (p_primary_organization_id = ANY(p_organization_ids)))) THEN
    RAISE EXCEPTION 'Primary organization must be one selected organization (or null for empty list)'
      USING ERRCODE = '22023';
END IF;

  -- Lock one profile row per employee to serialize concurrent administrator updates.
SELECT * INTO v_target FROM public.app_profiles ap
WHERE ap.user_id = p_target_user_id FOR UPDATE;
IF NOT FOUND THEN
    RAISE EXCEPTION 'PTS profile not found' USING ERRCODE = 'P0002';
END IF;

  -- H3 prepared/deleted/needs-review archives must not be invalidated.
  IF EXISTS (
    SELECT 1 FROM pts_private.pts_deleted_employee_archives a
     WHERE a.former_user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Employee deletion archive exists; organization changes denied'
      USING ERRCODE = '42501';
END IF;

SELECT coalesce(array_agg(uo.organization_id ORDER BY uo.organization_id), ARRAY[]::uuid[])
INTO v_old_ids FROM public.user_organizations uo WHERE uo.user_id = p_target_user_id;
SELECT uo.organization_id INTO v_old_primary
FROM public.user_organizations uo
WHERE uo.user_id = p_target_user_id AND uo.is_primary = true
    LIMIT 1;
SELECT coalesce(array_agg(x.id ORDER BY x.id), ARRAY[]::uuid[])
INTO v_new_ids FROM unnest(p_organization_ids) x(id);

SELECT x.id INTO v_bad_id
FROM unnest(v_new_ids) x(id)
         LEFT JOIN public.organizations o ON o.id = x.id
WHERE o.id IS NULL LIMIT 1;
IF FOUND THEN
    RAISE EXCEPTION 'Unknown organization ID: %', v_bad_id USING ERRCODE = '22023';
END IF;

  -- Inactive employees cannot acquire organization memberships.
  -- Existing memberships may be explicitly cleared with reason for H3 cleanup.
  IF NOT v_target.is_active AND cardinality(v_new_ids) > 0 THEN
    RAISE EXCEPTION 'Cannot assign organizations to an inactive PTS account'
      USING ERRCODE = '22023';
END IF;

  -- Existing disabled memberships may be retained; new ones may not be added.
SELECT o.id INTO v_bad_id FROM public.organizations o
WHERE o.id = ANY(v_new_ids) AND NOT o.is_active
  AND NOT (o.id = ANY(v_old_ids)) LIMIT 1;
IF FOUND THEN
    RAISE EXCEPTION 'Cannot newly assign inactive organization: %', v_bad_id
      USING ERRCODE = '22023';
END IF;

  IF v_old_ids = v_new_ids
     AND v_old_primary IS NOT DISTINCT FROM p_primary_organization_id THEN
    RETURN cardinality(v_new_ids);
END IF;

  IF char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Reason of 1-500 characters required for organization changes'
      USING ERRCODE = '22023';
END IF;

DELETE FROM public.user_organizations uo
WHERE uo.user_id = p_target_user_id
  AND NOT (uo.organization_id = ANY(v_new_ids));

-- Clear the old primary first to respect the partial unique index on primary.
UPDATE public.user_organizations SET is_primary = false
WHERE user_id = p_target_user_id AND is_primary;

INSERT INTO public.user_organizations (user_id, organization_id, is_primary)
SELECT p_target_user_id, x.id, false FROM unnest(v_new_ids) x(id)
    ON CONFLICT (user_id, organization_id) DO NOTHING;

UPDATE public.user_organizations SET is_primary = true
WHERE user_id = p_target_user_id
  AND organization_id = p_primary_organization_id;

INSERT INTO public.permission_audit_logs
(actor_user_id, target_user_id, entity_type, entity_id,
 action_key, old_value, new_value, reason)
VALUES
    (v_actor, p_target_user_id, 'user_organization', p_target_user_id,
     'set_organizations',
     jsonb_build_object(
             'organization_ids',v_old_ids,'primary_organization_id',v_old_primary,
             'organization_codes',(
                 SELECT coalesce(jsonb_agg(o.code ORDER BY o.code),'[]'::jsonb)
                 FROM public.organizations o WHERE o.id = ANY(v_old_ids)
             )
     ),
     jsonb_build_object(
             'organization_ids',v_new_ids,'primary_organization_id',p_primary_organization_id,
             'organization_codes',(
                 SELECT coalesce(jsonb_agg(o.code ORDER BY o.code),'[]'::jsonb)
                 FROM public.organizations o WHERE o.id = ANY(v_new_ids)
             )
     ),
     v_reason);

RETURN cardinality(v_new_ids);
END;
$$;
CREATE OR REPLACE FUNCTION public.pts_admin_save_user_organizations(
  p_target_user_id uuid,
  p_organization_ids uuid[],
  p_primary_organization_id uuid,
  p_reason text
)
RETURNS integer
LANGUAGE sql SET search_path = ''
AS $$
SELECT pts_private.pts_admin_replace_user_organizations(
               p_target_user_id,p_organization_ids,p_primary_organization_id,p_reason
       );
$$;
-- No anonymous entry, no default PUBLIC function execute privileges.
REVOKE ALL ON FUNCTION pts_private.pts_admin_list_user_organizations(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pts_private.pts_admin_replace_user_organizations(uuid,uuid[],uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pts_admin_user_organizations(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pts_admin_save_user_organizations(uuid,uuid[],uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pts_private.pts_admin_list_user_organizations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pts_private.pts_admin_replace_user_organizations(uuid,uuid[],uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pts_admin_user_organizations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pts_admin_save_user_organizations(uuid,uuid[],uuid,text) TO authenticated;
-- H3: existing public.user_organizations FK is ON DELETE RESTRICT and the
-- H3 delete-preflight treats it as unreviewed business linkage. Thus a user
-- with organizations cannot be permanently deleted until an admin explicitly
-- clears memberships (audited by this API), even after suspension. Do NOT
-- silently switch the FK to CASCADE before snapshot/trigger support exists.;
