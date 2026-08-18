import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { buildMeta, parsePagination } from "../../lib/pagination.js";
import { parseIstDayRange } from "./analytics.range.js";
import type {
  DateRangeQuery,
  DeadStockQuery,
  FastMovingQuery,
  InventoryValuationQuery,
  OfferPerformanceQuery,
  ProfitLinesQuery,
  SalesSeriesQuery,
} from "./analytics.validators.js";

/** `date_trunc` unit for PostgreSQL — never interpolate user strings. */
function truncUnit(granularity: SalesSeriesQuery["granularity"]): Prisma.Sql {
  switch (granularity) {
    case "daily":
      return Prisma.raw("'day'");
    case "weekly":
      return Prisma.raw("'week'");
    case "monthly":
      return Prisma.raw("'month'");
    default:
      return Prisma.raw("'day'");
  }
}

function customerClause(customerId?: string | null): Prisma.Sql {
  if (!customerId) return Prisma.empty;
  return Prisma.sql`AND o.customer_id = ${customerId}`;
}

export async function getSalesBuckets(input: SalesSeriesQuery) {
  const { start, endExclusive } = parseIstDayRange(input.from, input.to);
  const unit = truncUnit(input.granularity);

  const rows = await prisma.$queryRaw<
    {
      period_start: Date;
      gross_sales: string | null;
      credit_total: string | null;
      sale_orders: bigint;
      credit_orders: bigint;
    }[]
  >(Prisma.sql`
    SELECT
      date_trunc(${unit}, o.confirmed_at AT TIME ZONE 'Asia/Kolkata') AS period_start,
      COALESCE(SUM(CASE
        WHEN o.document_type = 'SALE'::"OrderDocumentType"
         AND o.status = 'CONFIRMED'::"OrderStatus"
        THEN o.grand_total::numeric
        ELSE 0::numeric
      END), 0)::text AS gross_sales,
      COALESCE(SUM(CASE
        WHEN o.document_type = 'CREDIT_NOTE'::"OrderDocumentType"
         AND o.status = 'CONFIRMED'::"OrderStatus"
        THEN o.grand_total::numeric
        ELSE 0::numeric
      END), 0)::text AS credit_total,
      COUNT(*) FILTER (WHERE o.document_type = 'SALE'::"OrderDocumentType" AND o.status = 'CONFIRMED'::"OrderStatus")::bigint AS sale_orders,
      COUNT(*) FILTER (WHERE o.document_type = 'CREDIT_NOTE'::"OrderDocumentType" AND o.status = 'CONFIRMED'::"OrderStatus")::bigint AS credit_orders
    FROM orders o
    WHERE o.confirmed_at >= ${start}
      AND o.confirmed_at < ${endExclusive}
      AND (
        (o.document_type = 'SALE'::"OrderDocumentType" AND o.status = 'CONFIRMED'::"OrderStatus")
        OR (o.document_type = 'CREDIT_NOTE'::"OrderDocumentType" AND o.status = 'CONFIRMED'::"OrderStatus")
      )
      ${customerClause(input.customerId)}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const buckets = rows.map((r) => {
    const gross = Number(r.gross_sales ?? 0);
    const credits = Number(r.credit_total ?? 0);
    return {
      periodStart: r.period_start.toISOString(),
      grossSales: gross,
      creditNotes: credits,
      netSales: gross - credits,
      saleOrderCount: Number(r.sale_orders),
      creditNoteCount: Number(r.credit_orders),
    };
  });

  const totals = buckets.reduce(
    (acc, b) => ({
      grossSales: acc.grossSales + b.grossSales,
      creditNotes: acc.creditNotes + b.creditNotes,
      netSales: acc.netSales + b.netSales,
      saleOrderCount: acc.saleOrderCount + b.saleOrderCount,
      creditNoteCount: acc.creditNoteCount + b.creditNoteCount,
    }),
    { grossSales: 0, creditNotes: 0, netSales: 0, saleOrderCount: 0, creditNoteCount: 0 },
  );

  return { granularity: input.granularity, buckets, totals };
}

export async function getProfitSummary(input: DateRangeQuery) {
  const { start, endExclusive } = parseIstDayRange(input.from, input.to);

  const [row] = await prisma.$queryRaw<
    {
      revenue: string | null;
      cogs: string | null;
      line_qty: string | null;
      giveaway_units: string | null;
      giveaway_cost: string | null;
      discount_cost: string | null;
      gross_list: string | null;
    }[]
  >(Prisma.sql`
    WITH wac AS (
      SELECT
        variant_id,
        CASE
          WHEN SUM(quantity_received::numeric) > 0 THEN
            SUM(quantity_received::numeric * unit_cost_exclusive::numeric)
            / NULLIF(SUM(quantity_received::numeric), 0)
          ELSE NULL
        END AS unit_cost_wac
      FROM purchase_order_items
      WHERE quantity_received > 0
      GROUP BY variant_id
    )
    SELECT
      COALESCE(SUM(oi.line_total::numeric), 0)::text AS revenue,
      COALESCE(SUM(
        oi.quantity::numeric * (
          CASE
            WHEN oi.is_giveaway OR oi.line_total = 0 THEN
              COALESCE(oi.unit_cost_snapshot, w.unit_cost_wac, pv.cost_price, 0::numeric)
            ELSE COALESCE(w.unit_cost_wac, pv.cost_price, 0::numeric)
          END
        )
      ), 0)::text AS cogs,
      COALESCE(SUM(oi.quantity::numeric), 0)::text AS line_qty,
      COALESCE(SUM(
        CASE WHEN oi.is_giveaway OR oi.line_total = 0 THEN oi.quantity ELSE 0 END
      ), 0)::text AS giveaway_units,
      COALESCE(SUM(
        CASE
          WHEN oi.is_giveaway OR oi.line_total = 0 THEN
            oi.quantity::numeric * COALESCE(oi.unit_cost_snapshot, w.unit_cost_wac, pv.cost_price, 0::numeric)
          ELSE 0::numeric
        END
      ), 0)::text AS giveaway_cost,
      COALESCE(SUM(oi.line_discount::numeric), 0)::text AS discount_cost,
      COALESCE(SUM(oi.unit_price::numeric * oi.quantity::numeric), 0)::text AS gross_list
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    INNER JOIN product_variants pv ON pv.id = oi.variant_id
    LEFT JOIN wac w ON w.variant_id = oi.variant_id
    WHERE o.document_type = 'SALE'::"OrderDocumentType"
      AND o.status = 'CONFIRMED'::"OrderStatus"
      AND o.confirmed_at >= ${start}
      AND o.confirmed_at < ${endExclusive}
      ${customerClause(input.customerId)}
  `);

  const revenue = Number(row?.revenue ?? 0);
  const cogs = Number(row?.cogs ?? 0);
  const giveawayUnits = Number(row?.giveaway_units ?? 0);
  const giveawayCost = Number(row?.giveaway_cost ?? 0);
  const discountCost = Number(row?.discount_cost ?? 0);
  const grossList = Number(row?.gross_list ?? 0);
  const grossProfit = revenue - cogs;
  return {
    revenue,
    cogs,
    grossProfit,
    marginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    giveawayUnits,
    giveawayCost,
    promotionalExpense: giveawayCost,
    discountCost,
    avgDiscountPct: grossList > 0 ? (discountCost / grossList) * 100 : 0,
    note:
      "Giveaway lines are any ₹0 bill lines (free toggle or full discount). Discount cost is total item + bill discounts on list price. Avg discount % = discount cost ÷ gross list value.",
  };
}

export async function getProfitLines(input: ProfitLinesQuery) {
  const { start, endExclusive } = parseIstDayRange(input.from, input.to);
  const { page, limit, skip } = parsePagination({
    page: input.page,
    limit: input.limit,
  });

  const baseWhere = Prisma.sql`
    o.document_type = 'SALE'::"OrderDocumentType"
    AND o.status = 'CONFIRMED'::"OrderStatus"
    AND o.confirmed_at >= ${start}
    AND o.confirmed_at < ${endExclusive}
    ${customerClause(input.customerId)}
  `;

  const [countRow] = await prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS c
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    WHERE ${baseWhere}
  `);

  const total = Number(countRow?.c ?? 0);

  const rows = await prisma.$queryRaw<
    {
      order_item_id: string;
      order_id: string;
      confirmed_at: Date;
      invoice_number: string | null;
      sku: string;
      product_name: string;
      brand_name: string | null;
      flavour_name: string | null;
      quantity: number;
      line_total: string;
      is_giveaway: boolean;
      unit_cost: string | null;
      cogs: string;
    }[]
  >(Prisma.sql`
    WITH wac AS (
      SELECT
        variant_id,
        CASE
          WHEN SUM(quantity_received::numeric) > 0 THEN
            SUM(quantity_received::numeric * unit_cost_exclusive::numeric)
            / NULLIF(SUM(quantity_received::numeric), 0)
          ELSE NULL
        END AS unit_cost_wac
      FROM purchase_order_items
      WHERE quantity_received > 0
      GROUP BY variant_id
    )
    SELECT
      oi.id AS order_item_id,
      o.id AS order_id,
      o.confirmed_at,
      o.invoice_number,
      pv.sku,
      p.name AS product_name,
      br.name AS brand_name,
      fl.name AS flavour_name,
      oi.quantity,
      oi.line_total::text AS line_total,
      (oi.is_giveaway OR oi.line_total = 0) AS is_giveaway,
      (
        CASE
          WHEN oi.is_giveaway OR oi.line_total = 0 THEN
            COALESCE(oi.unit_cost_snapshot, w.unit_cost_wac, pv.cost_price, 0::numeric)
          ELSE COALESCE(w.unit_cost_wac, pv.cost_price, 0::numeric)
        END
      )::text AS unit_cost,
      (
        oi.quantity::numeric * (
          CASE
            WHEN oi.is_giveaway OR oi.line_total = 0 THEN
              COALESCE(oi.unit_cost_snapshot, w.unit_cost_wac, pv.cost_price, 0::numeric)
            ELSE COALESCE(w.unit_cost_wac, pv.cost_price, 0::numeric)
          END
        )
      )::text AS cogs
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    INNER JOIN product_variants pv ON pv.id = oi.variant_id
    INNER JOIN products p ON p.id = pv.product_id
    LEFT JOIN brands br ON br.id = pv.brand_id
    LEFT JOIN flavours fl ON fl.id = pv.flavour_id
    LEFT JOIN wac w ON w.variant_id = oi.variant_id
    WHERE ${baseWhere}
    ORDER BY o.confirmed_at DESC, oi.id ASC
    OFFSET ${skip} LIMIT ${limit}
  `);

  const items = rows.map((r) => ({
    orderItemId: r.order_item_id,
    orderId: r.order_id,
    confirmedAt: r.confirmed_at.toISOString(),
    invoiceNumber: r.invoice_number,
    sku: r.sku,
    productName: r.product_name,
    brandName: r.brand_name,
    flavourName: r.flavour_name,
    quantity: r.quantity,
    lineTotal: Number(r.line_total),
    isGiveaway: r.is_giveaway,
    unitCostWac: r.unit_cost === null ? null : Number(r.unit_cost),
    cogs: Number(r.cogs),
    lineGrossProfit: Number(r.line_total) - Number(r.cogs),
  }));

  return { items, meta: buildMeta(page, limit, total) };
}

export async function getInventoryValuation(input: InventoryValuationQuery) {
  const { page, limit, skip } = parsePagination({
    page: input.page,
    limit: input.limit,
  });
  const q = input.q?.trim();
  const searchClause =
    q && q.length > 0
      ? Prisma.sql`AND (
          pv.sku ILIKE ${"%" + q + "%"}
          OR p.name ILIKE ${"%" + q + "%"}
          OR COALESCE(fl.name, '') ILIKE ${"%" + q + "%"}
        )`
      : Prisma.empty;

  const [countRow] = await prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
    WITH wac AS (
      SELECT
        variant_id,
        CASE
          WHEN SUM(quantity_received::numeric) > 0 THEN
            SUM(quantity_received::numeric * unit_cost_exclusive::numeric)
            / NULLIF(SUM(quantity_received::numeric), 0)
          ELSE NULL
        END AS unit_cost_wac
      FROM purchase_order_items
      WHERE quantity_received > 0
      GROUP BY variant_id
    )
    SELECT COUNT(*)::bigint AS c
    FROM inventory_balances ib
    INNER JOIN product_variants pv ON pv.id = ib.variant_id
    INNER JOIN products p ON p.id = pv.product_id
    LEFT JOIN brands br ON br.id = pv.brand_id
    LEFT JOIN flavours fl ON fl.id = pv.flavour_id
    LEFT JOIN wac w ON w.variant_id = pv.id
    WHERE ib.quantity > 0
      ${searchClause}
  `);

  const total = Number(countRow?.c ?? 0);

  const rows = await prisma.$queryRaw<
    {
      variant_id: string;
      sku: string;
      product_name: string;
      brand_name: string | null;
      flavour_name: string | null;
      pack_size_label: string | null;
      quantity: number;
      unit_cost_wac: string | null;
      line_value: string;
    }[]
  >(Prisma.sql`
    WITH wac AS (
      SELECT
        variant_id,
        CASE
          WHEN SUM(quantity_received::numeric) > 0 THEN
            SUM(quantity_received::numeric * unit_cost_exclusive::numeric)
            / NULLIF(SUM(quantity_received::numeric), 0)
          ELSE NULL
        END AS unit_cost_wac
      FROM purchase_order_items
      WHERE quantity_received > 0
      GROUP BY variant_id
    )
    SELECT
      pv.id AS variant_id,
      pv.sku,
      p.name AS product_name,
      br.name AS brand_name,
      fl.name AS flavour_name,
      ps.label AS pack_size_label,
      ib.quantity,
      w.unit_cost_wac::text AS unit_cost_wac,
      (ib.quantity::numeric * COALESCE(w.unit_cost_wac, 0::numeric))::text AS line_value
    FROM inventory_balances ib
    INNER JOIN product_variants pv ON pv.id = ib.variant_id
    INNER JOIN products p ON p.id = pv.product_id
    LEFT JOIN brands br ON br.id = pv.brand_id
    LEFT JOIN flavours fl ON fl.id = pv.flavour_id
    LEFT JOIN pack_sizes ps ON ps.id = pv.pack_size_id
    LEFT JOIN wac w ON w.variant_id = pv.id
    WHERE ib.quantity > 0
      ${searchClause}
    ORDER BY (ib.quantity::numeric * COALESCE(w.unit_cost_wac, 0::numeric)) DESC, pv.sku ASC
    OFFSET ${skip} LIMIT ${limit}
  `);

  const items = rows.map((r) => ({
    variantId: r.variant_id,
    sku: r.sku,
    productName: r.product_name,
    brandName: r.brand_name,
    flavourName: r.flavour_name,
    packSizeLabel: r.pack_size_label,
    quantityOnHand: r.quantity,
    unitCostWac: r.unit_cost_wac === null ? null : Number(r.unit_cost_wac),
    valuation: Number(r.line_value),
  }));

  const sumRow = await prisma.$queryRaw<{ v: string | null }[]>(Prisma.sql`
    WITH wac AS (
      SELECT
        variant_id,
        CASE
          WHEN SUM(quantity_received::numeric) > 0 THEN
            SUM(quantity_received::numeric * unit_cost_exclusive::numeric)
            / NULLIF(SUM(quantity_received::numeric), 0)
          ELSE NULL
        END AS unit_cost_wac
      FROM purchase_order_items
      WHERE quantity_received > 0
      GROUP BY variant_id
    )
    SELECT COALESCE(SUM(ib.quantity::numeric * COALESCE(w.unit_cost_wac, 0::numeric)), 0)::text AS v
    FROM inventory_balances ib
    LEFT JOIN wac w ON w.variant_id = ib.variant_id
    WHERE ib.quantity > 0
  `);

  return {
    items,
    meta: buildMeta(page, limit, total),
    totals: { inventoryValuation: Number(sumRow[0]?.v ?? 0) },
  };
}

export async function getFastMovingProducts(input: FastMovingQuery) {
  const { start, endExclusive } = parseIstDayRange(input.from, input.to);
  const take = input.limit;

  const rows = await prisma.$queryRaw<
    {
      variant_id: string;
      sku: string;
      product_name: string;
      brand_name: string | null;
      flavour_name: string | null;
      units_sold: string;
      revenue: string;
    }[]
  >(Prisma.sql`
    SELECT
      pv.id AS variant_id,
      pv.sku,
      p.name AS product_name,
      br.name AS brand_name,
      fl.name AS flavour_name,
      SUM(oi.quantity::numeric)::text AS units_sold,
      SUM(oi.line_total::numeric)::text AS revenue
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    INNER JOIN product_variants pv ON pv.id = oi.variant_id
    INNER JOIN products p ON p.id = pv.product_id
    LEFT JOIN brands br ON br.id = pv.brand_id
    LEFT JOIN flavours fl ON fl.id = pv.flavour_id
    WHERE o.document_type = 'SALE'::"OrderDocumentType"
      AND o.status = 'CONFIRMED'::"OrderStatus"
      AND o.confirmed_at >= ${start}
      AND o.confirmed_at < ${endExclusive}
      ${customerClause(input.customerId)}
    GROUP BY pv.id, pv.sku, p.name, br.name, fl.name
    ORDER BY SUM(oi.quantity::numeric) DESC, revenue DESC
    LIMIT ${take}
  `);

  return {
    items: rows.map((r) => ({
      variantId: r.variant_id,
      sku: r.sku,
      productName: r.product_name,
      brandName: r.brand_name,
    flavourName: r.flavour_name,
      unitsSold: Number(r.units_sold),
      revenue: Number(r.revenue),
    })),
  };
}

export async function getDeadStock(input: DeadStockQuery) {
  const { page, limit, skip } = parsePagination({
    page: input.page,
    limit: input.limit,
  });
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - input.deadAfterDays);

  const [countRow] = await prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS c
    FROM inventory_balances ib
    INNER JOIN product_variants pv ON pv.id = ib.variant_id
    INNER JOIN products p ON p.id = pv.product_id
    LEFT JOIN LATERAL (
      SELECT MAX(o2.confirmed_at) AS last_sale
      FROM order_items oi2
      INNER JOIN orders o2 ON o2.id = oi2.order_id
      WHERE oi2.variant_id = pv.id
        AND o2.document_type = 'SALE'::"OrderDocumentType"
        AND o2.status = 'CONFIRMED'::"OrderStatus"
    ) ls ON true
    WHERE ib.quantity > 0
      AND pv.is_active = true
      AND (ls.last_sale IS NULL OR ls.last_sale < ${cutoff})
  `);

  const total = Number(countRow?.c ?? 0);

  const rows = await prisma.$queryRaw<
    {
      variant_id: string;
      sku: string;
      product_name: string;
      brand_name: string | null;
      flavour_name: string | null;
      quantity: number;
      last_sale_at: Date | null;
      days_since_sale: string | null;
    }[]
  >(Prisma.sql`
    SELECT
      pv.id AS variant_id,
      pv.sku,
      p.name AS product_name,
      br.name AS brand_name,
      fl.name AS flavour_name,
      ib.quantity,
      ls.last_sale AS last_sale_at,
      CASE
        WHEN ls.last_sale IS NULL THEN NULL
        ELSE EXTRACT(DAY FROM (NOW() AT TIME ZONE 'Asia/Kolkata' - ls.last_sale AT TIME ZONE 'Asia/Kolkata'))::text
      END AS days_since_sale
    FROM inventory_balances ib
    INNER JOIN product_variants pv ON pv.id = ib.variant_id
    INNER JOIN products p ON p.id = pv.product_id
    LEFT JOIN brands br ON br.id = pv.brand_id
    LEFT JOIN flavours fl ON fl.id = pv.flavour_id
    LEFT JOIN LATERAL (
      SELECT MAX(o2.confirmed_at) AS last_sale
      FROM order_items oi2
      INNER JOIN orders o2 ON o2.id = oi2.order_id
      WHERE oi2.variant_id = pv.id
        AND o2.document_type = 'SALE'::"OrderDocumentType"
        AND o2.status = 'CONFIRMED'::"OrderStatus"
    ) ls ON true
    WHERE ib.quantity > 0
      AND pv.is_active = true
      AND (ls.last_sale IS NULL OR ls.last_sale < ${cutoff})
    ORDER BY ls.last_sale ASC NULLS FIRST, ib.quantity DESC
    OFFSET ${skip} LIMIT ${limit}
  `);

  return {
    deadAfterDays: input.deadAfterDays,
    items: rows.map((r) => ({
      variantId: r.variant_id,
      sku: r.sku,
      productName: r.product_name,
      brandName: r.brand_name,
    flavourName: r.flavour_name,
      quantityOnHand: r.quantity,
      lastSaleAt: r.last_sale_at ? r.last_sale_at.toISOString() : null,
      daysSinceSale: r.days_since_sale === null ? null : Number(r.days_since_sale),
    })),
    meta: buildMeta(page, limit, total),
  };
}

export async function getCustomerRetention(input: DateRangeQuery) {
  const { start, endExclusive } = parseIstDayRange(input.from, input.to);

  const [row] = await prisma.$queryRaw<
    {
      customers_in_period: bigint;
      returning_customers: bigint;
      repeat_customers_in_period: bigint;
      new_customers: bigint;
    }[]
  >(Prisma.sql`
    WITH period_sales AS (
      SELECT o.customer_id, o.confirmed_at
      FROM orders o
      WHERE o.document_type = 'SALE'::"OrderDocumentType"
        AND o.status = 'CONFIRMED'::"OrderStatus"
        AND o.confirmed_at >= ${start}
        AND o.confirmed_at < ${endExclusive}
        AND o.customer_id IS NOT NULL
        ${customerClause(input.customerId)}
      ),
    period_customers AS (
      SELECT DISTINCT customer_id FROM period_sales
    ),
    orders_per_customer AS (
      SELECT customer_id, COUNT(*)::bigint AS order_count
      FROM period_sales
      GROUP BY customer_id
    ),
    first_ever AS (
      SELECT o.customer_id, MIN(o.confirmed_at) AS first_at
      FROM orders o
      WHERE o.document_type = 'SALE'::"OrderDocumentType"
        AND o.status = 'CONFIRMED'::"OrderStatus"
        AND o.customer_id IS NOT NULL
        ${customerClause(input.customerId)}
        GROUP BY o.customer_id
    )
    SELECT
      (SELECT COUNT(*)::bigint FROM period_customers) AS customers_in_period,
      (
        SELECT COUNT(DISTINCT pc.customer_id)::bigint
        FROM period_customers pc
        INNER JOIN orders o0 ON o0.customer_id = pc.customer_id
        WHERE o0.document_type = 'SALE'::"OrderDocumentType"
          AND o0.status = 'CONFIRMED'::"OrderStatus"
          AND o0.confirmed_at < ${start}
      ) AS returning_customers,
      (
        SELECT COUNT(*)::bigint
        FROM orders_per_customer
        WHERE order_count >= 2
      ) AS repeat_customers_in_period,
      (
        SELECT COUNT(*)::bigint
        FROM first_ever fe
        INNER JOIN period_customers pc ON pc.customer_id = fe.customer_id
        WHERE fe.first_at >= ${start}
          AND fe.first_at < ${endExclusive}
      ) AS new_customers
  `);

  const customersInPeriod = Number(row?.customers_in_period ?? 0);
  const returningCustomers = Number(row?.returning_customers ?? 0);
  const repeatCustomersInPeriod = Number(row?.repeat_customers_in_period ?? 0);
  const newCustomers = Number(row?.new_customers ?? 0);
  const repeatRatePct =
    customersInPeriod > 0 ? (repeatCustomersInPeriod / customersInPeriod) * 100 : 0;
  const returningRatePct =
    customersInPeriod > 0 ? (returningCustomers / customersInPeriod) * 100 : 0;

  return {
    customersInPeriod,
    returningCustomers,
    repeatCustomersInPeriod,
    newCustomers,
    repeatRatePct,
    returningRatePct,
    note:
      "Repeat rate = customers with 2+ confirmed sales in the selected period. Returning = purchased before the period and again in-range. New = first-ever sale falls in-range. Walk-in sales without a linked customer are excluded.",
  };
}

export async function getOfferPerformance(input: OfferPerformanceQuery) {
  const { start, endExclusive } = parseIstDayRange(input.from, input.to);
  const { page, limit, skip } = parsePagination({
    page: input.page,
    limit: input.limit,
  });

  const [countRow] = await prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS c
    FROM (
      SELECT o.offer_id
      FROM orders o
      WHERE o.document_type = 'SALE'::"OrderDocumentType"
        AND o.status = 'CONFIRMED'::"OrderStatus"
        AND o.confirmed_at >= ${start}
        AND o.confirmed_at < ${endExclusive}
        AND o.offer_id IS NOT NULL
        ${customerClause(input.customerId)}
        GROUP BY o.offer_id
    ) t
  `);

  const total = Number(countRow?.c ?? 0);

  const rows = await prisma.$queryRaw<
    {
      offer_id: string;
      code: string | null;
      name: string;
      order_count: bigint;
      revenue: string;
      discount_total: string;
    }[]
  >(Prisma.sql`
    SELECT
      o.offer_id,
      off.code,
      off.name,
      COUNT(*)::bigint AS order_count,
      SUM(o.grand_total::numeric)::text AS revenue,
      SUM(o.discount_total::numeric)::text AS discount_total
    FROM orders o
    INNER JOIN offers off ON off.id = o.offer_id
    WHERE o.document_type = 'SALE'::"OrderDocumentType"
      AND o.status = 'CONFIRMED'::"OrderStatus"
      AND o.confirmed_at >= ${start}
      AND o.confirmed_at < ${endExclusive}
      ${customerClause(input.customerId)}
    GROUP BY o.offer_id, off.code, off.name
    ORDER BY SUM(o.grand_total::numeric) DESC NULLS LAST
    OFFSET ${skip} LIMIT ${limit}
  `);

  return {
    items: rows.map((r) => ({
      offerId: r.offer_id,
      code: r.code,
      name: r.name,
      orderCount: Number(r.order_count),
      revenue: Number(r.revenue),
      discountTotal: Number(r.discount_total),
    })),
    meta: buildMeta(page, limit, total),
  };
}
