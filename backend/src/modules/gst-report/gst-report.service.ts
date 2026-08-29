import {
  OrderDocumentType,
  OrderStatus,
  Prisma,
  PurchaseReturnStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { parseIstDayRange } from "../analytics/analytics.range.js";
import { buildMeta, parsePagination } from "../../lib/pagination.js";
import { getStoreConfig } from "../../config/store-config.js";
import {
  dec,
  dec4,
  serializePurchaseRegisterLine,
  serializePurchaseReturnLine,
  serializeSalesRegisterLine,
} from "./gst-report.serializer.js";
import type { GstReportListQuery, GstReportQuery } from "./gst-report.validators.js";

const D0 = new Prisma.Decimal(0);

export async function getSalesRegister(input: GstReportListQuery) {
  const { start, endExclusive } = parseIstDayRange(input.from, input.to);
  const { page, limit, skip } = parsePagination({ page: input.page, limit: input.limit });

  const where: Prisma.OrderItemWhereInput = {
    order: {
      documentType: { in: [OrderDocumentType.SALE, OrderDocumentType.CREDIT_NOTE] },
      status: OrderStatus.CONFIRMED,
      gstEnabled: true,
      confirmedAt: { gte: start, lt: endExclusive },
    },
  };

  const [rows, total] = await Promise.all([
    prisma.orderItem.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ order: { confirmedAt: "desc" } }, { id: "desc" }],
      include: {
        order: {
          select: {
            id: true,
            documentType: true,
            status: true,
            invoiceNumber: true,
            confirmedAt: true,
            createdAt: true,
            isWalkIn: true,
            customer: { select: { id: true, fullName: true, phone: true, email: true } },
          },
        },
        variant: {
          include: {
            product: { select: { id: true, name: true, slug: true, kind: true, hsnCode: true } },
            brand: { select: { id: true, name: true } },
            flavour: { select: { id: true, name: true } },
            packSize: { select: { id: true, label: true } },
          },
        },
      },
    }),
    prisma.orderItem.count({ where }),
  ]);

  return {
    items: rows.map(serializeSalesRegisterLine),
    meta: buildMeta(page, limit, total),
  };
}

export async function getPurchaseRegister(input: GstReportListQuery) {
  const { start, endExclusive } = parseIstDayRange(input.from, input.to);
  const { page, limit, skip } = parsePagination({ page: input.page, limit: input.limit });

  const where: Prisma.PurchaseOrderItemWhereInput = {
    purchaseOrder: {
      receivedAt: { gte: start, lt: endExclusive },
    },
    quantityReceived: { gt: 0 },
  };

  const [rows, total] = await Promise.all([
    prisma.purchaseOrderItem.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ purchaseOrder: { receivedAt: "desc" } }, { id: "desc" }],
      include: {
        purchaseOrder: {
          select: {
            id: true,
            status: true,
            receivedAt: true,
            orderedAt: true,
            createdAt: true,
            supplier: { select: { id: true, name: true } },
          },
        },
        variant: {
          include: {
            product: { select: { id: true, name: true, slug: true, kind: true, hsnCode: true } },
            brand: { select: { id: true, name: true } },
            flavour: { select: { id: true, name: true } },
            packSize: { select: { id: true, label: true } },
          },
        },
      },
    }),
    prisma.purchaseOrderItem.count({ where }),
  ]);

  return {
    items: rows.map(serializePurchaseRegisterLine),
    meta: buildMeta(page, limit, total),
  };
}

export async function getPurchaseReturns(input: GstReportListQuery) {
  const { start, endExclusive } = parseIstDayRange(input.from, input.to);
  const { page, limit, skip } = parsePagination({ page: input.page, limit: input.limit });

  const where: Prisma.PurchaseReturnLineWhereInput = {
    purchaseReturn: {
      status: PurchaseReturnStatus.CONFIRMED,
      confirmedAt: { gte: start, lt: endExclusive },
    },
  };

  const [rows, total] = await Promise.all([
    prisma.purchaseReturnLine.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ purchaseReturn: { confirmedAt: "desc" } }, { id: "desc" }],
      include: {
        purchaseReturn: {
          select: {
            id: true,
            status: true,
            confirmedAt: true,
            createdAt: true,
            refundAmount: true,
            bookValue: true,
            note: true,
            supplier: { select: { id: true, name: true } },
          },
        },
        variant: {
          include: {
            product: { select: { id: true, name: true, slug: true, kind: true, hsnCode: true } },
            brand: { select: { id: true, name: true } },
            flavour: { select: { id: true, name: true } },
            packSize: { select: { id: true, label: true } },
          },
        },
      },
    }),
    prisma.purchaseReturnLine.count({ where }),
  ]);

  return {
    items: rows.map(serializePurchaseReturnLine),
    meta: buildMeta(page, limit, total),
  };
}

type HsnAccumulator = {
  hsnCode: string | null;
  cgstRate: Prisma.Decimal;
  sgstRate: Prisma.Decimal;
  igstRate: Prisma.Decimal;
  salesQuantity: number;
  salesTaxableValue: Prisma.Decimal;
  salesCgst: Prisma.Decimal;
  salesSgst: Prisma.Decimal;
  salesIgst: Prisma.Decimal;
  creditQuantity: number;
  creditTaxableValue: Prisma.Decimal;
  creditCgst: Prisma.Decimal;
  creditSgst: Prisma.Decimal;
  creditIgst: Prisma.Decimal;
};

export async function getHsnSummary(input: GstReportQuery) {
  const { start, endExclusive } = parseIstDayRange(input.from, input.to);

  const lines = await prisma.orderItem.findMany({
    where: {
      order: {
        documentType: { in: [OrderDocumentType.SALE, OrderDocumentType.CREDIT_NOTE] },
        status: OrderStatus.CONFIRMED,
        gstEnabled: true,
        confirmedAt: { gte: start, lt: endExclusive },
      },
    },
    select: {
      quantity: true,
      taxableValue: true,
      cgstRate: true,
      sgstRate: true,
      igstRate: true,
      cgstAmount: true,
      sgstAmount: true,
      igstAmount: true,
      lineTotal: true,
      order: { select: { documentType: true } },
      variant: {
        select: {
          product: { select: { hsnCode: true } },
        },
      },
    },
  });

  let missingHsnLineCount = 0;
  const groupMap = new Map<string, HsnAccumulator>();

  for (const ln of lines) {
    const rawHsn = ln.variant.product.hsnCode?.trim() || null;
    if (!rawHsn) {
      missingHsnLineCount += 1;
    }

    const key = `${rawHsn ?? "NONE"}__${dec4(ln.cgstRate)}__${dec4(ln.sgstRate)}__${dec4(ln.igstRate)}`;
    let acc = groupMap.get(key);
    if (!acc) {
      acc = {
        hsnCode: rawHsn,
        cgstRate: ln.cgstRate,
        sgstRate: ln.sgstRate,
        igstRate: ln.igstRate,
        salesQuantity: 0,
        salesTaxableValue: D0,
        salesCgst: D0,
        salesSgst: D0,
        salesIgst: D0,
        creditQuantity: 0,
        creditTaxableValue: D0,
        creditCgst: D0,
        creditSgst: D0,
        creditIgst: D0,
      };
      groupMap.set(key, acc);
    }

    if (ln.order.documentType === OrderDocumentType.SALE) {
      acc.salesQuantity += ln.quantity;
      acc.salesTaxableValue = acc.salesTaxableValue.plus(ln.taxableValue);
      acc.salesCgst = acc.salesCgst.plus(ln.cgstAmount);
      acc.salesSgst = acc.salesSgst.plus(ln.sgstAmount);
      acc.salesIgst = acc.salesIgst.plus(ln.igstAmount);
    } else {
      acc.creditQuantity += ln.quantity;
      acc.creditTaxableValue = acc.creditTaxableValue.plus(ln.taxableValue);
      acc.creditCgst = acc.creditCgst.plus(ln.cgstAmount);
      acc.creditSgst = acc.creditSgst.plus(ln.sgstAmount);
      acc.creditIgst = acc.creditIgst.plus(ln.igstAmount);
    }
  }

  let totalNetQuantity = 0;
  let totalNetTaxable = D0;
  let totalNetCgst = D0;
  let totalNetSgst = D0;
  let totalNetIgst = D0;
  let totalNetGst = D0;
  let totalNetGrand = D0;

  const items = Array.from(groupMap.values())
    .map((acc) => {
      const netQty = acc.salesQuantity - acc.creditQuantity;
      const netTaxable = acc.salesTaxableValue.minus(acc.creditTaxableValue);
      const netCgst = acc.salesCgst.minus(acc.creditCgst);
      const netSgst = acc.salesSgst.minus(acc.creditSgst);
      const netIgst = acc.salesIgst.minus(acc.creditIgst);
      const netGst = netCgst.plus(netSgst).plus(netIgst);
      const netTotal = netTaxable.plus(netGst);

      const salesGst = acc.salesCgst.plus(acc.salesSgst).plus(acc.salesIgst);
      const creditGst = acc.creditCgst.plus(acc.creditSgst).plus(acc.creditIgst);
      const ratePct = acc.cgstRate.plus(acc.sgstRate).plus(acc.igstRate);

      totalNetQuantity += netQty;
      totalNetTaxable = totalNetTaxable.plus(netTaxable);
      totalNetCgst = totalNetCgst.plus(netCgst);
      totalNetSgst = totalNetSgst.plus(netSgst);
      totalNetIgst = totalNetIgst.plus(netIgst);
      totalNetGst = totalNetGst.plus(netGst);
      totalNetGrand = totalNetGrand.plus(netTotal);

      return {
        hsnCode: acc.hsnCode,
        cgstRate: dec4(acc.cgstRate),
        sgstRate: dec4(acc.sgstRate),
        igstRate: dec4(acc.igstRate),
        totalTaxRate: dec(ratePct),
        salesQuantity: acc.salesQuantity,
        salesTaxableValue: dec(acc.salesTaxableValue),
        salesCgst: dec(acc.salesCgst),
        salesSgst: dec(acc.salesSgst),
        salesIgst: dec(acc.salesIgst),
        salesTotalGst: dec(salesGst),
        creditQuantity: acc.creditQuantity,
        creditTaxableValue: dec(acc.creditTaxableValue),
        creditCgst: dec(acc.creditCgst),
        creditSgst: dec(acc.creditSgst),
        creditIgst: dec(acc.creditIgst),
        creditTotalGst: dec(creditGst),
        netQuantity: netQty,
        netTaxableValue: dec(netTaxable),
        netCgst: dec(netCgst),
        netSgst: dec(netSgst),
        netIgst: dec(netIgst),
        netTotalGst: dec(netGst),
        netLineTotal: dec(netTotal),
      };
    })
    .sort((a, b) => (a.hsnCode ?? "ZZZZ").localeCompare(b.hsnCode ?? "ZZZZ"));

  return {
    items,
    missingHsnLineCount,
    totals: {
      netQuantity: totalNetQuantity,
      netTaxableValue: dec(totalNetTaxable),
      netCgst: dec(totalNetCgst),
      netSgst: dec(totalNetSgst),
      netIgst: dec(totalNetIgst),
      netTotalGst: dec(totalNetGst),
      netGrandTotal: dec(totalNetGrand),
    },
  };
}

export async function getGstSummary(input: GstReportQuery) {
  const { start, endExclusive } = parseIstDayRange(input.from, input.to);
  const storeConfig = getStoreConfig();

  // 1. Sales & Credit notes
  const [salesOrders, salesLines] = await Promise.all([
    prisma.order.findMany({
      where: {
        documentType: { in: [OrderDocumentType.SALE, OrderDocumentType.CREDIT_NOTE] },
        status: OrderStatus.CONFIRMED,
        gstEnabled: true,
        confirmedAt: { gte: start, lt: endExclusive },
      },
      select: {
        id: true,
        documentType: true,
        taxableValue: true,
        cgstTotal: true,
        sgstTotal: true,
        igstTotal: true,
        grandTotal: true,
      },
    }),
    prisma.orderItem.findMany({
      where: {
        order: {
          documentType: { in: [OrderDocumentType.SALE, OrderDocumentType.CREDIT_NOTE] },
          status: OrderStatus.CONFIRMED,
          gstEnabled: true,
          confirmedAt: { gte: start, lt: endExclusive },
        },
      },
      select: {
        id: true,
        variant: { select: { product: { select: { hsnCode: true } } } },
      },
    }),
  ]);

  let salesInvoiceCount = 0;
  let creditNoteCount = 0;
  let grossSalesTaxable = D0;
  let grossSalesCgst = D0;
  let grossSalesSgst = D0;
  let grossSalesIgst = D0;
  let grossSalesGrand = D0;

  let creditNotesTaxable = D0;
  let creditNotesCgst = D0;
  let creditNotesSgst = D0;
  let creditNotesIgst = D0;
  let creditNotesGrand = D0;

  for (const o of salesOrders) {
    if (o.documentType === OrderDocumentType.SALE) {
      salesInvoiceCount += 1;
      grossSalesTaxable = grossSalesTaxable.plus(o.taxableValue);
      grossSalesCgst = grossSalesCgst.plus(o.cgstTotal);
      grossSalesSgst = grossSalesSgst.plus(o.sgstTotal);
      grossSalesIgst = grossSalesIgst.plus(o.igstTotal);
      grossSalesGrand = grossSalesGrand.plus(o.grandTotal);
    } else {
      creditNoteCount += 1;
      creditNotesTaxable = creditNotesTaxable.plus(o.taxableValue);
      creditNotesCgst = creditNotesCgst.plus(o.cgstTotal);
      creditNotesSgst = creditNotesSgst.plus(o.sgstTotal);
      creditNotesIgst = creditNotesIgst.plus(o.igstTotal);
      creditNotesGrand = creditNotesGrand.plus(o.grandTotal);
    }
  }

  const grossSalesGstTotal = grossSalesCgst.plus(grossSalesSgst).plus(grossSalesIgst);
  const creditNotesGstTotal = creditNotesCgst.plus(creditNotesSgst).plus(creditNotesIgst);

  const netSalesTaxable = grossSalesTaxable.minus(creditNotesTaxable);
  const netSalesCgst = grossSalesCgst.minus(creditNotesCgst);
  const netSalesSgst = grossSalesSgst.minus(creditNotesSgst);
  const netSalesIgst = grossSalesIgst.minus(creditNotesIgst);
  const netSalesGstTotal = grossSalesGstTotal.minus(creditNotesGstTotal);
  const netSalesGrand = grossSalesGrand.minus(creditNotesGrand);

  const missingHsnLineCount = salesLines.filter(
    (l) => !l.variant.product.hsnCode || l.variant.product.hsnCode.trim() === "",
  ).length;

  // 2. Purchases received
  const purchaseItems = await prisma.purchaseOrderItem.findMany({
    where: {
      purchaseOrder: {
        receivedAt: { gte: start, lt: endExclusive },
      },
      quantityReceived: { gt: 0 },
    },
    select: {
      purchaseOrderId: true,
      quantityOrdered: true,
      quantityReceived: true,
      taxableValue: true,
      cgstAmount: true,
      sgstAmount: true,
      igstAmount: true,
      lineTotal: true,
    },
  });

  const distinctPoIds = new Set<string>();
  let purchaseTaxable = D0;
  let purchaseCgst = D0;
  let purchaseSgst = D0;
  let purchaseIgst = D0;
  let purchaseTotal = D0;

  for (const pi of purchaseItems) {
    distinctPoIds.add(pi.purchaseOrderId);
    const qtyRec = pi.quantityReceived;
    const qtyOrd = pi.quantityOrdered;

    let tVal = pi.taxableValue;
    let cAmt = pi.cgstAmount;
    let sAmt = pi.sgstAmount;
    let iAmt = pi.igstAmount;
    let lTot = pi.lineTotal;

    if (qtyOrd > 0 && qtyRec !== qtyOrd) {
      const prorata = new Prisma.Decimal(qtyRec).div(qtyOrd);
      tVal = pi.taxableValue.mul(prorata);
      cAmt = pi.cgstAmount.mul(prorata);
      sAmt = pi.sgstAmount.mul(prorata);
      iAmt = pi.igstAmount.mul(prorata);
      lTot = pi.lineTotal.mul(prorata);
    }

    purchaseTaxable = purchaseTaxable.plus(tVal);
    purchaseCgst = purchaseCgst.plus(cAmt);
    purchaseSgst = purchaseSgst.plus(sAmt);
    purchaseIgst = purchaseIgst.plus(iAmt);
    purchaseTotal = purchaseTotal.plus(lTot);
  }

  const purchaseGstTotal = purchaseCgst.plus(purchaseSgst).plus(purchaseIgst);

  // 3. Purchase Returns
  const purchaseReturns = await prisma.purchaseReturn.findMany({
    where: {
      status: PurchaseReturnStatus.CONFIRMED,
      confirmedAt: { gte: start, lt: endExclusive },
    },
    include: {
      _count: { select: { lines: true } },
    },
  });

  let purchaseReturnBookValue = D0;
  let purchaseReturnRefundAmount = D0;
  let purchaseReturnLinesCount = 0;

  for (const pr of purchaseReturns) {
    purchaseReturnBookValue = purchaseReturnBookValue.plus(pr.bookValue);
    purchaseReturnRefundAmount = purchaseReturnRefundAmount.plus(pr.refundAmount);
    purchaseReturnLinesCount += pr._count.lines;
  }

  return {
    from: input.from,
    to: input.to,
    storeName: storeConfig.name,
    storeGstin: storeConfig.gstin,
    disclaimer: "This is store transaction data for your CA — not a prepared GST return.",
    sales: {
      salesInvoiceCount,
      creditNoteCount,
      salesLinesCount: salesLines.length,
      missingHsnLineCount,
      gross: {
        taxableValue: dec(grossSalesTaxable),
        cgstAmount: dec(grossSalesCgst),
        sgstAmount: dec(grossSalesSgst),
        igstAmount: dec(grossSalesIgst),
        gstTotal: dec(grossSalesGstTotal),
        grandTotal: dec(grossSalesGrand),
      },
      creditNotes: {
        taxableValue: dec(creditNotesTaxable),
        cgstAmount: dec(creditNotesCgst),
        sgstAmount: dec(creditNotesSgst),
        igstAmount: dec(creditNotesIgst),
        gstTotal: dec(creditNotesGstTotal),
        grandTotal: dec(creditNotesGrand),
      },
      net: {
        taxableValue: dec(netSalesTaxable),
        cgstAmount: dec(netSalesCgst),
        sgstAmount: dec(netSalesSgst),
        igstAmount: dec(netSalesIgst),
        gstTotal: dec(netSalesGstTotal),
        grandTotal: dec(netSalesGrand),
      },
    },
    purchases: {
      purchaseOrderCount: distinctPoIds.size,
      purchaseLinesCount: purchaseItems.length,
      taxableValue: dec(purchaseTaxable),
      cgstAmount: dec(purchaseCgst),
      sgstAmount: dec(purchaseSgst),
      igstAmount: dec(purchaseIgst),
      gstTotal: dec(purchaseGstTotal),
      grandTotal: dec(purchaseTotal),
    },
    purchaseReturns: {
      purchaseReturnCount: purchaseReturns.length,
      purchaseReturnLinesCount,
      bookValue: dec(purchaseReturnBookValue),
      refundAmount: dec(purchaseReturnRefundAmount),
      note: "Purchase returns — no GST rate stored; for reference only, not tax data.",
    },
  };
}
