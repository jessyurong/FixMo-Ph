# Live repair tracking

The POS keeps IndexedDB as its source of truth. A small, customer-safe copy of
each ticket is mirrored to Supabase so a customer can open a public, read-only
tracking page:

```
https://your-pos.example.com/track/<unguessable-token>
```

The public page is outside the POS login and never touches local IndexedDB.

## 1. Set up Supabase

1. Create a free Supabase project.
2. Open **SQL Editor** and run [`supabase/tracking.sql`](./supabase/tracking.sql).
3. Open **Authentication → Users** and add a dedicated email/password user for
   this POS (enable **Auto Confirm User**). This is the account used by the POS
   for writes.
4. Copy the project URL and **anon** public key from **Project Settings → API**.
   Never use the `service_role` key in this frontend.

## 2. Configure `.env`

Copy `.env.example` to `.env` (a blank `.env` is included) and fill in:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
VITE_SUPABASE_SHOP_EMAIL=tracking-shop@example.com
VITE_SUPABASE_SHOP_PASSWORD=the-password-you-created
VITE_PUBLIC_URL=https://your-pos.example.com
```

`VITE_PUBLIC_URL` is the public origin used in receipt QR codes. It can include
a sub-path. If left blank, the app falls back to the current browser origin.

> **Security note:** Vite embeds every `VITE_*` value in the browser bundle.
> Use a dedicated Supabase Auth user for this POS, do not reuse an account with
> other access, and rotate the password if the bundle is public. The anon key is
> safe to expose; the SQL policies restrict anonymous visitors to one row when
> they know its exact token.

## 3. Run the POS

```bash
pnpm install
pnpm run dev
```

Create a ticket or change a status. The POS upserts only these fields:

- `token`
- `shop_name`
- `device_label` (brand + model)
- `status`
- `status_history` (`{status, timestamp, note?}`)
- `customer_first_name` (first name only)
- `updated_at`

Phone, email, prices, passcodes, serial numbers, and internal notes are not sent.

## Offline behavior

Every create/status change is written to the Dexie `trackingOutbox` table
(one row per token, containing only the latest state) and then sent to
Supabase best-effort. If the device is offline:

- the local job still saves normally,
- the mirror stays queued,
- the queue is retried when the browser fires `online`, on window focus, when
  the tab becomes visible, and once a minute.

The outbox is intentionally not included in POS backups.

## Realtime

The public page subscribes to a token-scoped Supabase Realtime **broadcast**
channel. When an upsert succeeds the POS sends a small `{ token }` signal; the
page re-fetches the canonical row through the RLS-protected REST query. This
avoids exposing `postgres_changes` to anonymous clients. A 30-second visibility-
aware poll is kept as a fallback.

## RLS summary

- Anonymous: select allowed only when the `x-tracking-token` request header
  equals the row's primary-key `token`. At most one row can be returned.
- Authenticated shop account: select/insert/update.
- No anonymous or authenticated delete policy.

## Related

Customer email notifications reuse this ticket token for their **Track your
device** button. Setup, queueing, and Resend configuration are documented in
[`EMAIL_NOTIFICATIONS.md`](./EMAIL_NOTIFICATIONS.md).
