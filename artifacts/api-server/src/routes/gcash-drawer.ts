import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, gcashDrawerEntriesTable } from "@workspace/db";
import {
  GetGcashDrawerResponse,
  GcashDepositBody,
  GcashWithdrawBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getGcashDrawerState() {
  const entries = await db
    .select()
    .from(gcashDrawerEntriesTable)
    .orderBy(desc(gcashDrawerEntriesTable.createdAt));

  const balance = entries.length > 0 ? Number(entries[0].runningBalance) : 0;

  return {
    balance,
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      amount: Number(e.amount),
      note: e.note ?? null,
      runningBalance: Number(e.runningBalance),
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

router.get("/gcash-drawer", async (_req, res): Promise<void> => {
  const state = await getGcashDrawerState();
  res.json(GetGcashDrawerResponse.parse(state));
});

router.post("/gcash-drawer/deposit", async (req, res): Promise<void> => {
  const parsed = GcashDepositBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const current = await getGcashDrawerState();
  const newBalance = current.balance + parsed.data.amount;

  await db.insert(gcashDrawerEntriesTable).values({
    type: "deposit",
    amount: String(parsed.data.amount),
    note: parsed.data.note ?? null,
    runningBalance: String(newBalance),
  });

  const updated = await getGcashDrawerState();
  res.json(GetGcashDrawerResponse.parse(updated));
});

router.post("/gcash-drawer/withdraw", async (req, res): Promise<void> => {
  const parsed = GcashWithdrawBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const current = await getGcashDrawerState();
  const newBalance = current.balance - parsed.data.amount;

  await db.insert(gcashDrawerEntriesTable).values({
    type: "withdraw",
    amount: String(parsed.data.amount),
    note: parsed.data.note ?? null,
    runningBalance: String(newBalance),
  });

  const updated = await getGcashDrawerState();
  res.json(GetGcashDrawerResponse.parse(updated));
});

export default router;
