import { ExpenseCategory, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { buildMeta, parsePagination } from "../../lib/pagination.js";
import type { CreateExpenseBody, UpdateExpenseBody } from "./expense.validators.js";

export async function listExpenses(query: Record<string, unknown>) {
  const { page, limit, skip } = parsePagination(query);
  const category = query.category as ExpenseCategory | undefined;
  const dateFrom = query.dateFrom as string | undefined;
  const dateTo = query.dateTo as string | undefined;

  const where: Prisma.ExpenseWhereInput = {
    ...(category ? { category } : {}),
    ...(dateFrom || dateTo
      ? {
          date: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.expense.findMany({ where, orderBy: { date: "desc" }, skip, take: limit }),
    prisma.expense.count({ where }),
  ]);

  return { items, meta: buildMeta(page, limit, total) };
}

export async function createExpense(input: CreateExpenseBody) {
  return prisma.expense.create({
    data: {
      title: input.title.trim(),
      amount: new Prisma.Decimal(input.amount),
      category: input.category,
      paymentMode: input.paymentMode,
      date: new Date(input.date),
      note: input.note ?? null,
    },
  });
}

export async function updateExpense(id: string, input: UpdateExpenseBody) {
  try {
    return await prisma.expense.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.paymentMode !== undefined ? { paymentMode: input.paymentMode } : {}),
        ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code?: string }).code) : "";
    if (code === "P2025") throw new AppError(404, "EXPENSE_NOT_FOUND", "Expense not found");
    throw e;
  }
}

export async function deleteExpense(id: string) {
  try {
    await prisma.expense.delete({ where: { id } });
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code?: string }).code) : "";
    if (code === "P2025") throw new AppError(404, "EXPENSE_NOT_FOUND", "Expense not found");
    throw e;
  }
}

export async function getExpenseSummary(query: Record<string, unknown>) {
  const dateFrom = query.dateFrom as string | undefined;
  const dateTo = query.dateTo as string | undefined;

  const dateFilter: Prisma.ExpenseWhereInput["date"] = {
    ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
    ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
  };

  // Total expenses & by category
  const [expenseAgg, byCategoryRaw, revenue, monthly, giveawayRow, writeOffRows] = await Promise.all([
    prisma.expense.aggregate({
      _sum: { amount: true },
      where: { date: dateFilter },
    }),

    prisma.expense.groupBy({
      by: ["category"],
      _sum: { amount: true },
      where: { date: dateFilter },
      orderBy: { _sum: { amount: "desc" } },
    }),

    // Revenue from confirmed sales in the same period
    prisma.order.aggregate({
      _sum: { grandTotal: true },
      where: {
        status: OrderStatus.CONFIRMED,
        documentType: "SALE",
        ...(dateFrom || dateTo
          ? {
              confirmedAt: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
      },
    }),

    // Monthly breakdown for chart (last 12 months when no filter)
    prisma.$queryRaw<{ month: string; category: string; total: number }[]>`
      SELECT
        to_char(date, 'YYYY-MM') AS month,
        category,
        SUM(amount)::float AS total
      FROM expenses
      WHERE 1=1
        ${dateFrom ? Prisma.sql`AND date >= ${new Date(dateFrom)}` : Prisma.sql``}
        ${dateTo ? Prisma.sql`AND date <= ${new Date(`${dateTo}T23:59:59.999Z`)}` : Prisma.sql``}
      GROUP BY month, category
      ORDER BY month ASC, category ASC
    `,

    // Giveaway units + promotional cost from order_items (same pattern as analytics service)
    prisma.$queryRaw<{ giveaway_units: string; giveaway_cost: string }[]>(Prisma.sql`
      WITH wac AS (
        SELECT
          variant_id,
          CASE
            WHEN SUM(quantity_received::numeric) > 0
            THEN SUM(quantity_received::numeric * unit_cost_exclusive::numeric)
                 / NULLIF(SUM(quantity_received::numeric), 0)
            ELSE NULL
          END AS unit_cost_wac
        FROM purchase_order_items
        WHERE quantity_received > 0
        GROUP BY variant_id
      )
      SELECT
        COALESCE(SUM(
          CASE WHEN oi.is_giveaway OR oi.line_total::numeric = 0
               THEN oi.quantity::numeric ELSE 0::numeric END
        ), 0)::text AS giveaway_units,
        COALESCE(SUM(
          CASE WHEN oi.is_giveaway OR oi.line_total::numeric = 0
               THEN oi.quantity::numeric
                    * COALESCE(oi.unit_cost_snapshot, w.unit_cost_wac, pv.cost_price, 0::numeric)
               ELSE 0::numeric END
        ), 0)::text AS giveaway_cost
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      INNER JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN wac w ON w.variant_id = oi.variant_id
      WHERE o.document_type = 'SALE'::"OrderDocumentType"
        AND o.status = 'CONFIRMED'::"OrderStatus"
        ${dateFrom ? Prisma.sql`AND o.confirmed_at >= ${new Date(dateFrom)}` : Prisma.sql``}
        ${dateTo ? Prisma.sql`AND o.confirmed_at <= ${new Date(`${dateTo}T23:59:59.999Z`)}` : Prisma.sql``}
    `),

    // Stock written off via manual adjustments, split BY REASON so expiry loss is
    // visible on its own. Valued at the SAME WAC basis as giveaways and inventory
    // valuation. `cost_incl_gst` is informational only: the GST was paid to the
    // supplier and cannot be recovered on goods that are thrown away.
    prisma.$queryRaw<
      { reason: string; units: string; cost: string; cost_incl_gst: string }[]
    >(Prisma.sql`
      WITH wac AS (
        SELECT
          variant_id,
          CASE
            WHEN SUM(quantity_received::numeric) > 0
            THEN SUM(quantity_received::numeric * unit_cost_exclusive::numeric)
                 / NULLIF(SUM(quantity_received::numeric), 0)
            ELSE NULL
          END AS unit_cost_wac
        FROM purchase_order_items
        WHERE quantity_received > 0
        GROUP BY variant_id
      )
      SELECT
        sa.reason::text AS reason,
        ABS(COALESCE(SUM(il.quantity_delta), 0))::text AS units,
        COALESCE(SUM(
          ABS(il.quantity_delta)::numeric
          * COALESCE(w.unit_cost_wac, pv.cost_price, 0::numeric)
        ), 0)::text AS cost,
        COALESCE(SUM(
          ABS(il.quantity_delta)::numeric
          * COALESCE(w.unit_cost_wac, pv.cost_price, 0::numeric)
          * (1 + (COALESCE(pv.cgst_rate,0) + COALESCE(pv.sgst_rate,0) + COALESCE(pv.igst_rate,0))::numeric / 100)
        ), 0)::text AS cost_incl_gst
      FROM inventory_logs il
      INNER JOIN stock_adjustments sa ON sa.id = il.reference_id
      INNER JOIN product_variants pv ON pv.id = il.variant_id
      LEFT JOIN wac w ON w.variant_id = il.variant_id
      WHERE il.reference_kind = 'STOCK_ADJUSTMENT'::"InventoryReferenceKind"
        AND il.quantity_delta < 0
        ${dateFrom ? Prisma.sql`AND il.created_at >= ${new Date(dateFrom)}` : Prisma.sql``}
        ${dateTo ? Prisma.sql`AND il.created_at <= ${new Date(`${dateTo}T23:59:59.999Z`)}` : Prisma.sql``}
      GROUP BY sa.reason
    `),
  ]);

  const totalExpenses = Number(expenseAgg._sum.amount ?? 0);
  const grossRevenue = Number(revenue._sum.grandTotal ?? 0);
  const giveawayUnits = Number(giveawayRow[0]?.giveaway_units ?? 0);
  const promotionalCost = Number(giveawayRow[0]?.giveaway_cost ?? 0);

  const findReason = (r: string) => writeOffRows.find((x) => x.reason === r);
  const expiredRow = findReason("EXPIRED");
  const expiredUnits = Number(expiredRow?.units ?? 0);
  const expiredCost = Number(expiredRow?.cost ?? 0);
  const expiredCostInclGst = Number(expiredRow?.cost_incl_gst ?? 0);

  // Damage / shrinkage / correction-out — reported apart from expiry.
  const otherWriteOffs = writeOffRows.filter((x) => x.reason !== "EXPIRED");
  const otherWriteOffUnits = otherWriteOffs.reduce((s, x) => s + Number(x.units ?? 0), 0);
  const otherWriteOffCost = otherWriteOffs.reduce((s, x) => s + Number(x.cost ?? 0), 0);

  const writeOffCost = expiredCost + otherWriteOffCost;
  const writeOffByReason = writeOffRows.map((r) => ({
    reason: r.reason,
    units: Number(r.units ?? 0),
    cost: Number(r.cost ?? 0),
    costInclGst: Number(r.cost_incl_gst ?? 0),
  }));
  // Written-off stock is a real loss, so it reduces profit the same way giveaway
  // cost already does. NOTE: this figure does NOT touch cash-in-hand (that money
  // left when the supplier was paid) or inventory valuation (which already fell
  // when the quantity left the ledger).
  const netProfit = grossRevenue - totalExpenses - promotionalCost - writeOffCost;

  const byCategory = byCategoryRaw.map((r) => ({
    category: r.category,
    total: Number(r._sum.amount ?? 0),
  }));

  return {
    totalExpenses,
    grossRevenue,
    netProfit,
    byCategory,
    monthly,
    giveawayUnits,
    promotionalCost,
    expiredUnits,
    expiredCost,
    expiredCostInclGst,
    otherWriteOffUnits,
    otherWriteOffCost,
    writeOffCost,
    writeOffByReason,
  };
}
