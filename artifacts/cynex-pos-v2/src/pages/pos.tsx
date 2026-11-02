import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import {
  useGetServices,
  useGetProducts,
  useGetTechnicians,
  useGetSettings,
  useSavePendingJob,
  useUpdatePendingJob,
  useCompleteTransaction,
  useCreateService,
  useCreateProduct,
  useGetTransactionRaw,
  useGetTransactionItems,
  useCustomerNameSuggestions,
  usePhoneModelSuggestions,
  type JobCompletionResult,
  type TransactionItem,
  type TransactionStatus,
} from "@/lib/offline-api";
import { formatCurrency } from "@/lib/utils";
import { printJobSlip, printReceipt, type PrintSource } from "@/lib/printing";
import { useShopProfile } from "@/lib/offline-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Minus,
  Plus,
  Trash2,
  ShoppingCart,
  Search,
  Wrench,
  Package,
  CreditCard,
  Banknote,
  CheckCircle2,
  X,
  Save,
  Clock,
  PackagePlus,
  PenLine,
  Tag,
  Printer,
} from "lucide-react";

type CartItem = {
  id: string | number;
  refId: number;
  name: string;
  price: number;
  quantity: number;
  type: "service" | "product";
  stock?: number;
  cost?: number;
  isPreOrder?: boolean;
  basePrice?: number;
  markupPercentage?: number;
  markupAmount?: number;
  isCustom?: boolean;
  savedToList?: boolean;
  notes?: string;
};

type EditingJob = {
  id: number;
  jobNumber: string;
  status: TransactionStatus;
  amountPaid: number;
  trackingToken?: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const OPEN_JOB_KEY = "jegz_open_job";

export default function PosPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const shopProfile = useShopProfile();

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeTab, setActiveTab] = useState<"services" | "products">("services");
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [phoneBrand, setPhoneBrand] = useState("");
  const [phoneModel, setPhoneModel] = useState("");
  const [devicePasscode, setDevicePasscode] = useState("");
  const [technician, setTechnician] = useState("");
  const [notes, setNotes] = useState("");
  const [customerComplaint, setCustomerComplaint] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [technicianNotes, setTechnicianNotes] = useState("");

  const [paymentMethod, setPaymentMethod] = useState<"cash" | "gcash">("cash");
  const [deposit, setDeposit] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<JobCompletionResult | null>(null);
  const [pendingSlip, setPendingSlip] = useState<PrintSource | null>(null);
  const [editingJob, setEditingJob] = useState<EditingJob | null>(null);
  const [openingJob, setOpeningJob] = useState(false);

  // Custom item dialogs
  const [customServiceOpen, setCustomServiceOpen] = useState(false);
  const [serviceForm, setServiceForm] = useState({ name: "", price: "0", notes: "", saveToList: false });
  const [customProductOpen, setCustomProductOpen] = useState(false);
  const [productForm, setProductForm] = useState({ name: "", cost: "0", price: "0", quantity: "1", saveToList: false });

  const savePendingJob = useSavePendingJob();
  const updatePendingJob = useUpdatePendingJob();
  const completeTransaction = useCompleteTransaction();
  const createService = useCreateService();
  const createProduct = useCreateProduct();

  const { data: settings } = useGetSettings();
  const preOrderMarkup = useMemo(() => {
    const value = Number(settings?.preOrderMarkup);
    return Number.isFinite(value) && value >= 0 ? value : 20;
  }, [settings]);

  const { data: rawServices } = useGetServices();
  const { data: rawProducts } = useGetProducts();
  const { data: rawTechnicians } = useGetTechnicians();
  const { data: customerNameOptions = [] } = useCustomerNameSuggestions();
  const { data: phoneModelOptions = [] } = usePhoneModelSuggestions();

  // Only active services are selectable for new sales; inactive ones remain in
  // historical transactions unchanged.
  const services = Array.isArray(rawServices)
    ? rawServices.filter((s) => s.active !== false)
    : [];
  const products = Array.isArray(rawProducts) ? rawProducts : [];
  const technicians = Array.isArray(rawTechnicians) ? rawTechnicians : [];

  /*
   * OPEN A PENDING JOB (from Transactions: "Open in POS")
   * The transactions page stores the id in sessionStorage right before navigating.
   */
  const openedJobId = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(OPEN_JOB_KEY);
      return raw ? Number(raw) : undefined;
    } catch {
      return undefined;
    }
  }, []);

  const { data: openedTransaction } = useGetTransactionRaw(openedJobId);
  const { data: openedItems } = useGetTransactionItems(openedJobId);

  useEffect(() => {
    if (!openedJobId || !openedTransaction || !openedItems) return;
    const tx = openedTransaction;
    if (cart.length > 0) return; // never overwrite an active sale

    setEditingJob({
      id: tx.id,
      jobNumber: tx.jobNumber || "",
      status: (tx.status || "received") as TransactionStatus,
      amountPaid: tx.amountPaid || 0,
      trackingToken: tx.trackingToken,
    });
    setCustomerName(tx.customerName || tx.customer || "");
    setCustomerPhone(tx.customerPhone || "");
    setCustomerEmail(tx.customerEmail || "");
    setPhoneBrand(tx.phoneBrand || "");
    setDevicePasscode((tx as any).devicePasscode || "");
    setPhoneModel(tx.phoneModel || "");
    setTechnician(tx.technicianId ? String(tx.technicianId) : "");
    setNotes(tx.notes || "");
    setCustomerComplaint(tx.customerComplaint || "");
    setDiagnosis(tx.diagnosis || "");
    setTechnicianNotes(tx.technicianNotes || "");
    setPaymentMethod((tx.paymentMethod as "cash" | "gcash") || "cash");
    setDeposit(String(tx.amountPaid || 0));

    const restored: CartItem[] = openedItems
      .sort((a, b) => (a.id || 0) - (b.id || 0))
      .map((item) => ({
        id: item.refId || item.name,
        refId: item.refId || 0,
        name: item.name,
        price: item.price || 0,
        quantity: item.quantity || 1,
        type: item.type === "service" ? "service" : "product",
        cost: item.cost,
        isPreOrder: item.isPreOrder,
        basePrice: item.basePrice,
        markupPercentage: item.markupPercentage,
        markupAmount: item.markupAmount,
        isCustom: item.isCustom,
        savedToList: item.savedToList,
        notes: item.notes,
      }));
    setCart(restored);
    setOpeningJob(true);
    try {
      sessionStorage.removeItem(OPEN_JOB_KEY);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedJobId, openedTransaction, openedItems]);

  /*
   * SEARCH
   */
  const filteredServices = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return services;
    return services.filter((s) => String(s.name ?? "").toLowerCase().includes(term));
  }, [services, search]);

  const filteredProducts = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return products;
    return products.filter((p) => String(p.name ?? "").toLowerCase().includes(term));
  }, [products, search]);

  const availableOf = (product: any) => {
    const stock = Number(product?.stock ?? 0);
    const reserved = Number(product?.reservedStock ?? 0);
    return Math.max(0, stock - reserved);
  };

  /*
   * CART
   */
  const addToCart = (item: any, type: "service" | "product", asPreOrder = false) => {
    const itemId = item.id ?? item._id ?? item.name;
    const basePrice = Number(item.price ?? item.sellingPrice ?? item.amount ?? 0);
    const availableStock = type === "product" ? availableOf(item) : undefined;
    const finalPrice = asPreOrder
      ? round2(basePrice + (basePrice * preOrderMarkup) / 100)
      : basePrice;

    setCart((currentCart) => {
      const existingIndex = currentCart.findIndex(
        (row) => row.id === itemId && row.type === type && Boolean(row.isPreOrder) === asPreOrder,
      );

      if (existingIndex >= 0) {
        const updated = [...currentCart];
        if (
          type === "product" &&
          !asPreOrder &&
          availableStock !== undefined &&
          updated[existingIndex].quantity >= availableStock
        ) {
          return currentCart;
        }
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + 1,
        };
        return updated;
      }

      const row: CartItem = {
        id: itemId,
        refId: type === "product" ? Number(item.id ?? item._id ?? 0) : Number(item.id ?? item._id ?? 0),
        name: item.name ?? item.serviceName ?? item.productName ?? "Unnamed Item",
        price: finalPrice,
        quantity: 1,
        type,
        stock: availableStock,
        // Services always carry a numeric cost (0 for pure labor) so profit is
        // computed as Price - DirectCost and never falls back to the parts margin.
        cost: type === "service" ? Number(item.cost) || 0 : Number(item.cost) > 0 ? Number(item.cost) : undefined,
        isPreOrder: asPreOrder,
        basePrice: asPreOrder ? basePrice : undefined,
        markupPercentage: asPreOrder ? preOrderMarkup : undefined,
        markupAmount: asPreOrder ? round2((basePrice * preOrderMarkup) / 100) : undefined,
      };
      return [...currentCart, row];
    });
  };

  const updateQuantity = (id: string | number, type: "service" | "product", change: number, isPreOrder: boolean) => {
    setCart((currentCart) =>
      currentCart
        .map((item) => {
          if (item.id !== id || item.type !== type || Boolean(item.isPreOrder) !== isPreOrder) return item;
          const newQuantity = item.quantity + change;
          if (newQuantity < 1) return null;
          if (item.type === "product" && !isPreOrder && item.stock !== undefined && newQuantity > item.stock) return item;
          return { ...item, quantity: newQuantity };
        })
        .filter((item): item is CartItem => item !== null),
    );
  };

  const removeFromCart = (id: string | number, type: "service" | "product", isPreOrder: boolean) => {
    setCart((currentCart) =>
      currentCart.filter(
        (item) => !(item.id === id && item.type === type && Boolean(item.isPreOrder) === isPreOrder),
      ),
    );
  };

  const clearCart = () => {
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerEmail("");
    setPhoneBrand("");
    setDevicePasscode("");
    setPhoneModel("");
    setTechnician("");
    setNotes("");
    setCustomerComplaint("");
    setDiagnosis("");
    setTechnicianNotes("");
    setDeposit("");
    setCashReceived("");
    setPaymentMethod("cash");
    setEditingJob(null);
    setOpeningJob(false);
    setReceipt(null);
    setPendingSlip(null);
  };

  /*
   * TOTALS
   */
  const subtotal = cart.reduce((total, item) => total + Number(item.price || 0) * item.quantity, 0);
  const totalItems = cart.reduce((total, item) => total + item.quantity, 0);
  const totalDeposit = round2(Number(deposit) || 0);
  const hasPreOrder = cart.some((item) => item.isPreOrder);
  const alreadyPaid = editingJob?.amountPaid || 0;
  const remainingDue = Math.max(0, round2(subtotal - alreadyPaid));
  const depositInputValue = totalDeposit > 0 || editingJob ? totalDeposit : round2(Number(deposit) || 0);

  /*
   * CUSTOM ITEMS
   */
  const addCustomService = async () => {
    const name = serviceForm.name.trim();
    const price = round2(Number(serviceForm.price) || 0);
    if (!name || price <= 0) {
      toast({ title: "Enter a service name and price", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      let refId = 0;
      if (serviceForm.saveToList) {
        refId = await createService.mutateAsync({
          data: { name, price, cost: 0, type: "custom" },
        });
      }
      setCart((current) => [
        ...current,
        {
          id: `custom-service-${Date.now()}`,
          refId,
          name,
          price,
          quantity: 1,
          type: "service",
          isCustom: true,
          savedToList: serviceForm.saveToList,
          notes: serviceForm.notes.trim() || undefined,
        },
      ]);
      setServiceForm({ name: "", price: "0", notes: "", saveToList: false });
      setCustomServiceOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addCustomProduct = async (asPreOrder = false) => {
    const name = productForm.name.trim();
    const price = round2(Number(productForm.price) || 0);
    const cost = round2(Number(productForm.cost) || 0);
    if (!name || price <= 0) {
      toast({ title: "Enter a product name and selling price", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      let refId = 0;
      if (productForm.saveToList) {
        refId = await createProduct.mutateAsync({
          data: {
            name,
            price,
            cost,
            stock: Math.max(1, Number(productForm.quantity) || 1),
          },
        });
      }
      const qty = Math.max(1, Number(productForm.quantity) || 1);
      const finalPrice = asPreOrder ? round2(price + (price * preOrderMarkup) / 100) : price;
      setCart((current) => [
        ...current,
        {
          id: `custom-product-${Date.now()}`,
          refId,
          name,
          price: finalPrice,
          quantity: qty,
          type: "product",
          cost,
          isCustom: true,
          savedToList: productForm.saveToList,
          isPreOrder: asPreOrder,
          basePrice: asPreOrder ? price : undefined,
          markupPercentage: asPreOrder ? preOrderMarkup : undefined,
          markupAmount: asPreOrder ? round2((price * preOrderMarkup) / 100) : undefined,
        },
      ]);
      setProductForm({ name: "", cost: "0", price: "0", quantity: "1", saveToList: false });
      setCustomProductOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  /*
   * JOB INPUT BUILDING
   */
  const buildJobInput = () => ({
    customerName: customerName.trim() || "Walk-in",
    customerPhone: customerPhone.trim() || undefined,
    customerEmail: customerEmail.trim() || undefined,
    phoneBrand: phoneBrand.trim() || undefined,
    phoneModel: phoneModel.trim() || undefined,
    devicePasscode: devicePasscode.trim() || undefined,
    technicianId: technician ? Number(technician) : undefined,
    technicianName: technician ? technicians.find((t) => String(t.id) === technician)?.name : undefined,
    notes: notes.trim() || undefined,
    customerComplaint: customerComplaint.trim() || undefined,
    diagnosis: diagnosis.trim() || undefined,
    technicianNotes: technicianNotes.trim() || undefined,
    paymentMethod,
    items: cart.map((item) => ({
      type: item.type,
      refId: item.refId,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      subtotal: round2(item.price * item.quantity),
      cost: item.cost,
      isPreOrder: item.isPreOrder,
      basePrice: item.basePrice,
      markupPercentage: item.markupPercentage,
      markupAmount: item.markupAmount,
      isCustom: item.isCustom,
      savedToList: item.savedToList,
      notes: item.notes,
    })),
    total: subtotal,
  });

  /*
   * SAVE AS PENDING / SAVE CHANGES
   */
  const buildSlipSource = (job: { id: number; jobNumber: string }): PrintSource => ({
    jobNumber: job.jobNumber,
    status: editingJob?.status || "received",
    customerName: customerName.trim() || "Walk-in",
    customerPhone: customerPhone.trim() || undefined,
    customerEmail: customerEmail.trim() || undefined,
    trackingToken: editingJob?.trackingToken,
    phoneBrand: phoneBrand.trim() || undefined,
    phoneModel: phoneModel.trim() || undefined,
    devicePasscode: devicePasscode.trim() || undefined,
    technicianName: technician ? technicians.find((t) => String(t.id) === technician)?.name : undefined,
    createdAt: new Date().toISOString(),
    items: cart.map((item) => ({
      type: item.type,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      isPreOrder: item.isPreOrder,
      isCustom: item.isCustom,
    })),
    total: subtotal,
    amountPaid: editingJob ? Math.max(alreadyPaid, totalDeposit) : totalDeposit,
    remainingBalance: Math.max(0, round2(subtotal - (editingJob ? Math.max(alreadyPaid, totalDeposit) : totalDeposit))),
    paymentMethod,
    hasPreOrder,
  });

  const handleSavePending = async () => {
    if (cart.length === 0) return;
    if (!phoneModel.trim()) {
      toast({
        title: "Phone model is required",
        description: "Enter the customer's phone model first.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      const input = {
        ...buildJobInput(),
        amountPaid: editingJob ? undefined : totalDeposit,
      };
      let result: { id: number; jobNumber: string };
      if (editingJob) {
        result = await updatePendingJob.mutateAsync({
          id: editingJob.id,
          data: input,
          status: editingJob.status,
          additionalDeposit: Math.max(0, totalDeposit - alreadyPaid),
          additionalDepositMethod: paymentMethod,
        });
        toast({
          title: "Pending job updated",
          description: `${result.jobNumber} was saved with your changes.`,
        });
      } else {
        result = await savePendingJob.mutateAsync(input);
        toast({
          title: "Job saved",
          description: `${result.jobNumber} was created. You can finish it later in Transactions.`,
        });
      }
      setPendingSlip(buildSlipSource(result));
      setCheckoutOpen(false);
      setEditingJob(null);
      setOpeningJob(false);
    } catch (error) {
      toast({
        title: "Could not save pending job",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  /*
   * COMPLETE SALE
   */
  const handleComplete = async () => {
    if (cart.length === 0) return;
    if (!phoneModel.trim()) {
      toast({
        title: "Phone model is required",
        description: "Enter the customer's phone model before completing the sale.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      const input = buildJobInput();
      const proceedablePayment = editingJob ? 0 : totalDeposit;
      const cash = round2(Number(cashReceived));
      const result = await completeTransaction.mutateAsync({
        id: editingJob?.id,
        data: { ...input, amountPaid: proceedablePayment },
        paymentMethod,
        cashReceived:
          paymentMethod === "cash"
            ? cash > 0
              ? cash
              : round2(editingJob ? remainingDue : subtotal)
            : undefined,
      });
      setCheckoutOpen(false);
      setReceipt(result);
      setEditingJob(null);
      setOpeningJob(false);
    } catch (error) {
      toast({
        title: "Could not complete the sale",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const loading = activeTab === "services" ? services.length === 0 : products.length === 0;
  const displayItems = activeTab === "services" ? filteredServices : filteredProducts;

  const statusBadge = (status?: TransactionStatus) => {
    const map: Record<string, { label: string; cls: string }> = {
      received: { label: "RECEIVED", cls: "bg-amber-500 text-white" },
      diagnosing: { label: "DIAGNOSING", cls: "bg-blue-500 text-white" },
      waiting_parts: { label: "WAITING FOR PARTS", cls: "bg-violet-500 text-white" },
      repairing: { label: "REPAIRING", cls: "bg-cyan-600 text-white" },
      ready: { label: "READY", cls: "bg-emerald-600 text-white" },
      complete: { label: "COMPLETE", cls: "bg-green-600 text-white" },
      cancelled: { label: "CANCELLED", cls: "bg-slate-500 text-white" },
    };
    const entry = map[(status || "").toString().replace(/-/g, "_")] || map.received;
    return <Badge className={entry.cls}>{entry.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      {editingJob && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">
                Editing job <span className="font-mono text-primary">{editingJob.jobNumber}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Changes you save here update the existing job — no duplicate is created.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(editingJob.status)}
            <Button variant="outline" size="sm" onClick={clearCart}>
              Cancel edit
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* LEFT SIDE */}
        <div className="flex-1 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-primary">Point of Sale</h1>
              <p className="text-sm text-muted-foreground">
                {editingJob ? "Update the job or complete it when ready" : "Add services and products to the transaction"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomServiceOpen(true)} className="gap-2">
                <PenLine className="h-4 w-4" /> Custom Service
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomProductOpen(true)} className="gap-2">
                <PackagePlus className="h-4 w-4" /> Custom Product
              </Button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${activeTab}...`}
              className="pl-9"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={activeTab === "services" ? "default" : "outline"}
              onClick={() => setActiveTab("services")}
              className="gap-2"
            >
              <Wrench className="h-4 w-4" /> Services
            </Button>
            <Button
              type="button"
              variant={activeTab === "products" ? "default" : "outline"}
              onClick={() => setActiveTab("products")}
              className="gap-2"
            >
              <Package className="h-4 w-4" /> Products
            </Button>
          </div>

          {openingJob && displayItems.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">Loading...</div>
          ) : displayItems.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No {activeTab} found{loading ? " — still loading..." : ""}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {displayItems.map((item: any) => {
                const itemId = item.id ?? item._id ?? item.name;
                const name = item.name ?? item.serviceName ?? item.productName ?? "Unnamed Item";
                const price = Number(item.price ?? item.sellingPrice ?? item.amount ?? 0);
                const isProduct = activeTab === "products";
                const avails = isProduct ? availableOf(item) : undefined;
                const outOfStock = isProduct && typeof avails === "number" && avails <= 0;

                return (
                  <Card key={itemId} className={outOfStock ? "opacity-60" : ""}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-end justify-between gap-2">
                        <div>
                          <p className="text-lg font-bold text-primary">{formatCurrency(price)}</p>
                          {isProduct && avails !== undefined && (
                            <p className="text-xs text-muted-foreground">
                              Stock: {avails}
                              {Number(item.reservedStock || 0) > 0 && (
                                <span className="text-amber-600"> ({item.reservedStock} reserved)</span>
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                      {isProduct ? (
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={outOfStock}
                            onClick={() => addToCart(item, "product", false)}
                            className="gap-1"
                          >
                            <Plus className="h-3 w-3" /> {outOfStock ? "Out of stock" : "Add"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => addToCart(item, "product", true)}
                            className="gap-1"
                            title={`Pre-order at ${preOrderMarkup}% markup`}
                          >
                            <Tag className="h-3 w-3" /> Pre-order
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="w-full gap-1"
                          onClick={() => addToCart(item, "service", false)}
                        >
                          <Plus className="h-3 w-3" /> Add
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* CART */}
        <Card className="w-full lg:w-[400px] xl:w-[440px]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" /> Current Sale
              </CardTitle>
              {cart.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={clearCart} className="text-destructive hover:text-destructive">
                  <Trash2 className="mr-1 h-4 w-4" /> Clear
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {cart.length === 0 ? (
              <div className="flex min-h-[260px] items-center justify-center text-center text-sm text-muted-foreground">
                Your cart is empty
              </div>
            ) : (
              <>
                <div className="max-h-[380px] space-y-3 overflow-y-auto pr-1">
                  {cart.map((item) => (
                    <div key={`${item.type}-${item.id}-${item.isPreOrder ? "po" : "std"}`} className="rounded-lg border p-3">
                      <div className="flex gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">{item.name}</p>
                            {item.isPreOrder && (
                              <Badge className="bg-cyan-600 text-white">PRE-ORDER</Badge>
                            )}
                            {item.isCustom && !item.savedToList && (
                              <Badge variant="secondary">CUSTOM</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {item.type === "service" ? "Service" : "Product"} · {formatCurrency(item.price)}
                          </p>
                          {item.isPreOrder && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Base {formatCurrency(item.basePrice ?? item.price)} · +{item.markupPercentage}% markup (<span className="text-primary font-medium">+{formatCurrency(item.markupAmount ?? 0)}</span>)
                            </p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-destructive"
                          onClick={() => removeFromCart(item.id, item.type, Boolean(item.isPreOrder))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => updateQuantity(item.id, item.type, -1, Boolean(item.isPreOrder))}>
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => updateQuantity(item.id, item.type, 1, Boolean(item.isPreOrder))}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="font-bold">{formatCurrency(item.price * item.quantity)}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Items ({totalItems})</span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>
                  {hasPreOrder && (
                    <div className="rounded-md bg-cyan-500/10 px-3 py-2 text-xs text-cyan-700 dark:text-cyan-300">
                      Includes pre-order items — markup is added automatically and stock is
                      unaffected until the order is fulfilled.
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xl font-bold">
                    <span>Total</span>
                    <span className="text-primary">{formatCurrency(subtotal)}</span>
                  </div>
                </div>

                <Button type="button" className="w-full" size="lg" onClick={() => setCheckoutOpen(true)}>
                  <CreditCard className="mr-2 h-5 w-5" /> Proceed to Checkout
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* CUSTOM SERVICE DIALOG */}
      <Dialog open={customServiceOpen} onOpenChange={setCustomServiceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Custom Service</DialogTitle>
            <DialogDescription>Create a one-off service for this sale.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Service name</Label>
              <Input value={serviceForm.name} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })} placeholder="e.g. Board-level repair" />
            </div>
            <div className="space-y-2">
              <Label>Price</Label>
              <Input type="number" min={0} value={serviceForm.price} onChange={(e) => setServiceForm({ ...serviceForm, price: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={serviceForm.notes} onChange={(e) => setServiceForm({ ...serviceForm, notes: e.target.value })} placeholder="Scope, inclusions, warranty notes..." />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={serviceForm.saveToList} onCheckedChange={(checked) => setServiceForm({ ...serviceForm, saveToList: checked === true })} />
              Save to Service List for future use
            </label>
            <Button className="w-full" onClick={addCustomService} disabled={isSubmitting}>
              {isSubmitting ? "Adding..." : "Add service to sale"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CUSTOM PRODUCT DIALOG */}
      <Dialog open={customProductOpen} onOpenChange={setCustomProductOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Custom Product</DialogTitle>
            <DialogDescription>Create a one-off product for this sale.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Product name</Label>
              <Input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} placeholder="e.g. 512GB SSD service stock" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Cost</Label>
                <Input type="number" min={0} value={productForm.cost} onChange={(e) => setProductForm({ ...productForm, cost: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Selling price</Label>
                <Input type="number" min={0} value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" min={1} value={productForm.quantity} onChange={(e) => setProductForm({ ...productForm, quantity: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={productForm.saveToList} onCheckedChange={(checked) => setProductForm({ ...productForm, saveToList: checked === true })} />
              Save to Inventory (stock will be added)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button className="w-full" onClick={() => addCustomProduct(false)} disabled={isSubmitting}>
                {isSubmitting ? "Adding..." : "Add product to sale"}
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => addCustomProduct(true)}
                disabled={isSubmitting}
                title={`Pre-order at ${preOrderMarkup}% markup`}
              >
                <Tag className="h-4 w-4 mr-1" />
                {isSubmitting ? "Adding..." : `Pre-order (${preOrderMarkup}%)`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* CHECKOUT DIALOG */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingJob ? `Complete Job ${editingJob.jobNumber}` : "Complete Transaction"}</DialogTitle>
            <DialogDescription>Customer and payment details for this job.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  Unit / Model <span className="text-destructive">*</span>
                </Label>
                <Input value={phoneModel} onChange={(e) => setPhoneModel(e.target.value)} placeholder="e.g. Acer Aspire 5, Epson L360, Hikvision DVR" list="pos-phone-models" autoComplete="off" />
                <datalist id="pos-phone-models">
                  {phoneModelOptions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-2">
                <Label>Customer Name</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in customer" list="pos-customer-names" autoComplete="off" />
                <datalist id="pos-customer-names">
                  {customerNameOptions.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Customer Phone <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="e.g. 0917..." />
                <p className="text-xs text-muted-foreground">Used to group repeat customers and for follow-up.</p>
              </div>
              <div className="space-y-2">
                <Label>Customer Email <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="e.g. customer@email.com" autoComplete="email" />
                <p className="text-xs text-muted-foreground">Stored with the job for receipts and follow-up.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Device Passcode <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={devicePasscode} onChange={(e) => setDevicePasscode(e.target.value)} placeholder="e.g. 123456 / pattern" autoComplete="off" />
              <p className="text-xs text-muted-foreground">Lock-screen code so the tech can test after repair. Internal only.</p>
            </div>

            <div className="space-y-2">
              <Label>Assigned Technician</Label>
              <Select value={technician || undefined} onValueChange={setTechnician}>
                <SelectTrigger>
                  <SelectValue placeholder="No technician assigned" />
                </SelectTrigger>
                <SelectContent>
                  {technicians.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Customer Complaint</Label>
              <Textarea rows={2} value={customerComplaint} onChange={(e) => setCustomerComplaint(e.target.value)} placeholder="What the customer reported (optional)" />
            </div>

            <div className="space-y-2">
              <Label>Payment method</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={paymentMethod === "cash" ? "default" : "outline"} onClick={() => setPaymentMethod("cash")}>
                  <Banknote className="mr-2 h-4 w-4" /> Cash
                </Button>
                <Button type="button" variant={paymentMethod === "gcash" ? "default" : "outline"} onClick={() => setPaymentMethod("gcash")}>
                  <CreditCard className="mr-2 h-4 w-4" /> GCash
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{editingJob ? `Deposit / additional payment (${formatCurrency(alreadyPaid)} already paid)` : "Deposit / amount received now"}</Label>
                <Input
                  type="number"
                  min={0}
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  {hasPreOrder ? "Pre-orders usually ask for a deposit." : "Optional deposit for pending jobs."}
                </p>
              </div>
              {paymentMethod === "cash" && (
                <div className="space-y-2">
                  <Label>Cash received</Label>
                  <Input
                    type="number"
                    min={0}
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    placeholder={String(round2(editingJob ? remainingDue : subtotal))}
                  />
                  <p className="text-xs text-muted-foreground">
                    {editingJob ? "Amount tendered now; the deposit you already collected remains recorded." : "Amount tendered at the register."}
                  </p>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-2 rounded-md bg-muted/50 p-3 text-sm">
              {cart.map((item) => (
                <div key={`${item.type}-${item.id}-${item.isPreOrder ? "po" : "std"}`} className="flex justify-between gap-2">
                  <span className="truncate">
                    {item.quantity} × {item.name}
                    {item.isPreOrder ? " (pre-order)" : ""}
                  </span>
                  <span className="shrink-0 font-medium">{formatCurrency(item.price * item.quantity)}</span>
                </div>
              ))}
              <Separator className="my-2" />
              <div className="flex justify-between text-base font-bold">
                <span>Total</span>
                <span className="text-primary">{formatCurrency(subtotal)}</span>
              </div>
              {editingJob && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Already paid (deposits)</span>
                  <span>{formatCurrency(editingJob.amountPaid)}</span>
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" variant="outline" size="lg" disabled={isSubmitting} onClick={handleSavePending}>
                <Save className="mr-2 h-4 w-4" />
                {editingJob ? "Save changes" : "Save as open job"}
              </Button>
              <Button type="button" size="lg" disabled={isSubmitting} onClick={handleComplete}>
                {isSubmitting ? "Processing..." : (
                  <>
                    <CheckCircle2 className="mr-2 h-5 w-5" /> Complete Sale
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* RECEIPT DIALOG */}
      <Dialog open={Boolean(receipt)} onOpenChange={(open) => { if (!open) setReceipt(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sale complete</DialogTitle>
            <DialogDescription>Job processed — stock updated.</DialogDescription>
          </DialogHeader>
          {receipt && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {shopProfile.logo && (
                  <img src={shopProfile.logo} alt={shopProfile.name} className="h-9 w-9 shrink-0 rounded-md object-contain" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{shopProfile.name}</p>
                  {(shopProfile.address || shopProfile.contactNumber) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {[shopProfile.address, shopProfile.contactNumber].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {shopProfile.email && (
                    <p className="truncate text-xs text-muted-foreground">{shopProfile.email}</p>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-center">
                <p className="text-xs text-muted-foreground">Job number</p>
                <p className="font-mono text-xl font-bold text-primary">{receipt.jobNumber}</p>
                <p className="mt-1 text-sm">
                  {receipt.customerName}
                  {receipt.customerPhone ? ` · ${receipt.customerPhone}` : ""}
                  {receipt.customerEmail ? ` · ${receipt.customerEmail}` : ""}
                  {receipt.phoneModel ? ` · ${receipt.phoneModel}` : ""}
                </p>
                {receipt.technicianName && (
                  <p className="mt-1 text-xs text-muted-foreground">Technician: {receipt.technicianName}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(receipt.createdAt).toLocaleString("en-PH")}
                </p>
                <div className="mt-2 flex justify-center gap-2">
                  {statusBadge(receipt.status)}
                  <Badge className={receipt.paymentMethod === "gcash" ? "bg-blue-600 text-white" : "bg-amber-500 text-black"}>
                    {receipt.paymentMethod.toUpperCase()}
                  </Badge>
                </div>
              </div>

              <div className="space-y-1 text-sm">
                {receipt.items.map((item, index) => (
                  <div key={`${item.id}-${index}`} className="flex justify-between gap-2">
                    <span className="truncate">
                      {item.quantity} × {item.name} @ {formatCurrency(item.price || 0)}
                      {item.isPreOrder ? " (pre-order)" : ""}
                    </span>
                    <span className="shrink-0 font-medium">{formatCurrency((item.price || 0) * (item.quantity || 1))}</span>
                  </div>
                ))}
              </div>

              <Separator />
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span className="font-medium">{formatCurrency(receipt.items.reduce((sum, it) => sum + (it.price || 0) * (it.quantity || 1), 0))}</span></div>
                <div className="flex justify-between"><span>Discount</span><span>{formatCurrency(0)}</span></div>
                <div className="flex justify-between"><span>Total</span><span className="font-medium">{formatCurrency(receipt.total)}</span></div>
                <div className="flex justify-between"><span>Amount paid</span><span className="font-medium">{formatCurrency(receipt.amountPaid)}</span></div>
                {typeof receipt.cashReceived === "number" && (
                  <div className="flex justify-between"><span>Cash received</span><span>{formatCurrency(receipt.cashReceived)}</span></div>
                )}
                {typeof receipt.change === "number" && (
                  <div className="flex justify-between"><span>Change</span><span className="font-medium text-green-600">{formatCurrency(receipt.change)}</span></div>
                )}
                {receipt.remainingBalance > 0 && (
                  <div className="flex justify-between"><span>Remaining balance</span><span className="font-medium text-amber-600">{formatCurrency(receipt.remainingBalance)}</span></div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <Button type="button" variant="outline" onClick={() => printReceipt(shopProfile, settings, receipt)}>
                  <Printer className="mr-2 h-4 w-4" /> Print Receipt
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => { setReceipt(null); clearCart(); }}>
                    New sale
                  </Button>
                  <Button onClick={() => { setReceipt(null); setLocation("/"); }}>
                    Done
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* JOB SLIP DIALOG (pending job saved) */}
      <Dialog open={Boolean(pendingSlip)} onOpenChange={(open) => { if (!open) { setPendingSlip(null); clearCart(); setLocation("/transactions"); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Job saved</DialogTitle>
            <DialogDescription>Print a job slip to hand to the customer, or continue.</DialogDescription>
          </DialogHeader>
          {pendingSlip && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-4 text-center">
                <p className="text-xs text-muted-foreground">Job number</p>
                <p className="font-mono text-xl font-bold text-primary">{pendingSlip.jobNumber}</p>
                <p className="mt-1 text-sm">
                  {pendingSlip.customerName}
                  {pendingSlip.customerPhone ? ` · ${pendingSlip.customerPhone}` : ""}
                  {pendingSlip.customerEmail ? ` · ${pendingSlip.customerEmail}` : ""}
                  {pendingSlip.phoneModel ? ` · ${pendingSlip.phoneModel}` : ""}
                </p>
                {pendingSlip.devicePasscode && (
                  <p className="mt-1 text-sm">
                    Passcode: <span className="font-mono font-medium">{pendingSlip.devicePasscode}</span>
                  </p>
                )}
                <div className="mt-2 flex justify-center">
                  {statusBadge((pendingSlip.status as TransactionStatus) || "received")}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button type="button" onClick={() => printJobSlip(shopProfile, settings, pendingSlip)}>
                  <Printer className="mr-2 h-4 w-4" /> Print Job Slip
                </Button>
                <Button type="button" variant="outline" onClick={() => { setPendingSlip(null); clearCart(); setLocation("/transactions"); }}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}