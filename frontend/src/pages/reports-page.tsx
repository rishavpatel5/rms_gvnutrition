import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FlavourLabel } from "@/components/catalog/flavour-label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getStoredAccessToken } from "@/lib/api-client";
import { OrdersReportPanel } from "@/components/reports/orders-report-panel";
import { GstReportPanel } from "@/components/reports/gst-report-panel";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { getAccountingPresets } from "@/lib/date-presets";
import {
  fetchCustomerRetention,
  fetchDeadStock,
  fetchFastMoving,
  fetchInventoryValuation,
  fetchOfferPerformance,
  fetchProfitLines,
  fetchProfitSummary,
  fetchSalesSeries,
  type DeadStockRow,
  type OfferRow,
  type ProfitLine,
  type ProfitSummary,
  type RetentionSummary,
  type SalesBucket,
  type SalesGranularity,
  type SalesSeriesResponse,
  type ValuationRow,
  type VelocityRow,
} from "@/lib/analytics-api";
import { downloadReportsWorkbook } from "@/lib/reports-export";
import { formatIstDate, formatIstDateTime, IST_TIMEZONE, istYmd, rollingIstDaysRange } from "@/lib/ist-time";

const fmtInr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

function defaultDateRange(): { from: string; to: string } {
  return rollingIstDaysRange(30);
}

function bucketLabel(iso: string, granularity: SalesGranularity): string {
  const d = new Date(iso);
  if (granularity === "monthly") {
    return d.toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: IST_TIMEZONE });
  }
  if (granularity === "weekly") {
    return `W ${istYmd(d)}`;
  }
  return istYmd(d);
}

export function ReportsPage() {
  const initial = useMemo(() => defaultDateRange(), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [applied, setApplied] = useState(initial);
  const [granularity, setGranularity] = useState<SalesGranularity>("daily");
  const [tab, setTab] = useState("sales");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const handleDownloadAll = async () => {
    setExportBusy(true);
    setExportErr(null);
    try {
      await downloadReportsWorkbook({
        from: applied.from,
        to: applied.to,
        granularity,
      });
    } catch (e: unknown) {
      setExportErr(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  };

  const tokenHint = !getStoredAccessToken();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Reports & analytics</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Step 5 of the workflow: every chart and table here is derived from the same transactions that move
          stock — purchases, POS sales, returns, and adjustments — not from static spreadsheets.
        </p>
      </div>

      {tokenHint ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Sign in and store your access token as <code className="rounded bg-muted px-1">rms_access_token</code> in
            localStorage to load authenticated reports.
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Date range (IST)</CardTitle>
          <CardDescription>
            Applies to all analytical ledgers, GST reconciliation, and report tabs. Download exports all
            tabs into one formatted Excel file with a sheet per section.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <DateRangePicker
                value={{ from, to }}
                onChange={(range) => {
                  setFrom(range.from);
                  setTo(range.to);
                  setApplied(range);
                }}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                {["This Month", "Last Month", "Last 30 Days", "Current FY"].map((label) => {
                  const presets = getAccountingPresets();
                  const preset = presets.find((p) => p.label === label);
                  if (!preset) return null;
                  const range = preset.getRange();
                  const isActive = applied.from === range.from && applied.to === range.to;
                  return (
                    <Button
                      key={label}
                      type="button"
                      variant={isActive ? "secondary" : "outline"}
                      size="sm"
                      className="h-8 text-xs font-medium"
                      onClick={() => {
                        setFrom(range.from);
                        setTo(range.to);
                        setApplied(range);
                      }}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={exportBusy || !!tokenHint}
                className="gap-2"
                onClick={() => void handleDownloadAll()}
              >
                {exportBusy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Preparing download…
                  </>
                ) : (
                  <>
                    <Download className="size-4" />
                    Download all tabs (.xlsx)
                  </>
                )}
              </Button>
            </div>
          </div>
          {exportErr ? <p className="text-sm text-destructive">{exportErr}</p> : null}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="profit">Profit</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="velocity">Fast-moving</TabsTrigger>
          <TabsTrigger value="dead">Dead stock</TabsTrigger>
          <TabsTrigger value="retention">Retention</TabsTrigger>
          <TabsTrigger value="offers">Offers</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="gst">GST</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="space-y-4">
          <SalesPanel from={applied.from} to={applied.to} granularity={granularity} onGranularity={setGranularity} />
        </TabsContent>
        <TabsContent value="profit" className="space-y-4">
          <ProfitPanel from={applied.from} to={applied.to} />
        </TabsContent>
        <TabsContent value="inventory">
          <InventoryPanel />
        </TabsContent>
        <TabsContent value="velocity">
          <VelocityPanel from={applied.from} to={applied.to} />
        </TabsContent>
        <TabsContent value="dead">
          <DeadStockPanel />
        </TabsContent>
        <TabsContent value="retention">
          <RetentionPanel from={applied.from} to={applied.to} />
        </TabsContent>
        <TabsContent value="offers">
          <OffersPanel from={applied.from} to={applied.to} />
        </TabsContent>
        <TabsContent value="orders" className="space-y-4">
          <OrdersReportPanel from={applied.from} to={applied.to} />
        </TabsContent>
        <TabsContent value="gst" className="space-y-4">
          <GstReportPanel
            from={applied.from}
            to={applied.to}
            onDateRangeChange={(range) => {
              setFrom(range.from);
              setTo(range.to);
              setApplied(range);
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SalesPanel({
  from,
  to,
  granularity,
  onGranularity,
}: {
  from: string;
  to: string;
  granularity: SalesGranularity;
  onGranularity: (g: SalesGranularity) => void;
}) {
  const [data, setData] = useState<SalesSeriesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void fetchSalesSeries({ from, to, granularity })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, granularity]);

  const chartRows = useMemo(() => {
    if (!data?.buckets.length) return [];
    return data.buckets.map((b: SalesBucket) => ({
      label: bucketLabel(b.periodStart, granularity),
      netSales: b.netSales,
      grossSales: b.grossSales,
      creditNotes: b.creditNotes,
      orders: b.saleOrderCount,
    }));
  }, [data, granularity]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Granularity</span>
        {(["daily", "weekly", "monthly"] as const).map((g) => (
          <Button
            key={g}
            type="button"
            size="sm"
            variant={granularity === g ? "default" : "outline"}
            onClick={() => onGranularity(g)}
          >
            {g === "daily" ? "Daily" : g === "weekly" ? "Weekly" : "Monthly"}
          </Button>
        ))}
      </div>

      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {data && !loading ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Net sales</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">{fmtInr(data.totals.netSales)}</CardContent>
          </Card>
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Gross sales</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">{fmtInr(data.totals.grossSales)}</CardContent>
          </Card>
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Sale orders</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">{data.totals.saleOrderCount}</CardContent>
          </Card>
        </div>
      ) : null}

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Net sales trend</CardTitle>
          <CardDescription>Net of confirmed credit notes in each bucket.</CardDescription>
        </CardHeader>
        <CardContent className="h-[320px] pt-0">
          {chartRows.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartRows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                  width={44}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as (typeof chartRows)[0];
                    return (
                      <div className="rounded-lg border border-border/80 bg-popover px-3 py-2 text-xs shadow-md">
                        <p className="font-medium">{row.label}</p>
                        <p className="tabular-nums">{fmtInr(row.netSales)} net</p>
                        <p className="text-muted-foreground">{row.orders} orders</p>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="netSales"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  fill="url(#netFill)"
                  legendType="none"
                />
                <Bar dataKey="netSales" name="Net sales" fill="hsl(var(--chart-2))" fillOpacity={0.35} radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            !loading && <p className="text-sm text-muted-foreground">No buckets in this range.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProfitPanel({ from, to }: { from: string; to: string }) {
  const [summary, setSummary] = useState<ProfitSummary | null>(null);
  const [lines, setLines] = useState<ProfitLine[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, l] = await Promise.all([
        fetchProfitSummary({ from, to }),
        fetchProfitLines({ from, to, page, limit: 20 }),
      ]);
      setSummary(s);
      setLines(l.items);
      setMeta(l.meta);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {summary ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Revenue</CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold tabular-nums">{fmtInr(summary.revenue)}</CardContent>
          </Card>
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">COGS</CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold tabular-nums">{fmtInr(summary.cogs)}</CardContent>
          </Card>
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Gross profit</CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold tabular-nums">{fmtInr(summary.grossProfit)}</CardContent>
          </Card>
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Margin</CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold tabular-nums">{summary.marginPct.toFixed(1)}%</CardContent>
          </Card>
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Giveaway units</CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold tabular-nums">{summary.giveawayUnits}</CardContent>
          </Card>
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Promotional cost</CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              {fmtInr(summary.promotionalExpense)}
            </CardContent>
          </Card>
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Discounts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-xl font-semibold tabular-nums">
                {summary.avgDiscountPct.toFixed(1)}%
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">avg off list</span>
              </div>
              <div className="text-sm tabular-nums text-emerald-700 dark:text-emerald-400">
                {fmtInr(summary.discountCost)} discount cost
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
      {summary ? (
        <p className="text-xs text-muted-foreground">{summary.note}</p>
      ) : null}

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Line-level profit</CardTitle>
          <CardDescription>Paginated sale lines in range.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">COGS</TableHead>
                <TableHead className="text-right">Line GP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((row) => (
                <TableRow key={row.orderItemId}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatIstDateTime(row.confirmedAt)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.invoiceNumber ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <FlavourLabel flavour={row.flavourName}>{row.sku}</FlavourLabel>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">{row.productName}</TableCell>
                  <TableCell className="text-xs">
                    {row.isGiveaway ? (
                      <span className="font-medium text-amber-700 dark:text-amber-400">Giveaway</span>
                    ) : (
                      "Sale"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInr(row.lineTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInr(row.cogs)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInr(row.lineGrossProfit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              Page {meta.page} of {Math.max(1, meta.totalPages)} ({meta.total} lines)
            </span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InventoryPanel() {
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ValuationRow[]>([]);
  const [totalVal, setTotalVal] = useState(0);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const out = await fetchInventoryValuation({ page, limit: 20, q: appliedQ || undefined });
      setRows(out.items);
      setMeta(out.meta);
      setTotalVal(out.totals.inventoryValuation);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page, appliedQ]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Inventory valuation</CardTitle>
          <CardDescription>On-hand quantity × WAC from received purchase lines.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-q">Search SKU / name</Label>
              <Input
                id="inv-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="e.g. GVN-"
                className="w-[220px]"
              />
            </div>
            <Button
              type="button"
              onClick={() => {
                setAppliedQ(q.trim());
                setPage(1);
              }}
            >
              Search
            </Button>
          </div>
          {err ? <p className="text-sm text-destructive">{err}</p> : null}
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Total valuation</span>{" "}
            <span className="text-lg font-semibold tabular-nums">{fmtInr(totalVal)}</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">WAC</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.variantId}>
                  <TableCell className="font-mono text-xs">
                    <FlavourLabel flavour={r.flavourName}>{r.sku}</FlavourLabel>
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate">{r.productName}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.quantityOnHand}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.unitCostWac == null ? "—" : fmtInr(r.unitCostWac)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInr(r.valuation)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              Page {meta.page} of {Math.max(1, meta.totalPages)} ({meta.total} SKUs)
            </span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function VelocityPanel({ from, to }: { from: string; to: string }) {
  const [items, setItems] = useState<VelocityRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void fetchFastMoving({ from, to, limit: 15 })
      .then((d) => {
        if (!cancelled) setItems(d.items);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const chartData = useMemo(
    () =>
      items.map((r) => ({
        name: r.sku.length > 14 ? `${r.sku.slice(0, 12)}…` : r.sku,
        units: r.unitsSold,
        revenue: r.revenue,
      })),
    [items],
  );

  return (
    <div className="space-y-4">
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Units sold (top SKUs)</CardTitle>
        </CardHeader>
        <CardContent className="h-[340px] pt-0">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const raw = payload[0].value;
                    const n = typeof raw === "number" ? raw : Number(raw);
                    return (
                      <div className="rounded-lg border border-border/80 bg-popover px-2 py-1 text-xs shadow-md">
                        {Number.isFinite(n) ? `${n} units` : "—"}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="units" name="units" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            !loading && <p className="text-sm text-muted-foreground">No sales in range.</p>
          )}
        </CardContent>
      </Card>
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Detail</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.variantId}>
                  <TableCell className="font-mono text-xs">
                    <FlavourLabel flavour={r.flavourName}>{r.sku}</FlavourLabel>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate">{r.productName}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.unitsSold}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInr(r.revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DeadStockPanel() {
  const [deadAfterDays, setDeadAfterDays] = useState(90);
  const [appliedDays, setAppliedDays] = useState(90);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<DeadStockRow[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const out = await fetchDeadStock({ deadAfterDays: appliedDays, page, limit: 20 });
      setRows(out.items);
      setMeta(out.meta);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [appliedDays, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-base">Dead stock</CardTitle>
        <CardDescription>Active variants with on-hand stock and no sale since cutoff.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="dead-days">Stale after (days)</Label>
            <Input
              id="dead-days"
              type="number"
              min={7}
              max={730}
              value={deadAfterDays}
              onChange={(e) => setDeadAfterDays(Number(e.target.value) || 90)}
              className="w-[120px]"
            />
          </div>
          <Button
            type="button"
            onClick={() => {
              setAppliedDays(deadAfterDays);
              setPage(1);
            }}
          >
            Apply
          </Button>
        </div>
        {err ? <p className="text-sm text-destructive">{err}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Last sale</TableHead>
              <TableHead className="text-right">Days since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.variantId}>
                <TableCell className="font-mono text-xs">
                  <FlavourLabel flavour={r.flavourName}>{r.sku}</FlavourLabel>
                </TableCell>
                <TableCell className="max-w-[200px] truncate">{r.productName}</TableCell>
                <TableCell className="text-right tabular-nums">{r.quantityOnHand}</TableCell>
                <TableCell className="text-xs">
                  {r.lastSaleAt ? formatIstDate(r.lastSaleAt) : "Never"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.daysSinceSale ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Page {meta.page} of {Math.max(1, meta.totalPages)} ({meta.total} rows)
          </span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RetentionPanel({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<RetentionSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void fetchCustomerRetention({ from, to })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  return (
    <div className="space-y-4">
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Customers in period</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">{data.customersInPeriod}</CardContent>
            </Card>
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Repeat purchasers</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">
                {data.repeatCustomersInPeriod}
              </CardContent>
              <p className="px-6 pb-4 text-[11px] text-muted-foreground">2+ orders in range</p>
            </Card>
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Repeat rate</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">{data.repeatRatePct.toFixed(1)}%</CardContent>
            </Card>
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Returning</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">{data.returningCustomers}</CardContent>
              <p className="px-6 pb-4 text-[11px] text-muted-foreground">
                Bought before range ({data.returningRatePct.toFixed(1)}%)
              </p>
            </Card>
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">New customers</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">{data.newCustomers}</CardContent>
              <p className="px-6 pb-4 text-[11px] text-muted-foreground">First sale in range</p>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground">{data.note}</p>
        </>
      ) : null}
    </div>
  );
}

function OffersPanel({ from, to }: { from: string; to: string }) {
  const [items, setItems] = useState<OfferRow[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const out = await fetchOfferPerformance({ from, to, page, limit: 20 });
      setItems(out.items);
      setMeta(out.meta);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartData = useMemo(
    () =>
      items.map((r) => ({
        name: (r.code ?? r.name).length > 16 ? `${(r.code ?? r.name).slice(0, 14)}…` : r.code ?? r.name,
        revenue: r.revenue,
      })),
    [items],
  );

  return (
    <div className="space-y-4">
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Revenue by offer</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] pt-0">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={70} />
                <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={40} tick={{ fontSize: 11 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const raw = payload[0].value;
                    const n = typeof raw === "number" ? raw : Number(raw);
                    return (
                      <div className="rounded-lg border border-border/80 bg-popover px-2 py-1 text-xs shadow-md">
                        {fmtInr(Number.isFinite(n) ? n : 0)}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            !loading && <p className="text-sm text-muted-foreground">No offer-attributed sales in range.</p>
          )}
        </CardContent>
      </Card>
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Offer table</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Discounts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.offerId}>
                  <TableCell className="font-mono text-xs">{r.code ?? "—"}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.orderCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInr(r.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInr(r.discountTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              Page {meta.page} of {Math.max(1, meta.totalPages)} ({meta.total} offers)
            </span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
