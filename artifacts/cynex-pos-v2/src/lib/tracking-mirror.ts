/**
 * Public live-tracking mirror.
 *
 * IndexedDB remains the source of truth. When a ticket is created or its
 * status changes we write a small, customer-safe payload to a Dexie outbox,
 * then best-effort upsert it to Supabase. Offline writes stay queued and are
 * retried when the browser comes back online.
 *
 * Privacy boundary: only the fields in `TrackingMirrorPayload` leave the POS.
 * Phone, email, prices, passcodes, serials, and internal notes are never sent.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { localDb } from './local-db';
import { normalizeTransactionStatus, TRANSACTION_STATUSES } from './db-types';
import type {
  TrackingMirrorPayload,
  TrackingOutboxEntry,
  Transaction,
  TransactionStatus,
  TransactionStatusEvent,
} from './db-types';
import { generateTrackingToken } from './tracking-token';
import {
  SUPABASE_ANON_KEY,
  SUPABASE_SHOP_EMAIL,
  SUPABASE_SHOP_PASSWORD,
  SUPABASE_URL,
  hasShopSyncCredentials,
  isSupabaseConfigured,
  trackingChannelName,
} from './tracking-config';
import { DEFAULT_SHOP_NAME } from './shop-profile';

const PUBLIC_STATUSES = new Set<string>([...TRANSACTION_STATUSES, 'cancelled']);
const MAX_HISTORY = 50;
const MAX_NOTE = 240;
const AUTH_FAILURE_BACKOFF_MS = 30_000;

let shopClient: SupabaseClient | null = null;
let flushPromise: Promise<void> | null = null;
let flushAgain = false;
let lastFlushAt = 0;
let lastAuthFailureAt = 0;
let lastAuthError = '';
let syncStarted = false;

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function looksLikePhone(value: string): boolean {
  const compact = value.replace(/[^\d+]/g, '');
  return compact.replace(/\D/g, '').length >= 7 || /^[\d+\-()\s]{7,}$/.test(value);
}

/** Build a safe "Samsung A14"-style label from brand/model fields only. */
function deviceLabelFor(tx: Transaction): string {
  const brand = cleanText(tx.phoneBrand, 32);
  const model = cleanText(tx.phoneModel, 60);

  if (brand && model) {
    return model.toLowerCase().startsWith(brand.toLowerCase())
      ? model
      : cleanText(`${brand} ${model}`, 80);
  }
  if (model) return model;
  if (brand) return brand;

  const genericModel = cleanText(tx.unitModel, 60);
  const genericType = cleanText(tx.unitType, 32);
  if (genericModel) {
    return genericType && !genericModel.toLowerCase().startsWith(genericType.toLowerCase())
      ? cleanText(`${genericType} ${genericModel}`, 80)
      : genericModel;
  }

  const legacyUnit = cleanText(tx.unit, 60);
  if (legacyUnit && !looksLikePhone(legacyUnit)) return legacyUnit;

  return 'Device';
}

/** Only the first name is ever mirrored. Walk-ins and phone-like values stay blank. */
function customerFirstNameFor(tx: Transaction): string {
  const fullName = cleanText(tx.customerName || tx.customer, 120);
  if (!fullName || /^walk[\s-]?in$/i.test(fullName)) return '';
  if (fullName.includes('@') || looksLikePhone(fullName)) return '';

  const first = fullName.split(' ')[0] || '';
  if (!first || first.includes('@') || looksLikePhone(first)) return '';
  return cleanText(first, 40);
}

function normalizedHistoryFor(tx: Transaction, status: TransactionStatus): TransactionStatusEvent[] {
  const fallbackDate = new Date(tx.createdAt || tx.updatedAt || Date.now());
  const fallbackTimestamp = Number.isNaN(fallbackDate.getTime())
    ? new Date().toISOString()
    : fallbackDate.toISOString();
  const history: TransactionStatusEvent[] = [];

  for (const entry of Array.isArray(tx.statusHistory) ? tx.statusHistory : []) {
    if (!entry || typeof entry !== 'object') continue;
    const entryStatus = normalizeTransactionStatus(entry.status);
    if (!PUBLIC_STATUSES.has(entryStatus)) continue;

    const parsed = new Date(entry.timestamp || fallbackTimestamp);
    const timestamp = Number.isNaN(parsed.getTime()) ? fallbackTimestamp : parsed.toISOString();
    const note = cleanText(entry.note, MAX_NOTE);

    history.push({
      status: entryStatus,
      timestamp,
      ...(note ? { note } : {}),
    });
  }

  if (history.length === 0) {
    history.push({ status, timestamp: fallbackTimestamp });
  } else if (history[history.length - 1].status !== status) {
    const parsed = new Date(tx.updatedAt || fallbackTimestamp);
    history.push({
      status,
      timestamp: Number.isNaN(parsed.getTime()) ? fallbackTimestamp : parsed.toISOString(),
    });
  }

  return history.slice(-MAX_HISTORY);
}

/** Construct the exact, customer-safe row that is mirrored. */
export function buildTrackingMirrorPayload(
  tx: Transaction,
  shopName: string,
  token: string,
): TrackingMirrorPayload {
  const status = normalizeTransactionStatus(tx.status);
  const statusHistory = normalizedHistoryFor(tx, status);
  const lastTimestamp = statusHistory[statusHistory.length - 1]?.timestamp;
  const updatedAtCandidate = tx.updatedAt || lastTimestamp || tx.createdAt || new Date().toISOString();
  const updatedAtDate = new Date(updatedAtCandidate);

  return {
    token,
    shop_name: cleanText(shopName, 120) || DEFAULT_SHOP_NAME,
    device_label: deviceLabelFor(tx),
    status,
    status_history: statusHistory,
    customer_first_name: customerFirstNameFor(tx),
    updated_at: Number.isNaN(updatedAtDate.getTime())
      ? new Date().toISOString()
      : updatedAtDate.toISOString(),
  };
}

async function loadShopName(): Promise<string> {
  try {
    const rows = await localDb.settings.toArray();
    const storeName = rows.find((row) => row.key === 'storeName')?.value;
    return cleanText(storeName, 120) || DEFAULT_SHOP_NAME;
  } catch {
    return DEFAULT_SHOP_NAME;
  }
}

function getShopClient(): SupabaseClient {
  if (!shopClient) {
    shopClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'cynex-tracking-shop-auth',
      },
    });
  }
  return shopClient;
}

/** Use the persisted shop session, or sign in with the dedicated shop account. */
async function getAuthenticatedShopClient(): Promise<SupabaseClient> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase tracking is not configured');
  }

  if (lastAuthFailureAt && Date.now() - lastAuthFailureAt < AUTH_FAILURE_BACKOFF_MS) {
    throw new Error(lastAuthError || 'Shop authentication is temporarily paused');
  }

  const client = getShopClient();
  const { data, error } = await client.auth.getSession();
  if (error) {
    lastAuthFailureAt = Date.now();
    lastAuthError = error.message;
    throw error;
  }
  if (data.session) return client;

  if (!hasShopSyncCredentials()) {
    throw new Error('Missing VITE_SUPABASE_SHOP_EMAIL / VITE_SUPABASE_SHOP_PASSWORD');
  }

  const { error: signInError } = await client.auth.signInWithPassword({
    email: SUPABASE_SHOP_EMAIL,
    password: SUPABASE_SHOP_PASSWORD,
  });
  if (signInError) {
    lastAuthFailureAt = Date.now();
    lastAuthError = signInError.message;
    throw signInError;
  }

  lastAuthFailureAt = 0;
  lastAuthError = '';
  return client;
}

/**
 * Keep the public page live without a second table subscription. The token is
 * the channel secret; the page only uses this signal to re-fetch the canonical
 * row through the RLS-protected REST endpoint.
 */
function broadcastTrackingChange(client: SupabaseClient, token: string): void {
  try {
    const channel = client.channel(trackingChannelName(token), {
      config: { broadcast: { self: false } },
    });
    let finished = false;
    let timeout = 0;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      void client.removeChannel(channel);
    };

    timeout = window.setTimeout(cleanup, 4_000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel
          .send({ type: 'broadcast', event: 'status', payload: { token } })
          .finally(cleanup);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        cleanup();
      }
    });
  } catch (error) {
    console.warn('[tracking] realtime broadcast failed:', error);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
    if (parts.length > 0) return parts.join(' — ');
    try {
      return JSON.stringify(error);
    } catch {
      // Fall through to the generic string conversion.
    }
  }
  return String(error || 'Unknown sync error');
}

async function markOutboxFailure(entry: TrackingOutboxEntry, error: unknown): Promise<void> {
  await localDb.transaction('rw', localDb.trackingOutbox, async () => {
    const current = await localDb.trackingOutbox.get(entry.token);
    if (!current) return;

    // A newer status was queued while this older payload was in flight. Leave
    // the newer payload untouched and let the follow-up flush send it.
    if (current.updatedAt !== entry.updatedAt) {
      flushAgain = true;
      return;
    }

    const message = errorMessage(error);
    await localDb.trackingOutbox.put({
      ...current,
      attempts: current.attempts + 1,
      lastError: message.slice(0, 300),
      updatedAt: new Date().toISOString(),
    });
  });
}

/**
 * Retry queued mirror rows. This is a no-op when offline, unconfigured, or a
 * previous flush is still running.
 */
export function flushTrackingOutbox(force = false): Promise<void> {
  if (flushPromise) return flushPromise;
  if (!isSupabaseConfigured()) return Promise.resolve();
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve();
  if (!force && Date.now() - lastFlushAt < 15_000) return Promise.resolve();

  flushPromise = (async () => {
    flushAgain = false;
    const entries = await localDb.trackingOutbox.orderBy('updatedAt').toArray();
    if (entries.length === 0) return;

    let client: SupabaseClient;
    try {
      client = await getAuthenticatedShopClient();
    } catch (error) {
      console.warn('[tracking] shop authentication failed; changes remain queued.', error);
      return;
    }

    for (const entry of entries) {
      try {
        const { error } = await client
          .from('tracking')
          .upsert(entry.payload, { onConflict: 'token' });

        if (error) {
          await markOutboxFailure(entry, error);
          console.warn('[tracking] mirror upsert failed; change remains queued.', error.message);
          continue;
        }

        broadcastTrackingChange(client, entry.token);
        // Compare and delete in one Dexie transaction so a status change that
        // lands while this request is in flight can never be deleted with the
        // payload that was just upserted.
        await localDb.transaction('rw', localDb.trackingOutbox, async () => {
          const current = await localDb.trackingOutbox.get(entry.token);
          if (!current) return;
          if (current.updatedAt === entry.updatedAt) {
            await localDb.trackingOutbox.delete(entry.token);
          } else {
            // The ticket changed while this payload was in flight. Keep the
            // newer row and ask for one more flush after this one finishes.
            flushAgain = true;
          }
        });
      } catch (error) {
        await markOutboxFailure(entry, error);
        console.warn('[tracking] mirror upsert failed; change remains queued.', error);
      }
    }
  })()
    .catch((error) => {
      console.warn('[tracking] outbox flush failed:', error);
    })
    .finally(() => {
      lastFlushAt = Date.now();
      flushPromise = null;
      if (flushAgain) {
        flushAgain = false;
        void flushTrackingOutbox(true);
      }
    });

  return flushPromise;
}

/**
 * Queue the current state of one ticket. Safe to call after any local write;
 * failures here must never block POS operations.
 */
export async function queueTransactionTracking(
  transactionOrId: Transaction | number,
): Promise<void> {
  try {
    const tx =
      typeof transactionOrId === 'number'
        ? await localDb.transactions.get(transactionOrId)
        : transactionOrId;

    if (!tx || typeof tx.id !== 'number') return;

    let token =
      typeof tx.trackingToken === 'string' && tx.trackingToken.trim().length >= 12
        ? tx.trackingToken.trim()
        : generateTrackingToken();

    if (token !== tx.trackingToken) {
      await localDb.transactions.update(tx.id, { trackingToken: token });
      tx.trackingToken = token;
    }

    const now = new Date().toISOString();
    const previous = await localDb.trackingOutbox.get(token);
    const shopName = await loadShopName();
    const payload = buildTrackingMirrorPayload(tx, shopName, token);

    await localDb.trackingOutbox.put({
      token,
      payload,
      attempts: previous?.attempts || 0,
      ...(previous?.lastError ? { lastError: previous.lastError } : {}),
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    });

    if (flushPromise) flushAgain = true;
    void flushTrackingOutbox();
  } catch (error) {
    console.warn('[tracking] could not queue mirror update:', error);
  }
}

/**
 * Start the online/visibility retry loop. Called once the shop user is signed
 * into the POS; the public tracking page never starts this.
 */
export function startTrackingSync(): void {
  if (syncStarted || typeof window === 'undefined') return;
  syncStarted = true;

  const retry = () => {
    void flushTrackingOutbox();
  };

  window.addEventListener('online', () => {
    void flushTrackingOutbox(true);
  });
  window.addEventListener('focus', retry);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retry();
  });
  window.setInterval(retry, 60_000);

  void flushTrackingOutbox(true);
}
