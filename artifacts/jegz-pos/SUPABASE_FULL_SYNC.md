# FixMo PH — Full Supabase Sync

FixMo PH is now **local-first with full Supabase sync**:

- IndexedDB is still the source of truth while using the POS.
- Every create, edit, delete, job status change, stock change, drawer entry, user, setting, backjob, defective item, and activity log is queued and uploaded to Supabase.
- When another device changes something, this device pulls it automatically on reconnect, focus, login, and every 60 seconds.
- Conflicts use **last-write-wins** by each record's `updatedAt` timestamp.
- Deletes are soft-deleted in the cloud with `deleted_at`; other devices remove the row when they pull the tombstone.
- Customer tracking (`/track/:token`) remains a separate, customer-safe table.

## 1) Run both SQL files

In Supabase → **SQL Editor**, run in this order:

1. [`supabase/tracking.sql`](./supabase/tracking.sql) — public tracking mirror.
2. [`supabase/full_sync.sql`](./supabase/full_sync.sql) — all shop tables.

Then create/confirm one dedicated shop auth user:

**Authentication → Users → Add user** → enable **Auto Confirm User**.

Use that same user for `VITE_SUPABASE_SHOP_EMAIL` / `VITE_SUPABASE_SHOP_PASSWORD`. The anon key does not need any extra grants: only `authenticated` can read/write the shop tables, and anonymous visitors can only read one tracking row when they know its exact token.

## 2) Environment variables

Set these in `.env` locally and in your host (Vercel → Project → Settings → Environment Variables → **Production**):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_SUPABASE_SHOP_EMAIL=your-shop-login@example.com
VITE_SUPABASE_SHOP_PASSWORD=your-strong-password
VITE_SUPABASE_SHOP_ID=fixmo-ph
VITE_PUBLIC_URL=https://your-deployed-domain.com
```

**Redeploy after changing these values.** Vite embeds `VITE_*` variables at build time, so editing them in Vercel without a new deployment does not update the live app.

## 3) What syncs

| Local Dexie table | Supabase table |
| --- | --- |
| `products` | `products` |
| `services` | `services` |
| `technicians` | `technicians` |
| `transactions` | `transactions` |
| `transactionItems` | `transaction_items` |
| `cashDrawerEntries` | `cash_drawer_entries` |
| `gcashDrawerEntries` | `gcash_drawer_entries` |
| `defectiveItems` | `defective_items` |
| `backjobs` | `backjobs` |
| `users` | `users` |
| `settings` | `settings` |
| `activityLogs` | `activity_logs` |

`meta` stays device-local, except for installed device ID and sync cursors.

## 4) How records are linked

Local numeric auto-increment IDs stay in place so the existing UI keeps working. Each record also gets:

- `syncId` — a stable UUID used as the cloud primary key.
- `updatedAt` — the last local edit time.
- `*SyncId` fields for relationships (`technicianSyncId`, `transactionSyncId`, `refSyncId`, `productSyncId`, `userSyncId`).

When a record is pulled, the app maps the cloud UUID back to the local numeric row and resolves parent/child relationships. For example, a `transaction_items` row arrives with `transaction_sync_id`; the app finds the local transaction and sets its numeric `transactionId`.

## 5) Existing data migration

On the first launch after this update, Dexie upgrades to v6 and:

1. Backfills `syncId`, `updatedAt`, and relationship UUIDs on all existing rows.
2. Sets a one-time `sync.needsInitialUpload` marker.
3. After login, the sync engine queues every local row and uploads it to Supabase.
4. Remote rows uploaded by another device are merged with last-write-wins.

A fresh second/third device pulls the existing cloud database **before** demo seeding, so it does not upload demo products on top of the real catalog.

## 6) Offline behavior

- Local writes always succeed first, even offline.
- Each write is stored in `syncOutbox` as `${table}:${syncId}`.
- Repeated edits to the same record replace the queued payload instead of growing the queue.
- On reconnect, the outbox is pushed in batches, then the app pulls everything newer than `sync.lastPulledAt`.
- Failed uploads keep their original `updatedAt` (so LWW stays correct) and retry later.
- The **Settings → Cloud sync** card shows connection state, pending changes, last sync time, and the last error. **Sync now** triggers a manual pass.

## 7) Conflict handling

For every queued record, the app checks the cloud row's `updated_at` first:

- Cloud newer → drop the local queued change and pull the cloud winner.
- Local same/newer → upload the local payload.
- Cloud has a newer `deleted_at` → treat the delete as the winner.

This is intentionally simple for a 2–3 device single-shop setup. There is no merge of two different edits to the same field; the later `updatedAt` wins.

## 8) Testing

Use incognito or clear site data after deploying so the PWA does not serve an old bundle.

1. Sign in on Device A. Open **Settings → Cloud sync** and confirm `Online`, `0` pending, and a recent sync time.
2. Create/edit a product or job. Pending should briefly rise, then return to 0.
3. Sign in on Device B (fresh browser profile). It should pull the catalog/jobs from Supabase before showing demo data.
4. Edit on Device B, wait for sync, then focus Device A. Device A should pull the change.
5. Go offline on Device A, create a job, then reconnect. The job should upload automatically.
6. Open a tracking link on a third device. It should show the repair progress and update in realtime.

## 9) Troubleshooting

| Symptom | Check |
| --- | --- |
| `Supabase is not configured` | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` were present at build time, then redeploy. |
| `Supabase shop login failed: Invalid login credentials` | The dedicated Auth user does not exist, or the Vercel password does not match it. Create/reset it in **Authentication → Users** and enable **Auto Confirm User**. The Supabase dashboard login is not the same as an Auth user. |
| `Email not confirmed` | Confirm the shop user in **Authentication → Users**, or recreate it with **Auto Confirm User** enabled. |
| Pending changes never drop | Confirm the dedicated shop user is confirmed and can sign in. Open the Cloud sync card for the last error. |
| `relation "public.products" does not exist` | Run [`supabase/full_sync.sql`](./supabase/full_sync.sql). |
| `new row violates row-level security policy` | Run the full SQL, confirm you are using the authenticated shop account (not the anon key as a user). |
| A delete comes back after reconnect | Make sure the delete was queued before the row was removed; the app queues a `deleted_at` tombstone for all service-layer deletes. |
| Tracking still says “Repair ticket not found” | Run [`supabase/tracking.sql`](./supabase/tracking.sql), confirm the job has a `trackingToken`, and re-share/reprint the token link. |
| Old QR code opens `/track?ticket=...` and fails on another phone | That legacy link only reads the shop device's IndexedDB. Reprint/re-share the `/track/:token` link. |
| App shows old code after deploy | Clear site data / use incognito; the service worker may have cached the previous bundle. |

## 10) Security notes

- Shop tables are protected by RLS and granted only to `authenticated`.
- The shop session is stored in `localStorage` under `fixmo-tracking-shop-auth`.
- The public tracking table is intentionally separate and customer-safe. It excludes phone, email, prices, passcodes, serials, and internal notes.
- `users.password_hash` is synced so another device can keep local staff login working. It is bcrypt-hashed, and the cloud table is not readable by anonymous users.
- Backups still work locally; **Replace All Data** now tombstones rows that are not in the backup and re-uploads the backup rows so the cloud mirrors the restore.
