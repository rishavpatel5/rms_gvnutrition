import { useCallback, useEffect, useState } from "react";
import type { KpiCardProps } from "@/components/dashboard/kpi-card";
import { apiGetJsonAuthedWithMeta, getStoredAccessToken } from "@/lib/api-client";
import {
  fetchCustomerRetention,
  fetchFastMoving,
  fetchOrdersReport,
  fetchProfitSummary,
  fetchSalesSeries,
  type OrderReportRow,
  type RetentionSummary,
} from "@/lib/analytics-api";
import {
  formatRelativePast,
  lastSixMonthsRange,
  monthLabel,
  priorWindow,
  rollingDaysRange,
} from "@/lib/dashboard-dates";

const fmtInr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

function fmtInrCompact(n: number): string {
  if (n >= 100_000) {
    const lakhs = n / 100_000;
    return `₹${lakhs >= 10 ? lakhs.toFixed(1) : lakhs.toFixed(2)}L`;
  }
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}k`;
  return fmtInr(n);
}

function pctDelta(current: number, previous: number): { delta: string; positive: boolean } {
  if (previous === 0) {
    if (current === 0) return { delta: "—", positive: true };
    return { delta: "+100%", positive: true };
  }
  const pct = ((current - previous) / previous) * 100;
  const positive = pct >= 0;
  const sign = positive ? "+" : "";
  return { delta: `${sign}${pct.toFixed(1)}%`, positive };
}

export type RevenueChartPoint = { month: string; revenue: number; orders: number };

export type DashboardKpi = KpiCardProps & { id: string };

export type InventoryAlertRow = {
  id: string;
  sku: string;
  name: string;
  flavourName: string | null;
  level: number;
  status: "critical" | "low";
};

export type TopProductRow = {
  id: string;
  name: string;
  units: number;
  revenue: number;
};

export type RecentBillRow = {
  id: string;
  customer: string;
  time: string;
  total: number;
  status: "paid" | "pending" | "voided";
};

export type CustomerInsightsData = {
  newPct: number;
  returningPct: number;
  repeatRatePct: number;
  customersInPeriod: number;
  newCustomers: number;
  returningCustomers: number;
  note: string;
};

type BalanceRow = {
  quantity: number;
  variant: {
    id: string;
    sku: string;
    product: { name: string };
    flavour: { name: string } | null;
    packSize: { label: string } | null;
  };
};

function variantLabel(row: BalanceRow): string {
  const parts = [row.variant.product.name];
  const attrs = [row.variant.flavour?.name, row.variant.packSize?.label].filter(Boolean);
  if (attrs.length) parts.push(attrs.join(" / "));
  return parts.join(" — ");
}

function billStatus(row: OrderReportRow): RecentBillRow["status"] {
  if (row.status === "VOIDED") return "voided";
  if (row.payments.some((p) => p.status === "PENDING")) return "pending";
  return "paid";
}

function retentionToInsights(data: RetentionSummary): CustomerInsightsData {
  const total = data.customersInPeriod || 1;
  const newPct = Math.round((data.newCustomers / total) * 100);
  const returningPct = Math.round((data.returningCustomers / total) * 100);
  return {
    newPct,
    returningPct,
    repeatRatePct: data.repeatRatePct,
    customersInPeriod: data.customersInPeriod,
    newCustomers: data.newCustomers,
    returningCustomers: data.returningCustomers,
    note: data.note,
  };
}

export function useDashboardOverview() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [kpis, setKpis] = useState<DashboardKpi[]>([]);
  const [revenueSeries, setRevenueSeries] = useState<RevenueChartPoint[]>([]);
  const [inventoryAlerts, setInventoryAlerts] = useState<InventoryAlertRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  const [recentBills, setRecentBills] = useState<RecentBillRow[]>([]);
  const [customerInsights, setCustomerInsights] = useState<CustomerInsightsData | null>(null);

  const load = useCallback(async () => {
    if (!getStoredAccessToken()) {
      setNeedsAuth(true);
      setLoading(false);
      setError(null);
      setKpis([]);
      setRevenueSeries([]);
      setInventoryAlerts([]);
      setTopProducts([]);
      setRecentBills([]);
      setCustomerInsights(null);
      return;
    }

    setNeedsAuth(false);
    setLoading(true);
    setError(null);

    const window30 = rollingDaysRange(30);
    const windowPrev = priorWindow(window30.from, window30.to);
    const window6m = lastSixMonthsRange();
    const lowStockThreshold = 10;

    try {
      const [
        salesNow,
        salesPrev,
        profitNow,
        profitPrev,
        series6m,
        fastMoving,
        orders,
        retention,
        balances,
      ] = await Promise.all([
        fetchSalesSeries({ ...window30, granularity: "daily" }),
        fetchSalesSeries({ ...windowPrev, granularity: "daily" }),
        fetchProfitSummary(window30),
        fetchProfitSummary(windowPrev),
        fetchSalesSeries({ ...window6m, granularity: "monthly" }),
        fetchFastMoving({ ...window30, limit: 5 }),
        fetchOrdersReport({ ...window30, limit: 8, status: "CONFIRMED", documentType: "SALE" }),
        fetchCustomerRetention(window30),
        apiGetJsonAuthedWithMeta<BalanceRow[]>(
          `/api/v1/inventory/balances?lowStock=true&threshold=${lowStockThreshold}&limit=8`,
        ),
      ]);

      const netNow = salesNow.totals.netSales;
      const netPrev = salesPrev.totals.netSales;
      const ordersNow = salesNow.totals.saleOrderCount;
      const ordersPrev = salesPrev.totals.saleOrderCount;
      const aovNow = ordersNow > 0 ? netNow / ordersNow : 0;
      const aovPrev = ordersPrev > 0 ? netPrev / ordersPrev : 0;

      const revDelta = pctDelta(netNow, netPrev);
      const ordDelta = pctDelta(ordersNow, ordersPrev);
      const aovDelta = pctDelta(aovNow, aovPrev);
      const marginDelta = pctDelta(profitNow.marginPct, profitPrev.marginPct);

      setKpis([
        {
          id: "rev",
          label: "Net revenue",
          value: fmtInrCompact(netNow),
          delta: revDelta.delta,
          positive: revDelta.positive,
          hint: "vs prior 30 days",
        },
        {
          id: "orders",
          label: "Orders",
          value: String(ordersNow),
          delta: ordDelta.delta,
          positive: ordDelta.positive,
          hint: "30-day window",
        },
        {
          id: "aov",
          label: "Avg. order value",
          value: fmtInr(aovNow),
          delta: aovDelta.delta,
          positive: aovDelta.positive,
          hint: "basket size",
        },
        {
          id: "margin",
          label: "Gross margin",
          value: `${profitNow.marginPct.toFixed(1)}%`,
          delta: marginDelta.delta,
          positive: marginDelta.positive,
          hint: "after discounts",
        },
      ]);

      setRevenueSeries(
        series6m.buckets.map((b) => ({
          month: monthLabel(b.periodStart),
          revenue: b.netSales,
          orders: b.saleOrderCount,
        })),
      );

      setInventoryAlerts(
        balances.data.slice(0, 8).map((row) => {
          const qty = row.quantity;
          const critical = qty <= Math.max(1, Math.floor(lowStockThreshold / 2));
          return {
            id: row.variant.id,
            sku: row.variant.sku,
            name: variantLabel(row),
            flavourName: row.variant.flavour?.name ?? null,
            level: qty,
            status: critical ? "critical" : "low",
          };
        }),
      );

      setTopProducts(
        fastMoving.items.map((p) => ({
          id: p.variantId,
          name: p.productName,
          units: p.unitsSold,
          revenue: p.revenue,
        })),
      );

      setRecentBills(
        orders.items.map((row) => ({
          id: row.invoiceNumber ?? row.id.slice(0, 8),
          customer: row.isWalkIn
            ? "Walk-in"
            : (row.customer?.fullName ?? "Guest"),
          time: formatRelativePast(row.confirmedAt ?? row.createdAt),
          total: Number(row.totals.grandTotal) || 0,
          status: billStatus(row),
        })),
      );

      setCustomerInsights(retentionToInsights(retention));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    loading,
    error,
    needsAuth,
    reload: load,
    kpis,
    revenueSeries,
    inventoryAlerts,
    topProducts,
    recentBills,
    customerInsights,
  };
}
