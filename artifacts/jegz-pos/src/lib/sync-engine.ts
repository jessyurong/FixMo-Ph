/**
 * Full local-first sync engine.
 *
 * Local IndexedDB remains the source of truth for the UI. Every mutation is
 * written locally first, then queued in `syncOutbox` and pushed to Supabase.
 * Pulls are ordered by `server_updated_at` and resolved with last-write-wins
 * using each record's `updated_at`.
 *
 * Cloud rows are snake_case and use UUID `sync_id` primary keys. Local rows
 * keep their numeric auto-increment ids so existing screens and joins keep
 * working; relationships are translated through `*_sync_id` fields.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { localDb } from './local-db';
import {
  SYNC_TABLE_NAMES,
  type SyncOutboxEntry,
  type SyncTableName,
} from './db-types';
import { SUPABASE_SHOP_ID, isSupabaseConfigured } from './tracking-config';
import { getAuthenticatedShopClient, supabaseErrorMessage } from './supabase-shop';
import { newSyncId } from './sync-id';

const PAGE_SIZE = 500;
const FLUSH_THROTTLE_MS = 10_000;
const LAST_PULLED_KEY = 'sync.lastPulledAt';
const NEEDS_INITIAL_UPLOAD_KEY = 'sync.needsInitialUpload';
const LAST_SYNC_KEY = 'sync.lastSyncedAt';
const DEVICE_ID_KEY = 'sync.deviceId';
const EPOCH = '1970-01-01T00:00:00.000Z';

const CLOUD_TABLE: Record<SyncTableName, string> = {
  products: 'products',
  services: 'services',
  technicians: 'technicians',
  transactions: 'transactions',
  transactionItems: 'transaction_items',
  cashDrawerEntries: 'cash_drawer_entries',
  gcashDrawerEntries: 'gcash_drawer_entries',
  defectiveItems: 'defective_items',
  backjobs: 'backjobs',
  users: 'users',
  settings: 'settings',
  activityLogs: 'activity_logs',
};

const PULL_ORDER: SyncTableName[] = [
  'products',
  'services',
  'technicians',
  'users',
  'settings',
  'transactions',
  'transactionItems',
  'defectiveItems',
  'backjobs',
  'cashDrawerEntries',
  'gcashDrawerEntries',
  'activityLogs',
];

type LocalRow = Record<string, any>;

interface RefMaps {
  productSyncById: Map<number, string>;
  productIdBySync: Map<string, number>;
  serviceSyncById: Map<number, string>;
  serviceIdBySync: Map<string, number>;
  technicianSyncById: Map<number, string>;
  technicianIdBySync: Map<string, number>;
  userSyncById: Map<number, string>;
  userIdBySync: Map<string, number>;
  transactionSyncById: Map<number, string>;
  transactionIdBySync: Map<string, number>;
}

function tableOf(name: SyncTableName): any {
  return (localDb as any)[name];
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function json(value: unknown): unknown {
  return value === undefined ? null : value;
}

function dateOrNow(value: unknown): string {
  const text = str(value);
  if (text) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function nowISO(): string {
  return new Date().toISOString();
}

async function metaValue(key: string): Promise<unknown> {
  return (await localDb.meta.get(key))?.value;
}

async function setMeta(key: string, value: unknown): Promise<void> {
  await localDb.meta.put({ key, value, updatedAt: nowISO() } as any);
}

export async function getDeviceId(): Promise<string> {
  const existing = await metaValue(DEVICE_ID_KEY);
  if (typeof existing === 'string' && existing.length > 0) return existing;
  const id = newSyncId();
  await setMeta(DEVICE_ID_KEY, id);
  return id;
}

export async function loadRefMaps(): Promise<RefMaps> {
  const [products, services, technicians, users, transactions] = await Promise.all([
    localDb.products.toArray(),
    localDb.services.toArray(),
    localDb.technicians.toArray(),
    localDb.users.toArray(),
    localDb.transactions.toArray(),
  ]);

  const maps: RefMaps = {
    productSyncById: new Map(),
    productIdBySync: new Map(),
    serviceSyncById: new Map(),
    serviceIdBySync: new Map(),
    technicianSyncById: new Map(),
    technicianIdBySync: new Map(),
    userSyncById: new Map(),
    userIdBySync: new Map(),
    transactionSyncById: new Map(),
    transactionIdBySync: new Map(),
  };

  for (const row of products) {
    if (row.syncId) {
      maps.productSyncById.set(row.id, row.syncId);
      maps.productIdBySync.set(row.syncId, row.id);
    }
  }
  for (const row of services) {
    if (row.syncId) {
      maps.serviceSyncById.set(row.id, row.syncId);
      maps.serviceIdBySync.set(row.syncId, row.id);
    }
  }
  for (const row of technicians) {
    if (row.syncId) {
      maps.technicianSyncById.set(row.id, row.syncId);
      maps.technicianIdBySync.set(row.syncId, row.id);
    }
  }
  for (const row of users) {
    if (row.syncId) {
      maps.userSyncById.set(row.id, row.syncId);
      maps.userIdBySync.set(row.syncId, row.id);
    }
  }
  for (const row of transactions) {
    if (row.syncId) {
      maps.transactionSyncById.set(row.id, row.syncId);
      maps.transactionIdBySync.set(row.syncId, row.id);
    }
  }

  return maps;
}

function registerLocalRow(
  table: SyncTableName,
  row: LocalRow,
  maps: RefMaps,
): void {
  if (!row.syncId) return;
  switch (table) {
    case 'products':
      maps.productSyncById.set(row.id, row.syncId);
      maps.productIdBySync.set(row.syncId, row.id);
      break;
    case 'services':
      maps.serviceSyncById.set(row.id, row.syncId);
      maps.serviceIdBySync.set(row.syncId, row.id);
      break;
    case 'technicians':
      maps.technicianSyncById.set(row.id, row.syncId);
      maps.technicianIdBySync.set(row.syncId, row.id);
      break;
    case 'users':
      maps.userSyncById.set(row.id, row.syncId);
      maps.userIdBySync.set(row.syncId, row.id);
      break;
    case 'transactions':
      maps.transactionSyncById.set(row.id, row.syncId);
      maps.transactionIdBySync.set(row.syncId, row.id);
      break;
    default:
      break;
  }
}

function unregisterSyncId(table: SyncTableName, syncId: string, maps: RefMaps): void {
  switch (table) {
    case 'products': {
      const id = maps.productIdBySync.get(syncId);
      if (id !== undefined) maps.productSyncById.delete(id);
      maps.productIdBySync.delete(syncId);
      break;
    }
    case 'services': {
      const id = maps.serviceIdBySync.get(syncId);
      if (id !== undefined) maps.serviceSyncById.delete(id);
      maps.serviceIdBySync.delete(syncId);
      break;
    }
    case 'technicians': {
      const id = maps.technicianIdBySync.get(syncId);
      if (id !== undefined) maps.technicianSyncById.delete(id);
      maps.technicianIdBySync.delete(syncId);
      break;
    }
    case 'users': {
      const id = maps.userIdBySync.get(syncId);
      if (id !== undefined) maps.userSyncById.delete(id);
      maps.userIdBySync.delete(syncId);
      break;
    }
    case 'transactions': {
      const id = maps.transactionIdBySync.get(syncId);
      if (id !== undefined) maps.transactionSyncById.delete(id);
      maps.transactionIdBySync.delete(syncId);
      break;
    }
    default:
      break;
  }
}

export function toCloudRow(
  table: SyncTableName,
  row: LocalRow,
  maps: RefMaps,
): Record<string, unknown> {
  const createdAt = dateOrNow(row.createdAt);
  const updatedAt = dateOrNow(row.updatedAt || row.createdAt);
  const base = {
    shop_id: SUPABASE_SHOP_ID,
    sync_id: row.syncId,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: str(row.deletedAt),
  };

  switch (table) {
    case 'products':
      return {
        ...base,
        name: str(row.name) || '',
        category: str(row.category) || '',
        price: num(row.price) ?? 0,
        selling_price: num(row.sellingPrice),
        cost: num(row.cost),
        stock: num(row.stock) ?? 0,
        reserved_stock: num(row.reservedStock) ?? 0,
        reorder_point: num(row.reorderPoint),
        sku: str(row.sku),
        device_type: str(row.deviceType),
      };
    case 'services':
      return {
        ...base,
        name: str(row.name) || '',
        type: str(row.type) || '',
        price: num(row.price) ?? 0,
        cost: num(row.cost),
        duration: num(row.duration),
        category: str(row.category),
        active: row.active !== false,
      };
    case 'technicians':
      return {
        ...base,
        name: str(row.name) || '',
        email: str(row.email),
        phone: str(row.phone),
        role: str(row.role),
        specialization: str(row.specialization),
        jobs_done: num(row.jobsDone),
        total_sales: num(row.totalSales),
      };
    case 'transactions':
      return {
        ...base,
        customer_name: str(row.customerName),
        customer_phone: str(row.customerPhone),
        phone_brand: str(row.phoneBrand),
        phone_model: str(row.phoneModel),
        device_passcode: str(row.devicePasscode),
        customer: str(row.customer),
        unit: str(row.unit),
        technician_sync_id:
          str(row.technicianSyncId) ||
          (row.technicianId ? maps.technicianSyncById.get(row.technicianId) : null) ||
          null,
        technician_name: str(row.technicianName),
        payment_method: str(row.paymentMethod),
        status: str(row.status) || 'pending',
        repair_status: str(row.repair_status),
        tracking_token: str(row.trackingToken),
        tracking_history: json(row.trackingHistory ?? []),
        total: num(row.total),
        total_amount: num(row.totalAmount),
        amount_paid: num(row.amountPaid) ?? 0,
        remaining_balance: num(row.remainingBalance),
        payment_status: str(row.paymentStatus),
        job_number: str(row.jobNumber),
        notes: str(row.notes),
        customer_complaint: str(row.customerComplaint),
        diagnosis: str(row.diagnosis),
        technician_notes: str(row.technicianNotes),
        is_pre_order: bool(row.isPreOrder) ?? false,
        completed_at: str(row.completedAt),
      };
    case 'transactionItems':
      return {
        ...base,
        transaction_sync_id:
          str(row.transactionSyncId) ||
          (row.transactionId ? maps.transactionSyncById.get(row.transactionId) : null) ||
          null,
        ref_sync_id:
          str(row.refSyncId) ||
          (row.type === 'product'
            ? maps.productSyncById.get(row.refId) || null
            : maps.serviceSyncById.get(row.refId) || null),
        type: str(row.type) || 'service',
        name: str(row.name) || '',
        quantity: num(row.quantity) ?? 1,
        price: num(row.price) ?? 0,
        subtotal: num(row.subtotal) ?? 0,
        cost: num(row.cost),
        is_pre_order: bool(row.isPreOrder) ?? false,
        base_price: num(row.basePrice),
        markup_percentage: num(row.markupPercentage),
        markup_amount: num(row.markupAmount),
        is_custom: bool(row.isCustom) ?? false,
        saved_to_list: bool(row.savedToList) ?? false,
        notes: str(row.notes),
      };
    case 'cashDrawerEntries':
    case 'gcashDrawerEntries':
      return {
        ...base,
        type: str(row.type) || 'adjustment',
        amount: num(row.amount) ?? 0,
        note: str(row.note),
        notes: str(row.notes),
      };
    case 'defectiveItems':
      return {
        ...base,
        product_sync_id:
          str(row.productSyncId) ||
          (row.productId ? maps.productSyncById.get(row.productId) : null) ||
          null,
        product_name: str(row.productName),
        reason: str(row.reason) || '',
        quantity: num(row.quantity) ?? 1,
        cost_per_unit: num(row.costPerUnit),
        total_loss: num(row.totalLoss),
      };
    case 'backjobs':
      return {
        ...base,
        customer: str(row.customer) || '',
        phone: str(row.phone),
        unit: str(row.unit),
        technician_sync_id:
          str(row.technicianSyncId) ||
          (row.technicianId ? maps.technicianSyncById.get(row.technicianId) : null) ||
          null,
        technician_name: str(row.technicianName),
        description: str(row.description),
        issue: str(row.issue),
        original_repair_date: str(row.originalRepairDate),
        cause: str(row.cause),
        status: str(row.status) || 'pending',
        within_warranty: bool(row.withinWarranty),
      };
    case 'users':
      return {
        ...base,
        username: str(row.username) || '',
        password_hash: str(row.passwordHash) || '',
        role: str(row.role) || 'staff',
        permissions: json(row.permissions ?? []),
        is_active: row.isActive !== false,
      };
    case 'settings':
      return {
        ...base,
        key: str(row.key) || '',
        value: json(row.value),
      };
    case 'activityLogs':
      return {
        ...base,
        created_at: dateOrNow(row.createdAt),
        username: str(row.username) || 'system',
        user_role: str(row.userRole),
        user_sync_id:
          str(row.userSyncId) ||
          (row.userId ? maps.userSyncById.get(row.userId) : null) ||
          null,
        action: str(row.action) || 'unknown',
        entity_type: str(row.entityType),
        entity_id: str(row.entityId),
        summary: str(row.summary) || '',
        details: str(row.details),
      };
    default:
      return base;
  }
}

export function fromCloudRow(
  table: SyncTableName,
  row: LocalRow,
  maps: RefMaps,
): LocalRow {
  const common = {
    syncId: str(row.sync_id) || newSyncId(),
    createdAt: str(row.created_at) || undefined,
    updatedAt: str(row.updated_at) || undefined,
    deletedAt: undefined,
  };

  switch (table) {
    case 'products':
      return {
        ...common,
        name: str(row.name) || '',
        category: str(row.category) || '',
        price: num(row.price) ?? 0,
        sellingPrice: num(row.selling_price) ?? undefined,
        cost: num(row.cost) ?? undefined,
        stock: num(row.stock) ?? 0,
        reservedStock: num(row.reserved_stock) ?? 0,
        reorderPoint: num(row.reorder_point) ?? undefined,
        sku: str(row.sku) ?? undefined,
        deviceType: str(row.device_type) ?? undefined,
      };
    case 'services':
      return {
        ...common,
        name: str(row.name) || '',
        type: str(row.type) || '',
        price: num(row.price) ?? 0,
        cost: num(row.cost) ?? undefined,
        duration: num(row.duration) ?? undefined,
        category: str(row.category) ?? undefined,
        active: row.active !== false,
      };
    case 'technicians':
      return {
        ...common,
        name: str(row.name) || '',
        email: str(row.email) ?? undefined,
        phone: str(row.phone) ?? undefined,
        role: str(row.role) ?? undefined,
        specialization: str(row.specialization) ?? undefined,
        jobsDone: num(row.jobs_done) ?? undefined,
        totalSales: num(row.total_sales) ?? undefined,
      };
    case 'transactions':
      return {
        ...common,
        customerName: str(row.customer_name) ?? undefined,
        customerPhone: str(row.customer_phone) ?? undefined,
        phoneBrand: str(row.phone_brand) ?? undefined,
        phoneModel: str(row.phone_model) ?? undefined,
        devicePasscode: str(row.device_passcode) ?? undefined,
        customer: str(row.customer) ?? undefined,
        unit: str(row.unit) ?? undefined,
        technicianSyncId: str(row.technician_sync_id) ?? undefined,
        technicianId: row.technician_sync_id
          ? maps.technicianIdBySync.get(String(row.technician_sync_id))
          : undefined,
        technicianName: str(row.technician_name) ?? undefined,
        paymentMethod: str(row.payment_method) ?? undefined,
        status: str(row.status) || 'pending',
        repair_status: str(row.repair_status) ?? undefined,
        trackingToken: str(row.tracking_token) ?? undefined,
        trackingHistory: Array.isArray(row.tracking_history)
          ? row.tracking_history
          : [],
        total: num(row.total) ?? undefined,
        totalAmount: num(row.total_amount) ?? undefined,
        amountPaid: num(row.amount_paid) ?? 0,
        remainingBalance: num(row.remaining_balance) ?? undefined,
        paymentStatus: str(row.payment_status) ?? undefined,
        jobNumber: str(row.job_number) ?? undefined,
        notes: str(row.notes) ?? undefined,
        customerComplaint: str(row.customer_complaint) ?? undefined,
        diagnosis: str(row.diagnosis) ?? undefined,
        technicianNotes: str(row.technician_notes) ?? undefined,
        isPreOrder: row.is_pre_order === true,
        completedAt: str(row.completed_at) ?? undefined,
      };
    case 'transactionItems':
      return {
        ...common,
        transactionSyncId: str(row.transaction_sync_id) ?? undefined,
        transactionId: row.transaction_sync_id
          ? maps.transactionIdBySync.get(String(row.transaction_sync_id)) ?? 0
          : 0,
        refSyncId: str(row.ref_sync_id) ?? undefined,
        type: str(row.type) === 'product' ? 'product' : 'service',
        refId: row.ref_sync_id
          ? (str(row.type) === 'product'
              ? maps.productIdBySync.get(String(row.ref_sync_id))
              : maps.serviceIdBySync.get(String(row.ref_sync_id))) ?? 0
          : 0,
        name: str(row.name) || '',
        quantity: num(row.quantity) ?? 1,
        price: num(row.price) ?? 0,
        subtotal: num(row.subtotal) ?? 0,
        cost: num(row.cost) ?? undefined,
        isPreOrder: row.is_pre_order === true,
        basePrice: num(row.base_price) ?? undefined,
        markupPercentage: num(row.markup_percentage) ?? undefined,
        markupAmount: num(row.markup_amount) ?? undefined,
        isCustom: row.is_custom === true,
        savedToList: row.saved_to_list === true,
        notes: str(row.notes) ?? undefined,
      };
    case 'cashDrawerEntries':
    case 'gcashDrawerEntries':
      return {
        ...common,
        type: str(row.type) || 'adjustment',
        amount: num(row.amount) ?? 0,
        note: str(row.note) ?? undefined,
        notes: str(row.notes) ?? undefined,
      };
    case 'defectiveItems':
      return {
        ...common,
        productSyncId: str(row.product_sync_id) ?? undefined,
        productId: row.product_sync_id
          ? maps.productIdBySync.get(String(row.product_sync_id)) ?? 0
          : 0,
        productName: str(row.product_name) ?? undefined,
        reason: str(row.reason) || '',
        quantity: num(row.quantity) ?? 1,
        costPerUnit: num(row.cost_per_unit) ?? undefined,
        totalLoss: num(row.total_loss) ?? undefined,
      };
    case 'backjobs':
      return {
        ...common,
        customer: str(row.customer) || '',
        phone: str(row.phone) ?? undefined,
        unit: str(row.unit) ?? undefined,
        technicianSyncId: str(row.technician_sync_id) ?? undefined,
        technicianId: row.technician_sync_id
          ? maps.technicianIdBySync.get(String(row.technician_sync_id))
          : undefined,
        technicianName: str(row.technician_name) ?? undefined,
        description: str(row.description) ?? undefined,
        issue: str(row.issue) ?? undefined,
        originalRepairDate: str(row.original_repair_date) ?? undefined,
        cause: str(row.cause) ?? undefined,
        status: str(row.status) || 'pending',
        withinWarranty: bool(row.within_warranty) ?? undefined,
      };
    case 'users':
      return {
        ...common,
        username: str(row.username) || '',
        passwordHash: str(row.password_hash) || '',
        role: str(row.role) === 'admin' ? 'admin' : 'staff',
        permissions: Array.isArray(row.permissions) ? row.permissions : [],
        isActive: row.is_active !== false,
      };
    case 'settings':
      return {
        ...common,
        key: str(row.key) || '',
        value: row.value,
      };
    case 'activityLogs':
      return {
        ...common,
        createdAt: str(row.created_at) || nowISO(),
        username: str(row.username) || 'system',
        userRole: str(row.user_role) ?? undefined,
        userSyncId: str(row.user_sync_id) ?? undefined,
        userId: row.user_sync_id
          ? maps.userIdBySync.get(String(row.user_sync_id))
          : undefined,
        action: str(row.action) || 'unknown',
        entityType: str(row.entity_type) ?? undefined,
        entityId: str(row.entity_id) ?? undefined,
        summary: str(row.summary) || '',
        details: str(row.details) ?? undefined,
      };
    default:
      return common;
  }
}

async function applyRemoteRows(
  tableName: SyncTableName,
  rows: LocalRow[],
  maps: RefMaps,
): Promise<void> {
  if (rows.length === 0) return;
  const table = tableOf(tableName);

  for (const cloudRow of rows) {
    const syncId = str(cloudRow.sync_id);
    if (!syncId) continue;

    const local = await table.where('syncId').equals(syncId).first();
    const remoteUpdated = dateOrNow(cloudRow.updated_at || cloudRow.server_updated_at);

    if (local?.updatedAt && new Date(remoteUpdated).getTime() < new Date(local.updatedAt).getTime()) {
      continue;
    }

    const pending = await localDb.syncOutbox.get(`${tableName}:${syncId}`);
    if (pending && new Date(pending.updatedAt).getTime() > new Date(remoteUpdated).getTime()) {
      continue;
    }

    if (str(cloudRow.deleted_at)) {
      if (local?.id !== undefined) {
        await table.delete(local.id);
        unregisterSyncId(tableName, syncId, maps);
      }
      continue;
    }

    const mapped = fromCloudRow(tableName, cloudRow, maps);
    if (local?.id !== undefined) {
      await table.update(local.id, mapped);
      registerLocalRow(tableName, { ...mapped, id: local.id }, maps);
    } else {
      const id = await table.add(mapped);
      registerLocalRow(tableName, { ...mapped, id }, maps);
    }
  }
}

async function pullTable(
  client: SupabaseClient,
  tableName: SyncTableName,
  since: string,
  maps: RefMaps,
): Promise<void> {
  const cloudTable = CLOUD_TABLE[tableName];
  let offset = 0;

  for (;;) {
    const { data, error } = await client
      .from(cloudTable)
      .select('*')
      .eq('shop_id', SUPABASE_SHOP_ID)
      .gt('server_updated_at', since)
      .order('server_updated_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    await applyRemoteRows(tableName, data as LocalRow[], maps);
    offset += data.length;
    if (data.length < PAGE_SIZE) break;
  }
}

async function resolveOrphans(maps: RefMaps): Promise<void> {
  const items = await localDb.transactionItems.filter((row) => !row.transactionId && !!row.transactionSyncId).toArray();
  for (const item of items) {
    const parentId = item.transactionSyncId ? maps.transactionIdBySync.get(item.transactionSyncId) : undefined;
    const updates: LocalRow = {};
    if (parentId) updates.transactionId = parentId;
    if (!item.refId && item.refSyncId) {
      const refId = item.type === 'product'
        ? maps.productIdBySync.get(item.refSyncId)
        : maps.serviceIdBySync.get(item.refSyncId);
      if (refId) updates.refId = refId;
    }
    if (Object.keys(updates).length > 0) await localDb.transactionItems.update(item.id, updates);
  }

  const defective = await localDb.defectiveItems.filter((row) => !row.productId && !!row.productSyncId).toArray();
  for (const item of defective) {
    const productId = item.productSyncId ? maps.productIdBySync.get(item.productSyncId) : undefined;
    if (productId) await localDb.defectiveItems.update(item.id, { productId });
  }

  const backjobs = await localDb.backjobs.filter((row) => !row.technicianId && !!row.technicianSyncId).toArray();
  for (const item of backjobs) {
    const technicianId = item.technicianSyncId ? maps.technicianIdBySync.get(item.technicianSyncId) : undefined;
    if (technicianId) await localDb.backjobs.update(item.id, { technicianId });
  }

  const logs = await localDb.activityLogs.filter((row) => !row.userId && !!row.userSyncId).toArray();
  for (const item of logs) {
    const userId = item.userSyncId ? maps.userIdBySync.get(item.userSyncId) : undefined;
    if (userId) await localDb.activityLogs.update(item.id, { userId });
  }
}

let pullPromise: Promise<void> | null = null;

/** Pull all tables in dependency order. */
export function pullAll(): Promise<void> {
  if (!isSupabaseConfigured()) return Promise.resolve();
  if (pullPromise) return pullPromise;

  pullPromise = (async () => {
    const client = await getAuthenticatedShopClient();

    const lastPulled = await metaValue(LAST_PULLED_KEY);
    let since = EPOCH;
    if (typeof lastPulled === 'string' && lastPulled) {
      const lastPulledMs = new Date(lastPulled).getTime();
      if (Number.isFinite(lastPulledMs)) {
        // Small overlap absorbs clock skew and rows committed at the same
        // millisecond as the previous pull cursor.
        since = new Date(lastPulledMs - 5_000).toISOString();
      }
    }
    const pullStartedAt = nowISO();
    const maps = await loadRefMaps();

    for (const tableName of PULL_ORDER) {
      await pullTable(client, tableName, since, maps);
    }
    await resolveOrphans(maps);

    await setMeta(LAST_PULLED_KEY, pullStartedAt);
    await setMeta(LAST_SYNC_KEY, nowISO());
  })().finally(() => {
    pullPromise = null;
  });

  return pullPromise;
}

let flushPromise: Promise<void> | null = null;
let flushAgain = false;
let lastFlushAt = 0;

async function removeOutboxIfSame(entry: SyncOutboxEntry): Promise<void> {
  await localDb.transaction('rw', localDb.syncOutbox, async () => {
    const current = await localDb.syncOutbox.get(entry.key);
    if (!current) return;
    if (current.updatedAt === entry.updatedAt) {
      await localDb.syncOutbox.delete(entry.key);
    } else {
      flushAgain = true;
    }
  });
}

async function markOutboxFailure(entry: SyncOutboxEntry, error: unknown): Promise<void> {
  await localDb.transaction('rw', localDb.syncOutbox, async () => {
    const current = await localDb.syncOutbox.get(entry.key);
    if (!current || current.updatedAt !== entry.updatedAt) {
      flushAgain = true;
      return;
    }
    await localDb.syncOutbox.put({
      ...current,
      attempts: current.attempts + 1,
      lastError: supabaseErrorMessage(error).slice(0, 400),
    });
  });
}

export function flushSyncOutbox(force = false): Promise<void> {
  if (flushPromise) return flushPromise;
  if (!isSupabaseConfigured()) return Promise.resolve();
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve();
  if (!force && Date.now() - lastFlushAt < FLUSH_THROTTLE_MS) return Promise.resolve();

  flushPromise = (async () => {
    flushAgain = false;
    const entries = await localDb.syncOutbox.orderBy('updatedAt').toArray();
    if (entries.length === 0) return;

    let client: SupabaseClient;
    try {
      client = await getAuthenticatedShopClient();
    } catch (error) {
      console.warn('[sync] shop authentication failed; changes remain queued.', error);
      return;
    }

    const groups = new Map<SyncTableName, SyncOutboxEntry[]>();
    for (const entry of entries) {
      const group = groups.get(entry.table) || [];
      group.push(entry);
      groups.set(entry.table, group);
    }

    for (const [table, group] of groups) {
      const cloudTable = CLOUD_TABLE[table];

      for (let offset = 0; offset < group.length; offset += 100) {
        const chunk = group.slice(offset, offset + 100);

        let remoteRows: Array<Record<string, unknown>> = [];
        try {
          const { data, error } = await client
            .from(cloudTable)
            .select('sync_id,updated_at,deleted_at')
            .in('sync_id', chunk.map((entry) => entry.syncId));
          if (error) throw error;
          remoteRows = (data || []) as Array<Record<string, unknown>>;
        } catch (error) {
          for (const entry of chunk) await markOutboxFailure(entry, error);
          console.warn(`[sync] could not check ${cloudTable}; changes remain queued.`, supabaseErrorMessage(error));
          continue;
        }

        const remoteById = new Map<string, Record<string, unknown>>();
        for (const row of remoteRows) {
          const id = typeof row.sync_id === 'string' ? row.sync_id : '';
          if (id) remoteById.set(id, row);
        }

        const upload: SyncOutboxEntry[] = [];
        for (const entry of chunk) {
          const remote = remoteById.get(entry.syncId);
          const remoteUpdated = remote?.updated_at ? new Date(String(remote.updated_at)).getTime() : 0;
          const localUpdated = new Date(entry.updatedAt).getTime();
          if (remote && (remoteUpdated > localUpdated || (remote.deleted_at && remoteUpdated >= localUpdated))) {
            // Another device has a newer version (or a newer delete). Drop this
            // local change; the next pull applies the winning remote row.
            await removeOutboxIfSame(entry);
            continue;
          }
          upload.push(entry);
        }

        if (upload.length === 0) continue;

        try {
          const { error } = await client
            .from(cloudTable)
            .upsert(upload.map((entry) => entry.payload), { onConflict: 'sync_id' });

          if (error) {
            for (const entry of upload) await markOutboxFailure(entry, error);
            console.warn(`[sync] upsert ${cloudTable} failed; changes remain queued.`, error.message);
            continue;
          }

          for (const entry of upload) await removeOutboxIfSame(entry);
        } catch (error) {
          for (const entry of upload) await markOutboxFailure(entry, error);
          console.warn(`[sync] upsert ${cloudTable} failed; changes remain queued.`, error);
        }
      }
    }

    await setMeta(LAST_SYNC_KEY, nowISO());
  })()
    .catch((error) => {
      console.warn('[sync] outbox flush failed:', error);
    })
    .finally(() => {
      lastFlushAt = Date.now();
      flushPromise = null;
      if (flushAgain) {
        flushAgain = false;
        void flushSyncOutbox(true);
      }
    });

  return flushPromise;
}

async function enqueueCloudRow(
  table: SyncTableName,
  syncId: string,
  payload: Record<string, unknown>,
  updatedAt: string,
  operation: 'upsert' | 'delete' = 'upsert',
): Promise<void> {
  const key = `${table}:${syncId}`;
  const existing = await localDb.syncOutbox.get(key);
  if (existing && new Date(existing.updatedAt).getTime() > new Date(updatedAt).getTime()) {
    return;
  }
  const existingCreatedAt = existing?.createdAt || nowISO();
  await localDb.syncOutbox.put({
    key,
    table,
    syncId,
    operation,
    payload,
    attempts: existing?.attempts || 0,
    createdAt: existingCreatedAt,
    updatedAt,
  });
}

/** Queue one local record for upload. */
export async function queueSyncRecord(
  table: SyncTableName,
  rowOrId: LocalRow | number,
  opts?: { flush?: boolean; maps?: RefMaps },
): Promise<void> {
  try {
    const tableHandle = tableOf(table);
    const row: LocalRow | undefined =
      typeof rowOrId === 'number' ? await tableHandle.get(rowOrId) : rowOrId;
    if (!row) return;

    let syncId = str(row.syncId);
    if (!syncId) {
      syncId = newSyncId();
      if (row.id !== undefined) await tableHandle.update(row.id, { syncId });
      row.syncId = syncId;
    }

    const maps = opts?.maps || (await loadRefMaps());
    const payload = toCloudRow(table, row, maps);
    await enqueueCloudRow(table, syncId, payload, dateOrNow(row.updatedAt || row.createdAt), 'upsert');
    if (opts?.flush !== false) void flushSyncOutbox(true);
  } catch (error) {
    console.warn(`[sync] could not queue ${table}:`, error);
  }
}

/** Queue a tombstone for a row that is about to be hard-deleted locally. */
export async function queueSyncDelete(
  table: SyncTableName,
  rowOrId: LocalRow | number,
  opts?: { flush?: boolean; maps?: RefMaps },
): Promise<void> {
  try {
    const tableHandle = tableOf(table);
    const row: LocalRow | undefined =
      typeof rowOrId === 'number' ? await tableHandle.get(rowOrId) : rowOrId;
    if (!row) return;

    let syncId = str(row.syncId);
    if (!syncId) {
      syncId = newSyncId();
      if (row.id !== undefined) await tableHandle.update(row.id, { syncId });
      row.syncId = syncId;
    }

    const maps = opts?.maps || (await loadRefMaps());
    const deletedAt = nowISO();
    const payload = toCloudRow(table, { ...row, updatedAt: deletedAt, deletedAt }, maps);
    payload.deleted_at = deletedAt;
    payload.updated_at = deletedAt;
    await enqueueCloudRow(table, syncId, payload, deletedAt, 'delete');
    if (opts?.flush !== false) void flushSyncOutbox(true);
  } catch (error) {
    console.warn(`[sync] could not queue delete for ${table}:`, error);
  }
}

/** Delete locally and queue the cloud tombstone in one helper. */
export async function deleteLocalAndQueue(
  table: SyncTableName,
  id: number,
  opts?: { flush?: boolean; maps?: RefMaps },
): Promise<void> {
  const row = await tableOf(table).get(id);
  if (row) await queueSyncDelete(table, row, opts);
  await tableOf(table).delete(id);
}

/**
 * Queue a transaction plus all of its current line items. Existing job code
 * calls this after every lifecycle write, so status updates and line changes
 * stay in one place.
 */
export async function queueTransactionSync(
  transactionId: number,
  opts?: { flush?: boolean },
): Promise<void> {
  try {
    const flush = opts?.flush !== false;
    const tx = await localDb.transactions.get(transactionId);
    if (!tx) return;
    const maps = await loadRefMaps();
    await queueSyncRecord('transactions', tx, { flush: false, maps });
    const items = await localDb.transactionItems.where('transactionId').equals(transactionId).toArray();
    for (const item of items) {
      await queueSyncRecord('transactionItems', item, { flush: false, maps });
    }
    if (flush) void flushSyncOutbox(true);
  } catch (error) {
    console.warn('[sync] could not queue transaction:', error);
  }
}

/** Queue deleted child rows (e.g. line items replaced by an edit). */
export async function queueDeletedRows(
  table: SyncTableName,
  rows: LocalRow[],
  opts?: { flush?: boolean },
): Promise<void> {
  if (rows.length === 0) return;
  const flush = opts?.flush !== false;
  const maps = await loadRefMaps();
  for (const row of rows) {
    await queueSyncDelete(table, row, { flush: false, maps });
  }
  if (flush) void flushSyncOutbox(true);
}

/** Upload every local record once (used for existing-data migration). */
export async function queueAllLocalRecords(): Promise<void> {
  const maps = await loadRefMaps();
  for (const table of SYNC_TABLE_NAMES) {
    const rows = await tableOf(table).toArray();
    for (const row of rows) {
      await queueSyncRecord(table, row, { flush: false, maps });
    }
  }
  await setMeta(NEEDS_INITIAL_UPLOAD_KEY, false);
  void flushSyncOutbox(true);
}

/**
 * Before first-run demo seeding, pull an existing cloud database into a fresh
 * local device so demo data is not uploaded on top of the real catalog.
 */
export async function prepareLocalFromCloud(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  try {
    const localCount =
      (await localDb.products.count()) +
      (await localDb.services.count()) +
      (await localDb.transactions.count());
    if (localCount > 0) return;
    if ((await localDb.syncOutbox.count()) > 0) return;

    // This device is attached to an existing cloud shop. Never seed demo data
    // on it, even if the first pull is slow or temporarily fails.
    await setMeta('sync.cloudPrepared', true);

    // Do not block the login screen indefinitely on a slow/offline network.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      pullAll(),
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Initial cloud pull timed out')), 8_000);
      }),
    ]);
    if (timer) clearTimeout(timer);
  } catch (error) {
    console.warn('[sync] initial cloud pull failed; starting with local data.', error);
  }
}

let syncStarted = false;
let syncPromise: Promise<void> | null = null;
let syncAgain = false;

async function runSync(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (syncPromise) {
    syncAgain = true;
    return syncPromise;
  }

  syncPromise = (async () => {
    try {
      await getDeviceId();
      const needsInitial = await metaValue(NEEDS_INITIAL_UPLOAD_KEY);
      if (needsInitial === true) {
        await queueAllLocalRecords();
      }
      await flushSyncOutbox(true);
      await pullAll();
      await setMeta(LAST_SYNC_KEY, nowISO());
    } catch (error) {
      console.warn('[sync] sync pass failed:', error);
    }
  })();

  await syncPromise;
  syncPromise = null;
  if (syncAgain) {
    syncAgain = false;
    void runSync();
  }
}

/** Start background sync after login. Safe to call more than once. */
export function startFullSync(): void {
  if (syncStarted || typeof window === 'undefined') return;
  syncStarted = true;

  const retry = () => {
    void runSync();
  };

  window.addEventListener('online', () => {
    void runSync();
  });
  window.addEventListener('focus', retry);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retry();
  });
  window.setInterval(retry, 60_000);

  void runSync();
}

/** Manual sync trigger for a settings button / diagnostics. */
export function syncNow(): Promise<void> {
  return runSync();
}

export async function getSyncStatus(): Promise<{
  configured: boolean;
  online: boolean;
  pending: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}> {
  const [pending, lastSyncedAt, lastErrorRow] = await Promise.all([
    localDb.syncOutbox.count(),
    metaValue(LAST_SYNC_KEY),
    localDb.syncOutbox.orderBy('updatedAt').reverse().first(),
  ]);
  return {
    configured: isSupabaseConfigured(),
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pending,
    lastSyncedAt: typeof lastSyncedAt === 'string' ? lastSyncedAt : null,
    lastError: lastErrorRow?.lastError || null,
  };
}
