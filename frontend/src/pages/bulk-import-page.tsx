import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  Upload,
  FileSpreadsheet,
  RotateCcw,
  Package,
  ArrowRight,
  ChevronRight,
  History,
  Undo2,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getStoredAccessToken, apiPostJsonAuthed, apiGetJsonAuthed } from "@/lib/api-client";

// ── Types ──────────────────────────────────────────────────────────────────

type RawRow = {
  sr_no: number;
  product_name: string;
  sku: string;
  kind: string;
  brand: string;
  flavour: string;
  pack_size: string;
  quantity: number;
  cost_price: number;
  list_price: number;
  cgst_pct: number;
  sgst_pct: number;
  igst_pct: number;
  low_stock_threshold: number | null;
  supplier_name: string;
  gst_inclusive: boolean;
  hsn_code: string;
};

type ScanRowResult = {
  rowNum: number;
  raw: RawRow;
  status: "green" | "amber" | "red";
  action: "receive_only" | "create_variant" | "create_product_and_variant";
  errors: string[];
  warnings: string[];
  variantId?: string;
  productId?: string;
  productMatch?: { id: string; name: string; similarity: number };
  supplierId?: string;
  brandId?: string;
  brandIsNew?: boolean;
  flavourId?: string;
  flavourIsNew?: boolean;
  packSizeId?: string;
  packSizeIsNew?: boolean;
};

type ScanResult = {
  totalRows: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  rows: ScanRowResult[];
};

type CommitRow = {
  rowNum: number;
  action: "receive_only" | "create_variant" | "create_product_and_variant";
  variantId?: string;
  productId?: string;
  raw: RawRow;
  supplierId: string;
  flavourId?: string;
  flavourIsNew?: boolean;
  packSizeId?: string;
  packSizeIsNew?: boolean;
};

// Step 1 — catalog only (no stock yet).
type CatalogResult = {
  batchId: string;
  rowsImported: number;
  newFlavoursCreated: number;
  newPackSizesCreated: number;
  newBrandsCreated: number;
  newProductsCreated: number;
  newVariantsCreated: number;
};

// Step 2 — stock received against the catalog batch.
type StockResult = {
  batchId: string;
  purchaseOrderIds: string[];
  rowsImported: number;
  unitsReceived: number;
};

type BatchListItem = {
  id: string;
  status: "AWAITING_STOCK" | "COMPLETED" | "ROLLED_BACK";
  rowsImported: number;
  poCount: number;
  createdAt: string;
  rolledBackAt: string | null;
};

type RollbackResult = {
  batchId: string;
  posReverted: number;
  unitsReturned: number;
};

type PageTab = "import" | "history";
type ImportState =
  | "idle"
  | "scanning"
  | "preview"
  | "creating-catalog"
  | "catalog-ready"
  | "receiving-stock"
  | "done";
type FilterTab = "all" | "green" | "amber" | "red";

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// ── Main component ───────────────────────────────────────────────────────────

export function BulkImportPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<PageTab>("import");

  // Import flow state
  const [importState, setImportState] = useState<ImportState>("idle");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [catalogResult, setCatalogResult] = useState<CatalogResult | null>(null);
  const [importResult, setImportResult] = useState<StockResult | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // History state
  const [batches, setBatches] = useState<BatchListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Rollback state
  const [rollbackTarget, setRollbackTarget] = useState<BatchListItem | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  // ── Load history ──────────────────────────────────────────────────────────

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await apiGetJsonAuthed<BatchListItem[]>("/api/v1/bulk-import/batches");
      setBatches(data);
    } catch {
      toast.error("Failed to load import history");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  // ── Import handlers ───────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("Only .xlsx files are supported");
      return;
    }

    setImportState("scanning");
    setScanResult(null);

    try {
      const token = getStoredAccessToken();
      const formData = new FormData();
      formData.append("file", file);

      const base = import.meta.env.VITE_API_URL ?? "";
      const res = await fetch(`${base}/api/v1/bulk-import/scan`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (body as { error?: { message?: string } } | null)?.error?.message ??
            `Scan failed (${res.status})`,
        );
      }

      const { data } = (await res.json()) as { data: ScanResult };
      setScanResult(data);
      setImportState("preview");
      setFilterTab("all");

      if (data.redCount > 0) {
        toast.warning(
          `${data.redCount} row${data.redCount > 1 ? "s have" : " has"} errors — fix the sheet and re-upload.`,
        );
      } else if (data.amberCount > 0) {
        toast.info(
          `${data.amberCount} new item${data.amberCount > 1 ? "s" : ""} will be created. Review before importing.`,
        );
      } else {
        toast.success(`All ${data.totalRows} rows matched existing variants.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed");
      setImportState("idle");
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  // Build the commit payload from the (non-red) scan rows.
  const buildRows = useCallback((): CommitRow[] => {
    if (!scanResult) return [];
    return scanResult.rows
      .filter((r) => r.status !== "red")
      .map((r) => ({
        rowNum: r.rowNum,
        action: r.action,
        variantId: r.variantId,
        productId: r.productId,
        raw: r.raw,
        supplierId: r.supplierId!,
        // Brand MUST be forwarded. Without it the server creates no brands and
        // every variant lands brandless — which then breaks the stock step,
        // because rows are matched on product + brand + flavour + pack size.
        brandId: r.brandId,
        brandIsNew: r.brandIsNew,
        flavourId: r.flavourId,
        flavourIsNew: r.flavourIsNew,
        packSizeId: r.packSizeId,
        packSizeIsNew: r.packSizeIsNew,
      }));
  }, [scanResult]);

  // STEP 1 — create catalog only (products + variants). No stock yet.
  const handleCreateCatalog = useCallback(async () => {
    if (!scanResult || scanResult.redCount > 0) return;
    setImportState("creating-catalog");
    try {
      const result = await apiPostJsonAuthed<CatalogResult>("/api/v1/bulk-import/commit-catalog", {
        rows: buildRows(),
      });
      setCatalogResult(result);
      setImportState("catalog-ready");
      toast.success(
        `Catalog ready — ${result.newProductsCreated} new product(s), ${result.newVariantsCreated} new variant(s)`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Catalog creation failed");
      setImportState("preview");
    }
  }, [scanResult, buildRows]);

  // STEP 2 — receive stock against the catalog batch (after confirmation).
  const handleReceiveStock = useCallback(async () => {
    if (!catalogResult) return;
    setImportState("receiving-stock");
    try {
      const result = await apiPostJsonAuthed<StockResult>("/api/v1/bulk-import/commit-stock", {
        batchId: catalogResult.batchId,
        rows: buildRows(),
      });
      setImportResult(result);
      setImportState("done");
      toast.success(`Stock received — ${result.unitsReceived} unit(s) added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Receiving stock failed");
      setImportState("catalog-ready");
    }
  }, [catalogResult, buildRows]);

  const handleReset = () => {
    setImportState("idle");
    setScanResult(null);
    setCatalogResult(null);
    setImportResult(null);
    setFilterTab("all");
    if (inputRef.current) inputRef.current.value = "";
  };

  // Flip every row of a product between "add variant to matched product" and
  // "create a brand-new product". Used when the fuzzy matcher picks the wrong
  // existing product (e.g. "Whey Protein Chocolate" -> "Whey Protein Vanilla").
  const overrideToNewProduct = useCallback((productName: string, makeNew: boolean) => {
    setScanResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((r) => {
          if (r.raw.product_name !== productName || !r.productMatch) return r;
          return makeNew
            ? { ...r, action: "create_product_and_variant", productId: undefined }
            : { ...r, action: "create_variant", productId: r.productMatch.id };
        }),
      };
    });
  }, []);

  // How many rows share each product name that had a fuzzy match (for the
  // "Create as new product (N rows)" button label).
  const matchedSiblings = useMemo(() => {
    const m = new Map<string, number>();
    if (scanResult) {
      for (const r of scanResult.rows) {
        if (r.productMatch) m.set(r.raw.product_name, (m.get(r.raw.product_name) ?? 0) + 1);
      }
    }
    return m;
  }, [scanResult]);

  // ── Rollback handlers ─────────────────────────────────────────────────────

  const openRollback = (batch: BatchListItem) => {
    setRollbackTarget(batch);
    setRollbackError(null);
  };

  const closeRollback = () => {
    if (rollbackLoading) return;
    setRollbackTarget(null);
    setRollbackError(null);
  };

  const confirmRollback = async () => {
    if (!rollbackTarget) return;
    setRollbackLoading(true);
    setRollbackError(null);
    try {
      const result = await apiPostJsonAuthed<RollbackResult>(
        `/api/v1/bulk-import/batches/${rollbackTarget.id}/rollback`,
        {},
      );
      toast.success(
        `Rolled back — ${result.posReverted} PO${result.posReverted !== 1 ? "s" : ""} cancelled, ${result.unitsReturned} units returned`,
      );
      setRollbackTarget(null);
      // Refresh history
      await loadHistory();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Rollback failed";
      setRollbackError(msg);
    } finally {
      setRollbackLoading(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    if (!scanResult) return [];
    if (filterTab === "all") return scanResult.rows;
    return scanResult.rows.filter((r) => r.status === filterTab);
  }, [scanResult, filterTab]);

  const canImport = scanResult ? scanResult.redCount === 0 : false;
  const importCount = scanResult ? scanResult.totalRows - scanResult.redCount : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bulk Import</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload an Excel sheet to scan and preview, then create the catalog and receive stock in two safe steps.
          </p>
        </div>
        {(importState === "preview" || importState === "catalog-ready" || importState === "done") &&
          tab === "import" && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="size-3.5" />
              Start over
            </Button>
          )}
      </div>

      {/* Page tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        <button
          onClick={() => setTab("import")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            tab === "import" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Upload className="size-3.5" />
          New Import
        </button>
        <button
          onClick={() => setTab("history")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            tab === "history" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <History className="size-3.5" />
          History
        </button>
      </div>

      {/* ══ IMPORT TAB ══ */}
      {tab === "import" && (
        <>
          {/* Steps indicator */}
          <div className="flex items-center gap-2 text-sm">
            {(["Upload", "Preview", "Import"] as const).map((label, idx) => {
              const inImport =
                importState === "creating-catalog" ||
                importState === "catalog-ready" ||
                importState === "receiving-stock";
              const stepState =
                idx === 0
                  ? importState === "idle" || importState === "scanning"
                    ? "active"
                    : "done"
                  : idx === 1
                    ? importState === "preview"
                      ? "active"
                      : inImport || importState === "done"
                        ? "done"
                        : "pending"
                    : inImport
                      ? "active"
                      : importState === "done"
                        ? "done"
                        : "pending";
              return (
                <div key={label} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                      stepState === "done" && "bg-emerald-500 text-white",
                      stepState === "active" && "bg-primary text-primary-foreground",
                      stepState === "pending" && "bg-muted text-muted-foreground",
                    )}
                  >
                    {stepState === "done" ? "✓" : idx + 1}
                  </span>
                  <span className={cn("font-medium", stepState === "pending" && "text-muted-foreground")}>
                    {label}
                  </span>
                  {idx < 2 && <ChevronRight className="size-4 text-muted-foreground" />}
                </div>
              );
            })}
          </div>

          {/* ── IDLE / SCANNING ── */}
          {(importState === "idle" || importState === "scanning") && (
            <div
              className={cn(
                "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-20 transition-colors",
                isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/20",
                importState === "scanning" && "pointer-events-none opacity-60",
              )}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => importState === "idle" && inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              {importState === "scanning" ? (
                <>
                  <div className="size-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  <p className="mt-4 font-medium">Scanning your file…</p>
                  <p className="text-sm text-muted-foreground">Matching SKUs, products, and suppliers</p>
                </>
              ) : (
                <>
                  <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
                    <FileSpreadsheet className="size-8 text-primary" />
                  </div>
                  <p className="mt-4 text-lg font-semibold">Drop your Excel file here</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    or{" "}
                    <span className="cursor-pointer font-medium text-primary underline underline-offset-2">
                      click to browse
                    </span>
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    .xlsx only · max 500 rows · 18-column format required
                  </p>
                </>
              )}
            </div>
          )}

          {/* ── PREVIEW ── */}
          {importState === "preview" && scanResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryCard label="Total rows" value={scanResult.totalRows} color="neutral" />
                <SummaryCard label="Matched" value={scanResult.greenCount} color="green" icon="✓" />
                <SummaryCard label="New items" value={scanResult.amberCount} color="amber" icon="⚠" />
                <SummaryCard label="Errors" value={scanResult.redCount} color="red" icon="✗" />
              </div>

              {scanResult.redCount > 0 && (
                <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <XCircle className="size-4 shrink-0" />
                  <span>
                    Fix {scanResult.redCount} error{scanResult.redCount > 1 ? "s" : ""} in your sheet and re-upload before importing.
                  </span>
                </div>
              )}

              <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
                {(
                  [
                    { key: "all", label: `All (${scanResult.totalRows})` },
                    { key: "green", label: `✓ Matched (${scanResult.greenCount})` },
                    { key: "amber", label: `⚠ New (${scanResult.amberCount})` },
                    { key: "red", label: `✗ Errors (${scanResult.redCount})` },
                  ] as { key: FilterTab; label: string }[]
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setFilterTab(key)}
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      filterTab === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="overflow-hidden rounded-lg border">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2.5 text-left">#</th>
                        <th className="px-3 py-2.5 text-left">SKU</th>
                        <th className="px-3 py-2.5 text-left">Product</th>
                        <th className="px-3 py-2.5 text-left">Color</th>
                        <th className="px-3 py-2.5 text-left">Size</th>
                        <th className="px-3 py-2.5 text-right">Qty</th>
                        <th className="px-3 py-2.5 text-right">Cost</th>
                        <th className="px-3 py-2.5 text-right">List</th>
                        <th className="px-3 py-2.5 text-left">Status / Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredRows.map((row) => (
                        <tr
                          key={row.rowNum}
                          className={cn(
                            "transition-colors",
                            row.status === "green" && "bg-emerald-50/50 hover:bg-emerald-50",
                            row.status === "amber" && "bg-amber-50/50 hover:bg-amber-50",
                            row.status === "red" && "bg-red-50/50 hover:bg-red-50",
                          )}
                        >
                          <td className="px-3 py-2.5 text-muted-foreground">{row.rowNum}</td>
                          <td className="px-3 py-2.5 font-mono text-xs">{row.raw.sku}</td>
                          <td className="max-w-[200px] truncate px-3 py-2.5">{row.raw.product_name}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {row.raw.flavour || <span className="text-muted-foreground/50">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {row.raw.pack_size || <span className="text-muted-foreground/50">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{row.raw.quantity}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                            {fmtINR(row.raw.cost_price)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{fmtINR(row.raw.list_price)}</td>
                          <td className="px-3 py-2.5">
                            <RowStatus
                              row={row}
                              onOverride={overrideToNewProduct}
                              siblingCount={matchedSiblings.get(row.raw.product_name) ?? 1}
                            />
                          </td>
                        </tr>
                      ))}
                      {filteredRows.length === 0 && (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-muted-foreground">
                            No rows in this category
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-muted-foreground">
                  {canImport
                    ? `Step 1 of 2 — creates products & variants for ${importCount} row${importCount !== 1 ? "s" : ""}. No stock yet.`
                    : "Resolve all errors before importing"}
                </p>
                <Button onClick={handleCreateCatalog} disabled={!canImport} className="gap-2">
                  <Package className="size-4" />
                  Create catalog
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ── STEP 1 RUNNING: creating catalog ── */}
          {importState === "creating-catalog" && (
            <div className="flex flex-col items-center justify-center py-28 gap-5">
              <div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <div className="text-center">
                <p className="font-semibold text-lg">Creating catalog…</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Creating products & variants. No stock is being received yet. Do not close this page.
                </p>
              </div>
            </div>
          )}

          {/* ── CATALOG READY: confirm before receiving stock ── */}
          {importState === "catalog-ready" && catalogResult && (
            <div className="space-y-6">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
                <div className="flex items-start gap-4">
                  <CheckCircle2 className="size-8 shrink-0 text-emerald-600 mt-0.5" />
                  <div>
                    <p className="text-lg font-semibold text-emerald-900">Catalog created — step 1 of 2 done</p>
                    <p className="mt-1 text-sm text-emerald-700">
                      All products & variants now exist. Nothing has been added to stock yet — review below,
                      then confirm to receive stock.
                    </p>
                    <p className="mt-1 text-xs text-emerald-600 font-mono">
                      Batch ID: {catalogResult.batchId}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="New products" value={catalogResult.newProductsCreated} />
                <StatCard label="New variants" value={catalogResult.newVariantsCreated} />
                <StatCard
                  label="New brands / flavours / pack sizes"
                  value={`${catalogResult.newBrandsCreated} / ${catalogResult.newFlavoursCreated} / ${catalogResult.newPackSizesCreated}`}
                />
                <StatCard label="Rows ready to stock" value={catalogResult.rowsImported} />
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex items-start gap-3">
                  <AlertCircle className="size-5 shrink-0 text-amber-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-900">
                      Step 2 — receive stock for {catalogResult.rowsImported} row
                      {catalogResult.rowsImported !== 1 ? "s" : ""}?
                    </p>
                    <p className="mt-1 text-sm text-amber-700">
                      This creates purchase orders and adds inventory. Only do this once you've confirmed the
                      catalog above is correct.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button onClick={handleReceiveStock} className="gap-2">
                        <Upload className="size-4" />
                        Receive stock now
                        <ArrowRight className="size-4" />
                      </Button>
                      <Button variant="outline" onClick={() => navigate("/dashboard/catalog")}>
                        Review catalog first
                      </Button>
                      <Button variant="ghost" onClick={handleReset}>
                        Not now
                      </Button>
                    </div>
                    <p className="mt-3 text-xs text-amber-600">
                      You can also receive this stock later from the History tab.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2 RUNNING: receiving stock ── */}
          {importState === "receiving-stock" && (
            <div className="flex flex-col items-center justify-center py-28 gap-5">
              <div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <div className="text-center">
                <p className="font-semibold text-lg">Receiving stock…</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Creating purchase orders and adding inventory. Do not close this page.
                </p>
              </div>
            </div>
          )}

          {/* ── DONE ── */}
          {importState === "done" && importResult && (
            <div className="space-y-6">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
                <div className="flex items-start gap-4">
                  <CheckCircle2 className="size-8 shrink-0 text-emerald-600 mt-0.5" />
                  <div>
                    <p className="text-lg font-semibold text-emerald-900">Import complete — stock received!</p>
                    <p className="mt-1 text-sm text-emerald-700">
                      {importResult.unitsReceived} unit{importResult.unitsReceived !== 1 ? "s" : ""} across{" "}
                      {importResult.rowsImported} row{importResult.rowsImported !== 1 ? "s" : ""} received into
                      stock via {importResult.purchaseOrderIds.length} purchase
                      order{importResult.purchaseOrderIds.length !== 1 ? "s" : ""}.
                    </p>
                    <p className="mt-1 text-xs text-emerald-600 font-mono">
                      Batch ID: {importResult.batchId}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Units received" value={importResult.unitsReceived} />
                <StatCard label="New products" value={catalogResult?.newProductsCreated ?? 0} />
                <StatCard label="New variants" value={catalogResult?.newVariantsCreated ?? 0} />
                <StatCard
                  label="New brands / flavours / pack sizes"
                  value={`${catalogResult?.newBrandsCreated ?? 0} / ${catalogResult?.newFlavoursCreated ?? 0} / ${catalogResult?.newPackSizesCreated ?? 0}`}
                />
              </div>

              <div className="rounded-lg border p-4">
                <p className="mb-3 text-sm font-semibold">Purchase orders created</p>
                <div className="flex flex-wrap gap-2">
                  {importResult.purchaseOrderIds.map((id) => (
                    <span key={id} className="rounded-md border bg-muted px-2 py-1 font-mono text-xs" title={id}>
                      {id.slice(-12)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => navigate("/dashboard/purchases")} className="gap-2">
                  <Package className="size-4" />
                  View purchase orders
                </Button>
                <Button variant="outline" onClick={() => navigate("/dashboard/inventory")}>
                  View live stock
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setTab("history"); }}
                  className="gap-2"
                >
                  <History className="size-4" />
                  View import history
                </Button>
                <Button variant="ghost" onClick={handleReset}>
                  Import another file
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══ HISTORY TAB ══ */}
      {tab === "history" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Last 50 import batches. Rollback reverses all inventory movements from that import — blocked if any items were sold.
            </p>
            <Button variant="outline" size="sm" onClick={loadHistory} disabled={historyLoading}>
              <RotateCcw className={cn("size-3.5", historyLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>

          {historyLoading && batches.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : batches.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-20 text-center">
              <Clock className="size-10 text-muted-foreground/40" />
              <p className="mt-3 font-medium text-muted-foreground">No imports yet</p>
              <p className="text-sm text-muted-foreground">Your import history will appear here after the first bulk import.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-right">Rows</th>
                    <th className="px-4 py-3 text-right">POs</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Batch ID</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {batches.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-sm">{fmtDate(b.createdAt)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{b.rowsImported}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{b.poCount}</td>
                      <td className="px-4 py-3">
                        {b.status === "COMPLETED" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="size-3" />
                            Active
                          </span>
                        ) : b.status === "AWAITING_STOCK" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                            <Clock className="size-3" />
                            Catalog only — no stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                            <Undo2 className="size-3" />
                            Rolled back {b.rolledBackAt ? fmtDate(b.rolledBackAt) : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{b.id.slice(-12)}</td>
                      <td className="px-4 py-3 text-right">
                        {b.status === "COMPLETED" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openRollback(b)}
                            className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                          >
                            <Undo2 className="size-3.5" />
                            Rollback
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Rollback confirmation dialog ── */}
      {rollbackTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-xl mx-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                <Undo2 className="size-5 text-red-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Rollback stock from this import?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  This will reverse all inventory movements from batch{" "}
                  <span className="font-mono text-xs">{rollbackTarget.id.slice(-12)}</span> (
                  {rollbackTarget.rowsImported} rows, {rollbackTarget.poCount} PO
                  {rollbackTarget.poCount !== 1 ? "s" : ""}).
                </p>
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                    Stock quantities will be reversed to pre-import levels
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                    Purchase orders will be marked Cancelled
                  </li>
                  <li className="flex items-center gap-1.5">
                    <AlertCircle className="size-3.5 text-amber-500 shrink-0" />
                    Products and variants created by this import are NOT deleted
                  </li>
                  <li className="flex items-center gap-1.5">
                    <XCircle className="size-3.5 text-red-500 shrink-0" />
                    Blocked if any items from this import have been sold
                  </li>
                </ul>

                {rollbackError && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap">
                    {rollbackError}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex gap-3 justify-end">
              <Button variant="outline" onClick={closeRollback} disabled={rollbackLoading}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmRollback}
                disabled={rollbackLoading}
                className="gap-2"
              >
                {rollbackLoading ? (
                  <>
                    <div className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Rolling back…
                  </>
                ) : (
                  <>
                    <Undo2 className="size-3.5" />
                    Confirm Rollback
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label, value, color, icon,
}: {
  label: string;
  value: number;
  color: "neutral" | "green" | "amber" | "red";
  icon?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        color === "green" && value > 0 && "border-emerald-200 bg-emerald-50",
        color === "amber" && value > 0 && "border-amber-200 bg-amber-50",
        color === "red" && value > 0 && "border-red-200 bg-red-50",
        (color === "neutral" || value === 0) && "border-border bg-muted/30",
      )}
    >
      <p
        className={cn(
          "text-2xl font-bold tabular-nums",
          color === "green" && value > 0 && "text-emerald-700",
          color === "amber" && value > 0 && "text-amber-700",
          color === "red" && value > 0 && "text-red-700",
        )}
      >
        {icon && <span className="mr-1 text-base">{icon}</span>}
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function RowStatus({
  row,
  onOverride,
  siblingCount,
}: {
  row: ScanRowResult;
  onOverride: (productName: string, makeNew: boolean) => void;
  siblingCount: number;
}) {
  if (row.status === "red") {
    return (
      <div className="flex items-start gap-1.5">
        <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-500" />
        <ul className="space-y-0.5">
          {row.errors.map((e, i) => (
            <li key={i} className="text-xs text-red-700">{e}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (row.status === "amber") {
    // Backend bundles the product-match line into `warnings`; we render that
    // decision interactively below, so strip those two phrasings out here and
    // keep only the color/size/category auto-create notes.
    const otherWarnings = row.warnings.filter(
      (w) => !w.includes("will be added to") && !w.includes("will be created"),
    );
    const match = row.productMatch;
    const isOverridden = !!match && row.action === "create_product_and_variant";
    const sim = match ? Math.round(match.similarity * 100) : 0;
    const borderline = !!match && match.similarity < 0.95;

    return (
      <div className="flex items-start gap-1.5">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
        <div className="space-y-1">
          {match ? (
            isOverridden ? (
              <div>
                <p className="text-xs font-medium text-emerald-700">
                  Will create NEW product “{row.raw.product_name}”
                </p>
                <button
                  type="button"
                  onClick={() => onOverride(row.raw.product_name, false)}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Undo — add to “{match.name}” instead
                </button>
              </div>
            ) : (
              <div>
                <p
                  className={cn(
                    "text-xs font-medium",
                    borderline ? "text-red-700" : "text-amber-800",
                  )}
                >
                  {borderline && "⚠ "}New variant → “{match.name}” ({sim}% match)
                </p>
                {borderline && (
                  <p className="text-[11px] text-red-600">
                    Similar name, possibly a different product — verify.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onOverride(row.raw.product_name, true)}
                  className="text-xs font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  Not a match? Create as new product
                  {siblingCount > 1 ? ` (${siblingCount} rows)` : ""}
                </button>
              </div>
            )
          ) : (
            <p className="text-xs font-medium text-amber-800">
              New product “{row.raw.product_name}” will be created
            </p>
          )}
          {otherWarnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700">{w}</p>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
      <span className="text-xs text-emerald-700">Receive stock</span>
    </div>
  );
}
