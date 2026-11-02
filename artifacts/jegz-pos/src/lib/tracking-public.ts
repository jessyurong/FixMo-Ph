/**
 * Read-only Supabase access for the public tracking page.
 *
 * The anonymous role may only select the row matching the exact token sent in
 * the `x-tracking-token` header (see `supabase/tracking.sql`). The row itself
 * contains only customer-safe fields.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
  trackingChannelName,
} from './tracking-config';
import { isValidTrackingToken } from './tracking-token';

export interface PublicTrackingRow {
  token: string;
  shop_name: string;
  job_number: string;
  device_label: string;
  status: string;
  repair_status: string;
  status_history: unknown;
  customer_first_name: string;
  updated_at: string;
}

const clients = new Map<string, SupabaseClient>();

function publicClientFor(token: string): SupabaseClient | null {
  if (!isSupabaseConfigured() || !isValidTrackingToken(token)) return null;

  const existing = clients.get(token);
  if (existing) return existing;

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        'x-tracking-token': token,
      },
    },
  });
  clients.set(token, client);
  return client;
}

export async function fetchPublicTracking(token: string): Promise<PublicTrackingRow | null> {
  const client = publicClientFor(token);
  if (!client) return null;

  const { data, error } = await client
    .from('tracking')
    .select(
      'token,shop_name,job_number,device_label,status,repair_status,status_history,customer_first_name,updated_at',
    )
    .eq('token', token)
    .maybeSingle<PublicTrackingRow>();

  if (error) throw error;
  return data;
}

/**
 * Listen for the shop's "status changed" broadcast. The callback only signals
 * that a refresh is needed; the page then re-fetches the canonical RLS-protected
 * row instead of trusting the broadcast payload.
 */
export function subscribePublicTracking(
  token: string,
  onStatusChanged: () => void,
): () => void {
  const client = publicClientFor(token);
  if (!client) return () => undefined;

  const channel = client.channel(trackingChannelName(token), {
    config: { broadcast: { self: false } },
  });

  channel.on('broadcast', { event: 'status' }, () => onStatusChanged());
  channel.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      // Polling remains the fallback; the channel will retry automatically.
      console.warn(`[tracking] realtime channel ${status.toLowerCase()}`);
    }
  });

  return () => {
    void client.removeChannel(channel);
  };
}
