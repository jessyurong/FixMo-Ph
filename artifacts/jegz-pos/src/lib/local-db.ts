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
  Technician,
  Transaction,
  TransactionItem,
} from './db-types';

export type LocalRecord = { id?: number; createdAt?: string; updatedAt?: string; [key: string]: unknown };

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
  }
}

export const localDb = new JegzLocalDB();
export const LOCAL_TABLES = [
  'products','services','technicians','transactions','transactionItems',
  'cashDrawerEntries','gcashDrawerEntries','defectiveItems','backjobs','users','settings','meta','activityLogs'
] as const;