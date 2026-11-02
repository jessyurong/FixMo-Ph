import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "wouter";
import {
  Activity,
  BadgeCheck,
  BellRing,
  CalendarClock,
  Check,
  Clock3,
  CircleAlert,
  Hash,
  Inbox,
  Loader2,
  MapPin,
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
import { cn, formatCurrency, formatDate } from "@/lib/utils";
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

/**
 * Resolve a ticket from the shop's local IndexedDB first (works offline on the
 * shop device), then fall back to the existing transaction API so the link can
 * also work on a customer's phone when an API is available.
 */
async function resolveTicket(ticket: string): Promise<TrackedJob | null> {
  const value = ticket.trim();
  if (!value) return null;

  try {
    if (/^\d+$/.test(value)) {
      const local = await transactionService.getEnriched(Number(value));
      if (local) return fromEnriched(local);
    }

    const byJobNumber = (await transactionService.listRaw()).find(
      (tx) => (tx.jobNumber || "").toLowerCase() === value.toLowerCase(),
    );
    if (byJobNumber) {
      const enriched = await transactionService.getEnriched(byJobNumber.id);
      if (enriched) return fromEnriched(enriched);
    }
  } catch {
    // Local lookup is best-effort; fall through to the API.
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
function DetailTile({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="break-words text-sm font-semibold leading-snug">{value}</p>
    </div>
  );
}

function BrandMark({ logo, name }: { logo?: string; name: string }) {
  if (logo) {
    return (
      <img
        src={logo}
        alt={`${name} logo`}
        className="h-14 w-14 shrink-0 rounded-2xl border border-white/25 bg-white object-cover shadow-lg"
      />
    );
  }
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/25 bg-white/15 shadow-lg backdrop-blur-sm">
      <Wrench className="h-7 w-7" />
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
      className="mt-5 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <div className="relative flex-1">
        <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="text"
          autoCapitalize="characters"
          placeholder="Enter ticket number"
          aria-label="Ticket number"
          className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <button
        type="submit"
        className="h-11 shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition active:scale-95"
      >
        Track
      </button>
    </form>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function TrackPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const ticket = (searchParams.get("ticket") || "").trim();
  const shop = useShopProfile();
  const { job, state, lastUpdated, refreshing, secondsLeft, refresh } = useTrackedJob(ticket);

  const updateTicket = (next: string) => {
    setSearchParams({ ticket: next }, { replace: true });
  };

  const contactNumber = shop.contactNumber?.trim() || "+63 917 123 4567";
  const contactHref = `tel:${contactNumber.replace(/[^\d+]/g, "")}`;

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

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background pb-10">
      {/* Ambient brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-orange-500/20 via-orange-500/5 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-32 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-28 top-72 h-72 w-72 rounded-full bg-orange-500/10 blur-3xl"
      />

      <main className="relative mx-auto w-full max-w-lg px-4 pt-5 sm:pt-8">
        {/* Shop header */}
        <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-600 via-orange-500 to-amber-500 p-5 text-white shadow-xl shadow-orange-500/20">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/15"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 -left-8 h-36 w-36 rounded-full bg-black/10"
          />
          <div className="relative flex items-center gap-3.5">
            <BrandMark logo={shop.logo} name={shop.name} />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/75">
                Repair Status Tracker
              </p>
              <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">
                {shop.name}
              </h1>
              <p className="mt-0.5 text-xs font-medium text-white/80">
                Live updates on your repair
              </p>
            </div>
          </div>

          {job && (
            <div className="relative mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-3 py-1 font-mono text-xs font-bold tracking-wide backdrop-blur-sm">
                <Hash className="h-3 w-3" />
                {job.jobNumber || `TICKET ${job.ticket}`}
              </span>
              {!isDone && !isCancelled && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider backdrop-blur-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                  </span>
                  Live
                </span>
              )}
            </div>
          )}
        </header>

        {/* Loading */}
        {state === "loading" && (
          <div className="mt-6 flex flex-col items-center justify-center rounded-3xl border border-border bg-card px-6 py-16 text-center shadow-sm">
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
            <p className="mt-4 text-sm font-semibold">Looking up your repair…</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ticket {ticket || "—"}
            </p>
          </div>
        )}

        {/* Idle / not found */}
        {(state === "idle" || state === "notfound") && (
          <div className="relative mt-6 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-card via-card to-orange-500/5 p-6 text-center shadow-lg shadow-orange-500/5">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-orange-500/10 blur-3xl"
            />
            <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-muted to-muted/40 text-muted-foreground shadow-inner">
              <SearchX className="h-7 w-7" />
            </div>
            <h2 className="relative mt-4 text-lg font-bold">Repair ticket not found</h2>
            <p className="relative mx-auto mt-1.5 max-w-xs text-sm font-medium text-muted-foreground">
              Repair ticket not found. Please check your receipt.
            </p>
            <p className="relative mx-auto mt-1 max-w-xs text-xs text-muted-foreground/80">
              Enter the ticket number printed on your receipt or job slip to try again.
            </p>
            <div className="mx-auto max-w-sm text-left">
              <TicketLookup
                key={ticket}
                defaultValue={ticket}
                onSubmit={updateTicket}
              />
            </div>
            {shop.contactNumber && (
              <a
                href={`tel:${shop.contactNumber}`}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary"
              >
                <Phone className="h-3.5 w-3.5" />
                Need help? Call {shop.contactNumber}
              </a>
            )}
          </div>
        )}

        {/* Job found */}
        {state === "ready" && job && (
          <div className="mt-5 space-y-4">
            {/* Overall progress at the top */}
            <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-card via-card to-orange-500/5 p-4 shadow-lg shadow-orange-500/5">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-orange-500/10 blur-2xl"
              />
              <div className="relative">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <Activity className="h-3.5 w-3.5 text-primary" />
                    Overall progress
                  </span>
                  <span className={cn("text-sm font-extrabold", tone.text)}>
                    {progress}% complete
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted shadow-inner">
                  <div
                    className={cn(
                      "h-full rounded-full bg-gradient-to-r shadow-sm transition-all duration-700 ease-out",
                      isCancelled ? TONES.red.gradient : tone.gradient,
                    )}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                  <span>
                    {isCancelled ? "No progress" : `Stage ${stageIndex + 1} of ${STAGES.length}`}
                  </span>
                  <span>{isCancelled ? "Cancelled" : currentStage?.label ?? "Received"}</span>
                </div>
              </div>
            </section>

            {/* Current status hero */}
            <section
              className={cn(
                "relative overflow-hidden rounded-3xl border bg-card p-5 shadow-sm",
                tone.border,
              )}
            >
              <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", tone.gradient)} />
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg",
                      isCancelled ? TONES.red.bg : tone.bg,
                      isCancelled ? TONES.red.shadow : tone.shadow,
                    )}
                  >
                    {isCancelled ? (
                      <XCircle className="h-6 w-6" />
                    ) : isDone ? (
                      <BadgeCheck className="h-6 w-6" />
                    ) : (
                      currentStage && <currentStage.icon className="h-6 w-6" />
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Current status
                    </p>
                    <h2 className="text-xl font-extrabold leading-tight">
                      {isCancelled
                        ? "Cancelled"
                        : currentStage?.label ?? "Received"}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {isCancelled
                        ? "This repair job was cancelled."
                        : currentStage?.hint}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={refresh}
                  aria-label="Refresh status"
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition active:scale-90",
                    refreshing && "text-primary",
                  )}
                >
                  <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                </button>
              </div>

              {!isCancelled && currentStage && (
                <p
                  className={cn(
                    "mt-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    tone.soft,
                    tone.text,
                  )}
                >
                  <Clock3 className="h-3 w-3" />
                  {currentStage.estimate}
                </p>
              )}
            </section>

            {/* Timeline */}
            <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Repair Progress
                </h3>
                <span className="text-[11px] font-medium text-muted-foreground">
                  {STAGES.length} stages
                </span>
              </div>

              <ol className="relative">
                {STAGES.map((stage, index) => {
                  const done = !isCancelled && (index < stageIndex || (isDone && index === stageIndex));
                  const active = !isCancelled && index === stageIndex;
                  const Icon = stage.icon;

                  return (
                    <li key={stage.key} className="relative flex gap-3.5 pb-5 last:pb-0">
                      {/* connector */}
                      {index < STAGES.length - 1 && (
                        <span
                          aria-hidden
                          className={cn(
                            "absolute left-[19px] top-10 -bottom-0.5 w-0.5 rounded-full",
                            done ? "bg-emerald-500" : "bg-border",
                          )}
                        />
                      )}

                      <div className="relative z-10 shrink-0">
                        {active && (
                          <span
                            aria-hidden
                            className={cn(
                              "absolute -inset-1.5 rounded-full opacity-70",
                              tone.soft,
                              "animate-pulse",
                            )}
                          />
                        )}
                        {active && (
                          <span
                            aria-hidden
                            className={cn(
                              "absolute -inset-0.5 rounded-full opacity-40",
                              tone.soft,
                              "animate-ping",
                            )}
                          />
                        )}
                        <div
                          className={cn(
                            "relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300",
                            active
                              ? cn(
                                  "border-transparent text-white shadow-lg shadow-orange-500/20 scale-110",
                                  isCancelled ? TONES.red.bg : tone.bg,
                                  isCancelled ? TONES.red.shadow : tone.shadow,
                                )
                              : done
                                ? "border-emerald-500 bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-md shadow-emerald-500/20"
                                : "border-border bg-muted/50 text-muted-foreground",
                          )}
                        >
                          {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1 pt-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p
                            className={cn(
                              "text-sm font-bold leading-tight",
                              active
                                ? "text-foreground"
                                : done
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                            )}
                          >
                            {stage.label}
                          </p>
                          {active && (
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white",
                                isCancelled ? TONES.red.bg : tone.bg,
                              )}
                            >
                              Current
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                          {stage.hint}
                        </p>
                        <p
                          className={cn(
                            "mt-1 inline-flex items-center gap-1 text-[11px] font-medium",
                            active ? tone.text : "text-muted-foreground/80",
                          )}
                        >
                          <Clock3 className="h-3 w-3 shrink-0" />
                          {stage.estimate}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* Details */}
            <section className="space-y-3">
              <h3 className="px-1 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Repair Details
              </h3>
              <div className="grid grid-cols-2 gap-2.5">
                <DetailTile icon={UserRound} label="Customer" value={job.customerName} />
                <DetailTile icon={Smartphone} label="Device / Unit" value={job.device} />
                <DetailTile icon={Wrench} label="Technician" value={job.technicianName} />
                <DetailTile
                  icon={CalendarClock}
                  label="Date received"
                  value={job.createdAt ? formatDate(job.createdAt) : "—"}
                />
              </div>
            </section>

            {/* Services / parts */}
            <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Services &amp; Parts
                </h3>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {job.items.length} item{job.items.length === 1 ? "" : "s"}
                </span>
              </div>

              {job.items.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No services or parts listed yet.
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {job.items.map((item, index) => (
                    <li key={`${item.name}-${index}`} className="flex items-start gap-3 py-3">
                      <div
                        className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                          item.type === "product"
                            ? "bg-amber-500/10 text-amber-500"
                            : "bg-blue-500/10 text-blue-500",
                        )}
                      >
                        {item.type === "product" ? (
                          <Package className="h-4 w-4" />
                        ) : (
                          <Wrench className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-snug">{item.name}</p>
                        <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {item.type === "product" ? "Part" : "Service"}
                          {item.isPreOrder ? " · Pre-order" : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold">
                          {formatCurrency(item.price * item.quantity)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">x{item.quantity}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-2 border-t border-dashed border-border pt-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Total amount
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {job.paymentStatus === "paid"
                        ? "Fully paid"
                        : job.amountPaid && job.amountPaid > 0
                          ? `Paid ${formatCurrency(job.amountPaid)}`
                          : "Payment due at pickup"}
                    </p>
                  </div>
                  <p className="text-2xl font-extrabold tracking-tight text-primary">
                    {formatCurrency(job.total)}
                  </p>
                </div>
                {typeof job.remainingBalance === "number" && job.remainingBalance > 0 && (
                  <div className="mt-1 flex items-center justify-end gap-1 text-xs font-semibold text-red-500">
                    <CircleAlert className="h-3.5 w-3.5" />
                    Balance due: {formatCurrency(job.remainingBalance)}
                  </div>
                )}
              </div>
            </section>

            {/* Notes */}
            {(job.complaint || job.diagnosis || job.notes) && (
              <section className="space-y-2.5">
                {job.complaint && (
                  <div className="rounded-2xl border border-border bg-card/60 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Reported issue
                    </p>
                    <p className="mt-1 text-sm">{job.complaint}</p>
                  </div>
                )}
                {job.diagnosis && (
                  <div className="rounded-2xl border border-border bg-card/60 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Diagnosis
                    </p>
                    <p className="mt-1 text-sm">{job.diagnosis}</p>
                  </div>
                )}
                {job.notes && (
                  <div className="rounded-2xl border border-border bg-card/60 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Technician notes
                    </p>
                    <p className="mt-1 text-sm">{job.notes}</p>
                  </div>
                )}
              </section>
            )}

          </div>
        )}

        {/* Contact shop — always available */}
        <section className="relative mt-5 overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-card via-card to-orange-500/5 p-5 shadow-lg shadow-orange-500/5">
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-12 -right-10 h-32 w-32 rounded-full bg-orange-500/10 blur-3xl"
          />
          <div className="relative flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/30">
              <Phone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Contact Shop
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Questions about your repair? Our team is happy to help.
              </p>
            </div>
          </div>
          <div className="relative mt-4 grid gap-2 text-sm">
            <a
              href={contactHref}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/60 px-3.5 py-2.5 font-semibold transition hover:border-primary/40 hover:bg-primary/5"
            >
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4 text-primary" />
                Call us
              </span>
              <span>{contactNumber}</span>
            </a>
            {shop.address && (
              <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-background/60 px-3.5 py-2.5 text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{shop.address}</span>
              </div>
            )}
          </div>
        </section>

        {/* Refresh footer */}
        <div className="mt-5 flex items-center justify-between gap-3 px-1 text-[11px] font-medium text-muted-foreground">
          <span className="inline-flex items-center gap-1.5" aria-live="polite">
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
            {ticket
              ? secondsLeft > 0
                ? `Refreshing in ${secondsLeft} seconds...`
                : "Refreshing now..."
              : "Enter a ticket to start tracking"}
          </span>
          <span>
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "Waiting for status…"}
          </span>
        </div>

        <p className="mt-3 pb-2 text-center text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Powered by FixMo PH
        </p>
      </main>
    </div>
  );
}
