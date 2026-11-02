import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useGetDashboard, useShopProfile } from "@/lib/offline-api";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Wrench,
  Users,
  Receipt,
  Wallet,
  AlertTriangle,
  RotateCcw,
  Menu,
  Clock,
  Palette,
  Clock3,
  UserCog,
  LogOut,
  Shield,
  BarChart2,
  Contact,
  Settings,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTheme, type Theme } from "@/lib/theme-context";
import { useAuth, hasPermission, type Permission } from "@/lib/auth-context";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  permission?: Permission;
  adminOnly?: boolean;
};

const navItems: NavItem[] = [
  { href: "/",             label: "Dashboard",      icon: LayoutDashboard },
  { href: "/pos",          label: "Point of Sale",  icon: ShoppingCart,   permission: "pos" },
  { href: "/inventory",    label: "Inventory",      icon: Package,         permission: "inventory" },
  { href: "/services",     label: "Labor Services", icon: Wrench,          permission: "services" },
  { href: "/technicians",  label: "Technicians",    icon: Users,           permission: "technicians" },
  { href: "/transactions", label: "Transactions",   icon: Receipt,         permission: "transactions" },
  { href: "/customers",   label: "Customers",       icon: Contact,         permission: "transactions" },
  { href: "/drawer",       label: "Drawer",         icon: Wallet,          permission: "cash_drawer" },
  { href: "/reports",      label: "Reports",        icon: BarChart2,       permission: "transactions" },
  { href: "/defective",    label: "Defective Items",icon: AlertTriangle,   permission: "defective_items" },
  { href: "/backjobs",     label: "Backjobs",       icon: RotateCcw,       permission: "backjobs" },
  { href: "/users",        label: "User Management",icon: UserCog,         adminOnly: true },
  { href: "/activity",     label: "Activity Log",   icon: ClipboardList,  adminOnly: true },
  // Backup & Restore is intentionally hidden from the sidebar (direct URL /backup only,
  // admin + password re-auth required) so staff can't discover or open it.
  { href: "/settings",     label: "Settings",        icon: Settings },
];

type ThemeOption = { id: Theme; label: string; dot: string };

const THEMES: ThemeOption[] = [
  { id: "dark",    label: "Dark",         dot: "bg-slate-800 ring-2 ring-amber-500" },
  { id: "white",   label: "White",        dot: "bg-white ring-2 ring-amber-400 border border-gray-200" },
  { id: "warm",    label: "Warm",         dot: "bg-amber-100 ring-2 ring-orange-500" },
  { id: "skyblue", label: "Sky Blue",     dot: "bg-sky-200 ring-2 ring-sky-500" },
  { id: "violet",  label: "Light Violet", dot: "bg-violet-200 ring-2 ring-violet-500" },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const { data: dashboard } = useGetDashboard();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const shopProfile = useShopProfile();

  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(time);

  const currentTheme = THEMES.find((t) => t.id === theme)!;
  const lowStockCount = dashboard?.lowStockCount || 0;
  const pendingCount = dashboard?.pendingCount || 0;

  const visibleNav = navItems.filter(item => {
    if (item.adminOnly) return user?.role === "admin";
    if (!item.permission) return true;
    return hasPermission(user, item.permission);
  });

  return (
    <div className="flex min-h-[100dvh] bg-background">
      <aside
        className={cn(
          "flex flex-col border-r bg-card transition-all duration-300 relative",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between gap-2 px-4 border-b shrink-0">
          {!collapsed ? (
            <span className="flex min-w-0 items-center gap-2">
              {shopProfile.logo && (
                <img src={shopProfile.logo} alt={shopProfile.name} className="h-7 w-7 shrink-0 rounded-md object-contain" />
              )}
              <span className="font-bold text-primary truncate text-sm">{shopProfile.name}</span>
            </span>
          ) : (
            shopProfile.logo && (
              <img src={shopProfile.logo} alt={shopProfile.name} className="h-7 w-7 shrink-0 rounded-md object-contain" />
            )
          )}
          <Button variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)} className="shrink-0">
            <Menu className="h-5 w-5" />
          </Button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 p-2 overflow-y-auto">
          {visibleNav.map((item) => {
            const isActive = location === item.href;
            const isInventory = item.href === "/inventory";
            const isTransactions = item.href === "/transactions";

            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!collapsed && (
                    <div className="flex flex-1 items-center justify-between">
                      <span>{item.label}</span>
                      {isInventory && lowStockCount > 0 && (
                        <span className="bg-destructive text-destructive-foreground text-xs px-1.5 py-0.5 rounded-full">
                          {lowStockCount}
                        </span>
                      )}
                      {isTransactions && pendingCount > 0 && (
                        <span className="bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                          <Clock3 className="h-3 w-3" />{pendingCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Theme Picker */}
        <div className="px-2 pb-2 shrink-0 relative">
          <button
            onClick={() => setThemePickerOpen((o) => !o)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 w-full text-sm font-medium transition-colors",
              "hover:bg-muted text-muted-foreground hover:text-foreground"
            )}
            title="Change Theme"
          >
            <Palette className="h-5 w-5 shrink-0" />
            {!collapsed && (
              <span className="flex-1 text-left">
                Theme: <span className="text-foreground font-semibold">{currentTheme.label}</span>
              </span>
            )}
          </button>

          {themePickerOpen && (
            <div className={cn(
              "absolute z-50 bg-card border border-border rounded-xl shadow-xl p-3 w-52",
              collapsed ? "left-16 bottom-0" : "left-2 bottom-full mb-2"
            )}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">Choose Theme</p>
              <div className="space-y-1">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setTheme(t.id); setThemePickerOpen(false); }}
                    className={cn(
                      "flex items-center gap-3 w-full rounded-lg px-2 py-1.5 text-sm transition-colors",
                      theme === t.id ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-muted text-foreground"
                    )}
                  >
                    <span className={cn("h-4 w-4 rounded-full shrink-0", t.dot)} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User Info + Logout */}
        <div className="border-t px-2 py-2 shrink-0">
          <div className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2",
            collapsed ? "justify-center" : "justify-between"
          )}>
            {!collapsed && user && (
              <div className="flex items-center gap-2 min-w-0">
                <Shield className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{user.username}</p>
                  <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                </div>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              title="Logout"
              onClick={logout}
              className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Clock */}
        <div className="px-4 pb-4 text-sm text-muted-foreground flex items-center justify-center gap-2 shrink-0">
          <Clock className="h-4 w-4 shrink-0" />
          {!collapsed && <span>{timeString}</span>}
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
