-- ============================================================================
-- CYNEX live tracking mirror (Supabase / Postgres)
-- Run this once in the Supabase SQL editor.
--
-- Before using the POS sync, create a dedicated Auth user:
--   Supabase Dashboard -> Authentication -> Users -> Add user
--   (enable "Auto Confirm User" so the POS can sign in immediately)
-- Then set VITE_SUPABASE_SHOP_EMAIL / VITE_SUPABASE_SHOP_PASSWORD in .env.
-- ============================================================================

create table if not exists public.tracking (
  token text primary key
    check (char_length(token) >= 12 and char_length(token) <= 128),
  shop_name text not null
    check (char_length(shop_name) between 1 and 120),
  device_label text not null default ''
    check (char_length(device_label) <= 120),
  status text not null
    check (status in (
      'received', 'diagnosing', 'waiting_parts', 'repairing', 'ready', 'complete', 'cancelled'
    )),
  status_history jsonb not null default '[]'::jsonb
    check (jsonb_typeof(status_history) = 'array'),
  customer_first_name text not null default ''
    check (char_length(customer_first_name) <= 80),
  updated_at timestamptz not null default now()
);

comment on table public.tracking is
  'Customer-safe repair status mirror. Never store phone, email, prices, passcodes, or serials here.';
comment on column public.tracking.customer_first_name is
  'First name only, for the public tracking page.';
comment on column public.tracking.status_history is
  'Array of {status, timestamp, note?} entries. Notes are customer-facing.';

-- Keep updated_at server-authoritative even if an offline client sends an
-- older timestamp with a queued change.
create or replace function public.touch_tracking_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tracking_touch_updated_at on public.tracking;
create trigger tracking_touch_updated_at
before insert or update on public.tracking
for each row execute function public.touch_tracking_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.tracking enable row level security;

revoke all on table public.tracking from anon, authenticated;
grant select on table public.tracking to anon;
grant select, insert, update on table public.tracking to authenticated;

-- Anonymous visitors may read ONLY the row whose exact token they already
-- know. The POS sends the token as the x-tracking-token header. Because token
-- is the primary key, this policy can return at most one row per request; a
-- headerless anon query returns nothing and cannot enumerate the table.
drop policy if exists "anon read one row by exact token" on public.tracking;
create policy "anon read one row by exact token"
on public.tracking
for select
to anon
using (
  token = (
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-tracking-token'
  )
);

-- The authenticated shop account can read and upsert mirror rows.
drop policy if exists "shop read tracking" on public.tracking;
create policy "shop read tracking"
on public.tracking
for select
to authenticated
using (true);

drop policy if exists "shop insert tracking" on public.tracking;
create policy "shop insert tracking"
on public.tracking
for insert
to authenticated
with check (true);

drop policy if exists "shop update tracking" on public.tracking;
create policy "shop update tracking"
on public.tracking
for update
to authenticated
using (true)
with check (true);

-- No DELETE policy on purpose: the POS never deletes public tracking rows.

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- The public page subscribes to a token-scoped Supabase Realtime BROADCAST
-- channel, then re-fetches the canonical row through the RLS-protected query
-- above. Broadcast is enabled by default; no table publication is needed.
-- Direct postgres_changes are intentionally not exposed to anon because RLS
-- cannot inspect an anonymous client's custom request header in that mode.
