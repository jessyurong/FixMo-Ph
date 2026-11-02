import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  AlertTriangle,
  Banknote,
  Check,
  Cloud,
  FolderOpen,
  FolderTree,
  ImagePlus,
  KeyRound,
  LockKeyhole,
  ReceiptText,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  Store,
  Trash2,
  Unlink,
  UsersRound,
  WalletCards,
} from "lucide-react";
import {
  useChangePassword,
  useGetSettings,
  useUpdateSettings,
  fileToResizedLogoDataUrl,
  LOGO_ACCEPT_ATTR,
  type Settings,
  type SettingsInput,
  type StorageFolderPermission,
} from "@/lib/offline-api";
import { useStorageFolder } from "@/lib/storage-folder-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { getSyncStatus, syncNow } from "@/lib/sync-engine";
import { cn } from "@/lib/utils";

const EMPTY_SETTINGS: SettingsInput = {
  storeName: "",
  storeAddress: "",
  contactNumber: "",
  shopEmail: "",
  shopDescription: "",
  shopLogo: "",
  receiptFooter: "",
  warrantyNote: "",
  lowStockThreshold: 5,
  allowNegativeStock: false,
  cashEnabled: true,
  gcashEnabled: true,
  gcashAccountName: "",
  gcashAccountNumber: "",
  preOrderMarkup: 20,
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message.replace(/^HTTP \d+ [^:]+:\s*/, "") : fallback;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin";
  const { data: settings, isLoading: settingsLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const changePassword = useChangePassword();
  const [form, setForm] = useState<SettingsInput>(EMPTY_SETTINGS);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [logoUploading, setLogoUploading] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const next: SettingsInput = {
      storeName: settings.storeName,
      storeAddress: settings.storeAddress,
      contactNumber: settings.contactNumber,
      shopEmail: settings.shopEmail,
      shopDescription: settings.shopDescription,
      shopLogo: settings.shopLogo,
      receiptFooter: settings.receiptFooter,
      warrantyNote: settings.warrantyNote,
      lowStockThreshold: settings.lowStockThreshold,
      allowNegativeStock: settings.allowNegativeStock,
      cashEnabled: settings.cashEnabled,
      gcashEnabled: settings.gcashEnabled,
      gcashAccountName: settings.gcashAccountName,
      gcashAccountNumber: settings.gcashAccountNumber,
      preOrderMarkup: settings.preOrderMarkup,
    };
    setForm(next);
  }, [settings]);

  const setField = <K extends keyof SettingsInput>(field: K, value: SettingsInput[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveSettings = async () => {
    if (!isAdmin) return;
    if (!form.storeName?.trim()) {
      toast({ title: "Store name is required", variant: "destructive" });
      return;
    }

    try {
      await updateSettings.mutateAsync({ data: form });
      toast({ title: "Settings saved", description: "Your POS preferences are now up to date." });
    } catch (error) {
      toast({ title: errorMessage(error, "Failed to save settings"), variant: "destructive" });
    }
  };

  const handleLogoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLogoUploading(true);
    try {
      const dataUrl = await fileToResizedLogoDataUrl(file);
      await updateSettings.mutateAsync({ data: { shopLogo: dataUrl } });
      setField("shopLogo", dataUrl);
      toast({ title: "Logo updated", description: "Your shop logo is saved and will appear across the POS." });
    } catch (error) {
      toast({ title: errorMessage(error, "Could not update logo"), variant: "destructive" });
    } finally {
      setLogoUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    setLogoUploading(true);
    try {
      await updateSettings.mutateAsync({ data: { shopLogo: "" } });
      setField("shopLogo", "");
      toast({ title: "Logo removed" });
    } catch (error) {
      toast({ title: errorMessage(error, "Could not remove logo"), variant: "destructive" });
    } finally {
      setLogoUploading(false);
    }
  };

  const submitPassword = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      toast({ title: "Complete all password fields", variant: "destructive" });
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      toast({ title: "New password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast({ title: "New passwords do not match", variant: "destructive" });
      return;
    }

    try {
      await changePassword.mutateAsync({
        data: {
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        },
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast({ title: "Password changed", description: "Use your new password the next time you sign in." });
    } catch (error) {
      toast({ title: errorMessage(error, "Failed to change password"), variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <SettingsIcon className="h-4 w-4" />
            System settings
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep FixMo PH configured for how your shop operates.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={saveSettings} disabled={settingsLoading || updateSettings.isPending} className="gap-2">
            {updateSettings.isPending ? "Saving..." : <><Save className="h-4 w-4" /> Save settings</>}
          </Button>
        )}
      </div>

      {isAdmin ? (
        <>
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-base">
                <Store className="h-4 w-4 text-primary" />
                Shop Profile
              </CardTitle>
              <CardDescription>
                Your shop identity — shown on the login screen, sidebar, receipts, and printed reports.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted/40">
                  {form.shopLogo ? (
                    <img src={form.shopLogo} alt="Shop logo" className="h-full w-full object-contain" />
                  ) : (
                    <Store className="h-9 w-9 text-muted-foreground" />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="file"
                    accept={LOGO_ACCEPT_ATTR}
                    className="hidden"
                    id="shop-logo-input"
                    onChange={handleLogoChange}
                    disabled={logoUploading}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById("shop-logo-input")?.click()}
                    disabled={logoUploading}
                    className="gap-2"
                  >
                    <ImagePlus className="h-4 w-4" />
                    {logoUploading ? "Uploading..." : form.shopLogo ? "Change Logo" : "Upload Logo"}
                  </Button>
                  {form.shopLogo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleRemoveLogo}
                      disabled={logoUploading}
                      className="gap-2 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" /> Remove Logo
                    </Button>
                  )}
                  <p className="w-full text-xs text-muted-foreground">
                    PNG, JPG, or WEBP (max 5 MB). Resized automatically and saved instantly — no "Save settings" needed for the logo.
                  </p>
                </div>
              </div>

              <Separator />

              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="shop-name">Shop Name</Label>
                  <Input id="shop-name" value={form.storeName ?? ""} onChange={(e) => setField("storeName", e.target.value)} placeholder="e.g. FixMo PH" disabled={settingsLoading} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shop-email">Email (optional)</Label>
                  <Input id="shop-email" type="email" value={form.shopEmail ?? ""} onChange={(e) => setField("shopEmail", e.target.value)} placeholder="shop@example.com" disabled={settingsLoading} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shop-contact">Contact Number</Label>
                  <Input id="shop-contact" value={form.contactNumber ?? ""} onChange={(e) => setField("contactNumber", e.target.value)} placeholder="09XX XXX XXXX" disabled={settingsLoading} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shop-address">Address</Label>
                  <Input id="shop-address" value={form.storeAddress ?? ""} onChange={(e) => setField("storeAddress", e.target.value)} placeholder="Shop address" disabled={settingsLoading} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="shop-description">Shop Description (optional)</Label>
                  <Textarea id="shop-description" value={form.shopDescription ?? ""} onChange={(e) => setField("shopDescription", e.target.value)} rows={2} placeholder="Short tagline shown on the login screen" disabled={settingsLoading} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-base">
                <Store className="h-4 w-4 text-primary" />
                Store & receipt
              </CardTitle>
              <CardDescription>
                This information appears on customer receipts and warranty notes.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 p-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="store-name">Store name</Label>
                <Input id="store-name" value={form.storeName ?? ""} onChange={(e) => setField("storeName", e.target.value)} disabled={settingsLoading} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-number">Contact number</Label>
                <Input id="contact-number" value={form.contactNumber ?? ""} onChange={(e) => setField("contactNumber", e.target.value)} placeholder="09XX XXX XXXX" disabled={settingsLoading} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="store-address">Address</Label>
                <Input id="store-address" value={form.storeAddress ?? ""} onChange={(e) => setField("storeAddress", e.target.value)} placeholder="Shop address" disabled={settingsLoading} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="receipt-footer">Receipt footer</Label>
                <Textarea id="receipt-footer" value={form.receiptFooter ?? ""} onChange={(e) => setField("receiptFooter", e.target.value)} rows={3} placeholder="Thank you message" disabled={settingsLoading} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="warranty-note">Warranty note</Label>
                <Textarea id="warranty-note" value={form.warrantyNote ?? ""} onChange={(e) => setField("warrantyNote", e.target.value)} rows={3} placeholder="Warranty terms shown on receipts" disabled={settingsLoading} />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2 text-base">
                  <WalletCards className="h-4 w-4 text-primary" />
                  Payments
                </CardTitle>
                <CardDescription>Choose the payment methods available at checkout.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-5">
                <SettingSwitch
                  icon={<Banknote className="h-4 w-4" />}
                  label="Cash payments"
                  description="Allow cash as a payment method in the POS."
                  checked={Boolean(form.cashEnabled)}
                  onCheckedChange={(checked) => setField("cashEnabled", checked)}
                />
                <Separator />
                <SettingSwitch
                  icon={<WalletCards className="h-4 w-4" />}
                  label="GCash payments"
                  description="Allow GCash as a payment method in the POS."
                  checked={Boolean(form.gcashEnabled)}
                  onCheckedChange={(checked) => setField("gcashEnabled", checked)}
                />
                <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="gcash-name">GCash account name</Label>
                    <Input id="gcash-name" value={form.gcashAccountName ?? ""} onChange={(e) => setField("gcashAccountName", e.target.value)} disabled={!form.gcashEnabled} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gcash-number">GCash number</Label>
                    <Input id="gcash-number" value={form.gcashAccountNumber ?? ""} onChange={(e) => setField("gcashAccountNumber", e.target.value)} placeholder="09XX XXX XXXX" disabled={!form.gcashEnabled} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ReceiptText className="h-4 w-4 text-primary" />
                  Inventory rules
                </CardTitle>
                <CardDescription>Simple safeguards for stock accuracy.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-5">
                <div className="space-y-2">
                  <Label htmlFor="stock-threshold">Low-stock alert threshold</Label>
                  <Input
                    id="stock-threshold"
                    type="number"
                    min={0}
                    max={100000}
                    value={form.lowStockThreshold ?? 5}
                    onChange={(e) => setField("lowStockThreshold", Math.max(0, Number(e.target.value) || 0))}
                  />
                  <p className="text-xs text-muted-foreground">Products at or below this quantity appear as low stock.</p>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="preorder-markup">Pre-order markup (%)</Label>
                  <Input
                    id="preorder-markup"
                    type="number"
                    min={0}
                    max={1000}
                    value={form.preOrderMarkup ?? 20}
                    onChange={(e) => setField("preOrderMarkup", Math.max(0, Number(e.target.value) || 0))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Automatic markup applied to items ordered as pre-orders. Final price = base price + base × markup/100.
                  </p>
                </div>
                <Separator />
                <SettingSwitch
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="Allow negative stock"
                  description="Keep this off to prevent selling more units than are recorded."
                  checked={Boolean(form.allowNegativeStock)}
                  onCheckedChange={(checked) => setField("allowNegativeStock", checked)}
                  warning
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary"><UsersRound className="h-4 w-4" /></div>
                <div>
                  <p className="font-semibold">Staff access</p>
                  <p className="text-sm text-muted-foreground">Add users, reset passwords, and control which pages staff can access.</p>
                </div>
              </div>
              <Button asChild variant="outline" className="gap-2">
                <Link href="/users">Manage users <ArrowRight className="h-4 w-4" /></Link>
              </Button>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-start gap-3 p-5">
            <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold">Admin settings are protected</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Store, payment, inventory, and staff settings can only be changed by an administrator.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" />
            Change my password
          </CardTitle>
          <CardDescription>Use a password with at least 6 characters.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 p-5 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input id="current-password" type="password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((current) => ({ ...current, currentPassword: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" autoComplete="new-password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm((current) => ({ ...current, newPassword: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input id="confirm-password" type="password" autoComplete="new-password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm((current) => ({ ...current, confirmPassword: e.target.value }))} />
          </div>
          <div className="md:col-span-3">
            <Button onClick={submitPassword} disabled={changePassword.isPending} className="gap-2">
              {changePassword.isPending ? "Updating..." : <><Check className="h-4 w-4" /> Update password</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <StorageFolderSection />
      <CloudSyncSection />
    </div>
  );
}

function CloudSyncSection() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getSyncStatus>> | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = async () => {
    try {
      setStatus(await getSyncStatus());
    } catch {
      // Status is best-effort; leave the last known value on screen.
    }
  };

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const runSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
      toast({ title: "Sync complete", description: "Local changes were pushed and cloud changes pulled." });
    } catch (error) {
      toast({ title: errorMessage(error, "Sync failed"), variant: "destructive" });
    } finally {
      setSyncing(false);
      await refresh();
    }
  };

  const lastSynced = status?.lastSyncedAt
    ? new Date(status.lastSyncedAt).toLocaleString()
    : "Not synced yet";

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cloud className="h-4 w-4 text-primary" />
          Cloud sync
        </CardTitle>
        <CardDescription>
          Every change is saved locally first, then synced to Supabase. Offline edits upload automatically when the connection returns.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        {!status?.configured ? (
          <Alert>
            <Cloud className="h-4 w-4" />
            <AlertTitle>Supabase is not configured</AlertTitle>
            <AlertDescription>
              Set the Supabase environment variables and redeploy to enable multi-device sync. The POS still works offline on this device.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Connection</p>
                <p className={cn("mt-1 font-semibold", status.online ? "text-emerald-600" : "text-amber-600")}>
                  {status.online ? "Online" : "Offline"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending changes</p>
                <p className="mt-1 font-semibold">{status.pending}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Last sync</p>
                <p className="mt-1 truncate font-semibold" title={lastSynced}>{lastSynced}</p>
              </div>
            </div>
            {status.lastError ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Last sync warning</AlertTitle>
                <AlertDescription className="break-words">{status.lastError}</AlertDescription>
              </Alert>
            ) : null}
            <Button onClick={runSync} disabled={syncing || !status.online} className="gap-2">
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              {syncing ? "Syncing..." : "Sync now"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PermissionBadge({ permission }: { permission: StorageFolderPermission }) {
  const styles: Record<StorageFolderPermission, { label: string; cls: string }> = {
    granted: {
      label: "Read/Write access granted",
      cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
    },
    prompt: {
      label: "Access needs approval",
      cls: "border-amber-500/40 bg-amber-500/10 text-amber-700",
    },
    denied: {
      label: "Access denied",
      cls: "border-red-500/40 bg-red-500/10 text-red-700",
    },
  };
  const item = styles[permission];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", item.cls)}>
      {item.label}
    </span>
  );
}

function StorageFolderSection() {
  const { toast } = useToast();
  const {
    supported,
    loading,
    choosing,
    folder,
    error,
    chooseFolder,
    disconnect,
    grantPermission,
  } = useStorageFolder();

  const handleChoose = async () => {
    try {
      const info = await chooseFolder();
      if (info) {
        toast({
          title: "Storage folder connected",
          description:
            info.permission === "granted"
              ? `${info.name} is linked. Backups will be saved to Backups/ whenever you use Backup Now.`
              : `${info.name} is linked, but access still needs your approval.`,
        });
      }
    } catch (err) {
      toast({
        title: "Could not connect storage folder",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      toast({
        title: "Storage folder disconnected",
        description: "Files already saved in the folder were left untouched.",
      });
    } catch (err) {
      toast({
        title: "Could not disconnect storage folder",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleGrant = async () => {
    const permission = await grantPermission();
    if (permission === "granted") {
      toast({ title: "Access granted", description: "Backups can now be saved into your storage folder." });
    } else {
      toast({
        title: "Access was not granted",
        description: "Backups will continue downloading as files instead.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderTree className="h-4 w-4 text-primary" />
          Storage Folder
        </CardTitle>
        <CardDescription>
          Connect a dedicated local folder so backups (and future receipts, job slips, reports, and exports) are saved
          there automatically. Everything stays on this device — no cloud, no servers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Storage folder error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!supported ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Not supported in this browser</AlertTitle>
            <AlertDescription>
              Your browser doesn't support the File System Access API, so backups will keep downloading as files.
              Use the latest version of Chrome or Edge to connect a folder.
            </AlertDescription>
          </Alert>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Checking folder status…</p>
        ) : folder ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium">Connected folder</p>
                  <p className="truncate text-sm text-muted-foreground">{folder.name}</p>
                </div>
              </div>
              <PermissionBadge permission={folder.permission} />
            </div>

            {folder.permission !== "granted" && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  {folder.permission === "denied" ? "Storage folder access is blocked" : "Storage folder access needs approval"}
                </AlertTitle>
                <AlertDescription>
                  {folder.permission === "denied"
                    ? "The browser is not allowing writes to this folder. Allow access again or disconnect it."
                    : "Allow read/write access so Backup Now can save files into this folder."}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {folder.permission !== "granted" && (
                <Button variant="outline" size="sm" onClick={handleGrant} className="gap-2">
                  <RefreshCw className="h-4 w-4" /> Allow access
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleChoose} disabled={choosing} className="gap-2">
                <FolderTree className="h-4 w-4" /> Change folder
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDisconnect} className="gap-2 text-destructive hover:text-destructive">
                <Unlink className="h-4 w-4" /> Disconnect
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Backup files are written only inside your chosen folder, under Backups/. Only a small folder reference is
              stored on this device so the connection survives a reload — POS data stays in IndexedDB and is never
              written into it.
            </p>
          </>
        ) : (
          <>
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              No storage folder connected yet — backups are downloaded as files from your browser.
            </div>
            <Button onClick={handleChoose} disabled={choosing} className="gap-2">
              <FolderOpen className="h-4 w-4" />
              {choosing ? "Choosing folder…" : "Choose Folder"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Pick a dedicated FixMo PH folder. FixMo PH will create Backups, Receipts, Job Slips, Reports, and Exports
              inside it.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SettingSwitch({
  icon,
  label,
  description,
  checked,
  onCheckedChange,
  warning = false,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  warning?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className={warning ? "mt-0.5 text-amber-500" : "mt-0.5 text-primary"}>{icon}</div>
        <div>
          <p className="font-medium">{label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}