import { AlertTriangle, PackageMinus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BrandTag } from "@/components/catalog/brand-tag";
import { FlavourLabel } from "@/components/catalog/flavour-label";
import { StockAdjustmentSheet } from "@/components/inventory/stock-adjustment-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGetJsonAuthed, apiGetJsonAuthedWithMeta, getStoredAccessToken } from "@/lib/api-client";
import { fetchAllPaginated, fetchListMeta } from "@/lib/fetch-paginated";
import { kindLabel, splitByProductKind } from "@/lib/product-kind";
import { cn } from "@/lib/utils";

type Brand = { id: string; name: string };
type Flavour = { id: string; name: string };
type PackSize = { id: string; label: string; code: string; measure: string };
type BalanceRow = {
  quantity: number;
  variant: {
    id: string;
    sku: string;
    product: { id: string; name: string; slug: string; kind: "SUPPLEMENT" | "ACCESSORY" };
    brand: Brand | null;
    flavour: Flavour | null;
    packSize: PackSize | null;
  };
};
type LogRow = {
  id: string;
  quantityDelta: number;
  movementType: string;
  referenceKind: string;
  referenceId: string;
  note: string | null;
  createdAt: string;
  variant: { id: string; sku: string; product: { id: string; name: string } };
};
type StockSummaryRow = {
  variantId: string;
  sku: string;
  productName: string;
  productKind: "SUPPLEMENT" | "ACCESSORY";
  brandName?: string | null;
  flavourName?: string | null;
  packSizeLabel?: string | null;
  variantLabel: string;
  purchasedQty: number;
  soldQty: number;
  returnedQty: number;
  damagedQty: number;
  adjustedQty: number;
  currentStock: number;
  threshold: number;
  status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
};

function movementSwatch(t: string): string {
  const map: Record<string, string> = {
    PURCHASE_IN: "bg-emerald-500",
    SALE_OUT: "bg-rose-500",
    SALE_REVERSAL_IN: "bg-rose-300",
    DAMAGE_OUT: "bg-orange-500",
    RETURN_RESTOCK_IN: "bg-sky-500",
    EXCHANGE_OUT: "bg-amber-500",
    EXCHANGE_IN: "bg-cyan-500",
    ADJUSTMENT_IN: "bg-violet-500",
    ADJUSTMENT_OUT: "bg-violet-400",
  };
  return map[t] ?? "bg-zinc-400";
}

function movementLabel(t: string): string {
  const map: Record<string, string> = {
    SALE_OUT: "Sale (out)",
    SALE_REVERSAL_IN: "Sale reversal",
    PURCHASE_IN: "Purchase (in)",
    RETURN_RESTOCK_IN: "Return restock",
    EXCHANGE_OUT: "Exchange out",
    EXCHANGE_IN: "Exchange in",
    ADJUSTMENT_IN: "Adjustment in",
    ADJUSTMENT_OUT: "Adjustment out",
    DAMAGE_OUT: "Damage / loss",
  };
  return map[t] ?? t;
}

function AuthGate() {
  return (
    <div className="mx-auto max-w-lg py-12">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Sign in required</CardTitle>
          <CardDescription>
            Catalog and inventory APIs require a staff JWT. Sign in with an admin or
            inventory-manager account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild className="rounded-xl">
            <Link to="/login?redirect=/dashboard/inventory">Sign in</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/dashboard">Overview</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function InventoryPage() {
  const authed = Boolean(getStoredAccessToken());
  if (!authed) return <AuthGate />;
  return <InventoryWorkspace />;
}

function InventoryWorkspace() {
  const [tab, setTab] = useState("overview");
  const [adjustOpen, setAdjustOpen] = useState(false);
  // Bumping this remounts the tab panels so freshly written-off stock disappears
  // from the tables without a manual page refresh.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Live stock</h2>
          <p className="text-sm text-muted-foreground">
            Live stock, movement history, and valuation. Stock increases only from{" "}
            <Link to="/dashboard/purchases" className="underline underline-offset-2">
              Purchases
            </Link>
            ; master data lives in{" "}
            <Link to="/dashboard/catalog" className="underline underline-offset-2">
              Master Catalog
            </Link>
            . Sales reduce stock automatically from Billing.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5 rounded-full"
          onClick={() => setAdjustOpen(true)}
        >
          <PackageMinus className="size-4" />
          Adjust stock
        </Button>
      </div>

      <StockAdjustmentSheet
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        onCompleted={() => setRefreshKey((k) => k + 1)}
      />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex h-auto flex-wrap gap-1 rounded-xl bg-muted/50 p-1">
          <TabsTrigger value="overview" className="rounded-lg">
            Overview
          </TabsTrigger>
          <TabsTrigger value="low" className="rounded-lg">
            Low stock
          </TabsTrigger>
          <TabsTrigger value="activity" className="rounded-lg">
            Activity
          </TabsTrigger>
          <TabsTrigger value="valuation" className="rounded-lg">
            Valuation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 space-y-4">
          <OverviewTab key={refreshKey} />
        </TabsContent>
        <TabsContent value="low" className="mt-0">
          <LowStockTab key={refreshKey} />
        </TabsContent>
        <TabsContent value="activity" className="mt-0">
          <ActivityTab key={refreshKey} />
        </TabsContent>
        <TabsContent value="valuation" className="mt-0">
          <ValuationTab key={refreshKey} />
        </TabsContent>
      </Tabs>

      <Card className="border-dashed border-border/70 bg-muted/20">
        <CardContent className="py-4 text-sm text-muted-foreground">
          <strong className="text-foreground">Returns:</strong> approved sales returns with RESTOCK disposition
          can be posted via your returns workflow (
          <code className="rounded bg-muted px-1 text-xs">POST /api/v1/inventory/returns/:id/apply-restock</code>
          ).
        </CardContent>
      </Card>
    </div>
  );
}

function StockLedgerTable({ rows, emptyHint }: { rows: StockSummaryRow[]; emptyHint: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyHint}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Variant</TableHead>
            <TableHead className="text-right">Purchased</TableHead>
            <TableHead className="text-right">Sold</TableHead>
            <TableHead className="text-right">Available</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.variantId}>
              <TableCell>
                <div className="font-medium">{r.productName}</div>
                <div className="text-xs text-muted-foreground">{r.sku}</div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <span className="flex flex-wrap items-center gap-1.5">
                  <BrandTag brand={r.brandName} />
                  <FlavourLabel flavour={r.flavourName}>{r.variantLabel}</FlavourLabel>
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.purchasedQty}</TableCell>
              <TableCell className="text-right tabular-nums">{r.soldQty}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{r.currentStock}</TableCell>
              <TableCell>
                <Badge
                  variant={
                    r.status === "OUT_OF_STOCK"
                      ? "destructive"
                      : r.status === "LOW_STOCK"
                        ? "warning"
                        : "success"
                  }
                >
                  {r.status === "OUT_OF_STOCK"
                    ? "Out"
                    : r.status === "LOW_STOCK"
                      ? "Low"
                      : "In stock"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function OverviewTab() {
  const [rows, setRows] = useState<StockSummaryRow[]>([]);
  const [variantCount, setVariantCount] = useState<number | null>(null);
  const [valuation, setValuation] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const [allRows, meta, val] = await Promise.all([
          fetchAllPaginated<StockSummaryRow>(
            (page) => `/api/v1/inventory/stock-summary?limit=100&page=${page}`,
          ),
          fetchListMeta((page) => `/api/v1/inventory/stock-summary?limit=1&page=${page}`),
          apiGetJsonAuthed<{ items: unknown[]; totals: { inventoryValuation: number } }>(
            "/api/v1/analytics/inventory-valuation?limit=1",
          ),
        ]);
        if (!cancelled) {
          setRows(allRows);
          setVariantCount(meta.total);
          setValuation(val.totals?.inventoryValuation ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { supplement, accessory } = splitByProductKind(rows);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Tracked variants</CardTitle>
          <CardDescription>Rows in inventory balances (paginated list).</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <p className="text-3xl font-semibold tabular-nums">{variantCount ?? "—"}</p>
          )}
        </CardContent>
      </Card>
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Inventory valuation</CardTitle>
          <CardDescription>Pre-GST WAC from purchase receipts × on-hand qty.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <p className="text-3xl font-semibold tabular-nums">
              {valuation === null
                ? "—"
                : new Intl.NumberFormat("en-IN", {
                    style: "currency",
                    currency: "INR",
                    maximumFractionDigits: 0,
                  }).format(valuation)}
            </p>
          )}
        </CardContent>
      </Card>
      <Card className="border-border/60 sm:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Live stock ledger</CardTitle>
          <CardDescription>
            Purchased and sold are rolled up from inventory logs; available is live on-hand (includes
            returns, damages, and adjustments in the net position).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading stock ledger…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No variants yet. Create products in Catalog, then receive stock via Purchases.
            </p>
          ) : (
            <div className="space-y-8">
              <section className="space-y-3">
                <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-2">
                  <h3 className="text-sm font-semibold">{kindLabel("SUPPLEMENT")}</h3>
                  <span className="text-xs text-muted-foreground">
                    {supplement.length} variant{supplement.length === 1 ? "" : "s"}
                  </span>
                </div>
                <StockLedgerTable rows={supplement} emptyHint="No supplement variants in stock." />
              </section>
              <section className="space-y-3">
                <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-2">
                  <h3 className="text-sm font-semibold">{kindLabel("ACCESSORY")}</h3>
                  <span className="text-xs text-muted-foreground">
                    {accessory.length} variant{accessory.length === 1 ? "" : "s"}
                  </span>
                </div>
                <StockLedgerTable rows={accessory} emptyHint="No accessory variants in stock." />
              </section>
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="border-border/60 sm:col-span-2">
        <CardContent className="flex flex-wrap gap-3 py-6">
          <Button asChild variant="secondary" className="rounded-xl">
            <Link to="/dashboard/catalog">Open catalog</Link>
          </Button>
          <Button asChild className="rounded-xl">
            <Link to="/dashboard/purchases">Record purchase</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

type ValuationRow = {
  variantId: string;
  sku: string;
  productName: string;
  brandName?: string | null;
  flavourName?: string | null;
  packSizeLabel?: string | null;
  quantityOnHand: number;
  unitCostWac: number | null;
  valuation: number;
};

function ValuationTab() {
  const [rows, setRows] = useState<ValuationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const { data } = await apiGetJsonAuthedWithMeta<{
          items: ValuationRow[];
          totals: { inventoryValuation: number };
        }>("/api/v1/analytics/inventory-valuation?limit=50");
        if (!cancelled) {
          setRows(data.items);
          setTotal(data.totals.inventoryValuation);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-base">Valuation detail</CardTitle>
        <CardDescription>Top lines by extended value ({rows.length} shown).</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              Total on-book:{" "}
              <span className="font-medium text-foreground">
                {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(total)}
              </span>
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">WAC (ex-GST)</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.variantId}>
                    <TableCell className="font-mono text-xs">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <BrandTag brand={r.brandName} />
                        <FlavourLabel flavour={r.flavourName}>{r.sku}</FlavourLabel>
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{r.productName}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.quantityOnHand}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {r.unitCostWac === null
                        ? "—"
                        : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
                            r.unitCostWac,
                          )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
                        r.valuation,
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LowStockTable({ rows }: { rows: BalanceRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead>SKU</TableHead>
          <TableHead>Variant</TableHead>
          <TableHead className="text-right">Qty</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.variant.id}>
            <TableCell className="font-medium">{r.variant.product.name}</TableCell>
            <TableCell className="font-mono text-xs">
              <FlavourLabel flavour={r.variant.flavour?.name}>{r.variant.sku}</FlavourLabel>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              <FlavourLabel flavour={r.variant.flavour?.name}>
                {[r.variant.flavour?.name, r.variant.packSize?.label].filter(Boolean).join(" / ") || "—"}
              </FlavourLabel>
            </TableCell>
            <TableCell className="text-right">
              <Badge variant={r.quantity === 0 ? "destructive" : "warning"}>{r.quantity}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function LowStockByKind({ rows }: { rows: BalanceRow[] }) {
  const mapped = rows.map((r) => ({ ...r, productKind: r.variant.product.kind }));
  const { supplement, accessory } = splitByProductKind(mapped);
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold border-b border-border/60 pb-2">{kindLabel("SUPPLEMENT")}</h3>
        {supplement.length === 0 ? (
          <p className="text-sm text-muted-foreground">No low-stock supplements.</p>
        ) : (
          <LowStockTable rows={supplement} />
        )}
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold border-b border-border/60 pb-2">{kindLabel("ACCESSORY")}</h3>
        {accessory.length === 0 ? (
          <p className="text-sm text-muted-foreground">No low-stock accessories.</p>
        ) : (
          <LowStockTable rows={accessory} />
        )}
      </section>
    </div>
  );
}

function LowStockTab() {
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [threshold, setThreshold] = useState("10");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const t = Math.max(0, Math.min(1000, Number(threshold) || 10));
      const { data } = await apiGetJsonAuthedWithMeta<BalanceRow[]>(
        `/api/v1/inventory/balances?lowStock=true&threshold=${t}&limit=100`,
      );
      setRows(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [threshold]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600" />
            Low stock
          </CardTitle>
          <CardDescription>Variants at or below the threshold on hand.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Input
            className="w-24"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="Threshold"
          />
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {err ? <p className="text-sm text-destructive">{err}</p> : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No low-stock rows. Raise threshold or add inventory.</p>
        ) : (
          <LowStockByKind rows={rows} />
        )}
      </CardContent>
    </Card>
  );
}

function ActivityTab() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const { data } = await apiGetJsonAuthedWithMeta<LogRow[]>(
          "/api/v1/inventory/logs?limit=100",
        );
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-base">Inventory log</CardTitle>
        <CardDescription>Recent movements (purchases, sales, returns).</CardDescription>
      </CardHeader>
      <CardContent>
        {err ? <p className="text-sm text-destructive">{err}</p> : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ScrollArea className="h-[min(60vh,520px)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Movement</TableHead>
                  <TableHead className="text-right">Δ</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">{r.variant.product.name}</TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={cn("size-2 shrink-0 rounded-full", movementSwatch(r.movementType))}
                          title={r.movementType}
                        />
                        {movementLabel(r.movementType)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {r.quantityDelta > 0 ? `+${r.quantityDelta}` : r.quantityDelta}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {r.note ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
