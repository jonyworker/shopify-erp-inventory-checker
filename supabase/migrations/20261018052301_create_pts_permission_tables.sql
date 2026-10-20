-- PTS Authorization System | Phase 01-C
-- Permission catalog, inheritance grants, user overrides, administrators and audit.
-- Project: PTS_tools (fdlfzvtjehoaiaunclhn)
-- IMPORTANT: This migration is for one-time application. Do not rerun after deployed.
-- No existing business tables, authentication accounts, or policies are modified.
-- No UI/client permissions are granted at this stage.

-- 1. Every tool's identifier must agree with the Vue App.vue tool value.
create table public.tool_catalog (
    id uuid primary key default gen_random_uuid(),
    tool_key text not null unique,
    label text not null,
    group_key text not null,
    description text,
    is_active boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint tool_catalog_key_format
        check (tool_key ~ '^[a-z][A-Za-z0-9]{0,79}$'),
    constraint tool_catalog_group_format
        check (group_key ~ '^[a-z][a-z0-9_]{0,49}$'),
    constraint tool_catalog_label_valid
        check (char_length(btrim(label)) between 1 and 120)
);

-- 2. Each tool supports only the operations that it actually implements.
-- requires_permission_id expresses direct prerequisites; cyclic chains will be
-- additionally rejected by the authorization service in Phase 02.
create table public.permission_catalog (
    id uuid primary key default gen_random_uuid(),
    tool_id uuid not null references public.tool_catalog(id) on delete restrict,
    permission_key text not null unique,
    action_key text not null,
    label text not null,
    description text,
    requires_permission_id uuid references public.permission_catalog(id) on delete restrict,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint permission_catalog_tool_action_unique unique (tool_id, action_key),
    constraint permission_catalog_key_format
        check (permission_key ~ '^[a-z][A-Za-z0-9]{0,79}\.[a-z][a-z0-9_]{0,49}$'),
    constraint permission_catalog_action_format
        check (action_key ~ '^[a-z][a-z0-9_]{0,49}$'),
    constraint permission_catalog_label_valid
        check (char_length(btrim(label)) between 1 and 120),
    constraint permission_catalog_no_self_dependency
        check (requires_permission_id is null or requires_permission_id <> id)
);

create index permission_catalog_requires_idx
    on public.permission_catalog (requires_permission_id)
    where requires_permission_id is not null;

-- 3. A row represents ALLOW; no row means there is no department grant.
create table public.department_permissions (
    department_id uuid not null references public.departments(id) on delete cascade,
    permission_id uuid not null references public.permission_catalog(id) on delete cascade,
    granted_at timestamptz not null default now(),
    granted_by uuid references auth.users(id) on delete set null,
    primary key (department_id, permission_id)
);

create index department_permissions_permission_idx
    on public.department_permissions (permission_id, department_id);

-- 4. A row represents ALLOW; no row means there is no role grant.
create table public.role_permissions (
    role_id uuid not null references public.business_roles(id) on delete cascade,
    permission_id uuid not null references public.permission_catalog(id) on delete cascade,
    granted_at timestamptz not null default now(),
    granted_by uuid references auth.users(id) on delete set null,
    primary key (role_id, permission_id)
);

create index role_permissions_permission_idx
    on public.role_permissions (permission_id, role_id);

-- 5. One override per (user, permission): allow, deny or absent (= inherit).
-- A null valid_from means effective immediately; null valid_until means no expiry.
create table public.user_permission_overrides (
    user_id uuid not null references public.app_profiles(user_id) on delete cascade,
    permission_id uuid not null references public.permission_catalog(id) on delete cascade,
    effect text not null,
    valid_from timestamptz,
    valid_until timestamptz,
    reason text,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, permission_id),
    constraint user_permission_overrides_effect_valid
        check (effect in ('allow', 'deny')),
    constraint user_permission_overrides_date_range_valid
        check (valid_from is null or valid_until is null or valid_until > valid_from)
);

create index user_permission_overrides_permission_idx
    on public.user_permission_overrides (permission_id, user_id);

-- 6. A system administrator may manage authorizations, but is NOT implicitly
-- granted access to every business module.
create table public.system_admins (
    user_id uuid primary key references public.app_profiles(user_id) on delete cascade,
    granted_at timestamptz not null default now(),
    granted_by uuid references auth.users(id) on delete set null
);

-- 7. Auditable change history. Client roles have no table privileges.
-- The service_role has INSERT and SELECT only: logs must not be rewritten.
create table public.permission_audit_logs (
    id uuid primary key default gen_random_uuid(),
    actor_user_id uuid references auth.users(id) on delete set null,
    target_user_id uuid references auth.users(id) on delete set null,
    entity_type text not null,
    entity_id uuid,
    action_key text not null,
    old_value jsonb,
    new_value jsonb,
    reason text,
    created_at timestamptz not null default now(),
    constraint permission_audit_logs_entity_type_format
        check (entity_type ~ '^[a-z][a-z0-9_]{0,79}$'),
    constraint permission_audit_logs_action_format
        check (action_key ~ '^[a-z][a-z0-9_]{0,49}$')
);

create index permission_audit_logs_actor_created_idx
    on public.permission_audit_logs (actor_user_id, created_at desc);
create index permission_audit_logs_target_created_idx
    on public.permission_audit_logs (target_user_id, created_at desc);
create index permission_audit_logs_entity_created_idx
    on public.permission_audit_logs (entity_type, entity_id, created_at desc);

-- 8. Deny direct access by default. Phase 02/03 will add narrowly scoped
-- read functions/policies and privileged, fully validated management methods.
alter table public.tool_catalog enable row level security;
alter table public.permission_catalog enable row level security;
alter table public.department_permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.system_admins enable row level security;
alter table public.permission_audit_logs enable row level security;

revoke all privileges on table
    public.tool_catalog,
    public.permission_catalog,
    public.department_permissions,
    public.role_permissions,
    public.user_permission_overrides,
    public.system_admins,
    public.permission_audit_logs
from public, anon, authenticated, service_role;

grant select, insert, update, delete on table
    public.tool_catalog,
    public.permission_catalog,
    public.department_permissions,
    public.role_permissions,
    public.user_permission_overrides,
    public.system_admins
 to service_role;

grant select, insert on table public.permission_audit_logs to service_role;

comment on table public.tool_catalog is 'PTS registered Vue application tools.';
comment on table public.permission_catalog is 'Operations supported by each PTS tool, with optional prerequisite.';
comment on table public.department_permissions is 'Default allow grants inherited through active departments.';
comment on table public.role_permissions is 'Allow grants inherited through active business roles.';
comment on table public.user_permission_overrides is 'Explicit per-user allow or deny, with optional validity dates.';
comment on table public.system_admins is 'Authorization administrators, separate from business-module permissions.';
comment on table public.permission_audit_logs is 'Append-only authorization change history managed by trusted backend.';
;
