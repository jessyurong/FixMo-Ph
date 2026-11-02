/**
 * Offline-First Database Entity Types
 * Shared schema types for the IndexedDB tables (Dexie EntityTable).
 * `id` is required so Dexie's auto-increment key resolves to `number`.
 * Sync metadata added for cloud sync (local-first).
 */

// ─── Job statuses ────────────────────────────────────────────────────────────
export const TRANSACTION_STATUSES = [
  'pending',
  'in_progress',
  'waiting_for_parts',
  'pre_ordered',
  'ready_for_pickup',
  'completed',
  'cancelled',
] as const;

export type TransactionStatus = typeof TRANSACTION_STATUSES[number];

// ─── Technician repair progress ─────────────────────────────────────────────
/**
 * Separate from the transaction `status` (pending/ready/complete): this tracks
 * what the technician is actually doing to the device.
 */
export const REPAIR_STATUSES = [
  'received',
  'diagnosing',
  'waiting_for_parts',
  'in_repair',
  'quality_check',
  'ready_for_pickup',
] as const;

export type RepairStatus = typeof REPAIR_STATUSES[number];

export type JobPaymentStatus = 'unpaid' | 'partial' | 'paid';

// ─── Public tracking mirror ─────────────────────────────────────────────────
/**
 * Customer-safe repair status history. Mirrored to Supabase so the public
 * tracking page can show progress without exposing internal job data.
 */
export interface TrackingHistoryEvent {
  status: RepairStatus;
  timestamp: string;
  note?: string;
}

/**
 * The only customer-visible data that is mirrored to Supabase.
 * Deliberately excludes phone, email, prices, passcodes, serials, and notes.
 */
export interface TrackingMirrorPayload {
  /** Unguessable public token (primary key of the Supabase `tracking` table). */
  token: string;
  shop_name: string;
  job_number: string;
  /** Example: "Samsung A14". */
  device_label: string;
  /** Current transaction/job status. */
  status: TransactionStatus;
  /** Current technician repair progress. */
  repair_status: RepairStatus;
  status_history: TrackingHistoryEvent[];
  /** First name only, for a friendly public page. */
  customer_first_name: string;
  updated_at: string;
}

/** A pending Supabase upsert while the POS is offline. One row per ticket. */
export interface TrackingOutboxEntry {
  token: string;
  payload: TrackingMirrorPayload;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Full local-first sync ───────────────────────────────────────────────────
/** Local Dexie tables that participate in full cloud sync. */
export const SYNC_TABLE_NAMES = [
  'products',
  'services',
  'technicians',
  'transactions',
  'transactionItems',
  'cashDrawerEntries',
  'gcashDrawerEntries',
  'defectiveItems',
  'backjobs',
  'users',
  'settings',
  'activityLogs',
] as const;

export type SyncTableName = typeof SYNC_TABLE_NAMES[number];

export type SyncOperation = 'upsert' | 'delete';

/**
 * One pending cloud mutation. Keyed by `${table}:${syncId}` so repeated edits
 * to the same record replace the previous payload instead of piling up.
 */
export interface SyncOutboxEntry {
  /** Composite key: `${table}:${syncId}`. */
  key: string;
  table: SyncTableName;
  syncId: string;
  operation: SyncOperation;
  /** Cloud-safe row payload (no local numeric ids). */
  payload: Record<string, unknown>;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Entities ───────────────────────────────────────────────────────────────
export interface Product {
  id: number;
  /** Stable cloud sync identifier (UUID). */
  syncId?: string;
  /** Soft-delete marker used by the sync engine. */
  deletedAt?: string;
  name: string;
  category: string;
  price: number;
  sellingPrice?: number;
  cost?: number;
  stock: number;
  /** Units held open for active pending jobs (not yet deducted). */
  reservedStock?: number;
  reorderPoint?: number;
  sku?: string;
  deviceType?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface Service {
  id: number;
  /** Stable cloud sync identifier (UUID). */
  syncId?: string;
  /** Soft-delete marker used by the sync engine. */
  deletedAt?: string;
  name: string;
  /** Legacy field (e.g. repair/maintenance/custom/android). Kept for compatibility. */
  type: string;
  /** Selling/labor price. */
  price: number;
  /** Direct cost of performing the service (0 for pure labor). */
  cost?: number;
  duration?: number;
  /** Human-friendly category for grouping (e.g. Repair, Maintenance, General). */
  category?: string;
  /** Whether the service is available for new POS sales (default true). */
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface Technician {
  id: number;
  /** Stable cloud sync identifier (UUID). */
  syncId?: string;
  /** Soft-delete marker used by the sync engine. */
  deletedAt?: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  specialization?: string;
  jobsDone?: number;
  totalSales?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface TransactionItem {
  id: number;
  /** Stable cloud sync identifier (UUID). */
  syncId?: string;
  /** syncId of the parent transaction (cloud reference). */
  transactionSyncId?: string;
  /** syncId of the catalog product/service referenced by this line. */
  refSyncId?: string;
  /** Soft-delete marker used by the sync engine. */
  deletedAt?: string;
  transactionId: number;
  type: 'product' | 'service';
  refId: number;
  name: string;
  quantity: number;
  /** Charged price (for pre-orders this is the final selling price). */
  price: number;
  subtotal: number;
  cost?: number;
  /** Marked true when the item is a pre-order (no stock held). */
  isPreOrder?: boolean;
  /** Base/original price before pre-order markup. */
  basePrice?: number;
  /** Pre-order markup percentage applied (e.g. 20). */
  markupPercentage?: number;
  /** Pre-order markup amount in currency. */
  markupAmount?: number;
  /** One-time custom item added at the POS (not from the saved catalog necessarily). */
  isCustom?: boolean;
  /** For custom items that were permanently saved to services/products tables. */
  savedToList?: boolean;
  notes?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export type NewTransactionItem = {
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
  createdAt?: string;
};

export interface Transaction {
  id: number;
  /** Stable cloud sync identifier (UUID). */
  syncId?: string;
  /** Soft-delete marker used by the sync engine. */
  deletedAt?: string;
  /** Searchable customer / phone / device details. */
  customerName?: string;
  customerPhone?: string;
  phoneBrand?: string;
  phoneModel?: string;
  /** Device lock passcode/PIN for testing after repair (internal only, never printed on receipts). */
  devicePasscode?: string;
  /** Legacy aliases kept in sync for compatibility. */
  customer?: string;
  unit?: string;
  technicianId?: number;
  technicianSyncId?: string;
  technicianName?: string;
  paymentMethod?: 'cash' | 'gcash';
  status: TransactionStatus;
  /** Technician work progress — independent from the transaction status. */
  repair_status?: RepairStatus;
  /** Random URL-safe token used by the public tracking page. */
  trackingToken?: string;
  /** Customer-facing repair progress history (oldest first). */
  trackingHistory?: TrackingHistoryEvent[];
  total?: number;
  totalAmount?: number;
  amountPaid?: number;
  remainingBalance?: number;
  paymentStatus?: JobPaymentStatus;
  /** Unique readable job number, e.g. JEGZ-2026-000001. */
  jobNumber?: string;
  notes?: string;
  /** Repair notes. */
  customerComplaint?: string;
  diagnosis?: string;
  technicianNotes?: string;
  /** Job contains at least one pre-order item. */
  isPreOrder?: boolean;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DefectiveItem {
  id: number;
  /** Stable cloud sync identifier (UUID). */
  syncId?: string;
  /** syncId of the related product (cloud reference). */
  productSyncId?: string;
  /** Soft-delete marker used by the sync engine. */
  deletedAt?: string;
  productId: number;
  productName?: string;
  reason: string;
  quantity: number;
  costPerUnit?: number;
  totalLoss?: number;
  createdAt?: string;
  [key: string]: unknown;
}

export type NewDefectiveItem = {
  productId: number;
  productName?: string;
  reason: string;
  quantity: number;
  costPerUnit?: number;
  totalLoss?: number;
  createdAt?: string;
};

export interface Backjob {
  id: number;
  /** Stable cloud sync identifier (UUID). */
  syncId?: string;
  /** Soft-delete marker used by the sync engine. */
  deletedAt?: string;
  customer: string;
  phone?: string;
  unit?: string;
  technicianId?: number;
  technicianSyncId?: string;
  technicianName?: string;
  description?: string;
  issue?: string;
  originalRepairDate?: string;
  cause?: string;
  status: 'pending' | 'in_progress' | 'done' | 'in-progress' | 'completed';
  withinWarranty?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface CashDrawerEntry {
  id: number;
  /** Stable cloud sync identifier (UUID). */
  syncId?: string;
  /** Soft-delete marker used by the sync engine. */
  deletedAt?: string;
  type:
    | 'opening'
    | 'closing'
    | 'transaction'
    | 'adjustment'
    | 'deposit'
    | 'withdraw'
    | 'sale';
  amount: number;
  note?: string;
  notes?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface GcashDrawerEntry {
  id: number;
  /** Stable cloud sync identifier (UUID). */
  syncId?: string;
  /** Soft-delete marker used by the sync engine. */
  deletedAt?: string;
  type:
    | 'opening'
    | 'closing'
    | 'transaction'
    | 'adjustment'
    | 'deposit'
    | 'withdraw'
    | 'sale';
  amount: number;
  note?: string;
  notes?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface Settings {
  id: number;
  /** Stable cloud sync identifier (UUID). */
  syncId?: string;
  /** Soft-delete marker used by the sync engine. */
  deletedAt?: string;
  key: string;
  value: any;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface AppUser {
  id: number;
  /** Stable cloud sync identifier (UUID). */
  syncId?: string;
  /** Soft-delete marker used by the sync engine. */
  deletedAt?: string;
  username: string;
  passwordHash: string;
  role: 'admin' | 'staff';
  permissions: string[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface MetaRecord {
  key: string;
  value?: unknown;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export type ActivityAction =
  | 'login' | 'logout'
  | 'transaction.create' | 'transaction.status' | 'transaction.complete'
  | 'transaction.cancel' | 'transaction.delete'
  | 'drawer.deposit' | 'drawer.withdraw'
  | 'backup.create' | 'backup.restore'
  | 'user.create' | 'user.update' | 'user.delete' | 'user.status';

export interface ActivityLog {
  id: number;
  /** Stable cloud sync identifier (UUID). */
  syncId?: string;
  /** Soft-delete marker used by the sync engine. */
  deletedAt?: string;
  /** Timestamp of the last local edit (activity logs are append-only). */
  updatedAt?: string;
  createdAt: string;
  username: string;
  userRole?: string;
  userId?: number;
  userSyncId?: string;
  action: ActivityAction | string;
  entityType?: string;
  entityId?: string;
  summary: string;
  details?: string;
  [key: string]: unknown;
}

// ─── Composite / analytics types ────────────────────────────────────────────
export interface Dashboard {
  periodLabel: string;
  periodSales: number;
  periodProfit: number;
  periodTransactions: number;
  cashCount: number;
  gcashCount: number;
  lowStockCount: number;
  pendingCount: number;
  /** Count of open repair jobs (pending / in progress / pre-ordered / ready). */
  openJobs?: number;
  depositTotal?: number;
  outstandingTotal?: number;
  preOrderSales?: number;
  preOrderCount?: number;
  salesTrend: Array<{ date: string; sales: number; profit: number }>;
  topServices: Array<{ name: string; count: number; revenue: number }>;
  topProducts: Array<{ name: string; count: number; revenue: number }>;
  recentTransactions: Transaction[];
  lowStockProducts: Product[];
}

export type CountStat = { name: string; count: number };

export interface TransactionStats {
  total: number;
  totalSales: number;
  totalProfit: number;
  count: number;
  pending: number;
  cashCount: number;
  gcashCount: number;
  avgPerTransaction: number;
  topModels: CountStat[];
  topServices: CountStat[];
  topProducts: CountStat[];
  paymentMethods: { cash: number; gcash: number };
  /** Financial health extras for open jobs. */
  pendingJobs?: number;
  depositTotal?: number;
  outstandingTotal?: number;
  preOrderCount?: number;
  preOrderSales?: number;
}

export interface TechnicianReportRow {
  technicianId: number;
  name: string;
  role?: string;
  jobs: number;
  sales: number;
  profit: number;
  cashJobs: number;
  gcashJobs: number;
}

export interface MonthlyDay {
  date: string;
  transactions: number;
  sales: number;
  cashSales: number;
  gcashSales: number;
  profit: number;
}

export interface MonthlyReport {
  monthLabel: string;
  totalSales: number;
  totalProfit: number;
  totalTransactions: number;
  cashTotal: number;
  gcashTotal: number;
  avgPerDay: number;
  days: MonthlyDay[];
  technicianBreakdown: TechnicianReportRow[];
  topProducts: Array<{ name: string; count: number; revenue: number }>;
  topServices: Array<{ name: string; count: number; revenue: number }>;
}

// ─── Enriched transaction (list/detail view) ────────────────────────────────
export interface EnrichedTransaction extends Transaction {
  technicianName: string;
  items: TransactionItem[];
  profit: number;
  hasPreOrder: boolean;
  displayCustomer: string;
  displayPhone: string;
  displayModel: string;
}