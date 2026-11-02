import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListTransactions,
  useGetTransactionStats,
  useDeleteTransaction,
  useUpdateTransactionStatus,
  useCompleteTransaction,
  useRecordDeposit,
  useCancelTransaction,
  type EnrichedTransaction,
  type TransactionStatus,
  type JobPaymentStatus,
} from "@/lib/offline-api";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@/lib/utils";
import { printJobSlip, printReceipt, type PrintSource } from "@/lib/printing";
import { useShopProfile, useGetSettings } from "@/lib/offline-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Trash2,
  CreditCard,
  Banknote,
  Clock,
  Smartphone,
  Wrench,
  CheckCircle2,
  Clock3,
  Bell,
  Eye,
  PencilLine,
  HandCoins,
  XCircle,
  User2,
  Printer,
  Mail,
  RefreshCw,
} from "lucide-react";

type Period = "today" | "week" | "month" | "all";
type StatusFilter = "all" | "open" | "received" | "diagnosing" | "waiting_parts" | "repairing" | "ready" | "complete" | "cancelled";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  received: { label: "Received", cls: "bg-amber-500 text-white" },
  diagnosing: { label: "Diagnosing", cls: "bg-blue-500 text-white" },
  waiting_parts: { label: "Waiting for Parts", cls: "bg-violet-500 text-white" },
  repairing: { label: "Repairing", cls: "bg-cyan-600 text-white" },
  ready: { label: "Ready", cls: "bg-emerald-600 text-white" },
  complete: { label: "Complete", cls: "bg-green-600 text-white" },
  cancelled: { label: "Cancelled", cls: "bg-slate-500 text-white" },
};

/** Statuses that can be selected manually (completion must collect payment). */
const CHANGEABLE_STATUSES = ["received", "diagnosing", "waiting_parts", "repairing", "ready"] as const;

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || STATUS_META.received;
  return <Badge className={meta.cls}>{meta.label}</Badge>;
}

function PaymentBadge({ status, method }: { status?: JobPaymentStatus; method?: string }) {
  if (status === "paid") return <Badge className="bg-green-600 text-white">{method?.toUpperCase() || "PAID"}</Badge>;
  if (status === "partial") return <Badge className="bg-blue-600 text-white">PARTIAL</Badge>;
  return <Badge variant="outline">UNPAID</Badge>;
}

const OPEN_JOB_KEY = "jegz_open_job";
const isOpenTxn = (tx: EnrichedTransaction) => !["complete", "cancelled"].includes(tx.status);
const isCompletedTxn = (tx: EnrichedTransaction) => tx.status === "complete";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function TransactionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const shopProfile = useShopProfile();
  const { data: settings } = useGetSettings();

  const [period, setPeriod] = useState<Period>("today");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data: transactions = [], isLoading: isLoadingTx, refetch: refetchTx } = useListTransactions({
    period,
    search,
    status: statusFilter === "all" || statusFilter === "open" ? undefined : statusFilter,
  });
  const { data: stats, refetch: refetchStats } = useGetTransactionStats({ period });

  const deleteTransaction = useDeleteTransaction();
  const updateStatus = useUpdateTransactionStatus();
  const completeJob = useCompleteTransaction();
  const recordDeposit = useRecordDeposit();
  const cancelJob = useCancelTransaction();

  const filtered = statusFilter === "open" ? transactions.filter(isOpenTxn) : transactions;

  // Complete dialog state
  const [completeTx, setCompleteTx] = useState<EnrichedTransaction | null>(null);
  const [completePayMethod, setCompletePayMethod] = useState<"cash" | "gcash">("cash");
  const [completeCashReceived, setCompleteCashReceived] = useState<number>(0);

  // Deposit dialog state
  const [depositTx, setDepositTx] = useState<EnrichedTransaction | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositNote, setDepositNote] = useState("");
  const [depositMethod, setDepositMethod] = useState<"cash" | "gcash">("cash");

  // Details dialog
  const [detailsTx, setDetailsTx] = useState<EnrichedTransaction | null>(null);

  // Manual status-change dialog
  const [statusTx, setStatusTx] = useState<EnrichedTransaction | null>(null);
  const [statusValue, setStatusValue] = useState<TransactionStatus>("received");
  const [statusNote, setStatusNote] = useState("");

  const refresh = () => {
    refetchTx();
    refetchStats();
  };
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["transactionStats"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["cashDrawer"] });
    queryClient.invalidateQueries({ queryKey: ["gcashDrawer"] });
    refresh();
  };

  const handleDelete = (tx: EnrichedTransaction) => {
    const label = isOpenTxn(tx)
      ? "Delete this open job? Stock reservations will be released."
      : isCompletedTxn(tx)
        ? "Delete this completed job? Stock will be restored to inventory."
        : "Delete this transaction? THIS CANNOT BE UNDONE.";
    if (confirm(label)) {
      deleteTransaction.mutate(
        { id: tx.id },
        {
          onSuccess: () => {
            toast({ title: "Transaction deleted" });
            refreshAll();
          },
        },
      );
    }
  };

  const advanceStatus = (tx: EnrichedTransaction, status: TransactionStatus) => {
    updateStatus.mutate(
      { id: tx.id, status },
      {
        onSuccess: () => {
          toast({ title: `Job marked as ${STATUS_META[status]?.label || status}` });
          refreshAll();
        },
        onError: (error) => {
          toast({ title: "Update failed", description: errMsg(error), variant: "destructive" });
        },
      },
    );
  };

  const openStatusDialog = (tx: EnrichedTransaction) => {
    setStatusTx(tx);
    setStatusValue(tx.status);
    setStatusNote("");
  };

  const submitStatusChange = () => {
    if (!statusTx) return;
    const note = statusNote.trim();
    if (statusValue === statusTx.status && !note) {
      toast({ title: "Choose a different status or add a note", variant: "destructive" });
      return;
    }
    updateStatus.mutate(
      { id: statusTx.id, status: statusValue, note: note || undefined },
      {
        onSuccess: () => {
          toast({
            title: `Job marked as ${STATUS_META[statusValue]?.label || statusValue}`,
            description: note ? "Customer note saved with this status." : undefined,
          });
          setStatusTx(null);
          setStatusNote("");
          refreshAll();
        },
        onError: (error) => {
          toast({ title: "Update failed", description: errMsg(error), variant: "destructive" });
        },
      },
    );
  };

  const openInPos = (id: number) => {
    sessionStorage.setItem(OPEN_JOB_KEY, String(id));
    setLocation("/pos");
  };

  const openCompleteDialog = (tx: EnrichedTransaction) => {
    setCompleteTx(tx);
    setCompletePayMethod("cash");
    setCompleteCashReceived(0);
  };

  const handleConfirmComplete = () => {
    if (!completeTx) return;
    const remaining = Math.max(0, (completeTx.total || 0) - (completeTx.amountPaid || 0));
    completeJob.mutate(
      {
        id: completeTx.id,
        data: { items: [], total: completeTx.total || 0 },
        paymentMethod: completePayMethod,
        cashReceived: completePayMethod === "cash" ? (completeCashReceived > 0 ? completeCashReceived : remaining) : undefined,
      },
      {
        onSuccess: () => {
          toast({ title: "Job complete — payment recorded in drawer!" });
          setCompleteTx(null);
          refreshAll();
        },
        onError: (error) => {
          toast({ title: "Could not complete job", description: errMsg(error), variant: "destructive" });
        },
      },
    );
  };

  const submitDeposit = () => {
    if (!depositTx) return;
    const amount = Math.round(Number(depositAmount) * 100) / 100;
    if (!amount || amount <= 0) {
      toast({ title: "Enter a valid deposit amount", variant: "destructive" });
      return;
    }
    recordDeposit.mutate(
      { id: depositTx.id, data: { amount, method: depositMethod, note: depositNote || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Deposit recorded", description: `${formatCurrency(amount)} added to the job.` });
          setDepositTx(null);
          setDepositAmount("");
          setDepositNote("");
          refreshAll();
        },
        onError: (error) => {
          toast({ title: "Deposit failed", description: errMsg(error), variant: "destructive" });
        },
      },
    );
  };

  const handleCancel = (tx: EnrichedTransaction) => {
    if (!confirm(`Cancel job #${tx.id}? Stock reservations will be released.`)) return;
    cancelJob.mutate(
      { id: tx.id },
      {
        onSuccess: () => {
          toast({ title: "Job cancelled" });
          refreshAll();
        },
        onError: (error) => {
          toast({ title: "Cancel failed", description: errMsg(error), variant: "destructive" });
        },
      },
    );
  };
const displayData = filtered || [];

  const changeAmount = completeTx && completePayMethod === "cash"
    ? Math.max(0, completeCashReceived - Math.max(0, (completeTx.total || 0) - (completeTx.amountPaid || 0)))
    : 0;

  const txToPrintSource = (tx: EnrichedTransaction): PrintSource => ({
    jobNumber: tx.jobNumber,
    status: tx.status,
    customerName: tx.customerName,
    customerPhone: tx.customerPhone,
    customerEmail: tx.customerEmail,
    trackingToken: tx.trackingToken,
    phoneBrand: tx.phoneBrand,
    phoneModel: tx.phoneModel,
    devicePasscode: (tx as any).devicePasscode,
    technicianName: tx.technicianName,
    createdAt: tx.createdAt,
    completedAt: tx.completedAt,
    items: (tx.items || []).map((i) => ({
      type: i.type,
      name: i.name,
      quantity: i.quantity,
      price: i.price,
      isPreOrder: i.isPreOrder,
      isCustom: i.isCustom,
    })),
    total: tx.total,
    amountPaid: tx.amountPaid,
    remainingBalance: tx.remainingBalance,
    paymentMethod: tx.paymentMethod,
    paymentStatus: tx.paymentStatus,
    hasPreOrder: tx.hasPreOrder,
  });

  const handlePrint = (tx: EnrichedTransaction) => {
    const source = txToPrintSource(tx);
    if (isCompletedTxn(tx)) printReceipt(shopProfile, settings, source);
    else printJobSlip(shopProfile, settings, source);
  };

  return (
    <div className="space-y-4 flex flex-col h-[calc(100vh-2rem)]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Transaction History</h1>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)} className="w-full sm:w-auto">
          <TabsList className="grid w-full grid-cols-4 lg:w-[400px]">
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 shrink-0">
          {[
            { label: "Total Sales", value: formatCurrency(stats.totalSales), color: "text-primary" },
            { label: "Total Profit", value: formatCurrency(stats.totalProfit), color: "text-green-500" },
            { label: "Jobs Done", value: String(stats.count), color: "" },
            { label: "Open Jobs", value: String(stats.pendingJobs ?? stats.pending ?? 0), color: "text-amber-600" },
            { label: "Deposits Held", value: formatCurrency(stats.depositTotal ?? 0), color: "text-blue-500" },
            { label: "Outstanding", value: formatCurrency(stats.outstandingTotal ?? 0), color: "text-red-500" },
          ].map((s) => (
            <Card key={s.label} className="bg-card">
              <CardContent className="p-4 space-y-1">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex gap-6 flex-1 min-h-0">
        <Card className="flex-1 flex flex-col bg-card overflow-hidden">
          <CardHeader className="py-3 px-4 border-b flex flex-row flex-wrap items-center gap-3 space-y-0 shrink-0">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by customer, phone, model, or job #..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="open">Open</TabsTrigger>
                <TabsTrigger value="received">Received</TabsTrigger>
                <TabsTrigger value="ready">Ready</TabsTrigger>
                <TabsTrigger value="complete">Complete</TabsTrigger>
                <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full p-4">
              <div className="space-y-3">
                {isLoadingTx ? (
                  <div className="text-center py-8">Loading...</div>
                ) : displayData.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No transactions found</div>
                ) : (
                  displayData.map((tx) => (
                    <Card
                      key={tx.id}
                      className={`overflow-hidden border-l-4 transition-colors ${
                        tx.status === "received" ? "border-l-amber-500"
                          : tx.status === "diagnosing" ? "border-l-blue-500"
                            : tx.status === "waiting_parts" ? "border-l-violet-500"
                              : tx.status === "repairing" ? "border-l-cyan-600"
                                : tx.status === "ready" ? "border-l-emerald-500"
                                  : tx.status === "complete" ? "border-l-green-600"
                                    : tx.status === "cancelled" ? "border-l-slate-400"
                                      : "border-l-violet-500"
                      }`}
                    >
                      <div className="p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex flex-wrap gap-2 items-center">
                            <div className="font-bold text-lg">{tx.customerName || tx.customer || "Walk-in"}</div>
                            {(tx.customerPhone || tx.unit) && (
                              <Badge variant="outline" className="bg-muted text-xs">
                                <Smartphone className="h-3 w-3 mr-1" />{tx.customerPhone || tx.unit}
                              </Badge>
                            )}
                            {tx.customerEmail && (
                              <Badge variant="outline" className="bg-muted text-xs">
                                <Mail className="h-3 w-3 mr-1" />{tx.customerEmail}
                              </Badge>
                            )}
                            {tx.phoneModel && (
                              <Badge variant="outline" className="bg-muted text-xs">
                                <Smartphone className="h-3 w-3 mr-1" />{tx.phoneModel}
                              </Badge>
                            )}
                            <StatusBadge status={tx.status} />
                            <PaymentBadge status={tx.paymentStatus} method={tx.paymentMethod} />
                            {tx.hasPreOrder && <Badge className="bg-cyan-600 text-white text-xs">Pre-order</Badge>}
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-xl text-primary">{formatCurrency(tx.total || 0)}</div>
                            {isCompletedTxn(tx) && (
                              <div className="text-xs text-green-500 font-medium mt-1">Profit: {formatCurrency(tx.profit || 0)}</div>
                            )}
                            {tx.paymentStatus === "partial" && tx.remainingBalance !== undefined && (
                              <div className="text-xs text-red-500 font-medium mt-1">
                                Bal: {formatCurrency(tx.remainingBalance)}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground mb-3">
                          <span className="flex items-center"><Clock className="h-3 w-3 mr-1" />{formatDate(tx.createdAt ?? "")}</span>
                          <span className="flex items-center"><Wrench className="h-3 w-3 mr-1" />Tech: {tx.technicianName || "None"}</span>
                          {tx.jobNumber && (
                            <span className="font-mono text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                              {tx.jobNumber}
                            </span>
                          )}
                          {tx.paymentStatus === "partial" && (
                            <span className="flex items-center text-blue-600">
                              <HandCoins className="h-3 w-3 mr-1" />Paid {formatCurrency(tx.amountPaid || 0)}
                            </span>
                          )}
                        </div>

                        <div className="bg-muted/30 rounded p-2 text-sm flex flex-wrap justify-between items-center gap-2">
                          <div className="truncate flex-1 min-w-[140px]">
                            <span className="font-semibold mr-2">Items:</span>
                            {tx.items.map((i) => `${i.quantity}x ${i.name}${i.isPreOrder ? " (PO)" : ""}`).join(", ") || "—"}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {tx.status === "received" && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => advanceStatus(tx, "diagnosing")} disabled={updateStatus.isPending}>
                                <Clock3 className="h-3 w-3 mr-1" /> Start Diagnosis
                              </Button>
                            )}
                            {tx.status === "diagnosing" && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => advanceStatus(tx, "waiting_parts")} disabled={updateStatus.isPending}>
                                  Waiting parts
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => advanceStatus(tx, "repairing")} disabled={updateStatus.isPending}>
                                  <Wrench className="h-3 w-3 mr-1" /> Start Repair
                                </Button>
                              </>
                            )}
                            {tx.status === "waiting_parts" && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => advanceStatus(tx, "repairing")} disabled={updateStatus.isPending}>
                                <Wrench className="h-3 w-3 mr-1" /> Start Repair
                              </Button>
                            )}
                            {tx.status === "repairing" && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => advanceStatus(tx, "ready")} disabled={updateStatus.isPending}>
                                <Bell className="h-3 w-3 mr-1" /> Mark Ready
                              </Button>
                            )}
                            {tx.status === "ready" && (
                              <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white text-xs" onClick={() => openCompleteDialog(tx)} disabled={completeJob.isPending}>
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
                              </Button>
                            )}
                            {isOpenTxn(tx) && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openStatusDialog(tx)}>
                                  <RefreshCw className="h-3 w-3 mr-1" /> Change status
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openInPos(tx.id)}>
                                  <PencilLine className="h-3 w-3 mr-1" /> Open in POS
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDepositTx(tx)}>
                                  <HandCoins className="h-3 w-3 mr-1" /> Deposit
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 text-destructive p-0" onClick={() => handleCancel(tx)}>
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            {isOpenTxn(tx) && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handlePrint(tx)}>
                                <Printer className="h-3 w-3 mr-1" /> Slip
                              </Button>
                            )}
                            {isCompletedTxn(tx) && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handlePrint(tx)}>
                                <Printer className="h-3 w-3 mr-1" /> Receipt
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setDetailsTx(tx)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:bg-destructive/20"
                              onClick={() => handleDelete(tx)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {stats && (
          <div className="w-72 shrink-0 hidden xl:flex flex-col gap-4 overflow-y-auto">
            {[
              { title: "Top Models", data: stats.topModels },
              { title: "Top Services", data: stats.topServices },
              { title: "Top Products", data: stats.topProducts },
            ].map((section) => (
              <Card key={section.title}>
                <CardHeader className="py-3 px-4 border-b">
                  <CardTitle className="text-sm font-bold text-muted-foreground uppercase">{section.title}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ul className="divide-y">
                    {(section.data || []).map((m, i) => (
                      <li key={i} className="flex justify-between px-4 py-2 text-sm">
                        <span className="truncate mr-2 font-medium">{m.name}</span>
                        <span className="font-bold text-primary">{m.count}</span>
                      </li>
                    ))}
                    {(section.data || []).length === 0 && (
                      <li className="px-4 py-4 text-center text-muted-foreground text-sm">No data</li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Complete Dialog */}
      <Dialog open={Boolean(completeTx)} onOpenChange={(open) => !open && setCompleteTx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Complete Job — Collect Payment
            </DialogTitle>
          </DialogHeader>
          {completeTx && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <div className="font-bold text-base">{completeTx.customerName}</div>
                <div className="text-muted-foreground">
                  {completeTx.jobNumber} · {completeTx.customerPhone || ""} {completeTx.phoneModel || ""} · Tech: {completeTx.technicianName || "None"}
                </div>
                <div className="flex justify-between">
                  <span>Total</span>
                  <span className="font-semibold">{formatCurrency(completeTx.total || 0)}</span>
                </div>
                {completeTx.amountPaid ? (
                  <div className="flex justify-between">
                    <span>Already paid (deposits)</span>
                    <span className="font-semibold text-blue-600">{formatCurrency(completeTx.amountPaid)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between border-t border-dashed pt-1">
                  <span className="font-bold">Balance due</span>
                  <span className="font-bold text-primary">{formatCurrency(Math.max(0, (completeTx.total || 0) - (completeTx.amountPaid || 0)))}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Payment Method</Label>
                <div className="flex gap-2">
                  <Button variant={completePayMethod === "cash" ? "default" : "outline"} className="flex-1" onClick={() => setCompletePayMethod("cash")}>
                    <Banknote className="mr-2 h-4 w-4" />CASH
                  </Button>
                  <Button variant={completePayMethod === "gcash" ? "default" : "outline"} className="flex-1" onClick={() => setCompletePayMethod("gcash")}>
                    <CreditCard className="mr-2 h-4 w-4" />GCASH
                  </Button>
                </div>
              </div>

              {completePayMethod === "cash" && (
                <div className="space-y-2">
                  <Label>Cash Received (₱)</Label>
                  <Input
                    type="number"
                    value={completeCashReceived || ""}
                    onChange={(e) => setCompleteCashReceived(parseFloat(e.target.value) || 0)}
                    placeholder={String(Math.max(0, (completeTx.total || 0) - (completeTx.amountPaid || 0)))}
                    className="text-lg font-bold"
                    autoFocus
                  />
                  {completeCashReceived > 0 && (
                    <div className={`text-sm font-semibold ${changeAmount >= 0 ? "text-green-600" : "text-destructive"}`}>
                      {changeAmount >= 0 ? `Change: ${formatCurrency(changeAmount)}` : `Short by: ${formatCurrency(Math.abs(changeAmount))}`}
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Payment will be recorded in the <strong>{completePayMethod === "gcash" ? "GCash" : "Cash"} Drawer</strong>.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteTx(null)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 gap-2"
              onClick={handleConfirmComplete}
              disabled={completeJob.isPending}
            >
              <CheckCircle2 className="h-4 w-4" />
              {completeJob.isPending ? "Saving..." : "Confirm Complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deposit Dialog */}
      <Dialog open={Boolean(depositTx)} onOpenChange={(open) => !open && setDepositTx(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="h-5 w-5 text-blue-500" />
              Record Deposit
            </DialogTitle>
          </DialogHeader>
          {depositTx && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <div className="font-bold">{depositTx.customerName}</div>
                <div className="flex justify-between">
                  <span>Total</span><span className="font-semibold">{formatCurrency(depositTx.total || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Paid so far</span><span className="font-semibold text-blue-600">{formatCurrency(depositTx.amountPaid || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Remaining</span><span className="font-semibold text-red-500">{formatCurrency(depositTx.remainingBalance ?? 0)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Deposit amount (₱)</Label>
                <Input type="number" min={0} value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="0.00" autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Method</Label>
                <div className="flex gap-2">
                  <Button variant={depositMethod === "cash" ? "default" : "outline"} className="flex-1" onClick={() => setDepositMethod("cash")}>
                    <Banknote className="mr-2 h-4 w-4" />Cash
                  </Button>
                  <Button variant={depositMethod === "gcash" ? "default" : "outline"} className="flex-1" onClick={() => setDepositMethod("gcash")}>
                    <CreditCard className="mr-2 h-4 w-4" />GCash
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Note (optional)</Label>
                <Textarea rows={2} value={depositNote} onChange={(e) => setDepositNote(e.target.value)} />
              </div>
              <Button className="w-full" onClick={submitDeposit} disabled={recordDeposit.isPending}>
                {recordDeposit.isPending ? "Recording..." : "Record deposit"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Status Change Dialog */}
      <Dialog open={Boolean(statusTx)} onOpenChange={(open) => { if (!open) { setStatusTx(null); setStatusNote(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" />
              Change Job Status
            </DialogTitle>
          </DialogHeader>
          {statusTx && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <div className="font-bold">{statusTx.customerName}</div>
                <div className="text-xs text-muted-foreground">
                  {statusTx.jobNumber || `Job #${statusTx.id}`} · {statusTx.phoneModel || "Device"}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">Current:</span>
                  <StatusBadge status={statusTx.status} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>New status</Label>
                <Select value={statusValue} onValueChange={(v) => setStatusValue(v as TransactionStatus)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a status" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANGEABLE_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {STATUS_META[status]?.label || status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Completion still goes through Complete so payment and stock stay correct.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Customer note (optional)</Label>
                <Textarea
                  rows={3}
                  maxLength={240}
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  placeholder="e.g. Part ordered, expected Friday"
                />
                <p className="text-xs text-muted-foreground text-right">{statusNote.length}/240</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setStatusTx(null)}>Cancel</Button>
                <Button onClick={submitStatusChange} disabled={updateStatus.isPending}>
                  {updateStatus.isPending ? "Saving..." : "Save status"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Details Dialog */}
      <Dialog open={Boolean(detailsTx)} onOpenChange={(open) => !open && setDetailsTx(null)}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Job Details
            </DialogTitle>
          </DialogHeader>
          {detailsTx && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {detailsTx.jobNumber && <span className="font-mono text-primary font-bold">{detailsTx.jobNumber}</span>}
                <StatusBadge status={detailsTx.status} />
                <PaymentBadge status={detailsTx.paymentStatus} method={detailsTx.paymentMethod} />
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase text-muted-foreground font-medium">Customer</p>
                  <p className="flex items-center gap-1"><User2 className="h-3 w-3" />{detailsTx.customerName}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground font-medium">Phone</p>
                  <p>{detailsTx.customerPhone || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground font-medium">Email</p>
                  <p className="break-all">{detailsTx.customerEmail || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground font-medium">Device</p>
                  <p>{detailsTx.phoneModel || detailsTx.phoneBrand || "—"}</p>
                </div>
                {(detailsTx as any).devicePasscode && (
                  <div>
                    <p className="text-xs uppercase text-muted-foreground font-medium">Passcode</p>
                    <p className="font-mono">{(detailsTx as any).devicePasscode}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs uppercase text-muted-foreground font-medium">Technician</p>
                  <p>{detailsTx.technicianName || "None"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground font-medium">Created</p>
                  <p>{formatDate(detailsTx.createdAt ?? "")}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground font-medium">Finished</p>
                  <p>{detailsTx.completedAt ? formatDate(detailsTx.completedAt) : "—"}</p>
                </div>
              </div>

              <div>
                <p className="text-xs uppercase text-muted-foreground font-medium mb-1">Items</p>
                <div className="space-y-1 text-sm">
                  {detailsTx.items.map((item, i) => (
                    <div key={i} className="flex justify-between gap-2">
                      <span className="truncate">
                        {item.quantity}x {item.name}
                        {item.isPreOrder ? " [PRE-ORDER]" : ""}
                        {item.isCustom ? " [CUSTOM]" : ""}
                      </span>
                      <span className="font-medium shrink-0">{formatCurrency((item.price || 0) * (item.quantity || 1))}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />
              <div className="grid gap-1 text-sm">
                <div className="flex justify-between"><span>Total</span><span className="font-bold">{formatCurrency(detailsTx.total || 0)}</span></div>
                <div className="flex justify-between"><span>Amount paid</span><span>{formatCurrency(detailsTx.amountPaid || 0)}</span></div>
                <div className="flex justify-between"><span>Remaining</span><span className={detailsTx.remainingBalance && detailsTx.remainingBalance > 0 ? "text-red-500 font-medium" : ""}>{formatCurrency(detailsTx.remainingBalance ?? 0)}</span></div>
                {isCompletedTxn(detailsTx) && (
                  <div className="flex justify-between"><span>Profit</span><span className="text-green-600 font-medium">{formatCurrency(detailsTx.profit || 0)}</span></div>
                )}
              </div>

              {(detailsTx.customerComplaint || detailsTx.diagnosis || detailsTx.technicianNotes || detailsTx.notes) && (
                <>
                  <Separator />
                  <div className="space-y-2 text-sm">
                    {detailsTx.customerComplaint && (
                      <div>
                        <p className="text-xs uppercase text-muted-foreground font-medium">Customer complaint</p>
                        <p>{detailsTx.customerComplaint}</p>
                      </div>
                    )}
                    {detailsTx.diagnosis && (
                      <div>
                        <p className="text-xs uppercase text-muted-foreground font-medium">Diagnosis</p>
                        <p>{detailsTx.diagnosis}</p>
                      </div>
                    )}
                    {detailsTx.technicianNotes && (
                      <div>
                        <p className="text-xs uppercase text-muted-foreground font-medium">Technician notes</p>
                        <p>{detailsTx.technicianNotes}</p>
                      </div>
                    )}
                    {detailsTx.notes && (
                      <div>
                        <p className="text-xs uppercase text-muted-foreground font-medium">Notes</p>
                        <p>{detailsTx.notes}</p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {detailsTx.statusHistory && detailsTx.statusHistory.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs uppercase text-muted-foreground font-medium mb-2">Status history</p>
                    <div className="space-y-2">
                      {[...detailsTx.statusHistory].reverse().map((entry, index) => (
                        <div key={`${entry.status}-${entry.timestamp}-${index}`} className="rounded-md border bg-muted/20 p-2 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <StatusBadge status={entry.status} />
                            <span className="text-xs text-muted-foreground">{formatDate(entry.timestamp)}</span>
                          </div>
                          {entry.note && <p className="mt-1 text-sm">{entry.note}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => handlePrint(detailsTx)}>
                  <Printer className="mr-2 h-4 w-4" />
                  {isCompletedTxn(detailsTx) ? "Print Receipt" : "Print Job Slip"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDetailsTx(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
