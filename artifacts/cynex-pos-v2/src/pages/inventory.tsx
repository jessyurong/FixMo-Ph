import { useMemo, useState } from "react";
import {
  useListProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  getListProductsQueryKey,
  DEFAULT_REORDER_POINT,
} from "@/lib/offline-api";
import { formatCurrency, rankFirst } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Edit, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type DeviceTab = "all" | "pc" | "printer" | "network";

export default function InventoryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [deviceTab, setDeviceTab] = useState<DeviceTab>("all");

  const { data: allProducts = [], isLoading } = useListProducts({});

  // Per-branch technician grouping: PC/Laptop parts, Printer/Inks, Network/CCTV.
  const tabFiltered = useMemo(() => {
    if (deviceTab === "all") return allProducts;
    const cat = (p: any) => `${p.category || ""} ${p.deviceType || ""}`.toLowerCase();
    if (deviceTab === "pc") return allProducts.filter((p: any) => /pc|part|laptop|desktop|monitor|consumable/i.test(cat(p)));
    if (deviceTab === "printer") return allProducts.filter((p: any) => /print|ink/i.test(cat(p)));
    return allProducts.filter((p: any) => /network|cctv|cat6/i.test(cat(p)));
  }, [allProducts, deviceTab]);

  // Rank-first search: matches float to the top, non-matches stay below.
  const products = useMemo(
    () => rankFirst(tabFiltered, search, (p) => ({ name: String(p.name ?? ""), extra: [p.category] })),
    [tabFiltered, search],
  );

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    category: "",
    deviceType: "Laptop" as string,
    cost: 0,
    sellingPrice: 0,
    stock: 0,
    reorderPoint: DEFAULT_REORDER_POINT,
  });

  const openAdd = () => {
    setEditingId(null);
    setFormData({ name: "", category: "", deviceType: "Laptop", cost: 0, sellingPrice: 0, stock: 0, reorderPoint: DEFAULT_REORDER_POINT });
    setModalOpen(true);
  };

  const openEdit = (product: any) => {
    setEditingId(product.id);
    setFormData({
      name: product.name,
      category: product.category || "",
      deviceType: product.deviceType || "General",
      cost: product.cost,
      sellingPrice: product.sellingPrice,
      stock: product.stock,
      reorderPoint: product.reorderPoint ?? DEFAULT_REORDER_POINT,
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!formData.name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }

    const onSuccess = () => {
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      setModalOpen(false);
      toast({ title: "Saved successfully" });
    };

    if (editingId) {
      updateProduct.mutate({ id: editingId, data: formData }, { onSuccess });
    } else {
      createProduct.mutate({ data: formData }, { onSuccess });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this product?")) {
      deleteProduct.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: "Deleted successfully" });
        },
      });
    }
  };

  const deviceTypeBadge = (dt: string) => {
    const label = dt || "General";
    return <Badge variant="secondary" className="text-[10px]">{label}</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Inventory</h1>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Add Product
        </Button>
      </div>

      <Tabs value={deviceTab} onValueChange={(v) => setDeviceTab(v as DeviceTab)}>
        <TabsList>
          <TabsTrigger value="all">All Parts</TabsTrigger>
          <TabsTrigger value="pc">PC / Laptop</TabsTrigger>
          <TabsTrigger value="printer">Printer / Ink</TabsTrigger>
          <TabsTrigger value="network">Network / CCTV</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-4">
          <div className="relative max-w-md mb-4">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products by name or category..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Device</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Selling Price</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-center">Stock</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : products.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No products found</TableCell></TableRow>
              ) : (
                products.map((product) => {
                  const reorderPoint = (product as any).reorderPoint ?? DEFAULT_REORDER_POINT;
                  const reserved = (product as any).reservedStock ?? 0;
                  const available = Math.max(0, (product.stock ?? 0) - reserved);
                  const outOfStock = available === 0;
                  const lowStock = !outOfStock && available <= reorderPoint;
                  const cost = product.cost ?? 0;
                  const sellingPrice = (product as any).sellingPrice ?? product.price ?? 0;
                  return (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell>{product.category}</TableCell>
                      <TableCell>{deviceTypeBadge(product.deviceType || "General")}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cost)}</TableCell>
                      <TableCell className="text-right font-semibold text-primary">{formatCurrency(sellingPrice)}</TableCell>
                      <TableCell className="text-right text-green-500">{formatCurrency(sellingPrice - cost)}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Badge
                            variant={outOfStock ? "destructive" : lowStock ? "secondary" : "default"}
                            className={lowStock ? "bg-amber-500 hover:bg-amber-600 text-white" : outOfStock ? "" : "bg-green-600 hover:bg-green-700"}
                          >
                            {outOfStock ? "0 · OUT" : lowStock ? `${available} · LOW` : available}
                          </Badge>
                          {reserved > 0 && (
                            <span className="text-[10px] text-muted-foreground">({reserved} res.)</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(product)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/20" onClick={() => product.id && handleDelete(product.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Product" : "Add New Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Product Name</Label>
              <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. 512GB SSD, Epson 664 Ink" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Input value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} placeholder="e.g. PC Parts, Inks, CCTV" />
              </div>
              <div className="space-y-2">
                <Label>Unit Type</Label>
                <Select value={formData.deviceType} onValueChange={(v) => setFormData({ ...formData, deviceType: v as any })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Laptop">Laptop</SelectItem>
                    <SelectItem value="Desktop">Desktop</SelectItem>
                    <SelectItem value="Printer">Printer</SelectItem>
                    <SelectItem value="Network">Network</SelectItem>
                    <SelectItem value="CCTV">CCTV</SelectItem>
                    <SelectItem value="Monitor">Monitor</SelectItem>
                    <SelectItem value="General">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cost (₱)</Label>
                <Input type="number" value={formData.cost || ""} onChange={(e) => setFormData({ ...formData, cost: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="space-y-2">
                <Label>Selling Price (₱)</Label>
                <Input type="number" value={formData.sellingPrice || ""} onChange={(e) => setFormData({ ...formData, sellingPrice: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Stock Quantity</Label>
                <Input type="number" value={formData.stock || ""} onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="space-y-2">
                <Label>Low Stock Threshold</Label>
                <Input type="number" value={formData.reorderPoint || ""} onChange={(e) => setFormData({ ...formData, reorderPoint: parseInt(e.target.value) || 1 })} placeholder={`${DEFAULT_REORDER_POINT}`} />
                <p className="text-xs text-muted-foreground">Alert when stock is at or below this level</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createProduct.isPending || updateProduct.isPending}>Save Product</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
