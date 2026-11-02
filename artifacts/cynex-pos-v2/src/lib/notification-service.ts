/**
 * Customer email notification queue.
 *
 * IndexedDB is the source of truth. When a configured status changes we render
 * the shop's template, save a durable outbox row, and then best-effort POST it
 * to the Vercel `/api/notify` function. Offline rows are retried when the app is
 * online again.
 *
 * The Resend API key is never referenced here. Only the serverless function
 * reads `RESEND_API_KEY` from the server environment.
 */

import { localDb } from './local-db';
import { buildTrackingMirrorPayload } from './tracking-mirror';
import { trackingPageUrl } from './tracking-config';
import { generateTrackingToken } from './tracking-token';
import { DEFAULT_SHOP_NAME } from './shop-profile';
import { normalizeTransactionStatus, type Transaction } from './db-types';
import {
  DEFAULT_EMAIL_MESSAGE_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  EMAIL_MESSAGE_MAX_LENGTH,
  EMAIL_SUBJECT_MAX_LENGTH,
  isValidEmail,
  notificationStatusLabel,
  readEmailNotificationSettings,
  renderNotificationTemplate,
  type EmailNotificationRequest,
  type EmailNotificationSettings,
  type NotificationHealth,
  type NotificationOutboxEntry,
} from './notification-types';

const NOTIFY_ENDPOINT =
  String(import.meta.env.VITE_NOTIFY_ENDPOINT || '').trim() || '/api/notify';
const NOTIFY_SECRET = String(import.meta.env.VITE_NOTIFY_API_SECRET || '').trim();
const REQUEST_TIMEOUT_MS = 15_000;
const FLUSH_INTERVAL_MS = 60_000;
const BACKOFF_SECONDS = [60, 300, 900, 1800, 3600];

let flushPromise: Promise<void> | null = null;
let flushAgain = false;
let syncStarted = false;

class NotificationRequestError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'NotificationRequestError';
    this.status = status;
    this.retryable = retryable;
  }
}

function endpointUrl(): string {
  if (/^https?:\/\//i.test(NOTIFY_ENDPOINT)) return NOTIFY_ENDPOINT;
  const path = NOTIFY_ENDPOINT.startsWith('/') ? NOTIFY_ENDPOINT : `/${NOTIFY_ENDPOINT}`;
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).toString();
}

function requestHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(NOTIFY_SECRET ? { 'x-notify-secret': NOTIFY_SECRET } : {}),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error || 'Unknown notification error');
}

function responseMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
    if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  }
  return fallback;
}

async function postNotification(
  payload: EmailNotificationRequest,
): Promise<{ id?: string; provider?: string }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpointUrl(), {
      method: 'POST',
      headers: requestHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      const retryable =
        response.status === 408 ||
        response.status === 409 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      throw new NotificationRequestError(
        responseMessage(body, `Email service returned ${response.status}`),
        response.status,
        retryable,
      );
    }

    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    // A static host or SPA fallback can answer /api/notify with 200 HTML. Only a
    // structured success response means Resend accepted the message.
    if (record.ok !== true) {
      throw new NotificationRequestError(
        'The email service returned an unexpected response. Check the /api/notify deployment.',
        502,
        true,
      );
    }
    return {
      id: typeof record.id === 'string' ? record.id : undefined,
      provider: typeof record.provider === 'string' ? record.provider : undefined,
    };
  } catch (error) {
    if (error instanceof NotificationRequestError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new NotificationRequestError('Email service timed out', 0, true);
    }
    throw new NotificationRequestError(
      error instanceof Error ? error.message : 'Could not reach the email service',
      0,
      true,
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Ask the serverless function whether Resend is configured. */
export async function getNotificationHealth(): Promise<NotificationHealth> {
  try {
    const response = await fetch(endpointUrl(), {
      method: 'GET',
      headers: NOTIFY_SECRET ? { 'x-notify-secret': NOTIFY_SECRET } : undefined,
      cache: 'no-store',
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      return {
        reachable: true,
        configured: false,
        error: responseMessage(body, `Email service returned ${response.status}`),
      };
    }
    return {
      reachable: true,
      configured: body?.configured === true,
      provider: typeof body?.provider === 'string' ? body.provider : undefined,
    };
  } catch (error) {
    return { reachable: false, configured: false, error: errorMessage(error) };
  }
}

/**
 * Send a one-off test email. It bypasses the outbox and status toggles, so an
 * admin can verify Resend before enabling customer notifications.
 *
 * `settings` is the raw key/value bag from the Settings page, so the test uses
 * the subject/message currently on screen even before the form is saved.
 */
export async function sendTestEmail(input: {
  to: string;
  shopName: string;
  settings: Record<string, any>;
}): Promise<{ id?: string; provider?: string }> {
  const to = String(input.to || '').trim();
  if (!isValidEmail(to)) {
    throw new Error('Enter a valid email address for the test');
  }

  const config = readEmailNotificationSettings(input.settings);
  const shopName = String(input.shopName || '').trim().slice(0, 120) || DEFAULT_SHOP_NAME;
  const note = 'This is a test email from your POS notification settings.';
  const variables = {
    customer_first_name: 'there',
    shop_name: shopName,
    device: 'test device',
    status: 'ready',
    status_label: notificationStatusLabel('ready'),
    note,
    job_number: 'TEST',
    tracking_url: '',
  };

  const subject =
    renderNotificationTemplate(config.subjectTemplate || DEFAULT_EMAIL_SUBJECT_TEMPLATE, variables)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, EMAIL_SUBJECT_MAX_LENGTH) || DEFAULT_EMAIL_SUBJECT_TEMPLATE;
  const message =
    renderNotificationTemplate(config.messageTemplate || DEFAULT_EMAIL_MESSAGE_TEMPLATE, variables)
      .trim()
      .slice(0, EMAIL_MESSAGE_MAX_LENGTH) || DEFAULT_EMAIL_MESSAGE_TEMPLATE;

  return postNotification({
    channel: 'email',
    eventId: `test/${Date.now()}/${Math.random().toString(36).slice(2, 10)}`,
    to,
    subject,
    message,
    shopName,
    deviceLabel: 'Test device',
    status: 'ready',
    note,
    jobNumber: 'TEST',
    test: true,
  });
}

async function loadSettingsAndShop(): Promise<{
  config: EmailNotificationSettings;
  shopName: string;
}> {
  let raw: Record<string, any> = {};
  try {
    const rows = await localDb.settings.toArray();
    raw = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  } catch {
    // Defaults are safe when the settings table cannot be read.
  }
  const storeName = typeof raw.storeName === 'string' ? raw.storeName.trim() : '';
  return {
    config: readEmailNotificationSettings(raw),
    shopName: storeName.slice(0, 120) || DEFAULT_SHOP_NAME,
  };
}

function nextAttemptAt(attempts: number): string {
  const seconds = BACKOFF_SECONDS[Math.min(Math.max(0, attempts - 1), BACKOFF_SECONDS.length - 1)];
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function requestFromEntry(entry: NotificationOutboxEntry): EmailNotificationRequest {
  return {
    channel: 'email',
    eventId: entry.dedupeKey,
    to: entry.to,
    subject: entry.subject,
    message: entry.message,
    shopName: entry.shopName,
    deviceLabel: entry.deviceLabel,
    status: entry.status,
    ...(entry.note ? { note: entry.note } : {}),
    ...(entry.trackingUrl ? { trackingUrl: entry.trackingUrl } : {}),
    ...(entry.jobNumber ? { jobNumber: entry.jobNumber } : {}),
  };
}

/**
 * Queue one status email for a transaction. Safe to call after any mutation;
 * failures never block the POS operation.
 */
export async function queueTransactionNotification(
  transactionOrId: Transaction | number,
): Promise<void> {
  try {
    const tx =
      typeof transactionOrId === 'number'
        ? await localDb.transactions.get(transactionOrId)
        : transactionOrId;
    if (!tx || typeof tx.id !== 'number') return;

    const { config, shopName } = await loadSettingsAndShop();
    if (!config.enabled) return;

    const status = normalizeTransactionStatus(tx.status);
    if (!config.statuses.includes(status)) return;

    const to = typeof tx.customerEmail === 'string' ? tx.customerEmail.trim() : '';
    if (!isValidEmail(to)) return;

    let token =
      typeof tx.trackingToken === 'string' && tx.trackingToken.trim().length >= 12
        ? tx.trackingToken.trim()
        : generateTrackingToken();
    if (token !== tx.trackingToken) {
      await localDb.transactions.update(tx.id, { trackingToken: token });
      tx.trackingToken = token;
    }

    // Reuse the tracking payload so the device label, first name, and latest
    // customer-safe note are identical on the public page and in the email.
    const mirror = buildTrackingMirrorPayload(tx, shopName, token);
    // Use the latest customer-safe note, even when the new status itself was
    // saved without one (for example completing a job after a Ready note).
    const note = [...mirror.status_history]
      .reverse()
      .find((event) => event.note)?.note?.slice(0, 240);

    const trackingUrl = trackingPageUrl(token) || '';
    const customerFirstName = mirror.customer_first_name || 'there';
    const variables = {
      customer_first_name: customerFirstName,
      shop_name: mirror.shop_name,
      device: mirror.device_label,
      status,
      status_label: notificationStatusLabel(status),
      note: note || '',
      job_number: String(tx.jobNumber || ''),
      tracking_url: trackingUrl,
    };

    const subject =
      renderNotificationTemplate(config.subjectTemplate, variables)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, EMAIL_SUBJECT_MAX_LENGTH) || DEFAULT_EMAIL_SUBJECT_TEMPLATE;
    const message =
      renderNotificationTemplate(config.messageTemplate, variables)
        .trim()
        .slice(0, EMAIL_MESSAGE_MAX_LENGTH) || DEFAULT_EMAIL_MESSAGE_TEMPLATE;

    const now = new Date().toISOString();
    const dedupeKey = `${token}:${status}`.slice(0, 220);
    const existing = await localDb.notificationOutbox.get(dedupeKey);

    // One email per ticket + status, even if the job returns to a previous
    // status later. Re-entering the same status can requeue a failed row.
    if (existing?.state === 'sent') return;

    const resend = existing?.state === 'failed';
    await localDb.notificationOutbox.put({
      dedupeKey,
      transactionId: tx.id,
      token,
      channel: 'email',
      provider: 'resend',
      to,
      subject,
      message,
      shopName: mirror.shop_name,
      deviceLabel: mirror.device_label,
      status,
      ...(note ? { note } : {}),
      ...(trackingUrl ? { trackingUrl } : {}),
      ...(tx.jobNumber ? { jobNumber: String(tx.jobNumber) } : {}),
      state: 'pending',
      attempts: resend ? 0 : existing?.attempts || 0,
      ...(resend ? {} : existing?.lastError ? { lastError: existing.lastError } : {}),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      ...(resend ? {} : existing?.nextAttemptAt ? { nextAttemptAt: existing.nextAttemptAt } : {}),
    });

    if (flushPromise) flushAgain = true;
    void flushNotificationOutbox();
  } catch (error) {
    console.warn('[notifications] could not queue email update:', error);
  }
}

async function markSent(entry: NotificationOutboxEntry): Promise<void> {
  await localDb.transaction('rw', localDb.notificationOutbox, async () => {
    const current = await localDb.notificationOutbox.get(entry.dedupeKey);
    if (!current || current.state !== 'pending') return;
    const now = new Date().toISOString();
    await localDb.notificationOutbox.put({
      ...current,
      state: 'sent',
      attempts: current.attempts + 1,
      sentAt: now,
      updatedAt: now,
      lastError: undefined,
      nextAttemptAt: undefined,
    });
  });
}

async function markFailed(entry: NotificationOutboxEntry, error: unknown): Promise<void> {
  await localDb.transaction('rw', localDb.notificationOutbox, async () => {
    const current = await localDb.notificationOutbox.get(entry.dedupeKey);
    if (!current) return;

    const message = errorMessage(error).slice(0, 300);
    const status = error instanceof NotificationRequestError ? error.status : 0;
    const permanent =
      error instanceof NotificationRequestError &&
      !error.retryable &&
      (status === 400 || status === 401 || status === 403 || status === 422);

    const now = new Date().toISOString();
    const attempts = current.attempts + 1;
    await localDb.notificationOutbox.put({
      ...current,
      state: permanent ? 'failed' : 'pending',
      attempts,
      lastError: message,
      updatedAt: now,
      ...(permanent ? {} : { nextAttemptAt: nextAttemptAt(attempts) }),
    });
  });
}

/**
 * Flush queued email notifications. No-op while offline or when another flush
 * is running. Every request carries a stable idempotency key so a retry after a
 * lost response cannot produce a duplicate email.
 */
export function flushNotificationOutbox(force = false): Promise<void> {
  if (flushPromise) return flushPromise;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve();

  flushPromise = (async () => {
    flushAgain = false;
    const entries = await localDb.notificationOutbox
      .orderBy('updatedAt')
      .toArray();
    const now = Date.now();

    for (const entry of entries) {
      if (entry.state !== 'pending') continue;
      if (!force && entry.nextAttemptAt && new Date(entry.nextAttemptAt).getTime() > now) continue;

      try {
        await postNotification(requestFromEntry(entry));
        await markSent(entry);
      } catch (error) {
        await markFailed(entry, error);
        if (!(error instanceof NotificationRequestError) || error.retryable) {
          console.warn('[notifications] email remains queued:', errorMessage(error));
        } else {
          console.warn('[notifications] email was rejected by the server:', errorMessage(error));
        }
      }
    }
  })()
    .catch((error) => {
      console.warn('[notifications] outbox flush failed:', error);
    })
    .finally(() => {
      flushPromise = null;
      if (flushAgain) {
        flushAgain = false;
        void flushNotificationOutbox();
      }
    });

  return flushPromise;
}

/** Count queued/failed emails for the Settings status panel. */
export async function getNotificationOutboxCounts(): Promise<{
  pending: number;
  failed: number;
}> {
  try {
    const rows = await localDb.notificationOutbox.toArray();
    return {
      pending: rows.filter((row) => row.state === 'pending').length,
      failed: rows.filter((row) => row.state === 'failed').length,
    };
  } catch {
    return { pending: 0, failed: 0 };
  }
}

/** Reset permanently failed rows so an admin can retry after fixing setup. */
export async function retryFailedNotifications(): Promise<number> {
  const rows = await localDb.notificationOutbox.orderBy('updatedAt').toArray();
  const failed = rows.filter((row) => row.state === 'failed');
  if (failed.length === 0) {
    await flushNotificationOutbox(true);
    return 0;
  }

  await localDb.transaction('rw', localDb.notificationOutbox, async () => {
    for (const row of failed) {
      await localDb.notificationOutbox.put({
        ...row,
        state: 'pending',
        attempts: 0,
        lastError: undefined,
        nextAttemptAt: undefined,
        updatedAt: new Date().toISOString(),
      });
    }
  });

  await flushNotificationOutbox(true);
  return failed.length;
}

/** Remove pending email rows when their job is deleted from the POS. */
export async function cancelQueuedNotificationsForTransaction(transactionId: number): Promise<void> {
  try {
    const rows = await localDb.notificationOutbox
      .where('transactionId')
      .equals(transactionId)
      .toArray();
    const pending = rows.filter((row) => row.state !== 'sent');
    if (pending.length === 0) return;
    await localDb.notificationOutbox.bulkDelete(pending.map((row) => row.dedupeKey));
  } catch (error) {
    console.warn('[notifications] could not cancel queued emails:', error);
  }
}

/**
 * Start online/visibility retries after the shop signs in. The public tracking
 * page never starts this loop.
 */
export function startNotificationSync(): void {
  if (syncStarted || typeof window === 'undefined') return;
  syncStarted = true;

  const retry = () => {
    void flushNotificationOutbox();
  };

  window.addEventListener('online', () => {
    void flushNotificationOutbox(true);
  });
  window.addEventListener('focus', retry);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retry();
  });
  window.setInterval(retry, FLUSH_INTERVAL_MS);

  void flushNotificationOutbox(true);
}
