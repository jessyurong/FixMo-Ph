import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "wouter";
import {
  Bell,
  Check,
  ChevronDown,
  ClipboardList,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  normalizeRepairStatus,
  normalizeStatus,
  repairStatusFor,
  REPAIR_STATUSES,
  transactionService,
  useShopProfile,
  type EnrichedTransaction,
  type RepairStatus,
} from "@/lib/offline-api";
import { isValidTrackingToken } from "@/lib/tracking-token";
import { PUBLIC_SHOP_ADDRESS, PUBLIC_SHOP_CONTACT } from "@/lib/tracking-config";
import {
  fetchPublicTracking,
  subscribePublicTracking,
  type PublicTrackingRow,
} from "@/lib/tracking-public";

const AUTO_REFRESH_MS = 30_000;
const REFRESH_SECONDS = Math.round(AUTO_REFRESH_MS / 1000);

type TrackItem = {
  name: string;
  quantity: number;
  price: number;
  type?: string;
  isPreOrder?: boolean;
};

type TrackedJob = {
  ticket: string;
  jobNumber?: string;
  /** Shop name from the public mirror, when available. */
  shopName?: string;
  customerName: string;
  customerPhone?: string;
  device: string;
  technicianName: string;
  createdAt?: string;
  completedAt?: string;
  status: string;
  repairStatus: RepairStatus;
  items: TrackItem[];
  total: number;
  amountPaid?: number;
  remainingBalance?: number;
  paymentStatus?: string;
  complaint?: string;
  diagnosis?: string;
  notes?: string;
  /** True when the data came from the privacy-filtered Supabase mirror. */
  publicMirror?: boolean;
  /** Last time the mirror row was written by the shop. */
  mirrorUpdatedAt?: string;
};

type ApiTransaction = {
  id?: number;
  jobNumber?: string;
  customer?: string;
  customerName?: string;
  customerPhone?: string;
  unit?: string;
  phoneBrand?: string;
  phoneModel?: string;
  technicianName?: string;
  total?: number;
  amountPaid?: number;
  remainingBalance?: number;
  paymentStatus?: string;
  status?: string;
  repair_status?: string;
  createdAt?: string;
  completedAt?: string;
  customerComplaint?: string;
  diagnosis?: string;
  notes?: string;
  items?: Array<{
    name?: string;
    qty?: number;
    quantity?: number;
    price?: number;
    type?: string;
    isPreOrder?: boolean;
  }>;
};

// ─── Stage model ─────────────────────────────────────────────────────────────
const STAGES: Array<{
  key: string;
  label: string;
  hint: string;
  estimate: string;
}> = [
  { key: "received", label: "Received", hint: "Device checked in at the shop", estimate: "Check-in usually takes 5 minutes" },
  { key: "diagnosing", label: "Diagnosing", hint: "We are inspecting the issue", estimate: "Diagnosing usually takes 30 minutes" },
  { key: "waiting_for_parts", label: "Waiting for parts", hint: "Sourcing the needed components", estimate: "Parts sourcing usually takes 1–3 days" },
  { key: "in_repair", label: "In repair", hint: "A technician is working on it", estimate: "Repair usually takes 1–2 hours" },
  { key: "quality_check", label: "Quality check", hint: "Final testing before release", estimate: "Quality check usually takes 20 minutes" },
  { key: "ready", label: "Ready for pickup", hint: "Your device is ready. You can pick it up.", estimate: "Ready for pickup" },
  { key: "completed", label: "Completed", hint: "Job finished. Thank you.", estimate: "Job completed" },
];

/**
 * Map the stored transaction status to the most accurate visual stage.
 * Diagnosing and Quality Check are implied milestones: an in-progress job has
 * already been diagnosed, and a ready job has already passed QC.
 */
const STATUS_STAGE: Record<string, number> = {
  pending: 0,
  waiting_for_parts: 2,
  pre_ordered: 2,
  in_progress: 3,
  ready_for_pickup: 5,
  completed: 6,
};

// ─── Data loading ────────────────────────────────────────────────────────────
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function displayDevice(brand?: string, model?: string, unit?: string): string {
  const combined = [brand, model].filter(Boolean).join(" ").trim();
  return combined || unit || "—";
}

function fromEnriched(tx: EnrichedTransaction): TrackedJob {
  return {
    ticket: tx.jobNumber || String(tx.id),
    jobNumber: tx.jobNumber,
    customerName: tx.customerName || tx.customer || "Walk-in",
    customerPhone: tx.customerPhone,
    device: displayDevice(tx.phoneBrand, tx.phoneModel, tx.unit),
    technicianName: tx.technicianName || "Unassigned",
    createdAt: tx.createdAt,
    completedAt: tx.completedAt,
    status: normalizeStatus(tx.status),
    repairStatus: normalizeRepairStatus(tx.repair_status ?? repairStatusFor(tx)),
    items: (tx.items || []).map((item) => ({
      name: item.name,
      quantity: item.quantity ?? 1,
      price: item.price ?? 0,
      type: item.type,
      isPreOrder: item.isPreOrder,
    })),
    total: tx.total ?? tx.totalAmount ?? 0,
    amountPaid: tx.amountPaid,
    remainingBalance:
      tx.remainingBalance ??
      Math.max(0, (tx.total ?? tx.totalAmount ?? 0) - (tx.amountPaid ?? 0)),
    paymentStatus: tx.paymentStatus,
    complaint: tx.customerComplaint,
    diagnosis: tx.diagnosis,
    notes: tx.technicianNotes || tx.notes,
  };
}

function fromApi(raw: unknown, fallbackTicket: string): TrackedJob | null {
  if (!isRecord(raw)) return null;
  const data = raw as ApiTransaction;
  const id = typeof data.id === "number" ? data.id : undefined;
  if (id === undefined && !data.jobNumber) return null;

  const items = Array.isArray(data.items)
    ? data.items
        .filter((item): item is NonNullable<ApiTransaction["items"]>[number] => isRecord(item))
        .map((item) => ({
          name: String(item.name ?? "Item"),
          quantity: Number(item.quantity ?? item.qty ?? 1) || 1,
          price: Number(item.price ?? 0) || 0,
          type: item.type,
          isPreOrder: Boolean(item.isPreOrder),
        }))
    : [];

  return {
    ticket: data.jobNumber || String(id ?? fallbackTicket),
    jobNumber: data.jobNumber,
    customerName: data.customerName || data.customer || "Walk-in",
    customerPhone: data.customerPhone,
    device: displayDevice(data.phoneBrand, data.phoneModel, data.unit),
    technicianName: data.technicianName || "Unassigned",
    createdAt: data.createdAt,
    completedAt: data.completedAt,
    status: normalizeStatus(data.status),
    repairStatus: data.repair_status
      ? normalizeRepairStatus(data.repair_status)
      : repairStatusFor({ status: normalizeStatus(data.status) }),
    items,
    total: Number(data.total ?? 0) || 0,
    amountPaid: data.amountPaid,
    remainingBalance:
      data.remainingBalance ??
      Math.max(0, (Number(data.total ?? 0) || 0) - (Number(data.amountPaid ?? 0) || 0)),
    paymentStatus: data.paymentStatus,
    complaint: data.customerComplaint,
    diagnosis: data.diagnosis,
    notes: data.notes,
  };
}

function fromMirror(row: PublicTrackingRow, fallbackTicket: string): TrackedJob {
  const status = normalizeStatus(row.status);
  const repairStatus = row.repair_status
    ? normalizeRepairStatus(row.repair_status)
    : repairStatusFor({ status });
  const history = Array.isArray(row.status_history)
    ? row.status_history.filter(isRecord)
    : [];
  const firstTimestamp = history.find(
    (entry) => typeof entry.timestamp === "string",
  )?.timestamp;

  return {
    ticket: row.job_number || fallbackTicket,
    jobNumber: row.job_number || undefined,
    shopName: row.shop_name || undefined,
    customerName: row.customer_first_name || "Customer",
    device: row.device_label || "Device",
    technicianName: "—",
    createdAt: typeof firstTimestamp === "string" ? firstTimestamp : row.updated_at,
    status,
    repairStatus,
    items: [],
    total: 0,
    publicMirror: true,
    mirrorUpdatedAt: row.updated_at,
  };
}

/**
 * Resolve a ticket from the shop's local IndexedDB first (works offline on the
 * shop device), then the public Supabase mirror (works from any customer
 * device), then the legacy transaction API.
 */
async function resolveTicket(ticket: string): Promise<TrackedJob | null> {
  const value = ticket.trim();
  if (!value) return null;

  try {
    if (/^\d+$/.test(value)) {
      const local = await transactionService.getEnriched(Number(value));
      if (local) return fromEnriched(local);
    }

    const rawTransactions = await transactionService.listRaw();
    const byToken = rawTransactions.find(
      (tx) => (tx.trackingToken || "") === value,
    );
    if (byToken) {
      const enriched = await transactionService.getEnriched(byToken.id);
      if (enriched) return fromEnriched(enriched);
    }

    const byJobNumber = rawTransactions.find(
      (tx) =>
        (tx.jobNumber || "").toLowerCase() === value.toLowerCase() ||
        (tx.trackingToken || "").toLowerCase() === value.toLowerCase(),
    );
    if (byJobNumber) {
      const enriched = await transactionService.getEnriched(byJobNumber.id);
      if (enriched) return fromEnriched(enriched);
    }
  } catch {
    // Local lookup is best-effort; fall through to the public mirror.
  }

  if (isValidTrackingToken(value)) {
    try {
      const mirrored = await fetchPublicTracking(value);
      if (mirrored) return fromMirror(mirrored, value);
    } catch {
      // Supabase may be unconfigured, offline, or the token may be unknown.
      // Keep falling back so legacy local links still work.
    }
  }

  try {
    const response = await fetch(`/api/transactions/${encodeURIComponent(value)}`, {
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      return fromApi(await response.json(), value);
    }
  } catch {
    // No API available (offline / static deployment) — treat as not found.
  }

  return null;
}

function useTrackedJob(ticket: string) {
  const [job, setJob] = useState<TrackedJob | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "notfound">(
    ticket ? "loading" : "idle",
  );
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_SECONDS);
  const requestId = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (!ticket) {
        setJob(null);
        setState("idle");
        setSecondsLeft(REFRESH_SECONDS);
        return;
      }

      const id = ++requestId.current;
      if (!silent) setState((prev) => (prev === "ready" ? prev : "loading"));
      setRefreshing(true);

      try {
        const found = await resolveTicket(ticket);
        if (id !== requestId.current) return;
        if (found) {
          setJob(found);
          setState("ready");
          setLastUpdated(new Date());
        } else {
          setJob(null);
          setState("notfound");
        }
      } catch {
        if (id !== requestId.current) return;
        setJob(null);
        setState("notfound");
      } finally {
        if (id === requestId.current) {
          setRefreshing(false);
          setSecondsLeft(REFRESH_SECONDS);
        }
      }
    },
    [ticket],
  );

  // Initial load.
  useEffect(() => {
    setJob(null);
    setSecondsLeft(REFRESH_SECONDS);
    void load();
  }, [load]);

  // Countdown timer that also drives the 30-second auto-refresh.
  useEffect(() => {
    if (!ticket) return;
    if (secondsLeft <= 0) {
      void load(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [ticket, secondsLeft, load]);

  // Realtime: the shop broadcasts a signal after a successful Supabase upsert.
  // The page re-fetches the canonical row through the RLS-protected endpoint;
  // the 30-second poll below remains the fallback when realtime is unavailable.
  useEffect(() => {
    if (!job?.publicMirror || !isValidTrackingToken(ticket)) return;
    return subscribePublicTracking(ticket, () => {
      void load(true);
    });
  }, [job?.publicMirror, ticket, load]);

  // Refresh immediately when the customer returns to the tab.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  return {
    job,
    state,
    lastUpdated,
    refreshing,
    secondsLeft,
    refresh: () => void load(true),
  };
}

// ─── Small presentational pieces ─────────────────────────────────────────────
function formatShortDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STAGE_ICON: Record<string, LucideIcon> = {
  received: ClipboardList,
  diagnosing: Search,
  waiting_for_parts: Package,
  in_repair: Wrench,
  quality_check: ShieldCheck,
  ready: Bell,
  completed: Check,
};

function useBarFill(target: number) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setValue(target));
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function ShopMark({ logo, name }: { logo?: string; name: string }) {
  if (logo) {
    return (
      <img
        src={logo}
        alt={`${name} logo`}
        className="h-10 w-10 shrink-0 rounded-xl border border-white/40 bg-white object-cover shadow-sm"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/30">
      <Wrench className="h-5 w-5" aria-hidden />
    </div>
  );
}

function TrackSkeleton() {
  return (
    <div className="mt-2 space-y-3" role="status" aria-live="polite">
      <div className="rise rounded-2xl bg-white p-4 shadow-sm">
        <div className="h-3 w-24 animate-pulse rounded-full bg-orange-100" />
        <div className="mt-3 h-7 w-36 animate-pulse rounded-lg bg-stone-200" />
        <div className="mt-4 h-2 animate-pulse rounded-full bg-stone-100" />
      </div>
      <div className="rise space-y-3 rounded-2xl bg-white p-4 shadow-sm" style={{ animationDelay: "80ms" }}>
        {[0, 1, 2, 3, 4].map((item) => (
          <div key={item} className="flex items-center gap-3">
            <div className="h-8 w-8 animate-pulse rounded-full bg-stone-100" />
            <div className="h-3 w-28 animate-pulse rounded-full bg-stone-100" />
          </div>
        ))}
      </div>
      <p className="text-center text-sm text-stone-500">Checking your repair…</p>
    </div>
  );
}

function TicketLookup({
  defaultValue,
  onSubmit,
}: {
  defaultValue?: string;
  onSubmit: (ticket: string) => void;
}) {
  const [value, setValue] = useState(defaultValue ?? "");

  return (
    <form
      className="mt-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <label htmlFor="tracking-ticket" className="text-sm text-stone-600">
        Ticket number
      </label>
      <input
        id="tracking-ticket"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="JEGZ-2026-000001"
        aria-label="Ticket number"
        className="mt-1.5 h-12 w-full rounded-xl border border-orange-200 bg-orange-50/40 px-3 text-base text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-500/15"
      />
      <button
        type="submit"
        className="mt-3 h-12 w-full rounded-xl bg-orange-600 text-sm font-semibold text-white shadow-md shadow-orange-600/25 transition hover:bg-orange-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2"
      >
        Check status
      </button>
    </form>
  );
}

function StatusList({
  stageIndex,
  isCancelled,
  isDone,
}: {
  stageIndex: number;
  isCancelled: boolean;
  isDone: boolean;
}) {
  return (
    <ol aria-label="Repair status">
      {STAGES.map((stage, index) => {
        const done = !isCancelled && (index < stageIndex || isDone);
        const active = !isCancelled && !isDone && index === stageIndex;
        const last = index === STAGES.length - 1;
        const Icon = STAGE_ICON[stage.key] ?? Check;

        return (
          <li
            key={stage.key}
            className="step-in flex gap-3"
            style={{ animationDelay: `${120 + index * 70}ms` }}
            aria-current={active ? "step" : undefined}
          >
            <div className="flex w-9 flex-col items-center">
              <span className="relative flex h-9 w-9 items-center justify-center">
                {active && (
                  <span
                    aria-hidden
                    className="live-ping absolute inset-0 rounded-full bg-orange-400"
                  />
                )}
                <span
                  className={cn(
                    "relative flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-500",
                    active
                      ? "bob bg-orange-600 text-white shadow-md shadow-orange-600/30"
                      : done
                        ? "bg-emerald-600 text-white"
                        : "bg-stone-100 text-stone-400",
                  )}
                >
                  {done ? (
                    <Check className="pop h-4 w-4" style={{ animationDelay: `${180 + index * 70}ms` }} aria-hidden />
                  ) : (
                    <Icon className="h-4 w-4" aria-hidden />
                  )}
                </span>
              </span>
              {!last && (
                <span
                  aria-hidden
                  className={cn(
                    "line-grow my-1 w-0.5 flex-1 rounded-full",
                    done ? "bg-emerald-500" : "bg-stone-200",
                  )}
                  style={{ minHeight: 18, animationDelay: `${160 + index * 70}ms` }}
                />
              )}
            </div>
            <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-3")}>
              <div
                className={cn(
                  "rounded-xl px-3 py-2 transition-colors duration-500",
                  active ? "bg-orange-50" : "bg-transparent",
                )}
              >
                <p
                  className={cn(
                    "text-sm leading-5",
                    active
                      ? "font-semibold text-stone-900"
                      : done
                        ? "font-medium text-stone-800"
                        : "text-stone-400",
                  )}
                >
                  {stage.label}
                  {active && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      Now
                    </span>
                  )}
                </p>
                {active && <p className="mt-0.5 text-sm text-stone-600">{stage.hint}</p>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-stone-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-stone-900">{value}</dd>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function TrackPage() {
  const params = useParams<{ token?: string }>();
  const routeToken = (params.token || "").trim();
  const [searchParams, setSearchParams] = useSearchParams();
  const [, navigate] = useLocation();
  const ticket = routeToken || (searchParams.get("ticket") || "").trim();
  const shop = useShopProfile();
  const { job, state, lastUpdated, refreshing, secondsLeft, refresh } = useTrackedJob(ticket);

  const updateTicket = (next: string) => {
    if (routeToken) {
      navigate(`/track?ticket=${encodeURIComponent(next)}`, { replace: true });
    } else {
      setSearchParams({ ticket: next }, { replace: true });
    }
  };

  const displayShopName = job?.shopName?.trim() || shop.name;
  const contactNumber = shop.contactNumber?.trim() || PUBLIC_SHOP_CONTACT;
  const contactHref = contactNumber
    ? `tel:${contactNumber.replace(/[^\d+]/g, "")}`
    : null;
  const shopAddress = shop.address?.trim() || PUBLIC_SHOP_ADDRESS;
  const directionsHref = shopAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shopAddress)}`
    : null;

  const normalizedStatus = job ? normalizeStatus(job.status) : "pending";
  const isCancelled = normalizedStatus === "cancelled";
  const isDone = normalizedStatus === "completed";
  const repairIndex = job ? REPAIR_STATUSES.indexOf(job.repairStatus) : 0;
  const stageIndex = isCancelled
    ? -1
    : isDone
      ? STAGES.length - 1
      : repairIndex >= 0
        ? repairIndex
        : (STATUS_STAGE[normalizedStatus] ?? 0);
  const progress =
    stageIndex < 0 ? 0 : Math.round((stageIndex / (STAGES.length - 1)) * 100);
  const filled = useBarFill(isCancelled ? 0 : progress);
  const currentStage = stageIndex >= 0 ? STAGES[stageIndex] : null;
  const nextStage =
    stageIndex >= 0 && stageIndex < STAGES.length - 1 ? STAGES[stageIndex + 1] : null;
  const readyForPickup = !isCancelled && !isDone && currentStage?.key === "ready";
  const updatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const remaining = job
    ? typeof job.remainingBalance === "number"
      ? job.remainingBalance
      : Math.max(0, job.total - (job.amountPaid ?? 0))
    : 0;
  const paymentLabel =
    remaining <= 0 ? "Paid" : (job?.amountPaid ?? 0) > 0 ? "Partially paid" : "Unpaid";

  const statusTitle = isCancelled ? "Cancelled" : currentStage?.label ?? "Received";
  const statusBody = isCancelled
    ? "This repair was cancelled. Call the shop if you need the details."
    : currentStage?.hint;

  const ring = 2 * Math.PI * 8;
  const ringOffset = ring - (Math.max(0, secondsLeft) / REFRESH_SECONDS) * ring;

  return (
    <div className="repair-track min-h-dvh bg-[linear-gradient(180deg,#fff4e8_0%,#f6f1e8_240px,#f3eee6_100%)] text-stone-900">
      <header className="sticky top-0 z-20 bg-orange-600 text-white shadow-md shadow-orange-900/10">
        <div className="mx-auto flex w-full max-w-md items-center gap-3 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <ShopMark logo={shop.logo} name={displayShopName} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-orange-100">Repair status</p>
            <h1 className="truncate text-base font-semibold">{displayShopName}</h1>
          </div>
          {ticket && (
            <button
              type="button"
              onClick={refresh}
              aria-label="Refresh repair status"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 transition hover:bg-white/25 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </button>
          )}
        </div>
        <div className="h-0.5 bg-orange-800/30">
          <div
            className="h-full bg-white/80 transition-all duration-1000 ease-linear"
            style={{ width: refreshing ? "100%" : `${(secondsLeft / REFRESH_SECONDS) * 100}%` }}
          />
        </div>
      </header>

      <main
        className={cn(
          "mx-auto w-full max-w-md px-4 pt-5",
          state === "ready" && contactHref
            ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
            : "pb-[calc(2rem+env(safe-area-inset-bottom))]",
        )}
      >
        {state === "loading" && <TrackSkeleton />}

        {(state === "idle" || state === "notfound") && (
          <section className="rise rounded-2xl bg-white p-5 shadow-[0_10px_30px_rgba(120,60,10,0.08)]">
            <h2 className="text-xl font-semibold tracking-tight">
              {state === "notfound" ? "Ticket not found" : "Check a repair"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              {state === "notfound"
                ? "That number does not match a job on file. Check the ticket printed on your job slip, or call the shop."
                : "Type the ticket number from your job slip. It is printed under the QR code."}
            </p>
            <TicketLookup key={ticket} defaultValue={ticket} onSubmit={updateTicket} />
            {state === "notfound" && contactHref && (
              <a href={contactHref} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-orange-700">
                <Phone className="h-4 w-4" aria-hidden />
                Call {contactNumber}
              </a>
            )}
          </section>
        )}

        {state === "ready" && job && (
          <article className="space-y-3">
            <section className="rise overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_rgba(120,60,10,0.08)]">
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 px-4 py-4 text-white">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-xs text-orange-100">{job.jobNumber || job.ticket}</p>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium">
                    <span className="relative flex h-2 w-2">
                      {!isCancelled && !isDone && (
                        <span className="live-ping absolute inline-flex h-2 w-2 rounded-full bg-white" />
                      )}
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                    </span>
                    {isCancelled ? "Cancelled" : isDone ? "Done" : "Live"}
                  </span>
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight" aria-live="polite">
                  {statusTitle}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-orange-50">{statusBody}</p>
              </div>
              <div className="px-4 py-3">
                <div className="relative h-2 overflow-hidden rounded-full bg-orange-100">
                  <div
                    className={cn(
                      "relative h-full overflow-hidden rounded-full transition-[width] duration-700 ease-out",
                      isCancelled ? "bg-red-500" : isDone ? "bg-emerald-500" : "bg-orange-500",
                    )}
                    style={{ width: `${filled}%` }}
                  >
                    {!isCancelled && !isDone && <span className="bar-sheen" />}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-stone-500">
                  <span>
                    {isCancelled
                      ? "This job will not continue"
                      : `${progress}% · step ${Math.min(stageIndex + 1, STAGES.length)} of ${STAGES.length}`}
                  </span>
                  {updatedLabel && <span>Updated {updatedLabel}</span>}
                </div>
                {!isCancelled && !isDone && currentStage && (
                  <p className="mt-2 text-sm text-stone-700">{currentStage.estimate}</p>
                )}
              </div>
            </section>

            {readyForPickup && (
              <p className="rise rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-md shadow-emerald-700/20" style={{ animationDelay: "80ms" }}>
                Your device is ready. Drop by the shop to pick it up.
              </p>
            )}
            {isDone && !isCancelled && (
              <p className="rise rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white" style={{ animationDelay: "80ms" }}>
                Repair finished. Thank you.
              </p>
            )}
            {isCancelled && (
              <p className="rise rounded-2xl bg-red-600 px-4 py-3 text-sm font-medium text-white" style={{ animationDelay: "80ms" }}>
                This repair was cancelled. Call the shop if you need the details.
              </p>
            )}

            <section className="rise rounded-2xl bg-white p-4 shadow-[0_10px_30px_rgba(120,60,10,0.06)]" style={{ animationDelay: "120ms" }}>
              <StatusList stageIndex={stageIndex} isCancelled={isCancelled} isDone={isDone} />
              {!isCancelled && !isDone && !readyForPickup && nextStage && (
                <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-600">
                  Next: <span className="font-medium text-stone-800">{nextStage.label}</span>. {nextStage.hint}
                </p>
              )}
            </section>

            <section className="rise rounded-2xl bg-white px-4 py-2 shadow-[0_10px_30px_rgba(120,60,10,0.06)]" style={{ animationDelay: "180ms" }}>
              <h3 className="py-2 text-sm font-semibold">Job</h3>
              <dl className="divide-y divide-stone-100">
                <Row label="Customer" value={job.customerName} />
                <Row label="Device" value={job.device} />
                {!job.publicMirror && <Row label="Technician" value={job.technicianName} />}
                <Row label="Received" value={formatShortDate(job.createdAt)} />
                {job.completedAt && <Row label="Finished" value={formatShortDate(job.completedAt)} />}
              </dl>
            </section>

            {!job.publicMirror && job.total > 0 && (
              <section className="rise rounded-2xl bg-white px-4 py-2 shadow-[0_10px_30px_rgba(120,60,10,0.06)]" style={{ animationDelay: "240ms" }}>
                <div className="flex items-center justify-between py-2">
                  <h3 className="text-sm font-semibold">Payment</h3>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      remaining <= 0 ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-700",
                    )}
                  >
                    {paymentLabel}
                  </span>
                </div>
                <dl className="divide-y divide-stone-100">
                  <Row label="Total" value={formatCurrency(job.total)} />
                  {(job.amountPaid ?? 0) > 0 && (
                    <Row label="Paid" value={formatCurrency(job.amountPaid ?? 0)} />
                  )}
                  <Row
                    label="Balance"
                    value={remaining > 0 ? formatCurrency(remaining) : "None"}
                  />
                </dl>

                {job.items.length > 0 && (
                  <details className="group mt-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-sm text-stone-700 [&::-webkit-details-marker]:hidden">
                      Services and parts ({job.items.length})
                      <ChevronDown className="h-4 w-4 text-stone-400 transition-transform group-open:rotate-180" />
                    </summary>
                    <ul className="divide-y divide-stone-200 border-t border-stone-200">
                      {job.items.map((item, index) => (
                        <li
                          key={`${item.name}-${index}`}
                          className="flex items-start justify-between gap-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-stone-900">{item.name}</p>
                            <p className="text-xs text-stone-500">
                              {item.type === "product" ? "Part" : "Service"}
                              {item.isPreOrder ? " · Pre-order" : ""} · ×{item.quantity}
                            </p>
                          </div>
                          <p className="shrink-0 text-sm tabular-nums">
                            {formatCurrency(item.price * item.quantity)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )}

            {!job.publicMirror && (job.complaint || job.diagnosis || job.notes) && (
              <section className="rise rounded-2xl bg-white px-4 py-4 shadow-[0_10px_30px_rgba(120,60,10,0.06)]" style={{ animationDelay: "300ms" }}>
                <h3 className="text-sm font-semibold">Notes</h3>
                <div className="mt-3 space-y-3 text-sm">
                  {job.complaint && (
                    <p>
                      <span className="text-stone-500">Reported issue. </span>
                      {job.complaint}
                    </p>
                  )}
                  {job.diagnosis && (
                    <p>
                      <span className="text-stone-500">Diagnosis. </span>
                      {job.diagnosis}
                    </p>
                  )}
                  {job.notes && (
                    <p>
                      <span className="text-stone-500">From the technician. </span>
                      {job.notes}
                    </p>
                  )}
                </div>
              </section>
            )}

            <section className="rise rounded-2xl bg-white px-4 py-4 shadow-[0_10px_30px_rgba(120,60,10,0.06)]" style={{ animationDelay: "360ms" }}>
              <h3 className="text-sm font-semibold">Shop</h3>
              {contactHref && (
                <a href={contactHref} className="mt-2 flex items-center gap-2 text-sm font-medium text-orange-700">
                  <Phone className="h-4 w-4" aria-hidden />
                  {contactNumber}
                </a>
              )}
              {shopAddress && directionsHref && (
                <a
                  href={directionsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex items-start gap-2 text-sm text-stone-700"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                  <span>{shopAddress}</span>
                </a>
              )}
              {!contactHref && !directionsHref && (
                <p className="mt-2 text-sm text-stone-600">
                  Use the phone number printed on your job slip.
                </p>
              )}
            </section>
          </article>
        )}

        <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-stone-500" aria-live="polite">
          {ticket && (
            <svg viewBox="0 0 20 20" className="h-4 w-4 -rotate-90" aria-hidden>
              <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-100" />
              <circle
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="text-orange-500 transition-[stroke-dashoffset] duration-1000 ease-linear"
                strokeDasharray={ring}
                strokeDashoffset={refreshing ? 0 : ringOffset}
              />
            </svg>
          )}
          <span>
            {ticket
              ? refreshing
                ? "Checking for updates…"
                : state === "notfound"
                  ? `Will try again in ${secondsLeft}s`
                  : `Updates in ${secondsLeft}s`
              : "Enter a ticket to see the status"}
            {lastUpdated
              ? ` · last checked ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </span>
        </p>
      </main>

      {state === "ready" && job && contactHref && (
        <div className="fixed inset-x-0 bottom-0 border-t border-orange-100 bg-white/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <a
            href={contactHref}
            className="mx-auto flex h-12 w-full max-w-md items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-semibold text-white shadow-lg shadow-orange-600/25 transition hover:bg-orange-700 active:scale-[0.98]"
          >
            <Phone className="h-4 w-4" aria-hidden />
            Call the shop
          </a>
        </div>
      )}
    </div>
  );
}
