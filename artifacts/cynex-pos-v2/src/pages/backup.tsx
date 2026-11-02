import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import bcrypt from "bcryptjs";
import { localDb } from "@/lib/local-db";
import { useAuth } from "@/lib/auth-context";
import {
  activityService,
  backupNow,
  importBackup,
  previewRestore,
  validateBackup,
  useGetLastBackupTime,
  LAST_BACKUP_QUERY_KEY,
  type PosBackup,
  type RestoreMode,
  type RestoreResult,
  type RestorePreview,
  type TablePreview,
} from "@/lib/offline-api";
import { useStorageFolder } from "@/lib/storage-folder-context";
import { formatDate, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  isLegacyReplitBackup,
  previewLegacyMigration,
  migrateLegacyBackup,
  type LegacyMigrationPreview,
} from "@/lib/migration-adapter";
import type { RestoreResult as MigrationResult } from "@/lib/backup-restore";
import {
  DatabaseBackup,
  Download,
  FolderOpen,
  Upload,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  FileSearch,
} from "lucide-react";

function PreviewRow({ label, value }: { label: string; value: TablePreview }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="text-muted-foreground">
        <span className="font-medium text-amber-600">{value.existing}</span> existing/skipped ·{" "}
        <span className="font-medium text-green-600">{value.new}</span> new/import
      </span>
    </li>
  );
}

function PreviewBlock({ preview }: { preview: RestorePreview }) {
  const otherTables = [
    "transactionItems",
    "cashDrawerEntries",
    "gcashDrawerEntries",
    "defectiveItems",
    "backjobs",
    "users",
    "meta",
  ];
  const other = otherTables.reduce(
    (acc, t) => {
      const tp = preview.tables[t];
      if (!tp) return acc;
      return { existing: acc.existing + tp.existing, new: acc.new + tp.new };
    },
    { existing: 0, new: 0 },
  );

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3 text-xs">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Backup Preview</p>
      <ul className="space-y-1.5">
        <PreviewRow label="Customers" value={preview.customers} />
        <PreviewRow label="Products" value={preview.tables.products || { existing: 0, new: 0 }} />
        <PreviewRow label="Services" value={preview.tables.services || { existing: 0, new: 0 }} />
        <PreviewRow label="Transactions" value={preview.tables.transactions || { existing: 0, new: 0 }} />
        <PreviewRow label="Technicians" value={preview.tables.technicians || { existing: 0, new: 0 }} />
        <PreviewRow label="Other tables" value={other} />
      </ul>
      <p className="flex items-center justify-between">
        <span>Settings / Shop Profile</span>
        <span className="font-medium text-amber-600">
          {preview.settingsSkipped ? "Skipped during Merge: Yes" : "Nothing to skip"}
        </span>
      </p>
      <div className="space-y-1 border-t pt-2">
        <p className="flex items-center justify-between">
          <span>Total records to import</span>
          <strong className="text-green-600">{preview.totals.toImport}</strong>
        </p>
        <p className="flex items-center justify-between">
          <span>Total existing records preserved</span>
          <strong>{preview.totals.existingPreserved}</strong>
        </p>
      </div>
      <p className="font-medium text-emerald-700">
        Merge Data will add missing records without replacing your existing local records.
      </p>
    </div>
  );
}

function RestoreSummary({ result }: { result: RestoreResult }) {
  const tables = [
    ...new Set([
      ...Object.keys(result.importedByTable),
      ...Object.keys(result.skippedByTable),
      ...result.tablesProcessed,
    ]),
  ];

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground">Imported</p>
          <p className="text-2xl font-bold text-green-600">{result.itemsImported}</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground">Existing / skipped</p>
          <p className="text-2xl font-bold">{result.itemsSkipped}</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground">Errors</p>
          <p className="text-2xl font-bold text-red-600">{result.errors}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Tables processed
        </p>
        {tables.length === 0 ? (
          <p className="text-xs text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-1">
            {tables.map((t) => (
              <li key={t} className="flex items-center justify-between text-xs">
                <span className="capitalize">{t}</span>
                <span className="text-muted-foreground">
                  <span className="font-medium text-green-600">{result.importedByTable[t] || 0}</span> imported
                  {result.skippedByTable[t] ? ` · ${result.skippedByTable[t]} skipped` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {result.settingsSkipped > 0 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          The backup's shop profile and settings were skipped to preserve this device's current settings.
        </p>
      )}
      {result.safetyBackupCreated && (
        <p className="text-xs text-muted-foreground">
          Safety backup downloaded: {result.safetyBackupFileName}
        </p>
      )}
    </div>
  );
}

function LegacyPreviewBlock({ preview }: { preview: LegacyMigrationPreview }) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3 text-xs">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Legacy Replit Backup
      </p>
      <p className="text-xs text-muted-foreground">
        Exported: {formatDate(preview.exportedAt)} · Schema: {preview.sourceSchema}
      </p>

      <div className="space-y-1">
        <p className="text-xs font-semibold text-muted-foreground">Expected Import</p>
        <ul className="space-y-1">
          <li className="flex items-center justify-between gap-3">
            <span>Products</span>
            <span className="font-medium text-green-600">+{preview.expectedImport.products}</span>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>Services</span>
            <span className="font-medium text-green-600">+{preview.expectedImport.services}</span>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>Technicians</span>
            <span className="font-medium text-green-600">+{preview.expectedImport.technicians}</span>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>Transactions</span>
            <span className="font-medium text-green-600">+{preview.expectedImport.transactions}</span>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>Transaction Items</span>
            <span className="font-medium text-green-600">+{preview.expectedImport.transactionItems}</span>
          </li>
        </ul>
      </div>

      <div className="space-y-1 border-t pt-2">
        <p className="text-xs font-semibold text-muted-foreground">Skipped duplicates</p>
        <ul className="space-y-1">
          <li className="flex items-center justify-between gap-3">
            <span>Products / Services / Technicians</span>
            <span className="font-medium text-amber-600">
              {preview.skippedDuplicates.products + preview.skippedDuplicates.services + preview.skippedDuplicates.technicians}
            </span>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>Transactions</span>
            <span className="font-medium text-amber-600">{preview.skippedDuplicates.transactions}</span>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>Transaction Items</span>
            <span className="font-medium text-amber-600">{preview.skippedDuplicates.transactionItems}</span>
          </li>
        </ul>
      </div>

      <div className="space-y-1 border-t pt-2">
        <p className="flex items-center justify-between">
          <span>Cash Drawer Entries</span>
          <span className="font-medium text-amber-600">{preview.counts.cashDrawerEntries} (skipped)</span>
        </p>
        <p className="flex items-center justify-between">
          <span>GCash Drawer Entries</span>
          <span className="font-medium text-amber-600">{preview.counts.gcashDrawerEntries} (skipped)</span>
        </p>
        <p className="flex items-center justify-between">
          <span>Shop Settings</span>
          <span className="font-medium text-amber-600">
            {preview.settingsFound ? "Found (will not overwrite)" : "Not found"}
          </span>
        </p>
        <p className="flex items-center justify-between">
          <span>Unresolved references</span>
          <span className={preview.unresolvedReferences > 0 ? "font-medium text-amber-600" : "text-muted-foreground"}>
            {preview.unresolvedReferences}
          </span>
        </p>
      </div>

      {preview.unresolvedReferences > 0 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
          Some line items reference catalog entries not present in this backup. Their historical name/price/cost are
          still preserved.
        </p>
      )}

      <p className="font-medium text-emerald-700">
        Merge will add records that don't already exist. Existing local data is preserved.
      </p>
    </div>
  );
}

function LegacyImportResult({ result }: { result: MigrationResult }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground">Imported</p>
          <p className="text-2xl font-bold text-green-600">{result.itemsImported}</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground">Skipped</p>
          <p className="text-2xl font-bold">{result.itemsSkipped}</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground">Errors</p>
          <p className="text-2xl font-bold text-red-600">{result.errors}</p>
        </div>
      </div>
      <div className="rounded-lg border bg-muted/30 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Tables processed
        </p>
        <ul className="space-y-1">
          {result.tablesProcessed.map((t) => (
            <li key={t} className="flex items-center justify-between text-xs">
              <span className="capitalize">{t.replace(/([A-Z])/g, ' $1').trim()}</span>
              <span className="text-muted-foreground">
                <span className="font-medium text-green-600">{result.importedByTable[t] || 0}</span> imported
                {result.skippedByTable[t] ? ` · ${result.skippedByTable[t]} skipped` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {result.settingsSkipped > 0 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          Shop settings were not overwritten to preserve this device's current configuration.
        </p>
      )}
      {(result.skippedByTable.cashDrawerEntries || result.skippedByTable.gcashDrawerEntries) ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          Historical drawer entries were skipped to protect the current cash/GCash balance.
        </p>
      ) : null}
      {result.safetyBackupCreated && (
        <p className="text-xs text-muted-foreground">
          Safety backup downloaded: {result.safetyBackupFileName}
        </p>
      )}
    </div>
  );
}

export default function BackupPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const storage = useStorageFolder();

  const { data: lastBackup } = useGetLastBackupTime();

  // Security gate: hidden recovery page — admin only + password re-auth.
  // Unlocked in memory only, so a refresh or logout locks it again.
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  const verifyPassword = async () => {
    if (!password) {
      setVerifyError("Enter your admin password.");
      return;
    }
    setVerifying(true);
    setVerifyError("");
    try {
      const stored = localStorage.getItem("jegz_session_user");
      if (!stored) throw new Error("Not logged in.");
      const sessionUser = JSON.parse(stored);
      const dbUser = await localDb.users.get(sessionUser.id);
      if (!dbUser || !dbUser.passwordHash) throw new Error("Account not found.");
      const valid = await bcrypt.compare(password, dbUser.passwordHash as string);
      if (!valid) throw new Error("Wrong password. Try again.");
      setUnlocked(true);
      setPassword("");
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : "Could not verify password.");
    } finally {
      setVerifying(false);
    }
  };

  const [backingUp, setBackingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("merge");
  const [pendingRestore, setPendingRestore] = useState<{
    backup: PosBackup;
    fileName: string;
  } | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);

  // Legacy migration state
  const legacyFileInputRef = useRef<HTMLInputElement | null>(null);
  const [legacyBusy, setLegacyBusy] = useState(false);
  const [legacyRestoring, setLegacyRestoring] = useState(false);
  const [legacyPreview, setLegacyPreview] = useState<LegacyMigrationPreview | null>(null);
  const [pendingLegacy, setPendingLegacy] = useState<{
    data: LegacyMigrationPreview;
    raw: any;
    fileName: string;
  } | null>(null);
  const [legacyResult, setLegacyResult] = useState<MigrationResult | null>(null);

  const handleDownloadBackup = async () => {
    setBackingUp(true);
    try {
      const result = await backupNow();
      void activityService.log("backup.create", `Backup saved (${result.method}: ${result.fileName})`);
      toast({
        title: result.method === "folder" ? "Backup saved to folder" : "Backup downloaded",
        description:
          result.method === "folder"
            ? `Saved to ${result.folderName}/Backups/${result.fileName}`
            : "Your POS data backup was created on this device.",
      });
      queryClient.invalidateQueries({ queryKey: LAST_BACKUP_QUERY_KEY });
    } catch (error) {
      toast({
        title: "Failed to create backup",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBackingUp(false);
    }
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const validation = validateBackup(data);
      if (!validation.valid) {
        toast({
          title: "Invalid backup file",
          description: validation.error || "This file is not a valid JEGZ POS backup.",
          variant: "destructive",
        });
        return;
      }

      // Compare the backup against the current database (read-only). Nothing
      // is written to IndexedDB and no safety backup is created here.
      const analysis = await previewRestore(data as PosBackup);
      if (!analysis.valid) {
        toast({
          title: "Invalid backup file",
          description: analysis.error || "This file is not a valid JEGZ POS backup.",
          variant: "destructive",
        });
        return;
      }

      setRestoreMode("merge");
      setRestoreResult(null);
      setPreview(analysis);
      setPendingRestore({ backup: data as PosBackup, fileName: file.name });
    } catch (error) {
      toast({
        title: "Invalid backup file",
        description:
          error instanceof Error && error.name === "SyntaxError"
            ? "This file is not valid JSON."
            : "This file could not be read.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestore) return;
    setRestoring(true);
    try {
      const result = await importBackup(pendingRestore.backup, restoreMode);
      setRestoreResult(result);
      setPendingRestore(null);
      if (result.success) {
        void activityService.log(
          "backup.restore",
          `Backup ${result.mode === "merge" ? "merged" : "restored"} (${pendingRestore.fileName}): +${result.itemsImported} imported`,
        );
        toast({
          title: result.mode === "merge" ? "Backup merged" : "Backup restored",
          description: `Imported ${result.itemsImported} items${
            result.itemsSkipped ? `, kept ${result.itemsSkipped} existing records` : ""
          }. A safety backup was downloaded.`,
        });
      } else {
        toast({ title: "Restore failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({
        title: "Restore failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRestoring(false);
    }
  };

  // ── Legacy migration handlers ──

  const handleLegacyFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLegacyBusy(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!isLegacyReplitBackup(data)) {
        toast({
          title: "Not a legacy backup",
          description: "This file is not a Legacy Replit PostgreSQL backup. Use the regular Import Backup button for native backups.",
          variant: "destructive",
        });
        return;
      }

      const analysis = await previewLegacyMigration(data);
      setLegacyResult(null);
      setLegacyPreview(analysis);
      setPendingLegacy({ data: analysis, raw: data, fileName: file.name });
    } catch (error) {
      toast({
        title: "Could not read file",
        description:
          error instanceof Error && error.name === "SyntaxError"
            ? "This file is not valid JSON."
            : error instanceof Error ? error.message : "Could not read this file.",
        variant: "destructive",
      });
    } finally {
      setLegacyBusy(false);
    }
  };

  const handleConfirmLegacyImport = async () => {
    if (!pendingLegacy) return;
    setLegacyRestoring(true);
    try {
      const result = await migrateLegacyBackup(pendingLegacy.raw);
      setLegacyResult(result);
      setPendingLegacy(null);
      setLegacyPreview(null);
      if (result.success) {
        void activityService.log(
          "backup.restore",
          `Legacy backup imported (${pendingLegacy.fileName}): +${result.itemsImported} records`,
        );
        toast({
          title: "Legacy data imported",
          description: `Imported ${result.itemsImported} records. ${result.itemsSkipped} existing records were preserved.`,
        });
      } else {
        toast({ title: "Migration failed", description: result.message, variant: "destructive" });
      }
    } catch (error) {
      toast({
        title: "Migration failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLegacyRestoring(false);
    }
  };

  const restoreMetadata = pendingRestore?.backup.metadata;

  // Non-admins (or logged-out users) get nothing — not even the existence of the data.
  if (!user || user.role !== "admin") {
    return (
      <div className="mx-auto max-w-md space-y-4 pt-16 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-bold">Restricted area</h1>
        <p className="text-sm text-muted-foreground">
          This recovery page is available to administrators only.
        </p>
        <Button variant="outline" onClick={() => setLocation("/")}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  // Admins must re-enter their password every visit. Refresh locks it again.
  if (!unlocked) {
    return (
      <div className="mx-auto max-w-md space-y-6 pt-16">
        <div className="text-center">
          <DatabaseBackup className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-2 text-xl font-bold">Backup &amp; Restore</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hidden recovery page — not shown in the sidebar for security.
            Confirm your admin password to continue.
          </p>
        </div>
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="space-y-2">
              <Label htmlFor="backup-unlock-password">Admin password</Label>
              <Input
                id="backup-unlock-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") verifyPassword(); }}
                placeholder="••••••••"
                autoFocus
              />
              {verifyError && <p className="text-xs font-medium text-destructive">{verifyError}</p>}
            </div>
            <Button className="w-full" onClick={verifyPassword} disabled={verifying}>
              {verifying ? "Verifying..." : "Unlock Backup & Restore"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Tip: bookmark this URL — <span className="font-mono">/backup</span> — since it no longer appears in the menu.
            </p>
          </CardContent>
        </Card>
        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/")}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-primary">
          <DatabaseBackup className="h-6 w-6" />
          Backup &amp; Restore
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Protect your JEGZ POS data by creating local backups. Everything stays on this device — no cloud, no servers.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* BACKUP */}
        <Card className="flex flex-col bg-card">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4 text-primary" />
              Backup
            </CardTitle>
            <CardDescription>Create a local, offline copy of your POS data at any time.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 space-y-4 p-5">
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Current Backup Status</p>
              <p className="mt-1 text-sm">
                {lastBackup ? (
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-green-600" />
                    Last backup: <strong>{formatDate(lastBackup)}</strong>
                  </span>
                ) : (
                  "No backup created yet."
                )}
              </p>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              {!storage.supported ? (
                <p className="text-muted-foreground">
                  Folder saving isn't supported in this browser — backups download as files instead.
                </p>
              ) : storage.folder && storage.folder.permission === "granted" ? (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                  Backups will be saved to <strong>{storage.folder.name}/Backups/</strong>.
                </p>
              ) : storage.folder ? (
                <p className="flex items-center gap-1.5 text-amber-600">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {storage.folder.name} is linked but access is{" "}
                  {storage.folder.permission === "denied" ? "denied" : "not yet approved"} — backups will download until
                  access is allowed in Settings.
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  No storage folder connected — backups download as files. Connect one in Settings.
                </p>
              )}
            </div>

            <Button size="lg" className="w-full gap-2" onClick={handleDownloadBackup} disabled={backingUp}>
              <Download className="h-4 w-4" />
              {backingUp ? "Generating backup..." : "Backup Now"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Backups include all products, services, technicians, transactions, jobs, inventory, drawer records, users,
              and shop settings — including your shop profile and logo.
            </p>
          </CardContent>
        </Card>

        {/* RESTORE */}
        <Card className="flex flex-col bg-card">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4 text-primary" />
              Restore
            </CardTitle>
            <CardDescription>Merge a backup into this device's data, or fully restore it.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 space-y-4 p-5">
            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <p className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                <span>
                  <strong>Merge / Import (recommended)</strong> adds records from the backup that don't already exist on
                  this device and never touches existing data. A safety backup of your current data is downloaded
                  automatically before restoring.
                </span>
              </p>
              <p className="mt-2 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <span>
                  <strong>Replace All Data</strong> erases all current local data first, then restores the backup in its
                  place. Only use it with a trusted backup.
                </span>
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileSelected}
              style={{ display: "none" }}
              id="backup-restore-input"
            />
            <Button
              size="lg"
              variant="outline"
              className="w-full gap-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <Upload className="h-4 w-4" />
              {busy ? "Analyzing backup..." : "Import Backup"}
            </Button>
            <input
              ref={legacyFileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleLegacyFileSelected}
              style={{ display: "none" }}
              id="legacy-restore-input"
            />
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-2 text-xs text-muted-foreground"
              onClick={() => legacyFileInputRef.current?.click()}
              disabled={legacyBusy}
            >
              <FileSearch className="h-3.5 w-3.5" />
              {legacyBusy ? "Analyzing..." : "Import Legacy Replit Backup"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Restore confirmation dialog */}
      <Dialog open={Boolean(pendingRestore)} onOpenChange={(open) => !open && !restoring && (setPendingRestore(null), setPreview(null))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Restore this backup?
            </DialogTitle>
            <DialogDescription>Choose how to import this backup into this device.</DialogDescription>
          </DialogHeader>
          {pendingRestore && (
            <div className="space-y-3 py-2">
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <p className="truncate font-medium">{pendingRestore.fileName}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Backup version {pendingRestore.backup.version} · Exported {formatDate(pendingRestore.backup.exportDate)}
                </p>
                {restoreMetadata && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {restoreMetadata.transactionCount} transactions · {restoreMetadata.productCount} products ·{" "}
                    {restoreMetadata.serviceCount} services · {restoreMetadata.transactionItemCount} job items
                  </p>
                )}
              </div>

              <RadioGroup
                value={restoreMode}
                onValueChange={(value) => setRestoreMode(value as RestoreMode)}
                className="gap-2"
              >
                <Label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                    restoreMode === "merge"
                      ? "border-emerald-500/50 bg-emerald-500/5"
                      : "border-border hover:bg-muted/40"
                  )}
                >
                  <RadioGroupItem value="merge" className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium text-emerald-700">Merge / Import (recommended)</span>
                    <span className="block text-xs text-muted-foreground">
                      Adds backup records that don't already exist on this device. Your existing data, transactions,
                      users, and shop profile are kept unchanged.
                    </span>
                  </span>
                </Label>

                <Label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                    restoreMode === "replace"
                      ? "border-red-500/60 bg-red-500/5"
                      : "border-border hover:bg-muted/40"
                  )}
                >
                  <RadioGroupItem value="replace" className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium text-red-700">Replace All Data (advanced)</span>
                    <span className="block text-xs text-muted-foreground">
                      Deletes all current local data first, then restores this backup completely — including users and
                      shop settings from the backup.
                    </span>
                  </span>
                </Label>
              </RadioGroup>

              {restoreMode === "merge" && preview && <PreviewBlock preview={preview} />}

              {restoreMode === "replace" && (
                <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-xs">
                  <p className="flex items-start gap-2 font-medium text-red-700">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    WARNING: Replace All Data will permanently erase ALL current local data on this device and replace it
                    with the backup. This cannot be undone.
                  </p>
                </div>
              )}

              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                A safety backup of this device's current data will be downloaded automatically before any changes are
                made.
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingRestore(null)} disabled={restoring}>
              Cancel
            </Button>
            <Button
              className={
                restoreMode === "replace"
                  ? "bg-destructive hover:bg-destructive/90"
                  : "bg-primary hover:bg-primary/90"
              }
              onClick={handleConfirmRestore}
              disabled={restoring}
            >
              {restoring
                ? "Restoring..."
                : restoreMode === "replace"
                  ? "Replace All Data"
                  : "Merge Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore result dialog */}
      <Dialog open={Boolean(restoreResult)} onOpenChange={(open) => !open && setRestoreResult(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          {restoreResult && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {restoreResult.success ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      {restoreResult.mode === "merge" ? "Backup merged" : "Backup restored"}
                    </>
                  ) : (
                    <>
                      <XCircle className="h-5 w-5 text-red-600" />
                      Restore failed
                    </>
                  )}
                </DialogTitle>
                <DialogDescription>{restoreResult.message}</DialogDescription>
              </DialogHeader>
              {restoreResult.success && <RestoreSummary result={restoreResult} />}
              <DialogFooter className="gap-2">
                {restoreResult.success ? (
                  <Button onClick={() => window.location.reload()}>Done</Button>
                ) : (
                  <Button variant="outline" onClick={() => setRestoreResult(null)}>
                    Close
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Legacy migration confirmation dialog */}
      <Dialog
        open={Boolean(pendingLegacy)}
        onOpenChange={(open) => !open && !legacyRestoring && (setPendingLegacy(null), setLegacyPreview(null))}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-primary" />
              Import Legacy Replit Backup?
            </DialogTitle>
            <DialogDescription>
              This will merge historical data from the old JEGZ POS (Replit/PostgreSQL) backup into this device.
            </DialogDescription>
          </DialogHeader>
          {pendingLegacy && (
            <div className="space-y-3 py-2">
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <p className="truncate font-medium">{pendingLegacy.fileName}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Legacy Replit PostgreSQL Backup · Exported {formatDate(pendingLegacy.data.exportedAt)}
                </p>
              </div>

              {legacyPreview && <LegacyPreviewBlock preview={legacyPreview} />}
              {!legacyPreview && <LegacyPreviewBlock preview={pendingLegacy.data} />}

              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <p className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <span>
                    Historical drawer entries will be skipped to protect your current cash/GCash balance. Your shop
                    settings will not be overwritten. A safety backup is downloaded first.
                  </span>
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingLegacy(null)} disabled={legacyRestoring}>
              Cancel
            </Button>
            <Button onClick={handleConfirmLegacyImport} disabled={legacyRestoring}>
              {legacyRestoring ? "Importing..." : "Import Legacy Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Legacy migration result dialog */}
      <Dialog open={Boolean(legacyResult)} onOpenChange={(open) => !open && setLegacyResult(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          {legacyResult && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {legacyResult.success ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      Legacy data imported
                    </>
                  ) : (
                    <>
                      <XCircle className="h-5 w-5 text-red-600" />
                      Migration failed
                    </>
                  )}
                </DialogTitle>
                <DialogDescription>{legacyResult.message}</DialogDescription>
              </DialogHeader>
              {legacyResult.success && <LegacyImportResult result={legacyResult} />}
              <DialogFooter className="gap-2">
                {legacyResult.success ? (
                  <Button onClick={() => window.location.reload()}>Done</Button>
                ) : (
                  <Button variant="outline" onClick={() => setLegacyResult(null)}>
                    Close
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}