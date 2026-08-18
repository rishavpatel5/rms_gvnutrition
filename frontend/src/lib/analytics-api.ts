import {
  apiGetJsonAuthed,
  apiGetJsonAuthedWithMeta,
  type PaginationMeta,
} from "./api-client";

export type SalesGranularity = "daily" | "weekly" | "monthly";

export type SalesBucket = {
  periodStart: string;
  grossSales: number;
  creditNotes: number;
  netSales: number;
  saleOrderCount: number;
  creditNoteCount: number;
};

export type SalesSeriesResponse = {
  granularity: SalesGranularity;
  buckets: SalesBucket[];
  totals: {
    grossSales: number;
    creditNotes: number;
    netSales: number;
    saleOrderCount: number;
    creditNoteCount: number;
  };
};

function qs(params: Record<string, string | number | undefined>): string {
  const e = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    e.set(k, String(v));
  }
  const s = e.toString();
  return s ? `?${s}` : "";
}

export function fetchSalesSeries(args: {
  from: string;
  to: string;
  granularity?: SalesGranularity;
  customerId?: string;
}): Promise<SalesSeriesResponse> {
  return apiGetJsonAuthed<SalesSeriesResponse>(
    `/api/v1/analytics/sales-series${qs({
      from: args.from,
      to: args.to,
      granularity: args.granularity ?? "daily",
      customerId: args.customerId,
    })}`,
  );
}

export type ProfitSummary = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
  giveawayUnits: number;
  giveawayCost: number;
  promotionalExpense: number;
  discountCost: number;
  avgDiscountPct: number;
  note: string;
};

export function fetchProfitSummary(args: {
  from: string;
  to: string;
  customerId?: string;
}): Promise<ProfitSummary> {
  return apiGetJsonAuthed<ProfitSummary>(
    `/api/v1/analytics/profit/summary${qs({
      from: args.from,
      to: args.to,
      customerId: args.customerId,
    })}`,
  );
}

export type ProfitLine = {
  orderItemId: string;
  orderId: string;
  confirmedAt: string;
  invoiceNumber: string | null;
  sku: string;
  productName: string;
  flavourName: string | null;
  quantity: number;
  lineTotal: number;
  isGiveaway: boolean;
  unitCostWac: number | null;
  cogs: number;
  lineGrossProfit: number;
};

export async function fetchProfitLines(args: {
  from: string;
  to: string;
  page?: number;
  limit?: number;
  customerId?: string;
}): Promise<{ items: ProfitLine[]; meta: PaginationMeta }> {
  const { data, meta } = await apiGetJsonAuthedWithMeta<ProfitLine[]>(
    `/api/v1/analytics/profit/lines${qs({
      from: args.from,
      to: args.to,
      page: args.page,
      limit: args.limit,
      customerId: args.customerId,
    })}`,
  );
  return { items: data, meta: meta ?? { page: 1, limit: 20, total: 0, totalPages: 0 } };
}

export type ValuationRow = {
  variantId: string;
  sku: string;
  productName: string;
  flavourName: string | null;
  packSizeLabel: string | null;
  quantityOnHand: number;
  unitCostWac: number | null;
  valuation: number;
};

export async function fetchInventoryValuation(args: {
  page?: number;
  limit?: number;
  q?: string;
}): Promise<{ items: ValuationRow[]; meta: PaginationMeta; totals: { inventoryValuation: number } }> {
  const { data, meta } = await apiGetJsonAuthedWithMeta<{
    items: ValuationRow[];
    totals: { inventoryValuation: number };
  }>(`/api/v1/analytics/inventory-valuation${qs({ page: args.page, limit: args.limit, q: args.q })}`);
  return {
    items: data.items,
    totals: data.totals,
    meta: meta ?? { page: 1, limit: 20, total: 0, totalPages: 0 },
  };
}

export type VelocityRow = {
  variantId: string;
  sku: string;
  productName: string;
  flavourName: string | null;
  unitsSold: number;
  revenue: number;
};

export function fetchFastMoving(args: {
  from: string;
  to: string;
  limit?: number;
  customerId?: string;
}): Promise<{ items: VelocityRow[] }> {
  return apiGetJsonAuthed<{ items: VelocityRow[] }>(
    `/api/v1/analytics/fast-moving${qs({
      from: args.from,
      to: args.to,
      limit: args.limit,
      customerId: args.customerId,
    })}`,
  );
}

export type DeadStockRow = {
  variantId: string;
  sku: string;
  productName: string;
  flavourName: string | null;
  quantityOnHand: number;
  lastSaleAt: string | null;
  daysSinceSale: number | null;
};

export async function fetchDeadStock(args: {
  deadAfterDays?: number;
  page?: number;
  limit?: number;
}): Promise<{ items: DeadStockRow[]; meta: PaginationMeta }> {
  const { data, meta } = await apiGetJsonAuthedWithMeta<DeadStockRow[]>(
    `/api/v1/analytics/dead-stock${qs({
      deadAfterDays: args.deadAfterDays,
      page: args.page,
      limit: args.limit,
    })}`,
  );
  return { items: data, meta: meta ?? { page: 1, limit: 20, total: 0, totalPages: 0 } };
}

export type RetentionSummary = {
  customersInPeriod: number;
  returningCustomers: number;
  repeatCustomersInPeriod: number;
  newCustomers: number;
  repeatRatePct: number;
  returningRatePct: number;
  note: string;
};

export function fetchCustomerRetention(args: {
  from: string;
  to: string;
  customerId?: string;
}): Promise<RetentionSummary> {
  return apiGetJsonAuthed<RetentionSummary>(
    `/api/v1/analytics/customer-retention${qs({
      from: args.from,
      to: args.to,
      customerId: args.customerId,
    })}`,
  );
}

export type OfferRow = {
  offerId: string;
  code: string | null;
  name: string;
  orderCount: number;
  revenue: number;
  discountTotal: number;
};

export async function fetchOfferPerformance(args: {
  from: string;
  to: string;
  page?: number;
  limit?: number;
  customerId?: string;
}): Promise<{ items: OfferRow[]; meta: PaginationMeta }> {
  const { data, meta } = await apiGetJsonAuthedWithMeta<OfferRow[]>(
    `/api/v1/analytics/offer-performance${qs({
      from: args.from,
      to: args.to,
      page: args.page,
      limit: args.limit,
      customerId: args.customerId,
    })}`,
  );
  return { items: data, meta: meta ?? { page: 1, limit: 20, total: 0, totalPages: 0 } };
}

export type OrderReportPayment = {
  id: string;
  method: string;
  nature: string;
  amount: string;
  status: string;
  externalRef: string | null;
  createdAt: string;
};

export type OrderReportLine = {
  id: string;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  productKind: string;
  flavourName: string | null;
  packSizeLabel: string | null;
  variantLabel: string;
  quantity: number;
  unitPrice: string;
  grossAmount: string;
  itemDiscountType: string | null;
  itemDiscountValue: string | null;
  itemDiscountAmount: string;
  cartDiscountAllocated: string;
  lineDiscount: string;
  taxableValue: string;
  cgstRate: string;
  sgstRate: string;
  igstRate: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  gstAmount: string;
  lineTotal: string;
  isGiveaway: boolean;
  giveawayReason: string | null;
  unitCostSnapshot: string | null;
};

export type OrderReportRow = {
  id: string;
  documentType: string;
  status: string;
  invoiceNumber: string | null;
  currency: string;
  gstEnabled: boolean;
  gstPricingMode: string | null;
  isWalkIn: boolean;
  confirmedAt: string | null;
  createdAt: string;
  notes: string | null;
  customer: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
  } | null;
  staff: { id: string; name: string; email: string } | null;
  offer: { id: string; code: string | null; name: string } | null;
  totals: {
    subtotal: string;
    itemDiscountTotal: string;
    cartDiscountType: string | null;
    cartDiscountValue: string | null;
    cartDiscountAmount: string;
    discountTotal: string;
    taxableValue: string;
    cgstTotal: string;
    sgstTotal: string;
    igstTotal: string;
    cessTotal: string;
    gstTotal: string;
    roundingAdjustment: string;
    grandTotal: string;
  };
  payments: OrderReportPayment[];
  lines: OrderReportLine[];
};

export async function fetchOrdersReport(args: {
  from: string;
  to: string;
  page?: number;
  limit?: number;
  search?: string;
  status?: "DRAFT" | "CONFIRMED" | "VOIDED";
  documentType?: "SALE" | "CREDIT_NOTE";
}): Promise<{ items: OrderReportRow[]; meta: PaginationMeta }> {
  const { data, meta } = await apiGetJsonAuthedWithMeta<OrderReportRow[]>(
    `/api/v1/analytics/orders${qs({
      from: args.from,
      to: args.to,
      page: args.page,
      limit: args.limit,
      search: args.search,
      status: args.status,
      documentType: args.documentType,
    })}`,
  );
  return { items: data, meta: meta ?? { page: 1, limit: 25, total: 0, totalPages: 0 } };
}

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

export type PurchaseAnalysisResponse = {
  trendDays: number;
  coverDays: number;
  trendFrom: string;
  trendTo: string;
  summary: PurchaseAnalysisSummary;
  items: PurchaseAnalysisRow[];
};

export type TrendDaysOption = 7 | 14 | 30;

export function fetchPurchaseAnalysis(args: {
  trendDays?: TrendDaysOption;
  coverDays?: number;
}): Promise<PurchaseAnalysisResponse> {
  return apiGetJsonAuthed<PurchaseAnalysisResponse>(
    `/api/v1/analytics/purchase-analysis${qs({
      trendDays: args.trendDays ?? 30,
      coverDays: args.coverDays ?? 14,
    })}`,
  );
}
