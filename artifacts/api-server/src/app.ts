import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { pool, db, usersTable } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import "./session.d.ts";

const PgStore = connectPgSimple(session);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error("SESSION_SECRET environment variable is required");

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "sessions",
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "lax",
    },
  }),
);

// Seed admin user if no users exist
async function seedAdmin() {
  const existing = await db.select().from(usersTable).limit(1);
  if (existing.length === 0) {
    const passwordHash = await bcrypt.hash("jegz2024", 10);
    await db.insert(usersTable).values({
      username: "admin",
      passwordHash,
      role: "admin",
      permissions: [],
      isActive: true,
    });
    logger.info("Default admin account created: admin / jegz2024");
  }
}

seedAdmin().catch((err) => logger.error({ err }, "Failed to seed admin user"));

app.use("/api", router);

export default app;
