/**
 * Live-tracking configuration.
 *
 * These values are build-time Vite variables. The Supabase anon key is safe to
 * expose because row access is enforced by the SQL policies in
 * `supabase/tracking.sql`. The shop auth credentials are only used to obtain an
 * `authenticated` Supabase session for writes.
 */

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const env = import.meta.env;

export const SUPABASE_URL = trimTrailingSlash(String(env.VITE_SUPABASE_URL || '').trim());
export const SUPABASE_ANON_KEY = String(env.VITE_SUPABASE_ANON_KEY || '').trim();
export const SUPABASE_SHOP_EMAIL = String(env.VITE_SUPABASE_SHOP_EMAIL || '').trim();
export const SUPABASE_SHOP_PASSWORD = String(env.VITE_SUPABASE_SHOP_PASSWORD || '');
export const PUBLIC_TRACKING_URL = trimTrailingSlash(String(env.VITE_PUBLIC_URL || '').trim());

/** Can the app read from / subscribe to the public mirror? */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** Are shop credentials available for authenticated writes? */
export function hasShopSyncCredentials(): boolean {
  return isSupabaseConfigured() && Boolean(SUPABASE_SHOP_EMAIL && SUPABASE_SHOP_PASSWORD);
}

/**
 * Public origin (including any app base path) used in QR codes and printed
 * links. Defaults to the current origin so local development still works.
 */
export function publicTrackingBaseUrl(): string {
  if (PUBLIC_TRACKING_URL) return PUBLIC_TRACKING_URL;
  if (typeof window === 'undefined') return '';
  const base = trimTrailingSlash(import.meta.env.BASE_URL || '/');
  return `${window.location.origin}${base === '/' ? '' : base}`;
}

/** Full public URL for one ticket, or null when the token is invalid. */
export function trackingPageUrl(token?: string): string | null {
  const cleanToken = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(cleanToken)) return null;
  const base = publicTrackingBaseUrl();
  if (!base) return null;
  return `${base}/track/${encodeURIComponent(cleanToken)}`;
}

/** Realtime broadcast channel name. The unguessable token scopes the channel. */
export function trackingChannelName(token: string): string {
  return `cynex-tracking:${token}`;
}
