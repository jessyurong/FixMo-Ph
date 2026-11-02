import { pgTable, text, serial, integer, numeric, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Enums ─────────────────────────────────────────────────────────────────────
export const deviceTypeEnum = pgEnum("device_type", ["android", "iphone", "both"]);
export const serviceTypeEnum = pgEnum("service_type", ["android", "iphone"]);
export const paymentMethodEnum = pgEnum("payment_method", ["cash", "gcash"]);
export const txItemTypeEnum = pgEnum("tx_item_type", ["product", "service"]);
export const cashDrawerEntryTypeEnum = pgEnum("cash_drawer_entry_type", ["sale", "deposit", "withdraw"]);
export const gcashDrawerEntryTypeEnum = pgEnum("gcash_drawer_entry_type", ["sale", "deposit", "withdraw"]);
export const backjobStatusEnum = pgEnum("backjob_status", ["pending", "in_progress", "done"]);
export const backjobCauseEnum = pgEnum("backjob_cause", ["warranty", "human_error"]);
export const transactionStatusEnum = pgEnum("transaction_status", ["pending", "ready", "complete"]);
export const userRoleEnum = pgEnum("user_role", ["admin", "staff"]);

// ── Users ─────────────────────────────────────────────────────────────────────
export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("staff"),
  permissions: text("permissions").array().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;

// ── Application Settings ─────────────────────────────────────────────────────
// One shared row stores the small set of business rules/configuration used by
// the POS. The API keeps this row at id 1.
export const settingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  storeName: text("store_name").notNull().default("JEGZ Mobile Repair"),
  storeAddress: text("store_address").notNull().default(""),
  contactNumber: text("contact_number").notNull().default(""),
  receiptFooter: text("receipt_footer").notNull().default("Thank you for trusting JEGZ Mobile Repair!"),
  warrantyNote: text("warranty_note").notNull().default("Warranty does not cover physical or liquid damage."),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
  cashEnabled: boolean("cash_enabled").notNull().default(true),
  gcashEnabled: boolean("gcash_enabled").notNull().default(true),
  gcashAccountName: text("gcash_account_name").notNull().default(""),
  gcashAccountNumber: text("gcash_account_number").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Settings = typeof settingsTable.$inferSelect;

// ── Products ──────────────────────────────────────────────────────────────────
export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default(""),
  deviceType: deviceTypeEnum("device_type").notNull().default("both"),
  cost: numeric("cost", { precision: 10, scale: 2 }).notNull().default("0"),
  sellingPrice: numeric("selling_price", { precision: 10, scale: 2 }).notNull().default("0"),
  stock: integer("stock").notNull().default(0),
  reorderPoint: integer("reorder_point").notNull().default(5),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;

// ── Services ──────────────────────────────────────────────────────────────────
export const servicesTable = pgTable("services", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: serviceTypeEnum("type").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
});

export const insertServiceSchema = createInsertSchema(servicesTable).omit({ id: true });
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof servicesTable.$inferSelect;

// ── Technicians ───────────────────────────────────────────────────────────────
export const techniciansTable = pgTable("technicians", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().default("Technician"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTechnicianSchema = createInsertSchema(techniciansTable).omit({ id: true, createdAt: true });
export type InsertTechnician = z.infer<typeof insertTechnicianSchema>;
export type Technician = typeof techniciansTable.$inferSelect;

// ── Transactions ──────────────────────────────────────────────────────────────
export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  customer: text("customer").notNull(),
  unit: text("unit").notNull(),
  technicianId: integer("technician_id").notNull(),
  paymentMethod: paymentMethodEnum("payment_method"),
  cashReceived: numeric("cash_received", { precision: 10, scale: 2 }).notNull().default("0"),
  laborDiscount: boolean("labor_discount").notNull().default(false),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  shippingFee: numeric("shipping_fee", { precision: 10, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 10, scale: 2 }).notNull().default("0"),
  profit: numeric("profit", { precision: 10, scale: 2 }).notNull().default("0"),
  status: transactionStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Transaction = typeof transactionsTable.$inferSelect;

// ── Transaction Items ─────────────────────────────────────────────────────────
export const transactionItemsTable = pgTable("transaction_items", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").notNull(),
  type: txItemTypeEnum("type").notNull(),
  refId: integer("ref_id"),
  name: text("name").notNull(),
  qty: integer("qty").notNull().default(1),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
  cost: numeric("cost", { precision: 10, scale: 2 }).notNull().default("0"),
  isPreOrder: boolean("is_pre_order").notNull().default(false),
});

export type TransactionItem = typeof transactionItemsTable.$inferSelect;

// ── Cash Drawer ───────────────────────────────────────────────────────────────
export const cashDrawerEntriesTable = pgTable("cash_drawer_entries", {
  id: serial("id").primaryKey(),
  type: cashDrawerEntryTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  note: text("note"),
  runningBalance: numeric("running_balance", { precision: 10, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CashDrawerEntry = typeof cashDrawerEntriesTable.$inferSelect;

// ── GCash Drawer ──────────────────────────────────────────────────────────────
export const gcashDrawerEntriesTable = pgTable("gcash_drawer_entries", {
  id: serial("id").primaryKey(),
  type: gcashDrawerEntryTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  note: text("note"),
  runningBalance: numeric("running_balance", { precision: 10, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GcashDrawerEntry = typeof gcashDrawerEntriesTable.$inferSelect;

// ── Defective Items ───────────────────────────────────────────────────────────
export const defectiveItemsTable = pgTable("defective_items", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DefectiveItem = typeof defectiveItemsTable.$inferSelect;

// ── Backjobs ──────────────────────────────────────────────────────────────────
export const backjobsTable = pgTable("backjobs", {
  id: serial("id").primaryKey(),
  customer: text("customer").notNull(),
  unit: text("unit").notNull(),
  technicianId: integer("technician_id").notNull(),
  issue: text("issue").notNull(),
  originalRepairDate: text("original_repair_date").notNull(),
  cause: backjobCauseEnum("cause").notNull(),
  status: backjobStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Backjob = typeof backjobsTable.$inferSelect;
