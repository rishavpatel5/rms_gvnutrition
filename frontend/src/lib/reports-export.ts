import ExcelJS from "exceljs";
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
} from "./analytics-api";
import {
  fetchGstHsnSummary,
  fetchGstPurchaseRegister,
  fetchGstPurchaseReturns,
  fetchGstSalesRegister,
  fetchGstSummary,
  type GstHsnSummaryResponse,
  type GstPurchaseRegisterLine,
  type GstPurchaseReturnLine,
  type GstSalesRegisterLine,
  type GstSummaryResponse,
} from "./gst-report-api";
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

// ---------------------------------------------------------------------------
// Design Theme & Excel Styling Constants (ARGB)
// ---------------------------------------------------------------------------

const COLORS = {
  NAVY_HEADER: "FF1E3A8A",      // Deep Navy
  SLATE_HEADER: "FF334155",     // Slate Dark
  EMERALD_HEADER: "FF065F46",   // Emerald Green
  TEAL_HEADER: "FF0D9488",      // Teal
  INDIGO_HEADER: "FF4338CA",    // Indigo
  ROSE_HEADER: "FF9F1239",      // Rose
  WHITE: "FFFFFFFF",
  DARK_TEXT: "FF0F172A",        // Slate 900
  MUTED_TEXT: "FF64748B",       // Slate 500
  ZEBRA_BG: "FFF8FAFC",         // Slate 50
  TOTAL_BG: "FFF1F5F9",         // Slate 100
  BORDER_THIN: "FFCBD5E1",      // Slate 300
  BORDER_SOFT: "FFE2E8F0",      // Slate 200
  NOTICE_BG: "FFEFF6FF",        // Blue 50
  NOTICE_BORDER: "FF93C5FD",    // Blue 300
  NOTICE_TEXT: "FF1E3A8A",      // Blue 900
  SALE_BG: "FFDCFCE7",          // Green 100
  SALE_TEXT: "FF166534",        // Green 800
  CN_BG: "FFFEE2E2",            // Red 100
  CN_TEXT: "FF991B1B",          // Red 800
  WARN_BG: "FFFEF3C7",          // Amber 100
  WARN_TEXT: "FF92400E",        // Amber 800
  CARD_HEADER_BG: "FFE2E8F0",   // Slate 200
};

const NUM_FMT = {
  CURRENCY: "₹#,##0.00",
  CURRENCY_PLAIN: "#,##0.00",
  QTY: "#,##0",
  PCT: "0.00%",
  DATE: "YYYY-MM-DD HH:mm",
};

const FONT_FAMILY = "Segoe UI";

// ---------------------------------------------------------------------------
// Styling Helpers
// ---------------------------------------------------------------------------

function setThinBorder(cell: ExcelJS.Cell, color = COLORS.BORDER_THIN) {
  cell.border = {
    top: { style: "thin", color: { argb: color } },
    left: { style: "thin", color: { argb: color } },
    bottom: { style: "thin", color: { argb: color } },
    right: { style: "thin", color: { argb: color } },
  };
}

function setDoubleBottomBorder(cell: ExcelJS.Cell, topColor = COLORS.BORDER_THIN, botColor = COLORS.DARK_TEXT) {
  cell.border = {
    top: { style: "thin", color: { argb: topColor } },
    left: { style: "thin", color: { argb: topColor } },
    bottom: { style: "double", color: { argb: botColor } },
    right: { style: "thin", color: { argb: topColor } },
  };
}

function applyHeaderStyle(
  row: ExcelJS.Row,
  bgArgb: string = COLORS.NAVY_HEADER,
  fgArgb: string = COLORS.WHITE,
) {
  row.height = 26;
  row.eachCell({ includeEmpty: false }, (cell) => {
    cell.font = { name: FONT_FAMILY, size: 10.5, bold: true, color: { argb: fgArgb } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    setThinBorder(cell, COLORS.BORDER_THIN);
  });
}

function autoFitColumns(ws: ExcelJS.Worksheet, minWidth = 12, maxWidth = 45) {
  ws.columns.forEach((column) => {
    let maxLen = 0;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      let len = 0;
      if (cell.value !== null && cell.value !== undefined) {
        if (typeof cell.value === "object" && "formula" in cell.value) {
          len = String(cell.value.result ?? "").length;
        } else {
          len = String(cell.value).length;
        }
      }
      if (len > maxLen) maxLen = len;
    });
    column.width = Math.min(Math.max(maxLen + 4, minWidth), maxWidth);
  });
}

async function triggerWorkbookDownload(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
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

function num(s: string | number | null | undefined): number {
  if (typeof s === "number") return s;
  return Number(s) || 0;
}

// ---------------------------------------------------------------------------
// GST Data Fetchers
// ---------------------------------------------------------------------------

async function fetchAllGstSales(from: string, to: string): Promise<GstSalesRegisterLine[]> {
  const all: GstSalesRegisterLine[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const out = await fetchGstSalesRegister({ from, to, page, limit: 100 });
    all.push(...out.items);
    totalPages = out.meta.totalPages;
    page += 1;
  } while (page <= totalPages);
  return all;
}

async function fetchAllGstPurchases(from: string, to: string): Promise<GstPurchaseRegisterLine[]> {
  const all: GstPurchaseRegisterLine[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const out = await fetchGstPurchaseRegister({ from, to, page, limit: 100 });
    all.push(...out.items);
    totalPages = out.meta.totalPages;
    page += 1;
  } while (page <= totalPages);
  return all;
}

async function fetchAllGstReturns(from: string, to: string): Promise<GstPurchaseReturnLine[]> {
  const all: GstPurchaseReturnLine[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const out = await fetchGstPurchaseReturns({ from, to, page, limit: 100 });
    all.push(...out.items);
    totalPages = out.meta.totalPages;
    page += 1;
  } while (page <= totalPages);
  return all;
}

// ---------------------------------------------------------------------------
// Rich Sheet Builders for GST Workbook
// ---------------------------------------------------------------------------

function buildRichGstSummarySheet(ws: ExcelJS.Worksheet, summary: GstSummaryResponse): void {
  ws.views = [{ showGridLines: true }];
  ws.properties.tabColor = { argb: COLORS.NAVY_HEADER };

  // Title block
  ws.mergeCells("A1:F1");
  const titleCell = ws.getCell("A1");
  titleCell.value = "GV NUTRITION — GST TRANSACTION REPORT (CA RECONCILIATION)";
  titleCell.font = { name: FONT_FAMILY, size: 14, bold: true, color: { argb: COLORS.WHITE } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.NAVY_HEADER } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 34;

  // Disclaimer / Notice Callout Box
  ws.mergeCells("A3:F4");
  const noticeCell = ws.getCell("A3");
  noticeCell.value = `OFFICIAL NOTICE: ${summary.disclaimer}\nThis file contains point-of-sale and purchase records for audit and filing preparation.`;
  noticeCell.font = { name: FONT_FAMILY, size: 9.5, italic: true, bold: true, color: { argb: COLORS.NOTICE_TEXT } };
  noticeCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.NOTICE_BG } };
  noticeCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  ["A3", "B3", "C3", "D3", "E3", "F3", "A4", "B4", "C4", "D4", "E4", "F4"].forEach((c) => {
    setThinBorder(ws.getCell(c), COLORS.NOTICE_BORDER);
  });

  // Metadata Table
  ws.addRow([]);
  const metaTable = [
    ["Store Entity", summary.storeName, "Period (IST)", `${summary.from} to ${summary.to}`],
    ["Store GSTIN", summary.storeGstin || "Not Configured", "Export Generated", formatIstDateTime(new Date().toISOString())],
  ];
  let curRow = 6;
  for (const m of metaTable) {
    ws.addRow([m[0], m[1], "", m[2], m[3]]);
    ws.getRow(curRow).height = 20;
    ws.getCell(`A${curRow}`).font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: COLORS.SLATE_HEADER } };
    ws.getCell(`A${curRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.ZEBRA_BG } };
    ws.getCell(`B${curRow}`).font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: COLORS.DARK_TEXT } };
    ws.getCell(`D${curRow}`).font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: COLORS.SLATE_HEADER } };
    ws.getCell(`D${curRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.ZEBRA_BG } };
    ws.getCell(`E${curRow}`).font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: COLORS.DARK_TEXT } };
    ["A", "B", "D", "E"].forEach((col) => setThinBorder(ws.getCell(`${col}${curRow}`)));
    curRow++;
  }

  // Section 1: Sales & Output GST
  curRow += 1;
  ws.mergeCells(`A${curRow}:F${curRow}`);
  const s1Header = ws.getCell(`A${curRow}`);
  s1Header.value = "1. SALES & OUTPUT GST REGISTER SUMMARY";
  s1Header.font = { name: FONT_FAMILY, size: 11, bold: true, color: { argb: COLORS.WHITE } };
  s1Header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.INDIGO_HEADER } };
  s1Header.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(curRow).height = 24;

  const salesTableStart = curRow + 1;
  const salesRows = [
    ["Classification", "Invoices / Notes", "Taxable Value (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Total GST (₹)", "Grand Total (₹)"],
    ["Gross Sales", summary.sales.salesInvoiceCount, num(summary.sales.gross.taxableValue), num(summary.sales.gross.cgstAmount), num(summary.sales.gross.sgstAmount), num(summary.sales.gross.igstAmount), num(summary.sales.gross.gstTotal), num(summary.sales.gross.grandTotal)],
    ["Credit Notes (Returns)", summary.sales.creditNoteCount, num(summary.sales.creditNotes.taxableValue), num(summary.sales.creditNotes.cgstAmount), num(summary.sales.creditNotes.sgstAmount), num(summary.sales.creditNotes.igstAmount), num(summary.sales.creditNotes.gstTotal), num(summary.sales.creditNotes.grandTotal)],
    ["NET OUTPUT GST", summary.sales.salesInvoiceCount - summary.sales.creditNoteCount, num(summary.sales.net.taxableValue), num(summary.sales.net.cgstAmount), num(summary.sales.net.sgstAmount), num(summary.sales.net.igstAmount), num(summary.sales.net.gstTotal), num(summary.sales.net.grandTotal)],
  ];

  salesRows.forEach((r, idx) => {
    const row = ws.addRow(r);
    row.height = 22;
    if (idx === 0) {
      applyHeaderStyle(row, COLORS.SLATE_HEADER);
    } else if (idx === 3) {
      // Net totals row
      row.eachCell((cell, cIdx) => {
        cell.font = { name: FONT_FAMILY, size: 10.5, bold: true, color: { argb: COLORS.DARK_TEXT } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.TOTAL_BG } };
        setDoubleBottomBorder(cell);
        if (cIdx >= 3) {
          cell.numFmt = NUM_FMT.CURRENCY;
          cell.alignment = { horizontal: "right" };
        } else if (cIdx === 2) {
          cell.alignment = { horizontal: "center" };
        }
      });
    } else {
      row.eachCell((cell, cIdx) => {
        cell.font = { name: FONT_FAMILY, size: 10, color: { argb: COLORS.DARK_TEXT } };
        setThinBorder(cell);
        if (cIdx >= 3) {
          cell.numFmt = NUM_FMT.CURRENCY;
          cell.alignment = { horizontal: "right" };
        } else if (cIdx === 2) {
          cell.alignment = { horizontal: "center" };
        }
      });
    }
  });

  curRow = salesTableStart + salesRows.length + 1;

  // Section 2: Purchases & Input Tax Credit (ITC)
  ws.mergeCells(`A${curRow}:F${curRow}`);
  const s2Header = ws.getCell(`A${curRow}`);
  s2Header.value = "2. PURCHASES & INPUT TAX CREDIT (ITC) SUMMARY";
  s2Header.font = { name: FONT_FAMILY, size: 11, bold: true, color: { argb: COLORS.WHITE } };
  s2Header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.EMERALD_HEADER } };
  s2Header.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(curRow).height = 24;

  const purTableStart = curRow + 1;
  const purRows = [
    ["Classification", "Received POs", "Taxable Value (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Total ITC (₹)", "Grand Total (₹)"],
    ["Received Purchases (ITC Basis)", summary.purchases.purchaseOrderCount, num(summary.purchases.taxableValue), num(summary.purchases.cgstAmount), num(summary.purchases.sgstAmount), num(summary.purchases.igstAmount), num(summary.purchases.gstTotal), num(summary.purchases.grandTotal)],
  ];

  purRows.forEach((r, idx) => {
    const row = ws.addRow(r);
    row.height = 22;
    if (idx === 0) {
      applyHeaderStyle(row, COLORS.SLATE_HEADER);
    } else {
      row.eachCell((cell, cIdx) => {
        cell.font = { name: FONT_FAMILY, size: 10.5, bold: true, color: { argb: COLORS.DARK_TEXT } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.TOTAL_BG } };
        setDoubleBottomBorder(cell);
        if (cIdx >= 3) {
          cell.numFmt = NUM_FMT.CURRENCY;
          cell.alignment = { horizontal: "right" };
        } else if (cIdx === 2) {
          cell.alignment = { horizontal: "center" };
        }
      });
    }
  });

  curRow = purTableStart + purRows.length + 1;

  // Section 3: Purchase Returns & Compliance
  ws.mergeCells(`A${curRow}:F${curRow}`);
  const s3Header = ws.getCell(`A${curRow}`);
  s3Header.value = "3. PURCHASE RETURNS (INFORMATIONAL) & COMPLIANCE HEALTH";
  s3Header.font = { name: FONT_FAMILY, size: 11, bold: true, color: { argb: COLORS.WHITE } };
  s3Header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.SLATE_HEADER } };
  s3Header.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(curRow).height = 24;

  const s3Rows = [
    ["Metric", "Value", "Notes / Guidance"],
    ["Purchase Returns Count", summary.purchaseReturns.purchaseReturnCount, "Informational only — no GST rate recorded"],
    ["Return Stock Book Value (WAC)", num(summary.purchaseReturns.bookValue), "Cost basis at time of return"],
    ["Supplier Refund Amount", num(summary.purchaseReturns.refundAmount), "Actual settlement received/adjusted"],
    ["Sales Lines Missing HSN Code", summary.sales.missingHsnLineCount, summary.sales.missingHsnLineCount > 0 ? "ATTENTION: Assign HSN codes in Catalog for 100% filing compliance" : "All sales lines have HSN assigned"],
  ];

  s3Rows.forEach((r, idx) => {
    const row = ws.addRow(r);
    row.height = 20;
    if (idx === 0) {
      applyHeaderStyle(row, COLORS.SLATE_HEADER);
    } else {
      row.eachCell((cell, cIdx) => {
        setThinBorder(cell);
        if (idx === 4 && cIdx === 2 && summary.sales.missingHsnLineCount > 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.WARN_BG } };
          cell.font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: COLORS.WARN_TEXT } };
        } else {
          cell.font = { name: FONT_FAMILY, size: 10, color: { argb: COLORS.DARK_TEXT } };
        }
        if (cIdx === 2 && (idx === 2 || idx === 3)) {
          cell.numFmt = NUM_FMT.CURRENCY;
          cell.alignment = { horizontal: "right" };
        }
      });
    }
  });

  autoFitColumns(ws, 15, 60);
}

function buildRichGstSalesRegisterSheet(
  ws: ExcelJS.Worksheet,
  from: string,
  to: string,
  lines: GstSalesRegisterLine[],
): void {
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 4, showGridLines: true }];
  ws.properties.tabColor = { argb: COLORS.INDIGO_HEADER };

  // Title header banner
  ws.mergeCells("A1:U1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `GST SALES REGISTER — ${from} to ${to} (CONFIRMED Sales & Credit Notes)`;
  titleCell.font = { name: FONT_FAMILY, size: 13, bold: true, color: { argb: COLORS.WHITE } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.NAVY_HEADER } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 30;

  // Subtitle / filter info
  ws.mergeCells("A2:U2");
  const subCell = ws.getCell("A2");
  subCell.value = `Includes all point-of-sale orders with GST Enabled in the selected period. Credit notes are highlighted in red and represent sales returns.`;
  subCell.font = { name: FONT_FAMILY, size: 9, italic: true, color: { argb: COLORS.MUTED_TEXT } };
  subCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(2).height = 18;

  ws.addRow([]); // empty spacer row 3

  // Table Headers (Row 4)
  const headers = [
    "Invoice #",
    "Date (IST)",
    "Document Type",
    "Customer Name",
    "Customer Phone",
    "SKU",
    "Product Name",
    "Brand",
    "Flavour",
    "Pack Size",
    "HSN Code",
    "Quantity",
    "Taxable Value (₹)",
    "CGST Rate %",
    "CGST Amount (₹)",
    "SGST Rate %",
    "SGST Amount (₹)",
    "IGST Rate %",
    "IGST Amount (₹)",
    "Total GST (₹)",
    "Line Total (₹)",
  ];

  const headerRow = ws.addRow(headers);
  applyHeaderStyle(headerRow, COLORS.INDIGO_HEADER);

  const startDataRow = 5;

  lines.forEach((l, idx) => {
    const isCreditNote = l.documentType === "CREDIT_NOTE";
    const hasMissingHsn = !l.hsnCode || l.hsnCode.trim() === "";
    const isEven = idx % 2 === 0;

    const row = ws.addRow([
      l.invoiceNumber ?? "",
      formatIstDateTime(l.confirmedAt),
      l.documentType,
      l.customerName,
      l.customerPhone ?? "",
      l.sku,
      l.productName,
      l.brandName ?? "",
      l.flavourName ?? "",
      l.packSizeLabel ?? "",
      hasMissingHsn ? "MISSING" : l.hsnCode,
      l.quantity,
      num(l.taxableValue),
      num(l.cgstRate) / 100,
      num(l.cgstAmount),
      num(l.sgstRate) / 100,
      num(l.sgstAmount),
      num(l.igstRate) / 100,
      num(l.igstAmount),
      num(l.gstAmount),
      num(l.lineTotal),
    ]);

    row.height = 20;

    row.eachCell((cell, colNum) => {
      setThinBorder(cell, COLORS.BORDER_SOFT);
      cell.font = { name: FONT_FAMILY, size: 9.5, color: { argb: COLORS.DARK_TEXT } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isEven ? COLORS.WHITE : COLORS.ZEBRA_BG },
      };

      // Document Type badge
      if (colNum === 3) {
        cell.alignment = { horizontal: "center" };
        if (isCreditNote) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.CN_BG } };
          cell.font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLORS.CN_TEXT } };
        } else {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.SALE_BG } };
          cell.font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLORS.SALE_TEXT } };
        }
      }

      // HSN Missing badge
      if (colNum === 11) {
        cell.alignment = { horizontal: "center" };
        if (hasMissingHsn) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.WARN_BG } };
          cell.font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLORS.WARN_TEXT } };
        }
      }

      // Format Numbers
      if (colNum === 12) {
        cell.numFmt = NUM_FMT.QTY;
        cell.alignment = { horizontal: "right" };
      } else if (colNum === 14 || colNum === 16 || colNum === 18) {
        cell.numFmt = NUM_FMT.PCT;
        cell.alignment = { horizontal: "right" };
      } else if (colNum === 13 || colNum === 15 || colNum === 17 || colNum === 19 || colNum === 20 || colNum === 21) {
        cell.numFmt = NUM_FMT.CURRENCY_PLAIN;
        cell.alignment = { horizontal: "right" };
      }
    });
  });

  const lastDataRow = startDataRow + lines.length - 1;

  // Add Grand Totals Row
  if (lines.length > 0) {
    const totalRow = ws.addRow([
      "TOTALS",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      { formula: `SUM(L${startDataRow}:L${lastDataRow})` },
      { formula: `SUM(M${startDataRow}:M${lastDataRow})` },
      "",
      { formula: `SUM(O${startDataRow}:O${lastDataRow})` },
      "",
      { formula: `SUM(Q${startDataRow}:Q${lastDataRow})` },
      "",
      { formula: `SUM(S${startDataRow}:S${lastDataRow})` },
      { formula: `SUM(T${startDataRow}:T${lastDataRow})` },
      { formula: `SUM(U${startDataRow}:U${lastDataRow})` },
    ]);

    totalRow.height = 24;
    totalRow.eachCell((cell, colNum) => {
      cell.font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: COLORS.DARK_TEXT } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.TOTAL_BG } };
      setDoubleBottomBorder(cell);

      if (colNum === 12) {
        cell.numFmt = NUM_FMT.QTY;
        cell.alignment = { horizontal: "right" };
      } else if (colNum === 13 || colNum === 15 || colNum === 17 || colNum === 19 || colNum === 20 || colNum === 21) {
        cell.numFmt = NUM_FMT.CURRENCY;
        cell.alignment = { horizontal: "right" };
      }
    });

    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4, column: headers.length },
    };
  }

  autoFitColumns(ws, 12, 45);
}

function buildRichGstHsnSummarySheet(
  ws: ExcelJS.Worksheet,
  from: string,
  to: string,
  hsnSummary: GstHsnSummaryResponse,
): void {
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 4, showGridLines: true }];
  ws.properties.tabColor = { argb: COLORS.TEAL_HEADER };

  // Title header banner
  ws.mergeCells("A1:S1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `GST SALES HSN SUMMARY — ${from} to ${to}`;
  titleCell.font = { name: FONT_FAMILY, size: 13, bold: true, color: { argb: COLORS.WHITE } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.TEAL_HEADER } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 30;

  // Subtitle / missing HSN warning
  ws.mergeCells("A2:S2");
  const subCell = ws.getCell("A2");
  subCell.value = `Grouped by HSN Code and Tax Rates. ${hsnSummary.missingHsnLineCount > 0 ? `⚠️ ATTENTION: ${hsnSummary.missingHsnLineCount} transaction line(s) have unassigned HSN codes.` : "✓ All lines have valid HSN codes."}`;
  subCell.font = { name: FONT_FAMILY, size: 9.5, italic: true, bold: hsnSummary.missingHsnLineCount > 0, color: { argb: hsnSummary.missingHsnLineCount > 0 ? COLORS.WARN_TEXT : COLORS.MUTED_TEXT } };
  subCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(2).height = 18;

  ws.addRow([]); // empty spacer row 3

  const headers = [
    "HSN Code",
    "Total Rate %",
    "CGST Rate %",
    "SGST Rate %",
    "IGST Rate %",
    "Sales Qty",
    "Return Qty",
    "Net Qty",
    "Sales Taxable (₹)",
    "Credit Taxable (₹)",
    "Net Taxable (₹)",
    "Sales CGST (₹)",
    "Credit CGST (₹)",
    "Net CGST (₹)",
    "Sales SGST (₹)",
    "Credit SGST (₹)",
    "Net SGST (₹)",
    "Net Total GST (₹)",
    "Net Line Total (₹)",
  ];

  const headerRow = ws.addRow(headers);
  applyHeaderStyle(headerRow, COLORS.TEAL_HEADER);

  const startDataRow = 5;

  hsnSummary.items.forEach((h, idx) => {
    const isUnassigned = !h.hsnCode || h.hsnCode.trim() === "";
    const isEven = idx % 2 === 0;

    const row = ws.addRow([
      isUnassigned ? "Unassigned / Blank" : h.hsnCode,
      num(h.totalTaxRate) / 100,
      num(h.cgstRate) / 100,
      num(h.sgstRate) / 100,
      num(h.igstRate) / 100,
      h.salesQuantity,
      h.creditQuantity,
      h.netQuantity,
      num(h.salesTaxableValue),
      num(h.creditTaxableValue),
      num(h.netTaxableValue),
      num(h.salesCgst),
      num(h.creditCgst),
      num(h.netCgst),
      num(h.salesSgst),
      num(h.creditSgst),
      num(h.netSgst),
      num(h.netTotalGst),
      num(h.netLineTotal),
    ]);

    row.height = 20;

    row.eachCell((cell, colNum) => {
      setThinBorder(cell, COLORS.BORDER_SOFT);
      cell.font = { name: FONT_FAMILY, size: 9.5, color: { argb: COLORS.DARK_TEXT } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isEven ? COLORS.WHITE : COLORS.ZEBRA_BG },
      };

      if (colNum === 1) {
        if (isUnassigned) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.WARN_BG } };
          cell.font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLORS.WARN_TEXT } };
        } else {
          cell.font = { name: FONT_FAMILY, size: 9.5, bold: true };
        }
      }

      if (colNum >= 2 && colNum <= 5) {
        cell.numFmt = NUM_FMT.PCT;
        cell.alignment = { horizontal: "right" };
      } else if (colNum >= 6 && colNum <= 8) {
        cell.numFmt = NUM_FMT.QTY;
        cell.alignment = { horizontal: "right" };
      } else {
        cell.numFmt = NUM_FMT.CURRENCY_PLAIN;
        cell.alignment = { horizontal: "right" };
      }
    });
  });

  const lastDataRow = startDataRow + hsnSummary.items.length - 1;

  if (hsnSummary.items.length > 0) {
    const totalRow = ws.addRow([
      "TOTALS",
      "",
      "",
      "",
      "",
      { formula: `SUM(F${startDataRow}:F${lastDataRow})` },
      { formula: `SUM(G${startDataRow}:G${lastDataRow})` },
      { formula: `SUM(H${startDataRow}:H${lastDataRow})` },
      { formula: `SUM(I${startDataRow}:I${lastDataRow})` },
      { formula: `SUM(J${startDataRow}:J${lastDataRow})` },
      { formula: `SUM(K${startDataRow}:K${lastDataRow})` },
      { formula: `SUM(L${startDataRow}:L${lastDataRow})` },
      { formula: `SUM(M${startDataRow}:M${lastDataRow})` },
      { formula: `SUM(N${startDataRow}:N${lastDataRow})` },
      { formula: `SUM(O${startDataRow}:O${lastDataRow})` },
      { formula: `SUM(P${startDataRow}:P${lastDataRow})` },
      { formula: `SUM(Q${startDataRow}:Q${lastDataRow})` },
      { formula: `SUM(R${startDataRow}:R${lastDataRow})` },
      { formula: `SUM(S${startDataRow}:S${lastDataRow})` },
    ]);

    totalRow.height = 24;
    totalRow.eachCell((cell, colNum) => {
      cell.font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: COLORS.DARK_TEXT } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.TOTAL_BG } };
      setDoubleBottomBorder(cell);

      if (colNum >= 6 && colNum <= 8) {
        cell.numFmt = NUM_FMT.QTY;
        cell.alignment = { horizontal: "right" };
      } else if (colNum >= 9) {
        cell.numFmt = NUM_FMT.CURRENCY;
        cell.alignment = { horizontal: "right" };
      }
    });

    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4, column: headers.length },
    };
  }

  autoFitColumns(ws, 12, 35);
}

function buildRichGstPurchaseRegisterSheet(
  ws: ExcelJS.Worksheet,
  from: string,
  to: string,
  lines: GstPurchaseRegisterLine[],
): void {
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 4, showGridLines: true }];
  ws.properties.tabColor = { argb: COLORS.EMERALD_HEADER };

  // Title header banner
  ws.mergeCells("A1:T1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `GST PURCHASE REGISTER (ITC BASIS) — ${from} to ${to}`;
  titleCell.font = { name: FONT_FAMILY, size: 13, bold: true, color: { argb: COLORS.WHITE } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.EMERALD_HEADER } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 30;

  // Subtitle
  ws.mergeCells("A2:T2");
  const subCell = ws.getCell("A2");
  subCell.value = `Filtered strictly by stock received at the store in this period (eligible for Input Tax Credit). Values scaled to received quantities.`;
  subCell.font = { name: FONT_FAMILY, size: 9, italic: true, color: { argb: COLORS.MUTED_TEXT } };
  subCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(2).height = 18;

  ws.addRow([]); // empty row 3

  const headers = [
    "Our PO Reference",
    "Received Date (IST)",
    "Supplier Name",
    "SKU",
    "Product Name",
    "Brand",
    "Flavour",
    "Pack Size",
    "HSN Code",
    "Quantity Received",
    "Unit Cost (₹)",
    "Taxable Value (₹)",
    "CGST Rate %",
    "CGST Amount (₹)",
    "SGST Rate %",
    "SGST Amount (₹)",
    "IGST Rate %",
    "IGST Amount (₹)",
    "Total GST (₹)",
    "Line Total (₹)",
  ];

  const headerRow = ws.addRow(headers);
  applyHeaderStyle(headerRow, COLORS.EMERALD_HEADER);

  const startDataRow = 5;

  lines.forEach((l, idx) => {
    const isEven = idx % 2 === 0;

    const row = ws.addRow([
      l.purchaseOrderId,
      formatIstDateTime(l.receivedAt),
      l.supplierName,
      l.sku,
      l.productName,
      l.brandName ?? "",
      l.flavourName ?? "",
      l.packSizeLabel ?? "",
      l.hsnCode ?? "",
      l.quantityReceived,
      num(l.unitCost),
      num(l.taxableValue),
      num(l.cgstRate) / 100,
      num(l.cgstAmount),
      num(l.sgstRate) / 100,
      num(l.sgstAmount),
      num(l.igstRate) / 100,
      num(l.igstAmount),
      num(l.gstAmount),
      num(l.lineTotal),
    ]);

    row.height = 20;

    row.eachCell((cell, colNum) => {
      setThinBorder(cell, COLORS.BORDER_SOFT);
      cell.font = { name: FONT_FAMILY, size: 9.5, color: { argb: COLORS.DARK_TEXT } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isEven ? COLORS.WHITE : COLORS.ZEBRA_BG },
      };

      if (colNum === 10) {
        cell.numFmt = NUM_FMT.QTY;
        cell.alignment = { horizontal: "right" };
      } else if (colNum === 13 || colNum === 15 || colNum === 17) {
        cell.numFmt = NUM_FMT.PCT;
        cell.alignment = { horizontal: "right" };
      } else if (colNum === 11 || colNum === 12 || colNum === 14 || colNum === 16 || colNum === 18 || colNum === 19 || colNum === 20) {
        cell.numFmt = NUM_FMT.CURRENCY_PLAIN;
        cell.alignment = { horizontal: "right" };
      }
    });
  });

  const lastDataRow = startDataRow + lines.length - 1;

  if (lines.length > 0) {
    const totalRow = ws.addRow([
      "TOTALS",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      { formula: `SUM(J${startDataRow}:J${lastDataRow})` },
      "",
      { formula: `SUM(L${startDataRow}:L${lastDataRow})` },
      "",
      { formula: `SUM(N${startDataRow}:N${lastDataRow})` },
      "",
      { formula: `SUM(P${startDataRow}:P${lastDataRow})` },
      "",
      { formula: `SUM(R${startDataRow}:R${lastDataRow})` },
      { formula: `SUM(S${startDataRow}:S${lastDataRow})` },
      { formula: `SUM(T${startDataRow}:T${lastDataRow})` },
    ]);

    totalRow.height = 24;
    totalRow.eachCell((cell, colNum) => {
      cell.font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: COLORS.DARK_TEXT } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.TOTAL_BG } };
      setDoubleBottomBorder(cell);

      if (colNum === 10) {
        cell.numFmt = NUM_FMT.QTY;
        cell.alignment = { horizontal: "right" };
      } else if (colNum === 12 || colNum === 14 || colNum === 16 || colNum === 18 || colNum === 19 || colNum === 20) {
        cell.numFmt = NUM_FMT.CURRENCY;
        cell.alignment = { horizontal: "right" };
      }
    });

    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4, column: headers.length },
    };
  }

  autoFitColumns(ws, 12, 45);
}

function buildRichGstPurchaseReturnsSheet(
  ws: ExcelJS.Worksheet,
  from: string,
  to: string,
  lines: GstPurchaseReturnLine[],
): void {
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 4, showGridLines: true }];
  ws.properties.tabColor = { argb: COLORS.ROSE_HEADER };

  // Title header banner
  ws.mergeCells("A1:N1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `PURCHASE RETURNS (DEBIT NOTES) — ${from} to ${to}`;
  titleCell.font = { name: FONT_FAMILY, size: 13, bold: true, color: { argb: COLORS.WHITE } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.SLATE_HEADER } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 30;

  // Informational Notice Subtitle
  ws.mergeCells("A2:N2");
  const subCell = ws.getCell("A2");
  subCell.value = `NOTICE: Purchase returns contain no GST rates; values represent stock book value (WAC) and actual supplier refund amount for reference only.`;
  subCell.font = { name: FONT_FAMILY, size: 9, italic: true, color: { argb: COLORS.MUTED_TEXT } };
  subCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(2).height = 18;

  ws.addRow([]); // empty row 3

  const headers = [
    "Return Date (IST)",
    "Return Reference",
    "Supplier Name",
    "SKU",
    "Product Name",
    "Brand",
    "Flavour",
    "Pack Size",
    "HSN Code",
    "Quantity Returned",
    "Unit WAC (₹)",
    "Line Book Value (₹)",
    "Supplier Refund Amount (₹)",
    "Note / Reason",
  ];

  const headerRow = ws.addRow(headers);
  applyHeaderStyle(headerRow, COLORS.SLATE_HEADER);

  const startDataRow = 5;

  lines.forEach((l, idx) => {
    const isEven = idx % 2 === 0;

    const row = ws.addRow([
      formatIstDateTime(l.confirmedAt),
      l.purchaseReturnId,
      l.supplierName,
      l.sku,
      l.productName,
      l.brandName ?? "",
      l.flavourName ?? "",
      l.packSizeLabel ?? "",
      l.hsnCode ?? "",
      l.quantity,
      num(l.unitWac),
      num(l.lineBookValue),
      num(l.returnRefundAmount),
      l.note ?? "",
    ]);

    row.height = 20;

    row.eachCell((cell, colNum) => {
      setThinBorder(cell, COLORS.BORDER_SOFT);
      cell.font = { name: FONT_FAMILY, size: 9.5, color: { argb: COLORS.DARK_TEXT } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isEven ? COLORS.WHITE : COLORS.ZEBRA_BG },
      };

      if (colNum === 10) {
        cell.numFmt = NUM_FMT.QTY;
        cell.alignment = { horizontal: "right" };
      } else if (colNum === 11 || colNum === 12 || colNum === 13) {
        cell.numFmt = NUM_FMT.CURRENCY_PLAIN;
        cell.alignment = { horizontal: "right" };
      }
    });
  });

  const lastDataRow = startDataRow + lines.length - 1;

  if (lines.length > 0) {
    const totalRow = ws.addRow([
      "TOTALS",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      { formula: `SUM(J${startDataRow}:J${lastDataRow})` },
      "",
      { formula: `SUM(L${startDataRow}:L${lastDataRow})` },
      { formula: `SUM(M${startDataRow}:M${lastDataRow})` },
      "",
    ]);

    totalRow.height = 24;
    totalRow.eachCell((cell, colNum) => {
      cell.font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: COLORS.DARK_TEXT } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.TOTAL_BG } };
      setDoubleBottomBorder(cell);

      if (colNum === 10) {
        cell.numFmt = NUM_FMT.QTY;
        cell.alignment = { horizontal: "right" };
      } else if (colNum === 12 || colNum === 13) {
        cell.numFmt = NUM_FMT.CURRENCY;
        cell.alignment = { horizontal: "right" };
      }
    });

    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4, column: headers.length },
    };
  }

  autoFitColumns(ws, 12, 45);
}

/** Fetch all GST data and export a dedicated, professionally styled 5-sheet workbook for the Chartered Accountant. */
export async function downloadGstReportWorkbook(params: {
  from: string;
  to: string;
}): Promise<void> {
  const { from, to } = params;

  const [summary, salesLines, hsnSummary, purchaseLines, returnLines] = await Promise.all([
    fetchGstSummary({ from, to }),
    fetchAllGstSales(from, to),
    fetchGstHsnSummary({ from, to }),
    fetchAllGstPurchases(from, to),
    fetchAllGstReturns(from, to),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GV Nutrition POS System";
  workbook.lastModifiedBy = "GV Nutrition";
  workbook.created = new Date();
  workbook.modified = new Date();

  // 1. Summary Sheet
  const wsSummary = workbook.addWorksheet("Summary");
  buildRichGstSummarySheet(wsSummary, summary);

  // 2. Sales Register Sheet
  const wsSales = workbook.addWorksheet("Sales Register");
  buildRichGstSalesRegisterSheet(wsSales, from, to, salesLines);

  // 3. Sales HSN Summary Sheet
  const wsHsn = workbook.addWorksheet("Sales HSN Summary");
  buildRichGstHsnSummarySheet(wsHsn, from, to, hsnSummary);

  // 4. Purchase Register Sheet
  const wsPurchases = workbook.addWorksheet("Purchase Register");
  buildRichGstPurchaseRegisterSheet(wsPurchases, from, to, purchaseLines);

  // 5. Purchase Returns Sheet
  const wsReturns = workbook.addWorksheet("Purchase Returns");
  buildRichGstPurchaseReturnsSheet(wsReturns, from, to, returnLines);

  await triggerWorkbookDownload(workbook, `gst_report_${from}_${to}.xlsx`);
}

// ---------------------------------------------------------------------------
// Standard Reports Workbook Export (Enhanced with ExcelJS)
// ---------------------------------------------------------------------------

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

function paymentSummary(row: OrderReportRow): string {
  if (row.payments.length === 0) return "";
  return row.payments.map((p) => `${p.method} ${p.amount}`).join(", ");
}

/** Fetch all standard report tabs and download one richly formatted .xlsx workbook with a sheet per tab. */
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

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GV Nutrition POS System";
  workbook.created = new Date();

  // 1. Sales Sheet
  const wsSales = workbook.addWorksheet("Sales");
  wsSales.properties.tabColor = { argb: COLORS.NAVY_HEADER };
  wsSales.addRow(["Sales Report", `Period: ${from} to ${to} (${granularity})`]);
  wsSales.addRow([]);
  const salesHRow = wsSales.addRow(["Period", "Gross Sales (₹)", "Credit Notes (₹)", "Net Sales (₹)", "Sale Orders", "Credit Notes Count"]);
  applyHeaderStyle(salesHRow, COLORS.NAVY_HEADER);
  for (const b of sales.buckets) {
    const row = wsSales.addRow([bucketLabel(b.periodStart, granularity), b.grossSales, b.creditNotes, b.netSales, b.saleOrderCount, b.creditNoteCount]);
    row.eachCell((cell, cIdx) => {
      setThinBorder(cell);
      if (cIdx >= 2 && cIdx <= 4) {
        cell.numFmt = NUM_FMT.CURRENCY_PLAIN;
        cell.alignment = { horizontal: "right" };
      }
    });
  }
  autoFitColumns(wsSales);

  // 2. Profit Sheet
  const wsProfit = workbook.addWorksheet("Profit");
  wsProfit.properties.tabColor = { argb: COLORS.INDIGO_HEADER };
  wsProfit.addRow(["Profit & Margin Report", `Period: ${from} to ${to}`]);
  wsProfit.addRow([
    "Total Revenue",
    profitSummary.revenue,
    "Total COGS",
    profitSummary.cogs,
    "Gross Profit",
    profitSummary.grossProfit,
    "Margin",
    profitSummary.marginPct,
  ]);
  wsProfit.addRow([]);
  const profitHRow = wsProfit.addRow(["Confirmed At", "Invoice", "SKU", "Product", "Flavour", "Type", "Qty", "Revenue (₹)", "Unit Cost WAC (₹)", "COGS (₹)", "Gross Profit (₹)"]);
  applyHeaderStyle(profitHRow, COLORS.INDIGO_HEADER);
  for (const ln of profitLines) {
    const row = wsProfit.addRow([
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
    row.eachCell((cell, cIdx) => {
      setThinBorder(cell);
      if (cIdx === 7) cell.numFmt = NUM_FMT.QTY;
      if (cIdx >= 8) cell.numFmt = NUM_FMT.CURRENCY_PLAIN;
    });
  }
  autoFitColumns(wsProfit);

  // 3. Inventory Sheet
  const wsInv = workbook.addWorksheet("Inventory");
  wsInv.properties.tabColor = { argb: COLORS.EMERALD_HEADER };
  wsInv.addRow(["Inventory Valuation", `Total Valuation: ₹${inventory.totalValuation.toLocaleString("en-IN")}`]);
  wsInv.addRow([]);
  const invHRow = wsInv.addRow(["SKU", "Product", "Flavour", "Size", "Qty On Hand", "Unit Cost WAC (₹)", "Valuation (₹)"]);
  applyHeaderStyle(invHRow, COLORS.EMERALD_HEADER);
  for (const r of inventory.items) {
    const row = wsInv.addRow([r.sku, r.productName, r.flavourName ?? "", r.packSizeLabel ?? "", r.quantityOnHand, r.unitCostWac ?? "", r.valuation]);
    row.eachCell((cell, cIdx) => {
      setThinBorder(cell);
      if (cIdx === 5) cell.numFmt = NUM_FMT.QTY;
      if (cIdx >= 6) cell.numFmt = NUM_FMT.CURRENCY_PLAIN;
    });
  }
  autoFitColumns(wsInv);

  // 4. Low stock Sheet
  const wsLow = workbook.addWorksheet("Low stock");
  wsLow.addRow(["Low Stock Alerts", `Threshold: ${lowStockThreshold} units`]);
  wsLow.addRow([]);
  const lowHRow = wsLow.addRow(["Product", "Type", "SKU", "Flavour", "Variant", "Quantity", "Status"]);
  applyHeaderStyle(lowHRow, COLORS.SLATE_HEADER);
  for (const r of lowStock) {
    const variantLabel = [r.variant.flavour?.name, r.variant.packSize?.label].filter(Boolean).join(" / ") || "—";
    const row = wsLow.addRow([r.variant.product.name, r.variant.product.kind === "SUPPLEMENT" ? "Supplement" : "Accessory", r.variant.sku, r.variant.flavour?.name ?? "", variantLabel, r.quantity, lowStockStatus(r.quantity, lowStockThreshold)]);
    row.eachCell((cell) => setThinBorder(cell));
  }
  autoFitColumns(wsLow);

  // 5. Fast-moving Sheet
  const wsFast = workbook.addWorksheet("Fast-moving");
  wsFast.addRow(["Fast Moving SKUs", `Period: ${from} to ${to}`]);
  wsFast.addRow([]);
  const fastHRow = wsFast.addRow(["SKU", "Product", "Flavour", "Units Sold", "Revenue (₹)"]);
  applyHeaderStyle(fastHRow, COLORS.TEAL_HEADER);
  for (const r of fastMoving) {
    const row = wsFast.addRow([r.sku, r.productName, r.flavourName ?? "", r.unitsSold, r.revenue]);
    row.eachCell((cell, cIdx) => {
      setThinBorder(cell);
      if (cIdx === 4) cell.numFmt = NUM_FMT.QTY;
      if (cIdx === 5) cell.numFmt = NUM_FMT.CURRENCY_PLAIN;
    });
  }
  autoFitColumns(wsFast);

  // 6. Dead stock Sheet
  const wsDead = workbook.addWorksheet("Dead stock");
  wsDead.addRow(["Dead Stock Analysis", `Stale after: ${deadAfterDays} days`]);
  wsDead.addRow([]);
  const deadHRow = wsDead.addRow(["SKU", "Product", "Flavour", "Qty On Hand", "Last Sale", "Days Since Sale"]);
  applyHeaderStyle(deadHRow, COLORS.SLATE_HEADER);
  for (const r of deadStock) {
    const row = wsDead.addRow([r.sku, r.productName, r.flavourName ?? "", r.quantityOnHand, r.lastSaleAt ? r.lastSaleAt.slice(0, 10) : "Never", r.daysSinceSale ?? ""]);
    row.eachCell((cell) => setThinBorder(cell));
  }
  autoFitColumns(wsDead);

  // 7. Retention Sheet
  const wsRet = workbook.addWorksheet("Retention");
  wsRet.addRow(["Customer Retention", `Period: ${from} to ${to}`]);
  wsRet.addRow([]);
  const retHRow = wsRet.addRow(["Metric", "Value"]);
  applyHeaderStyle(retHRow, COLORS.SLATE_HEADER);
  const retMetrics = [
    ["Customers in period", retention.customersInPeriod],
    ["Repeat purchasers (2+ orders)", retention.repeatCustomersInPeriod],
    ["Repeat rate %", retention.repeatRatePct],
    ["Returning customers", retention.returningCustomers],
    ["Returning rate %", retention.returningRatePct],
    ["New customers", retention.newCustomers],
    ["Note", retention.note],
  ];
  for (const m of retMetrics) {
    const row = wsRet.addRow(m);
    row.eachCell((cell) => setThinBorder(cell));
  }
  autoFitColumns(wsRet);

  // 8. Offers Sheet
  const wsOffers = workbook.addWorksheet("Offers");
  wsOffers.addRow(["Offers & Promotions", `Period: ${from} to ${to}`]);
  wsOffers.addRow([]);
  const offHRow = wsOffers.addRow(["Code", "Name", "Orders", "Revenue (₹)", "Discount Total (₹)"]);
  applyHeaderStyle(offHRow, COLORS.ROSE_HEADER);
  for (const r of offers) {
    const row = wsOffers.addRow([r.code ?? "", r.name, r.orderCount, r.revenue, r.discountTotal]);
    row.eachCell((cell, cIdx) => {
      setThinBorder(cell);
      if (cIdx === 3) cell.numFmt = NUM_FMT.QTY;
      if (cIdx >= 4) cell.numFmt = NUM_FMT.CURRENCY_PLAIN;
    });
  }
  autoFitColumns(wsOffers);

  // 9. Orders Sheet
  const wsOrders = workbook.addWorksheet("Orders");
  wsOrders.addRow(["Orders Register", `Period: ${from} to ${to} (CONFIRMED Sales)`]);
  wsOrders.addRow([]);
  const ordHRow = wsOrders.addRow(["Invoice", "Date", "Customer", "Phone", "Type", "Item Discount (₹)", "Bill Discount (₹)", "Taxable (₹)", "GST (₹)", "Total (₹)", "Payment", "GST Enabled", "Walk-in", "Line Count"]);
  applyHeaderStyle(ordHRow, COLORS.NAVY_HEADER);
  for (const o of orders) {
    const t = o.totals;
    const row = wsOrders.addRow([
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
    row.eachCell((cell, cIdx) => {
      setThinBorder(cell);
      if (cIdx >= 6 && cIdx <= 10 && typeof cell.value === "number") {
        cell.numFmt = NUM_FMT.CURRENCY_PLAIN;
      }
    });
  }
  autoFitColumns(wsOrders);

  await triggerWorkbookDownload(workbook, `reports_${from}_${to}.xlsx`);
}
