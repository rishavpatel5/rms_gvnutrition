import {
  apiGetJsonAuthed,
  apiGetJsonAuthedWithMeta,
  type PaginationMeta,
} from "./api-client";

function qs(params: Record<string, string | number | undefined>): string {
  const e = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    e.set(k, String(v));
  }
  const s = e.toString();
  return s ? `?${s}` : "";
}

export type GstSalesRegisterLine = {
  id: string;
  orderId: string;
  invoiceNumber: string | null;
  documentType: "SALE" | "CREDIT_NOTE";
  confirmedAt: string;
  customerName: string;
  customerPhone: string | null;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  productKind: string;
  hsnCode: string | null;
  brandName: string | null;
  flavourName: string | null;
  packSizeLabel: string | null;
  variantLabel: string;
  quantity: number;
  taxableValue: string;
  cgstRate: string;
  sgstRate: string;
  igstRate: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  gstAmount: string;
  lineTotal: string;
};

export type GstPurchaseRegisterLine = {
  id: string;
  purchaseOrderId: string;
  receivedAt: string;
  supplierName: string;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  productKind: string;
  hsnCode: string | null;
  brandName: string | null;
  flavourName: string | null;
  packSizeLabel: string | null;
  variantLabel: string;
  quantityReceived: number;
  unitCost: string;
  taxableValue: string;
  cgstRate: string;
  sgstRate: string;
  igstRate: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  gstAmount: string;
  lineTotal: string;
};

export type GstPurchaseReturnLine = {
  id: string;
  purchaseReturnId: string;
  confirmedAt: string;
  supplierName: string;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  productKind: string;
  hsnCode: string | null;
  brandName: string | null;
  flavourName: string | null;
  packSizeLabel: string | null;
  variantLabel: string;
  quantity: number;
  unitWac: string;
  lineBookValue: string;
  returnRefundAmount: string;
  note: string | null;
};

export type GstHsnSummaryRow = {
  hsnCode: string | null;
  cgstRate: string;
  sgstRate: string;
  igstRate: string;
  totalTaxRate: string;
  salesQuantity: number;
  salesTaxableValue: string;
  salesCgst: string;
  salesSgst: string;
  salesIgst: string;
  salesTotalGst: string;
  creditQuantity: number;
  creditTaxableValue: string;
  creditCgst: string;
  creditSgst: string;
  creditIgst: string;
  creditTotalGst: string;
  netQuantity: number;
  netTaxableValue: string;
  netCgst: string;
  netSgst: string;
  netIgst: string;
  netTotalGst: string;
  netLineTotal: string;
};

export type GstHsnSummaryResponse = {
  items: GstHsnSummaryRow[];
  missingHsnLineCount: number;
  totals: {
    netQuantity: number;
    netTaxableValue: string;
    netCgst: string;
    netSgst: string;
    netIgst: string;
    netTotalGst: string;
    netGrandTotal: string;
  };
};

export type GstSummaryTotals = {
  taxableValue: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  gstTotal: string;
  grandTotal: string;
};

export type GstSummaryResponse = {
  from: string;
  to: string;
  storeName: string;
  storeGstin: string;
  disclaimer: string;
  sales: {
    salesInvoiceCount: number;
    creditNoteCount: number;
    salesLinesCount: number;
    missingHsnLineCount: number;
    gross: GstSummaryTotals;
    creditNotes: GstSummaryTotals;
    net: GstSummaryTotals;
  };
  purchases: {
    purchaseOrderCount: number;
    purchaseLinesCount: number;
    taxableValue: string;
    cgstAmount: string;
    sgstAmount: string;
    igstAmount: string;
    gstTotal: string;
    grandTotal: string;
  };
  purchaseReturns: {
    purchaseReturnCount: number;
    purchaseReturnLinesCount: number;
    bookValue: string;
    refundAmount: string;
    note: string;
  };
};

export function fetchGstSummary(args: {
  from: string;
  to: string;
}): Promise<GstSummaryResponse> {
  return apiGetJsonAuthed<GstSummaryResponse>(
    `/api/v1/gst-report/summary${qs({ from: args.from, to: args.to })}`,
  );
}

export async function fetchGstSalesRegister(args: {
  from: string;
  to: string;
  page?: number;
  limit?: number;
}): Promise<{ items: GstSalesRegisterLine[]; meta: PaginationMeta }> {
  const { data, meta } = await apiGetJsonAuthedWithMeta<GstSalesRegisterLine[]>(
    `/api/v1/gst-report/sales-register${qs({
      from: args.from,
      to: args.to,
      page: args.page,
      limit: args.limit,
    })}`,
  );
  return { items: data, meta: meta ?? { page: 1, limit: 20, total: 0, totalPages: 0 } };
}

export async function fetchGstPurchaseRegister(args: {
  from: string;
  to: string;
  page?: number;
  limit?: number;
}): Promise<{ items: GstPurchaseRegisterLine[]; meta: PaginationMeta }> {
  const { data, meta } = await apiGetJsonAuthedWithMeta<GstPurchaseRegisterLine[]>(
    `/api/v1/gst-report/purchase-register${qs({
      from: args.from,
      to: args.to,
      page: args.page,
      limit: args.limit,
    })}`,
  );
  return { items: data, meta: meta ?? { page: 1, limit: 20, total: 0, totalPages: 0 } };
}

export async function fetchGstPurchaseReturns(args: {
  from: string;
  to: string;
  page?: number;
  limit?: number;
}): Promise<{ items: GstPurchaseReturnLine[]; meta: PaginationMeta }> {
  const { data, meta } = await apiGetJsonAuthedWithMeta<GstPurchaseReturnLine[]>(
    `/api/v1/gst-report/purchase-returns${qs({
      from: args.from,
      to: args.to,
      page: args.page,
      limit: args.limit,
    })}`,
  );
  return { items: data, meta: meta ?? { page: 1, limit: 20, total: 0, totalPages: 0 } };
}

export function fetchGstHsnSummary(args: {
  from: string;
  to: string;
}): Promise<GstHsnSummaryResponse> {
  return apiGetJsonAuthed<GstHsnSummaryResponse>(
    `/api/v1/gst-report/hsn-summary${qs({ from: args.from, to: args.to })}`,
  );
}
