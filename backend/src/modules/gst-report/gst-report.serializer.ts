import type { Prisma } from "@prisma/client";

type Decimal = Prisma.Decimal;

export function dec(v: Decimal | number | null | undefined): string {
  if (v == null) return "0.00";
  if (typeof v === "number") return v.toFixed(2);
  return v.toFixed(2);
}

export function dec4(v: Decimal | number | null | undefined): string {
  if (v == null) return "0.0000";
  if (typeof v === "number") return v.toFixed(4);
  return v.toFixed(4);
}

export type SalesRegisterRowPayload = Prisma.OrderItemGetPayload<{
  include: {
    order: {
      select: {
        id: true;
        documentType: true;
        status: true;
        invoiceNumber: true;
        confirmedAt: true;
        createdAt: true;
        isWalkIn: true;
        customer: { select: { id: true; fullName: true; phone: true; email: true } };
      };
    };
    variant: {
      include: {
        product: { select: { id: true; name: true; slug: true; kind: true; hsnCode: true } };
        brand: { select: { id: true; name: true } };
        flavour: { select: { id: true; name: true } };
        packSize: { select: { id: true; label: true } };
      };
    };
  };
}>;

export function serializeSalesRegisterLine(row: SalesRegisterRowPayload) {
  const p = row.variant.product;
  const v = row.variant;
  const variantLabel = [v.brand?.name, v.flavour?.name, v.packSize?.label]
    .filter(Boolean)
    .join(" / ") || "—";
  const gstAmount = row.cgstAmount.plus(row.sgstAmount).plus(row.igstAmount);

  return {
    id: row.id,
    orderId: row.order.id,
    invoiceNumber: row.order.invoiceNumber,
    documentType: row.order.documentType,
    confirmedAt: row.order.confirmedAt?.toISOString() ?? row.order.createdAt.toISOString(),
    customerName: row.order.isWalkIn
      ? "Walk-in"
      : row.order.customer?.fullName ?? "Walk-in",
    customerPhone: row.order.customer?.phone ?? null,
    variantId: row.variantId,
    productId: p.id,
    sku: v.sku,
    productName: p.name,
    productKind: p.kind,
    hsnCode: p.hsnCode ?? null,
    brandName: v.brand?.name ?? null,
    flavourName: v.flavour?.name ?? null,
    packSizeLabel: v.packSize?.label ?? null,
    variantLabel,
    quantity: row.quantity,
    taxableValue: dec(row.taxableValue),
    cgstRate: dec4(row.cgstRate),
    sgstRate: dec4(row.sgstRate),
    igstRate: dec4(row.igstRate),
    cgstAmount: dec(row.cgstAmount),
    sgstAmount: dec(row.sgstAmount),
    igstAmount: dec(row.igstAmount),
    gstAmount: dec(gstAmount),
    lineTotal: dec(row.lineTotal),
  };
}

export type PurchaseRegisterRowPayload = Prisma.PurchaseOrderItemGetPayload<{
  include: {
    purchaseOrder: {
      select: {
        id: true;
        status: true;
        receivedAt: true;
        orderedAt: true;
        createdAt: true;
        supplier: { select: { id: true; name: true } };
      };
    };
    variant: {
      include: {
        product: { select: { id: true; name: true; slug: true; kind: true; hsnCode: true } };
        brand: { select: { id: true; name: true } };
        flavour: { select: { id: true; name: true } };
        packSize: { select: { id: true; label: true } };
      };
    };
  };
}>;

export function serializePurchaseRegisterLine(row: PurchaseRegisterRowPayload) {
  const p = row.variant.product;
  const v = row.variant;
  const variantLabel = [v.brand?.name, v.flavour?.name, v.packSize?.label]
    .filter(Boolean)
    .join(" / ") || "—";

  // For partial vs full receives, prorate line values to the quantity actually received
  const qtyRec = row.quantityReceived;
  const qtyOrd = row.quantityOrdered;
  let taxableVal = row.taxableValue;
  let cgstAmt = row.cgstAmount;
  let sgstAmt = row.sgstAmount;
  let igstAmt = row.igstAmount;
  let lineTot = row.lineTotal;

  if (qtyOrd > 0 && qtyRec !== qtyOrd) {
    const prorata = new (row.taxableValue.constructor as typeof Prisma.Decimal)(qtyRec).div(qtyOrd);
    taxableVal = row.taxableValue.mul(prorata);
    cgstAmt = row.cgstAmount.mul(prorata);
    sgstAmt = row.sgstAmount.mul(prorata);
    igstAmt = row.igstAmount.mul(prorata);
    lineTot = row.lineTotal.mul(prorata);
  }

  const gstAmt = cgstAmt.plus(sgstAmt).plus(igstAmt);

  return {
    id: row.id,
    purchaseOrderId: row.purchaseOrder.id,
    receivedAt: row.purchaseOrder.receivedAt?.toISOString() ?? row.purchaseOrder.createdAt.toISOString(),
    supplierName: row.purchaseOrder.supplier.name,
    variantId: row.variantId,
    productId: p.id,
    sku: v.sku,
    productName: p.name,
    productKind: p.kind,
    hsnCode: p.hsnCode ?? null,
    brandName: v.brand?.name ?? null,
    flavourName: v.flavour?.name ?? null,
    packSizeLabel: v.packSize?.label ?? null,
    variantLabel,
    quantityReceived: qtyRec,
    unitCost: dec4(row.unitCost),
    taxableValue: dec(taxableVal),
    cgstRate: dec4(row.cgstRate),
    sgstRate: dec4(row.sgstRate),
    igstRate: dec4(row.igstRate),
    cgstAmount: dec(cgstAmt),
    sgstAmount: dec(sgstAmt),
    igstAmount: dec(igstAmt),
    gstAmount: dec(gstAmt),
    lineTotal: dec(lineTot),
  };
}

export type PurchaseReturnRowPayload = Prisma.PurchaseReturnLineGetPayload<{
  include: {
    purchaseReturn: {
      select: {
        id: true;
        status: true;
        confirmedAt: true;
        createdAt: true;
        refundAmount: true;
        bookValue: true;
        note: true;
        supplier: { select: { id: true; name: true } };
      };
    };
    variant: {
      include: {
        product: { select: { id: true; name: true; slug: true; kind: true; hsnCode: true } };
        brand: { select: { id: true; name: true } };
        flavour: { select: { id: true; name: true } };
        packSize: { select: { id: true; label: true } };
      };
    };
  };
}>;

export function serializePurchaseReturnLine(row: PurchaseReturnRowPayload) {
  const p = row.variant.product;
  const v = row.variant;
  const variantLabel = [v.brand?.name, v.flavour?.name, v.packSize?.label]
    .filter(Boolean)
    .join(" / ") || "—";

  return {
    id: row.id,
    purchaseReturnId: row.purchaseReturn.id,
    confirmedAt: row.purchaseReturn.confirmedAt?.toISOString() ?? row.purchaseReturn.createdAt.toISOString(),
    supplierName: row.purchaseReturn.supplier.name,
    variantId: row.variantId,
    productId: p.id,
    sku: v.sku,
    productName: p.name,
    productKind: p.kind,
    hsnCode: p.hsnCode ?? null,
    brandName: v.brand?.name ?? null,
    flavourName: v.flavour?.name ?? null,
    packSizeLabel: v.packSize?.label ?? null,
    variantLabel,
    quantity: row.quantity,
    unitWac: dec(row.unitWac),
    lineBookValue: dec(row.lineBookValue),
    returnRefundAmount: dec(row.purchaseReturn.refundAmount),
    note: row.purchaseReturn.note ?? null,
  };
}
