import { Router, type IRouter } from "express";
import { eq, ilike, or } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";
import {
  ListProductsResponse,
  ListProductsQueryParams,
  CreateProductBody,
  UpdateProductBody,
  UpdateProductParams,
  UpdateProductResponse,
  DeleteProductParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function toProductOut(r: typeof productsTable.$inferSelect) {
  return {
    ...r,
    deviceType: r.deviceType ?? "both",
    cost: Number(r.cost),
    sellingPrice: Number(r.sellingPrice),
    reorderPoint: r.reorderPoint ?? 5,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/products", async (req, res): Promise<void> => {
  const query = ListProductsQueryParams.safeParse(req.query);
  const search = query.success ? query.data.search : undefined;
  const deviceType = query.success ? query.data.deviceType : undefined;

  let rows = await db.select().from(productsTable).orderBy(productsTable.name);

  if (search && search.trim()) {
    const s = search.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(s) ||
        r.category.toLowerCase().includes(s)
    );
  }

  if (deviceType) {
    rows = rows.filter(
      (r) => r.deviceType === deviceType || r.deviceType === "both"
    );
  }

  res.json(ListProductsResponse.parse(rows.map(toProductOut)));
});

router.post("/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [product] = await db
    .insert(productsTable)
    .values({
      name: parsed.data.name,
      category: parsed.data.category ?? "",
      deviceType: (parsed.data.deviceType as "android" | "iphone" | "both") ?? "both",
      cost: String(parsed.data.cost),
      sellingPrice: String(parsed.data.sellingPrice),
      stock: parsed.data.stock,
      reorderPoint: parsed.data.reorderPoint ?? 5,
    })
    .returning();

  res.status(201).json(toProductOut(product));
});

router.put("/products/:id", async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [product] = await db
    .update(productsTable)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.category !== undefined && { category: parsed.data.category }),
      ...(parsed.data.deviceType !== undefined && { deviceType: parsed.data.deviceType as "android" | "iphone" | "both" }),
      ...(parsed.data.cost !== undefined && { cost: String(parsed.data.cost) }),
      ...(parsed.data.sellingPrice !== undefined && { sellingPrice: String(parsed.data.sellingPrice) }),
      ...(parsed.data.stock !== undefined && { stock: parsed.data.stock }),
      ...(parsed.data.reorderPoint !== undefined && { reorderPoint: parsed.data.reorderPoint }),
    })
    .where(eq(productsTable.id, params.data.id))
    .returning();

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.json(UpdateProductResponse.parse(toProductOut(product)));
});

router.delete("/products/:id", async (req, res): Promise<void> => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(productsTable)
    .where(eq(productsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
