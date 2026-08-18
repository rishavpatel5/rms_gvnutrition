import {
  InventoryReferenceKind,
  type InventoryMovementType,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { runInTransaction } from "../../lib/transaction.js";
import { AppError } from "../../middleware/error-handler.js";
import { buildMeta, parsePagination } from "../../lib/pagination.js";

export const MANUAL_ADJUSTMENT_MOVEMENT_TYPES: InventoryMovementType[] = [
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "DAMAGE_OUT",
];

const OUTBOUND_TYPES: InventoryMovementType[] = [
  "SALE_OUT",
  "PURCHASE_RETURN_OUT",
  "ADJUSTMENT_OUT",
  "DAMAGE_OUT",
  "EXCHANGE_OUT",
];

const INBOUND_TYPES: InventoryMovementType[] = [
  "SALE_REVERSAL_IN",
  "PURCHASE_IN",
  "RETURN_RESTOCK_IN",
  "EXCHANGE_IN",
  "ADJUSTMENT_IN",
];

export type Tx = Prisma.TransactionClient;

export function assertDeltaMatchesMovementType(
  movementType: InventoryMovementType,
  quantityDelta: number,
): void {
  if (quantityDelta === 0) {
    throw new AppError(400, "INVALID_DELTA", "quantityDelta cannot be zero");
  }
  if (OUTBOUND_TYPES.includes(movementType) && quantityDelta >= 0) {
    throw new AppError(
      400,
      "INVALID_MOVEMENT",
      "Outbound movement types require a negative quantityDelta",
    );
  }
  if (INBOUND_TYPES.includes(movementType) && quantityDelta <= 0) {
    throw new AppError(
      400,
      "INVALID_MOVEMENT",
      "Inbound movement types require a positive quantityDelta",
    );
  }
}

async function ensureBalanceRow(tx: Tx, variantId: string): Promise<void> {
  await tx.inventoryBalance.upsert({
    where: { variantId },
    create: { variantId, quantity: 0 },
    update: {},
  });
}

/**
 * Single atomic stock movement: inventory_logs row + inventory_balances update.
 * Call only inside a transaction; pass variants in deterministic order to reduce deadlocks.
 */
export async function applyInventoryMovement(
  tx: Tx,
  input: {
    variantId: string;
    quantityDelta: number;
    movementType: InventoryMovementType;
    referenceKind: InventoryReferenceKind;
    referenceId: string;
    createdById: string | null;
    note?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  assertDeltaMatchesMovementType(input.movementType, input.quantityDelta);
  await ensureBalanceRow(tx, input.variantId);

  const delta = input.quantityDelta;
  const updated = await tx.inventoryBalance.updateMany({
    where: {
      variantId: input.variantId,
      ...(delta < 0 ? { quantity: { gte: -delta } } : {}),
    },
    data: { quantity: { increment: delta } },
  });
  if (updated.count !== 1) {
    throw new AppError(
      409,
      "INSUFFICIENT_STOCK",
      "Insufficient stock for this variant",
      { variantId: input.variantId },
    );
  }

  await tx.inventoryLog.create({
    data: {
      variantId: input.variantId,
      quantityDelta: delta,
      movementType: input.movementType,
      referenceKind: input.referenceKind,
      referenceId: input.referenceId,
      note: input.note ?? null,
      ...(input.metadata !== undefined
        ? { metadata: input.metadata as Prisma.InputJsonValue }
        : {}),
      createdById: input.createdById,
    },
  });
}

export type AdjustmentLineInput = {
  variantId: string;
  quantityDelta: number;
  movementType: InventoryMovementType;
};

export async function createStockAdjustmentWithMovements(input: {
  reason: import("@prisma/client").StockAdjustmentReason;
  note?: string | null;
  lines: AdjustmentLineInput[];
  createdById: string | null;
}): Promise<{ adjustmentId: string }> {
  if (input.lines.length === 0) {
    throw new AppError(400, "EMPTY_LINES", "At least one line is required");
  }
  for (const line of input.lines) {
    if (!MANUAL_ADJUSTMENT_MOVEMENT_TYPES.includes(line.movementType)) {
      throw new AppError(
        400,
        "INVALID_MOVEMENT_TYPE",
        `Movement type ${line.movementType} is not allowed on stock adjustments`,
      );
    }
    assertDeltaMatchesMovementType(line.movementType, line.quantityDelta);
  }

  const sorted = [...input.lines].sort((a, b) =>
    a.variantId.localeCompare(b.variantId),
  );

  return runInTransaction(async (tx) => {
    const adj = await tx.stockAdjustment.create({
      data: {
        reason: input.reason,
        note: input.note ?? null,
        createdById: input.createdById,
      },
    });

    for (const line of sorted) {
      const variant = await tx.productVariant.findFirst({
        where: { id: line.variantId, isActive: true },
        select: { id: true },
      });
      if (!variant) {
        throw new AppError(404, "VARIANT_NOT_FOUND", "Variant not found", {
          variantId: line.variantId,
        });
      }

      const sal = await tx.stockAdjustmentLine.create({
        data: {
          stockAdjustmentId: adj.id,
          variantId: line.variantId,
          quantityDelta: line.quantityDelta,
          movementType: line.movementType,
        },
      });

      await applyInventoryMovement(tx, {
        variantId: line.variantId,
        quantityDelta: line.quantityDelta,
        movementType: line.movementType,
        referenceKind: "STOCK_ADJUSTMENT",
        referenceId: adj.id,
        createdById: input.createdById,
        note: input.note ?? null,
        metadata: { stockAdjustmentLineId: sal.id },
      });
    }

    return { adjustmentId: adj.id };
  });
}

export async function applySalesReturnRestock(input: {
  salesReturnId: string;
  createdById: string | null;
}): Promise<void> {
  await runInTransaction(async (tx) => {
    const sr = await tx.salesReturn.findUnique({
      where: { id: input.salesReturnId },
      include: {
        lines: {
          include: {
            orderItem: { select: { id: true, variantId: true, quantity: true } },
          },
        },
      },
    });
    if (!sr) {
      throw new AppError(404, "RETURN_NOT_FOUND", "Sales return not found");
    }
    if (sr.status !== "APPROVED") {
      throw new AppError(
        409,
        "RETURN_INVALID_STATE",
        "Return must be in APPROVED state to apply restock",
        { status: sr.status },
      );
    }

    const restockLines = sr.lines.filter((l) => l.disposition === "RESTOCK");
    if (restockLines.length === 0) {
      throw new AppError(
        400,
        "NO_RESTOCK_LINES",
        "No RESTOCK lines on this return",
      );
    }

    const sorted = [...restockLines].sort((a, b) =>
      a.orderItem.variantId.localeCompare(b.orderItem.variantId),
    );

    for (const line of sorted) {
      if (line.quantity <= 0) {
        throw new AppError(400, "INVALID_QTY", "Return line quantity invalid");
      }
      if (line.quantity > line.orderItem.quantity) {
        throw new AppError(
          400,
          "RETURN_QTY_EXCEEDS_SALE",
          "Return quantity exceeds original order line quantity",
        );
      }

      await applyInventoryMovement(tx, {
        variantId: line.orderItem.variantId,
        quantityDelta: line.quantity,
        movementType: "RETURN_RESTOCK_IN",
        referenceKind: "SALES_RETURN",
        referenceId: sr.id,
        createdById: input.createdById,
        metadata: { salesReturnLineId: line.id, orderItemId: line.orderItemId },
      });
    }

    await tx.salesReturn.update({
      where: { id: sr.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  });
}

export async function listBalances(query: Record<string, unknown>) {
  const { page, limit, skip } = parsePagination(query);
  const productId =
    typeof query.productId === "string" && query.productId.length > 0
      ? query.productId
      : undefined;
  const variantId =
    typeof query.variantId === "string" && query.variantId.length > 0
      ? query.variantId
      : undefined;
  const lowStock =
    query.lowStock === "true" || query.lowStock === "1" ? true : false;
  const thresholdRaw = Number(query.threshold ?? 5);
  const threshold =
    Number.isFinite(thresholdRaw) && thresholdRaw >= 0
      ? Math.min(Math.floor(thresholdRaw), 1_000_000)
      : 5;

  const where: Prisma.InventoryBalanceWhereInput = {
    ...(variantId ? { variantId } : {}),
    ...(productId
      ? { variant: { productId } }
      : {}),
    ...(lowStock ? { quantity: { lte: threshold } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ quantity: "asc" }, { variantId: "asc" }],
      include: {
        variant: {
          include: {
            product: { select: { id: true, name: true, slug: true, kind: true } },
            flavour: { select: { id: true, name: true } },
            packSize: { select: { id: true, label: true, code: true } },
          },
        },
      },
    }),
    prisma.inventoryBalance.count({ where }),
  ]);

  return {
    items: rows,
    meta: buildMeta(page, limit, total),
  };
}

export async function listStockSummary(query: Record<string, unknown>) {
  const { page, limit, skip } = parsePagination(query);
  const q =
    typeof query.search === "string" && query.search.trim().length > 0
      ? query.search.trim()
      : undefined;
  const productKind =
    query.kind === "SUPPLEMENT" || query.kind === "ACCESSORY"
      ? String(query.kind)
      : undefined;

  const searchClause = q
    ? Prisma.sql`AND (
        p.name ILIKE ${"%" + q + "%"}
        OR pv.sku ILIKE ${"%" + q + "%"}
        OR COALESCE(fl.name, '') ILIKE ${"%" + q + "%"}
        OR COALESCE(ps.label, '') ILIKE ${"%" + q + "%"}
      )`
    : Prisma.empty;
  const kindClause = productKind
    ? Prisma.sql`AND p.kind = ${productKind}::"ProductKind"`
    : Prisma.empty;

  const [countRow] = await prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS c
    FROM product_variants pv
    INNER JOIN products p ON p.id = pv.product_id
    LEFT JOIN brands br ON br.id = pv.brand_id
    LEFT JOIN flavours fl ON fl.id = pv.flavour_id
    LEFT JOIN pack_sizes ps ON ps.id = pv.pack_size_id
    WHERE pv.is_active = true
      AND p.is_active = true
      ${searchClause}
      ${kindClause}
  `);

  const rows = await prisma.$queryRaw<
    {
      variant_id: string;
      sku: string;
      product_name: string;
      product_kind: string;
      brand_name: string | null;
      flavour_name: string | null;
      pack_size_label: string | null;
      low_stock_threshold: number | null;
      purchased_qty: string | null;
      sold_qty: string | null;
      returned_qty: string | null;
      damaged_qty: string | null;
      adjusted_qty: string | null;
      current_stock: string | null;
    }[]
  >(Prisma.sql`
    SELECT
      pv.id AS variant_id,
      pv.sku,
      p.name AS product_name,
      p.kind::text AS product_kind,
      br.name AS brand_name,
      fl.name AS flavour_name,
      ps.label AS pack_size_label,
      pv.low_stock_threshold,
      COALESCE(SUM(CASE WHEN il.movement_type = 'PURCHASE_IN'::"InventoryMovementType" THEN il.quantity_delta ELSE 0 END), 0)::text AS purchased_qty,
      ABS(COALESCE(SUM(CASE WHEN il.movement_type = 'SALE_OUT'::"InventoryMovementType" THEN il.quantity_delta ELSE 0 END), 0))::text AS sold_qty,
      COALESCE(SUM(CASE WHEN il.movement_type IN ('RETURN_RESTOCK_IN'::"InventoryMovementType", 'SALE_REVERSAL_IN'::"InventoryMovementType") THEN il.quantity_delta ELSE 0 END), 0)::text AS returned_qty,
      ABS(COALESCE(SUM(CASE WHEN il.movement_type = 'DAMAGE_OUT'::"InventoryMovementType" THEN il.quantity_delta ELSE 0 END), 0))::text AS damaged_qty,
      COALESCE(SUM(CASE WHEN il.movement_type IN ('ADJUSTMENT_IN'::"InventoryMovementType", 'ADJUSTMENT_OUT'::"InventoryMovementType") THEN il.quantity_delta ELSE 0 END), 0)::text AS adjusted_qty,
      COALESCE(SUM(il.quantity_delta), 0)::text AS current_stock
    FROM product_variants pv
    INNER JOIN products p ON p.id = pv.product_id
    LEFT JOIN brands br ON br.id = pv.brand_id
    LEFT JOIN flavours fl ON fl.id = pv.flavour_id
    LEFT JOIN pack_sizes ps ON ps.id = pv.pack_size_id
    LEFT JOIN inventory_logs il ON il.variant_id = pv.id
    WHERE pv.is_active = true
      AND p.is_active = true
      ${searchClause}
      ${kindClause}
    GROUP BY pv.id, pv.sku, p.name, p.kind, br.name, fl.name, ps.label, pv.low_stock_threshold
    ORDER BY p.name ASC, pv.sku ASC
    OFFSET ${skip} LIMIT ${limit}
  `);

  const items = rows.map((r) => {
    const currentStock = Number(r.current_stock ?? 0);
    const threshold = r.low_stock_threshold ?? 5;
    return {
      variantId: r.variant_id,
      sku: r.sku,
      productName: r.product_name,
      productKind: r.product_kind,
      brandName: r.brand_name,
      flavourName: r.flavour_name,
      packSizeLabel: r.pack_size_label,
      variantLabel: [r.brand_name, r.flavour_name, r.pack_size_label].filter(Boolean).join(" / ") || "Default",
      purchasedQty: Number(r.purchased_qty ?? 0),
      soldQty: Number(r.sold_qty ?? 0),
      returnedQty: Number(r.returned_qty ?? 0),
      damagedQty: Number(r.damaged_qty ?? 0),
      adjustedQty: Number(r.adjusted_qty ?? 0),
      currentStock,
      threshold,
      status:
        currentStock <= 0
          ? "OUT_OF_STOCK"
          : currentStock <= threshold
            ? "LOW_STOCK"
            : "IN_STOCK",
    };
  });

  return { items, meta: buildMeta(page, limit, Number(countRow?.c ?? 0)) };
}

export async function getBalanceByVariantId(variantId: string) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: {
      product: { select: { id: true, name: true, slug: true } },
      flavour: true,
      packSize: true,
      inventory: true,
    },
  });
  if (!variant) {
    throw new AppError(404, "VARIANT_NOT_FOUND", "Variant not found");
  }
  const quantity = variant.inventory?.quantity ?? 0;
  const { inventory, ...rest } = variant;
  return {
    quantity,
    balanceUpdatedAt: inventory?.updatedAt ?? null,
    variant: rest,
  };
}

export async function listLogs(query: Record<string, unknown>) {
  const { page, limit, skip } = parsePagination(query);
  const variantId =
    typeof query.variantId === "string" && query.variantId.length > 0
      ? query.variantId
      : undefined;
  const rawRefKind = query.referenceKind;
  let referenceKind: InventoryReferenceKind | undefined;
  if (typeof rawRefKind === "string" && rawRefKind.length > 0) {
    const allowed = Object.values(InventoryReferenceKind) as string[];
    if (allowed.includes(rawRefKind)) {
      referenceKind = rawRefKind as InventoryReferenceKind;
    }
  }
  const referenceId =
    typeof query.referenceId === "string" && query.referenceId.length > 0
      ? query.referenceId
      : undefined;
  const from =
    typeof query.from === "string" && query.from.length > 0
      ? new Date(query.from)
      : undefined;
  const to =
    typeof query.to === "string" && query.to.length > 0
      ? new Date(query.to)
      : undefined;

  const where: Prisma.InventoryLogWhereInput = {
    ...(variantId ? { variantId } : {}),
    ...(referenceKind ? { referenceKind } : {}),
    ...(referenceId ? { referenceId } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
            ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.inventoryLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        variant: {
          select: {
            id: true,
            sku: true,
            product: { select: { id: true, name: true } },
          },
        },
        createdBy: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.inventoryLog.count({ where }),
  ]);

  return { items, meta: buildMeta(page, limit, total) };
}

export async function getAdjustmentById(id: string) {
  const adj = await prisma.stockAdjustment.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { createdAt: "asc" } },
      createdBy: { select: { id: true, email: true, name: true } },
    },
  });
  if (!adj) {
    throw new AppError(404, "ADJUSTMENT_NOT_FOUND", "Stock adjustment not found");
  }
  return adj;
}
