import PDFDocument from "pdfkit";
import { getStoreConfig } from "../../../config/store-config.js";
import type { InvoiceDocument } from "./invoice-document.types.js";

const PAGE_W = 595.28;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;

const COLORS = {
  ink: "#111827",
  muted: "#6b7280",
  line: "#e5e7eb",
  accent: "#1e3a5f",
  headerBg: "#f8fafc",
};

/**
 * Indian amount for PDF — Helvetica lacks the ₹ glyph (U+20B9), which renders as a broken "¹".
 * Use "Rs." prefix + en-IN grouping; matches ledger numbers exactly.
 */
function inr(amount: string | number): string {
  const n = typeof amount === "number" ? amount : Number(amount) || 0;
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return `Rs. ${formatted}`;
}

function num(amount: string): number {
  return Number(amount) || 0;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

function paymentLabel(doc: InvoiceDocument): string {
  if (doc.payments.length === 0) return "—";
  return doc.payments.map((p) => `${p.method} ${inr(p.amount)}`).join(", ");
}

function documentTitle(doc: InvoiceDocument): string {
  if (doc.documentType === "CREDIT_NOTE") return "CREDIT NOTE";
  return "TAX INVOICE";
}

/** Renders invoice PDF into memory — never persisted. */
export function generateInvoicePdfBuffer(doc: InvoiceDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    try {
      renderInvoice(pdf, doc);
      pdf.end();
    } catch (e) {
      reject(e);
    }
  });
}

function renderInvoice(pdf: InstanceType<typeof PDFDocument>, doc: InvoiceDocument): void {
  const store = getStoreConfig();
  let y = MARGIN;

  // —— Header ——
  let logoRendered = false;
  if (store.logoPath) {
    try {
      pdf.image(store.logoPath, MARGIN, y, { width: 120, height: 56, fit: [120, 56] });
      logoRendered = true;
    } catch {
      /* optional logo */
    }
  }

  const headerX = logoRendered ? MARGIN + 132 : MARGIN;
  let hy = y;
  if (!logoRendered) {
    pdf
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor(COLORS.accent)
      .text(store.name, headerX, hy, { width: CONTENT_W - (headerX - MARGIN) });
    hy += 20;
  }

  pdf.font("Helvetica").fontSize(9).fillColor(COLORS.muted);
  if (store.address) {
    pdf.text(store.address, headerX, hy, { width: CONTENT_W - (headerX - MARGIN) });
    hy += 12;
  }
  const contact: string[] = [];
  if (store.phone) contact.push(`Ph: ${store.phone}`);
  if (store.email) contact.push(store.email);
  if (contact.length) {
    pdf.text(contact.join("  ·  "), headerX, hy);
    hy += 12;
  }
  if (store.gstin) {
    pdf.text(`GSTIN: ${store.gstin}`, headerX, hy);
    hy += 12;
  }

  y = Math.max(y + 58, hy + 4);

  pdf
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLORS.ink)
    .text(documentTitle(doc), MARGIN, y, { width: CONTENT_W, align: "right" });

  y += 22;
  pdf.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor(COLORS.line).lineWidth(1).stroke();
  y += 14;

  // —— Meta row ——
  const colW = CONTENT_W / 2;
  pdf.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.muted).text("BILL TO", MARGIN, y);
  pdf.text("INVOICE DETAILS", MARGIN + colW, y);
  y += 12;

  pdf.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink);
  const customerName = doc.isWalkIn
    ? "Walk-in customer"
    : (doc.customer?.fullName ?? "—");
  pdf.text(customerName, MARGIN, y, { width: colW - 8 });
  pdf.text(doc.invoiceNumber ?? "—", MARGIN + colW, y);

  y += 14;
  pdf.font("Helvetica").fontSize(9).fillColor(COLORS.muted);
  pdf.text(doc.customer?.phone ? `Phone: ${doc.customer.phone}` : "—", MARGIN, y, { width: colW - 8 });
  pdf.text(`Date: ${formatDate(doc.confirmedAt ?? doc.createdAt)}`, MARGIN + colW, y);

  y += 12;
  pdf.text(`Payment: ${paymentLabel(doc)}`, MARGIN + colW, y);
  if (doc.staff?.name || doc.staff?.email) {
    y += 12;
    pdf.text(
      `Cashier: ${doc.staff.name ?? doc.staff.email}`,
      MARGIN + colW,
      y,
    );
  }

  y += 20;

  // —— Items table ——
  // HSN sits between Variant and Qty. Product/Variant give up a little width for it;
  // rows with no HSN print an em dash, so a blank code costs nothing.
  const cols = {
    product: 104,
    variant: 62,
    hsn: 42,
    qty: 26,
    rate: 50,
    disc: 46,
    gst: 50,
    total: 56,
  };
  const tableW =
    cols.product + cols.variant + cols.hsn + cols.qty + cols.rate + cols.disc + cols.gst + cols.total;

  const drawTableHeader = (startY: number): number => {
    pdf.rect(MARGIN, startY, tableW, 18).fill(COLORS.headerBg);
    let x = MARGIN + 4;
    pdf.font("Helvetica-Bold").fontSize(7).fillColor(COLORS.ink);
    const headers = [
      ["Product", cols.product],
      ["Variant", cols.variant],
      ["HSN", cols.hsn],
      ["Qty", cols.qty],
      ["Rate", cols.rate],
      ["Disc.", cols.disc],
      ["GST", cols.gst],
      ["Total", cols.total],
    ] as const;
    for (const [label, w] of headers) {
      const align = label === "Qty" || label === "Rate" || label === "Disc." || label === "GST" || label === "Total"
        ? "right"
        : "left";
      pdf.text(label, x, startY + 5, { width: w - 6, align });
      x += w;
    }
    return startY + 18;
  };

  y = drawTableHeader(y);

  pdf.font("Helvetica").fontSize(7.5).fillColor(COLORS.ink);

  for (const line of doc.lines) {
    if (y > 720) {
      pdf.addPage();
      y = MARGIN;
      y = drawTableHeader(y);
      pdf.font("Helvetica").fontSize(7.5).fillColor(COLORS.ink);
    }

    const rowH = 22;
    pdf.moveTo(MARGIN, y + rowH).lineTo(MARGIN + tableW, y + rowH).strokeColor(COLORS.line).lineWidth(0.5).stroke();

    let x = MARGIN + 4;
    const gstAmt = line.gstAmount;
    const discAmt = num(line.itemDiscountAmount) + num(line.cartDiscountAllocated);

    const productLabel = line.isGiveaway
      ? `${line.productName} (FREE)`
      : line.productName;

    const cells: [string, number, "left" | "right"][] = [
      [productLabel, cols.product, "left"],
      [line.variantLabel, cols.variant, "left"],
      [line.hsnCode || "—", cols.hsn, "left"],
      [String(line.quantity), cols.qty, "right"],
      [inr(line.unitPrice), cols.rate, "right"],
      [discAmt > 0 ? `-${inr(discAmt)}` : "—", cols.disc, "right"],
      [doc.gstEnabled ? inr(gstAmt) : "—", cols.gst, "right"],
      [inr(line.lineTotal), cols.total, "right"],
    ];

    for (const [text, w, align] of cells) {
      pdf.text(text, x, y + 6, { width: w - 6, align, ellipsis: true });
      x += w;
    }
    y += rowH;
  }

  y += 12;

  // —— Summary ——
  const summaryX = PAGE_W - MARGIN - 220;
  const summaryW = 220;
  const t = doc.totals;

  const summaryRows: [string, string][] = [
    ["Subtotal", inr(t.subtotal)],
  ];
  if (num(t.itemDiscountTotal) > 0) {
    summaryRows.push(["Item discounts", `-${inr(t.itemDiscountTotal)}`]);
  }
  if (num(t.cartDiscountAmount) > 0) {
    summaryRows.push(["Bill discount", `-${inr(t.cartDiscountAmount)}`]);
  }
  if (num(t.discountTotal) > 0 && summaryRows.length === 1) {
    summaryRows.push(["Total discounts", `-${inr(t.discountTotal)}`]);
  }
  summaryRows.push(["Taxable amount", inr(t.taxableValue)]);

  if (doc.gstEnabled) {
    if (num(t.cgstTotal) > 0) summaryRows.push(["CGST", inr(t.cgstTotal)]);
    if (num(t.sgstTotal) > 0) summaryRows.push(["SGST", inr(t.sgstTotal)]);
    if (num(t.igstTotal) > 0) summaryRows.push(["IGST", inr(t.igstTotal)]);
    if (num(t.cessTotal) > 0) summaryRows.push(["Cess", inr(t.cessTotal)]);
    summaryRows.push(["GST total", inr(t.gstTotal)]);
  }

  if (num(t.roundingAdjustment) !== 0) {
    summaryRows.push(["Rounding", inr(t.roundingAdjustment)]);
  }

  pdf.font("Helvetica").fontSize(9).fillColor(COLORS.ink);
  for (const [label, value] of summaryRows) {
    pdf.text(label, summaryX, y, { width: summaryW * 0.55 });
    pdf.text(value, summaryX, y, { width: summaryW, align: "right" });
    y += 14;
  }

  y += 4;
  pdf.moveTo(summaryX, y).lineTo(summaryX + summaryW, y).strokeColor(COLORS.accent).lineWidth(1).stroke();
  y += 10;
  pdf.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.accent);
  pdf.text("Grand total", summaryX, y, { width: summaryW * 0.55 });
  pdf.text(inr(t.grandTotal), summaryX, y, { width: summaryW, align: "right" });
  y += 28;

  // —— Footer ——
  if (y > 760) {
    pdf.addPage();
    y = MARGIN;
  }

  pdf.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor(COLORS.line).lineWidth(0.5).stroke();
  y += 12;

  pdf.font("Helvetica").fontSize(8).fillColor(COLORS.muted);
  pdf.text(store.thankYouNote, MARGIN, y, { width: CONTENT_W, align: "center" });
  y += 14;
  pdf.text(store.returnPolicy, MARGIN, y, { width: CONTENT_W, align: "center" });
  y += 16;
  pdf
    .fontSize(7)
    .fillColor("#9ca3af")
    .text(
      "This is a computer-generated invoice from stored sale data. Amounts match the order ledger.",
      MARGIN,
      y,
      { width: CONTENT_W, align: "center" },
    );

  // Page numbers must sit *inside* the bottom margin — writing below it triggers a blank extra page.
  const pageRange = pdf.bufferedPageRange();
  const pageLabelY = pdf.page.height - MARGIN - 14;
  for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
    pdf.switchToPage(i);
    pdf
      .font("Helvetica")
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(
        `Page ${i - pageRange.start + 1} of ${pageRange.count}`,
        MARGIN,
        pageLabelY,
        { width: CONTENT_W, align: "center", lineBreak: false },
      );
  }
}
