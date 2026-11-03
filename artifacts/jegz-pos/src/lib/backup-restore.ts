/**
 * Backup and Restore System
 * Allows users to export and import their POS data.
 *
 * Version 2.0.0 preserves all job data (customer/phone/device details, job
 * numbers, statuses, pre-orders, markups, payment/deposit tracking, repair
 * notes). Import is backward compatible: 1.0.0 backups are migrated safely.
 *
 * Version 2.1.0 explicitly tracks the settings table (which holds the shop
 * profile and the base64 shop logo) in the backup so the shop identity,
 * logo, receipt footer, payment options, and all preferences are preserved
 * through export and restore.
 *
 * This version adds a SAFE MERGE restore mode (default). Merge imports only
 * records whose stable primary key does not already exist locally, never
 * overwrites existing local records, preserves the destination shop profile,
 * users/auth, and historical transactions, imports dependent tables in a
 * safe order, and automatically creates a safety backup of the destination
 * database before any database writes. The full "Replace All Data" behavior
 * remains available as an explicit, destructive alternative.
 */

import { localDb, LOCAL_TABLES } from './local-db';
import { normalizeStatus, paymentStatusFor, ensureJobNumbers, normalizeServiceCatalog } from './offline-data-services';
import { writeFileToStorageFolder } from './storage-folder';
import { queueAllLocalRecords, queueDeletedRows } from './sync-engine';
import { queueAllTrackingRecords } from './tracking-mirror';

export const BACKUP_VERSION = '2.1.0';

/** meta table key that stores the ISO timestamp of the last successful backup. */
export const LAST_BACKUP_KEY = 'lastBackupTime';

/**
 * Read the timestamp of the last successful backup (if any).
 * Stored only locally in the existing meta table — this is not a cloud backup.
 */
export async function getLastBackupTime(): Promise<string | null> {
  try {
    const row = await localDb.meta.get(LAST_BACKUP_KEY);
    const value = row?.value;
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

/** Record the timestamp of a successful local backup. */
export async function markLastBackup(time?: string): Promise<void> {
  const at = time || new Date().toISOString();
  await localDb.meta.put({
    key: LAST_BACKUP_KEY,
    value: at,
    createdAt: new Date().toISOString(),
    updatedAt: at,
  } as any);
}

export interface PosBackup {
  version: string;
  exportDate: string;
  data: Record<string, any[]>;
  metadata: {
    productCount: number;
    serviceCount: number;
    transactionCount: number;
    transactionItemCount: number;
    settingsCount: number;
  };
}

/** Restore/import mode: safe merge (default) or destructive full replacement. */
export type RestoreMode = 'merge' | 'replace';

/** Detailed, structured result of an import/restore operation. */
export interface RestoreResult {
  success: boolean;
  mode: RestoreMode;
  message: string;
  itemsImported: number;
  itemsSkipped: number;
  errors: number;
  tablesProcessed: string[];
  importedByTable: Record<string, number>;
  skippedByTable: Record<string, number>;
  errorsByTable: Record<string, number>;
  settingsSkipped: number;
  usersSkipped: number;
  safetyBackupCreated: boolean;
  safetyBackupFileName?: string;
}

function createResult(mode: RestoreMode): RestoreResult {
  return {
    success: false,
    mode,
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
}

/** Per-table preview of what a merge would do (read-only analysis). */
export interface TablePreview {
  /** Records that already exist locally (or are otherwise skipped). */
  existing: number;
  /** Records that would be imported. */
  new: number;
}

/** Read-only merge preview computed against the current local database. */
export interface RestorePreview {
  valid: boolean;
  error?: string;
  version: string;
  exportDate: string;
  counts: {
    products: number;
    services: number;
    transactions: number;
    transactionItems: number;
    technicians: number;
    settings: number;
  };
  tables: Record<string, TablePreview>;
  customers: { existing: number; new: number };
  totals: { toImport: number; existingPreserved: number };
  settingsSkipped: boolean;
}

/**
 * Export all POS data to a JSON backup file
 */
export async function exportBackup(): Promise<Blob> {
  try {
    const backup: PosBackup = {
      version: BACKUP_VERSION,
      exportDate: new Date().toISOString(),
      data: {},
      metadata: {
        productCount: 0,
        serviceCount: 0,
        transactionCount: 0,
        transactionItemCount: 0,
        settingsCount: 0,
      },
    };

    // Export each table
    for (const table of LOCAL_TABLES) {
      const tableData = await (localDb as any)[table].toArray();
      backup.data[table] = tableData;

      // Update metadata
      if (table === 'products') backup.metadata.productCount = tableData.length;
      if (table === 'services') backup.metadata.serviceCount = tableData.length;
      if (table === 'transactions') backup.metadata.transactionCount = tableData.length;
      if (table === 'transactionItems') backup.metadata.transactionItemCount = tableData.length;
      if (table === 'settings') backup.metadata.settingsCount = tableData.length;
    }

    // Create blob and return
    const jsonString = JSON.stringify(backup, null, 2);
    return new Blob([jsonString], { type: 'application/json' });
  } catch (error) {
    console.error('Error creating backup:', error);
    throw new Error('Failed to create backup');
  }
}

function triggerFileDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function backupFileName(date: Date): string {
  return `fixmo-ph-backup-${date.toISOString().slice(0, 10)}.json`;
}

/** Where the most recent backup ended up. */
export type BackupSaveMethod = 'folder' | 'download';

/** Result of a "Backup Now" run. */
export interface BackupSaveResult {
  method: BackupSaveMethod;
  fileName: string;
  /** Set when the backup was saved into a connected storage folder. */
  folderName?: string;
}

/**
 * Create a backup and save it to the connected POS storage folder when one is
 * connected with read-write permission. Otherwise it gracefully falls back to
 * the normal browser download flow. The backup format is identical either way.
 *
 * Writes are only ever made inside the folder the user picked. When the folder
 * is connected but the write itself fails, the error is thrown instead of being
 * silently ignored.
 */
export async function backupNow(options?: { preferStorageFolder?: boolean }): Promise<BackupSaveResult> {
  const preferStorageFolder = options?.preferStorageFolder !== false;
  const backup = await exportBackup();
  const fileName = backupFileName(new Date());

  if (preferStorageFolder) {
    const saved = await writeFileToStorageFolder(fileName, backup, 'Backups');
    if (saved) {
      // Only record a timestamp once the backup data was generated successfully.
      await markLastBackup();
      return { method: 'folder', fileName, folderName: saved.folderName };
    }
  }

  // No connected folder (or permission not granted) → normal browser download.
  await markLastBackup();
  triggerFileDownload(backup, fileName);
  return { method: 'download', fileName };
}

/**
 * Force a backup that always downloads as a file (never touches the storage
 * folder). Retained for callers that explicitly want the original behavior.
 */
export async function downloadBackup(): Promise<void> {
  try {
    const backup = await exportBackup();
    // Only record a timestamp once the backup data was generated successfully.
    await markLastBackup();
    triggerFileDownload(backup, backupFileName(new Date()));
  } catch (error) {
    console.error('Error downloading backup:', error);
    throw error;
  }
}

/**
 * Create an in-memory safety backup of the current destination database.
 * Reuses the existing backup implementation so there is a single backup
 * format/code path. Called before ANY restore writes.
 */
async function createSafetyBackup(): Promise<
  { ok: true; blob: Blob; fileName: string } | { ok: false; error: string }
> {
  try {
    const blob = await exportBackup();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return { ok: true, blob, fileName: `fixmo-ph-safety-backup-before-restore-${stamp}.json` };
  } catch (error) {
    console.error('Error creating safety backup before restore:', error);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Validate a backup file
 */
export function validateBackup(data: any): { valid: boolean; error?: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid backup format' };
  }

  if (!data.version || typeof data.version !== 'string') {
    return { valid: false, error: 'Missing or invalid version' };
  }

  if (!data.exportDate || typeof data.exportDate !== 'string') {
    return { valid: false, error: 'Missing or invalid export date' };
  }

  if (!data.data || typeof data.data !== 'object') {
    return { valid: false, error: 'Missing data in backup' };
  }

  if (!data.metadata || typeof data.metadata !== 'object') {
    return { valid: false, error: 'Missing metadata in backup' };
  }

  // Validate that core tables exist
  const requiredTables = ['products', 'services', 'transactions', 'transactionItems'];
  for (const table of requiredTables) {
    if (!Array.isArray(data.data[table])) {
      return { valid: false, error: `Missing or invalid table: ${table}` };
    }
  }

  return { valid: true };
}

const isPhoneString = (value: unknown): boolean =>
  typeof value === 'string' && /^[0-9+\-\s()]{7,}$/.test(value.trim());

/**
 * Migrate legacy backup rows into the current schema with safe defaults.
 * Mutates rows in place. Callers must pass a copy, not the raw backup row.
 */
function migrateRow(table: string, row: any) {
  if (!row || typeof row !== 'object') return;

  if (table === 'transactions') {
    const customerName = row.customerName || row.customer || 'Walk-in';
    let customerPhone = row.customerPhone;
    if (!customerPhone && isPhoneString(row.unit)) customerPhone = row.unit;
    const phoneBrand = row.phoneBrand;
    const phoneModel = row.phoneModel;
    const status = normalizeStatus(row.status || 'pending');
    const total = Number.isFinite(row.totalAmount) ? row.totalAmount : Number.isFinite(row.total) ? row.total : 0;
    const amountPaid = row.amountPaid || 0;
    const paymentStatus = row.paymentStatus || paymentStatusFor(total, amountPaid);
    const remainingBalance = Number.isFinite(row.remainingBalance)
      ? row.remainingBalance
      : Math.max(0, total - amountPaid);

    row.customerName = customerName;
    row.customer = customerName;
    row.customerPhone = customerPhone;
    if (customerPhone !== undefined && customerPhone !== null) row.unit = customerPhone;
    row.phoneBrand = phoneBrand;
    row.phoneModel = phoneModel;
    row.status = status;
    row.total = total;
    row.totalAmount = total;
    row.amountPaid = amountPaid;
    row.remainingBalance = remainingBalance;
    row.paymentStatus = paymentStatus;
    row.isPreOrder = Boolean(row.isPreOrder);
    // job numbers are backfilled after import so they never collide
    if (!row.jobNumber) row.jobNumber = undefined;
  }

  if (table === 'transactionItems') {
    row.isPreOrder = row.isPreOrder === true;
    row.isCustom = row.isCustom === true;
    row.savedToList = row.savedToList === true;
    if (typeof row.cost !== 'number') row.cost = undefined;
  }

  if (table === 'products') {
    if (typeof row.reservedStock !== 'number' || !Number.isFinite(row.reservedStock)) {
      row.reservedStock = 0;
    }
  }
}

/**
 * Tables are imported in this order so parent records always exist before
 * dependent records:
 * - transactionItems → transactions (transactionId)
 * - transactionItems → products / services (refId + type)
 * - transactions → technicians (technicianId)
 * - defectiveItems → products (productId)
 * - backjobs → technicians (technicianId)
 * Settings, users and meta have no dependencies and are processed first.
 */
const IMPORT_ORDER: readonly string[] = [
  'meta',
  'settings',
  'users',
  'products',
  'services',
  'technicians',
  'transactions',
  'transactionItems',
  'defectiveItems',
  'backjobs',
  'cashDrawerEntries',
  'gcashDrawerEntries',
];

/**
 * Merge a single table from backup rows into the local database.
 *
 * Rules:
 * - settings: never overwritten — the destination shop profile/settings win.
 * - users: matched by username — never overwrite an existing local user.
 * - meta: bookkeeping rows are skipped; the job-number counter is reconciled
 *   after import instead.
 * - transactionItems: only imported when their parent transaction was imported
 *   in the same merge, so items always stay associated with the right job.
 * - everything else: matched by stable ID. If the ID exists locally, the local
 *   record is kept and the backup record is skipped. Otherwise the backup
 *   record is inserted with its original ID so relationships stay intact.
 */
async function mergeTableRows(
  table: string,
  rows: any[],
  result: RestoreResult,
  importedTxIds: Set<number>,
): Promise<void> {
  const dbTable = (localDb as any)[table];
  if (!dbTable) return;

  for (const backupRow of rows) {
    try {
      // Settings: preserve the destination shop profile/settings, never overwrite.
      if (table === 'settings') {
        result.skippedByTable[table] = (result.skippedByTable[table] || 0) + 1;
        result.itemsSkipped++;
        result.settingsSkipped++;
        continue;
      }

      // Meta: string-keyed bookkeeping; skipped in merge. The job-number counter
      // and seed flag are handled explicitly after the import.
      if (table === 'meta') {
        result.skippedByTable[table] = (result.skippedByTable[table] || 0) + 1;
        result.itemsSkipped++;
        continue;
      }

      // Users: match by username (audited safe strategy). Never overwrite an
      // existing account, role or password hash. New users get a fresh id so
      // they never clash with an unrelated local user that happens to share a
      // numeric id.
      if (table === 'users') {
        const username = backupRow?.username;
        const match = username
          ? await localDb.users.where('username').equals(String(username)).first()
          : typeof backupRow.id === 'number'
            ? await dbTable.get(backupRow.id)
            : undefined;
        if (match) {
          result.skippedByTable[table] = (result.skippedByTable[table] || 0) + 1;
          result.itemsSkipped++;
          result.usersSkipped++;
          continue;
        }
        const { id: _dropped, ...rest } = backupRow;
        await dbTable.add(rest);
        result.importedByTable[table] = (result.importedByTable[table] || 0) + 1;
        result.itemsImported++;
        continue;
      }

      // Transaction items must stay associated with their parent job. Only
      // import items whose parent backup transaction was actually imported —
      // otherwise the item would mutate an existing local job.
      if (table === 'transactionItems') {
        const parentId = (backupRow as any).transactionId;
        if (!importedTxIds.has(parentId)) {
          result.skippedByTable[table] = (result.skippedByTable[table] || 0) + 1;
          result.itemsSkipped++;
          continue;
        }
      }

      // Generic ID-based dedup: if the primary key already exists locally,
      // keep the existing record and skip the backup record.
      if (typeof backupRow.id === 'number' && Number.isFinite(backupRow.id)) {
        const existing = await dbTable.get(backupRow.id);
        if (existing) {
          result.skippedByTable[table] = (result.skippedByTable[table] || 0) + 1;
          result.itemsSkipped++;
          continue;
        }
      }

      await dbTable.add(backupRow);
      if (table === 'transactions' && typeof backupRow.id === 'number') {
        importedTxIds.add(backupRow.id);
      }
      result.importedByTable[table] = (result.importedByTable[table] || 0) + 1;
      result.itemsImported++;
    } catch (error) {
      console.warn(`Skipped item in table ${table}:`, error);
      result.errorsByTable[table] = (result.errorsByTable[table] || 0) + 1;
      result.errors++;
    }
  }
}

/**
 * Raise the per-year job-number counter to the highest JEGZ sequence number
 * actually present in the transactions table. This keeps future job numbers
 * from colliding with numbers imported from another device.
 */
async function reconcileJobNumberCounter(): Promise<void> {
  const year = String(new Date().getFullYear());
  const counterKey = `jobSeqGlobal_${year}`;
  const prefix = `JEGZ-${year}-`;
  try {
    const transactions = await localDb.transactions.toArray();
    let maxSeq = 0;
    for (const tx of transactions) {
      const jn = String((tx as any).jobNumber || '');
      if (jn.startsWith(prefix)) {
        const n = parseInt(jn.slice(prefix.length), 10);
        if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
      }
    }
    const meta = await localDb.meta.get(counterKey);
    const current = typeof meta?.value === 'number' && Number.isFinite(meta.value) ? meta.value : 0;
    if (maxSeq > current) {
      await localDb.meta.put({ key: counterKey, value: maxSeq, updatedAt: new Date().toISOString() } as any);
    }
  } catch (error) {
    console.warn('Failed to reconcile job number counter:', error);
  }
}

/**
 * Derive a stable customer identity for preview purposes, mirroring the key
 * derivation used by the customers feature (phone digits when recorded,
 * otherwise a normalized customer name). Read-only; never writes data.
 */
function customerPreviewKeyOf(tx: {
  customerName?: string;
  customer?: string;
  customerPhone?: string;
  unit?: string;
}): string {
  const rawPhone = tx.customerPhone || (isPhoneString(tx.unit) ? tx.unit : '') || '';
  const digits = rawPhone.replace(/\D/g, '');
  if (digits) return `p:${digits.length > 10 ? digits.slice(-10) : digits}`;
  const name = (tx.customerName || tx.customer || 'Walk-in').trim().toLowerCase().replace(/\s+/g, ' ');
  return `n:${name || 'walk-in'}`;
}

/**
 * Analyze a backup against the current local database WITHOUT writing
 * anything to IndexedDB. The rules mirror the merge path exactly so the
 * preview matches what a merge would actually do:
 * - settings are always skipped (destination shop profile wins),
 * - users are matched by username,
 * - transaction items only import when their parent transaction imports,
 * - every other table is deduped by stable id.
 */
export async function previewRestore(backup: PosBackup): Promise<RestorePreview> {
  const emptyPreview = (): RestorePreview => ({
    valid: true,
    version: backup.version,
    exportDate: backup.exportDate,
    counts: { products: 0, services: 0, transactions: 0, transactionItems: 0, technicians: 0, settings: 0 },
    tables: {},
    customers: { existing: 0, new: 0 },
    totals: { toImport: 0, existingPreserved: 0 },
    settingsSkipped: false,
  });

  const preview = emptyPreview();
  const validation = validateBackup(backup);
  if (!validation.valid) {
    return { ...emptyPreview(), valid: false, error: validation.error };
  }

  const tableLen = (t: string): number => (Array.isArray(backup.data[t]) ? (backup.data[t] as any[]).length : 0);
  preview.counts = {
    products: tableLen('products'),
    services: tableLen('services'),
    transactions: tableLen('transactions'),
    transactionItems: tableLen('transactionItems'),
    technicians: tableLen('technicians'),
    settings: tableLen('settings'),
  };

  // Read-only snapshot of the local database (no writes).
  const localIdSets = new Map<string, Set<number>>();
  const localUsernames = new Set<string>();
  for (const table of IMPORT_ORDER) {
    const dbTable = (localDb as any)[table];
    if (!dbTable) continue;
    const rows = await dbTable.toArray();
    localIdSets.set(
      table,
      new Set(
        rows
          .filter((r: any) => typeof r?.id === 'number' && Number.isFinite(r.id))
          .map((r: any) => r.id as number),
      ),
    );
    if (table === 'users') {
      for (const u of rows) {
        if (u && typeof u.username === 'string') localUsernames.add(u.username);
      }
    }
  }

  // Backup transaction ids that a merge would import (drives item gating).
  const importedTxIds = new Set<number>();

  for (const table of IMPORT_ORDER) {
    const rows = backup.data[table];
    if (!Array.isArray(rows)) continue;

    const acc: TablePreview = preview.tables[table] || { existing: 0, new: 0 };
    preview.tables[table] = acc;

    // Settings are never overwritten during merge.
    if (table === 'settings') {
      if (rows.length > 0) preview.settingsSkipped = true;
      acc.existing += rows.length;
      preview.totals.existingPreserved += rows.length;
      continue;
    }

    // Meta bookkeeping is left untouched during merge.
    if (table === 'meta') {
      acc.existing += rows.length;
      preview.totals.existingPreserved += rows.length;
      continue;
    }

    // Users match by username; existing accounts are never replaced.
    if (table === 'users') {
      for (const row of rows) {
        const username = row?.username;
        const match = username
          ? localUsernames.has(String(username))
          : typeof row?.id === 'number' && localIdSets.get(table)?.has(row.id);
        if (match) {
          acc.existing++;
          preview.totals.existingPreserved++;
        } else {
          acc.new++;
          preview.totals.toImport++;
        }
      }
      continue;
    }

    // Transaction items only import when their parent transaction imports.
    if (table === 'transactionItems') {
      for (const row of rows) {
        const idTaken = typeof row?.id === 'number' && localIdSets.get(table)?.has(row.id);
        if (idTaken) {
          acc.existing++;
          preview.totals.existingPreserved++;
        } else if (importedTxIds.has(row?.transactionId)) {
          acc.new++;
          preview.totals.toImport++;
        } else {
          acc.existing++;
          preview.totals.existingPreserved++;
        }
      }
      continue;
    }

    // Generic ID-based dedup (products, services, technicians, transactions,
    // defectiveItems, backjobs, drawer entries).
    for (const row of rows) {
      const idTaken = typeof row?.id === 'number' && localIdSets.get(table)?.has(row.id);
      if (idTaken) {
        acc.existing++;
        preview.totals.existingPreserved++;
      } else {
        acc.new++;
        preview.totals.toImport++;
        if (table === 'transactions' && typeof row?.id === 'number') {
          importedTxIds.add(row.id);
        }
      }
    }
  }

  // Customer preview: derived identity sets from local vs backup transactions.
  const localTxs = await localDb.transactions.toArray();
  const localCustomerKeys = new Set(localTxs.map(customerPreviewKeyOf));
  const backupTxs: any[] = (Array.isArray(backup.data.transactions) ? backup.data.transactions : []).map(row => {
    const copy = { ...row };
    migrateRow('transactions', copy);
    return copy;
  });
  const backupCustomerKeys = new Set(backupTxs.map(customerPreviewKeyOf));
  preview.customers = {
    existing: [...backupCustomerKeys].filter(k => localCustomerKeys.has(k)).length,
    new: [...backupCustomerKeys].filter(k => !localCustomerKeys.has(k)).length,
  };

  return preview;
}

/**
 * Import backup data
 * @param backup The backup data to import
 * @param mode 'merge' (default) imports only records that do not already exist
 * locally. 'replace' erases all local data first, then restores the backup
 * completely. A boolean is accepted for backward compatibility: true = merge,
 * false = replace.
 */
export async function importBackup(
  backup: PosBackup,
  mode: RestoreMode | boolean = 'merge',
): Promise<RestoreResult> {
  const mergeMode = mode === 'merge' || mode === true;
  const restoreMode: RestoreMode = mergeMode ? 'merge' : 'replace';
  const result = createResult(restoreMode);

  try {
    // Validate the backup BEFORE touching IndexedDB.
    const validation = validateBackup(backup);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Automatic safety backup of the destination database BEFORE any writes.
    // If it cannot be created, abort without changing local data.
    const safety = await createSafetyBackup();
    if (!safety.ok) {
      result.success = false;
      result.message = `Restore aborted: could not create the safety backup of the current database (${safety.error}). No data was changed.`;
      return result;
    }
    triggerFileDownload(safety.blob, safety.fileName);
    result.safetyBackupCreated = true;
    result.safetyBackupFileName = safety.fileName;

    // Replace mode clears local data first (only after the safety backup exists).
    if (!mergeMode) {
      // Preserve sync bookkeeping so a restore does not accidentally re-pull
      // the cloud rows that this restore is replacing.
      const preservedMeta = await localDb.meta
        .filter((row) => String(row.key || '').startsWith('sync.'))
        .toArray();

      const backupSyncIds = new Map<string, Set<string>>();
      for (const table of IMPORT_ORDER) {
        const ids = new Set<string>();
        const rows = backup.data[table];
        if (Array.isArray(rows)) {
          for (const row of rows) {
            if (row && typeof row.syncId === 'string' && row.syncId) ids.add(row.syncId);
          }
        }
        backupSyncIds.set(table, ids);
      }

      // Tombstone only rows that are being replaced; rows present in the
      // backup keep their sync IDs and are re-uploaded below.
      for (const table of LOCAL_TABLES) {
        if (table === 'meta') continue;
        const dbTable = (localDb as any)[table];
        if (!dbTable) continue;
        const keep = backupSyncIds.get(table) || new Set<string>();
        const existing = await dbTable.toArray();
        const removed = existing.filter(
          (row: Record<string, unknown>) =>
            typeof row.syncId === 'string' && row.syncId && !keep.has(row.syncId),
        );
        if (removed.length > 0) {
          await queueDeletedRows(table as any, removed, { flush: false });
        }
      }

      for (const table of LOCAL_TABLES) {
        await (localDb as any)[table].clear();
      }
      for (const row of preservedMeta) {
        await localDb.meta.put(row);
      }
    }

    // Tracks which backup transactions were actually imported so their items
    // can be associated correctly in merge mode.
    const importedTxIds = new Set<number>();

    for (const table of IMPORT_ORDER) {
      const data = backup.data[table];
      if (!Array.isArray(data)) continue;

      const dbTable = (localDb as any)[table];
      if (!dbTable) continue;

      // Migrate legacy rows into the current schema. Each row is copied first
      // so the caller's backup object is never mutated, then migrated in place.
      const restoreStamp = new Date().toISOString();
      const migrated = data.map(row => {
        const copy = { ...row };
        migrateRow(table, copy);
        // A replace restore is an explicit overwrite: make each imported row
        // win last-write-wins against whatever is currently in the cloud.
        if (!mergeMode) copy.updatedAt = restoreStamp;
        return copy;
      });

      result.tablesProcessed.push(table);
      if (migrated.length === 0) continue;

      if (mergeMode) {
        await mergeTableRows(table, migrated, result, importedTxIds);
      } else {
        try {
          await dbTable.bulkAdd(migrated);
          result.importedByTable[table] = (result.importedByTable[table] || 0) + migrated.length;
          result.itemsImported += migrated.length;
        } catch (error) {
          console.error(`Error importing table ${table}:`, error);
          throw error;
        }
      }
    }

    // Backfill missing job numbers (legacy backups), then raise the per-year
    // counter so future job numbers never collide with imported ones.
    await ensureJobNumbers();
    await reconcileJobNumberCounter();

    // Ensure service catalog rows match the current shape (category/active/cost).
    await normalizeServiceCatalog();

    // Ensure the pre-order markup default exists.
    const existingMarkup = await localDb.settings.where('key').equals('preOrderMarkup').first();
    if (!existingMarkup) {
      await localDb.settings.add({
        key: 'preOrderMarkup',
        value: 20,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any);
    }

    // Mark database as seeded to prevent re-seeding
    await localDb.meta.put({
      key: 'db_seeded_v1',
      value: true,
    } as any);

    // Imported rows are new local changes; push them and let last-write-wins
    // reconcile anything that was also edited on another device.
    await queueAllLocalRecords();
    // Restored jobs also need a customer-safe tracking row.
    await queueAllTrackingRecords();

    result.success = true;
    result.message = mergeMode
      ? `Successfully merged ${result.itemsImported} items from the backup (${result.itemsSkipped} existing records were kept).`
      : `Successfully imported ${result.itemsImported} items from the backup.`;
    return result;
  } catch (error) {
    console.error('Error importing backup:', error);
    result.success = false;
    result.message = `Failed to import backup: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return result;
  }
}

/**
 * Get backup summary without loading full data
 */
export async function getBackupSummary(): Promise<{
  exportDate: string;
  items: {
    products: number;
    services: number;
    technicians: number;
    transactions: number;
    transactionItems: number;
  };
}> {
  return {
    exportDate: new Date().toISOString(),
    items: {
      products: await localDb.products.count(),
      services: await localDb.services.count(),
      technicians: await localDb.technicians.count(),
      transactions: await localDb.transactions.count(),
      transactionItems: await localDb.transactionItems.count(),
    },
  };
}