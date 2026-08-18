import { ChevronDown, ChevronRight, FileText, Pencil, Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FlavourLabel } from "@/components/catalog/flavour-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrderInvoiceSheet } from "@/components/customers/order-invoice-sheet";
import { ShareInvoiceWhatsAppButton } from "@/components/customers/share-invoice-whatsapp-button";
import {
  correctOrderItemVariant,
  fetchProductVariantsForCorrection,
  voidSaleOrder,
  type CorrectableVariant,
} from "@/lib/billing-api";
import { formatIstDateTime } from "@/lib/ist-time";
import { cn } from "@/lib/utils";
import {
  fetchOrdersReport,
  type OrderReportLine,
  type OrderReportRow,
} from "@/lib/analytics-api";

const fmtInr = (n: number | string) => {
  const v = typeof n === "string" ? Number(n) : n;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isNaN(v) ? 0 : v);
};

const num = (s: string) => Number(s) || 0;

function formatDate(iso: string | null): string {
  return formatIstDateTime(iso);
}

function paymentSummary(row: OrderReportRow): string {
  if (row.payments.length === 0) return "—";
  return row.payments.map((p) => `${p.method} ${fmtInr(p.amount)}`).join(", ");
}

function discountLabel(type: string | null, value: string | null): string {
  if (!type || value == null) return "—";
  if (type === "PERCENT") return `${value}%`;
  return fmtInr(value);
}

type Props = {
  from: string;
  to: string;
};

export function OrdersReportPanel({ from, to }: Props) {
  const [rows, setRows] = useState<OrderReportRow[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 25, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [invoiceOrderId, setInvoiceOrderId] = useState<string | null>(null);
  const [invoiceLabel, setInvoiceLabel] = useState<string | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OrderReportRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [correctTarget, setCorrectTarget] = useState<{
    orderId: string;
    line: OrderReportLine;
  } | null>(null);
  const [correctVariants, setCorrectVariants] = useState<CorrectableVariant[]>([]);
  const [correctChoice, setCorrectChoice] = useState("");
  const [correctVariantsLoading, setCorrectVariantsLoading] = useState(false);
  const [correctBusy, setCorrectBusy] = useState(false);
  const [correctErr, setCorrectErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const out = await fetchOrdersReport({
        from,
        to,
        page,
        limit: 25,
        search: appliedSearch || undefined,
        status: "CONFIRMED",
        documentType: "SALE",
      });
      setRows(out.items);
      setMeta(out.meta);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [from, to, page, appliedSearch]);

  useEffect(() => {
    setPage(1);
  }, [from, to, appliedSearch]);

  // Dynamic search: debounce the raw input into the applied term that drives the query.
  useEffect(() => {
    const t = setTimeout(() => setAppliedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      await voidSaleOrder(deleteTarget.id);
      setDeleteTarget(null);
      if (expandedId === deleteTarget.id) setExpandedId(null);
      await load();
    } catch (e: unknown) {
      setDeleteErr(e instanceof Error ? e.message : "Failed to delete sale");
    } finally {
      setDeleteBusy(false);
    }
  };

  const openCorrect = useCallback(async (orderId: string, line: OrderReportLine) => {
    setCorrectTarget({ orderId, line });
    setCorrectChoice("");
    setCorrectErr(null);
    setCorrectVariants([]);
    setCorrectVariantsLoading(true);
    try {
      const variants = await fetchProductVariantsForCorrection(line.productId);
      setCorrectVariants(variants.filter((v) => v.id !== line.variantId));
    } catch (e: unknown) {
      setCorrectErr(e instanceof Error ? e.message : "Failed to load variants");
    } finally {
      setCorrectVariantsLoading(false);
    }
  }, []);

  const handleConfirmCorrect = async () => {
    if (!correctTarget || !correctChoice) return;
    setCorrectBusy(true);
    setCorrectErr(null);
    try {
      await correctOrderItemVariant(correctTarget.orderId, correctTarget.line.id, correctChoice);
      setCorrectTarget(null);
      toast.success("Variant corrected — stock reconciled");
      await load();
    } catch (e: unknown) {
      setCorrectErr(e instanceof Error ? e.message : "Failed to correct variant");
    } finally {
      setCorrectBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Order ledger</CardTitle>
          <CardDescription>
            Every booked sale in the selected IST date range — line-level discounts, GST split, payments,
            and customer. Delete mistaken entries to restore stock and sync revenue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ord-search">Search invoice / customer / SKU</Label>
              <Input
                id="ord-search"
                placeholder="GVN-… name, phone or SKU"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-[220px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setAppliedSearch(search.trim());
                    setPage(1);
                  }
                }}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAppliedSearch(search.trim());
                setPage(1);
              }}
            >
              Search
            </Button>
            {appliedSearch ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setAppliedSearch("");
                  setPage(1);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {err ? <p className="text-sm text-destructive">{err}</p> : null}
          {loading ? <p className="text-sm text-muted-foreground">Loading orders…</p> : null}

          <div className="overflow-x-auto rounded-xl border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Item disc.</TableHead>
                  <TableHead className="text-right">Bill disc.</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="w-[180px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={13} className="py-10 text-center text-muted-foreground">
                      No orders in this range.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => {
                  const open = expandedId === row.id;
                  const t = row.totals;
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        className={cn("cursor-pointer hover:bg-muted/40", open && "bg-muted/30")}
                        onClick={() => setExpandedId(open ? null : row.id)}
                      >
                        <TableCell>
                          {open ? (
                            <ChevronDown className="size-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.invoiceNumber ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {formatDate(row.confirmedAt ?? row.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[140px] truncate text-sm">
                            {row.isWalkIn
                              ? "Walk-in"
                              : row.customer?.fullName ?? "—"}
                          </div>
                          {row.customer?.phone ? (
                            <div className="text-[11px] tabular-nums text-muted-foreground">
                              {row.customer.phone}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {row.documentType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {num(t.itemDiscountTotal) > 0 ? `−${fmtInr(t.itemDiscountTotal)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {num(t.cartDiscountAmount) > 0 ? (
                            <>
                              −{fmtInr(t.cartDiscountAmount)}
                              <div className="text-[10px] text-muted-foreground">
                                {discountLabel(t.cartDiscountType, t.cartDiscountValue)}
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {fmtInr(t.taxableValue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {row.gstEnabled ? fmtInr(t.gstTotal) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {fmtInr(t.grandTotal)}
                        </TableCell>
                        <TableCell className="max-w-[120px] truncate text-[11px]">
                          {paymentSummary(row)}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1 text-xs"
                              onClick={() => {
                                setInvoiceOrderId(row.id);
                                setInvoiceLabel(row.invoiceNumber);
                                setInvoiceOpen(true);
                              }}
                            >
                              <FileText className="size-3.5" />
                              Invoice
                            </Button>
                            <ShareInvoiceWhatsAppButton
                              compact
                              phone={row.customer?.phone}
                              customerName={row.customer?.fullName ?? ""}
                              orderId={row.id}
                              invoiceNumber={row.invoiceNumber}
                              amountPaid={row.totals.grandTotal}
                              documentType={row.documentType}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => {
                                setDeleteErr(null);
                                setDeleteTarget(row);
                              }}
                            >
                              <Trash2 className="size-3.5" />
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {open ? (
                        <TableRow className="bg-muted/15 hover:bg-muted/15">
                          <TableCell colSpan={13} className="p-0">
                            <OrderLinesDetail
                              lines={row.lines}
                              gstEnabled={row.gstEnabled}
                              canCorrect={row.status === "CONFIRMED" && row.documentType === "SALE"}
                              onCorrect={(line) => openCorrect(row.id, line)}
                            />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              Page {meta.page} of {Math.max(1, meta.totalPages)} ({meta.total} orders)
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

      <OrderInvoiceSheet
        orderId={invoiceOrderId}
        invoiceLabel={invoiceLabel}
        open={invoiceOpen}
        onOpenChange={(open) => {
          setInvoiceOpen(open);
          if (!open) {
            setInvoiceOrderId(null);
            setInvoiceLabel(null);
          }
        }}
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) {
            setDeleteTarget(null);
            setDeleteErr(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this sale?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? (
                <>
                  This will void invoice{" "}
                  <span className="font-mono font-medium text-foreground">
                    {deleteTarget.invoiceNumber ?? deleteTarget.id}
                  </span>{" "}
                  for {fmtInr(deleteTarget.totals.grandTotal)}. Stock will be restored, and this sale
                  will be removed from revenue, profit, and inventory valuation reports. The invoice
                  number is kept for audit but will no longer count as an active sale.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {deleteErr ? <p className="text-sm text-destructive">{deleteErr}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleteBusy}
              onClick={() => {
                setDeleteTarget(null);
                setDeleteErr(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBusy}
              onClick={() => void handleConfirmDelete()}
            >
              {deleteBusy ? "Deleting…" : "Delete sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={correctTarget !== null}
        onOpenChange={(open) => {
          if (!open && !correctBusy) {
            setCorrectTarget(null);
            setCorrectErr(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Correct variant</DialogTitle>
            <DialogDescription>
              {correctTarget ? (
                <>
                  Fixes a wrongly-recorded flavour / pack size on{" "}
                  <span className="font-medium text-foreground">
                    {correctTarget.line.productName}
                  </span>{" "}
                  (currently{" "}
                  <span className="font-medium text-foreground">
                    {correctTarget.line.variantLabel}
                  </span>
                  ). Money on the bill is unchanged — only stock moves between the two variants.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="correct-variant">Correct to</Label>
            {correctVariantsLoading ? (
              <p className="text-sm text-muted-foreground">Loading variants…</p>
            ) : correctVariants.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No other variants of this product to switch to.
              </p>
            ) : (
              <select
                id="correct-variant"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={correctChoice}
                onChange={(e) => setCorrectChoice(e.target.value)}
              >
                <option value="">Select a variant…</option>
                {correctVariants.map((v) => {
                  const label = [v.flavourName, v.packSizeLabel].filter(Boolean).join(" / ") || "Default";
                  return (
                    <option key={v.id} value={v.id} disabled={v.quantity <= 0}>
                      {label} · {v.sku} · stock {v.quantity}
                      {v.quantity <= 0 ? " (no stock)" : ""}
                    </option>
                  );
                })}
              </select>
            )}
            <p className="text-[11px] text-muted-foreground">
              Variants with no stock can’t be selected — add a stock adjustment first, then correct.
            </p>
          </div>

          {correctErr ? <p className="text-sm text-destructive">{correctErr}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={correctBusy}
              onClick={() => {
                setCorrectTarget(null);
                setCorrectErr(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={correctBusy || !correctChoice}
              onClick={() => void handleConfirmCorrect()}
            >
              {correctBusy ? "Correcting…" : "Correct variant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrderLinesDetail({
  lines,
  gstEnabled,
  canCorrect,
  onCorrect,
}: {
  lines: OrderReportLine[];
  gstEnabled: boolean;
  canCorrect: boolean;
  onCorrect: (line: OrderReportLine) => void;
}) {
  return (
    <div className="border-t border-border/50 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Line items
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Unit</TableHead>
            <TableHead className="text-right">Item disc.</TableHead>
            <TableHead className="text-right">Cart alloc.</TableHead>
            <TableHead className="text-right">Taxable</TableHead>
            {gstEnabled ? <TableHead className="text-right">GST</TableHead> : null}
            <TableHead className="text-right">Line total</TableHead>
            {canCorrect ? <TableHead className="w-10" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((ln) => (
            <TableRow key={ln.id}>
              <TableCell>
                <div className="text-sm font-medium">
                  {ln.productName}
                  {ln.isGiveaway ? (
                    <span className="ml-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      (FREE)
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  <FlavourLabel flavour={ln.flavourName}>{ln.variantLabel}</FlavourLabel>
                  {ln.isGiveaway && ln.giveawayReason ? (
                    <span className="mt-0.5 block">{ln.giveawayReason}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">
                <FlavourLabel flavour={ln.flavourName}>{ln.sku}</FlavourLabel>
              </TableCell>
              <TableCell className="text-right tabular-nums">{ln.quantity}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInr(ln.unitPrice)}</TableCell>
              <TableCell className="text-right tabular-nums text-xs">
                {num(ln.itemDiscountAmount) > 0 ? (
                  <>
                    −{fmtInr(ln.itemDiscountAmount)}
                    <div className="text-[10px] text-muted-foreground">
                      {discountLabel(ln.itemDiscountType, ln.itemDiscountValue)}
                    </div>
                  </>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs">
                {num(ln.cartDiscountAllocated) > 0
                  ? `−${fmtInr(ln.cartDiscountAllocated)}`
                  : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtInr(ln.taxableValue)}</TableCell>
              {gstEnabled ? (
                <TableCell className="text-right tabular-nums text-xs">
                  {fmtInr(ln.gstAmount)}
                </TableCell>
              ) : null}
              <TableCell className="text-right font-medium tabular-nums">
                {fmtInr(ln.lineTotal)}
              </TableCell>
              {canCorrect ? (
                <TableCell className="text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                    title="Correct variant (flavour / pack size)"
                    onClick={() => onCorrect(ln)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
