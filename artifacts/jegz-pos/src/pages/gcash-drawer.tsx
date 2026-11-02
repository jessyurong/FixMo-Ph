import { useState } from "react";
import {
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowDownToLine, ArrowUpFromLine, Smartphone } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function GcashDrawerPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: drawer, isLoading } = useGetGcashDrawer();

  const deposit = useGcashDeposit();
  const withdraw = useGcashWithdraw();

  const [modalType, setModalType] = useState<"deposit" | "withdraw" | null>(null);
  const [amount, setAmount] = useState<number | "">("");
  const [note, setNote] = useState("");

  const handleAction = () => {
    if (!amount || amount <= 0) {
      toast({ title: "Please enter a valid amount", variant: "destructive" });
      return;
    }
    if (modalType === "withdraw" && amount > (drawer?.balance || 0)) {
      toast({ title: "Insufficient GCash balance", variant: "destructive" });
      return;
    }

    const mutation = modalType === "deposit" ? deposit : withdraw;
    mutation.mutate(
      { data: { amount: amount as number, note } },
      {
        onSuccess: () => {
          toast({ title: `${modalType === "deposit" ? "Deposit" : "Withdrawal"} successful` });
          queryClient.invalidateQueries({ queryKey: getGetGcashDrawerQueryKey() });
          setModalType(null);
          setAmount("");
          setNote("");
        },
      }
    );
  };

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-2rem)]">
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-primary">GCash Drawer</h1>
        <div className="flex gap-2">
          <Button onClick={() => setModalType("deposit")} className="gap-2 bg-blue-600 hover:bg-blue-700">
            <ArrowDownToLine className="h-4 w-4" /> Deposit
          </Button>
          <Button onClick={() => setModalType("withdraw")} variant="destructive" className="gap-2">
            <ArrowUpFromLine className="h-4 w-4" /> Withdraw
          </Button>
        </div>
      </div>

      <Card className="bg-card shrink-0">
        <CardContent className="p-8 flex items-center justify-center flex-col gap-2">
          <Smartphone className="h-8 w-8 text-blue-500 mb-2" />
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
            GCash Balance
          </h2>
          <div className="text-5xl font-black text-blue-500 tracking-tight">
            {isLoading ? "..." : formatCurrency(drawer?.balance || 0)}
          </div>
        </CardContent>
      </Card>

      <Card className="flex-1 flex flex-col min-h-0 bg-card">
        <CardHeader className="py-4 border-b shrink-0">
          <CardTitle>GCash Transaction Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-hidden">
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
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">Loading...</TableCell>
                  </TableRow>
                ) : !drawer?.entries?.length ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No GCash activity found
                    </TableCell>
                  </TableRow>
                ) : (
                  drawer.entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-muted-foreground">{formatDate(entry.createdAt)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={entry.type === "sale" ? "default" : entry.type === "deposit" ? "secondary" : "destructive"}
                          className={entry.type === "deposit" ? "bg-blue-600 hover:bg-blue-700 text-white" : entry.type === "sale" ? "bg-blue-500 hover:bg-blue-600" : ""}
                        >
                          {entry.type.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>{entry.note || "-"}</TableCell>
                      <TableCell
                        className={`text-right font-bold ${
                          entry.type === "withdraw" ? "text-destructive" : "text-blue-500"
                        }`}
                      >
                        {entry.type === "withdraw" ? "-" : "+"}
                        {formatCurrency(entry.amount)}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        {formatCurrency(entry.runningBalance)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={modalType !== null} onOpenChange={(open) => !open && setModalType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>GCash {modalType === "deposit" ? "Deposit" : "Withdrawal"}</DialogTitle>
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
              />
            </div>
            <div className="space-y-2">
              <Label>Note / Reason (Optional)</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={modalType === "deposit" ? "e.g. GCash received" : "e.g. Transfer to bank"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalType(null)}>Cancel</Button>
            <Button
              onClick={handleAction}
              disabled={deposit.isPending || withdraw.isPending}
              className={modalType === "deposit" ? "bg-blue-600 hover:bg-blue-700" : ""}
              variant={modalType === "deposit" ? "default" : "destructive"}
            >
              Confirm {modalType === "deposit" ? "Deposit" : "Withdrawal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
