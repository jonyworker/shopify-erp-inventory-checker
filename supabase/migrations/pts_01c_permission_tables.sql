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