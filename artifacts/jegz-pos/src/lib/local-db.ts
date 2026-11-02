import Dexie, { type EntityTable } from 'dexie';
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
  SyncOutboxEntry,
  Technician,
  TrackingOutboxEntry,
  Transaction,
  TransactionItem,
} from './db-types';
import { SYNC_TABLE_NAMES } from './db-types';
import { generateTrackingToken } from './tracking-token';
import { newSyncId } from './sync-id';

export type LocalRecord = {
  id?: number;
  syncId?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  [key: string]: unknown;
};

class JegzLocalDB extends Dexie {
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
  trackingOutbox!: EntityTable<TrackingOutboxEntry, 'token'>;
  syncOutbox!: EntityTable<SyncOutboxEntry, 'key'>;

  constructor() {
    super('JEGZ_POS_OFFLINE_DB');
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
    this.version(5)
      .stores({
        products: '++id,name,category,deviceType,stock,createdAt',
        services: '++id,name,type',
        technicians: '++id,name',
        transactions:
          '++id,customerName,customerPhone,phoneBrand,phoneModel,jobNumber,technicianId,paymentMethod,status,trackingToken,createdAt,customer,unit',
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
      })
      .upgrade(async (tx) => {
        await tx.table('transactions').toCollection().modify((row: Record<string, unknown>) => {
          if (typeof row.trackingToken !== 'string' || row.trackingToken.trim().length < 12) {
            row.trackingToken = generateTrackingToken();
          }
        });
      });

    // v6: full local-first sync metadata. Existing records get stable UUIDs and
    // an updatedAt so the first cloud upload has deterministic timestamps.
    this.version(6)
      .stores({
        products: '++id,syncId,name,category,deviceType,stock,createdAt,updatedAt',
        services: '++id,syncId,name,type,updatedAt',
        technicians: '++id,syncId,name,updatedAt',
        transactions:
          '++id,syncId,customerName,customerPhone,phoneBrand,phoneModel,jobNumber,technicianId,technicianSyncId,paymentMethod,status,trackingToken,createdAt,updatedAt,customer,unit',
        transactionItems:
          '++id,syncId,transactionId,transactionSyncId,refSyncId,type,refId,isPreOrder,updatedAt',
        cashDrawerEntries: '++id,syncId,type,createdAt,updatedAt',
        gcashDrawerEntries: '++id,syncId,type,createdAt,updatedAt',
        defectiveItems: '++id,syncId,productId,productSyncId,createdAt,updatedAt',
        backjobs: '++id,syncId,customer,technicianId,technicianSyncId,status,createdAt,updatedAt',
        users: '++id,syncId,username,role,isActive,createdAt,updatedAt',
        settings: '++id,syncId,key,updatedAt',
        meta: 'key',
        activityLogs: '++id,syncId,createdAt,updatedAt,username,action',
        trackingOutbox: 'token,updatedAt',
        syncOutbox: 'key,table,syncId,updatedAt',
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();
        const stamp = (row: Record<string, unknown>) => {
          if (typeof row.syncId !== 'string' || !row.syncId) row.syncId = newSyncId();
          if (typeof row.updatedAt !== 'string' || !row.updatedAt) {
            row.updatedAt = typeof row.createdAt === 'string' ? row.createdAt : now;
          }
        };

        const tableNames = [
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
        ];
        for (const name of tableNames) {
          await tx.table(name).toCollection().modify((row: Record<string, unknown>) => stamp(row));
        }

        const [products, services, technicians, transactions, users] = await Promise.all([
          tx.table('products').toArray(),
          tx.table('services').toArray(),
          tx.table('technicians').toArray(),
          tx.table('transactions').toArray(),
          tx.table('users').toArray(),
        ]);
        const productSync = new Map(products.map((row) => [row.id, row.syncId]));
        const serviceSync = new Map(services.map((row) => [row.id, row.syncId]));
        const technicianSync = new Map(technicians.map((row) => [row.id, row.syncId]));
        const transactionSync = new Map(transactions.map((row) => [row.id, row.syncId]));
        const userSync = new Map(users.map((row) => [row.id, row.syncId]));

        await tx.table('transactions').toCollection().modify((row: Record<string, unknown>) => {
          if (!row.technicianSyncId && row.technicianId) {
            row.technicianSyncId = technicianSync.get(row.technicianId);
          }
        });
        await tx.table('transactionItems').toCollection().modify((row: Record<string, unknown>) => {
          if (!row.transactionSyncId && row.transactionId) {
            row.transactionSyncId = transactionSync.get(row.transactionId);
          }
          if (!row.refSyncId && row.refId) {
            row.refSyncId = row.type === 'product'
              ? productSync.get(row.refId)
              : serviceSync.get(row.refId);
          }
        });
        await tx.table('defectiveItems').toCollection().modify((row: Record<string, unknown>) => {
          if (!row.productSyncId && row.productId) {
            row.productSyncId = productSync.get(row.productId);
          }
        });
        await tx.table('backjobs').toCollection().modify((row: Record<string, unknown>) => {
          if (!row.technicianSyncId && row.technicianId) {
            row.technicianSyncId = technicianSync.get(row.technicianId);
          }
        });
        await tx.table('activityLogs').toCollection().modify((row: Record<string, unknown>) => {
          if (!row.userSyncId && row.userId) {
            row.userSyncId = userSync.get(row.userId);
          }
        });

        let hasAnyData = false;
        for (const name of tableNames) {
          if ((await tx.table(name).count()) > 0) {
            hasAnyData = true;
            break;
          }
        }
        if (hasAnyData) {
          await tx.table('meta').put({
            key: 'sync.needsInitialUpload',
            value: true,
            updatedAt: now,
          });
        }
      });

    // Stamp sync metadata on every new local record, and keep updatedAt fresh
    // for direct page-level writes that bypass the service layer.
    for (const name of SYNC_TABLE_NAMES) {
      const table = (this as any).table(name);
      table.hook('creating', (_primKey: unknown, obj: Record<string, unknown>) => {
        if (typeof obj.syncId !== 'string' || !obj.syncId) obj.syncId = newSyncId();
        if (typeof obj.updatedAt !== 'string' || !obj.updatedAt) {
          obj.updatedAt = typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString();
        }
      });
      table.hook('updating', (mods: Record<string, unknown>) => {
        if (typeof mods.updatedAt === 'string' && mods.updatedAt) return mods;
        return { ...mods, updatedAt: new Date().toISOString() };
      });
    }
  }
}

export const localDb = new JegzLocalDB();
export const LOCAL_TABLES = [
  'products','services','technicians','transactions','transactionItems',
  'cashDrawerEntries','gcashDrawerEntries','defectiveItems','backjobs','users','settings','meta','activityLogs'
] as const;