/**
 * Shared authenticated Supabase client for shop-side writes.
 *
 * The public tracking page uses an anonymous client; the POS uses one shared
 * shop session so token refresh is not raced between modules.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  SUPABASE_ANON_KEY,
  SUPABASE_SHOP_EMAIL,
  SUPABASE_SHOP_PASSWORD,
  SUPABASE_URL,
  hasShopSyncCredentials,
  isSupabaseConfigured,
} from './tracking-config';

const AUTH_FAILURE_BACKOFF_MS = 30_000;

let shopClient: SupabaseClient | null = null;
let lastAuthFailureAt = 0;
let lastAuthError = '';

function getShopClient(): SupabaseClient {
  if (!shopClient) {
    shopClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'fixmo-tracking-shop-auth',
      },
    });
  }
  return shopClient;
}

/** Use the persisted shop session, or sign in with the dedicated shop account. */
export async function getAuthenticatedShopClient(): Promise<SupabaseClient> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
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

export function supabaseErrorMessage(error: unknown): string {
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
