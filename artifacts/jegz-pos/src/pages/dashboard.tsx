import { useState } from "react";
import {
  useGetDashboard,
  useShopProfile,
  DEFAULT_REORDER_POINT,
} from "@/lib/offline-api";
import { formatCurrency } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertTriangle,
  Banknote,
  Clock,
  TrendingUp,
  Wallet,
  CheckCircle2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type Period = "today" | "week" | "month" | "year";

const AMBER = "#f59e0b";
const GREEN = "#22c55e";
const BLUE = "#3b82f6";
const SLATE = "#334155";
const MUTED = "#94a3b8";

const PIE_COLORS = [AMBER, BLUE];

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  label?: string;
  currency?: boolean;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-sm">
      {label && (
        <p className="mb-1 font-semibold text-foreground">
          {label}
        </p>
      )}

      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {currency ? formatCurrency(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>("today");
  const shopProfile = useShopProfile();

  const {
    data: rawDashboard,
    isLoading,
  } = useGetDashboard({ period });

  /*
   * SAFE DEFAULTS
   *
   * Prevents errors such as:
   * Cannot read properties of undefined (reading 'length')
   *
   * If the backend/API returns incomplete data,
   * arrays become [] and numeric values become 0.
   */
  const dashboard = rawDashboard
    ? {
      ...rawDashboard,

      salesTrend: Array.isArray(rawDashboard.salesTrend)
        ? rawDashboard.salesTrend
        : [],

      topServices: Array.isArray(rawDashboard.topServices)
        ? rawDashboard.topServices
        : [],

      topProducts: Array.isArray(rawDashboard.topProducts)
        ? rawDashboard.topProducts
        : [],

      recentTransactions: Array.isArray(
        rawDashboard.recentTransactions,
      )
        ? rawDashboard.recentTransactions
        : [],

      lowStockProducts: Array.isArray(
        rawDashboard.lowStockProducts,
      )
        ? rawDashboard.lowStockProducts
        : [],

      cashCount: rawDashboard.cashCount ?? 0,
      gcashCount: rawDashboard.gcashCount ?? 0,
      lowStockCount: rawDashboard.lowStockCount ?? 0,
      pendingCount: rawDashboard.pendingCount ?? 0,
      openJobs: rawDashboard.openJobs ?? 0,
      depositTotal: rawDashboard.depositTotal ?? 0,
      outstandingTotal: rawDashboard.outstandingTotal ?? 0,
      preOrderSales: rawDashboard.preOrderSales ?? 0,
      preOrderCount: rawDashboard.preOrderCount ?? 0,
      periodSales: rawDashboard.periodSales ?? 0,
      periodProfit: rawDashboard.periodProfit ?? 0,
      periodTransactions:
        rawDashboard.periodTransactions ?? 0,

      periodLabel:
        rawDashboard.periodLabel ??
        period.charAt(0).toUpperCase() +
        period.slice(1),
    }
    : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading dashboard...
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="p-8 text-destructive">
        Failed to load dashboard data
      </div>
    );
  }

  const paymentData = [
    {
      name: "Cash",
      value: dashboard.cashCount,
    },
    {
      name: "GCash",
      value: dashboard.gcashCount,
    },
  ];

  const trendLabel =
    period === "month"
      ? "Daily Trend"
      : period === "year"
        ? "Monthly Trend"
        : "7-Day Trend";

  return (
    <div className="space-y-6">
      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Dashboard
          </h1>
          {(shopProfile.name || shopProfile.address) && (
            <p className="mt-1 text-sm text-muted-foreground">
              {shopProfile.name}
              {shopProfile.address ? ` · ${shopProfile.address}` : ""}
            </p>
          )}
        </div>

        <Tabs
          value={period}
          onValueChange={(v) =>
            setPeriod(v as Period)
          }
        >
          <TabsList>
            <TabsTrigger value="today">
              Today
            </TabsTrigger>

            <TabsTrigger value="week">
              Week
            </TabsTrigger>

            <TabsTrigger value="month">
              Month
            </TabsTrigger>

            <TabsTrigger value="year">
              Year
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* KPI CARDS */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* SALES */}
        <Card className="border-l-4 border-l-primary bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {dashboard.periodLabel} Sales
            </CardTitle>

            <Banknote className="h-4 w-4 text-primary" />
          </CardHeader>

          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {formatCurrency(
                dashboard.periodSales,
              )}
            </div>

            <p className="text-xs text-muted-foreground mt-1">
              {dashboard.periodTransactions} job
              {dashboard.periodTransactions !== 1
                ? "s"
                : ""}
            </p>
          </CardContent>
        </Card>

        {/* PROFIT */}
        <Card className="border-l-4 border-l-green-500 bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {dashboard.periodLabel} Profit
            </CardTitle>

            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>

          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {formatCurrency(
                dashboard.periodProfit,
              )}
            </div>

            <p className="text-xs text-muted-foreground mt-1">
              {dashboard.periodSales > 0
                ? `${(
                  (dashboard.periodProfit /
                    dashboard.periodSales) *
                  100
                ).toFixed(1)}% margin`
                : "No sales yet"}
            </p>
          </CardContent>
        </Card>

        {/* PAYMENT SPLIT */}
        <Card className="border-l-4 border-l-blue-500 bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Payment Split
            </CardTitle>

            <Wallet className="h-4 w-4 text-blue-500" />
          </CardHeader>

          <CardContent>
            <div className="text-2xl font-bold text-blue-400">
              {dashboard.cashCount +
                dashboard.gcashCount >
                0
                ? `${dashboard.cashCount}/${dashboard.gcashCount}`
                : "—"}
            </div>

            <p className="text-xs text-muted-foreground mt-1">
              Cash / GCash transactions
            </p>
          </CardContent>
        </Card>

        {/* REORDER ALERT */}
        <Card
          className={
            dashboard.lowStockCount > 0
              ? "border-l-4 border-l-destructive bg-destructive/10"
              : "border-l-4 border-l-muted bg-card"
          }
        >
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Reorder Alerts
            </CardTitle>

            <AlertTriangle
              className={`h-4 w-4 ${dashboard.lowStockCount > 0
                ? "text-destructive"
                : "text-muted-foreground"
                }`}
            />
          </CardHeader>

          <CardContent>
            <div
              className={`text-2xl font-bold ${dashboard.lowStockCount > 0
                ? "text-destructive"
                : "text-foreground"
                }`}
            >
              {dashboard.lowStockCount}
            </div>

            <p className="text-xs text-muted-foreground mt-1">
              {dashboard.lowStockCount === 0
                ? "All stock levels OK"
                : "items need restocking"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* PENDING / PRE-ORDER / PAYMENT KPIS */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-amber-500 bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Open Jobs
            </CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {dashboard.openJobs}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              pending / in repair queue
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500 bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Deposits Held
            </CardTitle>
            <Wallet className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">
              {formatCurrency(dashboard.depositTotal)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              partial payments on open jobs
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-destructive bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Outstanding Balance
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {formatCurrency(dashboard.outstandingTotal)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              still to collect on open jobs
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-cyan-600 bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Pre-Order Sales
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-cyan-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-cyan-700">
              {formatCurrency(dashboard.preOrderSales)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {dashboard.preOrderCount} pre-order job
              {dashboard.preOrderCount !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* PENDING JOBS */}
      {dashboard.pendingCount > 0 && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3">
          <Clock className="h-5 w-5 text-amber-500 shrink-0" />

          <span className="text-sm font-medium text-amber-600">
            <strong>
              {dashboard.pendingCount}
            </strong>{" "}
            active job
            {dashboard.pendingCount !== 1
              ? "s"
              : ""}{" "}
            in queue (pending + in repair)
          </span>
        </div>
      )}

      {/* SALES TREND */}
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-base">
            {trendLabel} — Sales & Profit
          </CardTitle>
        </CardHeader>

        <CardContent>
          <ResponsiveContainer
            width="100%"
            height={240}
          >
            <AreaChart
              data={dashboard.salesTrend}
              margin={{
                top: 5,
                right: 10,
                left: 10,
                bottom: 0,
              }}
            >
              <defs>
                <linearGradient
                  id="salesGrad"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor={AMBER}
                    stopOpacity={0.3}
                  />

                  <stop
                    offset="95%"
                    stopColor={AMBER}
                    stopOpacity={0}
                  />
                </linearGradient>

                <linearGradient
                  id="profitGrad"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor={GREEN}
                    stopOpacity={0.3}
                  />

                  <stop
                    offset="95%"
                    stopColor={GREEN}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke={SLATE}
              />

              <XAxis
                dataKey="date"
                tick={{
                  fill: MUTED,
                  fontSize: 11,
                }}
                axisLine={false}
                tickLine={false}
              />

              <YAxis
                tick={{
                  fill: MUTED,
                  fontSize: 11,
                }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) =>
                  `₱${v >= 1000
                    ? `${(
                      v / 1000
                    ).toFixed(1)}k`
                    : v
                  }`
                }
              />

              <Tooltip
                content={
                  <ChartTooltip currency />
                }
              />

              <Legend
                wrapperStyle={{
                  fontSize: 12,
                  paddingTop: 8,
                }}
                formatter={(value) => (
                  <span
                    style={{
                      color: MUTED,
                    }}
                  >
                    {value}
                  </span>
                )}
              />

              <Area
                type="monotone"
                dataKey="sales"
                name="Sales"
                stroke={AMBER}
                strokeWidth={2}
                fill="url(#salesGrad)"
                dot={{
                  fill: AMBER,
                  r: 3,
                }}
              />

              <Area
                type="monotone"
                dataKey="profit"
                name="Profit"
                stroke={GREEN}
                strokeWidth={2}
                fill="url(#profitGrad)"
                dot={{
                  fill: GREEN,
                  r: 3,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* CHARTS ROW */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* TRANSACTION COUNT */}
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-base">
              Transaction Count
            </CardTitle>
          </CardHeader>

          <CardContent>
            <ResponsiveContainer
              width="100%"
              height={200}
            >
              <BarChart
                data={dashboard.salesTrend}
                margin={{
                  top: 4,
                  right: 8,
                  left: -20,
                  bottom: 0,
                }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={SLATE}
                />

                <XAxis
                  dataKey="date"
                  tick={{
                    fill: MUTED,
                    fontSize: 10,
                  }}
                  axisLine={false}
                  tickLine={false}
                />

                <YAxis
                  tick={{
                    fill: MUTED,
                    fontSize: 10,
                  }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />

                <Tooltip
                  content={<ChartTooltip />}
                />

                <Bar
                  dataKey="transactions"
                  name="Jobs"
                  fill={AMBER}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* TOP SERVICES */}
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-base">
              Top Services
            </CardTitle>
          </CardHeader>

          <CardContent>
            {dashboard.topServices.length ===
              0 ? (
              <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
                No data for period
              </div>
            ) : (
              <ResponsiveContainer
                width="100%"
                height={200}
              >
                <BarChart
                  data={dashboard.topServices}
                  layout="vertical"
                  margin={{
                    top: 0,
                    right: 16,
                    left: 0,
                    bottom: 0,
                  }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={SLATE}
                    horizontal={false}
                  />

                  <XAxis
                    type="number"
                    tick={{
                      fill: MUTED,
                      fontSize: 10,
                    }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />

                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{
                      fill: MUTED,
                      fontSize: 10,
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={110}
                    tickFormatter={(v) => {
                      const text = String(v ?? "");

                      return text.length > 16
                        ? text.slice(0, 16) +
                        "…"
                        : text;
                    }}
                  />

                  <Tooltip
                    content={<ChartTooltip />}
                  />

                  <Bar
                    dataKey="count"
                    name="Jobs"
                    fill={BLUE}
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* PAYMENT METHODS */}
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-base">
              Payment Methods
            </CardTitle>
          </CardHeader>

          <CardContent>
            {dashboard.cashCount +
              dashboard.gcashCount ===
              0 ? (
              <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
                No transactions
              </div>
            ) : (
              <ResponsiveContainer
                width="100%"
                height={200}
              >
                <PieChart>
                  <Pie
                    data={paymentData}
                    cx="50%"
                    cy="45%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {paymentData.map(
                      (_, i) => (
                        <Cell
                          key={i}
                          fill={
                            PIE_COLORS[i] ??
                            AMBER
                          }
                        />
                      ),
                    )}
                  </Pie>

                  <Tooltip
                    content={({
                      active,
                      payload,
                    }) => {
                      if (
                        !active ||
                        !payload?.length
                      ) {
                        return null;
                      }

                      const p = payload[0];

                      if (!p) {
                        return null;
                      }

                      const total =
                        dashboard.cashCount +
                        dashboard.gcashCount;

                      const pct = total
                        ? (
                          ((p.value as number) /
                            total) *
                          100
                        ).toFixed(1)
                        : 0;

                      return (
                        <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-sm">
                          <p
                            style={{
                              color:
                                p.payload?.fill ??
                                "inherit",
                            }}
                          >
                            {p.name}: {p.value} (
                            {pct}%)
                          </p>
                        </div>
                      );
                    }}
                  />

                  <Legend
                    wrapperStyle={{
                      fontSize: 12,
                      paddingTop: 4,
                    }}
                    formatter={(
                      value,
                      entry,
                    ) => (
                      <span
                        style={{
                          color:
                            (entry as any)
                              ?.color ?? MUTED,
                        }}
                      >
                        {value}
                      </span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* BOTTOM ROW */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* TOP PRODUCTS */}
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-base">
              Top Products Sold
            </CardTitle>
          </CardHeader>

          <CardContent>
            {dashboard.topProducts.length ===
              0 ? (
              <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">
                No data for period
              </div>
            ) : (
              <div className="space-y-3">
                {dashboard.topProducts.map(
                  (item, i) => {
                    const max =
                      dashboard.topProducts[0]
                        ?.count ?? 1;

                    const percentage =
                      max > 0
                        ? (item.count / max) *
                        100
                        : 0;

                    return (
                      <div
                        key={i}
                        className="space-y-1"
                      >
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium truncate max-w-[70%]">
                            {item.name}
                          </span>

                          <span className="text-muted-foreground text-xs">
                            {item.count} sold
                          </span>
                        </div>

                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${percentage}%`,
                              background: AMBER,
                            }}
                          />
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* RECENT TRANSACTIONS */}
        <Card className="bg-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />

              Recent Transactions
            </CardTitle>
          </CardHeader>

          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    Customer
                  </TableHead>

                  <TableHead>
                    Customer
                  </TableHead>

                  <TableHead>
                    Phone / Device
                  </TableHead>

                  <TableHead>
                    Job #
                  </TableHead>

                  <TableHead>
                    Time
                  </TableHead>

                  <TableHead>
                    Payment
                  </TableHead>

                  <TableHead>
                    Status
                  </TableHead>

                  <TableHead className="text-right">
                    Total
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {dashboard.recentTransactions.map(
                  (tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-medium">
                        {tx.customerName || tx.customer || "Walk-in"}
                      </TableCell>

                      <TableCell className="text-muted-foreground text-sm">
                        {tx.customerPhone || tx.phoneModel || tx.unit || "—"}
                      </TableCell>

                      <TableCell className="text-xs">
                        <span className="font-mono text-primary bg-primary/10 rounded px-1.5 py-0.5">
                          {tx.jobNumber || `#${tx.id}`}
                        </span>
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center text-muted-foreground text-xs gap-1">
                          <Clock className="h-3 w-3" />

                          {tx.createdAt
                            ? new Date(
                              tx.createdAt,
                            ).toLocaleTimeString(
                              "en-PH",
                              {
                                hour: "2-digit",
                                minute:
                                  "2-digit",
                              },
                            )
                            : "—"}
                        </div>
                      </TableCell>

                      <TableCell>
                        {tx.paymentMethod ? (
                          <Badge
                            className={
                              tx.paymentMethod ===
                                "gcash"
                                ? "bg-blue-600 text-white"
                                : "bg-amber-500 text-black"
                            }
                          >
                            {tx.paymentMethod.toUpperCase()}
                          </Badge>
                        ) : tx.paymentStatus === "partial" ? (
                          <Badge className="bg-blue-600 text-white">
                            PARTIAL
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            On pickup
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant={
                            ["completed", "complete", "done"].includes((tx.status || "").toString())
                              ? "default"
                              : "secondary"
                          }
                          className={
                            ["completed", "complete", "done"].includes((tx.status || "").toString())
                              ? "bg-green-600 text-white"
                              : (tx.status || "").toString().replace(/-/g, "_") === "ready_for_pickup"
                                ? "bg-emerald-500 text-white"
                                : (tx.status || "").toString() === "cancelled"
                                  ? "bg-slate-500 text-white"
                                  : "bg-amber-500 text-white"
                          }
                        >
                          {(tx.status || "pending").toString().replace(/_/g, " ")}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right font-bold text-primary">
                        {formatCurrency(tx.total ?? tx.totalAmount ?? 0)}
                      </TableCell>
                    </TableRow>
                  ),
                )}

                {dashboard
                  .recentTransactions.length ===
                  0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-6 text-muted-foreground text-sm"
                      >
                        No transactions yet
                      </TableCell>
                    </TableRow>
                  )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* LOW STOCK ALERTS */}
      <Card
        className={
          dashboard.lowStockProducts.length > 0
            ? "bg-destructive/10 border-destructive/30"
            : "bg-card"
        }
      >
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Low Stock Alerts
          </CardTitle>
        </CardHeader>

        <CardContent>
          {dashboard.lowStockProducts.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              All stock levels OK
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                {dashboard.lowStockProducts.length} product
                {dashboard.lowStockProducts.length !== 1 ? "s" : ""} at or
                below reorder point
              </p>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {dashboard.lowStockProducts.map((product) => {
                  const available = Math.max(
                    0,
                    (product.stock ?? 0) - (product.reservedStock ?? 0),
                  );
                  const threshold =
                    product.reorderPoint ?? DEFAULT_REORDER_POINT;
                  const outOfStock = available === 0;

                  return (
                    <div
                      key={product.id}
                      className="flex items-center justify-between rounded-md bg-card/50 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {product.name}
                        </p>

                        <p className="text-xs text-muted-foreground">
                          {product.category}
                          {product.category ? " · " : ""}
                          Threshold {threshold}
                        </p>
                      </div>

                      <Badge
                        variant={
                          outOfStock ? "destructive" : "secondary"
                        }
                        className={
                          !outOfStock
                            ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                            : ""
                        }
                      >
                        {outOfStock
                          ? "OUT"
                          : `${available} left`}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}