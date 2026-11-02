/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_SHOP_EMAIL?: string;
  readonly VITE_SUPABASE_SHOP_PASSWORD?: string;
  readonly VITE_PUBLIC_URL?: string;
  /** Optional override for the serverless notify endpoint (default /api/notify). */
  readonly VITE_NOTIFY_ENDPOINT?: string;
  /** Optional shared secret; must match NOTIFY_API_SECRET on the server. */
  readonly VITE_NOTIFY_API_SECRET?: string;
}
