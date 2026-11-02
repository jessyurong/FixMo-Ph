import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, transactionsTable, transactionItemsTable, techniciansTable } from "@workspace/db";
import { GetMonthlyReportResponse, GetTechnicianReportResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function getPeriodRange(period: string): Date {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "week": { const d = new Date(todayStart); d.setDate(d.getDate() - 6); return d; }
    case "month": return new Date(now.getFullYear(), now.getMonth(), 1);
    case "year": return new Date(now.getFullYear(), 0, 1);
    default: return todayStart;
  }
}

// GET /reports/monthly?month=YYYY-MM
router.get("/reports/monthly", async (req, res): Promise<void> => {
  const now = new Date();
  const monthParam = (req.query.month as string) || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [yearStr, monthStr] = monthParam.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr) - 1; // 0-indexed

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthLabel = monthStart.toLocaleString("en-PH", { month: "long", year: "numeric" });

  const allTxs = await db.select().from(transactionsTable);
  const monthTxs = allTxs.filter((tx) => tx.createdAt >= monthStart && tx.createdAt < monthEnd && tx.status === "complete");

  const totalSales = monthTxs.reduce((a, r) => a + Number(r.total), 0);
  const totalProfit = monthTxs.reduce((a, r) => a + Number(r.profit), 0);
  const totalTransactions = monthTxs.length;
  const cashTotal = monthTxs.filter((r) => r.paymentMethod === "cash").reduce((a, r) => a + Number(r.total), 0);
  const gcashTotal = monthTxs.filter((r) => r.paymentMethod === "gcash").reduce((a, r) => a + Number(r.total), 0);
  const avgPerDay = daysInMonth > 0 ? totalSales / daysInMonth : 0;

  // Daily breakdown
  const days = [];
  let bestDay = "";
  let bestDaySales = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStart = new Date(year, month, d);
    const dayEnd = new Date(year, month, d + 1);
    const dayTxs = monthTxs.filter((tx) => tx.createdAt >= dayStart && tx.createdAt < dayEnd);
    const daySales = dayTxs.reduce((a, r) => a + Number(r.total), 0);
    const dateStr = dayStart.toISOString().split("T")[0];
    if (daySales > bestDaySales) { bestDaySales = daySales; bestDay = dateStr; }
    days.push({
      date: dateStr,
      sales: daySales,
      profit: dayTxs.reduce((a, r) => a + Number(r.profit), 0),
      transactions: dayTxs.length,
      cashSales: dayTxs.filter((r) => r.paymentMethod === "cash").reduce((a, r) => a + Number(r.total), 0),
      gcashSales: dayTxs.filter((r) => r.paymentMethod === "gcash").reduce((a, r) => a + Number(r.total), 0),
    });
  }

  // Top products/services
  const monthTxIds = monthTxs.map((r) => r.id);
  let topProducts: { name: string; count: number }[] = [];
  let topServices: { name: string; count: number }[] = [];

  if (monthTxIds.length > 0) {
    const allItems = await db
      .select()
      .from(transactionItemsTable)
      .where(sql`${transactionItemsTable.transactionId} = ANY(${sql.raw(`ARRAY[${monthTxIds.join(",")}]`)})`);

    const productCounts = new Map<string, number>();
    const serviceCounts = new Map<string, number>();
    for (const item of allItems) {
      if (item.type === "product") productCounts.set(item.name, (productCounts.get(item.name) ?? 0) + item.qty);
      else serviceCounts.set(item.name, (serviceCounts.get(item.name) ?? 0) + item.qty);
    }
    topProducts = [...productCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
    topServices = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
  }

  // Technician breakdown
  const techs = await db.select().from(techniciansTable);
  const technicianBreakdown = techs.map((tech) => {
    const techTxs = monthTxs.filter((tx) => tx.technicianId === tech.id);
    return {
      technicianId: tech.id,
      name: tech.name,
      role: tech.role,
      jobs: techTxs.length,
      sales: techTxs.reduce((a, r) => a + Number(r.total), 0),
      profit: techTxs.reduce((a, r) => a + Number(r.profit), 0),
      cashJobs: techTxs.filter((r) => r.paymentMethod === "cash").length,
      gcashJobs: techTxs.filter((r) => r.paymentMethod === "gcash").length,
    };
  }).filter((t) => t.jobs > 0).sort((a, b) => b.jobs - a.jobs);

  res.json(GetMonthlyReportResponse.parse({
    month: monthParam,
    monthLabel,
    totalSales,
    totalProfit,
    totalTransactions,
    cashTotal,
    gcashTotal,
    avgPerDay,
    bestDay,
    days,
    topProducts,
    topServices,
    technicianBreakdown,
  }));
});

// GET /reports/technicians?period=today|week|month|year
router.get("/reports/technicians", async (req, res): Promise<void> => {
  const period = (req.query.period as string) || "month";
  const periodStart = getPeriodRange(period);

  const allTxs = await db.select().from(transactionsTable);
  const periodComplete = allTxs.filter((tx) => tx.createdAt >= periodStart && tx.status === "complete");

  const techs = await db.select().from(techniciansTable);
  const result = techs.map((tech) => {
    const techTxs = periodComplete.filter((tx) => tx.technicianId === tech.id);
    return {
      technicianId: tech.id,
      name: tech.name,
      role: tech.role,
      jobs: techTxs.length,
      sales: techTxs.reduce((a, r) => a + Number(r.total), 0),
      profit: techTxs.reduce((a, r) => a + Number(r.profit), 0),
      cashJobs: techTxs.filter((r) => r.paymentMethod === "cash").length,
      gcashJobs: techTxs.filter((r) => r.paymentMethod === "gcash").length,
    };
  }).sort((a, b) => b.jobs - a.jobs);

  res.json(GetTechnicianReportResponse.parse(result));
});

export default router;
