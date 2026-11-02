import { useState } from "react";
import { useGetMonthlyReport, useGetTechnicianReport, useShopProfile } from "@/lib/offline-api";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area,
} from "recharts";
import { Printer, TrendingUp, Banknote, Wrench, Star, Trophy } from "lucide-react";

type Period = "today" | "week" | "month" | "year";

const AMBER = "#f59e0b";
const GREEN = "#22c55e";
const BLUE = "#3b82f6";
const SLATE = "#334155";
const MUTED = "#94a3b8";

function getMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-PH", { month: "long", year: "numeric" });
    options.push({ value, label });
  }
  return options;
}

function escHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c];
  });
}

export default function ReportsPage() {
  const monthOptions = getMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0].value);
  const [techPeriod, setTechPeriod] = useState<Period>("month");
  const shopProfile = useShopProfile();

  const { data: monthly, isLoading: monthlyLoading } = useGetMonthlyReport({ month: selectedMonth });
  const { data: techReport = [], isLoading: techLoading } = useGetTechnicianReport({ period: techPeriod });

  const handlePrintMonthly = () => {
    const win = window.open("", "_blank");
    if (!win || !monthly) return;

    const rows = monthly.days
      .filter(d => d.transactions > 0)
      .map(d => `
        <tr>
          <td>${new Date(d.date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</td>
          <td align="right">${d.transactions}</td>
          <td align="right">${formatCurrency(d.sales)}</td>
          <td align="right">${formatCurrency(d.cashSales)}</td>
          <td align="right">${formatCurrency(d.gcashSales)}</td>
          <td align="right">${formatCurrency(d.profit)}</td>
        </tr>
      `).join("");

    const techRows = (monthly.technicianBreakdown || []).map(t => `
      <tr>
        <td>${t.name}</td>
        <td align="right">${t.jobs}</td>
        <td align="right">${formatCurrency(t.sales)}</td>
        <td align="right">${formatCurrency(t.profit)}</td>
        <td align="right">${t.cashJobs}</td>
        <td align="right">${t.gcashJobs}</td>
      </tr>
    `).join("");

    const productRows = (monthly.topProducts || []).map(p => `<tr><td>${escHtml(p.name)}</td><td align="right">${p.count}</td></tr>`).join("");
    const serviceRows = (monthly.topServices || []).map(s => `<tr><td>${escHtml(s.name)}</td><td align="right">${s.count}</td></tr>`).join("");

    const brandName = escHtml(shopProfile.name);
    const brandLine = [shopProfile.address, shopProfile.contactNumber, shopProfile.email]
      .filter(Boolean)
      .map(v => escHtml(v))
      .join(" &nbsp;|&nbsp; ");
    const logoHtml = shopProfile.logo
      ? `<img src="${shopProfile.logo}" alt="${brandName}" style="height:48px;width:auto;max-width:120px;object-fit:contain;"/>`
      : "";

    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${brandName} — Monthly Report</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 24px; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
          th { background: #f5f5f5; text-align: left; padding: 5px 8px; border: 1px solid #ddd; font-size: 11px; }
          td { padding: 4px 8px; border: 1px solid #eee; }
          .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
          .summary-card { border: 1px solid #ddd; border-radius: 6px; padding: 8px 12px; }
          .summary-card .label { font-size: 10px; color: #666; text-transform: uppercase; }
          .summary-card .value { font-size: 18px; font-weight: bold; }
          .footer { margin-top: 24px; font-size: 10px; color: #999; text-align: center; }
          @media print { body { margin: 12px; } }
        </style>
      </head>
      <body>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          ${logoHtml}
          <div>
            <h1 style="font-size:18px;margin-bottom:4px;">${brandName}</h1>
            ${brandLine ? `<p style="font-size:11px;color:#555;margin:0;">${brandLine}</p>` : ""}
          </div>
        </div>
        <p>Monthly Report — <strong>${escHtml(monthly.monthLabel)}</strong> &nbsp;|&nbsp; Generated: ${new Date().toLocaleString("en-PH")}</p>
        <div class="summary">
          <div class="summary-card"><div class="label">Total Sales</div><div class="value">${formatCurrency(monthly.totalSales)}</div></div>
          <div class="summary-card"><div class="label">Total Profit</div><div class="value">${formatCurrency(monthly.totalProfit)}</div></div>
          <div class="summary-card"><div class="label">Jobs Completed</div><div class="value">${monthly.totalTransactions}</div></div>
          <div class="summary-card"><div class="label">Cash Collection</div><div class="value">${formatCurrency(monthly.cashTotal)}</div></div>
          <div class="summary-card"><div class="label">GCash Collection</div><div class="value">${formatCurrency(monthly.gcashTotal)}</div></div>
          <div class="summary-card"><div class="label">Avg Sales/Day</div><div class="value">${formatCurrency(monthly.avgPerDay)}</div></div>
        </div>
        <h2>Daily Breakdown (Active Days Only)</h2>
        <table>
          <thead><tr><th>Date</th><th>Jobs</th><th>Total Sales</th><th>Cash</th><th>GCash</th><th>Profit</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <h2>Technician Performance</h2>
        <table>
          <thead><tr><th>Technician</th><th>Jobs</th><th>Sales</th><th>Profit</th><th>Cash Jobs</th><th>GCash Jobs</th></tr></thead>
          <tbody>${techRows || "<tr><td colspan='6'>No data</td></tr>"}</tbody>
        </table>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <h2>Top Products</h2>
            <table><thead><tr><th>Product</th><th>Qty Sold</th></tr></thead><tbody>${productRows || "<tr><td colspan='2'>None</td></tr>"}</tbody></table>
          </div>
          <div>
            <h2>Top Services</h2>
            <table><thead><tr><th>Service</th><th>Count</th></tr></thead><tbody>${serviceRows || "<tr><td colspan='2'>None</td></tr>"}</tbody></table>
          </div>
        </div>
        <div class="footer">${escHtml(shopProfile.description || shopProfile.name)} — Confidential Business Report</div>
        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold tracking-tight text-primary">Reports</h1>

      {/* ── Monthly Report ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Banknote className="h-5 w-5 text-primary" /> Monthly Report
          </h2>
          <div className="flex items-center gap-3">
            <select
              className="border rounded-md px-3 py-2 text-sm bg-background text-foreground"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {monthOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <Button onClick={handlePrintMonthly} disabled={!monthly} className="gap-2">
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
          </div>
        </div>

        {monthlyLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading report...</div>
        ) : !monthly ? (
          <div className="text-center py-12 text-muted-foreground">No data available</div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: "Total Sales", value: formatCurrency(monthly.totalSales), color: "text-primary" },
                { label: "Total Profit", value: formatCurrency(monthly.totalProfit), color: "text-green-500" },
                { label: "Jobs Done", value: String(monthly.totalTransactions), color: "" },
                { label: "Cash In", value: formatCurrency(monthly.cashTotal), color: "text-amber-500" },
                { label: "GCash In", value: formatCurrency(monthly.gcashTotal), color: "text-blue-500" },
                { label: "Avg/Day", value: formatCurrency(monthly.avgPerDay), color: "text-muted-foreground" },
              ].map((s) => (
                <Card key={s.label} className="bg-card">
                  <CardContent className="p-4 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{s.label}</p>
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Technician Performance ─────────────────────────────────── */ }
  <div className="space-y-4">
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Wrench className="h-5 w-5 text-blue-500" /> Technician Performance
      </h2>
      <Tabs value={techPeriod} onValueChange={(v) => setTechPeriod(v as Period)}>
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="week">Week</TabsTrigger>
          <TabsTrigger value="month">Month</TabsTrigger>
          <TabsTrigger value="year">Year</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>

    {techLoading ? (
      <div className="text-center py-8 text-muted-foreground">Loading...</div>
    ) : techReport.length === 0 ? (
      <div className="text-center py-8 text-muted-foreground">No completed jobs in this period</div>
    ) : (
      <>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {techReport.map((tech, i) => (
            <Card key={tech.technicianId} className={`bg-card ${i === 0 ? "border-amber-500/50 border-2" : ""}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-base flex items-center gap-1">
                      {i === 0 && <Star className="h-4 w-4 text-amber-500 fill-amber-500" />}
                      {tech.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{tech.role}</p>
                  </div>
                  <Badge className="bg-primary/10 text-primary text-xs">{tech.jobs} jobs</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Sales</p>
                    <p className="font-bold text-primary">{formatCurrency(tech.sales)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Profit</p>
                    <p className="font-bold text-green-500">{formatCurrency(tech.profit)}</p>
                  </div>
                </div>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span className="bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full">Cash: {tech.cashJobs}</span>
                  <span className="bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded-full">GCash: {tech.gcashJobs}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {techReport.length > 1 && (
          <Card className="bg-card">
            <CardHeader><CardTitle className="text-base">Jobs Comparison</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={techReport} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={SLATE} />
                  <XAxis dataKey="name" tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-sm">
                          <p className="font-semibold mb-1">{label}</p>
                          {payload.map((p: any, i: number) => (
                            <p key={i} style={{ color: p.color }}>{p.name}: {typeof p.value === "number" && p.name !== "Jobs" ? formatCurrency(p.value) : p.value}</p>
                          ))}
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="jobs" name="Jobs" fill={AMBER} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="profit" name="Profit" fill={GREEN} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </>
    )}
  </div>

  {/* Monthly technician breakdown inside monthly report */ }
  {
    monthly && (monthly.technicianBreakdown ?? []).length > 0 && (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-green-500" /> Technician Breakdown — {monthly.monthLabel}
        </h2>
        <Card className="bg-card">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Technician</TableHead>
                  <TableHead className="text-center">Jobs</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-center">Cash</TableHead>
                  <TableHead className="text-center">GCash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(monthly.technicianBreakdown ?? []).map((tech) => (
                  <TableRow key={tech.technicianId}>
                    <TableCell className="font-medium">{tech.name}</TableCell>
                    <TableCell className="text-center"><Badge className="bg-primary/10 text-primary">{tech.jobs}</Badge></TableCell>
                    <TableCell className="text-right font-bold text-primary">{formatCurrency(tech.sales)}</TableCell>
                    <TableCell className="text-right text-green-500 font-bold">{formatCurrency(tech.profit)}</TableCell>
                    <TableCell className="text-center text-amber-500">{tech.cashJobs}</TableCell>
                    <TableCell className="text-center text-blue-500">{tech.gcashJobs}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    )
  }
    </div >
  );
}
