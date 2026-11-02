import { useState } from "react";
import {
  useListCustomers,
  useGetCustomerHistory,
  useShopProfile,
  useGetSettings,
  type CustomerSummary,
  type EnrichedTransaction,
  type JobPaymentStatus,
} from "@/lib/offline-api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { printJobSlip, printReceipt, type PrintSource } from "@/lib/printing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  Users,
  Smartphone,
  Wrench,
  Clock,
  Eye,
  Printer,
  User2,
} from "lucide-react";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-500 text-white" },
  in_progress: { label: "In Progress", cls: "bg-blue-500 text-white" },
  waiting_for_parts: { label: "Waiting for Parts", cls: "bg-violet-500 text-white" },
  pre_ordered: { label: "Pre-ordered", cls: "bg-cyan-600 text-white" },
  ready_for_pickup: { label: "Ready", cls: "bg-emerald-600 text-white" },
  completed: { label: "Completed", cls: "bg-green-600 text-white" },
  cancelled: { label: "Cancelled", cls: "bg-slate-500 text-white" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  return <Badge className={meta.cls}>{meta.label}</Badge>;
}

function PaymentBadge({ status, method }: { status?: JobPaymentStatus; method?: string }) {
  if (status === "paid") return <Badge className="bg-green-600 text-white">{method?.toUpperCase() || "PAID"}</Badge>;
  if (status === "partial") return <Badge className="bg-blue-600 text-white">PARTIAL</Badge>;
  return <Badge variant="outline">UNPAID</Badge>;
}

const isCompletedTxn = (tx: EnrichedTransaction) => tx.status === "completed";

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CustomerSummary | null>(null);
  const [detailsTx, setDetailsTx] = useState<EnrichedTransaction | null>(null);

  const { data: customers = [], isLoading: isLoadingCustomers } = useListCustomers({ search });
  const { data: history = [], isLoading: isLoadingHistory } = useGetCustomerHistory(selected?.key ?? null);
  const shopProfile = useShopProfile();
  const { data: settings } = useGetSettings();

  const txToPrintSource = (tx: EnrichedTransaction): PrintSource => ({
    id: tx.id,
    jobNumber: tx.jobNumber,
    status: tx.status,
    customerName: tx.customerName,
    customerPhone: tx.customerPhone,
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

  const devicesOf = (c: CustomerSummary) => c.devices;

  return (
    <div className="space-y-4 flex flex-col h-[calc(100vh-2rem)]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Repair history derived from job records — search by name, phone / unit model, or job #.
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers by name, phone, unit, or job #..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Customer results */}
        <Card className="w-full lg:w-[380px] shrink-0 flex flex-col bg-card overflow-hidden">
          <CardHeader className="py-3 px-4 border-b shrink-0">
            <CardTitle className="text-sm font-bold text-muted-foreground uppercase">
              {search ? `Results (${customers.length})` : "All customers"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-3 space-y-2">
                {isLoadingCustomers ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : customers.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    {search ? "No customers match that search." : "No customer records yet."}
                    <div className="text-xs mt-1">Customers appear after jobs are saved.</div>
                  </div>
                ) : (
                  customers.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setSelected(c)}
                      className={`w-full text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                        selected?.key === c.key
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold truncate">{c.name}</p>
                          {c.phone ? (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Smartphone className="h-3 w-3 shrink-0" /> {c.phone}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground mt-0.5 italic">No phone recorded</p>
                          )}
                          {devicesOf(c).length > 0 && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              <Wrench className="h-3 w-3 inline mr-1" />
                              {devicesOf(c).join(" · ")}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <Clock className="h-3 w-3 inline mr-1" />
                            Last visit: {c.lastVisit ? formatDate(c.lastVisit) : "—"}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <Badge variant="outline">{c.jobCount} jobs</Badge>
                          {c.outstanding > 0 && (
                            <p className="text-xs text-red-500 font-medium mt-1">
                              Owes {formatCurrency(c.outstanding)}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Selected customer history */}
        <Card className="flex-1 flex flex-col bg-card overflow-hidden">
          <CardHeader className="py-3 px-4 border-b shrink-0">
            {selected ? (
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base font-bold">{selected.name}</CardTitle>
                {selected.phone && (
                  <Badge variant="outline" className="bg-muted text-xs">
                    <Smartphone className="h-3 w-3 mr-1" />{selected.phone}
                  </Badge>
                )}
                {devicesOf(selected).map((d) => (
                  <Badge key={d} variant="outline" className="bg-muted text-xs">
                    <Wrench className="h-3 w-3 mr-1" />{d}
                  </Badge>
                ))}
                <span className="text-xs text-muted-foreground ml-auto">
                  {selected.jobCount} job(s) · {selected.completedCount} completed
                </span>
              </div>
            ) : (
              <CardTitle className="text-sm font-bold text-muted-foreground uppercase">
                Customer history
              </CardTitle>
            )}
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              {!selected ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Users className="h-8 w-8 mb-2 opacity-60" />
                  <p className="text-sm">Select a customer to see their repair history.</p>
                </div>
              ) : isLoadingHistory ? (
                <div className="text-center py-8 text-muted-foreground">Loading history...</div>
              ) : history.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">No jobs found for this customer.</div>
              ) : (
                <div className="p-3 space-y-2">
                  {history.map((tx) => (
                    <Card key={tx.id} className="overflow-hidden border-l-4 border-l-primary/50">
                      <div className="p-3">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          {tx.jobNumber && (
                            <span className="font-mono text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                              {tx.jobNumber}
                            </span>
                          )}
                          <StatusBadge status={tx.status} />
                          <PaymentBadge status={tx.paymentStatus} method={tx.paymentMethod} />
                          <span className="flex items-center text-xs text-muted-foreground">
                            <Clock className="h-3 w-3 mr-1" />{formatDate(tx.createdAt ?? "")}
                          </span>
                        </div>
                        <div className="bg-muted/30 rounded p-2 text-sm flex flex-wrap justify-between items-center gap-2">
                          <div className="truncate flex-1 min-w-[140px]">
                            <span className="font-semibold mr-2">Items:</span>
                            {tx.items.map((i) => `${i.quantity}x ${i.name}${i.isPreOrder ? " (PO)" : ""}`).join(", ") || "—"}
                            {tx.technicianName && (
                              <span className="ml-2 text-muted-foreground">· Tech: {tx.technicianName}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <div className="font-bold text-sm text-primary">{formatCurrency(tx.total || 0)}</div>
                              {tx.paymentStatus === "partial" && tx.remainingBalance !== undefined && (
                                <div className="text-xs text-red-500 font-medium">
                                  Bal: {formatCurrency(tx.remainingBalance)}
                                </div>
                              )}
                            </div>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setDetailsTx(tx)} title="View job details">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Job details dialog */}
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
                  <p className="flex items-center gap-1"><User2 className="h-3 w-3" />{detailsTx.customerName || "Walk-in"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground font-medium">Phone</p>
                  <p>{detailsTx.customerPhone || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground font-medium">Device</p>
                  <p>{[detailsTx.phoneBrand, detailsTx.phoneModel].filter(Boolean).join(" ") || detailsTx.phoneModel || "—"}</p>
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
                <p className="text-xs uppercase text-muted-foreground font-medium mb-1">Services & Products</p>
                <div className="space-y-1 text-sm">
                  {detailsTx.items.length === 0 && <p className="text-muted-foreground">—</p>}
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
                <Separator />
              )}

              <div className="flex justify-end gap-2 pt-1">
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