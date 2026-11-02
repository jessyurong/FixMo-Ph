import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, cashDrawerEntriesTable } from "@workspace/db";
import {
  GetCashDrawerResponse,
  CashDepositBody,
  CashWithdrawBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getCashDrawerState() {
  const entries = await db
    .select()
    .from(cashDrawerEntriesTable)
    .orderBy(desc(cashDrawerEntriesTable.createdAt));

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

router.get("/cash-drawer", async (_req, res): Promise<void> => {
  const state = await getCashDrawerState();
  res.json(GetCashDrawerResponse.parse(state));
});

router.post("/cash-drawer/deposit", async (req, res): Promise<void> => {
  const parsed = CashDepositBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const currentState = await getCashDrawerState();
  const newBalance = currentState.balance + parsed.data.amount;

  await db.insert(cashDrawerEntriesTable).values({
    type: "deposit",
    amount: String(parsed.data.amount),
    note: parsed.data.note ?? null,
    runningBalance: String(newBalance),
  });

  const updated = await getCashDrawerState();
  res.json(GetCashDrawerResponse.parse(updated));
});

router.post("/cash-drawer/withdraw", async (req, res): Promise<void> => {
  const parsed = CashWithdrawBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const currentState = await getCashDrawerState();
  const newBalance = currentState.balance - parsed.data.amount;

  await db.insert(cashDrawerEntriesTable).values({
    type: "withdraw",
    amount: String(parsed.data.amount),
    note: parsed.data.note ?? null,
    runningBalance: String(newBalance),
  });

  const updated = await getCashDrawerState();
  res.json(GetCashDrawerResponse.parse(updated));
});

export default router;
