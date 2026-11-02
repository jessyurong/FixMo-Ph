import { Router, type IRouter } from "express";
import { eq, count, sum } from "drizzle-orm";
import { db, techniciansTable, transactionsTable } from "@workspace/db";
import {
  ListTechniciansResponse,
  CreateTechnicianBody,
  DeleteTechnicianParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/technicians", async (_req, res): Promise<void> => {
  const techs = await db.select().from(techniciansTable).orderBy(techniciansTable.name);

  // Aggregate stats per technician
  const stats = await db
    .select({
      technicianId: transactionsTable.technicianId,
      jobsDone: count(transactionsTable.id),
      totalSales: sum(transactionsTable.total),
    })
    .from(transactionsTable)
    .groupBy(transactionsTable.technicianId);

  const statsMap = new Map(stats.map((s) => [s.technicianId, s]));

  const result = techs.map((t) => {
    const s = statsMap.get(t.id);
    return {
      id: t.id,
      name: t.name,
      role: t.role,
      jobsDone: s ? Number(s.jobsDone) : 0,
      totalSales: s ? Number(s.totalSales) : 0,
    };
  });

  res.json(ListTechniciansResponse.parse(result));
});

router.post("/technicians", async (req, res): Promise<void> => {
  const parsed = CreateTechnicianBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [tech] = await db
    .insert(techniciansTable)
    .values({ name: parsed.data.name, role: parsed.data.role })
    .returning();

  res.status(201).json({ id: tech.id, name: tech.name, role: tech.role, jobsDone: 0, totalSales: 0 });
});

router.delete("/technicians/:id", async (req, res): Promise<void> => {
  const params = DeleteTechnicianParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(techniciansTable)
    .where(eq(techniciansTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Technician not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
