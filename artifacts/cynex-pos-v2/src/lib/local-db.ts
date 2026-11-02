import Dexie, { type EntityTable } from 'dexie';
import { normalizeTransactionStatus } from './db-types';
import type {
  ActivityLog,
  AppUser,
  Backjob,
  CashDrawerEntry,
  DefectiveItem,
  GcashDrawerEntry,
  MetaRecord,
  Product,
  Service,
  Settings,
  Technician,
  TrackingOutboxEntry,
  Transaction,
  TransactionItem,
  TransactionStatusEvent,
} from './db-types';
import type { NotificationOutboxEntry } from './notification-types';
import { generateTrackingToken } from './tracking-token';

export type LocalRecord = { id?: number; createdAt?: string; updatedAt?: string; [key: string]: unknown };

class CynexLocalDB extends Dexie {
  products!: EntityTable<Product, 'id'>;
  services!: EntityTable<Service, 'id'>;
  technicians!: EntityTable<Technician, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  transactionItems!: EntityTable<TransactionItem, 'id'>;
  cashDrawerEntries!: EntityTable<CashDrawerEntry, 'id'>;
  gcashDrawerEntries!: EntityTable<GcashDrawerEntry, 'id'>;
  defectiveItems!: EntityTable<DefectiveItem, 'id'>;
  backjobs!: EntityTable<Backjob, 'id'>;
  users!: EntityTable<AppUser, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  meta!: EntityTable<MetaRecord, 'key'>;
  activityLogs!: EntityTable<ActivityLog, 'id'>;
  /** Offline queue for the public Supabase tracking mirror (never backed up). */
  trackingOutbox!: EntityTable<TrackingOutboxEntry, 'token'>;
  /** Durable customer notification queue + dedupe log (never backed up). */
  notificationOutbox!: EntityTable<NotificationOutboxEntry, 'dedupeKey'>;

  constructor() {
    super('CYNEX_TECH_DB');
    this.version(1).stores({
      products: '++id,name,category,deviceType,stock,createdAt',
      services: '++id,name,type',
      technicians: '++id,name',
      transactions: '++id,customer,unit,technicianId,paymentMethod,status,createdAt',
      transactionItems: '++id,transactionId,type,refId',
      cashDrawerEntries: '++id,type,createdAt',
      gcashDrawerEntries: '++id,type,createdAt',
      defectiveItems: '++id,productId,createdAt',
      backjobs: '++id,customer,technicianId,status,createdAt',
      users: '++id,username,role,isActive,createdAt',
      settings: '++id,key',
      meta: 'key'
    });
    this.version(4).stores({
      products: '++id,name,category,deviceType,stock,createdAt',
      services: '++id,name,type',
      technicians: '++id,name',
      transactions:
        '++id,customerName,customerPhone,phoneBrand,phoneModel,jobNumber,technicianId,paymentMethod,status,createdAt,customer,unit',
      transactionItems: '++id,transactionId,type,refId,isPreOrder',
      cashDrawerEntries: '++id,type,createdAt',
      gcashDrawerEntries: '++id,type,createdAt',
      defectiveItems: '++id,productId,createdAt',
      backjobs: '++id,customer,technicianId,status,createdAt',
      users: '++id,username,role,isActive,createdAt',
      settings: '++id,key',
      meta: 'key',
      activityLogs: '++id,createdAt,username,action'
    });
    this.version(2).stores({
      products: '++id,name,category,deviceType,stock,createdAt',
      services: '++id,name,type',
      technicians: '++id,name',
      transactions: '++id,customer,unit,technicianId,paymentMethod,status,createdAt',
      transactionItems: '++id,transactionId,type,refId',
      cashDrawerEntries: '++id,type,createdAt',
      gcashDrawerEntries: '++id,type,createdAt',
      defectiveItems: '++id,productId,createdAt',
      backjobs: '++id,customer,technicianId,status,createdAt',
      users: '++id,username,role,isActive,createdAt',
      settings: '++id,key',
      meta: 'key'
    });
    this.version(3).stores({
      products: '++id,name,category,deviceType,stock,createdAt',
      services: '++id,name,type',
      technicians: '++id,name',
      transactions:
        '++id,customerName,customerPhone,phoneBrand,phoneModel,jobNumber,technicianId,paymentMethod,status,createdAt,customer,unit',
      transactionItems: '++id,transactionId,type,refId,isPreOrder',
      cashDrawerEntries: '++id,type,createdAt',
      gcashDrawerEntries: '++id,type,createdAt',
      defectiveItems: '++id,productId,createdAt',
      backjobs: '++id,customer,technicianId,status,createdAt',
      users: '++id,username,role,isActive,createdAt',
      settings: '++id,key',
      meta: 'key'
    });
    // v5: Cynex technician flow — per-branch isolation + serial/warranty lookup.
    // Adds branch, serialNo, unitType/unitModel indexes (schemaless fields, safe upgrade).
    this.version(5).stores({
      products: '++id,name,category,deviceType,stock,createdAt',
      services: '++id,name,type',
      technicians: '++id,name',
      transactions:
        '++id,customerName,customerPhone,phoneBrand,phoneModel,jobNumber,technicianId,paymentMethod,status,createdAt,customer,unit,branch,serialNo,unitType,unitModel',
      transactionItems: '++id,transactionId,type,refId,isPreOrder',
      cashDrawerEntries: '++id,type,createdAt',
      gcashDrawerEntries: '++id,type,createdAt',
      defectiveItems: '++id,productId,createdAt',
      backjobs: '++id,customer,technicianId,status,createdAt',
      users: '++id,username,role,isActive,createdAt',
      settings: '++id,key',
      meta: 'key',
      activityLogs: '++id,createdAt,username,action'
    });
    // v6: customer email + status workflow/history + public tracking token.
    // The upgrade normalizes existing statuses, preserves every old record, and
    // backfills a tracking token and initial status-history entry.
    this.version(6).stores({
      products: '++id,name,category,deviceType,stock,createdAt',
      services: '++id,name,type',
      technicians: '++id,name',
      transactions:
        '++id,customerName,customerPhone,customerEmail,phoneBrand,phoneModel,jobNumber,technicianId,paymentMethod,status,trackingToken,createdAt,customer,unit,branch,serialNo,unitType,unitModel',
      transactionItems: '++id,transactionId,type,refId,isPreOrder',
      cashDrawerEntries: '++id,type,createdAt',
      gcashDrawerEntries: '++id,type,createdAt',
      defectiveItems: '++id,productId,createdAt',
      backjobs: '++id,customer,technicianId,status,createdAt',
      users: '++id,username,role,isActive,createdAt',
      settings: '++id,key',
      meta: 'key',
      activityLogs: '++id,createdAt,username,action'
    }).upgrade(async (tx) => {
      await tx.table('transactions').toCollection().modify((row: any) => {
        const fallbackTimestamp =
          typeof row.createdAt === 'string' && row.createdAt
            ? row.createdAt
            : typeof row.updatedAt === 'string' && row.updatedAt
              ? row.updatedAt
              : new Date().toISOString();
        const status = normalizeTransactionStatus(row.status);

        const rawHistory: unknown[] = Array.isArray(row.statusHistory) ? row.statusHistory : [];
        const statusHistory: TransactionStatusEvent[] = rawHistory
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
          .map((entry) => {
            const note = typeof entry.note === 'string' ? entry.note.trim() : '';
            return {
              status: normalizeTransactionStatus(entry.status),
              timestamp:
                typeof entry.timestamp === 'string' && entry.timestamp
                  ? entry.timestamp
                  : fallbackTimestamp,
              ...(note ? { note } : {}),
            };
          });

        if (statusHistory.length === 0) {
          statusHistory.push({ status, timestamp: fallbackTimestamp });
        } else if (statusHistory[statusHistory.length - 1].status !== status) {
          statusHistory.push({
            status,
            timestamp:
              typeof row.updatedAt === 'string' && row.updatedAt
                ? row.updatedAt
                : fallbackTimestamp,
          });
        }

        row.status = status;
        row.statusHistory = statusHistory;
        row.customerEmail =
          typeof row.customerEmail === 'string' && row.customerEmail.trim()
            ? row.customerEmail.trim()
            : undefined;
        if (typeof row.trackingToken !== 'string' || row.trackingToken.trim().length < 12) {
          row.trackingToken = generateTrackingToken();
        }
      });
    });
    // v7: offline outbox for the public live-tracking mirror.
    // This only adds a table; all existing business data is left untouched.
    this.version(7).stores({
      products: '++id,name,category,deviceType,stock,createdAt',
      services: '++id,name,type',
      technicians: '++id,name',
      transactions:
        '++id,customerName,customerPhone,customerEmail,phoneBrand,phoneModel,jobNumber,technicianId,paymentMethod,status,trackingToken,createdAt,customer,unit,branch,serialNo,unitType,unitModel',
      transactionItems: '++id,transactionId,type,refId,isPreOrder',
      cashDrawerEntries: '++id,type,createdAt',
      gcashDrawerEntries: '++id,type,createdAt',
      defectiveItems: '++id,productId,createdAt',
      backjobs: '++id,customer,technicianId,status,createdAt',
      users: '++id,username,role,isActive,createdAt',
      settings: '++id,key',
      meta: 'key',
      activityLogs: '++id,createdAt,username,action',
      trackingOutbox: 'token,updatedAt'
    });
    // v8: durable customer notification outbox.
    // It adds one table only; all business tables and existing data are kept.
    this.version(8).stores({
      products: '++id,name,category,deviceType,stock,createdAt',
      services: '++id,name,type',
      technicians: '++id,name',
      transactions:
        '++id,customerName,customerPhone,customerEmail,phoneBrand,phoneModel,jobNumber,technicianId,paymentMethod,status,trackingToken,createdAt,customer,unit,branch,serialNo,unitType,unitModel',
      transactionItems: '++id,transactionId,type,refId,isPreOrder',
      cashDrawerEntries: '++id,type,createdAt',
      gcashDrawerEntries: '++id,type,createdAt',
      defectiveItems: '++id,productId,createdAt',
      backjobs: '++id,customer,technicianId,status,createdAt',
      users: '++id,username,role,isActive,createdAt',
      settings: '++id,key',
      meta: 'key',
      activityLogs: '++id,createdAt,username,action',
      trackingOutbox: 'token,updatedAt',
      notificationOutbox: 'dedupeKey,transactionId,state,updatedAt'
    });
  }
}

export const localDb = new CynexLocalDB();
export const LOCAL_TABLES = [
  'products','services','technicians','transactions','transactionItems',
  'cashDrawerEntries','gcashDrawerEntries','defectiveItems','backjobs','users','settings','meta','activityLogs'
] as const;