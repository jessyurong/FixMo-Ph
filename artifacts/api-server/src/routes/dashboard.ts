import { Router, type IRouter } from "express";
import { desc, sql } from "drizzle-orm";
import { db, transactionsTable, transactionItemsTable, productsTable, settingsTable } from "@workspace/db";
import { GetDashboardResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function getPeriodRange(period: string): { start: Date; label: string } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case "week": {
      const d = new Date(todayStart);
      d.setDate(d.getDate() - 6);
      return { start: d, label: "This Week" };
    }
    case "month":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), label: "This Month" };
    case "year":
      return { start: new Date(now.getFullYear(), 0, 1), label: "This Year" };
    default:
      return { start: todayStart, label: "Today" };
  }
}

router.get("/dashboard", async (req, res): Promise<void> => {
  const period = (req.query.period as string) || "today";
  const { start: periodStart, label: periodLabel } = getPeriodRange(period);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const allTxs = await db.select().from(transactionsTable);
  const periodTxs = allTxs.filter((r) => r.createdAt >= periodStart);
  const periodComplete = periodTxs.filter((r) => r.status === "complete");

  const periodSales = periodComplete.reduce((a, r) => a + Number(r.total), 0);
  const periodProfit = periodComplete.reduce((a, r) => a + Number(r.profit), 0);
  const periodTransactions = periodTxs.length;
  const cashCount = periodComplete.filter((r) => r.paymentMethod === "cash").length;
  const gcashCount = periodComplete.filter((r) => r.paymentMethod === "gcash").length;
  const pendingCount = allTxs.filter((r) => r.status === "pending" || r.status === "ready").length;

  const allProducts = await db.select().from(productsTable);
  const [appSettings] = await db.select({ lowStockThreshold: settingsTable.lowStockThreshold }).from(settingsTable).limit(1);
  const globalLowStockThreshold = appSettings?.lowStockThreshold ?? 0;
  const lowStockProducts = allProducts.filter((p) => p.stock <= Math.max(p.reorderPoint, globalLowStockThreshold));
  const lowStockCount = lowStockProducts.length;

  // Sales trend depends on period
  const salesTrend: { date: string; sales: number; profit: number; transactions: number }[] = [];

  if (period === "year") {
    // Monthly trend for the year
    for (let m = 0; m < 12; m++) {
      const mStart = new Date(now.getFullYear(), m, 1);
      const mEnd = new Date(now.getFullYear(), m + 1, 1);
      const mTxs = allTxs.filter((tx) => tx.createdAt >= mStart && tx.createdAt < mEnd && tx.status === "complete");
      salesTrend.push({
        date: mStart.toLocaleString("en-PH", { month: "short" }),
        sales: mTxs.reduce((a, r) => a + Number(r.total), 0),
        profit: mTxs.reduce((a, r) => a + Number(r.profit), 0),
        transactions: mTxs.length,
      });
    }
  } else if (period === "month") {
    // Daily trend for current month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), d);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const dayTxs = allTxs.filter((tx) => tx.createdAt >= dayStart && tx.createdAt < dayEnd && tx.status === "complete");
      salesTrend.push({
        date: `${d}`,
        sales: dayTxs.reduce((a, r) => a + Number(r.total), 0),
        profit: dayTxs.reduce((a, r) => a + Number(r.profit), 0),
        transactions: dayTxs.length,
      });
    }
  } else {
    // Last 7 days (today and week both use this)
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const nextD = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      const dayTxs = allTxs.filter((tx) => tx.createdAt >= d && tx.createdAt < nextD && tx.status === "complete");
      salesTrend.push({
        date: d.toLocaleDateString("en-PH", { month: "short", day: "numeric" }),
        sales: dayTxs.reduce((a, r) => a + Number(r.total), 0),
        profit: dayTxs.reduce((a, r) => a + Number(r.profit), 0),
        transactions: dayTxs.length,
      });
    }
  }

  // Top products/services from period complete transactions
  const periodTxIds = periodComplete.map((r) => r.id);
  let topProducts: { name: string; count: number }[] = [];
  let topServices: { name: string; count: number }[] = [];

  if (periodTxIds.length > 0) {
    const allItems = await db
      .select()
      .from(transactionItemsTable)
      .where(sql`${transactionItemsTable.transactionId} = ANY(${sql.raw(`ARRAY[${periodTxIds.join(",")}]`)})`);

    const productCounts = new Map<string, number>();
    const serviceCounts = new Map<string, number>();
    for (const item of allItems) {
      if (item.type === "product") productCounts.set(item.name, (productCounts.get(item.name) ?? 0) + item.qty);
      else serviceCounts.set(item.name, (serviceCounts.get(item.name) ?? 0) + item.qty);
    }

    topProducts = [...productCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
    topServices = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
  }

  const recentTxs = await db.select().from(transactionsTable).orderBy(desc(transactionsTable.createdAt)).limit(5);
  const recentTransactions = recentTxs.map((tx) => ({
    id: tx.id, customer: tx.customer, unit: tx.unit,
    total: Number(tx.total), paymentMethod: tx.paymentMethod ?? null,
    status: tx.status, createdAt: tx.createdAt.toISOString(),
  }));

  res.json(GetDashboardResponse.parse({
    periodSales, periodProfit, periodTransactions, periodLabel,
    cashCount, gcashCount, pendingCount, lowStockCount,
    salesTrend, topProducts, topServices, recentTransactions,
    lowStockProducts: lowStockProducts.slice(0, 10).map((p) => ({
      id: p.id, name: p.name, category: p.category, stock: p.stock, reorderPoint: p.reorderPoint,
    })),
  }));
});

export default router;
