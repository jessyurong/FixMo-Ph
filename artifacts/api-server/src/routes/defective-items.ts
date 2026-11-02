import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, defectiveItemsTable, productsTable } from "@workspace/db";
import {
  ListDefectiveItemsResponse,
  CreateDefectiveItemBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/defective-items", async (_req, res): Promise<void> => {
  const items = await db
    .select({
      id: defectiveItemsTable.id,
      productId: defectiveItemsTable.productId,
      quantity: defectiveItemsTable.quantity,
      reason: defectiveItemsTable.reason,
      createdAt: defectiveItemsTable.createdAt,
      productName: productsTable.name,
      costPerUnit: productsTable.cost,
    })
    .from(defectiveItemsTable)
    .leftJoin(productsTable, eq(defectiveItemsTable.productId, productsTable.id))
    .orderBy(desc(defectiveItemsTable.createdAt));

  const result = items.map((i) => ({
    id: i.id,
    productName: i.productName ?? "Unknown",
    quantity: i.quantity,
    costPerUnit: Number(i.costPerUnit ?? 0),
    totalLoss: Number(i.costPerUnit ?? 0) * i.quantity,
    reason: i.reason,
    createdAt: i.createdAt.toISOString(),
  }));

  res.json(ListDefectiveItemsResponse.parse(result));
});

router.post("/defective-items", async (req, res): Promise<void> => {
  const parsed = CreateDefectiveItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, parsed.data.productId));

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const [item] = await db
    .insert(defectiveItemsTable)
    .values({
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      reason: parsed.data.reason,
    })
    .returning();

  // Reduce stock
  await db
    .update(productsTable)
    .set({ stock: Math.max(0, product.stock - parsed.data.quantity) })
    .where(eq(productsTable.id, parsed.data.productId));

  res.status(201).json({
    id: item.id,
    productName: product.name,
    quantity: item.quantity,
    costPerUnit: Number(product.cost),
    totalLoss: Number(product.cost) * item.quantity,
    reason: item.reason,
    createdAt: item.createdAt.toISOString(),
  });
});

export default router;
