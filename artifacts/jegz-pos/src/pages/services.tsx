import { useMemo, useState } from "react";
import {
  useListServices,
  useCreateService,
  useUpdateService,
  useDeleteService,
  serviceService,
  getListServicesQueryKey,
  SERVICE_CATEGORIES,
} from "@/lib/offline-api";
import { formatCurrency, cn, rankFirst } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit, Trash2, Search, Wrench, Power, PowerOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type ServiceForm = {
  name: string;
  category: string;
  price: string;
  cost: string;
  active: boolean;
};

const EMPTY_FORM: ServiceForm = {
  name: "",
  category: "General",
  price: "",
  cost: "",
  active: true,
};

function typeFromCategory(category: string): string {
  const slug = category.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "general";
}

export default function ServicesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: services = [], isLoading } = useListServices();

  const createService = useCreateService();
  const updateService = useUpdateService();
  const deleteService = useDeleteService();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ServiceForm>(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const knownCategories = useMemo(() => {
    const set = new Set<string>();
    for (const s of services) {
      const c = s.category && String(s.category).trim();
      if (c) set.add(c);
    }
    for (const c of SERVICE_CATEGORIES) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [services]);

  const filtered = useMemo(() => {
    // Category/status dropdowns still filter strictly; free text is rank-first
    // (matches float to the top, the rest stay below).
    const narrowed = services.filter((s) => {
      if (categoryFilter !== "all" && String(s.category ?? "") !== categoryFilter) return false;
      const active = s.active !== false;
      if (statusFilter === "active" && !active) return false;
      if (statusFilter === "inactive" && active) return false;
      return true;
    });
    return rankFirst(narrowed, search, (s) => ({ name: String(s.name ?? ""), extra: [s.category] }));
  }, [services, search, categoryFilter, statusFilter]);

  const activeCount = services.filter((s) => s.active !== false).length;

  const openAdd = () => {
    setEditingId(null);
    setFormData({ ...EMPTY_FORM, category: knownCategories[0] || "General" });
    setModalOpen(true);
  };

  const openEdit = (service: { id: number; name: string; category?: string; type?: string; price: number; cost?: number; active?: boolean }) => {
    setEditingId(service.id);
    setFormData({
      name: service.name,
      category: service.category && String(service.category).trim() ? service.category : "General",
      price: String(service.price ?? ""),
      cost: typeof service.cost === "number" ? String(service.cost) : "",
      active: service.active !== false,
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    const name = formData.name.trim();
    if (!name) {
      toast({ title: "Service name is required", variant: "destructive" });
      return;
    }
    const price = Number(formData.price);
    if (!Number.isFinite(price) || price < 0) {
      toast({ title: "Enter a valid price", variant: "destructive" });
      return;
    }
    const cost = formData.cost.trim() === "" ? 0 : Number(formData.cost);
    if (!Number.isFinite(cost) || cost < 0) {
      toast({ title: "Enter a valid direct cost", variant: "destructive" });
      return;
    }
    const category = formData.category.trim() || "General";
    const data = {
      name,
      category,
      price,
      cost,
      active: formData.active,
      type: typeFromCategory(category),
    };

    const onSuccess = () => {
      queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
      setModalOpen(false);
      toast({ title: editingId ? "Service updated" : "Service added" });
    };

    if (editingId) {
      updateService.mutate({ id: editingId, data }, { onSuccess });
    } else {
      createService.mutate({ data }, { onSuccess });
    }
  };

  const handleToggleActive = (id: number, active: boolean) => {
    updateService.mutate(
      { id, data: { active } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
          toast({ title: active ? "Service activated" : "Service deactivated" });
        },
      },
    );
  };

  const handleDelete = async (service: { id: number; name: string; active?: boolean }) => {
    const references = await serviceService.countReferences(service.id);
    if (references > 0) {
      toast({
        title: "Cannot delete this service",
        description: `It is referenced by ${references} historical transaction item${references === 1 ? "" : "s"}. Deactivate it instead — historical jobs stay unchanged.`,
        variant: "destructive",
      });
      return;
    }
    if (!window.confirm(`Are you sure you want to delete "${service.name}"?`)) return;
    deleteService.mutate(
      { id: service.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
          toast({ title: "Service deleted" });
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <Wrench className="h-4 w-4" />
            Service catalog
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Labor Services</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This is the single source of truth for services. POS, reports, and profit use the same catalog — {activeCount} of {services.length} services are active.
          </p>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Add Service
        </Button>
      </div>

      <Card className="bg-card">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4 text-primary" />
            Available services
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search services..."
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {knownCategories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | "active" | "inactive")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service Name</TableHead>
                  <TableHead className="w-[140px]">Category</TableHead>
                  <TableHead className="text-right">Labor Price</TableHead>
                  <TableHead className="text-right">Direct Cost</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="text-right w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No services match your filters</TableCell></TableRow>
                ) : (
                  filtered.map((service) => {
                    const active = service.active !== false;
                    const cost = typeof service.cost === "number" ? service.cost : 0;
                    const profit = Math.max(0, (service.price || 0) - cost);
                    return (
                      <TableRow key={service.id} className={cn(!active && "opacity-50")}>
                        <TableCell className="font-medium">{service.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{service.category || "—"}</TableCell>
                        <TableCell className="text-right font-semibold text-primary">{formatCurrency(service.price || 0)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{cost > 0 ? formatCurrency(cost) : "—"}</TableCell>
                        <TableCell className="text-right text-green-600">{formatCurrency(profit)}</TableCell>
                        <TableCell>
                          <Badge variant={active ? "default" : "secondary"} className="gap-1">
                            {active ? <Power className="h-3 w-3" /> : <PowerOff className="h-3 w-3" />}
                            {active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(service)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/20" onClick={() => handleDelete(service)}>
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
          </div>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={(open) => { if (!createService.isPending && !updateService.isPending) setModalOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Service" : "Add New Service"}</DialogTitle>
            <DialogDescription>
              Changes here update the catalog that POS reads when creating new sales. Historical transactions keep the prices they were sold at.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="service-name">Service Name</Label>
              <Input id="service-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Screen Replacement" />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {knownCategories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="service-price">Labor Price (₱)</Label>
                <Input id="service-price" type="number" min={0} value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="service-cost">Direct Cost (₱) — optional</Label>
                <Input id="service-cost" type="number" min={0} value={formData.cost} onChange={(e) => setFormData({ ...formData, cost: e.target.value })} placeholder="0 for pure labor" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive services are hidden from new POS sales.</p>
              </div>
              <Switch checked={formData.active} onCheckedChange={(checked) => setFormData({ ...formData, active: checked })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createService.isPending || updateService.isPending}>
              {editingId ? "Save Changes" : "Add Service"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}