import {
  GstPricingMode,
  Prisma,
  type PurchaseOrderStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { runInTransaction } from "../../lib/transaction.js";
import { AppError } from "../../middleware/error-handler.js";
import { buildMeta, parsePagination } from "../../lib/pagination.js";
import { computeLine, computeOrderTotals } from "../../lib/gst-calculator.js";
import { defaultIntraStateGstPercentages } from "../../lib/gst-defaults.js";
import {
  applyInventoryMovement,
  type Tx,
} from "../inventory/inventory.service.js";
import {
  purchaseLineInputSchema,
  replacePurchaseLinesBodySchema,
  receivePurchaseBodySchema,
} from "./purchase.validators.js";
import type { z } from "zod";

type PurchaseLineInput = z.infer<typeof purchaseLineInputSchema>;
type ReplaceLinesBody = z.infer<typeof replacePurchaseLinesBodySchema>;
type ReceiveBody = z.infer<typeof receivePurchaseBodySchema>;

/** Stale JWTs after DB reset can point at deleted users — FK would fail. */
async function resolveActorId(tx: Tx, id: string | null): Promise<string | null> {
  if (!id) return null;
  const u = await tx.user.findUnique({ where: { id }, select: { id: true } });
  return u?.id ?? null;
}

async function resolveActorIdClient(id: string | null): Promise<string | null> {
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  return u?.id ?? null;
}

function buildComputedPurchaseLine(
  line: PurchaseLineInput,
): ReturnType<typeof computeLine> {
  return computeLine({
    variantId: line.variantId,
    quantity: line.quantityOrdered,
    unitPrice: new Prisma.Decimal(line.unitCost),
    lineDiscount: new Prisma.Decimal(0),
    gstEnabled: line.gstEnabled ?? true,
    gstPricingMode: line.gstPricingMode ?? GstPricingMode.EXCLUSIVE,
    cgstRate: new Prisma.Decimal(line.cgstRate ?? 0),
    sgstRate: new Prisma.Decimal(line.sgstRate ?? 0),
    igstRate: new Prisma.Decimal(line.igstRate ?? 0),
  });
}

function aggregateHeaderFromComputed(
  computed: ReturnType<typeof computeLine>[],
) {
  const totals = computeOrderTotals(computed, new Prisma.Decimal(0));
  return {
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxableValueTotal: totals.taxableValue,
    cgstTotal: totals.cgstTotal,
    sgstTotal: totals.sgstTotal,
    igstTotal: totals.igstTotal,
    grandTotal: totals.grandTotal,
  };
}

async function assertDraft(poId: string, tx: Tx | typeof prisma): Promise<void> {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: poId },
    select: { status: true },
  });
  if (!po) throw new AppError(404, "PURCHASE_NOT_FOUND", "Purchase not found");
  if (po.status !== "DRAFT") {
    throw new AppError(
      409,
      "PURCHASE_NOT_EDITABLE",
      "Only draft purchases can be edited",
      { status: po.status },
    );
  }
}

export async function listPurchaseOrders(query: Record<string, unknown>) {
  const { page, limit, skip } = parsePagination(query);
  const supplierId =
    typeof query.supplierId === "string" && query.supplierId.length > 0
      ? query.supplierId
      : undefined;
  const status = query.status as PurchaseOrderStatus | undefined;
  const search =
    typeof query.search === "string" && query.search.trim().length > 0
      ? query.search.trim()
      : undefined;

  const where: Prisma.PurchaseOrderWhereInput = {
    ...(supplierId ? { supplierId } : {}),
    ...(status ? { status } : {}),
    ...(search
      ? {
          supplier: { name: { contains: search, mode: "insensitive" } },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, email: true, name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return { items, meta: buildMeta(page, limit, total) };
}

export async function getPurchaseOrderById(id: string) {
  const row = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      createdBy: { select: { id: true, email: true, name: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          variant: {
            include: {
              product: { select: { id: true, name: true, slug: true, kind: true } },
              flavour: true,
              packSize: true,
            },
          },
        },
      },
    },
  });
  if (!row) {
    throw new AppError(404, "PURCHASE_NOT_FOUND", "Purchase not found");
  }
  const outstanding = row.grandTotal.minus(row.amountPaid);
  return {
    ...row,
    outstanding,
  };
}

export async function createPurchaseOrder(input: {
  supplierId: string;
  createdById: string | null;
}) {
  const sup = await prisma.supplier.findFirst({
    where: { id: input.supplierId, isActive: true },
  });
  if (!sup) {
    throw new AppError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
  }
  const actorId = await resolveActorIdClient(input.createdById);
  return prisma.purchaseOrder.create({
    data: {
      supplierId: input.supplierId,
      createdById: actorId,
    },
    include: {
      supplier: { select: { id: true, name: true } },
      items: true,
    },
  });
}

export async function updatePurchaseOrderHeader(
  id: string,
  input: {
    status?: PurchaseOrderStatus;
  },
) {
  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    throw new AppError(404, "PURCHASE_NOT_FOUND", "Purchase not found");
  }
  if (input.status === "CANCELLED" && existing.status === "RECEIVED") {
    throw new AppError(409, "INVALID_STATUS", "Cannot cancel a fully received purchase");
  }
  return prisma.purchaseOrder.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
    include: {
      supplier: true,
      items: {
        include: {
          variant: {
            include: {
              product: { select: { id: true, name: true, kind: true } },
              flavour: true,
              packSize: true,
            },
          },
        },
      },
    },
  });
}

/** Replace all lines on a DRAFT purchase and recompute GST totals. */
export async function replacePurchaseLines(
  purchaseOrderId: string,
  body: ReplaceLinesBody,
): Promise<unknown> {
  const variantIds = [...new Set(body.lines.map((l) => l.variantId))].sort();
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, isActive: true },
    include: { product: { select: { id: true, kind: true } } },
  });
  if (variants.length !== variantIds.length) {
    throw new AppError(400, "VARIANT_NOT_FOUND", "One or more variants are invalid");
  }
  const byId = new Map(variants.map((v) => [v.id, v]));

  const computed: ReturnType<typeof computeLine>[] = body.lines.map((line) => {
    const v = byId.get(line.variantId)!;
    const defs = defaultIntraStateGstPercentages(v.product.kind);
    const merged: PurchaseLineInput = {
      ...line,
      cgstRate: line.cgstRate ?? defs.cgst,
      sgstRate: line.sgstRate ?? defs.sgst,
      igstRate: line.igstRate ?? defs.igst,
    };
    return buildComputedPurchaseLine(merged);
  });

  const header = aggregateHeaderFromComputed(computed);

  return runInTransaction(async (tx) => {
    await assertDraft(purchaseOrderId, tx);

    await tx.purchaseOrderItem.deleteMany({
      where: { purchaseOrderId },
    });

    for (let i = 0; i < body.lines.length; i++) {
      const line = body.lines[i]!;
      const c = computed[i]!;
      const qty = line.quantityOrdered;
      const unitEx =
        qty > 0
          ? c.taxableValue.div(qty).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)
          : new Prisma.Decimal(0);

      await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId,
          variantId: line.variantId,
          quantityOrdered: qty,
          quantityReceived: 0,
          unitCost: new Prisma.Decimal(line.unitCost),
          gstEnabled: line.gstEnabled ?? true,
          gstPricingMode: line.gstPricingMode ?? GstPricingMode.EXCLUSIVE,
          cgstRate: c.cgstRate,
          sgstRate: c.sgstRate,
          igstRate: c.igstRate,
          taxableValue: c.taxableValue,
          cgstAmount: c.cgstAmount,
          sgstAmount: c.sgstAmount,
          igstAmount: c.igstAmount,
          lineTotal: c.lineTotal,
          unitCostExclusive: unitEx,
        },
      });
    }

    return tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: {
        ...header,
      },
      include: {
        supplier: true,
        items: {
          include: {
            variant: {
              include: {
                product: { select: { id: true, name: true, kind: true } },
                flavour: true,
                packSize: true,
              },
            },
          },
        },
      },
    });
  });
}

export async function markPurchaseOrdered(
  id: string,
  createdById: string | null,
): Promise<unknown> {
  return runInTransaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!po) throw new AppError(404, "PURCHASE_NOT_FOUND", "Purchase not found");
    if (po.status !== "DRAFT") {
      throw new AppError(409, "INVALID_STATUS", "Only draft orders can be submitted");
    }
    if (po.items.length === 0) {
      throw new AppError(400, "EMPTY_PURCHASE", "Add at least one line before submitting");
    }
    const actorId = await resolveActorId(tx, po.createdById ?? createdById);
    return tx.purchaseOrder.update({
      where: { id },
      data: {
        status: "ORDERED",
        orderedAt: new Date(),
        createdById: actorId,
      },
      include: {
        supplier: true,
        items: {
          include: {
            variant: {
              include: {
                product: { select: { id: true, name: true, kind: true } },
                flavour: true,
                packSize: true,
              },
            },
          },
        },
      },
    });
  });
}

export async function receivePurchase(
  id: string,
  body: ReceiveBody,
  createdById: string | null,
): Promise<unknown> {
  return runInTransaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: { orderBy: { id: "asc" } } },
    });
    if (!po) throw new AppError(404, "PURCHASE_NOT_FOUND", "Purchase not found");
    if (po.status === "CANCELLED") {
      throw new AppError(409, "INVALID_STATUS", "Cannot receive a cancelled purchase");
    }
    if (po.status === "DRAFT") {
      throw new AppError(
        409,
        "PURCHASE_NOT_ORDERED",
        "Submit the purchase order before receiving stock",
      );
    }
    if (po.items.length === 0) {
      throw new AppError(400, "EMPTY_PURCHASE", "No lines on this purchase");
    }

    const receiveMap = new Map<string, number>();
    if (body.lines?.length) {
      for (const l of body.lines) {
        receiveMap.set(l.itemId, l.quantity);
      }
    }

    const sortedItems = [...po.items].sort((a, b) => a.variantId.localeCompare(b.variantId));

    const actorId = await resolveActorId(tx, createdById);

    for (const item of sortedItems) {
      const remaining = item.quantityOrdered - item.quantityReceived;
      if (remaining <= 0) continue;

      let toReceive = remaining;
      if (receiveMap.size > 0) {
        const q = receiveMap.get(item.id);
        if (q === undefined) continue;
        toReceive = Math.min(q, remaining);
      }

      if (toReceive <= 0) continue;

      await applyInventoryMovement(tx, {
        variantId: item.variantId,
        quantityDelta: toReceive,
        movementType: "PURCHASE_IN",
        referenceKind: "PURCHASE_ORDER",
        referenceId: po.id,
        createdById: actorId,
        metadata: { purchaseOrderItemId: item.id, quantity: toReceive },
      });

      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { quantityReceived: { increment: toReceive } },
      });

      // Keep the catalog's cost price in step with what was actually just paid.
      // Suppliers re-rate constantly, so a cost captured once at product creation
      // goes stale immediately and misleads anyone reading the catalog.
      //
      // This is the LATEST paid rate (ex-GST), not the average. WAC — which drives
      // margin, COGS and valuation — is still derived from the purchase lines and
      // is untouched by this write.
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { costPrice: item.unitCostExclusive },
      });
    }

    const refreshed = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });

    let allReceived = true;
    for (const it of refreshed.items) {
      if (it.quantityReceived < it.quantityOrdered) {
        allReceived = false;
        break;
      }
    }

    const anyReceived = refreshed.items.some((it) => it.quantityReceived > 0);

    return tx.purchaseOrder.update({
      where: { id },
      data: {
        status: allReceived
          ? "RECEIVED"
          : anyReceived
            ? "PARTIALLY_RECEIVED"
            : po.status,
        receivedAt:
          allReceived
            ? new Date()
            : anyReceived
              ? (po.receivedAt ?? new Date())
              : po.receivedAt,
      },
      include: {
        supplier: true,
        items: {
          include: {
            variant: {
              include: {
                product: { select: { id: true, name: true, kind: true } },
                flavour: true,
                packSize: true,
              },
            },
          },
        },
      },
    });
  });
}

/** Create draft, replace lines, mark ordered, and receive all in one transaction. */
export async function saveAndReceivePurchase(input: {
  supplierId: string;
  lines: ReplaceLinesBody["lines"];
  createdById: string | null;
}) {
  const variantIds = [...new Set(input.lines.map((l) => l.variantId))].sort();
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, isActive: true },
    include: { product: { select: { id: true, kind: true } } },
  });
  if (variants.length !== variantIds.length) {
    throw new AppError(400, "VARIANT_NOT_FOUND", "One or more variants are invalid");
  }
  const byId = new Map(variants.map((v) => [v.id, v]));

  const computed: ReturnType<typeof computeLine>[] = input.lines.map((line) => {
    const v = byId.get(line.variantId)!;
    const defs = defaultIntraStateGstPercentages(v.product.kind);
    const merged: PurchaseLineInput = {
      ...line,
      cgstRate: line.cgstRate ?? defs.cgst,
      sgstRate: line.sgstRate ?? defs.sgst,
      igstRate: line.igstRate ?? defs.igst,
    };
    return buildComputedPurchaseLine(merged);
  });
  const header = aggregateHeaderFromComputed(computed);

  return runInTransaction(async (tx) => {
    const sup = await tx.supplier.findFirst({
      where: { id: input.supplierId, isActive: true },
    });
    if (!sup) throw new AppError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");

    const actorId = await resolveActorId(tx, input.createdById);

    const po = await tx.purchaseOrder.create({
      data: {
        supplierId: input.supplierId,
        createdById: actorId,
        status: "ORDERED",
        orderedAt: new Date(),
        ...header,
      },
    });

    const items: {
      id: string;
      variantId: string;
      quantityOrdered: number;
      unitCostExclusive: Prisma.Decimal;
    }[] = [];

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i]!;
      const c = computed[i]!;
      const qty = line.quantityOrdered;
      const unitEx =
        qty > 0
          ? c.taxableValue.div(qty).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)
          : new Prisma.Decimal(0);

      const row = await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: po.id,
          variantId: line.variantId,
          quantityOrdered: qty,
          quantityReceived: 0,
          unitCost: new Prisma.Decimal(line.unitCost),
          gstEnabled: line.gstEnabled ?? true,
          gstPricingMode: line.gstPricingMode ?? GstPricingMode.EXCLUSIVE,
          cgstRate: c.cgstRate,
          sgstRate: c.sgstRate,
          igstRate: c.igstRate,
          taxableValue: c.taxableValue,
          cgstAmount: c.cgstAmount,
          sgstAmount: c.sgstAmount,
          igstAmount: c.igstAmount,
          lineTotal: c.lineTotal,
          unitCostExclusive: unitEx,
        },
      });
      items.push({
        id: row.id,
        variantId: row.variantId,
        quantityOrdered: row.quantityOrdered,
        unitCostExclusive: row.unitCostExclusive,
      });
    }

    const sorted = [...items].sort((a, b) => a.variantId.localeCompare(b.variantId));
    for (const it of sorted) {
      await applyInventoryMovement(tx, {
        variantId: it.variantId,
        quantityDelta: it.quantityOrdered,
        movementType: "PURCHASE_IN",
        referenceKind: "PURCHASE_ORDER",
        referenceId: po.id,
        createdById: actorId,
        metadata: { purchaseOrderItemId: it.id },
      });
      await tx.purchaseOrderItem.update({
        where: { id: it.id },
        data: { quantityReceived: it.quantityOrdered },
      });

      // Same as the staged receive path: refresh the catalog cost price to the
      // rate just paid (ex-GST), so it never drifts from reality. WAC is derived
      // from the purchase lines and is unaffected by this write.
      await tx.productVariant.update({
        where: { id: it.variantId },
        data: { costPrice: it.unitCostExclusive },
      });
    }

    return tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: "RECEIVED",
        receivedAt: new Date(),
      },
      include: {
        supplier: true,
        items: {
          include: {
            variant: {
              include: {
                product: { select: { id: true, name: true, kind: true } },
                flavour: true,
                packSize: true,
              },
            },
          },
        },
      },
    });
  });
}

export async function recordPurchasePayment(
  purchaseOrderId: string,
  amount: number,
): Promise<unknown> {
  const amt = new Prisma.Decimal(amount);
  return runInTransaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
    });
    if (!po) throw new AppError(404, "PURCHASE_NOT_FOUND", "Purchase not found");
    const next = po.amountPaid.plus(amt);
    if (next.gt(po.grandTotal)) {
      throw new AppError(400, "OVERPAY", "Payment exceeds purchase grand total");
    }
    return tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { amountPaid: next },
      include: { supplier: true, items: true },
    });
  });
}
