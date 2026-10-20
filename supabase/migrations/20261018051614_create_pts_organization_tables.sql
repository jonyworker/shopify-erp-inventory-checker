-- PTS Authorization System | Phase 01-B
-- Initial organization tables. No changes to existing business tables.
-- RLS is enabled without client-facing policies at this stage.

create table public.app_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    is_active boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint app_profiles_display_name_valid
        check (display_name is null or char_length(btrim(display_name)) between 1 and 120)
);

create table public.departments (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    name text not null,
    description text,
    is_active boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint departments_code_format check (code ~ '^[a-z][a-z0-9_]{0,49}$'),
    constraint departments_name_valid check (char_length(btrim(name)) between 1 and 120)
);

create table public.business_roles (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    name text not null,
    description text,
    is_active boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint business_roles_code_format check (code ~ '^[a-z][a-z0-9_]{0,49}$'),
    constraint business_roles_name_valid check (char_length(btrim(name)) between 1 and 120)
);

create table public.user_departments (
    user_id uuid not null references public.app_profiles(user_id) on delete cascade,
    department_id uuid not null references public.departments(id) on delete restrict,
    assigned_at timestamptz not null default now(),
    assigned_by uuid references auth.users(id) on delete set null,
    primary key (user_id, department_id)
);

create table public.user_business_roles (
    user_id uuid not null references public.app_profiles(user_id) on delete cascade,
    role_id uuid not null references public.business_roles(id) on delete restrict,
    assigned_at timestamptz not null default now(),
    assigned_by uuid references auth.users(id) on delete set null,
    primary key (user_id, role_id)
);

-- Composite primary keys optimize user lookups; reverse indexes optimize
-- department/role membership queries.
create index user_departments_department_user_idx
    on public.user_departments (department_id, user_id);
create index user_business_roles_role_user_idx
    on public.user_business_roles (role_id, user_id);

-- Newly created tables must not be accessible to application users yet.
alter table public.app_profiles enable row level security;
alter table public.departments enable row level security;
alter table public.business_roles enable row level security;
alter table public.user_departments enable row level security;
alter table public.user_business_roles enable row level security;

revoke all on table
    public.app_profiles,
    public.departments,
    public.business_roles,
    public.user_departments,
    public.user_business_roles
from anon, authenticated;

-- Reserved for trusted backend tasks. Never use a service role key in Vue.
grant select, insert, update, delete on table
    public.app_profiles,
    public.departments,
    public.business_roles,
    public.user_departments,
    public.user_business_roles
 to service_role;

comment on table public.app_profiles is 'PTS employee profiles linked to Supabase Auth (disabled by default).';
comment on table public.departments is 'PTS organization departments.';
comment on table public.business_roles is 'PTS cross-department business roles.';
comment on table public.user_departments is 'PTS employee-to-department assignments (many-to-many).';
comment on table public.user_business_roles is 'PTS employee-to-role assignments (many-to-many).';
;
