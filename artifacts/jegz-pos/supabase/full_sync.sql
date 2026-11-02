-- FixMo PH — full local-first database sync schema
--
-- Run this once in the Supabase SQL Editor (after creating the shop auth user).
-- It creates snake_case cloud tables with UUID `sync_id` primary keys, RLS for
-- authenticated shop writes, and `server_updated_at` triggers for incremental
-- pulls. The public customer tracker remains in supabase/tracking.sql.
--
-- Local IndexedDB remains the source of truth. These tables mirror every
-- business entity so 2–3 devices can share one shop database.

-- ─── Shared trigger: server timestamp for incremental pulls ─────────────────
create or replace function public.set_sync_server_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at = now();
  return new;
end;
$$;

-- ─── Catalog ────────────────────────────────────────────────────────────────
create table if not exists public.products (
  sync_id uuid primary key,
  shop_id text not null default 'fixmo-ph',
  name text not null default '',
  category text not null default '',
  price numeric not null default 0,
  selling_price numeric,
  cost numeric,
  stock numeric not null default 0,
  reserved_stock numeric not null default 0,
  reorder_point numeric,
  sku text,
  device_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.services (
  sync_id uuid primary key,
  shop_id text not null default 'fixmo-ph',
  name text not null default '',
  type text not null default '',
  price numeric not null default 0,
  cost numeric,
  duration numeric,
  category text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.technicians (
  sync_id uuid primary key,
  shop_id text not null default 'fixmo-ph',
  name text not null default '',
  email text,
  phone text,
  role text,
  specialization text,
  jobs_done numeric,
  total_sales numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

-- ─── Jobs / transactions ────────────────────────────────────────────────────
create table if not exists public.transactions (
  sync_id uuid primary key,
  shop_id text not null default 'fixmo-ph',
  customer_name text,
  customer_phone text,
  phone_brand text,
  phone_model text,
  device_passcode text,
  customer text,
  unit text,
  technician_sync_id uuid,
  technician_name text,
  payment_method text,
  status text not null default 'pending',
  repair_status text,
  tracking_token text,
  tracking_history jsonb not null default '[]'::jsonb,
  total numeric,
  total_amount numeric,
  amount_paid numeric not null default 0,
  remaining_balance numeric,
  payment_status text,
  job_number text,
  notes text,
  customer_complaint text,
  diagnosis text,
  technician_notes text,
  is_pre_order boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.transaction_items (
  sync_id uuid primary key,
  shop_id text not null default 'fixmo-ph',
  transaction_sync_id uuid,
  ref_sync_id uuid,
  type text not null default 'service',
  name text not null default '',
  quantity numeric not null default 1,
  price numeric not null default 0,
  subtotal numeric not null default 0,
  cost numeric,
  is_pre_order boolean not null default false,
  base_price numeric,
  markup_percentage numeric,
  markup_amount numeric,
  is_custom boolean not null default false,
  saved_to_list boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

-- ─── Drawers ────────────────────────────────────────────────────────────────
create table if not exists public.cash_drawer_entries (
  sync_id uuid primary key,
  shop_id text not null default 'fixmo-ph',
  type text not null default 'adjustment',
  amount numeric not null default 0,
  note text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.gcash_drawer_entries (
  sync_id uuid primary key,
  shop_id text not null default 'fixmo-ph',
  type text not null default 'adjustment',
  amount numeric not null default 0,
  note text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

-- ─── Defective items / backjobs ─────────────────────────────────────────────
create table if not exists public.defective_items (
  sync_id uuid primary key,
  shop_id text not null default 'fixmo-ph',
  product_sync_id uuid,
  product_name text,
  reason text not null default '',
  quantity numeric not null default 1,
  cost_per_unit numeric,
  total_loss numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.backjobs (
  sync_id uuid primary key,
  shop_id text not null default 'fixmo-ph',
  customer text not null default '',
  phone text,
  unit text,
  technician_sync_id uuid,
  technician_name text,
  description text,
  issue text,
  original_repair_date text,
  cause text,
  status text not null default 'pending',
  within_warranty boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

-- ─── Users / settings / audit ───────────────────────────────────────────────
create table if not exists public.users (
  sync_id uuid primary key,
  shop_id text not null default 'fixmo-ph',
  username text not null default '',
  password_hash text not null default '',
  role text not null default 'staff',
  permissions jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  sync_id uuid primary key,
  shop_id text not null default 'fixmo-ph',
  key text not null default '',
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  sync_id uuid primary key,
  shop_id text not null default 'fixmo-ph',
  created_at timestamptz not null default now(),
  username text not null default 'system',
  user_role text,
  user_sync_id uuid,
  action text not null default 'unknown',
  entity_type text,
  entity_id text,
  summary text not null default '',
  details text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

-- ─── Indexes for incremental pulls ──────────────────────────────────────────
create index if not exists products_sync_pull_idx on public.products (shop_id, server_updated_at);
create index if not exists services_sync_pull_idx on public.services (shop_id, server_updated_at);
create index if not exists technicians_sync_pull_idx on public.technicians (shop_id, server_updated_at);
create index if not exists transactions_sync_pull_idx on public.transactions (shop_id, server_updated_at);
create index if not exists transaction_items_sync_pull_idx on public.transaction_items (shop_id, server_updated_at);
create index if not exists cash_drawer_sync_pull_idx on public.cash_drawer_entries (shop_id, server_updated_at);
create index if not exists gcash_drawer_sync_pull_idx on public.gcash_drawer_entries (shop_id, server_updated_at);
create index if not exists defective_items_sync_pull_idx on public.defective_items (shop_id, server_updated_at);
create index if not exists backjobs_sync_pull_idx on public.backjobs (shop_id, server_updated_at);
create index if not exists users_sync_pull_idx on public.users (shop_id, server_updated_at);
create index if not exists settings_sync_pull_idx on public.settings (shop_id, server_updated_at);
create index if not exists activity_logs_sync_pull_idx on public.activity_logs (shop_id, server_updated_at);

-- ─── RLS: only the authenticated shop account may read/write ────────────────
do $$
declare
  t text;
  tables text[] := array[
    'products', 'services', 'technicians', 'transactions', 'transaction_items',
    'cash_drawer_entries', 'gcash_drawer_entries', 'defective_items', 'backjobs',
    'users', 'settings', 'activity_logs'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_shop_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_shop_all', t
    );
    execute format('drop trigger if exists %I on public.%I', t || '_server_updated_at', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.set_sync_server_updated_at()',
      t || '_server_updated_at', t
    );
  end loop;
end;
$$;

-- Authenticated shop account can use the sync tables. Anonymous/public access
-- is deliberately not granted here; the customer tracker is a separate table.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.products,
  public.services,
  public.technicians,
  public.transactions,
  public.transaction_items,
  public.cash_drawer_entries,
  public.gcash_drawer_entries,
  public.defective_items,
  public.backjobs,
  public.users,
  public.settings,
  public.activity_logs
to authenticated;
