import { InventoryReferenceKind, Prisma, PurchaseReturnStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { runInTransaction } from "../../lib/transaction.js";
import { buildMeta, parsePagination } from "../../lib/pagination.js";
import { AppError } from "../../middleware/error-handler.js";
import { applyInventoryMovement, type Tx } from "../inventory/inventory.service.js";
import { weightedAverageCost } from "../../lib/purchase-return-wac.js";
import type { CreatePurchaseReturnBody, PreviewPurchaseReturnBody } from "./purchase-return.validators.js";

const d2 = (d: Prisma.Decimal): Prisma.Decimal => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

type LineComputation = {
  variantId: string;
  sku: string;
  productName: string;
  variantLabel: string;
  quantity: number;
  unitWac: Prisma.Decimal;
  lineBookValue: Prisma.Decimal;
};

/**
 * Compute per-line WAC + book value for a set of return lines, using the SAME WAC
 * methodology as inventory valuation. Reads received purchase lines only — returns
 * never enter this basis. Runs against the given client (tx for confirm, prisma for preview).
 */
async function computeLines(
  client: Tx | typeof prisma,
  lines: { variantId: string; quantity: number }[],
): Promise<{ lines: LineComputation[]; bookValue: Prisma.Decimal }> {
  const variantIds = [...new Set(lines.map((l) => l.variantId))];

  const variants = await client.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      sku: true,
      isActive: true,
      product: { select: { name: true } },
      brand: { select: { name: true } },
      flavour: { select: { name: true } },
      packSize: { select: { label: true } },
    },
  });
  const vmap = new Map(variants.map((v) => [v.id, v]));
  for (const id of variantIds) {
    if (!vmap.has(id)) {
      throw new AppError(404, "VARIANT_NOT_FOUND", "Variant not found", { variantId: id });
    }
  }

  // WAC per variant from received purchase lines (same formula as the valuation card).
  const received = await client.purchaseOrderItem.findMany({
    where: { variantId: { in: variantIds }, quantityReceived: { gt: 0 } },
    select: { variantId: true, quantityReceived: true, unitCostExclusive: true },
  });
  const byVariant = new Map<string, { quantityReceived: number; unitCostExclusive: Prisma.Decimal }[]>();
  for (const r of received) {
    const arr = byVariant.get(r.variantId) ?? [];
    arr.push({ quantityReceived: r.quantityReceived, unitCostExclusive: r.unitCostExclusive });
    byVariant.set(r.variantId, arr);
  }

  const out: LineComputation[] = [];
  let bookValue = new Prisma.Decimal(0);
  for (const l of lines) {
    const v = vmap.get(l.variantId)!;
    const wac = weightedAverageCost(byVariant.get(l.variantId) ?? []) ?? new Prisma.Decimal(0);
    const lineBookValue = d2(wac.mul(l.quantity));
    bookValue = bookValue.plus(lineBookValue);
    out.push({
      variantId: l.variantId,
      sku: v.sku,
      productName: v.product.name,
      variantLabel: [v.brand?.name, v.flavour?.name, v.packSize?.label].filter(Boolean).join(" / ") || "Default",
      quantity: l.quantity,
      unitWac: wac,
      lineBookValue,
    });
  }
  return { lines: out, bookValue: d2(bookValue) };
}

/**
 * In-stock variants that were actually received from a given supplier — the only things
 * you can return to them. Scoped to the supplier (fast) and to on-hand > 0 (returnable).
 */
export async function searchSupplierStock(query: Record<string, unknown>) {
  const supplierId = typeof query.supplierId === "string" ? query.supplierId.trim() : "";
  if (!supplierId) throw new AppError(400, "SUPPLIER_REQUIRED", "Select a supplier first");
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const tokens = search.split(/\s+/).filter(Boolean);

  const rows = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      inventory: { quantity: { gt: 0 } },
      purchaseOrderItems: {
        some: { quantityReceived: { gt: 0 }, purchaseOrder: { supplierId } },
      },
      ...(tokens.length
        ? {
            AND: tokens.map((tok) => ({
              OR: [
                { sku: { contains: tok, mode: "insensitive" as const } },
                { product: { name: { contains: tok, mode: "insensitive" as const } } },
                { brand: { name: { contains: tok, mode: "insensitive" as const } } },
                { flavour: { name: { contains: tok, mode: "insensitive" as const } } },
                { packSize: { label: { contains: tok, mode: "insensitive" as const } } },
              ],
            })),
          }
        : {}),
    },
    take: 50,
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
    select: {
      id: true,
      sku: true,
      product: { select: { name: true } },
      brand: { select: { name: true } },
      flavour: { select: { name: true } },
      packSize: { select: { label: true } },
      inventory: { select: { quantity: true } },
    },
  });

  return rows.map((v) => ({
    id: v.id,
    sku: v.sku,
    productName: v.product.name,
    variantLabel: [v.brand?.name, v.flavour?.name, v.packSize?.label].filter(Boolean).join(" / ") || "Default",
    onHand: v.inventory?.quantity ?? 0,
  }));
}

export async function previewPurchaseReturn(body: PreviewPurchaseReturnBody) {
  const { lines, bookValue } = await computeLines(prisma, body.lines);
  return {
    lines: lines.map((l) => ({
      variantId: l.variantId,
      sku: l.sku,
      productName: l.productName,
      variantLabel: l.variantLabel,
      quantity: l.quantity,
      unitWac: l.unitWac.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toString(),
      lineBookValue: l.lineBookValue.toFixed(2),
    })),
    bookValue: bookValue.toFixed(2),
  };
}

/** Canonical payload signature for idempotency comparison. */
function payloadSignature(input: {
  supplierId: string;
  refundAmount: number;
  settlementMethod: string;
  lines: { variantId: string; quantity: number }[];
}): string {
  const lines = [...input.lines]
    .map((l) => `${l.variantId}:${l.quantity}`)
    .sort()
    .join(",");
  return [
    input.supplierId,
    Number(input.refundAmount).toFixed(2),
    input.settlementMethod,
    lines,
  ].join("|");
}

async function serializeReturn(id: string) {
  const row = await prisma.purchaseReturn.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      lines: {
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              product: { select: { name: true } },
              brand: { select: { name: true } },
              flavour: { select: { name: true } },
              packSize: { select: { label: true } },
            },
          },
        },
      },
    },
  });
  if (!row) throw new AppError(404, "PURCHASE_RETURN_NOT_FOUND", "Purchase return not found");
  return {
    id: row.id,
    status: row.status,
    supplier: { id: row.supplier.id, name: row.supplier.name },
    bookValue: row.bookValue.toFixed(2),
    refundAmount: row.refundAmount.toFixed(2),
    difference: row.difference.toFixed(2),
    outcome: row.difference.gt(0) ? "GAIN" : row.difference.lt(0) ? "LOSS" : "NEUTRAL",
    settlementMethod: row.settlementMethod,
    note: row.note,
    createdById: row.createdById,
    confirmedById: row.confirmedById,
    createdAt: row.createdAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    lines: row.lines.map((l) => ({
      id: l.id,
      variantId: l.variantId,
      sku: l.variant.sku,
      productName: l.variant.product.name,
      variantLabel: [l.variant.brand?.name, l.variant.flavour?.name, l.variant.packSize?.label].filter(Boolean).join(" / ") || "Default",
      quantity: l.quantity,
      unitWac: l.unitWac.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toString(),
      lineBookValue: l.lineBookValue.toFixed(2),
    })),
  };
}

export async function createPurchaseReturn(input: {
  body: CreatePurchaseReturnBody;
  createdById: string | null;
}): Promise<Awaited<ReturnType<typeof serializeReturn>>> {
  const { body, createdById } = input;
  const incomingSig = payloadSignature(body);

  // Idempotency: identical retry returns the same document; a reused key with a
  // DIFFERENT payload is rejected (guards a frontend bug from reusing an old key).
  const existing = await prisma.purchaseReturn.findUnique({
    where: { idempotencyKey: body.idempotencyKey },
    include: { lines: { select: { variantId: true, quantity: true } } },
  });
  if (existing) {
    const existingSig = payloadSignature({
      supplierId: existing.supplierId,
      refundAmount: Number(existing.refundAmount),
      settlementMethod: existing.settlementMethod,
      lines: existing.lines,
    });
    if (existingSig !== incomingSig) {
      throw new AppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used for a different return. Use a new key.",
      );
    }
    return serializeReturn(existing.id);
  }

  const supplier = await prisma.supplier.findUnique({ where: { id: body.supplierId }, select: { id: true } });
  if (!supplier) throw new AppError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");

  const refundAmount = d2(new Prisma.Decimal(body.refundAmount));

  const createdId = await runInTransaction(async (tx) => {
    // Recompute WAC/book value INSIDE the transaction (source of truth for the confirm).
    const { lines, bookValue } = await computeLines(tx, body.lines);

    // Preview/confirm consistency: if WAC moved since the user previewed, do NOT silently
    // process a different amount — reject with the recalculated value so the UI re-previews.
    if (body.expectedBookValue !== undefined) {
      const expected = d2(new Prisma.Decimal(body.expectedBookValue));
      if (!bookValue.equals(expected)) {
        throw new AppError(
          409,
          "BOOK_VALUE_CHANGED",
          "Stock cost changed since preview. Review the updated book value before confirming.",
          { expectedBookValue: expected.toFixed(2), currentBookValue: bookValue.toFixed(2) },
        );
      }
    }

    const difference = d2(refundAmount.minus(bookValue));
    const now = new Date();

    const created = await tx.purchaseReturn.create({
      data: {
        supplierId: body.supplierId,
        status: PurchaseReturnStatus.CONFIRMED,
        bookValue,
        refundAmount,
        difference,
        settlementMethod: body.settlementMethod,
        note: body.note?.trim() || null,
        idempotencyKey: body.idempotencyKey,
        createdById,
        confirmedById: createdById,
        confirmedAt: now,
        lines: {
          create: lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            unitWac: l.unitWac,
            lineBookValue: l.lineBookValue,
          })),
        },
      },
      select: { id: true },
    });

    // Remove stock (sorted by variantId to reduce deadlocks). The existing non-negative
    // guard blocks returning more than on-hand and rolls the whole confirm back.
    const sorted = [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
    for (const l of sorted) {
      await applyInventoryMovement(tx, {
        variantId: l.variantId,
        quantityDelta: -l.quantity,
        movementType: "PURCHASE_RETURN_OUT",
        referenceKind: InventoryReferenceKind.PURCHASE_RETURN,
        referenceId: created.id,
        createdById,
        note: "Returned to supplier",
        metadata: { purchaseReturnId: created.id },
      });
    }

    return created.id;
  });

  return serializeReturn(createdId);
}

export async function listPurchaseReturns(query: Record<string, unknown>) {
  const { page, limit, skip } = parsePagination(query);
  const supplierId = typeof query.supplierId === "string" && query.supplierId ? query.supplierId : undefined;

  const where: Prisma.PurchaseReturnWhereInput = { ...(supplierId ? { supplierId } : {}) };
  const [rows, total] = await Promise.all([
    prisma.purchaseReturn.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { supplier: { select: { id: true, name: true } }, _count: { select: { lines: true } } },
    }),
    prisma.purchaseReturn.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      status: r.status,
      supplier: { id: r.supplier.id, name: r.supplier.name },
      bookValue: r.bookValue.toFixed(2),
      refundAmount: r.refundAmount.toFixed(2),
      difference: r.difference.toFixed(2),
      outcome: r.difference.gt(0) ? "GAIN" : r.difference.lt(0) ? "LOSS" : "NEUTRAL",
      settlementMethod: r.settlementMethod,
      lineCount: r._count.lines,
      createdAt: r.createdAt.toISOString(),
    })),
    meta: buildMeta(page, limit, total),
  };
}

export async function getPurchaseReturn(id: string) {
  return serializeReturn(id);
}
