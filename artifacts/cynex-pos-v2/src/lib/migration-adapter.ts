/**
 * Legacy Replit PostgreSQL → Offline POS Migration Adapter
 *
 * Detects the legacy backup format, validates it, transforms field names
 * and ID types, and imports into IndexedDB using a single Dexie transaction.
 *
 * The native backup/restore system is NOT modified.
 */

import { localDb } from './local-db';
import { exportBackup } from './backup-restore';
import { normalizeStatus, ensureJobNumbers } from './offline-data-services';
import { generateTrackingToken } from './tracking-token';
import type { RestoreResult } from './backup-restore';

// ─── Legacy format types ────────────────────────────────────────────────────

export interface LegacyBackup {
  format: string;
  version: number;
  exportedAt: string;
  source: {
    application: string;
    type: string;
    schema: string;
  };
  counts: Record<string, number>;
  data: {
    products?: any[];
    services?: any[];
    technicians?: any[];
    transactions?: any[];
    transactionItems?: any[];
    cashDrawerEntries?: any[];
    gcashDrawerEntries?: any[];
    defectiveItems?: any[];
    backjobs?: any[];
    settings?: any[];
  };
}

// ─── Migration preview ──────────────────────────────────────────────────────

export interface LegacyMigrationPreview {
  exportedAt: string;
  sourceApplication: string;
  sourceSchema: string;
  counts: {
    products: number;
    services: number;
    technicians: number;
    transactions: number;
    transactionItems: number;
    cashDrawerEntries: number;
    gcashDrawerEntries: number;
    defectiveItems: number;
    backjobs: number;
    settings: number;
  };
  expectedImport: {
    products: number;
    services: number;
    technicians: number;
    transactions: number;
    transactionItems: number;
  };
  skippedDuplicates: {
    products: number;
    services: number;
    technicians: number;
    transactions: number;
    transactionItems: number;
  };
  unresolvedReferences: number;
  settingsFound: boolean;
  drawerEntriesSkipped: number;
}

// ─── Detection ──────────────────────────────────────────────────────────────

export function isLegacyReplitBackup(data: any): boolean {
  return (
    data != null
    && typeof data === 'object'
    && data.format === 'jegz-pos-backup'
    && data.version === 1
    && data.source?.type === 'postgresql'
    && data.source?.schema === 'business-data-v1'
  );
}

// ─── Fingerprint (idempotency key) ──────────────────────────────────────────

const LEGACY_IMPORT_KEY_PREFIX = 'legacy_replit_import_';

/** FNV-1a 32-bit — deterministic across platforms (no crypto required). */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Force to unsigned 32-bit for a stable string.
  return (hash >>> 0).toString(36);
}

/**
 * Content-addressed fingerprint for a legacy backup.
 *
 * Includes every row of every data table plus the declared counts, so two
 * different backups (even with the same exportedAt/format/version) cannot
 * accidentally share an import fingerprint. The hash is deterministic FNV-1a
 * over the canonical JSON of the whole data payload.
 */
function legacyFingerprint(legacy: LegacyBackup): string {
  const blocks: string[] = [
    legacy.format ?? '',
    String(legacy.version ?? ''),
    legacy.source?.type ?? '',
    legacy.source?.schema ?? '',
  ];
  const counts = legacy.counts || {};
  for (const t of (['products', 'services', 'technicians', 'transactions', 'transactionItems', 'cashDrawerEntries', 'gcashDrawerEntries', 'defectiveItems', 'backjobs', 'settings'] as const)) {
    blocks.push(`${t}=${counts[t] ?? 0}`);
  }
  // Canonical content cover: every table's rows, in source order.
  for (const t of Object.keys(legacy.data || {}).sort()) {
    const rows = (legacy.data as Record<string, any[]>)[t];
    if (Array.isArray(rows)) {
      try {
        blocks.push(`${t}#${JSON.stringify(rows)}`);
      } catch {
        blocks.push(`${t}#<unserializable>`);
      }
    }
  }
  return `${LEGACY_IMPORT_KEY_PREFIX}${fnv1a(blocks.join('\u0001'))}`;
}

// ─── Validation ─────────────────────────────────────────────────────────────

interface ValidationError {
  table: string;
  index: number;
  field: string;
  message: string;
}

export function validateLegacyBackup(legacy: LegacyBackup): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  if (legacy.format !== 'jegz-pos-backup') {
    errors.push({ table: '', index: -1, field: 'format', message: `Unexpected format: "${legacy.format}"` });
  }
  if (legacy.version !== 1) {
    errors.push({ table: '', index: -1, field: 'version', message: `Unexpected version: ${legacy.version}` });
  }
  if (legacy.source?.type !== 'postgresql') {
    errors.push({ table: '', index: -1, field: 'source.type', message: `Unexpected source type: "${legacy.source?.type}"` });
  }
  if (legacy.source?.schema !== 'business-data-v1') {
    errors.push({ table: '', index: -1, field: 'source.schema', message: `Unexpected source schema: "${legacy.source?.schema}"` });
  }
  if (!legacy.data || typeof legacy.data !== 'object') {
    errors.push({ table: '', index: -1, field: 'data', message: 'Missing data object' });
    return { valid: false, errors };
  }

  const tables = [
    'products', 'services', 'technicians', 'transactions',
    'transactionItems', 'cashDrawerEntries', 'gcashDrawerEntries',
    'defectiveItems', 'backjobs', 'settings',
  ] as const;

  for (const table of tables) {
    const rows = legacy.data[table];
    if (!Array.isArray(rows)) continue;

    rows.forEach((row, i) => {
      if (!row || typeof row !== 'object') {
        errors.push({ table, index: i, field: '*', message: 'Row is not an object' });
        return;
      }

      if (table === 'products') {
        if (!row.name) errors.push({ table, index: i, field: 'name', message: 'Missing product name' });
        if (typeof row.stock !== 'number') errors.push({ table, index: i, field: 'stock', message: 'Missing product stock' });
      }

      if (table === 'services') {
        if (!row.name) errors.push({ table, index: i, field: 'name', message: 'Missing service name' });
      }

      if (table === 'technicians') {
        if (!row.name) errors.push({ table, index: i, field: 'name', message: 'Missing technician name' });
      }

      if (table === 'transactions') {
        if (!row.customer) errors.push({ table, index: i, field: 'customer', message: 'Missing customer' });
        // Legacy exports an empty string for transactions with no payment method.
        if (!['cash', 'gcash', null, undefined, ''].includes(row.paymentMethod)) {
          errors.push({ table, index: i, field: 'paymentMethod', message: `Unsupported payment method: "${row.paymentMethod}"` });
        }
        if (![
          'pending', 'received', 'in_progress', 'diagnosing', 'waiting_for_parts',
          'waiting_parts', 'pre_ordered', 'repairing', 'ready', 'ready_for_pickup',
          'complete', 'completed', 'cancelled', 'canceled',
        ].includes(row.status)) {
          errors.push({ table, index: i, field: 'status', message: `Unknown status: "${row.status}"` });
        }
      }

      if (table === 'transactionItems') {
        if (!row.transactionId) errors.push({ table, index: i, field: 'transactionId', message: 'Missing transactionId' });
        if (!['product', 'service'].includes(row.type)) {
          errors.push({ table, index: i, field: 'type', message: `Unknown item type: "${row.type}"` });
        }
        if (isValidId(row.refId) && row.type === 'product' && !legacy.data.products?.some(p => String(p.id) === String(row.refId))) {
          errors.push({ table, index: i, field: 'refId', message: `Product refId "${row.refId}" not found` });
        }
        if (isValidId(row.refId) && row.type === 'service' && !legacy.data.services?.some(s => String(s.id) === String(row.refId))) {
          errors.push({ table, index: i, field: 'refId', message: `Service refId "${row.refId}" not found` });
        }
      }

      if (table === 'cashDrawerEntries' || table === 'gcashDrawerEntries') {
        if (!row.type) errors.push({ table, index: i, field: 'type', message: 'Missing entry type' });
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

// ─── Dedupe / matching helpers (shared by preview and migration) ────────────

/** Catalog-style name match for products, services and technicians. */
function normalizeName(value: unknown): string {
  return String(value ?? '').toLowerCase().trim();
}

/**
 * Safely coerce a legacy monetary/quantity value to a number.
 *
 * The real Replit/PostgreSQL backup exports money columns as decimal STRINGS
 * (e.g. "350.00", "647.00"), while ID columns are numeric. This normalizes
 * both string and numeric forms into the number the Offline POS schema needs.
 *
 * Rules:
 * - number → preserved as-is (finite decimals kept, NaN → fallback)
 * - numeric string → Number(value)
 * - null / undefined / empty string → fallback
 * - invalid numeric string → fallback
 * - never returns NaN for a bad financial value
 */
function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/** True when a field holds a usable numeric amount (rejects empty, null, NaN). */
function hasNumericValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.trim() !== '' && Number.isFinite(Number.parseFloat(value));
  return false;
}

/** True when a field holds an actual source ID (number, "5", or UUID). */
function isValidId(value: unknown): value is string | number {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim() !== '';
}

/** Transaction identity key: customer + createdAt + total. */
function transactionKey(tx: { customer?: string; customerName?: string; createdAt?: string; totalAmount?: number; total?: number }): string {
  const customer = normalizeName(tx.customerName ?? tx.customer);
  const total = toNumber((tx.totalAmount ?? tx.total) ?? 0);
  return `${customer}|${tx.createdAt || ''}|${total}`;
}

/** Full legacy-source transaction key (uses the raw legacy fields). */
function legacyTransactionKey(row: any): string {
  const customer = normalizeName(row.customer);
  // Legacy PostgreSQL exports `total` as a decimal STRING ("350.00"), so
  // coerce with toNumber to match the numeric form the destination stores.
  const total = toNumber(row.total);
  return `${customer}|${row.createdAt ? new Date(row.createdAt).toISOString() : ''}|${total}`;
}

/**
 * Analyze which legacy records would actually be imported into the current
 * destination, using the exact same matching rules as the migration itself.
 * Read-only; never writes to IndexedDB.
 */
export interface LegacyAnalysis {
  importableProducts: any[];
  importableServices: any[];
  importableTechnicians: any[];
  importableTransactions: any[];
  /** Legacy items that will be imported, each tagged with its legacy transaction's index. */
  importableItems: Array<{ row: any; legacyTransactionId: string }>;
  skippedDuplicates: {
    products: number;
    services: number;
    technicians: number;
    transactions: number;
    transactionItems: number;
  };
  unresolvedReferences: number;
  /**
   * Destination catalog id by normalized name for rows that ALREADY exist in
   * the Offline POS. Used so a legacy source id whose name matches an existing
   * record maps to the EXISTING destination id (never overwritten, never left
   * unresolved).
   */
  existingProductIdByName: Map<string, number>;
  existingServiceIdByName: Map<string, number>;
  existingTechnicianIdByName: Map<string, number>;
}

export async function analyzeLegacyBackup(legacy: LegacyBackup): Promise<LegacyAnalysis> {
  const [existingProducts, existingServices, existingTechs, existingTxs, existingItems] = await Promise.all([
    localDb.products.toArray(),
    localDb.services.toArray(),
    localDb.technicians.toArray(),
    localDb.transactions.toArray(),
    localDb.transactionItems.toArray(),
  ]);

  const productNames = new Set(existingProducts.map(p => normalizeName(p.name)));
  const serviceNames = new Set(existingServices.map(s => normalizeName(s.name)));
  const techNames = new Set(existingTechs.map(t => normalizeName(t.name)));
  const txKeys = new Set(existingTxs.map(tx => transactionKey(tx)));

  // Existing item map keyed by destination transactionId → avoid importing an
  // item that already exists under an imported transaction (dedupe safety).
  const existingItemKeys = new Set(
    existingItems.map(it => `${it.transactionId}|${it.type}|${normalizeName(it.name)}|${it.quantity}|${it.price}`),
  );

  // Existing destination id keyed by normalized name — used by the migration to
  // map a duplicate-name legacy source id to the EXISTING destination record.
  const existingProductIdByName = new Map<string, number>();
  for (const p of existingProducts) {
    const key = normalizeName(p.name);
    if (!existingProductIdByName.has(key)) existingProductIdByName.set(key, p.id as number);
  }
  const existingServiceIdByName = new Map<string, number>();
  for (const s of existingServices) {
    const key = normalizeName(s.name);
    if (!existingServiceIdByName.has(key)) existingServiceIdByName.set(key, s.id as number);
  }
  const existingTechnicianIdByName = new Map<string, number>();
  for (const t of existingTechs) {
    const key = normalizeName(t.name);
    if (!existingTechnicianIdByName.has(key)) existingTechnicianIdByName.set(key, t.id as number);
  }

  const importableProducts: any[] = [];
  const importableServices: any[] = [];
  const importableTechnicians: any[] = [];

  let skippedProducts = 0;
  let skippedServices = 0;
  let skippedTechnicians = 0;

  for (const row of legacy.data.products || []) {
    if (productNames.has(normalizeName(row.name))) { skippedProducts++; continue; }
    importableProducts.push(row);
  }
  for (const row of legacy.data.services || []) {
    if (serviceNames.has(normalizeName(row.name))) { skippedServices++; continue; }
    importableServices.push(row);
  }
  for (const row of legacy.data.technicians || []) {
    if (techNames.has(normalizeName(row.name))) { skippedTechnicians++; continue; }
    importableTechnicians.push(row);
  }

  const importableTransactions: any[] = [];
  let skippedTransactions = 0;
  const importableLegacyTxIds = new Map<string, boolean>();

  for (const row of legacy.data.transactions || []) {
    const key = legacyTransactionKey(row);
    if (txKeys.has(key)) { skippedTransactions++; continue; }
    importableTransactions.push(row);
    if (row.id) importableLegacyTxIds.set(String(row.id), true);
  }

  const importableItems: Array<{ row: any; legacyTransactionId: string }> = [];
  let skippedItems = 0;
  let unresolvedReferences = 0;

  for (const row of legacy.data.transactionItems || []) {
    const legacyTxId = row.transactionId ? String(row.transactionId) : '';
    // Only import items whose parent legacy transaction will itself be imported.
    if (!legacyTxId || !importableLegacyTxIds.has(legacyTxId)) {
      skippedItems++;
      continue;
    }
    // Unresolved catalog reference (a real non-empty refId pointing at a
    // missing source product/service row). Empty/null refId is a custom or
    // historical line item and is NOT an unresolved reference.
    if (isValidId(row.refId)) {
      const found = row.type === 'product'
        ? legacy.data.products?.some(p => String(p.id) === String(row.refId))
        : legacy.data.services?.some(s => String(s.id) === String(row.refId));
      if (!found) unresolvedReferences++;
    }
    importableItems.push({ row, legacyTransactionId: legacyTxId });
  }

  return {
    importableProducts,
    importableServices,
    importableTechnicians,
    importableTransactions,
    importableItems,
    skippedDuplicates: {
      products: skippedProducts,
      services: skippedServices,
      technicians: skippedTechnicians,
      transactions: skippedTransactions,
      transactionItems: skippedItems,
    },
    unresolvedReferences,
    existingProductIdByName,
    existingServiceIdByName,
    existingTechnicianIdByName,
  };
}

// ─── Field adaptation (single record at a time, never touches IDs globally) ─

function adaptProduct(row: any): any {
  const cat = row.category;
  const categoryStr = typeof cat === 'string' ? cat
    : (cat && typeof cat === 'object' ? (cat.name || JSON.stringify(cat)) : '');

  const price = toNumber(row.sellingPrice ?? row.price);
  const stock = toNumber(row.stock);
  const reorderPoint = hasNumericValue(row.reorderPoint) ? toNumber(row.reorderPoint) : undefined;
  return {
    name: row.name,
    category: categoryStr,
    price,
    sellingPrice: price,
    cost: toNumber(row.cost),
    stock,
    reorderPoint,
    // Legacy backups have no reservedStock; a fresh record holds no reservations.
    reservedStock: 0,
    deviceType: typeof row.deviceType === 'string' && row.deviceType.trim() ? row.deviceType : undefined,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
  };
}

function adaptService(row: any): any {
  return {
    name: row.name,
    type: row.type || 'general',
    price: toNumber(row.price),
    cost: toNumber(row.cost, 0),
    active: true,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
  };
}

function adaptTechnician(row: any): any {
  return {
    name: row.name,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
  };
}

function adaptTransaction(row: any): any {
  // All monetary legacy fields are decimal strings in the real PostgreSQL
  // export; normalize every one of them to a number before writing to Dexie.
  const total = toNumber(row.total);
  const amountPaid = toNumber(row.cashReceived);
  const subtotal = toNumber(row.subtotal, total);
  const discountAmount = toNumber(row.discountAmount);
  const shippingFee = toNumber(row.shippingFee);
  const profit = toNumber(row.profit);
  // laborDiscount is legacy boolean legacy field; coerce false/0 → 0, truthy → 1.
  const laborDiscountRaw = row.laborDiscount;
  const laborDiscount = laborDiscountRaw === true || laborDiscountRaw === 'true' || laborDiscountRaw === 1 ? 1 : 0;
  const status = normalizeStatus(row.status || 'received');
  // Legacy uses '' for a transaction with no recorded payment method.
  const paymentMethod = ['cash', 'gcash'].includes(row.paymentMethod) ? row.paymentMethod : undefined;
  const paymentStatus = amountPaid >= total ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';
  const createdAt = row.createdAt ? new Date(row.createdAt).toISOString() : undefined;

  return {
    customer: row.customer || 'Walk-in',
    customerName: row.customer || 'Walk-in',
    customerPhone: row.customerPhone || row.phone || undefined,
    customerEmail: row.customerEmail || row.email || undefined,
    unit: row.unit,
    technicianId: undefined,
    paymentMethod,
    status,
    trackingToken: generateTrackingToken(),
    statusHistory: [{ status, timestamp: createdAt || new Date().toISOString() }],
    total,
    totalAmount: total,
    amountPaid,
    remainingBalance: Math.max(0, total - amountPaid),
    paymentStatus,
    // Preserved historical transaction financials (normalized, not recalculated).
    subtotal,
    discountAmount,
    shippingFee,
    profit,
    laborDiscount,
    isPreOrder: false,
    createdAt,
  };
}

/**
 * Adapt a legacy transaction item WITHOUT resolving refId yet. The caller must
 * set refId from the actual destination maps after insertion. Empty/null refId
 * is preserved as a custom/historical line item — never invented, never coerced
 * to a fake catalog ID.
 */
function adaptTransactionItem(row: any): any {
  const quantity = Math.max(1, toNumber(row.qty ?? row.quantity, 1));
  const price = toNumber(row.price);
  // Historical snapshots: keep the legacy price/cost/name/qty exactly as
  // normalized numbers. NEVER re-derive from the current catalog.
  const cost = hasNumericValue(row.cost) ? toNumber(row.cost) : undefined;
  return {
    type: row.type,
    name: row.name || 'Unknown Item',
    quantity,
    price,
    subtotal: Math.round(quantity * price * 100) / 100,
    cost,
    isPreOrder: row.isPreOrder === true,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
  };
}

function decomposeLegacySettings(legacySettings: any[] | undefined): { key: string; value: any }[] {
  if (!legacySettings || legacySettings.length === 0) return [];
  const row = legacySettings[0];
  if (!row || typeof row !== 'object') return [];

  const entries: [string, any][] = [
    ['storeName', row.storeName],
    ['storeAddress', row.storeAddress],
    ['contactNumber', row.contactNumber],
    ['receiptFooter', row.receiptFooter],
    ['warrantyNote', row.warrantyNote],
    ['lowStockThreshold', row.lowStockThreshold],
    ['allowNegativeStock', row.allowNegativeStock],
    ['cashEnabled', row.cashEnabled],
    ['gcashEnabled', row.gcashEnabled],
    ['gcashAccountName', row.gcashAccountName],
    ['gcashAccountNumber', row.gcashAccountNumber],
  ];

  return entries
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([key, value]) => ({ key, value }));
}

// ─── Preview (read-only, no writes) ─────────────────────────────────────────

export async function previewLegacyMigration(legacy: LegacyBackup): Promise<LegacyMigrationPreview> {
  const analysis = await analyzeLegacyBackup(legacy);

  // Transaction items that will actually be imported: mirror the migration's
  // "parent transaction imported AND not an existing item" rule.
  const migration = await countImportableItemsPrecisely(analysis);

  return {
    exportedAt: legacy.exportedAt,
    sourceApplication: legacy.source?.application || 'JEGZ Mobile Repair POS',
    sourceSchema: legacy.source?.schema || 'business-data-v1',
    counts: {
      products: legacy.data.products?.length || 0,
      services: legacy.data.services?.length || 0,
      technicians: legacy.data.technicians?.length || 0,
      transactions: legacy.data.transactions?.length || 0,
      transactionItems: legacy.data.transactionItems?.length || 0,
      cashDrawerEntries: legacy.data.cashDrawerEntries?.length || 0,
      gcashDrawerEntries: legacy.data.gcashDrawerEntries?.length || 0,
      defectiveItems: legacy.data.defectiveItems?.length || 0,
      backjobs: legacy.data.backjobs?.length || 0,
      settings: legacy.data.settings?.length || 0,
    },
    expectedImport: {
      products: analysis.importableProducts.length,
      services: analysis.importableServices.length,
      technicians: analysis.importableTechnicians.length,
      transactions: analysis.importableTransactions.length,
      transactionItems: migration.importableItemCount,
    },
    skippedDuplicates: {
      ...analysis.skippedDuplicates,
      transactionItems: migration.skippedItemCount,
    },
    unresolvedReferences: analysis.unresolvedReferences,
    settingsFound: (legacy.data.settings?.length || 0) > 0,
    drawerEntriesSkipped: (legacy.data.cashDrawerEntries?.length || 0) + (legacy.data.gcashDrawerEntries?.length || 0),
  };
}

/**
 * Precisely count how many legacy transaction items would be imported once
 * their parent legacy transactions are imported, excluding items that already
 * exist under an equivalent destination transaction.
 */
async function countImportableItemsPrecisely(
  analysis: LegacyAnalysis,
): Promise<{ importableItemCount: number; skippedItemCount: number }> {
  // Map each importable legacy transaction id to its identity key.
  const importableTxIdToParentKey = new Map<string, string>();
  for (const row of analysis.importableTransactions) {
    const key = legacyTransactionKey(row);
    if (row.id) importableTxIdToParentKey.set(String(row.id), key);
  }

  // Existing destination items, keyed by their parent transaction's identity.
  const [existingTxs, existingItems] = await Promise.all([
    localDb.transactions.toArray(),
    localDb.transactionItems.toArray(),
  ]);
  const existingTxIdToKey = new Map<number, string>();
  for (const tx of existingTxs) {
    existingTxIdToKey.set(tx.id as number, transactionKey(tx));
  }
  const existingItemKeys = new Set(
    existingItems.map(it => {
      const parentKey = existingTxIdToKey.get(it.transactionId as number) || '';
      return `${parentKey}|${it.type}|${normalizeName(it.name)}|${it.quantity}|${it.price}`;
    }),
  );

  let importable = 0;
  let skipped = 0;
  for (const item of analysis.importableItems) {
    const parentKey = importableTxIdToParentKey.get(item.legacyTransactionId);
    if (!parentKey) { skipped++; continue; }
    const key = `${parentKey}|${item.row.type}|${normalizeName(item.row.name)}|${toNumber(item.row.qty ?? item.row.quantity) || 1}|${toNumber(item.row.price)}`;
    if (existingItemKeys.has(key)) { skipped++; continue; }
    importable++;
  }

  return { importableItemCount: importable, skippedItemCount: skipped };
}

// ─── Main migration ─────────────────────────────────────────────────────────

const DRAWER_TABLES = ['cashDrawerEntries', 'gcashDrawerEntries'] as const;

export async function migrateLegacyBackup(legacy: LegacyBackup): Promise<RestoreResult> {
  const result: RestoreResult = {
    success: false,
    mode: 'merge',
    message: '',
    itemsImported: 0,
    itemsSkipped: 0,
    errors: 0,
    tablesProcessed: [],
    importedByTable: {},
    skippedByTable: {},
    errorsByTable: {},
    settingsSkipped: 0,
    usersSkipped: 0,
    safetyBackupCreated: false,
  };

  // ── 1. Detect already-imported backup (no safety backup, no writes). ──
  const fp = legacyFingerprint(legacy);
  const existingFingerprint = await localDb.meta.get(fp);
  if (existingFingerprint?.value === true) {
    result.success = false;
    result.message = 'This legacy backup has already been imported. No changes were made and no data was modified.';
    return result;
  }

  // ── 2. Validate the entire structure before any write. ──
  const validation = validateLegacyBackup(legacy);
  if (!validation.valid) {
    const summary = validation.errors.slice(0, 5).map(e =>
      `${e.table ? e.table + '.' : ''}${e.field}: ${e.message}`,
    ).join('\n');
    const extra = validation.errors.length > 5 ? `\n...and ${validation.errors.length - 5} more` : '';
    result.success = false;
    result.message = `Validation failed:\n${summary}${extra}`;
    return result;
  }

  // ── 3. Analyze what will be imported (same rules as preview). ──
  const analysis = await analyzeLegacyBackup(legacy);
  if (analysis.importableProducts.length === 0
    && analysis.importableServices.length === 0
    && analysis.importableTechnicians.length === 0
    && analysis.importableTransactions.length === 0
    && analysis.importableItems.length === 0) {
    result.success = false;
    result.message = 'Nothing to import — every record in this legacy backup already exists in this device.';
    return result;
  }

  // ── 4. Safety backup — immediately before writes, only for a valid import. ──
  try {
    const blob = await exportBackup();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `jegz-pos-safety-backup-before-legacy-import-${stamp}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    result.safetyBackupCreated = true;
    result.safetyBackupFileName = fileName;
  } catch (error) {
    result.success = false;
    result.message = `Could not create safety backup: ${error instanceof Error ? error.message : 'Unknown error'}. Import aborted.`;
    return result;
  }

  // ── 5. Atomic import of historical data ──
  const allTables = [
    'products', 'services', 'technicians',
    'transactions', 'transactionItems',
    ...DRAWER_TABLES,
    'settings',
  ] as const;

  let imported;
  try {
    imported = await localDb.transaction('rw', allTables, async () => {
      const imported = {
        products: 0, services: 0, technicians: 0,
        transactions: 0, transactionItems: 0,
        totalImported: 0, totalSkipped: 0, settingsSkipped: 0,
      };

      // ▸ Product map: source string ID → ACTUAL Dexie destination ID.
      // Legacy products whose name already exists in the destination map to
      // the EXISTING destination row (never overwritten, never left unresolved).
      const productMap = new Map<string, number>();
      for (const legacyRow of analysis.importableProducts) {
        const row = adaptProduct(legacyRow);
        const newId = await localDb.products.add(row as any) as number;
        if (legacyRow.id != null) productMap.set(String(legacyRow.id), newId);
        imported.products++;
        imported.totalImported++;
      }
      for (const legacyRow of legacy.data.products || []) {
        if (legacyRow.id == null) continue;
        if (productMap.has(String(legacyRow.id))) continue;
        const existingId = analysis.existingProductIdByName.get(normalizeName(legacyRow.name));
        if (existingId != null) productMap.set(String(legacyRow.id), existingId);
      }

      // ▸ Service map.
      const serviceMap = new Map<string, number>();
      for (const legacyRow of analysis.importableServices) {
        const row = adaptService(legacyRow);
        const newId = await localDb.services.add(row as any) as number;
        if (legacyRow.id != null) serviceMap.set(String(legacyRow.id), newId);
        imported.services++;
        imported.totalImported++;
      }
      for (const legacyRow of legacy.data.services || []) {
        if (legacyRow.id == null) continue;
        if (serviceMap.has(String(legacyRow.id))) continue;
        const existingId = analysis.existingServiceIdByName.get(normalizeName(legacyRow.name));
        if (existingId != null) serviceMap.set(String(legacyRow.id), existingId);
      }

      // ▸ Technician map.
      const technicianMap = new Map<string, number>();
      for (const legacyRow of analysis.importableTechnicians) {
        const row = adaptTechnician(legacyRow);
        const newId = await localDb.technicians.add(row as any) as number;
        if (legacyRow.id != null) technicianMap.set(String(legacyRow.id), newId);
        imported.technicians++;
        imported.totalImported++;
      }
      for (const legacyRow of legacy.data.technicians || []) {
        if (legacyRow.id == null) continue;
        if (technicianMap.has(String(legacyRow.id))) continue;
        const existingId = analysis.existingTechnicianIdByName.get(normalizeName(legacyRow.name));
        if (existingId != null) technicianMap.set(String(legacyRow.id), existingId);
      }

      // ▸ Transaction map + insert transactions (technicianId resolved here).
      const transactionMap = new Map<string, number>();
      for (const legacyRow of analysis.importableTransactions) {
        const row = adaptTransaction(legacyRow);
        // Resolve technician reference using the ACTUAL destination technician id.
        if (legacyRow.technicianId != null && technicianMap.has(String(legacyRow.technicianId))) {
          row.technicianId = technicianMap.get(String(legacyRow.technicianId));
        }
        const newId = await localDb.transactions.add(row as any) as number;
        if (legacyRow.id != null) transactionMap.set(String(legacyRow.id), newId);
        imported.transactions++;
        imported.totalImported++;
      }

      // ▸ Transaction items — resolve transactionId + refId from ACTUAL maps
      //   AFTER the parent records exist. refId null/undefined stays as is.
      const existingItemKeys = new Set(
        (await localDb.transactionItems.toArray()).map(
          it => `${it.transactionId}|${it.type}|${normalizeName(it.name)}|${it.quantity}|${it.price}`,
        ),
      );
      for (const item of analysis.importableItems) {
        const { row: legacyItem } = item;
        const destTxId = transactionMap.get(item.legacyTransactionId);
        if (destTxId == null) {
          imported.totalSkipped++;
          continue;
        }

        const adapted = adaptTransactionItem(legacyItem);

        // Reserve refId: null/undefined/empty-string stays as-is
        // (custom / historical line item) — never invented, never coerced to 0.
        let refId: number | null | undefined = undefined;
        if (isValidId(legacyItem.refId)) {
          const resolved = legacyItem.type === 'product'
            ? productMap.get(String(legacyItem.refId))
            : serviceMap.get(String(legacyItem.refId));
          refId = resolved ?? null;
        }

        const dedupeKey = `${destTxId}|${adapted.type}|${normalizeName(adapted.name)}|${adapted.quantity}|${adapted.price}`;
        // Skip ONLY when this line already exists in the destination BEFORE the
        // import. Do NOT grow the set as we insert: a legacy transaction that
        // legitimately contains two identical line items must keep both rows.
        if (existingItemKeys.has(dedupeKey)) {
          imported.totalSkipped++;
          continue;
        }

        await localDb.transactionItems.add({
          ...adapted,
          transactionId: destTxId,
          refId,
        } as any);
        imported.transactionItems++;
        imported.totalImported++;
      }

      // ▸ Drawer entries are intentionally not imported (protect current balance).
      imported.settingsSkipped = (legacy.data.settings?.length || 0);

      return imported;
    });
  } catch (error) {
    // Atomic: the Dexie transaction has already rolled back on failure, so no
    // partial import remains. The fingerprint is NOT written.
    result.success = false;
    result.message = `Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}. No data was changed.`;
    return result;
  }

  // ── 6. Job-number backfill using the existing Offline POS mechanism. ──
  // ensureJobNumbers() assigns JEGZ-YYYY-NNNNNN to every transaction missing a
  // jobNumber (all newly imported historical rows), without touching createdAt.
  // It internally raises the per-year counter to avoid collisions.
  try {
    await ensureJobNumbers();
  } catch (error) {
    result.success = false;
    result.message = `Migration imported data but failed to assign job numbers: ${error instanceof Error ? error.message : 'Unknown error'}. Run a Backup & Restore to backfill numbers.`;
    return result;
  }

  // ── 7. Record the fingerprint only after a fully successful import. ──
  try {
    await localDb.meta.put({ key: fp, value: true, updatedAt: new Date().toISOString() } as any);
  } catch (error) {
    // Fingerprint write failing is not destructive; data is already imported.
    // Report it as a warning but keep the import as successful.
    console.warn('Could not record import fingerprint:', error);
  }

  result.success = true;
  result.itemsImported = imported.totalImported;
  result.itemsSkipped = imported.totalSkipped;
  result.importedByTable = {
    products: imported.products,
    services: imported.services,
    technicians: imported.technicians,
    transactions: imported.transactions,
    transactionItems: imported.transactionItems,
  };
  result.skippedByTable = {
    cashDrawerEntries: legacy.data.cashDrawerEntries?.length || 0,
    gcashDrawerEntries: legacy.data.gcashDrawerEntries?.length || 0,
  };
  result.settingsSkipped = imported.settingsSkipped;
  result.tablesProcessed = ['products', 'services', 'technicians', 'transactions', 'transactionItems', 'cashDrawerEntries', 'gcashDrawerEntries', 'settings'];
  result.message = `Successfully imported ${imported.totalImported} records from the legacy Replit backup. ${imported.totalSkipped} existing records were preserved. Drawer entries were skipped to protect the current balance. Shop settings were not overwritten.`;

  return result;
}
