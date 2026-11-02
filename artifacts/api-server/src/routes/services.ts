import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, servicesTable } from "@workspace/db";
import {
  ListServicesResponse,
  ListServicesQueryParams,
  CreateServiceBody,
  UpdateServiceBody,
  UpdateServiceParams,
  UpdateServiceResponse,
  DeleteServiceParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/services", async (req, res): Promise<void> => {
  const query = ListServicesQueryParams.safeParse(req.query);
  const type = query.success ? query.data.type : undefined;

  let rows;
  if (type) {
    rows = await db
      .select()
      .from(servicesTable)
      .where(eq(servicesTable.type, type as "android" | "iphone"))
      .orderBy(servicesTable.name);
  } else {
    rows = await db.select().from(servicesTable).orderBy(servicesTable.name);
  }

  res.json(
    ListServicesResponse.parse(
      rows.map((r) => ({ ...r, price: Number(r.price) }))
    )
  );
});

router.post("/services", async (req, res): Promise<void> => {
  const parsed = CreateServiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [service] = await db
    .insert(servicesTable)
    .values({
      name: parsed.data.name,
      type: parsed.data.type as "android" | "iphone",
      price: String(parsed.data.price),
    })
    .returning();

  res.status(201).json({ ...service, price: Number(service.price) });
});

router.put("/services/:id", async (req, res): Promise<void> => {
  const params = UpdateServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateServiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [service] = await db
    .update(servicesTable)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.type !== undefined && { type: parsed.data.type as "android" | "iphone" }),
      ...(parsed.data.price !== undefined && { price: String(parsed.data.price) }),
    })
    .where(eq(servicesTable.id, params.data.id))
    .returning();

  if (!service) {
    res.status(404).json({ error: "Service not found" });
    return;
  }

  res.json(UpdateServiceResponse.parse({ ...service, price: Number(service.price) }));
});

router.delete("/services/:id", async (req, res): Promise<void> => {
  const params = DeleteServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(servicesTable)
    .where(eq(servicesTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Service not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
