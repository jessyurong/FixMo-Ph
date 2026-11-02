/**
 * Offline-First Data Services
 * These services handle all CRUD operations using IndexedDB.
 *
 * Job lifecycle:
 *   saveAsPending -> updatePendingJob (edits) -> completeJob | cancelJob
 *   completeNewJob (direct walk-in sale without pending step)
 *
 * Stock safety:
 *   - Products carry `reservedStock` for units "held" by active pending jobs.
 *   - Normal (in-stock) items reserve at save-as-pending and are deducted on completion.
 *   - Pre-order items NEVER touch inventory stock.
 *   - One-time custom products (not saved to inventory) never touch inventory stock.
 */

import { localDb } from './local-db';
import { REPAIR_STATUSES, TRANSACTION_STATUSES } from './db-types';
import type {
  ActivityLog,
  AppUser,
  Backjob,
  CashDrawerEntry,
  CountStat,
  Dashboard,
  DefectiveItem,
  EnrichedTransaction,
  GcashDrawerEntry,
  JobPaymentStatus,
  MetaRecord,
  RepairStatus,
  MonthlyDay,
  MonthlyReport,
  NewDefectiveItem,
  NewTransactionItem,
  Product,
  Service,
  Settings,
  Technician,
  TechnicianReportRow,
  TrackingHistoryEvent,
  Transaction,
  TransactionItem,
  TransactionStatus,
  TransactionStats,
} from './db-types';
import { generateTrackingToken } from './tracking-token';
import { queueTransactionTracking } from './tracking-mirror';
import {
  deleteLocalAndQueue,
  flushSyncOutbox,
  queueDeletedRows,
  queueSyncDelete,
  queueSyncRecord,
} from './sync-engine';

export type {
  ActivityLog,
  AppUser,
  Backjob,
  CashDrawerEntry,
  CountStat,
  Dashboard,
  DefectiveItem,
  EnrichedTransaction,
  GcashDrawerEntry,
  JobPaymentStatus,
  MetaRecord,
  MonthlyDay,
  MonthlyReport,
  NewDefectiveItem,
  NewTransactionItem,
  Product,
  RepairStatus,
  Service,
  Settings,
  Technician,
  TechnicianReportRow,
  Transaction,
  TransactionItem,
  TransactionStatus,
  TransactionStats,
  TRANSACTION_STATUSES,
} from './db-types';

export { REPAIR_STATUSES } from './db-types';

// ─── Shared helpers ─────────────────────────────────────────────────────────
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Default low-stock threshold when a product has no reorderPoint set. */
export const DEFAULT_REORDER_POINT = 3;

const nowISO = () => new Date().toISOString();

/** Queue product rows whose stock/reservation changed inside a job write. */
async function queueProductsForItems(
  items: Array<{ type?: string; refId?: number }>,
): Promise<void> {
  const ids = [...new Set(
    items
      .filter((item) => item.type === 'product' && Number(item.refId) > 0)
      .map((item) => Number(item.refId)),
  )];
  for (const id of ids) {
    await queueSyncRecord('products', id, { flush: false });
  }
  if (ids.length > 0) void flushSyncOutbox(true);
}

/** Queue drawer rows created by a job operation (deposits and final sale). */
async function queueRecentDrawerEntries(since: string): Promise<void> {
  const [cash, gcash] = await Promise.all([
    localDb.cashDrawerEntries.filter((row) => String(row.createdAt || '') >= since).toArray(),
    localDb.gcashDrawerEntries.filter((row) => String(row.createdAt || '') >= since).toArray(),
  ]);
  for (const row of cash) await queueSyncRecord('cashDrawerEntries', row, { flush: false });
  for (const row of gcash) await queueSyncRecord('gcashDrawerEntries', row, { flush: false });
  if (cash.length + gcash.length > 0) void flushSyncOutbox(true);
}

export function isCompletedStatus(status: unknown): boolean {
  return status === 'completed' || status === 'complete' || status === 'done';
}

export function isCancelledStatus(status: unknown): boolean {
  return status === 'cancelled' || status === 'canceled';
}

export function isOpenStatus(status: unknown): boolean {
  return !isCompletedStatus(status) && !isCancelledStatus(status);
}

export function normalizeStatus(status: unknown): TransactionStatus {
  if (status === 'complete' || status === 'done') return 'completed';
  if (status === 'in-progress' || status === 'in progress') return 'in_progress';
  if (status === 'ready') return 'ready_for_pickup';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (TRANSACTION_STATUSES.includes(status as TransactionStatus)) return status as TransactionStatus;
  return 'pending';
}

/** Normalize the technician repair progress, defaulting to `received`. */
export function normalizeRepairStatus(value: unknown): RepairStatus {
  if (REPAIR_STATUSES.includes(value as RepairStatus)) return value as RepairStatus;
  return 'received';
}

/**
 * Best-effort repair progress for records created before `repair_status`
 * existed. A missing value is inferred from the transaction status so old jobs
 * still show a sensible badge instead of everything reading "Received".
 */
export function repairStatusFor(tx: Pick<Transaction, 'status' | 'repair_status'>): RepairStatus {
  if (tx.repair_status) return normalizeRepairStatus(tx.repair_status);

  switch (normalizeStatus(tx.status)) {
    case 'waiting_for_parts':
    case 'pre_ordered':
      return 'waiting_for_parts';
    case 'in_progress':
      return 'in_repair';
    case 'ready_for_pickup':
    case 'completed':
      return 'ready_for_pickup';
    default:
      return 'received';
  }
}

/** Append a repair-progress event without duplicating consecutive statuses. */
export function appendTrackingHistory(
  existing: TrackingHistoryEvent[] | undefined,
  status: RepairStatus,
  timestamp: string,
): TrackingHistoryEvent[] {
  const history = Array.isArray(existing) ? existing.slice(-49) : [];
  if (history.length === 0) return [{ status, timestamp }];
  if (history[history.length - 1].status === status) return history;
  return [...history, { status, timestamp }];
}

export function paymentStatusFor(total: number | undefined, amountPaid: number | undefined): JobPaymentStatus {
  const t = total || 0;
  const paid = amountPaid || 0;
  if (paid >= t) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

/** Units actually available to sell right now (stock minus reserved). */
export function availableStockOf(product: Pick<Product, 'stock' | 'reservedStock'>): number {
  return Math.max(0, (product.stock ?? 0) - (product.reservedStock ?? 0));
}

/** Item touches physical inventory stock on completion. */
export function isStockReducingItem(item: {
  type?: string;
  isPreOrder?: boolean;
  isCustom?: boolean;
  savedToList?: boolean;
}): boolean {
  if (item.type !== 'product') return false;
  if (item.isPreOrder) return false;
  // One-time custom products never created a stock record.
  if (item.isCustom && !item.savedToList) return false;
  return true;
}

/** Item carries a real inventory reference id (not a synthetic custom id). */
function hasInventoryRef(item: { type?: string; refId?: number; isPreOrder?: boolean; isCustom?: boolean; savedToList?: boolean }): boolean {
  if (!isStockReducingItem(item)) return false;
  const refId = Number(item.refId);
  return Number.isFinite(refId) && refId > 0;
}

/** Best-effort gross profit from item costs; falls back to a 20% margin estimate. */
export function getJobProfit(items: TransactionItem[], total?: number): number {
  let costedProfit = 0;
  let hasCostData = false;
  for (const item of items) {
    const qty = item.quantity || 1;
    if (typeof item.cost === 'number' && typeof item.price === 'number') {
      costedProfit += (item.price - item.cost) * qty;
      hasCostData = true;
    } else if (item.type === 'product' && typeof item.price === 'number' && typeof item.cost === 'undefined') {
      // products without recorded cost cannot contribute to known profit
    }
  }
  if (hasCostData) return round2(costedProfit);
  return round2((total || 0) * 0.2);
}

// ─── Job number generator ───────────────────────────────────────────────────
/**
 * Generate a unique human-readable job number: JEGZ-YYYY-NNNNNN.
 * Uniqueness is guaranteed by a per-year global counter stored in `meta`
 * (e.g. `jobSeqGlobal_2026`). The counter is persisted in the same database
 * as the transactions, seeded on first use from the highest existing JEGZ
 * number for that year, and only ever increases. This keeps numbers stable
 * across refreshes/restarts, survives backup/restore (meta is part of the
 * backup), and means deleted numbers are never re-used.
 */
export async function generateJobNumber(): Promise<string> {
  const year = String(new Date().getFullYear());
  const counterKey = `jobSeqGlobal_${year}`;
  return localDb.transaction('rw', localDb.meta, localDb.transactions, async () => {
    const meta = await localDb.meta.get(counterKey);
    let seq =
      typeof meta?.value === 'number' && Number.isFinite(meta.value) ? meta.value : 0;
    if (!meta) {
      const prefix = `JEGZ-${year}-`;
      const existing = await localDb.transactions.toArray();
      let max = 0;
      for (const tx of existing) {
        const jn = String(tx.jobNumber || '');
        if (jn.startsWith(prefix)) {
          const n = parseInt(jn.slice(prefix.length), 10);
          if (Number.isFinite(n) && n > max) max = n;
        }
      }
      seq = max;
    }
    seq += 1;
    await localDb.meta.put({ key: counterKey, value: seq, updatedAt: nowISO() } as any);
    return `JEGZ-${year}-${String(seq).padStart(6, '0')}`;
  });
}

/** Backfill missing job numbers for records created before this feature existed. */
export async function ensureJobNumbers(): Promise<void> {
  const missing = await localDb.transactions.filter(tx => !tx.jobNumber).toArray();
  for (const tx of missing) {
    const jobNumber = await generateJobNumber();
    await localDb.transactions.update(tx.id, { jobNumber });
    await queueSyncRecord('transactions', tx.id, { flush: false });
  }
  if (missing.length > 0) void flushSyncOutbox();
}

const LOW_STOCK_DEFAULTS_FLAG = 'low_stock_defaults_v1';

/**
 * Backfill the default low-stock threshold for products that do not have their
 * own reorderPoint. Runs once and never overwrites existing thresholds.
 */
export async function normalizeLowStockDefaults(): Promise<void> {
  const flag = await localDb.meta.get(LOW_STOCK_DEFAULTS_FLAG);
  if (flag?.value === true) return;

  const products = await localDb.products.toArray();
  for (const p of products) {
    if (typeof p.reorderPoint !== 'number' || !Number.isFinite(p.reorderPoint) || p.reorderPoint < 0) {
      await localDb.products.update(p.id, { reorderPoint: DEFAULT_REORDER_POINT, updatedAt: nowISO() });
      await queueSyncRecord('products', p.id, { flush: false });
    }
  }

  await localDb.meta.put({ key: LOW_STOCK_DEFAULTS_FLAG, value: true, updatedAt: nowISO() } as any);
  void flushSyncOutbox();
}

// ─── Product Services ───────────────────────────────────────────────────────
export interface ProductListOptions {
  search?: string;
  deviceType?: string;
}

/**
 * Normalize any stored/legacy deviceType value to android | iphone | both.
 * Legacy data may contain 'Samsung', 'iPhone', 'Universal', empty, etc.
 */
export function normalizeDeviceType(value: unknown): 'android' | 'iphone' | 'both' {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || v === 'both' || v === 'all' || v === 'universal' || v === 'general' || v === 'accessories' || v === 'parts') return 'both';
  if (v === 'android' || v === 'samsung' || v === 'oppo' || v === 'vivo' || v === 'xiaomi' || v === 'huawei' || v === 'realme' || v === 'infinix' || v === 'tecno') return 'android';
  if (v === 'iphone' || v === 'ios' || v === 'apple') return 'iphone';
  return 'both';
}

/** Android tab shows android + both, iPhone tab shows iphone + both. */
export function matchesDeviceFilter(productDevice: unknown, filter: unknown): boolean {
  const f = String(filter ?? '').trim().toLowerCase();
  if (!f || f === 'all') return true;
  const wanted = normalizeDeviceType(f);
  if (wanted === 'both') return true;
  const actual = normalizeDeviceType(productDevice);
  if (actual === 'both') return true;
  return actual === wanted;
}

export const productService = {
  async list(opts?: ProductListOptions): Promise<Product[]> {
    let rows = await localDb.products.toArray();

    const deviceType = opts?.deviceType;
    if (deviceType && String(deviceType).trim().toLowerCase() !== 'all') {
      rows = rows.filter((p) => matchesDeviceFilter((p as any).deviceType, deviceType));
    }

    const search = opts?.search?.trim().toLowerCase();
    if (search) {
      rows = rows.filter(
        (p) =>
          String(p.name ?? '').toLowerCase().includes(search) ||
          String(p.category ?? '').toLowerCase().includes(search),
      );
    }

    return rows;
  },

  async get(id: number): Promise<Product | undefined> {
    return localDb.products.get(id);
  },

  async create(product: Omit<Product, 'id'>): Promise<number> {
    const now = nowISO();
    const id = await localDb.products.add({
      ...product,
      reservedStock: (product as any).reservedStock ?? 0,
      createdAt: now,
      updatedAt: now,
    });
    await queueSyncRecord('products', id);
    return id;
  },

  async update(id: number, product: Partial<Product>): Promise<void> {
    await localDb.products.update(id, { ...product, updatedAt: nowISO() });
    await queueSyncRecord('products', id);
  },

  async delete(id: number): Promise<void> {
    await deleteLocalAndQueue('products', id);
  },

  async getLowStock(reorderPoint?: number): Promise<Product[]> {
    const all = await localStorageSafeProducts();
    return all.filter(p => availableStockOf(p) <= (reorderPoint ?? p.reorderPoint ?? DEFAULT_REORDER_POINT));
  },
};

async function localStorageSafeProducts(): Promise<Product[]> {
  return localDb.products.toArray();
}

// ─── Service Services ───────────────────────────────────────────────────────
export const serviceService = {
  async list(): Promise<Service[]> {
    return localDb.services.toArray();
  },

  async get(id: number): Promise<Service | undefined> {
    return localDb.services.get(id);
  },

  async create(service: Omit<Service, 'id'>): Promise<number> {
    const now = nowISO();
    const id = await localDb.services.add({ ...service, createdAt: now, updatedAt: now });
    await queueSyncRecord('services', id);
    return id;
  },

  async update(id: number, service: Partial<Service>): Promise<void> {
    await localDb.services.update(id, { ...service, updatedAt: nowISO() });
    await queueSyncRecord('services', id);
  },

  async delete(id: number): Promise<void> {
    await deleteLocalAndQueue('services', id);
  },

  /** Count historical transaction lines that reference this service. */
  async countReferences(id: number): Promise<number> {
    return localDb.transactionItems
      .filter((item) => item.type === 'service' && Number(item.refId) === Number(id))
      .count();
  },
};

// ─── Service catalog normalization ──────────────────────────────────────────
const SERVICE_TYPE_TO_CATEGORY: Record<string, string> = {
  repair: 'Repair',
  maintenance: 'Maintenance',
  support: 'Support',
  diagnosis: 'Diagnosis',
  custom: 'General',
  android: 'Android',
  iphone: 'iPhone',
};

/** Suggested categories shown in the Services & Labor form. */
export const SERVICE_CATEGORIES = ['Repair', 'Maintenance', 'Support', 'Diagnosis', 'General'];

/** Derive a human-friendly category from a legacy service type. */
function serviceCategoryFor(service: { type?: string; category?: string }): string {
  const explicit = service.category && String(service.category).trim();
  if (explicit) return explicit;
  const type = service.type;
  if (type) {
    const mapped = SERVICE_TYPE_TO_CATEGORY[type];
    if (mapped) return mapped;
    return type.charAt(0).toUpperCase() + type.slice(1);
  }
  return 'General';
}

/**
 * Idempotent migration that brings every service in the canonical table into
 * the current catalog shape (category, active, numeric price/cost) without
 * touching its name, type, or existing price/cost values beyond fixing types.
 * Safe to run on every bootstrap and after backup imports.
 */
export async function normalizeServiceCatalog(): Promise<void> {
  const all = await localDb.services.toArray();
  const now = nowISO();
  for (const service of all) {
    const category = serviceCategoryFor(service);
    const active = service.active !== false;
    const cost = typeof service.cost === 'number' && Number.isFinite(service.cost) ? service.cost : 0;
    const price = typeof service.price === 'number' && Number.isFinite(service.price) ? service.price : 0;
    if (service.category !== category || service.active === undefined || service.cost !== cost || service.price !== price) {
      await localDb.services.update(service.id, { category, active, cost, price, updatedAt: now });
      await queueSyncRecord('services', service.id, { flush: false });
    }
  }
  void flushSyncOutbox();
}

// ─── Technician Services ────────────────────────────────────────────────────
export const technicianService = {
  async list(): Promise<Technician[]> {
    const list = await localDb.technicians.toArray();
    const txs = await localDb.transactions.toArray();
    const completed = txs.filter(tx => isCompletedStatus(tx.status));
    return list.map(t => {
      const techTxs = completed.filter(tx => tx.technicianId === t.id);
      const jobsDone = techTxs.length;
      const totalSales = techTxs.reduce((sum, tx) => sum + (tx.total || 0), 0);
      return {
        ...t,
        role: t.role || t.specialization || 'Senior Technician',
        jobsDone: t.jobsDone ?? jobsDone,
        totalSales: t.totalSales ?? totalSales,
      };
    }) as Technician[];
  },

  async get(id: number): Promise<Technician | undefined> {
    return localDb.technicians.get(id);
  },

  async create(technician: Omit<Technician, 'id'>): Promise<number> {
    const now = nowISO();
    const id = await localDb.technicians.add({ ...technician, createdAt: now, updatedAt: now });
    await queueSyncRecord('technicians', id);
    return id;
  },

  async update(id: number, technician: Partial<Technician>): Promise<void> {
    await localDb.technicians.update(id, { ...technician, updatedAt: nowISO() });
    await queueSyncRecord('technicians', id);
  },

  async delete(id: number): Promise<void> {
    await deleteLocalAndQueue('technicians', id);
  },
};

// ─── Transaction Services ───────────────────────────────────────────────────
export interface TransactionListOptions {
  period?: 'today' | 'week' | 'month' | 'all';
  search?: string;
  status?: string;
}

function periodStart(period: TransactionListOptions['period']): Date | null {
  const now = new Date();
  switch (period) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    default:
      return null;
  }
}

const isPhoneString = (value: unknown): boolean =>
  typeof value === 'string' && /^[0-9+\-\s()]{7,}$/.test(value.trim());

function enrichTransaction(
  tx: Transaction,
  items: TransactionItem[],
  techMap: Map<number, string>,
): EnrichedTransaction {
  const status = normalizeStatus(tx.status);
  const customerName = tx.customerName || tx.customer || 'Walk-in';
  let customerPhone = tx.customerPhone;
  if (!customerPhone && isPhoneString(tx.unit)) customerPhone = tx.unit;
  let phoneModel = tx.phoneModel;
  let phoneBrand = tx.phoneBrand;
  if (!phoneModel && tx.unit && !isPhoneString(tx.unit)) {
    // Legacy records may have stored the unit name in `unit`.
    phoneModel = String(tx.unit);
  }
  const txItems = items
    .filter(item => item.transactionId === tx.id)
    .sort((a, b) => (a.id || 0) - (b.id || 0));
  const hasPreOrder = tx.isPreOrder === true || txItems.some(item => item.isPreOrder);
  const total = tx.totalAmount ?? tx.total ?? 0;
  return {
    ...tx,
    status,
    repair_status: repairStatusFor({ status, repair_status: tx.repair_status }),
    customerName,
    customer: customerName,
    customerPhone,
    unit: customerPhone || tx.unit,
    phoneModel,
    phoneBrand,
    total,
    totalAmount: total,
    technicianName: (tx.technicianName as string) || (tx.technicianId ? techMap.get(tx.technicianId) : undefined) || 'None',
    items: txItems,
    profit: getJobProfit(txItems, total),
    hasPreOrder,
    displayCustomer: customerName,
    displayPhone: customerPhone || '',
    displayModel: [phoneBrand, phoneModel].filter(Boolean).join(' '),
  };
}

async function buildLists() {
  const [txs, items, techs] = await Promise.all([
    localDb.transactions.toArray(),
    localDb.transactionItems.toArray(),
    localDb.technicians.toArray(),
  ]);
  const techMap = new Map(techs.map(t => [t.id, t.name]));
  return { txs, items, techMap };
}

export const transactionService = {
  async list(opts?: TransactionListOptions): Promise<EnrichedTransaction[]> {
    const { txs, items, techMap } = await buildLists();
    const start = periodStart(opts?.period);
    let filtered = start ? txs.filter(tx => new Date(tx.createdAt || 0) >= start) : txs;

    if (opts?.status) {
      const wanted = normalizeStatus(opts.status);
      filtered = filtered.filter(tx => normalizeStatus(tx.status) === wanted);
    }

    if (opts?.search) {
      const term = opts.search.toLowerCase().trim();
      if (term) {
        filtered = filtered.filter(tx => {
          const customerName = tx.customerName || tx.customer || '';
          const phone = tx.customerPhone || (isPhoneString(tx.unit) ? tx.unit : '') || '';
          const model = `${tx.phoneBrand || ''} ${tx.phoneModel || ''}`;
          const haystack = [customerName, phone, model, tx.jobNumber || '', String(tx.id)]
            .join(' ')
            .toLowerCase();
          return haystack.includes(term);
        });
      }
    }

    return filtered
      .map(tx => enrichTransaction(tx, items, techMap))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  },

  async listRaw(): Promise<Transaction[]> {
    return localDb.transactions.toArray();
  },

  async get(id: number): Promise<Transaction | undefined> {
    return localDb.transactions.get(id);
  },

  async getEnriched(id: number): Promise<EnrichedTransaction | undefined> {
    const { txs, items, techMap } = await buildLists();
    const tx = txs.find(t => t.id === id);
    return tx ? enrichTransaction(tx, items, techMap) : undefined;
  },

  async create(transaction: Omit<Transaction, 'id'>): Promise<number> {
    const now = nowISO();
    const repairStatus = normalizeRepairStatus(transaction.repair_status);
    const id = await localDb.transactions.add({
      ...transaction,
      repair_status: repairStatus,
      trackingToken: transaction.trackingToken || generateTrackingToken(),
      trackingHistory: transaction.trackingHistory || [{ status: repairStatus, timestamp: now }],
      createdAt: now,
      updatedAt: now,
    } as any);
    await queueTransactionTracking(id);
    return id;
  },

  /** Legacy direct completion. Routes through the full job flow when possible. */
  async createWithItems(transaction: Omit<Transaction, 'id'>, items: NewTransactionItem[]): Promise<number> {
    const jobNumber = transaction.jobNumber || (await generateJobNumber());
    const status = normalizeStatus(transaction.status);
    const now = nowISO();

    const repairStatus = normalizeRepairStatus(transaction.repair_status);
    const txId = await localDb.transactions.add({
      ...transaction,
      status,
      repair_status: repairStatus,
      trackingToken: transaction.trackingToken || generateTrackingToken(),
      trackingHistory: transaction.trackingHistory || [{ status: repairStatus, timestamp: now }],
      jobNumber,
      customerName: (transaction.customerName as string) || transaction.customer || 'Walk-in',
      customer: (transaction.customerName as string) || transaction.customer || 'Walk-in',
      customerPhone: (transaction.customerPhone as string) || transaction.unit,
      unit: (transaction.customerPhone as string) || transaction.unit,
      totalAmount: transaction.totalAmount ?? transaction.total ?? 0,
      createdAt: now,
      updatedAt: now,
    } as any);

    for (const item of items) {
      await localDb.transactionItems.add({ ...item, transactionId: txId, createdAt: now } as any);
      if (hasInventoryRef(item)) {
        const product = await localDb.products.get(item.refId);
        if (product) {
          await localDb.products.update(item.refId, {
            stock: Math.max(0, (product.stock ?? 0) - (item.quantity || 0)),
          });
        }
      }
    }
    await queueProductsForItems(items);
    await queueTransactionTracking(txId);
    return txId;
  },

  async update(id: number, transaction: Partial<Transaction>): Promise<void> {
    await localDb.transactions.update(id, { ...transaction, updatedAt: nowISO() });
    await queueTransactionTracking(id);
  },

  async delete(id: number): Promise<void> {
    const items = await localDb.transactionItems.where('transactionId').equals(id).toArray();
    if (items.length > 0) await queueDeletedRows('transactionItems', items);
    await deleteLocalAndQueue('transactions', id);
  },

  async getByDateRange(startDate: Date, endDate: Date): Promise<EnrichedTransaction[]> {
    const { txs, items, techMap } = await buildLists();
    return txs
      .filter(tx => {
        const txDate = new Date(tx.createdAt || 0);
        return txDate >= startDate && txDate <= endDate;
      })
      .map(tx => enrichTransaction(tx, items, techMap));
  },

  async getByStatus(status: string): Promise<Transaction[]> {
    const wanted = normalizeStatus(status);
    return localDb.transactions.filter(tx => normalizeStatus(tx.status) === wanted).toArray();
  },

  async getStats(period: 'today' | 'week' | 'month' | 'year'): Promise<TransactionStats> {
    const txs = await localDb.transactions.toArray();
    const items = await localDb.transactionItems.toArray();
    const itemIndex = new Map<number, TransactionItem[]>();
    for (const item of items) {
      const arr = itemIndex.get(item.transactionId) || [];
      arr.push(item);
      itemIndex.set(item.transactionId, arr);
    }

    const start = (() => {
      const now = new Date();
      switch (period) {
        case 'today': return new Date(now.getFullYear(), now.getMonth(), now.getDate());
        case 'week': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        case 'month': return new Date(now.getFullYear(), now.getMonth(), 1);
        case 'year': return new Date(now.getFullYear(), 0, 1);
      }
    })();

    const periodTxs = txs.filter(tx => new Date(tx.createdAt || 0) >= start);
    const completed = periodTxs.filter(tx => isCompletedStatus(tx.status));
    const open = periodTxs.filter(tx => isOpenStatus(tx.status));

    const totalSales = round2(completed.reduce((sum, tx) => sum + ((tx.totalAmount ?? tx.total) || 0), 0));
    const totalProfit = round2(
      completed.reduce((sum, tx) => sum + getJobProfit(itemIndex.get(tx.id) || [], tx.totalAmount ?? tx.total), 0),
    );
    const count = completed.length;
    const cashCount = completed.filter(tx => tx.paymentMethod === 'cash').length;
    const gcashCount = completed.filter(tx => tx.paymentMethod === 'gcash').length;
    const avgPerTransaction = count > 0 ? totalSales / count : 0;

    const txItems = completed.flatMap(tx => itemIndex.get(tx.id) || []);

    const topServicesMap = new Map<string, number>();
    txItems.filter(i => i.type === 'service').forEach(i => topServicesMap.set(i.name, (topServicesMap.get(i.name) || 0) + (i.quantity || 1)));
    const topServices: CountStat[] = Array.from(topServicesMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const topProductsMap = new Map<string, number>();
    txItems.filter(i => i.type === 'product').forEach(i => topProductsMap.set(i.name, (topProductsMap.get(i.name) || 0) + (i.quantity || 1)));
    const topProducts: CountStat[] = Array.from(topProductsMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const topModelsMap = new Map<string, number>();
    completed.forEach(tx => {
      const model = [tx.phoneBrand, tx.phoneModel].filter(Boolean).join(' ').trim();
      if (model) topModelsMap.set(model, (topModelsMap.get(model) || 0) + 1);
    });
    const topModels: CountStat[] = Array.from(topModelsMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const preOrderJobs = periodTxs.filter(tx => tx.isPreOrder === true || (itemIndex.get(tx.id) || []).some(i => i.isPreOrder));

    return {
      total: totalSales,
      totalSales,
      totalProfit,
      count,
      pending: open.length,
      cashCount,
      gcashCount,
      avgPerTransaction,
      topModels,
      topServices,
      topProducts,
      paymentMethods: {
        cash: round2(completed.filter(tx => tx.paymentMethod === 'cash').reduce((sum, tx) => sum + ((tx.totalAmount ?? tx.total) || 0), 0)),
        gcash: round2(completed.filter(tx => tx.paymentMethod === 'gcash').reduce((sum, tx) => sum + ((tx.totalAmount ?? tx.total) || 0), 0)),
      },
      pendingJobs: open.length,
      depositTotal: round2(open.reduce((sum, tx) => sum + (tx.amountPaid || 0), 0)),
      outstandingTotal: round2(open.reduce((sum, tx) => sum + Math.max(0, ((tx.totalAmount ?? tx.total) || 0) - (tx.amountPaid || 0)), 0)),
      preOrderCount: preOrderJobs.length,
      preOrderSales: round2(preOrderJobs.reduce((sum, tx) => {
        if (tx.isPreOrder || (itemIndex.get(tx.id) || []).some(i => i.isPreOrder)) {
          if (isCompletedStatus(tx.status)) return sum + ((tx.totalAmount ?? tx.total) || 0);
        }
        return sum;
      }, 0)),
    };
  },
};

// ─── Job services (pending / complete / deposits) ───────────────────────────
export interface JobItemInput {
  type: 'product' | 'service';
  refId: number;
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
  cost?: number;
  isPreOrder?: boolean;
  basePrice?: number;
  markupPercentage?: number;
  markupAmount?: number;
  isCustom?: boolean;
  savedToList?: boolean;
  notes?: string;
}

export interface JobInput {
  customerName?: string;
  customerPhone?: string;
  phoneBrand?: string;
  phoneModel?: string;
  devicePasscode?: string;
  technicianId?: number;
  technicianName?: string;
  notes?: string;
  customerComplaint?: string;
  diagnosis?: string;
  technicianNotes?: string;
  paymentMethod?: 'cash' | 'gcash';
  items: JobItemInput[];
  total: number;
  amountPaid?: number;
  depositNote?: string;
  isPreOrder?: boolean;
}

export interface JobCompletionResult {
  id: number;
  jobNumber: string;
  customerName: string;
  customerPhone?: string;
  phoneBrand?: string;
  phoneModel?: string;
  devicePasscode?: string;
  technicianName?: string;
  items: TransactionItem[];
  total: number;
  amountPaid: number;
  remainingBalance: number;
  paymentMethod: 'cash' | 'gcash';
  cashReceived?: number;
  change?: number;
  createdAt: string;
  status: TransactionStatus;
  trackingToken?: string;
}

function txRecordFromJobInput(input: JobInput): Omit<Transaction, 'id'> {
  const customerName = (input.customerName || 'Walk-in').trim() || 'Walk-in';
  const customerPhone = input.customerPhone?.trim() || undefined;
  const phoneBrand = input.phoneBrand?.trim() || undefined;
  const phoneModel = input.phoneModel?.trim() || undefined;
  const devicePasscode = input.devicePasscode?.trim() || undefined;
  const total = round2(input.total);
  const amountPaid = input.amountPaid && input.amountPaid > 0 ? round2(input.amountPaid) : 0;
  const isPreOrder = Boolean(input.isPreOrder) || input.items.some(i => i.isPreOrder);
  return {
    customerName,
    customer: customerName,
    customerPhone,
    unit: customerPhone,
    phoneBrand,
    phoneModel,
    devicePasscode,
    technicianId: input.technicianId,
    technicianName: input.technicianName,
    notes: input.notes || undefined,
    customerComplaint: input.customerComplaint || undefined,
    diagnosis: input.diagnosis || undefined,
    technicianNotes: input.technicianNotes || undefined,
    total,
    totalAmount: total,
    amountPaid,
    remainingBalance: Math.max(0, total - amountPaid),
    paymentStatus: paymentStatusFor(total, amountPaid),
    paymentMethod: amountPaid > 0 ? (input.paymentMethod || 'cash') : undefined,
    isPreOrder,
    status: 'pending' as TransactionStatus,
    repair_status: 'received' as RepairStatus,
  };
}

/** Reserve (delta=1) or release (delta=-1) stock for a job's in-stock items. */
async function adjustReservations(items: Array<{ type?: string; refId?: number; quantity?: number; isPreOrder?: boolean; isCustom?: boolean; savedToList?: boolean }>, delta: number): Promise<void> {
  const byProduct = new Map<number, number>();
  for (const item of items) {
    if (!hasInventoryRef(item)) continue;
    const refId = Number(item.refId);
    byProduct.set(refId, (byProduct.get(refId) || 0) + (item.quantity || 0));
  }
  for (const [refId, qty] of byProduct) {
    const product = await localDb.products.get(refId);
    if (!product) continue;
    const reserved = Math.max(0, (product.reservedStock || 0) + delta * qty);
    await localDb.products.update(refId, { reservedStock: reserved });
  }
}

/** After releasing a job's own reservation, check against physical stock. */
async function validateStockForReduction(
  items: Array<{ type?: string; refId?: number; quantity?: number; isPreOrder?: boolean; isCustom?: boolean; savedToList?: boolean }>,
): Promise<{ ok: boolean; message?: string }> {
  const settingsRaw = await localDb.settings.toArray();
  const allowNegative = settingsRaw.some(s => s.key === 'allowNegativeStock' && s.value === true);
  const byProduct = new Map<number, number>();
  for (const item of items) {
    if (!hasInventoryRef(item)) continue;
    byProduct.set(Number(item.refId), (byProduct.get(Number(item.refId)) || 0) + (item.quantity || 0));
  }
  for (const [refId, qty] of byProduct) {
    const product = await localDb.products.get(refId);
    if (!product) continue;
    const stock = product.stock ?? 0;
    if (stock < qty && !allowNegative) {
      return { ok: false, message: `Insufficient stock for "${product.name}" — only ${Math.max(0, stock)} unit(s) available.` };
    }
  }
  return { ok: true };
}

async function reduceStock(items: Array<{ type?: string; refId?: number; quantity?: number; isPreOrder?: boolean; isCustom?: boolean; savedToList?: boolean }>): Promise<void> {
  const byProduct = new Map<number, number>();
  for (const item of items) {
    if (!hasInventoryRef(item)) continue;
    byProduct.set(Number(item.refId), (byProduct.get(Number(item.refId)) || 0) + (item.quantity || 0));
  }
  for (const [refId, qty] of byProduct) {
    const product = await localDb.products.get(refId);
    if (!product) continue;
    await localDb.products.update(refId, { stock: Math.max(0, (product.stock ?? 0) - qty) });
  }
}

async function addDrawerSaleEntry(method: 'cash' | 'gcash', amount: number, note: string): Promise<void> {
  const row = { type: 'sale' as const, amount: round2(amount), note, notes: note, createdAt: nowISO() };
  if (method === 'gcash') {
    await localDb.gcashDrawerEntries.add(row as any);
  } else {
    await localDb.cashDrawerEntries.add(row as any);
  }
}

async function addDrawerDepositEntry(method: 'cash' | 'gcash', amount: number, note: string): Promise<void> {
  const row = { type: 'deposit' as const, amount: round2(amount), note, notes: note, createdAt: nowISO() };
  if (method === 'gcash') {
    await localDb.gcashDrawerEntries.add(row as any);
  } else {
    await localDb.cashDrawerEntries.add(row as any);
  }
}

/** Tables all job mutations touch. */
const JOB_TABLES = [
  localDb.meta,
  localDb.transactions,
  localDb.transactionItems,
  localDb.products,
  localDb.cashDrawerEntries,
  localDb.gcashDrawerEntries,
  localDb.settings,
  localDb.technicians,
];

async function createJobItems(transactionId: number, items: JobItemInput[]): Promise<void> {
  const now = nowISO();
  for (const item of items) {
    await localDb.transactionItems.add({
      type: item.type,
      refId: item.refId,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.subtotal,
      cost: item.cost,
      isPreOrder: item.isPreOrder || false,
      basePrice: item.basePrice,
      markupPercentage: item.markupPercentage,
      markupAmount: item.markupAmount,
      isCustom: item.isCustom || false,
      savedToList: item.savedToList || false,
      notes: item.notes,
      transactionId,
      createdAt: now,
    } as any);
  }
}

async function toJobItemInputs(items: TransactionItem[]): Promise<JobItemInput[]> {
  return items.map(i => ({
    type: i.type,
    refId: i.refId,
    name: i.name,
    quantity: i.quantity,
    price: i.price,
    subtotal: i.subtotal,
    cost: i.cost,
    isPreOrder: i.isPreOrder,
    basePrice: i.basePrice,
    markupPercentage: i.markupPercentage,
    markupAmount: i.markupAmount,
    isCustom: i.isCustom,
    savedToList: i.savedToList,
    notes: i.notes,
  }));
}

// ─── Autocomplete suggestions (text only, derived from recent jobs) ──────────
/** Most-recent distinct values of one transaction field (case-insensitive). */
async function distinctRecentValues(
  pick: (tx: Transaction) => string | undefined,
  limit: number,
  exclude?: (value: string) => boolean,
): Promise<string[]> {
  const recent = await localDb.transactions.orderBy('createdAt').reverse().limit(300).toArray();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tx of recent) {
    const raw = pick(tx)?.trim();
    if (!raw || seen.has(raw.toLowerCase())) continue;
    if (exclude && exclude(raw)) continue;
    seen.add(raw.toLowerCase());
    out.push(raw);
    if (out.length >= limit) break;
  }
  return out;
}

/** Customer names for the POS checkout autocomplete (excludes Walk-in). */
export async function getCustomerNameSuggestions(limit = 30): Promise<string[]> {
  return distinctRecentValues(
    (tx) => (tx.customerName as string) || tx.customer,
    limit,
    (v) => v.toLowerCase() === 'walk-in',
  );
}

/** Device models for the POS checkout autocomplete (brand + model as typed). */
export async function getPhoneModelSuggestions(limit = 30): Promise<string[]> {
  return distinctRecentValues((tx) => {
    const combined = [tx.phoneBrand, tx.phoneModel].filter(Boolean).join(' ').trim();
    return combined || (tx.phoneModel as string) || undefined;
  }, limit);
}

// ─── Customer History (derived from transaction/job records) ────────────────
export interface CustomerSummary {
  /** Stable derived identity, e.g. `p:9171234567` or `n:juan dela cruz`. */
  key: string;
  name: string;
  /** Most recent known phone (only if recorded). */
  phone?: string;
  phones: string[];
  devices: string[];
  jobCount: number;
  completedCount: number;
  totalSpent: number;
  outstanding: number;
  firstVisit?: string;
  lastVisit?: string;
}

/**
 * Derive a stable customer identity from existing records. A customer is
 * keyed by their phone number (normalized to digits) when one was recorded,
 * otherwise by a normalized customer name. This never fabricates identity:
 * it only groups records that already share the same contact/name fields.
 */
function customerKeyOf(tx: { customerName?: string; customer?: string; customerPhone?: string; unit?: string }): string {
  const rawPhone = tx.customerPhone || (isPhoneString(tx.unit) ? tx.unit : '') || '';
  const digits = rawPhone.replace(/\D/g, '');
  if (digits) return `p:${digits.length > 10 ? digits.slice(-10) : digits}`;
  const name = (tx.customerName || tx.customer || 'Walk-in').trim().toLowerCase().replace(/\s+/g, ' ');
  return `n:${name || 'walk-in'}`;
}

export const customerService = {
  /** Aggregated, searchable customer list derived entirely from transaction records. */
  async list(search?: string): Promise<CustomerSummary[]> {
    const { txs, items, techMap } = await buildLists();
    const enriched = txs.map(tx => enrichTransaction(tx, items, techMap));
    const term = (search || '').toLowerCase().trim();

    const groups = new Map<string, EnrichedTransaction[]>();
    for (const tx of enriched) {
      const key = customerKeyOf(tx);
      const arr = groups.get(key) || [];
      arr.push(tx);
      groups.set(key, arr);
    }

    let keys: string[];
    if (!term) {
      keys = [...groups.keys()];
    } else {
      // Match across customer name, phone, unit model, and job number.
      const matchedKeys = new Set<string>();
      for (const tx of enriched) {
        const phoneDigits = (tx.customerPhone || '').replace(/\D/g, '');
        const haystack = [
          tx.customerName || '',
          tx.customerPhone || '',
          phoneDigits,
          `${tx.phoneBrand || ''} ${tx.phoneModel || ''}`,
          tx.jobNumber || '',
          String(tx.id),
        ].join(' ').toLowerCase();
        if (haystack.includes(term)) matchedKeys.add(customerKeyOf(tx));
      }
      keys = [...matchedKeys];
    }

    const summaries = keys.map(key => {
      const group = (groups.get(key) || [])
        .slice()
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      const latest = group[0];
      const phones = [...new Set(group.map(tx => tx.customerPhone || '').filter(Boolean))];
      const devices = [
        ...new Set(
          group
            .map(tx => [tx.phoneBrand, tx.phoneModel].filter(Boolean).join(' ').trim())
            .filter(Boolean),
        ),
      ];
      const completed = group.filter(tx => isCompletedStatus(tx.status));
      const open = group.filter(tx => isOpenStatus(tx.status));
      const totalSpent = round2(completed.reduce((sum, tx) => sum + (tx.total || 0), 0));
      const outstanding = round2(
        open.reduce((sum, tx) => sum + (tx.remainingBalance ?? Math.max(0, (tx.total || 0) - (tx.amountPaid || 0))), 0),
      );
      return {
        key,
        name: latest.customerName || 'Walk-in',
        phone: phones[0] || latest.customerPhone || undefined,
        phones,
        devices,
        jobCount: group.length,
        completedCount: completed.length,
        totalSpent,
        outstanding,
        firstVisit: group[group.length - 1]?.createdAt,
        lastVisit: latest?.createdAt,
      } as CustomerSummary;
    });

    return summaries.sort(
      (a, b) => new Date(b.lastVisit || 0).getTime() - new Date(a.lastVisit || 0).getTime(),
    );
  },

  /** Full repair history for one derived customer key (enriched job records). */
  async history(key: string): Promise<EnrichedTransaction[]> {
    const { txs, items, techMap } = await buildLists();
    return txs
      .filter(tx => customerKeyOf(tx) === key)
      .map(tx => enrichTransaction(tx, items, techMap))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  },
};

export const jobService = {
  /** Save the current POS job as a pending transaction (status pending). */
  async saveAsPending(input: JobInput): Promise<{ id: number; jobNumber: string; trackingToken: string }> {
    const drawerSyncSince = new Date(Date.now() - 1_000).toISOString();
    const result = await localDb.transaction('rw', JOB_TABLES, async () => {
      const jobNumber = await generateJobNumber();
      const now = nowISO();
      const record = txRecordFromJobInput(input);
      const trackingToken = generateTrackingToken();
      const id = await localDb.transactions.add({
        ...record,
        status: 'pending',
        repair_status: 'received',
        trackingToken,
        trackingHistory: [{ status: 'received', timestamp: now }],
        jobNumber,
        createdAt: now,
        updatedAt: now,
      } as any);

      await createJobItems(id, input.items);
      await adjustReservations(input.items, 1);

      const amountPaid = record.amountPaid || 0;
      if (amountPaid > 0) {
        await addDrawerDepositEntry(record.paymentMethod || 'cash', amountPaid, `Deposit — ${jobNumber} (${record.customerName})`);
      }
      return { id, jobNumber, trackingToken };
    });
    await queueProductsForItems(input.items);
    await queueTransactionTracking(result.id);
    void queueRecentDrawerEntries(drawerSyncSince);
    return result;
  },

  /** Re-open / edit an existing pending job. Never creates a duplicate. */
  async updatePendingJob(
    id: number,
    input: JobInput,
    opts?: { additionalDeposit?: number; additionalDepositMethod?: 'cash' | 'gcash'; status?: TransactionStatus },
  ): Promise<{ id: number; jobNumber: string; trackingToken: string }> {
    const drawerSyncSince = new Date(Date.now() - 1_000).toISOString();
    let removedItems: TransactionItem[] = [];
    const result = await localDb.transaction('rw', JOB_TABLES, async () => {
      const existing = await localDb.transactions.get(id);
      if (!existing) throw new Error('Job not found');
      if (!isOpenStatus(existing.status)) throw new Error('Only open jobs can be edited');

      const oldItems = await localDb.transactionItems.where('transactionId').equals(id).toArray();
      removedItems = oldItems;
      const jobNumber = existing.jobNumber || (await generateJobNumber());
      const trackingToken = existing.trackingToken || generateTrackingToken();
      const now = nowISO();

      // Release old reservations, replace items, reserve new.
      await adjustReservations(oldItems, -1);
      for (const item of oldItems) await localDb.transactionItems.delete(item.id);
      await createJobItems(id, input.items);
      await adjustReservations(input.items, 1);

      const record = txRecordFromJobInput({ ...input, amountPaid: undefined });
      const total = record.totalAmount ?? 0;
      const additionalDeposit = opts?.additionalDeposit && opts.additionalDeposit > 0 ? round2(opts.additionalDeposit) : 0;
      const amountPaid = round2((existing.amountPaid || 0) + additionalDeposit);
      const method = additionalDeposit > 0 ? (opts?.additionalDepositMethod || existing.paymentMethod || input.paymentMethod || 'cash') : undefined;

      await localDb.transactions.update(id, {
        ...record,
        total,
        totalAmount: total,
        jobNumber,
        trackingToken,
        status: normalizeStatus(opts?.status) || existing.status,
        repair_status: repairStatusFor(existing),
        amountPaid,
        remainingBalance: Math.max(0, total - amountPaid),
        paymentStatus: paymentStatusFor(total, amountPaid),
        paymentMethod: method || existing.paymentMethod,
        isPreOrder: record.isPreOrder || existing.isPreOrder,
        updatedAt: now,
      } as any);

      if (additionalDeposit > 0) {
        await addDrawerDepositEntry(method || 'cash', additionalDeposit, `Deposit — ${jobNumber} (${record.customerName})`);
      }

      return { id, jobNumber, trackingToken };
    });
    if (removedItems.length > 0) await queueDeletedRows('transactionItems', removedItems);
    await queueProductsForItems([...removedItems, ...input.items]);
    await queueTransactionTracking(result.id);
    void queueRecentDrawerEntries(drawerSyncSince);
    return result;
  },

  /** Finalize an existing pending job: completes it, deducts stock, records payment. */
  async completeJob(
    id: number,
    opts: { paymentMethod: 'cash' | 'gcash'; cashReceived?: number },
  ): Promise<JobCompletionResult> {
    const drawerSyncSince = new Date(Date.now() - 1_000).toISOString();
    const result = await localDb.transaction('rw', JOB_TABLES, async () => {
      const tx = await localDb.transactions.get(id);
      if (!tx) throw new Error('Job not found');
      if (isCompletedStatus(tx.status)) throw new Error('Job is already completed');

      const items = (await localDb.transactionItems.where('transactionId').equals(id).toArray()).sort((a, b) => (a.id || 0) - (b.id || 0));
      const jobNumber = tx.jobNumber || (await generateJobNumber());

      // Release this job's own reservation, then validate against physical stock.
      await adjustReservations(items, -1);
      const stockCheck = await validateStockForReduction(items);
      if (!stockCheck.ok) {
        // Re-reserve so the pending job is not left without its reservation.
        await adjustReservations(items, 1);
        throw new Error(stockCheck.message);
      }
      await reduceStock(items);

      const total = round2(tx.totalAmount ?? tx.total ?? 0);
      const prevPaid = round2(tx.amountPaid || 0);
      const remaining = Math.max(0, round2(total - prevPaid));
      const method = opts.paymentMethod || tx.paymentMethod || 'cash';
      const now = nowISO();

      if (remaining > 0) {
        await addDrawerSaleEntry(method, remaining, `Sale ${jobNumber} (${tx.customerName || 'Walk-in'})`);
      }

      const paid = round2(prevPaid + remaining);
      const trackingToken = tx.trackingToken || generateTrackingToken();
      const trackingHistory = appendTrackingHistory(tx.trackingHistory, 'ready_for_pickup', now);
      await localDb.transactions.update(id, {
        status: 'completed',
        repair_status: 'ready_for_pickup',
        trackingToken,
        trackingHistory,
        paymentMethod: method,
        amountPaid: paid,
        totalAmount: total,
        total: total,
        remainingBalance: 0,
        paymentStatus: 'paid',
        jobNumber,
        completedAt: now,
        updatedAt: now,
      } as any);

      const techName = tx.technicianName as string;
      const cashReceived = opts.cashReceived && opts.paymentMethod === 'cash' ? opts.cashReceived : undefined;
      return {
        id,
        jobNumber,
        customerName: (tx.customerName as string) || (tx.customer as string) || 'Walk-in',
        customerPhone: (tx.customerPhone as string) || tx.unit,
        phoneBrand: tx.phoneBrand as string,
        phoneModel: tx.phoneModel as string,
        devicePasscode: tx.devicePasscode as string,
        technicianName: techName || 'None',
        items,
        total,
        amountPaid: paid,
        remainingBalance: 0,
        paymentMethod: method,
        cashReceived,
        change: method === 'cash' && cashReceived ? Math.max(0, round2(cashReceived - remaining)) : undefined,
        createdAt: now,
        status: 'completed' as TransactionStatus,
        trackingToken,
      };
    });
    await queueProductsForItems(result.items);
    await queueTransactionTracking(result.id);
    void queueRecentDrawerEntries(drawerSyncSince);
    return result;
  },

  /** Complete a brand new sale from the POS without a pending step. */
  async completeNewJob(input: JobInput, opts?: { cashReceived?: number }): Promise<JobCompletionResult> {
    const drawerSyncSince = new Date(Date.now() - 1_000).toISOString();
    const result = await localDb.transaction('rw', JOB_TABLES, async () => {
      const jobNumber = await generateJobNumber();
      const now = nowISO();
      const record = txRecordFromJobInput(input);
      const total = record.totalAmount ?? 0;
      const trackingToken = generateTrackingToken();

      const stockCheck = await validateStockForReduction(input.items);
      if (!stockCheck.ok) throw new Error(stockCheck.message);

      const id = await localDb.transactions.add({
        ...record,
        status: 'completed',
        repair_status: 'ready_for_pickup',
        trackingToken,
        trackingHistory: [{ status: 'ready_for_pickup', timestamp: now }],
        jobNumber,
        total,
        totalAmount: total,
        amountPaid: total,
        remainingBalance: 0,
        paymentStatus: 'paid',
        paymentMethod: input.paymentMethod || 'cash',
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      } as any);

      await createJobItems(id, input.items);
      await reduceStock(input.items);

      const method = input.paymentMethod || 'cash';
      await addDrawerSaleEntry(method, total, `Sale ${jobNumber} (${record.customerName})`);

      const cashReceived = opts?.cashReceived && method === 'cash' ? opts.cashReceived : undefined;
      const items = (await localDb.transactionItems.where('transactionId').equals(id).toArray()).sort((a, b) => (a.id || 0) - (b.id || 0));
      return {
        id,
        jobNumber,
        customerName: record.customerName || 'Walk-in',
        customerPhone: record.customerPhone,
        phoneBrand: record.phoneBrand,
        phoneModel: record.phoneModel,
        devicePasscode: record.devicePasscode,
        technicianName: input.technicianName || 'None',
        items,
        total,
        amountPaid: total,
        remainingBalance: 0,
        paymentMethod: method,
        cashReceived,
        change: method === 'cash' && cashReceived ? Math.max(0, round2(cashReceived - total)) : undefined,
        createdAt: now,
        status: 'completed' as TransactionStatus,
        trackingToken,
      };
    });
    await queueProductsForItems(result.items);
    await queueTransactionTracking(result.id);
    void queueRecentDrawerEntries(drawerSyncSince);
    return result;
  },

  /** Record a deposit against an open job. Does NOT mark paid unless paid >= total. */
  async recordDeposit(id: number, opts: { amount: number; method: 'cash' | 'gcash'; note?: string }): Promise<{ paymentStatus: JobPaymentStatus; remainingBalance: number; amountPaid: number }> {
    const drawerSyncSince = new Date(Date.now() - 1_000).toISOString();
    const result = await localDb.transaction('rw', JOB_TABLES, async () => {
      const tx = await localDb.transactions.get(id);
      if (!tx) throw new Error('Job not found');
      if (!isOpenStatus(tx.status)) throw new Error('Only open jobs can receive deposits');
      const amount = round2(Number(opts.amount) || 0);
      if (amount <= 0) throw new Error('Enter a valid deposit amount');

      const total = round2(tx.totalAmount ?? tx.total ?? 0);
      const amountPaid = round2((tx.amountPaid || 0) + amount);
      const remainingBalance = Math.max(0, round2(total - amountPaid));
      const paymentStatus = paymentStatusFor(total, amountPaid);

      const jobNumber = tx.jobNumber || '?';
      await addDrawerDepositEntry(opts.method, amount, `Deposit — ${jobNumber} (${tx.customerName || 'Walk-in'})${opts.note ? ` — ${opts.note}` : ''}`);

      await localDb.transactions.update(id, {
        amountPaid,
        remainingBalance,
        paymentStatus,
        paymentMethod: amountPaid > 0 ? opts.method : tx.paymentMethod,
        updatedAt: nowISO(),
      } as any);

      return { paymentStatus, remainingBalance, amountPaid };
    });
    await queueTransactionTracking(id);
    void queueRecentDrawerEntries(drawerSyncSince);
    return result;
  },

  /** Update the technician's repair progress (independent from the job status). */
  async updateRepairStatus(id: number, repairStatus: RepairStatus): Promise<void> {
    const next = normalizeRepairStatus(repairStatus);
    await localDb.transaction('rw', JOB_TABLES, async () => {
      const tx = await localDb.transactions.get(id);
      if (!tx) throw new Error('Job not found');
      const now = nowISO();
      await localDb.transactions.update(id, {
        repair_status: next,
        trackingHistory: appendTrackingHistory(tx.trackingHistory, next, now),
        updatedAt: now,
      } as any);
    });
    await queueTransactionTracking(id);
  },

  /** Advance a job's status. Cancelling an open job releases its stock reservations. */
  async updateJobStatus(id: number, status: TransactionStatus): Promise<void> {
    await localDb.transaction('rw', JOB_TABLES, async () => {
      const tx = await localDb.transactions.get(id);
      if (!tx) return;
      if (isCompletedStatus(status)) {
        // Completed transitions should go through completeJob (payment collection).
        throw new Error('Use Complete Job to finalize this job with payment');
      }
      if (status === 'cancelled' && isOpenStatus(tx.status)) {
        const items = await localDb.transactionItems.where('transactionId').equals(id).toArray();
        await adjustReservations(items, -1);
      }
      await localDb.transactions.update(id, { status, updatedAt: nowISO() } as any);
    });
    await queueTransactionTracking(id);
  },

  /** Cancel an open job and release its reservations. */
  async cancelJob(id: number): Promise<void> {
    await this.updateJobStatus(id, 'cancelled');
  },

  /** Load a job as editable POS input (for re-opening). */
  async getJobInput(id: number): Promise<{ transaction: Transaction; items: JobItemInput[] }> {
    const transaction = await localDb.transactions.get(id);
    if (!transaction) throw new Error('Job not found');
    const rawItems = await localDb.transactionItems.where('transactionId').equals(id).toArray();
    return { transaction, items: await toJobItemInputs(rawItems) };
  },
};

// ─── Re-export helpers for legacy compatibility ─────────────────────────────
export const isCompleted = isCompletedStatus;

// ─── Transaction Item Services ──────────────────────────────────────────────
export const transactionItemService = {
  async list(): Promise<TransactionItem[]> {
    return localDb.transactionItems.toArray();
  },

  async getByTransactionId(transactionId: number): Promise<TransactionItem[]> {
    return localDb.transactionItems.where('transactionId').equals(transactionId).toArray();
  },

  async create(item: Omit<TransactionItem, 'id'>): Promise<number> {
    const id = await localDb.transactionItems.add({ ...item, createdAt: nowISO() } as any);
    await queueSyncRecord('transactionItems', id);
    if (item.transactionId) void queueSyncRecord('transactions', item.transactionId);
    return id;
  },

  async delete(id: number): Promise<void> {
    const row = await localDb.transactionItems.get(id);
    if (row) await queueSyncDelete('transactionItems', row);
    await localDb.transactionItems.delete(id);
    if (row?.transactionId) void queueSyncRecord('transactions', row.transactionId);
  },
};

// ─── Defective Item Services ────────────────────────────────────────────────
export const defectiveItemService = {
  async list(): Promise<DefectiveItem[]> {
    const items = await localDb.defectiveItems.toArray();
    const products = await localDb.products.toArray();
    const prodMap = new Map(products.map(p => [p.id, p]));
    return items.map(item => {
      const prod = prodMap.get(item.productId);
      const costPerUnit = (item.costPerUnit as number) || (prod?.cost as number) || 0;
      const totalLoss = (item.totalLoss as number) || (costPerUnit * (item.quantity || 1));
      return {
        ...item,
        productName: item.productName || prod?.name || 'Unknown Product',
        costPerUnit,
        totalLoss,
      };
    }) as DefectiveItem[];
  },

  async create(item: NewDefectiveItem): Promise<number> {
    const now = nowISO();
    const product = await productService.get(item.productId);
    const costPerUnit = (item.costPerUnit as number) || product?.cost || 0;
    const totalLoss = (item.totalLoss as number) || (costPerUnit * (item.quantity || 1));
    const id = await localDb.defectiveItems.add({
      ...item,
      costPerUnit,
      totalLoss,
      productName: item.productName || product?.name || 'Unknown Product',
      createdAt: now,
    } as any);
    await queueSyncRecord('defectiveItems', id);
    if (product) {
      await productService.update(item.productId, {
        stock: Math.max(0, (product.stock || 0) - (item.quantity || 1)),
      });
    }
    return id;
  },

  async delete(id: number): Promise<void> {
    await deleteLocalAndQueue('defectiveItems', id);
  },
};

// ─── Backjob Services ───────────────────────────────────────────────────────
export const backjobService = {
  async list(): Promise<Backjob[]> {
    const list = await localDb.backjobs.toArray();
    const techs = await localDb.technicians.toArray();
    const techMap = new Map(techs.map(t => [t.id, t.name]));
    return list.map(b => ({
      ...b,
      technicianName: b.technicianName || (b.technicianId ? techMap.get(b.technicianId) : undefined) || 'Unknown',
      withinWarranty: b.withinWarranty !== undefined ? b.withinWarranty : (b.cause === 'warranty' || !b.cause),
    })) as Backjob[];
  },

  async get(id: number): Promise<Backjob | undefined> {
    const b = await localDb.backjobs.get(id);
    if (!b) return undefined;
    if (!b.technicianName && b.technicianId) {
      const tech = await localDb.technicians.get(b.technicianId);
      if (tech) (b as any).technicianName = tech.name;
    }
    return b;
  },

  async create(backjob: Omit<Backjob, 'id'>): Promise<number> {
    const now = nowISO();
    const id = await localDb.backjobs.add({ ...backjob, createdAt: now, updatedAt: now } as any);
    await queueSyncRecord('backjobs', id);
    return id;
  },

  async update(id: number, backjob: Partial<Backjob>): Promise<void> {
    await localDb.backjobs.update(id, { ...backjob, updatedAt: nowISO() } as any);
    await queueSyncRecord('backjobs', id);
  },

  async delete(id: number): Promise<void> {
    await deleteLocalAndQueue('backjobs', id);
  },

  async getByStatus(status: string): Promise<Backjob[]> {
    return (await this.list()).filter(b => b.status === status);
  },
};

// ─── Cash Drawer Services ───────────────────────────────────────────────────
function computeEntryBalance(
  entries: Array<{ type: string; amount: number; createdAt?: string; [key: string]: unknown }>,
) {
  const signForType = (type: string, delta: number): number => {
    switch (type) {
      case 'opening':
      case 'transaction':
      case 'deposit':
      case 'sale':
        return 1;
      case 'closing':
      case 'withdraw':
        return -1;
      case 'adjustment':
        return delta < 0 ? -1 : 1;
      default:
        return 1;
    }
  };

  let running = 0;
  const sorted = [...entries]
    .filter(e => e && typeof e.amount === 'number')
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ta - tb;
    });

  return sorted.map(e => {
    const delta = e.amount || 0;
    const sign = signForType(e.type, delta);
    running += sign * Math.abs(delta);
    return { ...e, runningBalance: running };
  });
}

type DrawerEntryWithBalance<T> = T & { runningBalance: number };

export const cashDrawerService = {
  async get(): Promise<{ balance: number; entries: (CashDrawerEntry & { runningBalance: number })[] }> {
    const entries = await localDb.cashDrawerEntries.toArray();
    const withBalance = getCashDrawerEntriesWithBalance(entries);
    // Latest first for display (running balances were computed chronologically).
    const latestFirst = [...withBalance].reverse();
    const balance = latestFirst.length > 0 ? latestFirst[0].runningBalance : 0;
    return { balance, entries: latestFirst };
  },

  async addEntry(entry: Omit<CashDrawerEntry, 'id'>): Promise<number> {
    const id = await localDb.cashDrawerEntries.add({ ...entry, createdAt: nowISO() } as any);
    await queueSyncRecord('cashDrawerEntries', id);
    return id;
  },
};

// Gcash Drawer Services
export const gcashDrawerService = {
  async get(): Promise<{ balance: number; entries: (GcashDrawerEntry & { runningBalance: number })[] }> {
    const entries = await localDb.gcashDrawerEntries.toArray();
    const withBalance = getGcashDrawerEntriesWithBalance(entries);
    // Latest first for display (running balances were computed chronologically).
    const latestFirst = [...withBalance].reverse();
    const balance = latestFirst.length > 0 ? latestFirst[0].runningBalance : 0;
    return { balance, entries: latestFirst };
  },

  async addEntry(entry: Omit<GcashDrawerEntry, 'id'>): Promise<number> {
    const id = await localDb.gcashDrawerEntries.add({ ...entry, createdAt: nowISO() } as any);
    await queueSyncRecord('gcashDrawerEntries', id);
    return id;
  },
};

function getCashDrawerEntriesWithBalance(
  entries: CashDrawerEntry[],
): DrawerEntryWithBalance<CashDrawerEntry>[] {
  return computeEntryBalance(entries) as DrawerEntryWithBalance<CashDrawerEntry>[];
}

function getGcashDrawerEntriesWithBalance(
  entries: GcashDrawerEntry[],
): DrawerEntryWithBalance<GcashDrawerEntry>[] {
  return computeEntryBalance(entries) as DrawerEntryWithBalance<GcashDrawerEntry>[];
}

// ─── Settings Services ──────────────────────────────────────────────────────
export const PRE_ORDER_MARKUP_DEFAULT = 20;

export const settingsService = {
  async get(): Promise<Record<string, any>> {
    const all = await localDb.settings.toArray();
    const result: Record<string, any> = {};
    all.forEach(s => {
      result[s.key || ''] = s.value;
    });
    if (typeof result.preOrderMarkup !== 'number' || !Number.isFinite(result.preOrderMarkup)) {
      result.preOrderMarkup = PRE_ORDER_MARKUP_DEFAULT;
    }
    return result;
  },

  async set(key: string, value: any): Promise<void> {
    const existing = await localDb.settings.where('key').equals(key).first();

    const now = nowISO();
    let id: number;
    if (existing) {
      await localDb.settings.update(existing.id, { value, updatedAt: now } as any);
      id = existing.id;
    } else {
      id = await localDb.settings.add({ key, value, createdAt: now, updatedAt: now } as any);
    }
    await queueSyncRecord('settings', id);
  },
};

// ─── Dashboard Service ──────────────────────────────────────────────────────
export const dashboardService = {
  async getDashboard(period: 'today' | 'week' | 'month' | 'year'): Promise<Dashboard> {
    const now = new Date();
    let startDate: Date;
    let periodLabel: string;

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        periodLabel = 'Today';
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        periodLabel = 'This Week';
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        periodLabel = 'This Month';
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        periodLabel = 'This Year';
        break;
    }

    const txs = await transactionService.getByDateRange(startDate, now);
    const completed = txs.filter(tx => isCompletedStatus(tx.status));
    const open = txs.filter(tx => isOpenStatus(tx.status));

    const periodSales = round2(completed.reduce((sum, tx) => sum + (tx.total || 0), 0));
    const periodProfit = round2(completed.reduce((sum, tx) => sum + tx.profit, 0));
    const periodTransactions = completed.length;

    // Payment split = count of completed jobs per method (not drawer peso balances —
    // balances live on the Drawer page; the dashboard donut expects transaction counts).
    const cashCount = completed.filter(tx => tx.paymentMethod === 'cash').length;
    const gcashCount = completed.filter(tx => tx.paymentMethod === 'gcash').length;

    const allProducts = await productService.list();
    const lowStockProducts = allProducts.filter(p => availableStockOf(p) <= (p.reorderPoint ?? DEFAULT_REORDER_POINT));
    const lowStockCount = lowStockProducts.length;

    const openJobs = open.length;

    // Open-job financials (deposits recorded + outstanding balances).
    const depositTotal = round2(open.reduce((sum, tx) => sum + (tx.amountPaid || 0), 0));
    const outstandingTotal = round2(open.reduce((sum, tx) => sum + Math.max(0, (tx.total || 0) - (tx.amountPaid || 0)), 0));

    const preOrderJobs = txs.filter(tx => tx.hasPreOrder);
    const preOrderSales = round2(preOrderJobs.filter(tx => isCompletedStatus(tx.status)).reduce((sum, tx) => sum + (tx.total || 0), 0));
    const preOrderCount = preOrderJobs.length;

    const txItems = completed.flatMap(tx => tx.items);

    const topServices = getTopServices(txItems);
    const topProducts = getTopProducts(txItems);

    const recentTransactions = [...completed].slice(-10).reverse();

    const salesTrend = getSalesTrend(txs, period, startDate);

    return {
      periodLabel,
      periodSales,
      periodProfit,
      periodTransactions,
      cashCount,
      gcashCount,
      lowStockCount,
      pendingCount: openJobs,
      openJobs,
      depositTotal,
      outstandingTotal,
      preOrderSales,
      preOrderCount,
      salesTrend,
      topServices,
      topProducts,
      recentTransactions,
      lowStockProducts,
    };
  },

  async getMonthlyReport(month?: string): Promise<MonthlyReport> {
    const selectedMonth = month || new Date().toISOString().slice(0, 7);
    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = parseInt(yearStr);
    const mIndex = parseInt(monthStr) - 1;

    const startDate = new Date(year, mIndex, 1);
    const endDate = new Date(year, mIndex + 1, 0, 23, 59, 59, 999);
    const daysInMonth = endDate.getDate();

    const monthLabel = startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const allTxs = await transactionService.getByDateRange(startDate, endDate);
    const completed = allTxs.filter(tx => isCompletedStatus(tx.status));

    const totalSales = round2(completed.reduce((sum, tx) => sum + (tx.total || 0), 0));
    const totalProfit = round2(completed.reduce((sum, tx) => sum + tx.profit, 0));
    const totalTransactions = completed.length;
    const cashTotal = round2(completed.filter(tx => tx.paymentMethod === 'cash').reduce((sum, tx) => sum + (tx.total || 0), 0));
    const gcashTotal = round2(completed.filter(tx => tx.paymentMethod === 'gcash').reduce((sum, tx) => sum + (tx.total || 0), 0));
    const avgPerDay = daysInMonth > 0 ? totalSales / daysInMonth : 0;

    const daysMap = new Map<number, { transactions: number; sales: number; cashSales: number; gcashSales: number; profit: number }>();
    for (let d = 1; d <= daysInMonth; d++) {
      daysMap.set(d, { transactions: 0, sales: 0, cashSales: 0, gcashSales: 0, profit: 0 });
    }

    completed.forEach(tx => {
      const d = new Date(tx.createdAt || startDate).getDate();
      const existing = daysMap.get(d) || { transactions: 0, sales: 0, cashSales: 0, gcashSales: 0, profit: 0 };
      existing.transactions += 1;
      existing.sales += tx.total || 0;
      if (tx.paymentMethod === 'cash') existing.cashSales += tx.total || 0;
      if (tx.paymentMethod === 'gcash') existing.gcashSales += tx.total || 0;
      existing.profit += tx.profit;
      daysMap.set(d, existing);
    });

    const days: MonthlyDay[] = Array.from(daysMap.entries()).map(([dayNum, stats]) => {
      const dayDate = new Date(year, mIndex, dayNum);
      return { date: dayDate.toISOString().slice(0, 10), ...stats };
    });

    const techs = await localDb.technicians.toArray();
    const techBreakdown: TechnicianReportRow[] = techs.map(t => {
      const techTxs = completed.filter(tx => tx.technicianId === t.id);
      const jobs = techTxs.length;
      const sales = round2(techTxs.reduce((sum, tx) => sum + (tx.total || 0), 0));
      const profit = round2(techTxs.reduce((sum, tx) => sum + tx.profit, 0));
      const cashJobs = techTxs.filter(tx => tx.paymentMethod === 'cash').length;
      const gcashJobs = techTxs.filter(tx => tx.paymentMethod === 'gcash').length;
      return { technicianId: t.id, name: t.name, jobs, sales, profit, cashJobs, gcashJobs };
    }).sort((a, b) => b.jobs - a.jobs);

    const txItems = completed.flatMap(tx => tx.items);

    const topServices = getTopServices(txItems);
    const topProducts = getTopProducts(txItems);

    return {
      monthLabel,
      totalSales,
      totalProfit,
      totalTransactions,
      cashTotal,
      gcashTotal,
      avgPerDay,
      days,
      technicianBreakdown: techBreakdown,
      topProducts,
      topServices,
    };
  },

  async getTechnicianReport(period: string = 'month'): Promise<TechnicianReportRow[]> {
    const now = new Date();
    let startDate: Date;
    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case 'month':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const txs = await transactionService.getByDateRange(startDate, now);
    const completed = txs.filter(tx => isCompletedStatus(tx.status));
    const techs = await localDb.technicians.toArray();

    return techs.map(t => {
      const techTxs = completed.filter(tx => tx.technicianId === t.id);
      const jobs = techTxs.length;
      const sales = round2(techTxs.reduce((sum, tx) => sum + (tx.total || 0), 0));
      const profit = round2(techTxs.reduce((sum, tx) => sum + tx.profit, 0));
      const cashJobs = techTxs.filter(tx => tx.paymentMethod === 'cash').length;
      const gcashJobs = techTxs.filter(tx => tx.paymentMethod === 'gcash').length;
      return {
        technicianId: t.id,
        name: t.name,
        role: t.role || t.specialization || 'Senior Technician',
        jobs,
        sales,
        profit,
        cashJobs,
        gcashJobs,
      };
    }).sort((a, b) => b.jobs - a.jobs);
  },
};

// ─── Dashboard Helper Functions ─────────────────────────────────────────────
function getTopServices(items: TransactionItem[]): Array<{ name: string; count: number; revenue: number }> {
  const grouped = new Map<string, { count: number; revenue: number }>();
  items
    .filter(item => item.type === 'service')
    .forEach(item => {
      const current = grouped.get(item.name) || { count: 0, revenue: 0 };
      current.count += item.quantity || 0;
      current.revenue += item.subtotal || 0;
      grouped.set(item.name, current);
    });

  return Array.from(grouped.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
}

function getTopProducts(items: TransactionItem[]): Array<{ name: string; count: number; revenue: number }> {
  const grouped = new Map<string, { count: number; revenue: number }>();
  items
    .filter(item => item.type === 'product')
    .forEach(item => {
      const current = grouped.get(item.name) || { count: 0, revenue: 0 };
      current.count += item.quantity || 0;
      current.revenue += item.subtotal || 0;
      grouped.set(item.name, current);
    });

  return Array.from(grouped.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
}

function getSalesTrend(
  txs: EnrichedTransaction[],
  period: 'today' | 'week' | 'month' | 'year',
  _startDate: Date,
): Array<{ date: string; sales: number; profit: number }> {
  const grouped = new Map<string, { sales: number; profit: number }>();

  const completed = txs.filter(tx => isCompletedStatus(tx.status));
  completed.forEach(tx => {
    const txDate = new Date(tx.createdAt || new Date());
    let dateKey: string;

    if (period === 'today') {
      dateKey = `${txDate.getHours()}:00`;
    } else if (period === 'week') {
      dateKey = txDate.toLocaleDateString('en-US', { weekday: 'short' });
    } else if (period === 'month') {
      dateKey = txDate.getDate().toString();
    } else {
      dateKey = txDate.toLocaleDateString('en-US', { month: 'short' });
    }

    const current = grouped.get(dateKey) || { sales: 0, profit: 0 };
    current.sales += tx.total || 0;
    current.profit += tx.profit;
    grouped.set(dateKey, current);
  });

  return Array.from(grouped.entries())
    .map(([date, stats]) => ({ date, ...stats }))
    .slice(0, 30);
}

// ─── Activity / audit log ───────────────────────────────────────────────────
// Fire-and-forget: logging must never break the underlying business action.
function currentSessionUser(): { id?: number; username: string; role?: string } {
  try {
    const stored = localStorage.getItem('jegz_session_user');
    if (!stored) return { username: 'system' };
    const parsed = JSON.parse(stored);
    return {
      id: typeof parsed.id === 'number' ? parsed.id : undefined,
      username: parsed.username || 'unknown',
      role: parsed.role,
    };
  } catch {
    return { username: 'system' };
  }
}

export const activityService = {
  async log(
    action: string,
    summary: string,
    opts?: { entityType?: string; entityId?: string | number; details?: string },
  ): Promise<void> {
    try {
      const user = currentSessionUser();
      const id = await localDb.activityLogs.add({
        createdAt: new Date().toISOString(),
        username: user.username,
        userRole: user.role,
        userId: user.id,
        action,
        entityType: opts?.entityType,
        entityId: opts?.entityId !== undefined ? String(opts.entityId) : undefined,
        summary,
        details: opts?.details,
      } as any);
      await queueSyncRecord('activityLogs', id, { flush: false });
      void flushSyncOutbox();
    } catch (e) {
      console.warn('Activity log failed:', e);
    }
  },

  async list(limit = 300): Promise<ActivityLog[]> {
    const rows = await localDb.activityLogs
      .orderBy('id')
      .reverse()
      .limit(limit)
      .toArray();
    return rows as ActivityLog[];
  },

  async clear(): Promise<void> {
    const rows = await localDb.activityLogs.toArray();
    if (rows.length > 0) await queueDeletedRows('activityLogs', rows);
    await localDb.activityLogs.clear();
  },
};