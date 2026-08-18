import type { Prisma } from "@prisma/client";

type Decimal = Prisma.Decimal;

function dec(v: Decimal | null | undefined): string {
  if (v == null) return "0.00";
  return v.toFixed(2);
}

function dec4(v: Decimal | null | undefined): string {
  if (v == null) return "0.0000";
  return v.toFixed(4);
}

type OrderReportRow = Prisma.OrderGetPayload<{
  include: {
    customer: { select: { id: true; fullName: true; phone: true; email: true } };
    createdBy: { select: { id: true; name: true; email: true } };
    offer: { select: { id: true; code: true; name: true } };
    items: {
      orderBy: { createdAt: "asc" };
      include: {
        variant: {
          include: {
            product: { select: { id: true; name: true; slug: true; kind: true; hsnCode: true } };
            brand: true;
            flavour: true;
            packSize: true;
          };
        };
      };
    };
    payments: { orderBy: { createdAt: "asc" } };
  };
}>;

export function serializeOrderForReport(row: OrderReportRow) {
  const gstTotal = row.cgstTotal.plus(row.sgstTotal).plus(row.igstTotal).plus(row.cessTotal);

  return {
    id: row.id,
    documentType: row.documentType,
    status: row.status,
    invoiceNumber: row.invoiceNumber,
    currency: row.currency,
    gstEnabled: row.gstEnabled,
    gstPricingMode: row.gstPricingMode,
    isWalkIn: row.isWalkIn,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    notes: row.notes,
    customer: row.customer
      ? {
          id: row.customer.id,
          fullName: row.customer.fullName,
          phone: row.customer.phone,
          email: row.customer.email,
        }
      : null,
    staff: row.createdBy
      ? { id: row.createdBy.id, name: row.createdBy.name, email: row.createdBy.email }
      : null,
    offer: row.offer
      ? { id: row.offer.id, code: row.offer.code, name: row.offer.name }
      : null,
    totals: {
      subtotal: dec(row.subtotal),
      itemDiscountTotal: dec(row.itemDiscountTotal),
      cartDiscountType: row.cartDiscountType,
      cartDiscountValue: row.cartDiscountValue != null ? dec4(row.cartDiscountValue) : null,
      cartDiscountAmount: dec(row.cartDiscountAmount),
      discountTotal: dec(row.discountTotal),
      taxableValue: dec(row.taxableValue),
      cgstTotal: dec(row.cgstTotal),
      sgstTotal: dec(row.sgstTotal),
      igstTotal: dec(row.igstTotal),
      cessTotal: dec(row.cessTotal),
      gstTotal: dec(gstTotal),
      roundingAdjustment: dec(row.roundingAdjustment),
      grandTotal: dec(row.grandTotal),
    },
    payments: row.payments.map((p) => ({
      id: p.id,
      method: p.method,
      nature: p.nature,
      amount: dec(p.amount),
      status: p.status,
      externalRef: p.externalRef,
      createdAt: p.createdAt.toISOString(),
    })),
    lines: row.items.map((it) => {
      const p = it.variant.product;
      const variantLabel = [it.variant.brand?.name, it.variant.flavour?.name, it.variant.packSize?.label]
        .filter(Boolean)
        .join(" / ");
      const lineGst = it.cgstAmount.plus(it.sgstAmount).plus(it.igstAmount);
      return {
        id: it.id,
        variantId: it.variantId,
        productId: p.id,
        sku: it.variant.sku,
        productName: p.name,
        productKind: p.kind,
        hsnCode: p.hsnCode ?? null,
        brandName: it.variant.brand?.name ?? null,
        flavourName: it.variant.flavour?.name ?? null,
        packSizeLabel: it.variant.packSize?.label ?? null,
        variantLabel: variantLabel || "—",
        quantity: it.quantity,
        unitPrice: dec4(it.unitPrice),
        grossAmount: dec(
          it.unitPrice.mul(it.quantity),
        ),
        itemDiscountType: it.itemDiscountType,
        itemDiscountValue: it.itemDiscountValue != null ? dec4(it.itemDiscountValue) : null,
        itemDiscountAmount: dec(it.itemDiscountAmount),
        cartDiscountAllocated: dec(it.cartDiscountAllocated),
        lineDiscount: dec(it.lineDiscount),
        taxableValue: dec(it.taxableValue),
        cgstRate: dec4(it.cgstRate),
        sgstRate: dec4(it.sgstRate),
        igstRate: dec4(it.igstRate),
        cgstAmount: dec(it.cgstAmount),
        sgstAmount: dec(it.sgstAmount),
        igstAmount: dec(it.igstAmount),
        gstAmount: dec(lineGst),
        lineTotal: dec(it.lineTotal),
        isGiveaway: it.isGiveaway || it.lineTotal.lte(0),
        giveawayReason: it.giveawayReason,
        unitCostSnapshot: it.unitCostSnapshot != null ? dec4(it.unitCostSnapshot) : null,
      };
    }),
  };
}
