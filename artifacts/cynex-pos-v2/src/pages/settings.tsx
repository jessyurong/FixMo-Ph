import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  AlertTriangle,
  Banknote,
  BellRing,
  Check,
  FolderOpen,
  FolderTree,
  ImagePlus,
  KeyRound,
  LockKeyhole,
  Mail,
  ReceiptText,
  RefreshCw,
  Save,
  Send,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  DEFAULT_EMAIL_MESSAGE_TEMPLATE,
  DEFAULT_EMAIL_NOTIFY_STATUSES,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  EMAIL_MESSAGE_MAX_LENGTH,
  EMAIL_NOTIFICATION_STATUSES,
  EMAIL_SUBJECT_MAX_LENGTH,
  NOTIFICATION_TEMPLATE_PLACEHOLDERS,
  isValidEmail,
  notificationStatusLabel,
  readEmailNotificationSettings,
  type NotificationHealth,
} from "@/lib/notification-types";
import {
  getNotificationHealth,
  getNotificationOutboxCounts,
  retryFailedNotifications,
  sendTestEmail,
} from "@/lib/notification-service";
import type { TransactionStatus } from "@/lib/db-types";

const EMAIL_STATUS_DESCRIPTIONS: Record<TransactionStatus, string> = {
  received: "Acknowledge the device was dropped off.",
  diagnosing: "Tell the customer the device is being checked.",
  waiting_parts: "Set expectations while parts are ordered.",
  repairing: "Let them know the repair is underway.",
  ready: "The device is ready for pickup.",
  complete: "Payment is settled and the job is closed.",
  cancelled: "The job was cancelled — use with care.",
};

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
  emailNotificationsEnabled: true,
  emailNotifyStatuses: [...DEFAULT_EMAIL_NOTIFY_STATUSES],
  emailSubjectTemplate: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  emailMessageTemplate: DEFAULT_EMAIL_MESSAGE_TEMPLATE,
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
  const [testEmail, setTestEmail] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);
  const [retryingEmails, setRetryingEmails] = useState(false);
  const [notifyHealth, setNotifyHealth] = useState<NotificationHealth | null>(null);
  const [emailQueue, setEmailQueue] = useState({ pending: 0, failed: 0 });

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void getNotificationHealth().then((health) => {
      if (active) setNotifyHealth(health);
    });
    const refreshQueue = async () => {
      const counts = await getNotificationOutboxCounts();
      if (active) setEmailQueue(counts);
    };
    void refreshQueue();
    const timer = window.setInterval(refreshQueue, 20_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!settings) return;
    const emailSettings = readEmailNotificationSettings(settings);
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
      emailNotificationsEnabled: emailSettings.enabled,
      emailNotifyStatuses: emailSettings.statuses,
      emailSubjectTemplate: emailSettings.subjectTemplate,
      emailMessageTemplate: emailSettings.messageTemplate,
    };
    setForm(next);
    setTestEmail((current) => current || (typeof settings.shopEmail === "string" ? settings.shopEmail : ""));
  }, [settings]);

  const setField = <K extends keyof SettingsInput>(field: K, value: SettingsInput[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const selectedEmailStatuses: TransactionStatus[] = Array.isArray(form.emailNotifyStatuses)
    ? form.emailNotifyStatuses
    : [];

  const toggleEmailStatus = (status: TransactionStatus) => {
    const selected = selectedEmailStatuses.includes(status);
    setField(
      "emailNotifyStatuses",
      selected
        ? selectedEmailStatuses.filter((item) => item !== status)
        : [...selectedEmailStatuses, status],
    );
  };

  const saveSettings = async () => {
    if (!isAdmin) return;
    if (!form.storeName?.trim()) {
      toast({ title: "Store name is required", variant: "destructive" });
      return;
    }
    if (form.emailNotificationsEnabled) {
      if (selectedEmailStatuses.length === 0) {
        toast({
          title: "Choose at least one email status",
          description: "Turn off automatic email updates or select a status below.",
          variant: "destructive",
        });
        return;
      }
      if (!String(form.emailSubjectTemplate || "").trim() || !String(form.emailMessageTemplate || "").trim()) {
        toast({
          title: "Email subject and message are required",
          description: "Fill in both fields before enabling automatic emails.",
          variant: "destructive",
        });
        return;
      }
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

  const handleSendTestEmail = async () => {
    const to = testEmail.trim();
    if (!isValidEmail(to)) {
      toast({ title: "Enter a valid test email address", variant: "destructive" });
      return;
    }

    setTestingEmail(true);
    try {
      const result = await sendTestEmail({
        to,
        shopName: String(form.storeName || "").trim(),
        settings: form,
      });
      toast({
        title: "Test email sent",
        description: result.id
          ? `Resend accepted the email (${result.id}). Check ${to}.`
          : `Check ${to} for the test email.`,
      });
      setNotifyHealth({ reachable: true, configured: true, provider: result.provider || "resend" });
    } catch (error) {
      toast({
        title: "Test email failed",
        description: errorMessage(error, "Could not send the test email"),
        variant: "destructive",
      });
      void getNotificationHealth().then(setNotifyHealth);
    } finally {
      setTestingEmail(false);
    }
  };

  const handleRetryFailedEmails = async () => {
    setRetryingEmails(true);
    try {
      const requeued = await retryFailedNotifications();
      const counts = await getNotificationOutboxCounts();
      setEmailQueue(counts);
      setNotifyHealth(await getNotificationHealth());
      toast({
        title: requeued > 0 ? `Retrying ${requeued} email${requeued === 1 ? "" : "s"}` : "Email queue is clear",
        description:
          counts.failed > 0
            ? "Some emails are still failing. Check the Resend configuration and try again."
            : counts.pending > 0
              ? "Queued emails will send as soon as the service is reachable."
              : undefined,
        variant: counts.failed > 0 ? "destructive" : undefined,
      });
    } catch (error) {
      toast({
        title: "Could not retry emails",
        description: errorMessage(error, "Unexpected notification error"),
        variant: "destructive",
      });
    } finally {
      setRetryingEmails(false);
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

  const emailServiceLabel = !notifyHealth
    ? "Checking email service…"
    : !notifyHealth.reachable
      ? "Email API not reachable"
      : notifyHealth.configured
        ? "Resend connected"
        : "Resend not configured";
  const emailServiceTone = !notifyHealth || !notifyHealth.reachable
    ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
    : notifyHealth.configured
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
      : "border-red-500/40 bg-red-500/10 text-red-700";

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
            Keep the POS configured for how JEGZ Mobile Repair operates.
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
                  <Input id="shop-name" value={form.storeName ?? ""} onChange={(e) => setField("storeName", e.target.value)} placeholder="e.g. JEGZ Mobile Repair" disabled={settingsLoading} />
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

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4 text-primary" />
                Customer email updates
              </CardTitle>
              <CardDescription>
                Automatically email customers when a repair reaches the statuses you choose. Emails are sent through
                your secure <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/notify</code> Vercel function and
                Resend.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <BellRing className="h-4 w-4 text-primary" />
                  Notification service
                </div>
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", emailServiceTone)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", notifyHealth?.reachable && notifyHealth.configured ? "bg-emerald-600" : "bg-current")} />
                  {emailServiceLabel}
                </span>
              </div>

              {(emailQueue.pending > 0 || emailQueue.failed > 0) && (
                <div className={cn(
                  "flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between",
                  emailQueue.failed > 0 ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/20",
                )}>
                  <div className="flex items-start gap-2.5">
                    {emailQueue.failed > 0 ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    ) : (
                      <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        {emailQueue.failed > 0
                          ? `${emailQueue.failed} email${emailQueue.failed === 1 ? "" : "s"} could not be delivered.`
                          : `${emailQueue.pending} email${emailQueue.pending === 1 ? "" : "s"} waiting to send.`}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {emailQueue.failed > 0
                          ? "Check the service configuration, then retry. The emails are kept locally."
                          : "They will retry automatically when the POS reconnects."}
                      </p>
                    </div>
                  </div>
                  {emailQueue.failed > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleRetryFailedEmails}
                      disabled={retryingEmails}
                      className="shrink-0 gap-2"
                    >
                      <RefreshCw className={cn("h-4 w-4", retryingEmails && "animate-spin")} />
                      {retryingEmails ? "Retrying…" : "Retry failed"}
                    </Button>
                  )}
                </div>
              )}

              <SettingSwitch
                icon={<Mail className="h-4 w-4" />}
                label="Automatic email updates"
                description="Queue an email when a selected status is reached. Only jobs with a customer email address are sent."
                checked={Boolean(form.emailNotificationsEnabled)}
                onCheckedChange={(checked) => setField("emailNotificationsEnabled", checked)}
              />

              <Separator />

              <div className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <Label>Statuses that send an email</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ready and Complete are recommended. Each status is sent at most once per job.
                    </p>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {selectedEmailStatuses.length} of {EMAIL_NOTIFICATION_STATUSES.length} selected
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {EMAIL_NOTIFICATION_STATUSES.map((status) => {
                    const selected = selectedEmailStatuses.includes(status);
                    const recommended = status === "ready" || status === "complete";
                    return (
                      <label
                        key={status}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                          selected ? "border-primary/50 bg-primary/5" : "hover:bg-muted/40",
                        )}
                      >
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggleEmailStatus(status)}
                          className="mt-0.5"
                          aria-label={`Send email when status is ${notificationStatusLabel(status)}`}
                        />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                            {notificationStatusLabel(status)}
                            {recommended && (
                              <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                Recommended
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                            {EMAIL_STATUS_DESCRIPTIONS[status]}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <Separator />

              <div className="grid gap-5">
                <div className="space-y-2">
                  <Label htmlFor="email-subject-template">Email subject</Label>
                  <Input
                    id="email-subject-template"
                    value={form.emailSubjectTemplate ?? ""}
                    onChange={(event) => setField("emailSubjectTemplate", event.target.value)}
                    maxLength={EMAIL_SUBJECT_MAX_LENGTH}
                    placeholder={DEFAULT_EMAIL_SUBJECT_TEMPLATE}
                    disabled={settingsLoading}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="email-message-template">Message template</Label>
                    <span className="text-xs text-muted-foreground">
                      {String(form.emailMessageTemplate || "").length}/{EMAIL_MESSAGE_MAX_LENGTH}
                    </span>
                  </div>
                  <Textarea
                    id="email-message-template"
                    value={form.emailMessageTemplate ?? ""}
                    onChange={(event) => setField("emailMessageTemplate", event.target.value)}
                    rows={6}
                    maxLength={EMAIL_MESSAGE_MAX_LENGTH}
                    placeholder={DEFAULT_EMAIL_MESSAGE_TEMPLATE}
                    disabled={settingsLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    The job details, latest note, and tracking button are added automatically below this message.
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {NOTIFICATION_TEMPLATE_PLACEHOLDERS.map((placeholder) => (
                      <code
                        key={placeholder}
                        className="rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {placeholder}
                      </code>
                    ))}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Label htmlFor="test-email">Send a test email</Label>
                    <Input
                      id="test-email"
                      type="email"
                      value={testEmail}
                      onChange={(event) => setTestEmail(event.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSendTestEmail}
                    disabled={testingEmail}
                    className="gap-2"
                  >
                    {testingEmail ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {testingEmail ? "Sending…" : "Send test email"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Uses the current subject and message, even before you save. The email is marked as a test.
                </p>
              </div>

              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Server-side keys only</AlertTitle>
                <AlertDescription>
                  Add <code className="rounded bg-muted px-1 py-0.5 text-xs">RESEND_API_KEY</code> and{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">RESEND_FROM_EMAIL</code> to your Vercel
                  environment. Never put the Resend key in a <code className="rounded bg-muted px-1 py-0.5 text-xs">VITE_*</code>{" "}
                  variable. Emails queued offline are retried automatically when the POS reconnects.
                </AlertDescription>
              </Alert>
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
    </div>
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
              Pick a dedicated JEGZ POS folder. JEGZ POS will create Backups, Receipts, Job Slips, Reports, and Exports
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