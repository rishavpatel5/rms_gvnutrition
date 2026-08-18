import * as XLSX from "xlsx";
import {
  fetchCustomerRetention,
  fetchDeadStock,
  fetchFastMoving,
  fetchInventoryValuation,
  fetchOfferPerformance,
  fetchOrdersReport,
  fetchProfitLines,
  fetchProfitSummary,
  fetchSalesSeries,
  type DeadStockRow,
  type OfferRow,
  type OrderReportRow,
  type ProfitLine,
  type SalesGranularity,
  type ValuationRow,
  type VelocityRow,
} from "./analytics-api";
import { fetchAllPaginated } from "./fetch-paginated";
import { formatIstDateTime, IST_TIMEZONE, istYmd } from "./ist-time";

export type ReportsExportParams = {
  from: string;
  to: string;
  granularity: SalesGranularity;
  deadAfterDays?: number;
  /** Variants at or below this qty are included (matches Inventory → Low stock tab). */
  lowStockThreshold?: number;
};

type LowStockBalanceRow = {
  quantity: number;
  variant: {
    id: string;
    sku: string;
    product: { name: string; kind: "SUPPLEMENT" | "ACCESSORY" };
    flavour: { name: string } | null;
    packSize: { label: string } | null;
  };
};

function sheetFromRows(rows: (string | number | boolean | null | undefined)[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

async function fetchAllProfitLines(from: string, to: string): Promise<ProfitLine[]> {
  const all: ProfitLine[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const out = await fetchProfitLines({ from, to, page, limit: 100 });
    all.push(...out.items);
    totalPages = out.meta.totalPages;
    page += 1;
  } while (page <= totalPages);
  return all;
}

async function fetchAllInventory(): Promise<{ items: ValuationRow[]; totalValuation: number }> {
  const all: ValuationRow[] = [];
  let page = 1;
  let totalPages = 1;
  let totalValuation = 0;
  do {
    const out = await fetchInventoryValuation({ page, limit: 100 });
    all.push(...out.items);
    totalValuation = out.totals.inventoryValuation;
    totalPages = out.meta.totalPages;
    page += 1;
  } while (page <= totalPages);
  return { items: all, totalValuation };
}

async function fetchAllDeadStock(deadAfterDays: number): Promise<DeadStockRow[]> {
  const all: DeadStockRow[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const out = await fetchDeadStock({ deadAfterDays, page, limit: 100 });
    all.push(...out.items);
    totalPages = out.meta.totalPages;
    page += 1;
  } while (page <= totalPages);
  return all;
}

async function fetchAllOffers(from: string, to: string): Promise<OfferRow[]> {
  const all: OfferRow[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const out = await fetchOfferPerformance({ from, to, page, limit: 100 });
    all.push(...out.items);
    totalPages = out.meta.totalPages;
    page += 1;
  } while (page <= totalPages);
  return all;
}

async function fetchAllOrders(from: string, to: string): Promise<OrderReportRow[]> {
  const all: OrderReportRow[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const out = await fetchOrdersReport({
      from,
      to,
      page,
      limit: 100,
      status: "CONFIRMED",
      documentType: "SALE",
    });
    all.push(...out.items);
    totalPages = out.meta.totalPages;
    page += 1;
  } while (page <= totalPages);
  return all;
}

async function fetchAllLowStock(threshold: number): Promise<LowStockBalanceRow[]> {
  return fetchAllPaginated<LowStockBalanceRow>((page) =>
    `/api/v1/inventory/balances?lowStock=true&threshold=${threshold}&page=${page}&limit=100`,
  );
}

function lowStockStatus(quantity: number, threshold: number): string {
  if (quantity === 0) return "Out of stock";
  if (quantity <= Math.max(1, Math.floor(threshold / 2))) return "Critical";
  return "Low";
}

function bucketLabel(iso: string, granularity: SalesGranularity): string {
  const d = new Date(iso);
  if (granularity === "monthly") {
    return d.toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: IST_TIMEZONE });
  }
  if (granularity === "weekly") {
    return `W ${istYmd(d)}`;
  }
  return istYmd(d);
}

function num(s: string): number {
  return Number(s) || 0;
}

function buildSalesSheet(
  from: string,
  to: string,
  granularity: SalesGranularity,
  sales: Awaited<ReturnType<typeof fetchSalesSeries>>,
): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ["Report", "Sales"],
    ["Date range (IST)", `${from} to ${to}`],
    ["Granularity", granularity],
    [],
    ["Net sales", sales.totals.netSales],
    ["Gross sales", sales.totals.grossSales],
    ["Credit notes", sales.totals.creditNotes],
    ["Sale orders", sales.totals.saleOrderCount],
    ["Credit note count", sales.totals.creditNoteCount],
    [],
    ["Period", "Gross sales", "Credit notes", "Net sales", "Sale orders", "Credit notes count"],
  ];
  for (const b of sales.buckets) {
    rows.push([
      bucketLabel(b.periodStart, granularity),
      b.grossSales,
      b.creditNotes,
      b.netSales,
      b.saleOrderCount,
      b.creditNoteCount,
    ]);
  }
  return sheetFromRows(rows);
}

function buildProfitSheet(
  from: string,
  to: string,
  summary: Awaited<ReturnType<typeof fetchProfitSummary>>,
  lines: ProfitLine[],
): XLSX.WorkSheet {
  const rows: (string | number | boolean)[][] = [
    ["Report", "Profit"],
    ["Date range (IST)", `${from} to ${to}`],
    [],
    ["Revenue", summary.revenue],
    ["COGS", summary.cogs],
    ["Gross profit", summary.grossProfit],
    ["Margin %", summary.marginPct],
    ["Giveaway units", summary.giveawayUnits],
    ["Giveaway cost", summary.giveawayCost],
    ["Promotional expense", summary.promotionalExpense],
    ["Discount cost", summary.discountCost],
    ["Avg discount %", summary.avgDiscountPct],
    ["Note", summary.note],
    [],
    [
      "Confirmed at",
      "Invoice",
      "SKU",
      "Product",
      "Flavour",
      "Type",
      "Qty",
      "Revenue",
      "Unit cost WAC",
      "COGS",
      "Line gross profit",
    ],
  ];
  for (const ln of lines) {
    rows.push([
      formatIstDateTime(ln.confirmedAt),
      ln.invoiceNumber ?? "",
      ln.sku,
      ln.productName,
      ln.flavourName ?? "",
      ln.isGiveaway ? "Giveaway" : "Sale",
      ln.quantity,
      ln.lineTotal,
      ln.unitCostWac ?? "",
      ln.cogs,
      ln.lineGrossProfit,
    ]);
  }
  return sheetFromRows(rows);
}

function buildInventorySheet(
  items: ValuationRow[],
  totalValuation: number,
): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ["Report", "Inventory valuation"],
    ["Total valuation", totalValuation],
    [],
    ["SKU", "Product", "Flavour", "Size", "Qty on hand", "Unit cost WAC", "Valuation"],
  ];
  for (const r of items) {
    rows.push([
      r.sku,
      r.productName,
      r.flavourName ?? "",
      r.packSizeLabel ?? "",
      r.quantityOnHand,
      r.unitCostWac ?? "",
      r.valuation,
    ]);
  }
  return sheetFromRows(rows);
}

function buildFastMovingSheet(from: string, to: string, items: VelocityRow[]): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ["Report", "Fast-moving"],
    ["Date range (IST)", `${from} to ${to}`],
    [],
    ["SKU", "Product", "Flavour", "Units sold", "Revenue"],
  ];
  for (const r of items) {
    rows.push([r.sku, r.productName, r.flavourName ?? "", r.unitsSold, r.revenue]);
  }
  return sheetFromRows(rows);
}

function buildDeadStockSheet(deadAfterDays: number, items: DeadStockRow[]): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ["Report", "Dead stock"],
    ["Stale after (days)", deadAfterDays],
    [],
    ["SKU", "Product", "Flavour", "Qty on hand", "Last sale", "Days since sale"],
  ];
  for (const r of items) {
    rows.push([
      r.sku,
      r.productName,
      r.flavourName ?? "",
      r.quantityOnHand,
      r.lastSaleAt ? r.lastSaleAt.slice(0, 10) : "Never",
      r.daysSinceSale ?? "",
    ]);
  }
  return sheetFromRows(rows);
}

function buildRetentionSheet(
  from: string,
  to: string,
  data: Awaited<ReturnType<typeof fetchCustomerRetention>>,
): XLSX.WorkSheet {
  return sheetFromRows([
    ["Report", "Retention"],
    ["Date range (IST)", `${from} to ${to}`],
    [],
    ["Metric", "Value"],
    ["Customers in period", data.customersInPeriod],
    ["Repeat purchasers (2+ orders)", data.repeatCustomersInPeriod],
    ["Repeat rate %", data.repeatRatePct],
    ["Returning customers", data.returningCustomers],
    ["Returning rate %", data.returningRatePct],
    ["New customers", data.newCustomers],
    ["Note", data.note],
  ]);
}

function buildOffersSheet(from: string, to: string, items: OfferRow[]): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ["Report", "Offers"],
    ["Date range (IST)", `${from} to ${to}`],
    [],
    ["Code", "Name", "Orders", "Revenue", "Discount total"],
  ];
  for (const r of items) {
    rows.push([r.code ?? "", r.name, r.orderCount, r.revenue, r.discountTotal]);
  }
  return sheetFromRows(rows);
}

function paymentSummary(row: OrderReportRow): string {
  if (row.payments.length === 0) return "";
  return row.payments.map((p) => `${p.method} ${p.amount}`).join(", ");
}

function buildOrdersSheet(from: string, to: string, orders: OrderReportRow[]): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ["Report", "Orders"],
    ["Date range (IST)", `${from} to ${to}`],
    ["Status", "CONFIRMED sales only"],
    [],
    [
      "Invoice",
      "Date",
      "Customer",
      "Phone",
      "Type",
      "Item discount",
      "Bill discount",
      "Taxable",
      "GST",
      "Total",
      "Payment",
      "GST enabled",
      "Walk-in",
      "Line count",
    ],
  ];
  for (const o of orders) {
    const t = o.totals;
    rows.push([
      o.invoiceNumber ?? "",
      formatIstDateTime(o.confirmedAt ?? o.createdAt),
      o.isWalkIn ? "Walk-in" : (o.customer?.fullName ?? ""),
      o.customer?.phone ?? "",
      o.documentType,
      num(t.itemDiscountTotal),
      num(t.cartDiscountAmount),
      num(t.taxableValue),
      o.gstEnabled ? num(t.gstTotal) : "",
      num(t.grandTotal),
      paymentSummary(o),
      o.gstEnabled ? "Yes" : "No",
      o.isWalkIn ? "Yes" : "No",
      o.lines.length,
    ]);
  }
  return sheetFromRows(rows);
}

function buildLowStockSheet(threshold: number, items: LowStockBalanceRow[]): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ["Report", "Low stock"],
    ["Threshold (qty at or below)", threshold],
    ["Note", "Variants with on-hand quantity at or below the threshold."],
    [],
    ["Product", "Kind", "SKU", "Flavour", "Size", "Qty on hand", "Status"],
  ];
  for (const r of items) {
    const variantLabel =
      [r.variant.flavour?.name, r.variant.packSize?.label].filter(Boolean).join(" / ") || "—";
    rows.push([
      r.variant.product.name,
      r.variant.product.kind === "SUPPLEMENT" ? "Supplement" : "Accessory",
      r.variant.sku,
      r.variant.flavour?.name ?? "",
      variantLabel,
      r.quantity,
      lowStockStatus(r.quantity, threshold),
    ]);
  }
  return sheetFromRows(rows);
}

function triggerDownload(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Fetch all report tabs and download one .xlsx workbook with a sheet per tab. */
export async function downloadReportsWorkbook(params: ReportsExportParams): Promise<void> {
  const { from, to, granularity, deadAfterDays = 90, lowStockThreshold = 10 } = params;

  const [
    sales,
    profitSummary,
    profitLines,
    inventory,
    lowStock,
    fastMoving,
    retention,
    deadStock,
    offers,
    orders,
  ] = await Promise.all([
    fetchSalesSeries({ from, to, granularity }),
    fetchProfitSummary({ from, to }),
    fetchAllProfitLines(from, to),
    fetchAllInventory(),
    fetchAllLowStock(lowStockThreshold),
    fetchFastMoving({ from, to, limit: 100 }).then((r) => r.items),
    fetchCustomerRetention({ from, to }),
    fetchAllDeadStock(deadAfterDays),
    fetchAllOffers(from, to),
    fetchAllOrders(from, to),
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildSalesSheet(from, to, granularity, sales), "Sales");
  XLSX.utils.book_append_sheet(
    workbook,
    buildProfitSheet(from, to, profitSummary, profitLines),
    "Profit",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    buildInventorySheet(inventory.items, inventory.totalValuation),
    "Inventory",
  );
  XLSX.utils.book_append_sheet(workbook, buildLowStockSheet(lowStockThreshold, lowStock), "Low stock");
  XLSX.utils.book_append_sheet(
    workbook,
    buildFastMovingSheet(from, to, fastMoving),
    "Fast-moving",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    buildDeadStockSheet(deadAfterDays, deadStock),
    "Dead stock",
  );
  XLSX.utils.book_append_sheet(workbook, buildRetentionSheet(from, to, retention), "Retention");
  XLSX.utils.book_append_sheet(workbook, buildOffersSheet(from, to, offers), "Offers");
  XLSX.utils.book_append_sheet(workbook, buildOrdersSheet(from, to, orders), "Orders");

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  triggerDownload(buffer, `reports_${from}_${to}.xlsx`);
}
