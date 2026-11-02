import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();
const SETTINGS_ID = 1;

const DEFAULT_SETTINGS = {
  storeName: "JEGZ Mobile Repair",
  storeAddress: "",
  contactNumber: "",
  receiptFooter: "Thank you for trusting JEGZ Mobile Repair!",
  warrantyNote: "Warranty does not cover physical or liquid damage.",
  lowStockThreshold: 5,
  allowNegativeStock: false,
  cashEnabled: true,
  gcashEnabled: true,
  gcashAccountName: "",
  gcashAccountNumber: "",
};

async function getOrCreateSettings() {
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.id, SETTINGS_ID));
  if (existing) return existing;

  const [created] = await db.insert(settingsTable).values({
    id: SETTINGS_ID,
    ...DEFAULT_SETTINGS,
  }).returning();
  return created;
}

router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json(settings);
});

router.patch("/settings", requireAdmin, async (req, res): Promise<void> => {
  const {
    storeName,
    storeAddress,
    contactNumber,
    receiptFooter,
    warrantyNote,
    lowStockThreshold,
    allowNegativeStock,
    cashEnabled,
    gcashEnabled,
    gcashAccountName,
    gcashAccountNumber,
  } = req.body;

  const updateData: Partial<typeof settingsTable.$inferInsert> = {};
  const textFields = [
    "storeName",
    "storeAddress",
    "contactNumber",
    "receiptFooter",
    "warrantyNote",
    "gcashAccountName",
    "gcashAccountNumber",
  ] as const;

  for (const field of textFields) {
    if (typeof req.body[field] === "string") {
      updateData[field] = req.body[field].trim();
    }
  }

  if (typeof lowStockThreshold === "number" && Number.isInteger(lowStockThreshold) && lowStockThreshold >= 0 && lowStockThreshold <= 100000) {
    updateData.lowStockThreshold = lowStockThreshold;
  } else if (lowStockThreshold !== undefined) {
    res.status(400).json({ error: "Low-stock threshold must be a whole number from 0 to 100000" });
    return;
  }
  if (typeof allowNegativeStock === "boolean") updateData.allowNegativeStock = allowNegativeStock;
  if (typeof cashEnabled === "boolean") updateData.cashEnabled = cashEnabled;
  if (typeof gcashEnabled === "boolean") updateData.gcashEnabled = gcashEnabled;

  if (typeof storeName === "string" && !storeName.trim()) {
    res.status(400).json({ error: "Store name cannot be empty" });
    return;
  }

  const [settings] = await db.update(settingsTable)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(settingsTable.id, SETTINGS_ID))
    .returning();

  res.json(settings ?? await getOrCreateSettings());
});

export default router;