# Customer email notifications

The POS can email a customer automatically when a repair reaches **Ready** or
**Complete** (or any other status you enable). The Resend API key never touches
the browser: the frontend calls the Vercel Function at `/api/notify`, and that
function reads the key from the server environment.

## What the customer receives

A responsive HTML email containing:

- the shop name,
- device label (brand + model only),
- the new status,
- the latest customer-facing note,
- job number when available,
- a **Track your device** button linking to `/track/<token>` when live tracking is configured,
- a plain-text fallback.

Prices, phone numbers, email addresses, passcodes, serial numbers, and internal
notes are not included in the email body except for the recipient address used
to deliver it.

## 1. Set up Resend

1. Create a [Resend](https://resend.com) account.
2. Verify the sending domain under **Domains**.
3. Create an API key under **API Keys**.
4. Decide the sender, for example `CYNEX Technology <updates@yourdomain.com>`.

For quick testing before a domain is verified, Resend's `onboarding@resend.dev`
sender only delivers to the account owner's address.

## 2. Configure Vercel environment variables

Add these in **Vercel → Project → Settings → Environment Variables**:

| Variable | Required | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | Yes | Resend API key. Server only. |
| `RESEND_FROM_EMAIL` | Yes | Verified sender, e.g. `Shop <updates@example.com>`. |
| `RESEND_REPLY_TO` | No | Reply-to address. |
| `NOTIFY_API_SECRET` | No | Optional shared secret checked by `/api/notify`. |

The equivalent local values go in `.env` (ignored by git). `.env` may also
contain `NOTIFY_API_SECRET` for the Vite dev adapter; it is read by Node only.

> **Never** create a `VITE_RESEND_API_KEY`. Vite embeds every `VITE_*` value in
> the browser bundle.

## 3. Configure the POS

Add these build-time variables locally and in Vercel if you use them:

```dotenv
# Optional shared secret; must match NOTIFY_API_SECRET on the server.
VITE_NOTIFY_API_SECRET=

# Optional override. Defaults to same-origin /api/notify.
VITE_NOTIFY_ENDPOINT=
```

Then rebuild/restart. Vite environment values are read at build time.

### Deploying this artifact on Vercel

The included `vercel.json` expects the Vercel **Root Directory** to be
`artifacts/cynex-pos-v2`, builds with `pnpm run build`, and publishes
`dist/public`. The rewrite intentionally excludes `/api/*` so `/api/notify`
reaches the serverless function. If the project is deployed from the repository
root instead, adapt the root `vercel.json` so its output directory and API
location point at this artifact.

For local development, `pnpm dev` includes a small adapter that handles
`/api/notify` using the server-only values from `.env`. You can also run
`npx vercel dev` from this folder.

## 4. Turn it on in Settings

Open **Settings → Customer email updates**:

- enable **Automatic email updates**,
- choose statuses (Ready and Complete are selected by default),
- edit the subject and message template,
- send a test email to verify Resend.

The message template supports these placeholders:

```
{{customer_first_name}}  {{shop_name}}  {{device}}  {{status}}
{{status_label}}         {{note}}      {{job_number}}  {{tracking_url}}
```

Unknown placeholders are left visible so typos are easy to spot. The job
details, latest note, and tracking button are added by the server below the
editable message.

## Offline behavior and duplicate protection

- Every eligible status change writes a row to the Dexie `notificationOutbox`
  table. One row exists per ticket + status.
- While online, the row is sent immediately.
- If offline, the row stays queued and is retried when the browser fires
  `online`, on window focus, when the tab becomes visible, and once a minute.
- A sent row is kept as a local delivery receipt. Returning to an earlier
  status never sends that status again.
- Every request carries a stable idempotency key (`cynex-status/<token>:<status>`),
  which Resend also uses to suppress duplicates within its 24-hour window.
- Transient failures (offline, 5xx, 408/409/425/429) remain queued and back off
  for 1, 5, 15, 30, then 60 minutes.
- Permanent rejections are paused. Settings shows how many emails failed and
  provides a **Retry failed** button after you fix the configuration.
  Re-entering the same status also requeues that ticket + status; prior
  statuses are not re-sent.
- Restoring a backup in replace mode clears queued notifications for the old
  dataset. The outbox is intentionally excluded from backups.

## API contract

`POST /api/notify` — JSON only, same-origin, optional `x-notify-secret` header.

```json
{
  "channel": "email",
  "eventId": "token:ready",
  "to": "customer@example.com",
  "subject": "Update on your Samsung A14 repair",
  "message": "Hi Maria, your device is ready for pickup.",
  "shopName": "CYNEX Technology",
  "deviceLabel": "Samsung A14",
  "status": "ready",
  "note": "Ready for pickup until 6 PM.",
  "trackingUrl": "https://pos.example.com/track/abc123",
  "jobNumber": "CYNEX-B1-2026-000042",
  "test": false
}
```

`trackingUrl` is required for customer updates and must use `http` or `https`;
`test: true` requests may omit it. The server builds the HTML itself, so the
browser never sends email markup.

`GET /api/notify` returns whether Resend is configured; the Settings page uses
this for its service badge.

## Adding SMS later

`server/notifications/types.ts` defines a channel-agnostic
`NotificationProvider`. To add Semaphore or Twilio:

1. Implement `NotificationProvider` in `server/notifications/providers/`
   (set `channel: 'sms'`).
2. Register it in `server/notifications/providers/index.ts`.
3. Extend the request validation in `server/notifications/http.ts` to accept
   the SMS channel.
4. Read the SMS key from a server-only environment variable.

The Dexie outbox already stores `channel` and `provider`, so queued data and the
Settings UI can be extended without changing the delivery model.

## Security notes

- Resend credentials are only read inside `server/`/`api/` code.
- `NOTIFY_API_SECRET` is optional and only an abuse barrier; because
  `VITE_NOTIFY_API_SECRET` is bundled, it is not a true secret.
- Recipient emails and message content are sent to Resend as the email
  provider. They are never written to Supabase or included in backups.
- The function validates and length-limits every field and escapes all
  customer/shop text before building HTML.
- The `Idempotency-Key` header is derived from the event ID, not from customer
  content.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Settings shows "Email API not reachable" | Use `pnpm dev` (adapter), `vercel dev`, or deploy to Vercel. |
| "Resend not configured" | `RESEND_API_KEY` / `RESEND_FROM_EMAIL` missing in the current environment; redeploy after adding them. |
| Resend returns 403 | The sending domain is not verified, or the sender does not match it. |
| Test works but customers do not receive mail | The job must have `customerEmail`, the status must be enabled, and automatic updates must be on. |
| Emails stay queued | Open the app while online; check the service badge and the Resend dashboard. |
