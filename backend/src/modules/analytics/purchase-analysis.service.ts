import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { PurchaseAnalysisQuery } from "./analytics.validators.js";

export type PurchaseAnalysisStatus =
  | "OUT_OF_STOCK"
  | "CRITICAL"
  | "ABOUT_TO_FINISH"
  | "FAST_MOVING_LOW"
  | "LOW_STOCK";

export type PurchaseAnalysisRow = {
  variantId: string;
  sku: string;
  brand: string | null;
  productName: string;
  productKind: string;
  flavourName: string | null;
  packSizeLabel: string | null;
  variantLabel: string;
  currentStock: number;
  threshold: number;
  unitsSold: number;
  avgDailySales: number;
  daysOfStockLeft: number | null;
  isFastMoving: boolean;
  status: PurchaseAnalysisStatus;
  priority: number;
  suggestedReorderQty: number;
  analysisNote: string;
};

export type PurchaseAnalysisSummary = {
  outOfStock: number;
  critical: number;
  aboutToFinish: number;
  fastMovingLow: number;
  lowStock: number;
  totalSkus: number;
  totalSuggestedUnits: number;
};

const ABOUT_TO_FINISH_DAYS = 7;
const CRITICAL_DAYS_LEFT = 3;
const MIN_UNITS_FAST_MOVING = 2;

import { istYmd, parseIstDayRange } from "../../lib/ist-time.js";

function trendRange(trendDays: number): { from: string; to: string; start: Date; endExclusive: Date } {
  const to = istYmd();
  const end = new Date(`${to}T00:00:00+05:30`);
  const start = new Date(end.getTime() - (trendDays - 1) * 86_400_000);
  const from = istYmd(start);
  const { start: rangeStart, endExclusive } = parseIstDayRange(from, to);
  return { from, to, start: rangeStart, endExclusive };
}

function fastMovingVariantIds(
  rows: { variantId: string; unitsSold: number }[],
): Set<string> {
  const withSales = rows
    .filter((r) => r.unitsSold > 0)
    .sort((a, b) => b.unitsSold - a.unitsSold);
  if (withSales.length === 0) return new Set();

  const topCount = Math.max(1, Math.ceil(withSales.length * 0.25));
  return new Set(
    withSales
      .slice(0, topCount)
      .filter((r) => r.unitsSold >= MIN_UNITS_FAST_MOVING)
      .map((r) => r.variantId),
  );
}

function suggestedReorderQty(
  currentStock: number,
  avgDailySales: number,
  threshold: number,
  coverDays: number,
): number {
  const velocityTarget =
    avgDailySales > 0 ? Math.ceil(avgDailySales * coverDays) : 0;
  const minimumBuffer = currentStock === 0 ? Math.max(threshold, 5) : threshold;
  const targetLevel = Math.max(minimumBuffer, velocityTarget);
  return Math.max(0, targetLevel - currentStock);
}

function classifyRow(input: {
  currentStock: number;
  threshold: number;
  isFastMoving: boolean;
  avgDailySales: number;
  daysOfStockLeft: number | null;
}): { include: boolean; status: PurchaseAnalysisStatus; priority: number; note: string } | null {
  const { currentStock, threshold, isFastMoving, avgDailySales, daysOfStockLeft } = input;

  if (currentStock === 0) {
    return {
      include: true,
      status: "OUT_OF_STOCK",
      priority: 1,
      note: "Out of stock — compulsory reorder",
    };
  }

  if (currentStock === 1 || currentStock === 2) {
    const urgent =
      isFastMoving ||
      (daysOfStockLeft !== null && daysOfStockLeft <= CRITICAL_DAYS_LEFT);
    if (urgent) {
      const reason = isFastMoving
        ? "Fast-moving SKU with only 1–2 units left"
        : `High velocity — ~${daysOfStockLeft!.toFixed(1)} days of stock left`;
      return {
        include: true,
        status: "CRITICAL",
        priority: 2,
        note: reason,
      };
    }
    return {
      include: true,
      status: "LOW_STOCK",
      priority: 5,
      note: "Low stock — slower sales trend, still reorder soon",
    };
  }

  if (
    avgDailySales > 0 &&
    daysOfStockLeft !== null &&
    daysOfStockLeft <= ABOUT_TO_FINISH_DAYS
  ) {
    return {
      include: true,
      status: "ABOUT_TO_FINISH",
      priority: 3,
      note: `Trend projects stockout in ~${daysOfStockLeft.toFixed(1)} days`,
    };
  }

  if (isFastMoving && currentStock <= threshold) {
    return {
      include: true,
      status: "FAST_MOVING_LOW",
      priority: 4,
      note: `Fast-moving SKU below threshold (${threshold})`,
    };
  }

  return null;
}

export async function getPurchaseAnalysis(input: PurchaseAnalysisQuery) {
  const { trendDays, coverDays } = input;
  const range = trendRange(trendDays);

  const rows = await prisma.$queryRaw<
    {
      variant_id: string;
      sku: string;
      brand: string | null;
      product_name: string;
      product_kind: string;
      flavour_name: string | null;
      pack_size_label: string | null;
      current_stock: number;
      low_stock_threshold: number | null;
      units_sold: string | null;
    }[]
  >(Prisma.sql`
    WITH period_sales AS (
      SELECT
        oi.variant_id,
        SUM(oi.quantity::numeric) AS units_sold
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE o.document_type = 'SALE'::"OrderDocumentType"
        AND o.status = 'CONFIRMED'::"OrderStatus"
        AND o.confirmed_at >= ${range.start}
        AND o.confirmed_at < ${range.endExclusive}
      GROUP BY oi.variant_id
    )
    SELECT
      pv.id AS variant_id,
      pv.sku,
      b.name AS brand,
      p.name AS product_name,
      p.kind::text AS product_kind,
      fl.name AS flavour_name,
      pk.label AS pack_size_label,
      COALESCE(ib.quantity, 0) AS current_stock,
      pv.low_stock_threshold,
      COALESCE(ps.units_sold, 0)::text AS units_sold
    FROM product_variants pv
    INNER JOIN products p ON p.id = pv.product_id
    LEFT JOIN brands b ON b.id = pv.brand_id
    LEFT JOIN flavours fl ON fl.id = pv.flavour_id
    LEFT JOIN pack_sizes pk ON pk.id = pv.pack_size_id
    LEFT JOIN inventory_balances ib ON ib.variant_id = pv.id
    LEFT JOIN period_sales ps ON ps.variant_id = pv.id
    WHERE pv.is_active = true
      AND p.is_active = true
    ORDER BY p.name ASC, pv.sku ASC
  `);

  const base = rows.map((r) => {
    const currentStock = Number(r.current_stock);
    const threshold = r.low_stock_threshold ?? 5;
    const unitsSold = Number(r.units_sold ?? 0);
    const avgDailySales = unitsSold / trendDays;
    const daysOfStockLeft =
      avgDailySales > 0 ? currentStock / avgDailySales : null;
    return {
      variantId: r.variant_id,
      sku: r.sku,
      brand: r.brand,
      productName: r.product_name,
      productKind: r.product_kind,
      flavourName: r.flavour_name,
      packSizeLabel: r.pack_size_label,
      variantLabel:
        [r.flavour_name, r.pack_size_label].filter(Boolean).join(" / ") || "Default",
      currentStock,
      threshold,
      unitsSold,
      avgDailySales,
      daysOfStockLeft,
    };
  });

  const fastMoving = fastMovingVariantIds(base);

  const items: PurchaseAnalysisRow[] = [];
  for (const row of base) {
    const isFastMoving = fastMoving.has(row.variantId);
    const classified = classifyRow({
      currentStock: row.currentStock,
      threshold: row.threshold,
      isFastMoving,
      avgDailySales: row.avgDailySales,
      daysOfStockLeft: row.daysOfStockLeft,
    });
    if (!classified) continue;

    items.push({
      ...row,
      isFastMoving,
      status: classified.status,
      priority: classified.priority,
      suggestedReorderQty: suggestedReorderQty(
        row.currentStock,
        row.avgDailySales,
        row.threshold,
        coverDays,
      ),
      analysisNote: classified.note,
      daysOfStockLeft:
        row.daysOfStockLeft === null
          ? null
          : Math.round(row.daysOfStockLeft * 10) / 10,
      avgDailySales: Math.round(row.avgDailySales * 100) / 100,
    });
  }

  items.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const daysA = a.daysOfStockLeft ?? Number.POSITIVE_INFINITY;
    const daysB = b.daysOfStockLeft ?? Number.POSITIVE_INFINITY;
    if (daysA !== daysB) return daysA - daysB;
    return b.unitsSold - a.unitsSold;
  });

  const summary: PurchaseAnalysisSummary = {
    outOfStock: items.filter((i) => i.status === "OUT_OF_STOCK").length,
    critical: items.filter((i) => i.status === "CRITICAL").length,
    aboutToFinish: items.filter((i) => i.status === "ABOUT_TO_FINISH").length,
    fastMovingLow: items.filter((i) => i.status === "FAST_MOVING_LOW").length,
    lowStock: items.filter((i) => i.status === "LOW_STOCK").length,
    totalSkus: items.length,
    totalSuggestedUnits: items.reduce((s, i) => s + i.suggestedReorderQty, 0),
  };

  return {
    trendDays,
    coverDays,
    trendFrom: range.from,
    trendTo: range.to,
    summary,
    items,
  };
}
