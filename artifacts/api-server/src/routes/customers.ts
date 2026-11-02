import { Router, type IRouter } from "express";
import { db, transactionsTable } from "@workspace/db";
import { LookupCustomerResponse, LookupCustomerQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/customers/lookup", async (req, res): Promise<void> => {
  const parsed = LookupCustomerQueryParams.safeParse(req.query);
  if (!parsed.success || !parsed.data.name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const searchName = parsed.data.name.trim().toLowerCase();

  // Find all completed transactions for this customer (case-insensitive match)
  const allTxs = await db.select().from(transactionsTable);
  const customerTxs = allTxs.filter(
    (tx) => tx.customer.toLowerCase() === searchName && tx.status === "complete"
  );

  const totalVisits = customerTxs.length;
  const totalSpent = customerTxs.reduce((a, r) => a + Number(r.total), 0);
  const lastTx = customerTxs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const units = [...new Set(customerTxs.map((tx) => tx.unit))];

  res.json(LookupCustomerResponse.parse({
    name: parsed.data.name.trim(),
    totalVisits,
    isRepeat: totalVisits >= 2,
    totalSpent,
    lastVisit: lastTx ? lastTx.createdAt.toISOString() : null,
    units,
  }));
});

export default router;
