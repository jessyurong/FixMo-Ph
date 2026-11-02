import { useState } from "react";
import {
  useGetCashDrawer,
  useCashDeposit,
  useCashWithdraw,
  getGetCashDrawerQueryKey,
  useGetGcashDrawer,
  useGcashDeposit,
  useGcashWithdraw,
  getGetGcashDrawerQueryKey,
} from "@/lib/offline-api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowDownToLine, ArrowUpFromLine, Wallet, Smartphone } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type DrawerModalType = "deposit" | "withdraw" | null;

function DrawerTable({ entries, isLoading, accentClass }: {
  entries: any[];
  isLoading: boolean;
  accentClass: string;
}) {
  return (
    <ScrollArea className="h-full">
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            <TableHead>Date & Time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Note</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Running Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
          ) : !entries?.length ? (
            <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No activity found</TableCell></TableRow>
          ) : (
            entries.map((entry: any) => (
              <TableRow key={entry.id}>
                <TableCell className="text-muted-foreground">{formatDate(entry.createdAt)}</TableCell>
                <TableCell>
                  <Badge
                    variant={entry.type === "sale" ? "default" : entry.type === "deposit" ? "secondary" : "destructive"}
                    className={
                      entry.type === "deposit" ? `${accentClass} text-white` :
                      entry.type === "sale" ? "bg-green-600 text-white" : ""
                    }
                  >
                    {entry.type.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell>{entry.note || "-"}</TableCell>
                <TableCell className={`text-right font-bold ${entry.type === "withdraw" ? "text-destructive" : "text-green-500"}`}>
                  {entry.type === "withdraw" ? "-" : "+"}{formatCurrency(entry.amount)}
                </TableCell>
                <TableCell className="text-right font-bold">{formatCurrency(entry.runningBalance)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

export default function DrawerPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: cashDrawer, isLoading: cashLoading } = useGetCashDrawer();
  const { data: gcashDrawer, isLoading: gcashLoading } = useGetGcashDrawer();

  const cashDeposit = useCashDeposit();
  const cashWithdraw = useCashWithdraw();
  const gcashDeposit = useGcashDeposit();
  const gcashWithdraw = useGcashWithdraw();

  const [activeTab, setActiveTab] = useState("cash");
  const [modalType, setModalType] = useState<DrawerModalType>(null);
  const [modalDrawer, setModalDrawer] = useState<"cash" | "gcash">("cash");
  const [amount, setAmount] = useState<number | "">("");
  const [note, setNote] = useState("");

  const openModal = (drawer: "cash" | "gcash", type: DrawerModalType) => {
    setModalDrawer(drawer);
    setModalType(type);
    setAmount("");
    setNote("");
  };

  const currentBalance = modalDrawer === "cash" ? (cashDrawer?.balance || 0) : (gcashDrawer?.balance || 0);

  const handleAction = () => {
    if (!amount || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (modalType === "withdraw" && amount > currentBalance) {
      toast({ title: `Insufficient ${modalDrawer === "gcash" ? "GCash" : "cash"} balance`, variant: "destructive" });
      return;
    }

    let mutation: any;
    if (modalDrawer === "cash") {
      mutation = modalType === "deposit" ? cashDeposit : cashWithdraw;
    } else {
      mutation = modalType === "deposit" ? gcashDeposit : gcashWithdraw;
    }

    mutation.mutate(
      { data: { amount: amount as number, note } },
      {
        onSuccess: () => {
          toast({ title: `${modalType === "deposit" ? "Deposit" : "Withdrawal"} successful` });
          queryClient.invalidateQueries({ queryKey: getGetCashDrawerQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetGcashDrawerQueryKey() });
          setModalType(null);
          setAmount("");
          setNote("");
        },
      }
    );
  };

  const isPending = cashDeposit.isPending || cashWithdraw.isPending || gcashDeposit.isPending || gcashWithdraw.isPending;

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-2rem)]">
      <h1 className="text-2xl font-bold tracking-tight text-primary shrink-0">Drawer</h1>

      {/* Balance Cards */}
      <div className="grid grid-cols-2 gap-4 shrink-0">
        <Card className="bg-card">
          <CardContent className="p-6 flex flex-col items-center gap-2">
            <Wallet className="h-7 w-7 text-primary" />
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Cash Balance</p>
            <div className="text-4xl font-black text-primary tracking-tight">
              {cashLoading ? "..." : formatCurrency(cashDrawer?.balance || 0)}
            </div>
            <div className="flex gap-2 mt-2">
              <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-xs" onClick={() => openModal("cash", "deposit")}>
                <ArrowDownToLine className="h-3 w-3" /> Deposit
              </Button>
              <Button size="sm" variant="destructive" className="gap-1 text-xs" onClick={() => openModal("cash", "withdraw")}>
                <ArrowUpFromLine className="h-3 w-3" /> Withdraw
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="p-6 flex flex-col items-center gap-2">
            <Smartphone className="h-7 w-7 text-blue-500" />
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">GCash Balance</p>
            <div className="text-4xl font-black text-blue-500 tracking-tight">
              {gcashLoading ? "..." : formatCurrency(gcashDrawer?.balance || 0)}
            </div>
            <div className="flex gap-2 mt-2">
              <Button size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700 text-xs" onClick={() => openModal("gcash", "deposit")}>
                <ArrowDownToLine className="h-3 w-3" /> Deposit
              </Button>
              <Button size="sm" variant="destructive" className="gap-1 text-xs" onClick={() => openModal("gcash", "withdraw")}>
                <ArrowUpFromLine className="h-3 w-3" /> Withdraw
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Transaction Logs with Tabs */}
      <Card className="flex-1 flex flex-col min-h-0 bg-card">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
          <CardHeader className="py-0 px-0 border-b shrink-0">
            <TabsList className="w-full rounded-none border-b-0 bg-transparent h-auto p-0">
              <TabsTrigger
                value="cash"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 font-semibold"
              >
                <Wallet className="h-4 w-4 mr-2" /> Cash Log
              </TabsTrigger>
              <TabsTrigger
                value="gcash"
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent py-3 font-semibold"
              >
                <Smartphone className="h-4 w-4 mr-2" /> GCash Log
              </TabsTrigger>
            </TabsList>
          </CardHeader>

          <TabsContent value="cash" className="flex-1 overflow-hidden m-0">
            <DrawerTable
              entries={cashDrawer?.entries || []}
              isLoading={cashLoading}
              accentClass="bg-green-600"
            />
          </TabsContent>

          <TabsContent value="gcash" className="flex-1 overflow-hidden m-0">
            <DrawerTable
              entries={gcashDrawer?.entries || []}
              isLoading={gcashLoading}
              accentClass="bg-blue-600"
            />
          </TabsContent>
        </Tabs>
      </Card>

      {/* Deposit / Withdraw Dialog */}
      <Dialog open={modalType !== null} onOpenChange={(open) => !open && setModalType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {modalDrawer === "gcash" ? "GCash" : "Cash"} {modalType === "deposit" ? "Deposit" : "Withdrawal"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Amount (₱)</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || "")}
                className="text-lg font-bold"
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Note / Reason (Optional)</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={modalType === "deposit" ? "e.g. Starting float, received payment" : "e.g. Paid for supplies"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalType(null)}>Cancel</Button>
            <Button
              onClick={handleAction}
              disabled={isPending}
              variant={modalType === "deposit" ? "default" : "destructive"}
              className={modalType === "deposit" ? (modalDrawer === "gcash" ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700") : ""}
            >
              Confirm {modalType === "deposit" ? "Deposit" : "Withdrawal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
