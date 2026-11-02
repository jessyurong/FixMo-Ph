/**
 * Public, mobile-first repair tracking page.
 *
 * This route is intentionally rendered outside the POS auth provider. It reads
 * one row from Supabase using the unguessable token (enforced by the SQL RLS
 * policy) and listens on a token-scoped Realtime broadcast channel for updates.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AlertCircle,
  Check,
  CircleHelp,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  XCircle,
  Wifi,
} from "lucide-react";
import {
  normalizeTransactionStatus,
  TRANSACTION_STATUSES,
  type TransactionStatus,
  type TransactionStatusEvent,
} from "@/lib/db-types";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
  trackingChannelName,
} from "@/lib/tracking-config";

interface TrackingRow {
  token: string;
  shop_name: string;
  device_label: string;
  status: string;
  status_history: unknown;
  customer_first_name: string | null;
  updated_at: string;
}

type PageState = "loading" | "ready" | "missing" | "error" | "unconfigured";
type LiveState = "connecting" | "live" | "offline";

const STEP_META: Record<
  (typeof TRANSACTION_STATUSES)[number],
  { label: string; description: string }
> = {
  received: { label: "Received", description: "Your device is safely with the shop." },
  diagnosing: { label: "Diagnosing", description: "A technician is checking the issue." },
  waiting_parts: { label: "Waiting for parts", description: "We are sourcing the part needed." },
  repairing: { label: "Repairing", description: "The repair is currently in progress." },
  ready: { label: "Ready", description: "Your device is ready for pickup." },
  complete: { label: "Complete", description: "This repair has been completed." },
};

function cleanText(value: unknown, maxLength = 240): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function formatWhen(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function parseHistory(raw: unknown): TransactionStatusEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => {
      const note = cleanText(entry.note);
      return {
        status: normalizeTransactionStatus(entry.status),
        timestamp: typeof entry.timestamp === "string" ? entry.timestamp : "",
        ...(note ? { note } : {}),
      };
    });
}

function LiveBadge({ state }: { state: LiveState }) {
  const meta =
    state === "live"
      ? { label: "Live", dot: "bg-emerald-400", text: "text-emerald-300" }
      : state === "connecting"
        ? { label: "Connecting", dot: "bg-amber-300", text: "text-amber-200" }
        : { label: "Auto-refresh", dot: "bg-slate-400", text: "text-slate-300" };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium ${meta.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function ProgressStepper({
  status,
  history,
  timestamps,
}: {
  status: TransactionStatus;
  history: TransactionStatusEvent[];
  timestamps: Map<TransactionStatus, string>;
}) {
  const orderedStatuses = TRANSACTION_STATUSES;
  const currentIndex = orderedStatuses.indexOf(status as (typeof orderedStatuses)[number]);
  const isCancelled = status === "cancelled";
  const lastCompletedStatus = isCancelled
    ? [...history]
        .reverse()
        .map((entry) => entry.status)
        .find((entry): entry is (typeof orderedStatuses)[number] =>
          (orderedStatuses as readonly string[]).includes(entry),
        )
    : undefined;
  const completedIndex = isCancelled
    ? lastCompletedStatus
      ? orderedStatuses.indexOf(lastCompletedStatus)
      : -1
    : Math.max(0, currentIndex);

  return (
    <ol className="mt-5">
      {orderedStatuses.map((step, index) => {
        const isCurrent = !isCancelled && step === status;
        const reached = index <= completedIndex;
        const isDone = reached && !isCurrent;
        const timestamp = timestamps.get(step);
        const lineFilled = index < completedIndex;

        return (
          <li key={step} className="relative flex gap-3.5 pb-5 last:pb-0" aria-current={isCurrent ? "step" : undefined}>
            {index < orderedStatuses.length - 1 && (
              <span
                className={`absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-0.5 rounded-full ${
                  lineFilled ? "bg-emerald-400" : "bg-slate-200"
                }`}
                aria-hidden="true"
              />
            )}
            <span
              className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 ${
                isCurrent
                  ? "bg-amber-400 text-slate-950 ring-amber-200"
                  : isDone
                    ? "bg-emerald-500 text-white ring-emerald-100"
                    : "bg-white text-slate-400 ring-slate-200"
              }`}
            >
              {isDone ? (
                <Check className="h-4 w-4" strokeWidth={3} />
              ) : isCurrent ? (
                <span className="h-2 w-2 rounded-full bg-slate-950" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
              )}
            </span>
            <div className="min-w-0 pt-0.5">
              <p
                className={`text-sm font-semibold ${
                  isCurrent ? "text-slate-950" : reached ? "text-slate-700" : "text-slate-400"
                }`}
              >
                {STEP_META[step].label}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {timestamp
                  ? formatWhen(timestamp)
                  : isCurrent
                    ? "Current stage"
                    : isDone
                      ? "Completed"
                      : "Pending"}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-slate-100 px-4 py-6 text-slate-900 sm:py-10">
      <div className="mx-auto w-full max-w-md">{children}</div>
      <p className="mx-auto mt-5 max-w-md text-center text-[11px] leading-relaxed text-slate-500">
        This private link only shows repair progress. It never contains your phone number, email, or payment details.
      </p>
    </div>
  );
}

function StateCard({
  icon,
  title,
  message,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl bg-white p-7 text-center shadow-xl shadow-slate-900/5 ring-1 ring-slate-900/5">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
        {icon}
      </div>
      <h1 className="mt-4 text-lg font-bold text-slate-950">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{message}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export default function TrackingPage({ token }: { token: string }) {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [row, setRow] = useState<TrackingRow | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [liveState, setLiveState] = useState<LiveState>("connecting");
  const rowRef = useRef<TrackingRow | null>(null);

  const validToken = /^[A-Za-z0-9_-]{12,128}$/.test(token);
  const configured = isSupabaseConfigured() && validToken;

  const client = useMemo<SupabaseClient | null>(() => {
    if (!configured) return null;
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        // The RLS policy only exposes a row when this exact token is present.
        headers: { "x-tracking-token": token },
      },
    });
  }, [configured, token]);

  const load = useCallback(async (initial = false) => {
    if (!configured || !client) {
      setPageState(validToken ? "unconfigured" : "missing");
      return;
    }

    if (initial && !rowRef.current) setPageState("loading");
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12_000);

    try {
      const { data, error } = await client
        .from("tracking")
        .select(
          "token, shop_name, device_label, status, status_history, customer_first_name, updated_at",
        )
        .eq("token", token)
        .abortSignal(controller.signal)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setRow(null);
        rowRef.current = null;
        setPageState("missing");
        return;
      }

      const nextRow = data as TrackingRow;
      rowRef.current = nextRow;
      setRow(nextRow);
      setErrorMessage("");
      setPageState("ready");
    } catch (error) {
      const message = timedOut
        ? "The connection timed out. Check your internet connection and try again."
        : error instanceof Error
          ? error.message
          : "Please try again.";
      setErrorMessage(message);
      setPageState(rowRef.current ? "ready" : "error");
    } finally {
      window.clearTimeout(timer);
    }
  }, [client, configured, token, validToken]);

  useEffect(() => {
    void load(true);
  }, [load]);

  // Fallback refresh in case a Realtime signal is missed (e.g. sleeping phone).
  useEffect(() => {
    if (!client) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [client, load]);

  // Supabase Realtime broadcast carries a small "changed" signal only. The
  // canonical row is re-fetched through the RLS-protected REST query above.
  useEffect(() => {
    if (!client) return;
    const channel = client.channel(trackingChannelName(token), {
      config: { broadcast: { self: false } },
    });

    channel.on("broadcast", { event: "status" }, () => {
      void load();
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") setLiveState("live");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setLiveState("offline");
      } else {
        setLiveState("connecting");
      }
    });

    return () => {
      setLiveState("offline");
      void client.removeChannel(channel);
    };
  }, [client, load, token]);

  const normalizedStatus = normalizeTransactionStatus(row?.status);
  const history = parseHistory(row?.status_history);
  const timestamps = new Map<TransactionStatus, string>();
  for (const event of history) {
    if (event.timestamp) timestamps.set(event.status, event.timestamp);
  }
  if (row?.updated_at && !timestamps.has(normalizedStatus)) {
    timestamps.set(normalizedStatus, row.updated_at);
  }
  const latestNote = [...history].reverse().find((event) => event.note)?.note;
  const firstName = cleanText(row?.customer_first_name, 40);

  useEffect(() => {
    const previousTitle = document.title;
    const robots = document.querySelector('meta[name="robots"]');
    const previousRobots = robots?.getAttribute("content") ?? null;

    document.title = "Repair tracking";
    robots?.setAttribute("content", "noindex, nofollow");

    return () => {
      document.title = previousTitle;
      if (previousRobots !== null) robots?.setAttribute("content", previousRobots);
    };
  }, []);

  useEffect(() => {
    if (row?.shop_name) {
      document.title = `${row.shop_name} — Repair tracking`;
    }
  }, [row?.shop_name]);

  if (!validToken) {
    return (
      <Shell>
        <StateCard
          icon={<CircleHelp className="h-7 w-7" />}
          title="Tracking link not found"
          message="This tracking link is incomplete or invalid. Please scan the QR code on your receipt again."
        />
      </Shell>
    );
  }

  if (pageState === "unconfigured") {
    return (
      <Shell>
        <StateCard
          icon={<ShieldCheck className="h-7 w-7" />}
          title="Live tracking isn’t set up yet"
          message="This shop has not finished connecting its live tracking service. Please contact the shop for an update."
        />
      </Shell>
    );
  }

  if (pageState === "loading") {
    return (
      <Shell>
        <div className="rounded-3xl bg-white p-7 shadow-xl shadow-slate-900/5 ring-1 ring-slate-900/5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your repair…
          </div>
          <div className="mt-6 animate-pulse space-y-4">
            <div className="h-24 rounded-2xl bg-slate-100" />
            <div className="h-4 w-2/3 rounded bg-slate-100" />
            <div className="h-4 w-1/2 rounded bg-slate-100" />
            <div className="h-32 rounded-2xl bg-slate-100" />
          </div>
        </div>
      </Shell>
    );
  }

  if (pageState === "missing") {
    return (
      <Shell>
        <StateCard
          icon={<CircleHelp className="h-7 w-7" />}
          title="Tracking link not found"
          message="We couldn’t find a repair for this link. It may be mistyped, or the shop may not have synced this ticket yet."
        />
      </Shell>
    );
  }

  if (pageState === "error" || !row) {
    return (
      <Shell>
        <StateCard
          icon={<AlertCircle className="h-7 w-7" />}
          title="Couldn’t load tracking"
          message={errorMessage || "Check your connection and try again."}
          action={
            <button
              type="button"
              onClick={() => void load(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          }
        />
      </Shell>
    );
  }

  const statusMeta =
    normalizedStatus === "cancelled"
      ? { label: "Cancelled", description: "This repair was cancelled." }
      : STEP_META[normalizedStatus as (typeof TRANSACTION_STATUSES)[number]] || STEP_META.received;

  return (
    <Shell>
      <div className="overflow-hidden rounded-3xl bg-white shadow-xl shadow-slate-900/5 ring-1 ring-slate-900/5">
        <header className="bg-slate-950 px-5 pb-6 pt-6 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
                Repair tracking
              </p>
              <h1 className="mt-1 truncate text-xl font-bold tracking-tight">{row.shop_name}</h1>
            </div>
            <LiveBadge state={liveState} />
          </div>

          <p className="mt-5 text-sm text-white/60">
            {firstName ? `Hi, ${firstName}!` : "Hello!"} Here’s the latest on your repair.
          </p>
          <div className="mt-2 flex items-center gap-2 text-white">
            <Smartphone className="h-4 w-4 shrink-0 text-amber-300" />
            <p className="truncate text-base font-semibold">{row.device_label || "Device"}</p>
          </div>
        </header>

        <main className="px-5 pb-6 pt-5">
          {normalizedStatus === "cancelled" ? (
            <div className="rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
              <div className="flex items-center gap-2 text-rose-700">
                <XCircle className="h-5 w-5" />
                <p className="text-sm font-bold">Repair cancelled</p>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-rose-700/80">
                {statusMeta.description} Please contact the shop if you need more details.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700/70">
                Current status
              </p>
              <p className="mt-1 text-lg font-bold text-slate-950">{statusMeta.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{statusMeta.description}</p>
            </div>
          )}

          <ProgressStepper status={normalizedStatus} history={history} timestamps={timestamps} />

          {latestNote && (
            <div className="mt-1 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Latest note from the shop
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {latestNote}
              </p>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Wifi className="h-3.5 w-3.5" />
              {liveState === "live" ? "Updating live" : "Refreshes automatically"}
            </span>
            <span>Updated {formatWhen(row.updated_at)}</span>
          </div>

          {errorMessage && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              Couldn’t refresh just now. Showing the last known update.
            </p>
          )}
        </main>
      </div>
    </Shell>
  );
}
