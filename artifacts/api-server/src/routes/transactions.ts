import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import {
  db,
  transactionsTable,
  transactionItemsTable,
  techniciansTable,
  productsTable,
  cashDrawerEntriesTable,
  gcashDrawerEntriesTable,
} from "@workspace/db";
import {
  ListTransactionsResponse,
  ListTransactionsQueryParams,
  CreateTransactionBody,
  GetTransactionStatsQueryParams,
  GetTransactionStatsResponse,
  UpdateTransactionStatusParams,
  UpdateTransactionStatusBody,
  UpdateTransactionStatusResponse,
  DeleteTransactionParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function periodStart(period?: string | null): Date | null {
  const now = new Date();
  if (period === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}

async function fetchTransactions(period?: string | null, search?: string | null, status?: string | null) {
  const start = periodStart(period);
  let rows = await db.select().from(transactionsTable).orderBy(desc(transactionsTable.createdAt));

  if (start) rows = rows.filter((r) => r.createdAt >= start);
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter((r) => r.customer.toLowerCase().includes(s) || r.unit.toLowerCase().includes(s));
  }
  if (status) {
    rows = rows.filter((r) => r.status === status);
  }
  return rows;
}

async function buildTxOutput(rows: (typeof transactionsTable.$inferSelect)[], techMap: Map<number, string>) {
  if (!rows.length) return [];
  const txIds = rows.map((r) => r.id);
  const allItems = await db
    .select()
    .from(transactionItemsTable)
    .where(sql`${transactionItemsTable.transactionId} = ANY(${sql.raw(`ARRAY[${txIds.join(",")}]`)})`)
    .orderBy(transactionItemsTable.id);

  const itemsByTx = new Map<number, typeof allItems>();
  for (const item of allItems) {
    if (!itemsByTx.has(item.transactionId)) itemsByTx.set(item.transactionId, []);
    itemsByTx.get(item.transactionId)!.push(item);
  }

  return rows.map((tx) => {
    const items = itemsByTx.get(tx.id) ?? [];
    const hasPreOrder = items.some((i) => i.isPreOrder);
    return {
      id: tx.id,
      customer: tx.customer,
      unit: tx.unit,
      technicianName: techMap.get(tx.technicianId) ?? "Unknown",
      paymentMethod: tx.paymentMethod ?? null,
      total: Number(tx.total),
      profit: Number(tx.profit),
      status: tx.status,
      hasPreOrder,
      createdAt: tx.createdAt.toISOString(),
      items: items.map((i) => ({
        type: i.type,
        refId: i.refId ?? null,
        name: i.name,
        qty: i.qty,
        price: Number(i.price),
        isPreOrder: i.isPreOrder,
      })),
    };
  });
}

router.get("/transactions", async (req, res): Promise<void> => {
  const query = ListTransactionsQueryParams.safeParse(req.query);
  const period = query.success ? query.data.period : undefined;
  const search = query.success ? query.data.search : undefined;
  const status = query.success ? query.data.status : undefined;

  const rows = await fetchTransactions(period, search, status);
  if (!rows.length) { res.json([]); return; }

  const techs = await db.select().from(techniciansTable);
  const techMap = new Map(techs.map((t) => [t.id, t.name]));

  const result = await buildTxOutput(rows, techMap);
  res.json(ListTransactionsResponse.parse(result));
});

router.get("/transactions/stats", async (req, res): Promise<void> => {
  const query = GetTransactionStatsQueryParams.safeParse(req.query);
  const period = query.success ? query.data.period : undefined;

  const rows = await fetchTransactions(period, null, "complete");
  if (!rows.length) {
    res.json(GetTransactionStatsResponse.parse({
      totalSales: 0, totalProfit: 0, count: 0, cashCount: 0, gcashCount: 0,
      avgPerTransaction: 0, topModels: [], topServices: [], topProducts: [],
    }));
    return;
  }

  const txIds = rows.map((r) => r.id);
  const allItems = await db
    .select()
    .from(transactionItemsTable)
    .where(sql`${transactionItemsTable.transactionId} = ANY(${sql.raw(`ARRAY[${txIds.join(",")}]`)})`)
    .orderBy(transactionItemsTable.id);

  const totalSales = rows.reduce((a, r) => a + Number(r.total), 0);
  const totalProfit = rows.reduce((a, r) => a + Number(r.profit), 0);
  const cashCount = rows.filter((r) => r.paymentMethod === "cash").length;
  const gcashCount = rows.filter((r) => r.paymentMethod === "gcash").length;

  const unitCounts = new Map<string, number>();
  for (const tx of rows) unitCounts.set(tx.unit, (unitCounts.get(tx.unit) ?? 0) + 1);
  const topModels = [...unitCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));

  const serviceCounts = new Map<string, number>();
  const productCounts = new Map<string, number>();
  for (const item of allItems) {
    if (item.type === "service") serviceCounts.set(item.name, (serviceCounts.get(item.name) ?? 0) + item.qty);
    else productCounts.set(item.name, (productCounts.get(item.name) ?? 0) + item.qty);
  }

  res.json(GetTransactionStatsResponse.parse({
    totalSales, totalProfit, count: rows.length, cashCount, gcashCount,
    avgPerTransaction: rows.length ? totalSales / rows.length : 0,
    topModels,
    topServices: [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
    topProducts: [...productCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
  }));
});

router.post("/transactions", async (req, res): Promise<void> => {
  const parsed = CreateTransactionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { customer, unit, technicianId, paymentMethod, items, cashReceived, laborDiscount } = parsed.data;

  let subtotal = 0;
  let totalCost = 0;
  for (const item of items) {
    subtotal += item.price * item.qty;
    totalCost += (item.cost ?? 0) * item.qty;
  }

  let discountAmount = 0;
  if (laborDiscount) {
    const laborTotal = items.filter((i) => i.type === "service").reduce((a, i) => a + i.price * i.qty, 0);
    discountAmount = laborTotal * 0.2;
  }

  const total = subtotal - discountAmount;
  const profit = total - totalCost;

  const [tx] = await db.insert(transactionsTable).values({
    customer, unit, technicianId,
    paymentMethod: (paymentMethod as "cash" | "gcash" | undefined) ?? undefined,
    cashReceived: String(cashReceived ?? total),
    laborDiscount: laborDiscount ?? false,
    subtotal: String(subtotal),
    discountAmount: String(discountAmount),
    shippingFee: "0",
    total: String(total),
    profit: String(profit),
    status: "pending",
  }).returning();

  for (const item of items) {
    await db.insert(transactionItemsTable).values({
      transactionId: tx.id,
      type: item.type as "product" | "service",
      refId: item.refId ?? null,
      name: item.name,
      qty: item.qty,
      price: String(item.price),
      cost: String(item.cost ?? 0),
      isPreOrder: item.isPreOrder,
    });

    if (item.type === "product" && item.refId && !item.isPreOrder) {
      const [product] = await db.select().from(productsTable).where(eq(productsTable.id, item.refId));
      if (product) {
        await db.update(productsTable)
          .set({ stock: Math.max(0, product.stock - item.qty) })
          .where(eq(productsTable.id, item.refId));
      }
    }
  }

  res.status(201).json({ id: tx.id });
});

// PATCH /transactions/:id — update status (pending → ready → complete)
router.patch("/transactions/:id/status", async (req, res): Promise<void> => {
  const params = UpdateTransactionStatusParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateTransactionStatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Transaction not found" }); return; }

  const updateValues: Partial<typeof transactionsTable.$inferInsert> = {
    status: parsed.data.status as "pending" | "ready" | "complete",
  };

  // If completing, set payment method + cash received now
  if (parsed.data.status === "complete") {
    if (parsed.data.paymentMethod) {
      updateValues.paymentMethod = parsed.data.paymentMethod as "cash" | "gcash";
    }
    if (parsed.data.cashReceived !== undefined) {
      updateValues.cashReceived = String(parsed.data.cashReceived);
    }
  }

  const [tx] = await db
    .update(transactionsTable)
    .set(updateValues)
    .where(eq(transactionsTable.id, params.data.id))
    .returning();

  // When marked complete, record in drawer
  if (parsed.data.status === "complete" && existing.status !== "complete") {
    const total = Number(tx.total);
    const method = tx.paymentMethod;

    if (method === "cash") {
      const entries = await db.select().from(cashDrawerEntriesTable).orderBy(desc(cashDrawerEntriesTable.createdAt));
      const currentBalance = entries.length > 0 ? Number(entries[0].runningBalance) : 0;
      await db.insert(cashDrawerEntriesTable).values({
        type: "sale",
        amount: String(total),
        note: `Sale #${tx.id} — ${tx.customer} (${tx.unit})`,
        runningBalance: String(currentBalance + total),
      });
    } else if (method === "gcash") {
      const entries = await db.select().from(gcashDrawerEntriesTable).orderBy(desc(gcashDrawerEntriesTable.createdAt));
      const currentBalance = entries.length > 0 ? Number(entries[0].runningBalance) : 0;
      await db.insert(gcashDrawerEntriesTable).values({
        type: "sale",
        amount: String(total),
        note: `Sale #${tx.id} — ${tx.customer} (${tx.unit})`,
        runningBalance: String(currentBalance + total),
      });
    }
  }

  const techs = await db.select().from(techniciansTable);
  const techMap = new Map(techs.map((t) => [t.id, t.name]));
  const items = await db.select().from(transactionItemsTable).where(eq(transactionItemsTable.transactionId, tx.id));

  const result = {
    id: tx.id,
    customer: tx.customer,
    unit: tx.unit,
    technicianName: techMap.get(tx.technicianId) ?? "Unknown",
    paymentMethod: tx.paymentMethod ?? null,
    total: Number(tx.total),
    profit: Number(tx.profit),
    status: tx.status,
    hasPreOrder: items.some((i) => i.isPreOrder),
    createdAt: tx.createdAt.toISOString(),
    items: items.map((i) => ({
      type: i.type, refId: i.refId ?? null, name: i.name,
      qty: i.qty, price: Number(i.price), isPreOrder: i.isPreOrder,
    })),
  };

  res.json(UpdateTransactionStatusResponse.parse(result));
});

router.delete("/transactions/:id", async (req, res): Promise<void> => {
  const params = DeleteTransactionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [deleted] = await db.delete(transactionsTable).where(eq(transactionsTable.id, params.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: "Transaction not found" }); return; }

  await db.delete(transactionItemsTable).where(eq(transactionItemsTable.transactionId, params.data.id));
  res.sendStatus(204);
});

export default router;
