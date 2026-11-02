import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

const ALL_PERMISSIONS = [
  "pos", "inventory", "services", "technicians",
  "transactions", "cash_drawer", "gcash_drawer",
  "defective_items", "backjobs",
];

router.get("/users", requireAdmin, async (_req, res): Promise<void> => {
  const users = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    role: usersTable.role,
    permissions: usersTable.permissions,
    isActive: usersTable.isActive,
    createdAt: usersTable.createdAt,
  }).from(usersTable).orderBy(usersTable.createdAt);

  res.json(users.map(u => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
  })));
});

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const { username, password, role, permissions } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.username, username.toLowerCase().trim()));
  if (existing.length > 0) {
    res.status(409).json({ error: "Username already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    username: username.toLowerCase().trim(),
    passwordHash,
    role: role === "admin" ? "admin" : "staff",
    permissions: Array.isArray(permissions) ? permissions.filter((p: string) => ALL_PERMISSIONS.includes(p)) : [],
    isActive: true,
  }).returning({
    id: usersTable.id,
    username: usersTable.username,
    role: usersTable.role,
    permissions: usersTable.permissions,
    isActive: usersTable.isActive,
    createdAt: usersTable.createdAt,
  });

  res.status(201).json({ ...user, createdAt: user.createdAt.toISOString() });
});

router.patch("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { permissions, isActive, role, password } = req.body;

  const updateData: Partial<typeof usersTable.$inferInsert> = {};
  if (Array.isArray(permissions)) {
    updateData.permissions = permissions.filter((p: string) => ALL_PERMISSIONS.includes(p));
  }
  if (typeof isActive === "boolean") updateData.isActive = isActive;
  if (role === "admin" || role === "staff") updateData.role = role;
  if (password && password.length >= 6) {
    updateData.passwordHash = await bcrypt.hash(password, 10);
  }

  const [user] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, id)).returning({
    id: usersTable.id,
    username: usersTable.username,
    role: usersTable.role,
    permissions: usersTable.permissions,
    isActive: usersTable.isActive,
    createdAt: usersTable.createdAt,
  });

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  res.json({ ...user, createdAt: user.createdAt.toISOString() });
});

router.delete("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Prevent deleting the last admin
  const admins = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
  const target = admins.find(a => a.id === id);
  if (target && admins.length === 1) {
    res.status(400).json({ error: "Cannot delete the last admin account" });
    return;
  }

  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning({ id: usersTable.id });
  if (!deleted) { res.status(404).json({ error: "User not found" }); return; }
  res.sendStatus(204);
});

export { ALL_PERMISSIONS };
export default router;
