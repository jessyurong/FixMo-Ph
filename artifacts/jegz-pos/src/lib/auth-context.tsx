import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import bcrypt from "bcryptjs";
import { localDb } from "./local-db";
import { activityService } from "./offline-data-services";
import { seedDatabaseIfNeeded } from "./seed-data";

export type UserRole = "admin" | "staff";

export const ALL_PERMISSIONS = [
  "pos", "inventory", "services", "technicians",
  "transactions", "cash_drawer", "gcash_drawer",
  "defective_items", "backjobs",
] as const;

export type Permission = typeof ALL_PERMISSIONS[number];

export type CurrentUser = {
  id: number;
  username: string;
  role: UserRole;
  permissions: string[]; // ["*"] for admin
};

type AuthState = {
  user: CurrentUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const SESSION_KEY = "jegz_session_user";

/** Seed default admin on first run */
async function seedAdminIfNeeded() {
  const count = await localDb.users.count();
  if (count === 0) {
    const passwordHash = await bcrypt.hash("jegz2024", 10);
    await localDb.users.add({
      username: "admin",
      passwordHash,
      role: "admin",
      permissions: ["*"],
      isActive: true,
      createdAt: new Date().toISOString(),
    });
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // Seed admin user if needed
      await seedAdminIfNeeded();
      // Seed demo data if needed
      await seedDatabaseIfNeeded();
      
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as CurrentUser;
        // Verify the user still exists and is active in local DB
        const dbUser = await localDb.users.get(parsed.id);
        if (dbUser && dbUser.isActive) {
          setUser(parsed);
        } else {
          localStorage.removeItem(SESSION_KEY);
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      await seedAdminIfNeeded();
      const dbUser = await localDb.users
        .where("username").equalsIgnoreCase(username).first();

      if (!dbUser) return { error: "Invalid username or password" };
      if (!dbUser.isActive) return { error: "Account is disabled" };

      const valid = await bcrypt.compare(password, dbUser.passwordHash as string);
      if (!valid) return { error: "Invalid username or password" };

      const currentUser: CurrentUser = {
        id: dbUser.id as number,
        username: dbUser.username as string,
        role: dbUser.role as UserRole,
        permissions: dbUser.permissions as string[],
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
      setUser(currentUser);
      void activityService.log("login", `${currentUser.username} signed in`, {
        entityType: "user", entityId: currentUser.id,
      });
      return {};
    } catch (e) {
      console.error("Login error:", e);
      return { error: "An unexpected error occurred" };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      const parsed = stored ? JSON.parse(stored) : null;
      if (parsed?.username) {
        await activityService.log("logout", `${parsed.username} signed out`, {
          entityType: "user", entityId: parsed.id,
        });
      }
    } catch {
      // logging must never block logout
    }
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function hasPermission(user: CurrentUser | null, permission: Permission): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.permissions.includes("*")) return true;
  return user.permissions.includes(permission);
}
