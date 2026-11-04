import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "wouter";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BellRing,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  Hash,
  Inbox,
  Info,
  MapPin,
  MessageSquareText,
  Navigation,
  Package,
  PackageSearch,
  Phone,
  RefreshCw,
  SearchX,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  UserRound,
  Wrench,
  XCircle,
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
  icon: LucideIcon;
}> = [
  { key: "received", label: "Received", hint: "Device checked in at the shop", estimate: "Check-in usually takes 5 minutes", icon: Inbox },
  { key: "diagnosing", label: "Diagnosing", hint: "We are inspecting the issue", estimate: "Diagnosing usually takes 30 minutes", icon: Stethoscope },
  { key: "waiting_for_parts", label: "Waiting for Parts", hint: "Sourcing the needed components", estimate: "Parts sourcing usually takes 1–3 days", icon: PackageSearch },
  { key: "in_repair", label: "In Repair", hint: "A technician is working on it", estimate: "Repair usually takes 1–2 hours", icon: Wrench },
  { key: "quality_check", label: "Quality Check", hint: "Final testing before release", estimate: "Quality check usually takes 20 minutes", icon: ShieldCheck },
  { key: "ready", label: "Ready for Pickup", hint: "Your device is ready — come on by!", estimate: "Ready for pickup — no waiting needed", icon: BellRing },
  { key: "completed", label: "Completed", hint: "Job finished. Thank you!", estimate: "Job completed — thank you!", icon: BadgeCheck },
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

type Tone = {
  text: string;
  bg: string;
  soft: string;
  border: string;
  ring: string;
  gradient: string;
  shadow: string;
};

const TONES: Record<string, Tone> = {
  amber: {
    text: "text-amber-500",
    bg: "bg-amber-500",
    soft: "bg-amber-500/10",
    border: "border-amber-500/30",
    ring: "ring-amber-500/25",
    gradient: "from-amber-500 to-orange-500",
    shadow: "shadow-amber-500/30",
  },
  violet: {
    text: "text-violet-500",
    bg: "bg-violet-500",
    soft: "bg-violet-500/10",
    border: "border-violet-500/30",
    ring: "ring-violet-500/25",
    gradient: "from-violet-500 to-purple-600",
    shadow: "shadow-violet-500/30",
  },
  blue: {
    text: "text-blue-500",
    bg: "bg-blue-500",
    soft: "bg-blue-500/10",
    border: "border-blue-500/30",
    ring: "ring-blue-500/25",
    gradient: "from-blue-500 to-cyan-500",
    shadow: "shadow-blue-500/30",
  },
  emerald: {
    text: "text-emerald-500",
    bg: "bg-emerald-500",
    soft: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    ring: "ring-emerald-500/25",
    gradient: "from-emerald-500 to-green-600",
    shadow: "shadow-emerald-500/30",
  },
  cyan: {
    text: "text-cyan-500",
    bg: "bg-cyan-600",
    soft: "bg-cyan-500/10",
    border: "border-cyan-500/30",
    ring: "ring-cyan-500/25",
    gradient: "from-cyan-500 to-blue-600",
    shadow: "shadow-cyan-500/30",
  },
  slate: {
    text: "text-slate-400",
    bg: "bg-slate-500",
    soft: "bg-slate-500/10",
    border: "border-slate-500/30",
    ring: "ring-slate-500/25",
    gradient: "from-slate-500 to-slate-600",
    shadow: "shadow-slate-500/30",
  },
  red: {
    text: "text-red-500",
    bg: "bg-red-500",
    soft: "bg-red-500/10",
    border: "border-red-500/30",
    ring: "ring-red-500/25",
    gradient: "from-red-500 to-rose-600",
    shadow: "shadow-red-500/30",
  },
};

function repairToneFor(status: RepairStatus): Tone {
  switch (status) {
    case "diagnosing":
      return TONES.blue;
    case "waiting_for_parts":
      return TONES.violet;
    case "in_repair":
      return TONES.amber;
    case "quality_check":
      return TONES.cyan;
    case "ready_for_pickup":
      return TONES.emerald;
    default:
      return TONES.slate;
  }
}

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
const MILESTONES: Array<{ label: string; icon: LucideIcon; from: number }> = [
  { label: "Received", icon: Inbox, from: 0 },
  { label: "Diagnosis", icon: Stethoscope, from: 1 },
  { label: "Parts", icon: PackageSearch, from: 2 },
  { label: "Repair", icon: Wrench, from: 3 },
  { label: "Ready", icon: BellRing, from: 5 },
];

function milestoneForStage(stageIndex: number): number {
  for (let index = MILESTONES.length - 1; index >= 0; index -= 1) {
    if (stageIndex >= MILESTONES[index].from) return index;
  }
  return 0;
}

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

function ShopLogo({ logo, name }: { logo?: string; name: string }) {
  if (logo) {
    return (
      <img
        src={logo}
        alt={`${name} logo`}
        className="h-10 w-10 shrink-0 rounded-xl border border-white/30 bg-white object-cover shadow-md shadow-orange-950/20"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/30 bg-white/15 shadow-md shadow-orange-950/20 backdrop-blur-sm">
      <Wrench className="h-5 w-5" />
    </div>
  );
}

function ProgressRing({
  progress,
  tone,
  cancelled,
  complete,
}: {
  progress: number;
  tone: Tone;
  cancelled: boolean;
  complete: boolean;
}) {
  const size = 92;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = Math.max(0, Math.min(100, progress));
  const offset = circumference - (value / 100) * circumference;

  return (
    <div
      className="relative h-24 w-24 shrink-0"
      role="img"
      aria-label={cancelled ? "Repair cancelled" : `${value}% complete`}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-muted-foreground/15"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(
            "transition-[stroke-dashoffset] duration-700 ease-out",
            cancelled ? TONES.red.text : complete ? "text-emerald-500" : tone.text,
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {cancelled ? (
          <XCircle className="h-7 w-7 text-red-500" />
        ) : complete ? (
          <BadgeCheck className="h-7 w-7 text-emerald-500" />
        ) : (
          <span className={cn("text-[26px] font-black leading-none tabular-nums", tone.text)}>
            {value}
            <span className="text-xs font-extrabold">%</span>
          </span>
        )}
        <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {cancelled ? "Cancelled" : "Complete"}
        </span>
      </div>
    </div>
  );
}

function MilestoneRail({
  stageIndex,
  isCancelled,
  isDone,
  tone,
}: {
  stageIndex: number;
  isCancelled: boolean;
  isDone: boolean;
  tone: Tone;
}) {
  const current = isCancelled ? -1 : isDone ? MILESTONES.length - 1 : milestoneForStage(stageIndex);

  return (
    <ol className="mt-4 flex items-start" aria-label="Repair journey">
      {MILESTONES.map((milestone, index) => {
        const Icon = milestone.icon;
        const done = !isCancelled && (index < current || (isDone && index === current));
        const active = !isCancelled && !isDone && index === current;

        return (
          <li
            key={milestone.label}
            className="relative flex min-w-0 flex-1 flex-col items-center text-center"
            aria-current={active ? "step" : undefined}
          >
            {index < MILESTONES.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-1/2 top-4 h-0.5 w-full -translate-y-1/2",
                  done ? "bg-emerald-500/60" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300",
                active
                  ? cn("scale-110 border-transparent text-white shadow-lg", tone.bg, tone.shadow)
                  : done
                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500"
                    : "border-border bg-card text-muted-foreground/70",
              )}
            >
              {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </span>
            <span
              className={cn(
                "mt-2 px-0.5 text-[9px] font-bold leading-tight min-[360px]:text-[10px]",
                active ? tone.text : done ? "text-foreground" : "text-muted-foreground/70",
              )}
            >
              {milestone.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function DetailItem({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </dt>
        <dd className="mt-0.5 break-words text-[13px] font-semibold leading-snug">{value}</dd>
      </div>
    </div>
  );
}

function NoteBlock({
  icon: Icon,
  label,
  text,
}: {
  icon: LucideIcon;
  label: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 break-words text-[13px] leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function TrackSkeleton({ ticket }: { ticket: string }) {
  return (
    <div className="mt-4 space-y-3.5" role="status" aria-live="polite">
      <div className="rounded-[1.75rem] border border-border/70 bg-card p-4 shadow-sm sm:p-5">
        <div className="flex items-center gap-4">
          <div className="h-24 w-24 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="h-3 w-20 animate-pulse rounded-full bg-muted" />
            <div className="h-6 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="h-3 w-full animate-pulse rounded-full bg-muted" />
            <div className="h-6 w-28 animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      </div>
      <div className="space-y-4 rounded-[1.5rem] border border-border/70 bg-card p-4 shadow-sm">
        <div className="h-3 w-28 animate-pulse rounded-full bg-muted" />
        <div className="flex items-center justify-between gap-2 px-1">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="flex flex-1 flex-col items-center gap-2">
              <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
              <div className="h-2 w-10 animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-[1.5rem] border border-border/70 bg-card p-4 shadow-sm">
        <div className="h-3 w-24 animate-pulse rounded-full bg-muted" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-10 animate-pulse rounded-xl bg-muted" />
          <div className="h-10 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
      <p className="text-center text-[11px] font-medium text-muted-foreground">
        Checking {ticket ? `ticket ${ticket}` : "your repair"}…
      </p>
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
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <label
        htmlFor="tracking-ticket"
        className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
      >
        Ticket number
      </label>
      <div className="relative mt-1.5">
        <Hash className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="tracking-ticket"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. JEGZ-2026-000001"
          aria-label="Ticket number"
          className="h-12 w-full rounded-2xl border border-border bg-background/80 pl-10 pr-3 text-base font-semibold tracking-wide outline-none transition placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/25"
        />
      </div>
      <button
        type="submit"
        className="mt-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-600 to-amber-500 text-sm font-bold text-white shadow-lg shadow-orange-500/20 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Track my repair
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
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
  const tone = isCancelled
    ? TONES.red
    : isDone
      ? TONES.emerald
      : repairToneFor(job?.repairStatus ?? "received");
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
  const paymentTone =
    remaining <= 0
      ? "bg-emerald-500/10 text-emerald-500"
      : (job?.amountPaid ?? 0) > 0
        ? "bg-amber-500/10 text-amber-500"
        : "bg-red-500/10 text-red-500";

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-background">
      {/* Ambient brand glow */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-gradient-to-b from-orange-500/10 via-orange-500/[0.03] to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -left-24 top-28 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -right-28 top-1/3 h-72 w-72 rounded-full bg-orange-500/10 blur-3xl"
      />

      {/* Sticky shop header */}
      <header className="sticky top-0 z-40 overflow-hidden border-b border-white/10 bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 text-white shadow-lg shadow-orange-950/15">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/15"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-12 left-1/3 h-24 w-24 rounded-full bg-black/10"
        />
        <div className="relative mx-auto flex w-full max-w-lg items-center gap-2.5 px-4 pb-2.5 pt-[calc(0.65rem+env(safe-area-inset-top))]">
          <ShopLogo logo={shop.logo} name={displayShopName} />
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/70">
              Repair tracker
            </p>
            <h1 className="truncate text-[15px] font-extrabold leading-tight tracking-tight">
              {displayShopName}
            </h1>
          </div>
          {ticket && (
            <button
              type="button"
              onClick={refresh}
              aria-label="Refresh repair status"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-inset ring-white/20 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </button>
          )}
          {state !== "ready" && contactHref && (
            <a
              href={contactHref}
              aria-label={`Call ${displayShopName}`}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-orange-600 shadow-md shadow-orange-950/20 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <Phone className="h-4 w-4" />
            </a>
          )}
        </div>
      </header>

      <main
        className={cn(
          "relative mx-auto w-full max-w-lg px-4 pt-4",
          state === "ready"
            ? "pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
            : "pb-[calc(2rem+env(safe-area-inset-bottom))]",
        )}
      >
        {/* Loading */}
        {state === "loading" && <TrackSkeleton ticket={ticket} />}

        {/* Idle / not found */}
        {(state === "idle" || state === "notfound") && (
          <section className="relative mt-1 overflow-hidden rounded-[1.75rem] border border-border/70 bg-gradient-to-br from-card via-card to-orange-500/5 p-4 shadow-xl shadow-black/5 sm:p-5">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full bg-orange-500/10 blur-3xl"
            />
            <div className="relative">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-inner",
                    state === "notfound"
                      ? "bg-red-500/10 text-red-500"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {state === "notfound" ? (
                    <SearchX className="h-6 w-6" />
                  ) : (
                    <PackageSearch className="h-6 w-6" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                    {state === "notfound" ? "Ticket lookup" : "Track your repair"}
                  </p>
                  <h2 className="mt-1 text-xl font-black leading-tight tracking-tight">
                    {state === "notfound" ? "We couldn't find that ticket" : "Where's my device?"}
                  </h2>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    {state === "notfound"
                      ? "Double-check the number printed on your job slip and try again, or call the shop and we'll help."
                      : "Enter the ticket number from your job slip to see live repair updates."}
                  </p>
                </div>
              </div>

              <TicketLookup
                key={ticket}
                defaultValue={ticket}
                onSubmit={updateTicket}
              />

              {state === "idle" ? (
                <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  You'll find the ticket number below the QR code on your job slip.
                </p>
              ) : (
                contactHref && (
                  <a
                    href={contactHref}
                    className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-primary"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Need help? Call {contactNumber}
                  </a>
                )
              )}
            </div>
          </section>
        )}

        {/* Job found */}
        {state === "ready" && job && (
          <div className="mt-1 space-y-3.5">
            {/* Status hero */}
            <section
              className={cn(
                "relative overflow-hidden rounded-[1.75rem] border bg-card p-4 shadow-xl shadow-black/5 sm:p-5",
                tone.border,
              )}
            >
              <div
                aria-hidden
                className={cn(
                  "absolute inset-x-0 top-0 h-1 bg-gradient-to-r",
                  isCancelled ? TONES.red.gradient : tone.gradient,
                )}
              />
              <div className="relative">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em]",
                      isCancelled
                        ? "bg-red-500/10 text-red-500"
                        : isDone
                          ? "bg-emerald-500/10 text-emerald-500"
                          : "bg-primary/10 text-primary",
                    )}
                  >
                    {isCancelled ? (
                      <XCircle className="h-3 w-3" />
                    ) : isDone ? (
                      <BadgeCheck className="h-3 w-3" />
                    ) : (
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                      </span>
                    )}
                    {isCancelled ? "Cancelled" : isDone ? "Completed" : "Live status"}
                  </span>
                  <span className="min-w-0 truncate font-mono text-[11px] font-bold text-muted-foreground">
                    {job.jobNumber || `#${job.ticket}`}
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <ProgressRing
                    progress={progress}
                    tone={tone}
                    cancelled={isCancelled}
                    complete={isDone}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      Current status
                    </p>
                    <h2
                      className="mt-0.5 text-[22px] font-black leading-tight tracking-tight sm:text-2xl"
                      aria-live="polite"
                    >
                      {isCancelled ? "Cancelled" : currentStage?.label ?? "Received"}
                    </h2>
                    <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                      {isCancelled
                        ? "This repair job was cancelled. Contact the shop if you need help."
                        : currentStage?.hint}
                    </p>
                    {!isCancelled && !isDone && (
                      <span
                        className={cn(
                          "mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[10px] font-semibold leading-snug",
                          tone.soft,
                          tone.text,
                        )}
                      >
                        <Clock3 className="h-3 w-3 shrink-0" />
                        {currentStage?.estimate}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-[10px] font-medium text-muted-foreground">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Received {formatShortDate(job.createdAt)}</span>
                  </span>
                  <span
                    className="inline-flex shrink-0 items-center gap-1.5"
                    aria-live="polite"
                  >
                    <RefreshCw
                      className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
                    />
                    {refreshing
                      ? "Updating…"
                      : updatedLabel
                        ? `Updated ${updatedLabel}`
                        : "Live"}
                  </span>
                </div>
              </div>
            </section>

            {/* Journey */}
            <section className="rounded-[1.5rem] border border-border/70 bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Repair journey
                </h2>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                  {isCancelled ? "Cancelled" : `${progress}% complete`}
                </span>
              </div>

              <MilestoneRail
                stageIndex={stageIndex}
                isCancelled={isCancelled}
                isDone={isDone}
                tone={tone}
              />

              {readyForPickup && (
                <div className="mt-3 flex items-start gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2.5">
                  <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <p className="text-[11px] font-semibold leading-snug text-emerald-500">
                    Your device is ready — drop by the shop to pick it up.
                  </p>
                </div>
              )}

              {!isCancelled && !isDone && !readyForPickup && nextStage && (
                <div className="mt-3 flex items-start gap-2 rounded-2xl bg-muted/50 px-3 py-2.5">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    <span className="font-bold text-foreground">Up next:</span>{" "}
                    {nextStage.label} — {nextStage.hint}
                  </p>
                </div>
              )}

              {isDone && !isCancelled && (
                <p className="mt-3 rounded-2xl bg-emerald-500/10 px-3 py-2.5 text-center text-[11px] font-semibold text-emerald-500">
                  All done — thank you for trusting us with your repair.
                </p>
              )}

              {isCancelled && (
                <p className="mt-3 rounded-2xl bg-red-500/10 px-3 py-2.5 text-center text-[11px] font-semibold text-red-500">
                  This repair was cancelled. Call the shop for more details.
                </p>
              )}

              <details className="group mt-3 border-t border-border/60 pt-3">
                <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 rounded-xl py-1 text-[11px] font-bold text-primary outline-none transition focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  View full timeline
                  <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <ol className="mt-3">
                  {STAGES.map((stage, index) => {
                    const done = !isCancelled && (index < stageIndex || isDone);
                    const active = !isCancelled && !isDone && index === stageIndex;
                    const Icon = stage.icon;

                    return (
                      <li key={stage.key} className="relative flex gap-3 pb-3.5 last:pb-0">
                        {index < STAGES.length - 1 && (
                          <span
                            aria-hidden
                            className={cn(
                              "absolute left-[13px] top-7 -bottom-0.5 w-0.5 rounded-full",
                              done ? "bg-emerald-500/60" : "bg-border",
                            )}
                          />
                        )}
                        <span
                          className={cn(
                            "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300",
                            active
                              ? cn("border-transparent text-white shadow-md", tone.bg, tone.shadow)
                              : done
                                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500"
                                : "border-border bg-muted/40 text-muted-foreground/70",
                          )}
                        >
                          {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p
                              className={cn(
                                "text-xs font-bold leading-tight",
                                active || done ? "text-foreground" : "text-muted-foreground/70",
                              )}
                            >
                              {stage.label}
                            </p>
                            {active && (
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white",
                                  tone.bg,
                                )}
                              >
                                Current
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                            {stage.hint}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </details>
            </section>

            {/* Job details */}
            <section className="rounded-[1.5rem] border border-border/70 bg-card p-4 shadow-sm">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Job details
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3.5">
                <DetailItem icon={UserRound} label="Customer" value={job.customerName} />
                <DetailItem icon={Smartphone} label="Device" value={job.device} />
                {!job.publicMirror && (
                  <DetailItem icon={Wrench} label="Technician" value={job.technicianName} />
                )}
                <DetailItem
                  icon={CalendarClock}
                  label="Received"
                  value={formatShortDate(job.createdAt)}
                />
              </dl>
            </section>

            {/* Payment — hidden on the public mirror because it contains no prices. */}
            {!job.publicMirror && job.total > 0 && (
              <section className="rounded-[1.5rem] border border-border/70 bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Payment
                  </h2>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                      paymentTone,
                    )}
                  >
                    {paymentLabel}
                  </span>
                </div>

                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      Total
                    </p>
                    <p className="mt-0.5 text-2xl font-black tracking-tight">
                      {formatCurrency(job.total)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      {remaining > 0 ? "Balance due" : "Payment"}
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-base font-extrabold",
                        remaining > 0 ? "text-red-500" : "text-emerald-500",
                      )}
                    >
                      {remaining > 0 ? formatCurrency(remaining) : "Fully paid"}
                    </p>
                  </div>
                </div>

                {(job.amountPaid ?? 0) > 0 && (
                  <div className="mt-2 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-[11px]">
                    <span className="text-muted-foreground">Deposit paid</span>
                    <span className="font-bold text-emerald-500">
                      {formatCurrency(job.amountPaid ?? 0)}
                    </span>
                  </div>
                )}

                {job.items.length > 0 && (
                  <details className="group mt-2 border-t border-dashed border-border pt-2">
                    <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 rounded-xl py-1.5 text-[11px] font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      View services &amp; parts ({job.items.length})
                      <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
                    </summary>
                    <ul className="divide-y divide-border/50">
                      {job.items.map((item, index) => (
                        <li key={`${item.name}-${index}`} className="flex items-start gap-2.5 py-2.5">
                          <span
                            className={cn(
                              "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                              item.type === "product"
                                ? "bg-amber-500/10 text-amber-500"
                                : "bg-blue-500/10 text-blue-500",
                            )}
                          >
                            {item.type === "product" ? (
                              <Package className="h-3.5 w-3.5" />
                            ) : (
                              <Wrench className="h-3.5 w-3.5" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold leading-snug">{item.name}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {item.type === "product" ? "Part" : "Service"}
                              {item.isPreOrder ? " · Pre-order" : ""} · x{item.quantity}
                            </p>
                          </div>
                          <p className="shrink-0 text-xs font-bold">
                            {formatCurrency(item.price * item.quantity)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )}

            {/* Notes — also excluded from the public mirror. */}
            {!job.publicMirror && (job.complaint || job.diagnosis || job.notes) && (
              <section className="rounded-[1.5rem] border border-border/70 bg-card p-4 shadow-sm">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Repair notes
                </h2>
                <div className="mt-3 space-y-3">
                  {job.complaint && (
                    <NoteBlock icon={ClipboardList} label="Reported issue" text={job.complaint} />
                  )}
                  {job.diagnosis && (
                    <NoteBlock icon={Stethoscope} label="Diagnosis" text={job.diagnosis} />
                  )}
                  {job.notes && (
                    <NoteBlock icon={MessageSquareText} label="Technician notes" text={job.notes} />
                  )}
                </div>
              </section>
            )}
          </div>
        )}

        {/* Contact shop — always available */}
        {state !== "loading" && (
          <section className="relative mt-3.5 overflow-hidden rounded-[1.5rem] border border-border/70 bg-gradient-to-br from-card via-card to-orange-500/5 p-4 shadow-sm">
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-12 -right-10 h-32 w-32 rounded-full bg-orange-500/10 blur-3xl"
            />
            <div className="relative flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/25">
                <Phone className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold">Need a hand?</h2>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  Questions about your repair? The shop team is happy to help.
                </p>
              </div>
            </div>

            <div className="relative mt-3 grid gap-2">
              {contactHref && (
                <a
                  href={contactHref}
                  className="flex items-center gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-2.5 transition hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99]"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Phone className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      Call us
                    </p>
                    <p className="break-words text-xs font-bold">{contactNumber}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </a>
              )}

              {shopAddress && directionsHref && (
                <a
                  href={directionsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-2.5 transition hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99]"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <MapPin className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      Visit us
                    </p>
                    <p className="break-words text-xs font-semibold leading-snug">{shopAddress}</p>
                  </div>
                  <Navigation className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </a>
              )}

              {!contactHref && !directionsHref && (
                <p className="flex items-start gap-2 rounded-2xl border border-border/60 bg-background/70 px-3 py-2.5 text-[11px] leading-snug text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Use the phone number printed on your job slip to reach the shop.
                </p>
              )}
            </div>
          </section>
        )}

        {/* Refresh footer */}
        <div className="mt-4 flex flex-col items-center gap-1 text-center text-[10px] font-medium text-muted-foreground">
          <span className="inline-flex items-center gap-1.5" aria-live="polite">
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
            {ticket
              ? refreshing
                ? "Checking for updates…"
                : state === "notfound"
                  ? `Auto-retry in ${secondsLeft}s`
                  : `Auto-updates in ${secondsLeft}s`
              : "Enter a ticket to start tracking"}
          </span>
          {lastUpdated && (
            <span>
              Last checked{" "}
              {lastUpdated.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>

        <p className="mt-4 pb-1 text-center text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
          Powered by FixMo PH
        </p>
      </main>

      {/* Mobile action bar */}
      {state === "ready" && job && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/90 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_30px_rgba(0,0,0,0.14)] backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-lg items-center gap-2.5">
            {contactHref ? (
              <>
                <a
                  href={contactHref}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-600 to-amber-500 text-sm font-bold text-white shadow-lg shadow-orange-500/25 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <Phone className="h-4 w-4" />
                  Call shop
                </a>
                <button
                  type="button"
                  onClick={refresh}
                  aria-label="Refresh repair status"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RefreshCw className={cn("h-5 w-5", refreshing && "animate-spin")} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={refresh}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-600 to-amber-500 text-sm font-bold text-white shadow-lg shadow-orange-500/25 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <RefreshCw className={cn("h-5 w-5", refreshing && "animate-spin")} />
                {refreshing ? "Refreshing…" : "Refresh status"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
