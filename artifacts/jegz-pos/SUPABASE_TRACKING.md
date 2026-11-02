# FixMo PH - Supabase Live Tracking

This app now supports **customer-safe, realtime cross-device tracking** via Supabase. Local IndexedDB remains the source of truth; status changes are mirrored to Supabase with an unguessable token and shown on `/track/:token`.

> The POS now also syncs all shop data to Supabase. See [`SUPABASE_FULL_SYNC.md`](./SUPABASE_FULL_SYNC.md) for the full database setup, migration, and conflict handling.

## 1) Create the Supabase tables
1. Open your Supabase project → **SQL Editor**.
2. Run [`supabase/tracking.sql`](./supabase/tracking.sql).
3. Run [`supabase/full_sync.sql`](./supabase/full_sync.sql) too if you want jobs, inventory, customers, and settings shared across devices.
4. Create a dedicated auth user: **Authentication → Users → Add user** (enable **Auto Confirm User**). This account is used by the POS to sync rows.

## 2) Configure environment variables
Create/update `.env` in `artifacts/jegz-pos/` (or your host's env):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_SUPABASE_SHOP_EMAIL=tracking-shop@yourdomain.com
VITE_SUPABASE_SHOP_PASSWORD=strong-password
VITE_SUPABASE_SHOP_ID=fixmo-ph
# Optional: set when deployed behind a custom domain/subpath
# VITE_PUBLIC_URL=https://your-domain.com
```

Notes:
- The **anon key** is exposed to the browser but protected by RLS (anon can only read one row when `x-tracking-token` header matches).
- The shop auth session is stored in `localStorage` (`fixmo-tracking-shop-auth`) and used only for inserts/updates.
- Without these values, tracking still works **on the shop device** (local IndexedDB + legacy `/track?ticket=`) and QR codes fall back to the legacy link.

## 3) How it works
- When a job is created/updated/completed/cancelled or repair status changes, the POS builds a **customer-safe** snapshot (shop name, first name only, device label, job number, job status, repair status, repair timeline). Prices, phone, email, passcodes, serials, and internal notes are never sent.
- A pending row is written to Dexie `trackingOutbox` and upserted to Supabase when online/authenticated. Changes are retried on reconnect, focus, visibility change, and every 60s.
- On status change the POS broadcasts on a token-scoped Realtime channel; the public page re-fetches the canonical row and also polls every 30s as a fallback.
- The **Share Tracking Link** and printed QR codes now prefer `/track/<token>` (works from any device). Legacy `/track?ticket=` still works as a fallback.

## 4) Test
1. Sign in to the POS (tracking sync starts on login).
2. Create/save a job and click **Share Tracking Link** in Transactions (or print a slip/receipt).
3. Open that link on another device/network — status should update in realtime as the technician changes **Repair progress** or the job advances.
4. If the public page shows "Repair ticket not found" but works on the shop device, confirm the Supabase env vars and that the dedicated shop user can sign in.

## Privacy & safety
- Anonymous access requires the exact token (sent via header + RLS). Tokens are 24-char URL-safe and cannot be enumerated.
- No customer PII leaves the POS except a **first name only** (walk-ins/phone-like values are omitted).
- The mirror table has no delete policy; the POS never deletes public rows.
- The server trigger forces `updated_at = now()` on every write.
