import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, backjobsTable, techniciansTable } from "@workspace/db";
import {
  ListBackjobsResponse,
  CreateBackjobBody,
  UpdateBackjobStatusBody,
  UpdateBackjobStatusParams,
  UpdateBackjobStatusResponse,
  DeleteBackjobParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function formatBackjob(b: typeof backjobsTable.$inferSelect, techName: string) {
  const repairDate = new Date(b.originalRepairDate);
  const daysSinceRepair = Math.floor((Date.now() - repairDate.getTime()) / (1000 * 60 * 60 * 24));
  const withinWarranty = daysSinceRepair <= 30;

  return {
    id: b.id,
    customer: b.customer,
    unit: b.unit,
    technicianName: techName,
    issue: b.issue,
    originalRepairDate: b.originalRepairDate,
    cause: b.cause,
    status: b.status,
    withinWarranty,
    createdAt: b.createdAt.toISOString(),
  };
}

router.get("/backjobs", async (req, res): Promise<void> => {
  const status = req.query.status as string | undefined;

  let rows: (typeof backjobsTable.$inferSelect)[];
  if (status) {
    rows = await db
      .select()
      .from(backjobsTable)
      .where(eq(backjobsTable.status, status as "pending" | "in_progress" | "done"))
      .orderBy(desc(backjobsTable.createdAt));
  } else {
    rows = await db.select().from(backjobsTable).orderBy(desc(backjobsTable.createdAt));
  }

  const techs = await db.select().from(techniciansTable);
  const techMap = new Map(techs.map((t) => [t.id, t.name]));

  const result = await Promise.all(rows.map((b) => formatBackjob(b, techMap.get(b.technicianId) ?? "Unknown")));
  res.json(ListBackjobsResponse.parse(result));
});

router.post("/backjobs", async (req, res): Promise<void> => {
  const parsed = CreateBackjobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [tech] = await db.select().from(techniciansTable).where(eq(techniciansTable.id, parsed.data.technicianId));
  if (!tech) {
    res.status(404).json({ error: "Technician not found" });
    return;
  }

  const [backjob] = await db
    .insert(backjobsTable)
    .values({
      customer: parsed.data.customer,
      unit: parsed.data.unit,
      technicianId: parsed.data.technicianId,
      issue: parsed.data.issue,
      originalRepairDate: parsed.data.originalRepairDate,
      cause: parsed.data.cause as "warranty" | "human_error",
    })
    .returning();

  const formatted = await formatBackjob(backjob, tech.name);
  res.status(201).json(formatted);
});

router.patch("/backjobs/:id", async (req, res): Promise<void> => {
  const params = UpdateBackjobStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateBackjobStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [backjob] = await db
    .update(backjobsTable)
    .set({
      ...(parsed.data.status !== undefined && { status: parsed.data.status as "pending" | "in_progress" | "done" }),
    })
    .where(eq(backjobsTable.id, params.data.id))
    .returning();

  if (!backjob) {
    res.status(404).json({ error: "Backjob not found" });
    return;
  }

  const [tech] = await db.select().from(techniciansTable).where(eq(techniciansTable.id, backjob.technicianId));
  const formatted = await formatBackjob(backjob, tech?.name ?? "Unknown");
  res.json(UpdateBackjobStatusResponse.parse(formatted));
});

router.delete("/backjobs/:id", async (req, res): Promise<void> => {
  const params = DeleteBackjobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(backjobsTable)
    .where(eq(backjobsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Backjob not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
