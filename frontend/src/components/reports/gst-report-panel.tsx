import { AlertTriangle, Download, Info, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FlavourLabel } from "@/components/catalog/flavour-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
} from "@/lib/gst-report-api";
import { downloadGstReportWorkbook } from "@/lib/reports-export";
import { formatIstDateTime } from "@/lib/ist-time";

const fmtInr = (n: number | string) => {
  const v = typeof n === "string" ? Number(n) : n;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isNaN(v) ? 0 : v);
};

type Props = {
  from: string;
  to: string;
  onDateRangeChange?: (range: { from: string; to: string }) => void;
};

export function GstReportPanel({ from, to, onDateRangeChange }: Props) {
  const [subTab, setSubTab] = useState("sales");
  const [summary, setSummary] = useState<GstSummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);

  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryErr(null);
    try {
      const data = await fetchGstSummary({ from, to });
      setSummary(data);
    } catch (e: unknown) {
      setSummaryErr(e instanceof Error ? e.message : "Failed to load GST summary");
    } finally {
      setSummaryLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const handleDownload = async () => {
    setDownloadBusy(true);
    setDownloadErr(null);
    try {
      await downloadGstReportWorkbook({ from, to });
    } catch (e: unknown) {
      setDownloadErr(e instanceof Error ? e.message : "Failed to export GST workbook");
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Info & Disclaimer */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight">GST Report (for your CA)</h3>
            {summary?.storeGstin ? (
              <Badge variant="outline" className="font-mono text-xs">
                GSTIN: {summary.storeGstin}
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Transaction register and GST breakup for accounting reconciliation and filing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {onDateRangeChange ? (
            <DateRangePicker
              value={{ from, to }}
              onChange={onDateRangeChange}
              align="right"
              showTaxPresets={true}
            />
          ) : null}
          <Button
            type="button"
            className="gap-2"
            disabled={downloadBusy}
            onClick={() => void handleDownload()}
          >
            {downloadBusy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Preparing GST workbook…
              </>
            ) : (
              <>
                <Download className="size-4" />
                Download GST Report (.xlsx)
              </>
            )}
          </Button>
        </div>
      </div>

      {/* CA Disclaimer Banner */}
      <div className="flex items-start gap-3 rounded-lg border border-border/80 bg-muted/40 p-3.5 text-xs text-muted-foreground">
        <Info className="size-4 shrink-0 text-muted-foreground mt-0.5" />
        <div>
          <span className="font-semibold text-foreground">Important notice for accountant:</span> This
          is raw store transaction data exported directly from point-of-sale and purchase records for
          your Chartered Accountant’s reconciliation and filing work. It is not a prepared GST return
          (GSTR-1 / GSTR-3B) or tax advice.
        </div>
      </div>

      {/* Missing HSN Warning */}
      {summary && summary.sales.missingHsnLineCount > 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div>
            <span className="font-semibold">Compliance alert:</span>{" "}
            <span className="font-semibold underline">
              {summary.sales.missingHsnLineCount} sale line item(s)
            </span>{" "}
            in this period are missing an HSN code. You can add HSN codes to your items anytime via the{" "}
            <span className="font-semibold">Catalog</span> page to ensure complete tax reporting.
          </div>
        </div>
      ) : null}

      {downloadErr ? <p className="text-sm text-destructive">{downloadErr}</p> : null}
      {summaryErr ? <p className="text-sm text-destructive">{summaryErr}</p> : null}

      {/* Summary KPI Cards */}
      {summary ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Net Sales Taxable Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold tabular-nums">
                {fmtInr(summary.sales.net.taxableValue)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {summary.sales.salesInvoiceCount} sales · {summary.sales.creditNoteCount} credit notes
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Output GST (Net)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {fmtInr(summary.sales.net.gstTotal)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                CGST {fmtInr(summary.sales.net.cgstAmount)} + SGST {fmtInr(summary.sales.net.sgstAmount)}
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Purchases Taxable Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold tabular-nums">
                {fmtInr(summary.purchases.taxableValue)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {summary.purchases.purchaseOrderCount} POs received ({summary.purchases.purchaseLinesCount} lines)
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Input GST (ITC Basis)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold tabular-nums text-blue-700 dark:text-blue-400">
                {fmtInr(summary.purchases.gstTotal)}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                CGST {fmtInr(summary.purchases.cgstAmount)} + SGST {fmtInr(summary.purchases.sgstAmount)}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : summaryLoading ? (
        <p className="text-sm text-muted-foreground">Loading GST summary…</p>
      ) : null}

      {/* Sub-Tabs for Register & Breakdown */}
      <Tabs value={subTab} onValueChange={setSubTab} className="w-full space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="sales">Sales Register</TabsTrigger>
          <TabsTrigger value="hsn">Sales HSN Summary</TabsTrigger>
          <TabsTrigger value="purchases">Purchase Register</TabsTrigger>
          <TabsTrigger value="returns">Purchase Returns (Info)</TabsTrigger>
        </TabsList>

        <TabsContent value="sales">
          <SalesRegisterTable from={from} to={to} />
        </TabsContent>

        <TabsContent value="hsn">
          <HsnSummaryTable from={from} to={to} />
        </TabsContent>

        <TabsContent value="purchases">
          <PurchaseRegisterTable from={from} to={to} />
        </TabsContent>

        <TabsContent value="returns">
          <PurchaseReturnsTable from={from} to={to} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SalesRegisterTable({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<GstSalesRegisterLine[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const out = await fetchGstSalesRegister({ from, to, page, limit: 20 });
      setRows(out.items);
      setMeta(out.meta);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load sales register");
    } finally {
      setLoading(false);
    }
  }, [from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sales Register</CardTitle>
        <CardDescription>
          Line-wise breakdown of all confirmed sales and credit notes with GST enabled.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {err ? <p className="text-sm text-destructive">{err}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">Loading sales register…</p> : null}

        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Product / Variant</TableHead>
                <TableHead>HSN</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Taxable Val</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
                    No sales transactions in this period.
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.invoiceNumber ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatIstDateTime(r.confirmedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={r.documentType === "CREDIT_NOTE" ? "destructive" : "outline"}
                      className="text-[10px]"
                    >
                      {r.documentType}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[130px] truncate text-xs">
                    {r.customerName}
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-medium">{r.productName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      <FlavourLabel flavour={r.flavourName}>{r.variantLabel}</FlavourLabel> ·{" "}
                      <span className="font-mono">{r.sku}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.hsnCode ? (
                      r.hsnCode
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400 font-sans italic">
                        Missing
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{r.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(r.taxableValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(r.cgstAmount)}
                    <span className="block text-[10px] text-muted-foreground">
                      ({Number(r.cgstRate)}%)
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(r.sgstAmount)}
                    <span className="block text-[10px] text-muted-foreground">
                      ({Number(r.sgstRate)}%)
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(r.igstAmount)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-xs">
                    {fmtInr(r.lineTotal)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Page {meta.page} of {Math.max(1, meta.totalPages)} ({meta.total} lines)
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HsnSummaryTable({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<GstHsnSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void fetchGstHsnSummary({ from, to })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load HSN summary");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sales HSN Summary</CardTitle>
        <CardDescription>
          Grouped summary by HSN Code and GST tax rate (gross sales minus credit notes).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {err ? <p className="text-sm text-destructive">{err}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">Loading HSN summary…</p> : null}

        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>HSN Code</TableHead>
                <TableHead className="text-right">Total Rate</TableHead>
                <TableHead className="text-right">Sales Qty</TableHead>
                <TableHead className="text-right">Return Qty</TableHead>
                <TableHead className="text-right">Net Qty</TableHead>
                <TableHead className="text-right">Gross Taxable</TableHead>
                <TableHead className="text-right">Credit Taxable</TableHead>
                <TableHead className="text-right">Net Taxable</TableHead>
                <TableHead className="text-right">Net CGST</TableHead>
                <TableHead className="text-right">Net SGST</TableHead>
                <TableHead className="text-right">Net GST</TableHead>
                <TableHead className="text-right">Net Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data?.items.length && !loading ? (
                <TableRow>
                  <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
                    No sales lines in this period.
                  </TableCell>
                </TableRow>
              ) : null}
              {data?.items.map((row, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-mono text-xs">
                    {row.hsnCode ? (
                      row.hsnCode
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400 font-sans italic">
                        Unassigned / Blank
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {Number(row.totalTaxRate)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {row.salesQuantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-destructive">
                    {row.creditQuantity > 0 ? `−${row.creditQuantity}` : "0"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-xs">
                    {row.netQuantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(row.salesTaxableValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-destructive">
                    {Number(row.creditTaxableValue) > 0 ? `−${fmtInr(row.creditTaxableValue)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-xs">
                    {fmtInr(row.netTaxableValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(row.netCgst)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(row.netSgst)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-xs text-emerald-700 dark:text-emerald-400">
                    {fmtInr(row.netTotalGst)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-xs">
                    {fmtInr(row.netLineTotal)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {data ? (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs flex flex-wrap justify-between gap-2">
            <span>
              Total Net Taxable:{" "}
              <strong className="text-foreground">{fmtInr(data.totals.netTaxableValue)}</strong>
            </span>
            <span>
              Total Net CGST:{" "}
              <strong className="text-foreground">{fmtInr(data.totals.netCgst)}</strong>
            </span>
            <span>
              Total Net SGST:{" "}
              <strong className="text-foreground">{fmtInr(data.totals.netSgst)}</strong>
            </span>
            <span>
              Total Net GST:{" "}
              <strong className="text-emerald-700 dark:text-emerald-400">
                {fmtInr(data.totals.netTotalGst)}
              </strong>
            </span>
            <span>
              Net Grand Total:{" "}
              <strong className="text-foreground">{fmtInr(data.totals.netGrandTotal)}</strong>
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PurchaseRegisterTable({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<GstPurchaseRegisterLine[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const out = await fetchGstPurchaseRegister({ from, to, page, limit: 20 });
      setRows(out.items);
      setMeta(out.meta);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load purchase register");
    } finally {
      setLoading(false);
    }
  }, [from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Purchase Register</CardTitle>
        <CardDescription>
          Stock actually received during this period (filtered by received date for Input Tax Credit reconciliation).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {err ? <p className="text-sm text-destructive">{err}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">Loading purchase register…</p> : null}

        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Our PO Ref</TableHead>
                <TableHead>Our PO Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Product / Variant</TableHead>
                <TableHead>HSN</TableHead>
                <TableHead className="text-right">Qty Recd</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Taxable Val</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
                    No received purchases in this period.
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.purchaseOrderId.slice(0, 10)}…</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatIstDateTime(r.receivedAt)}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate text-xs font-medium">
                    {r.supplierName}
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-medium">{r.productName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      <FlavourLabel flavour={r.flavourName}>{r.variantLabel}</FlavourLabel> ·{" "}
                      <span className="font-mono">{r.sku}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.hsnCode ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs font-medium">
                    {r.quantityReceived}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(r.unitCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(r.taxableValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(r.cgstAmount)}
                    <span className="block text-[10px] text-muted-foreground">
                      ({Number(r.cgstRate)}%)
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(r.sgstAmount)}
                    <span className="block text-[10px] text-muted-foreground">
                      ({Number(r.sgstRate)}%)
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(r.igstAmount)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-xs">
                    {fmtInr(r.lineTotal)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Page {meta.page} of {Math.max(1, meta.totalPages)} ({meta.total} lines)
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PurchaseReturnsTable({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<GstPurchaseReturnLine[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const out = await fetchGstPurchaseReturns({ from, to, page, limit: 20 });
      setRows(out.items);
      setMeta(out.meta);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load purchase returns");
    } finally {
      setLoading(false);
    }
  }, [from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Purchase Returns (Debit Notes)</CardTitle>
        <CardDescription>
          Informational section for reference. No GST tax rate is stored on purchase return lines in the
          system.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-muted-foreground/30 bg-muted/30 p-2.5 text-xs text-muted-foreground">
          <strong>Note for accountant:</strong> Purchase return line items track quantity returned, unit WAC
          basis, and supplier refund amount. Stored tax rates are not recorded on return documents.
        </div>

        {err ? <p className="text-sm text-destructive">{err}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">Loading purchase returns…</p> : null}

        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Return Ref</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Product / SKU</TableHead>
                <TableHead className="text-right">Qty Returned</TableHead>
                <TableHead className="text-right">Unit WAC</TableHead>
                <TableHead className="text-right">Line Book Value</TableHead>
                <TableHead className="text-right">Doc Refund Amount</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    No confirmed purchase returns in this period.
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatIstDateTime(r.confirmedAt)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.purchaseReturnId.slice(0, 10)}…</TableCell>
                  <TableCell className="text-xs font-medium">{r.supplierName}</TableCell>
                  <TableCell>
                    <div className="text-xs font-medium">{r.productName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      <FlavourLabel flavour={r.flavourName}>{r.variantLabel}</FlavourLabel> ·{" "}
                      <span className="font-mono">{r.sku}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs font-medium">
                    {r.quantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(r.unitWac)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {fmtInr(r.lineBookValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs font-semibold">
                    {fmtInr(r.returnRefundAmount)}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                    {r.note ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Page {meta.page} of {Math.max(1, meta.totalPages)} ({meta.total} lines)
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
