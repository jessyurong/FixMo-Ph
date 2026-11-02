import { useState } from "react";
import { 
  useListDefectiveItems, 
  useCreateDefectiveItem, 
  useListProducts,
  getListDefectiveItemsQueryKey,
  getListProductsQueryKey
} from "@/lib/offline-api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function DefectiveItemsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: defectiveItems = [], isLoading } = useListDefectiveItems();
  const { data: products = [] } = useListProducts();
  
  const createDefectiveItem = useCreateDefectiveItem();

  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    productId: null as number | null,
    quantity: 1,
    reason: ""
  });

  const totalLoss = defectiveItems.reduce((sum, item) => sum + Number(item.totalLoss || 0), 0);

  const handleSave = () => {
    if (!formData.productId) {
      toast({ title: "Please select a product", variant: "destructive" });
      return;
    }
    if (!formData.reason) {
      toast({ title: "Reason is required", variant: "destructive" });
      return;
    }
    if (formData.quantity < 1) {
      toast({ title: "Quantity must be at least 1", variant: "destructive" });
      return;
    }

    const product = products.find(p => p.id === formData.productId);
    if (product && product.stock < formData.quantity) {
      toast({ title: `Not enough stock (Current: ${product.stock})`, variant: "destructive" });
      return;
    }

    createDefectiveItem.mutate({ data: {
      productId: formData.productId,
      quantity: formData.quantity,
      reason: formData.reason
    }}, { 
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDefectiveItemsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setModalOpen(false);
        setFormData({ productId: null, quantity: 1, reason: "" });
        toast({ title: "Defective item logged successfully" });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Defective Items</h1>
        <Button onClick={() => setModalOpen(true)} variant="destructive" className="gap-2">
          <Plus className="h-4 w-4" /> Log Defective Item
        </Button>
      </div>

      <Card className="bg-destructive/10 border-l-4 border-l-destructive shrink-0">
        <CardContent className="p-6 flex items-center gap-4">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <div>
            <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Total Inventory Loss</h2>
            <div className="text-3xl font-black text-destructive tracking-tight">
              {formatCurrency(totalLoss)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Defective Items Log</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-center">Qty</TableHead>
                <TableHead className="text-right">Cost/Unit</TableHead>
                <TableHead className="text-right">Total Loss</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : defectiveItems.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No defective items logged</TableCell></TableRow>
              ) : (
                defectiveItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-muted-foreground">{formatDate(String(item.createdAt || ''))}</TableCell>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell className="text-center font-bold text-destructive">{item.quantity}</TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(item.costPerUnit || 0))}</TableCell>
                    <TableCell className="text-right font-bold text-destructive">{formatCurrency(Number(item.totalLoss || 0))}</TableCell>
                    <TableCell className="text-muted-foreground">{item.reason}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Defective Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-amber-500/10 text-amber-500 p-3 rounded text-sm mb-4">
              Logging a defective item will automatically deduct the quantity from inventory stock.
            </div>
            <div className="space-y-2">
              <Label>Product / Part</Label>
              <Select value={formData.productId?.toString() || ""} onValueChange={v => setFormData({...formData, productId: parseInt(v)})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {products.map(p => p.id ? (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.name} (Stock: {p.stock})
                    </SelectItem>
                  ) : null)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input 
                type="number" 
                value={formData.quantity || ""} 
                onChange={e => setFormData({...formData, quantity: parseInt(e.target.value) || 0})} 
              />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input 
                value={formData.reason} 
                onChange={e => setFormData({...formData, reason: e.target.value})} 
                placeholder="e.g. Broken screen out of the box" 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createDefectiveItem.isPending} variant="destructive">
              Log as Defective
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}