import {
  Keyboard,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InvoicePreviewSheet } from "@/components/billing/invoice-preview-sheet";
import { BrandTag } from "@/components/catalog/brand-tag";
import { FlavourLabel } from "@/components/catalog/flavour-label";
import { PosCartSummary } from "@/components/billing/pos-cart-summary";
import { PosCheckoutCustomerBlock } from "@/components/billing/pos-checkout-customer";
import { PosLineDiscount } from "@/components/billing/pos-line-discount";
import { PosLineGiveaway } from "@/components/billing/pos-line-giveaway";
import { useBillingQuote } from "@/hooks/use-billing-quote";
import { MarginHint, MarginSummary, VariantCostLine } from "@/components/billing/margin-hint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { istYmd } from "@/lib/ist-time";
import {
  apiGetJsonAuthed,
  apiPostJsonAuthed,
  getStoredAccessToken,
} from "@/lib/api-client";
import {
  buildPosCheckoutPayload,
  type PaymentMethod,
  useBillingStore,
} from "@/stores/billing-store";
import { useUiStore } from "@/stores/ui-store";
import { buildInvoiceWhatsAppHref, normalizeWhatsAppPhone } from "@/lib/whatsapp-invoice";
import { sendInvoiceWhatsApp } from "@/lib/billing-api";
import { OrderInvoiceSheet } from "@/components/customers/order-invoice-sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

type PosVariant = {
  id: string;
  sku: string;
  listPrice: string | number;
  gstEnabled: boolean;
  gstPricingMode: "INCLUSIVE" | "EXCLUSIVE";
  cgstRate: string | number;
  sgstRate: string | number;
  igstRate: string | number;
  /** Weighted average cost per unit — basis for margin. */
  unitCost?: string | number;
  /** Rate paid on the most recent receive; null if never purchased. */
  lastCost?: string | number | null;
  /** The same two costs with the purchase GST added back — display only. */
  unitCostIncl?: string | number | null;
  lastCostIncl?: string | number | null;
  /** On the variant — often the only thing separating two identical packs. */
  brand: { id: string; name: string } | null;
  flavour: { name: string } | null;
  packSize: { label: string; code: string } | null;
  inventory: { quantity: number } | null;
};

type PosProduct = {
  id: string;
  name: string;
  kind: "SUPPLEMENT" | "ACCESSORY";
  variants: PosVariant[];
};

function variantLabel(v: PosVariant): string {
  return [v.flavour?.name, v.packSize?.label].filter(Boolean).join(" / ") || "Default";
}

function asMoneyNumber(v: string | number): number {
  return typeof v === "number" ? v : Number(v) || 0;
}

/** Details of the just-completed sale, used to offer the WhatsApp share button. */
type LastSale = {
  orderId: string;
  invoiceNumber: string | null;
  amountPaid: string;
  customerName: string;
  customerPhone: string;
};

type InvoiceMetaResponse = {
  invoice: {
    invoiceNumber: string | null;
    totals: { grandTotal: string };
    customer: { fullName: string | null; phone: string | null } | null;
  };
};

export function BillingPos() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [catalog, setCatalog] = useState<PosProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);
  const [saleMessage, setSaleMessage] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<LastSale | null>(null);
  const [saleBusy, setSaleBusy] = useState(false);
  const [sendPromptOpen, setSendPromptOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [invoicePreviewSale, setInvoicePreviewSale] = useState<LastSale | null>(null);

  const searchQuery = useBillingStore((s) => s.searchQuery);
  const setSearchQuery = useBillingStore((s) => s.setSearchQuery);
  const selectedProductId = useBillingStore((s) => s.selectedProductId);
  const setSelectedProduct = useBillingStore((s) => s.setSelectedProduct);
  const selectedVariantIndex = useBillingStore((s) => s.selectedVariantIndex);
  const setSelectedVariantIndex = useBillingStore((s) => s.setSelectedVariantIndex);
  const lines = useBillingStore((s) => s.lines);
  const gstEnabled = useBillingStore((s) => s.gstEnabled);
  const setGstEnabled = useBillingStore((s) => s.setGstEnabled);
  const payment = useBillingStore((s) => s.payment);
  const setPayment = useBillingStore((s) => s.setPayment);
  const addOrIncrementLine = useBillingStore((s) => s.addOrIncrementLine);
  const setQty = useBillingStore((s) => s.setQty);
  const removeLine = useBillingStore((s) => s.removeLine);
  const clearCart = useBillingStore((s) => s.clearCart);
  const posLinkedCustomerId = useBillingStore((s) => s.posLinkedCustomerId);
  const posCustomerName = useBillingStore((s) => s.posCustomerName);
  const posCustomerPhone = useBillingStore((s) => s.posCustomerPhone);
  const saleDate = useBillingStore((s) => s.saleDate);
  const saleDateExplicit = useBillingStore((s) => s.saleDateExplicit);
  const setSaleDate = useBillingStore((s) => s.setSaleDate);
  const setInvoicePreviewOpen = useUiStore((s) => s.setInvoicePreviewOpen);

  useEffect(() => {
    let cancelled = false;
    const token = getStoredAccessToken();
    if (!token) {
      setCatalog([]);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        setCatalogLoading(true);
        try {
          const search = encodeURIComponent(searchQuery.trim());
          const data = await apiGetJsonAuthed<PosProduct[]>(
            `/api/v1/billing/pos/search?limit=30${search ? `&search=${search}` : ""}`,
          );
          if (!cancelled) setCatalog(data);
        } finally {
          if (!cancelled) setCatalogLoading(false);
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, catalogRefreshKey]);

  const filtered = catalog;
  const selected = useMemo(
    () => filtered.find((p) => p.id === selectedProductId) ?? null,
    [filtered, selectedProductId],
  );
  const variant = selected?.variants[selectedVariantIndex];

  const addCurrentVariant = useCallback(() => {
    if (!selected || !variant) return;
    addOrIncrementLine({
      productId: selected.id,
      variantId: variant.id,
      name: selected.name,
      variantLabel: variantLabel(variant),
      brandName: variant.brand?.name ?? null,
      unitCost: asMoneyNumber(variant.unitCost ?? 0),
      flavourName: variant.flavour?.name ?? null,
      sku: variant.sku,
      unitPrice: asMoneyNumber(variant.listPrice),
      availableStock: variant.inventory?.quantity ?? 0,
      gstPricingMode: variant.gstPricingMode,
      cgstRate: asMoneyNumber(variant.cgstRate),
      sgstRate: asMoneyNumber(variant.sgstRate),
      igstRate: asMoneyNumber(variant.igstRate),
    });
  }, [addOrIncrementLine, selected, variant]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inField =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement).isContentEditable;

      if (e.key === "/" && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (e.key === "Enter" && document.activeElement === searchRef.current) {
        const q = searchQuery.trim().toLowerCase();
        const exact = filtered.find((p) =>
          p.variants.some((v) => v.sku.toLowerCase() === q),
        );
        if (exact) {
          e.preventDefault();
          const exactVariant =
            exact.variants.find((v) => v.sku.toLowerCase() === q) ??
            exact.variants[0];
          setSelectedProduct(exact.id);
          setSelectedVariantIndex(Math.max(0, exact.variants.indexOf(exactVariant)));
          addOrIncrementLine({
            productId: exact.id,
            variantId: exactVariant.id,
            name: exact.name,
            variantLabel: variantLabel(exactVariant),
            brandName: exactVariant.brand?.name ?? null,
            unitCost: asMoneyNumber(exactVariant.unitCost ?? 0),
            flavourName: exactVariant.flavour?.name ?? null,
            sku: exactVariant.sku,
            unitPrice: asMoneyNumber(exactVariant.listPrice),
            availableStock: exactVariant.inventory?.quantity ?? 0,
            gstPricingMode: exactVariant.gstPricingMode,
            cgstRate: asMoneyNumber(exactVariant.cgstRate),
            sgstRate: asMoneyNumber(exactVariant.sgstRate),
            igstRate: asMoneyNumber(exactVariant.igstRate),
          });
          setSearchQuery("");
        } else if (filtered.length === 1) {
          e.preventDefault();
          const p = filtered[0];
          setSelectedProduct(p.id);
          const v = p.variants[selectedVariantIndex] ?? p.variants[0];
          addOrIncrementLine({
            productId: p.id,
            variantId: v.id,
            name: p.name,
            variantLabel: variantLabel(v),
            brandName: v.brand?.name ?? null,
            unitCost: asMoneyNumber(v.unitCost ?? 0),
        flavourName: v.flavour?.name ?? null,
            sku: v.sku,
            unitPrice: asMoneyNumber(v.listPrice),
            availableStock: v.inventory?.quantity ?? 0,
            gstPricingMode: v.gstPricingMode,
            cgstRate: asMoneyNumber(v.cgstRate),
            sgstRate: asMoneyNumber(v.sgstRate),
            igstRate: asMoneyNumber(v.igstRate),
          });
          setSearchQuery("");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    addOrIncrementLine,
    filtered,
    searchQuery,
    selectedVariantIndex,
    setSearchQuery,
    setSelectedProduct,
    setSelectedVariantIndex,
  ]);

  const cartDiscountType = useBillingStore((s) => s.cartDiscountType);
  const cartDiscountValue = useBillingStore((s) => s.cartDiscountValue);
  const { quote, loading: quoteLoading, error: quoteError } = useBillingQuote();

  const grandTotal = quote?.totals.grandTotal ?? "0";

  // Margin figures for the counter. Cost comes from the cart lines (WAC at the
  // time the line was added); taxable value comes from the server quote, so it
  // already reflects every item and cart discount.
  const cartCost = useMemo(
    () => lines.reduce((sum, l) => sum + (l.unitCost ?? 0) * l.qty, 0),
    [lines],
  );
  const cartTaxable = Number(quote?.totals.taxableValue ?? 0);
  const lineCostById = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.variantId, (m.get(l.variantId) ?? 0) + (l.unitCost ?? 0) * l.qty);
    return m;
  }, [lines]);
  const lineTaxableById = useMemo(() => {
    const m = new Map<string, number>();
    for (const ql of quote?.lines ?? []) m.set(ql.variantId, Number(ql.taxableValue));
    return m;
  }, [quote]);

  async function completeSale() {
    if (lines.length === 0 || !quote || saleBusy) return;
    setSaleMessage(null);
    setLastSale(null);
    setSaleBusy(true);
    // Capture customer details before clearCart() resets the POS customer fields.
    const snapshotName = posCustomerName.trim();
    const snapshotPhone = posCustomerPhone.trim();
    try {
      const checkoutBody = buildPosCheckoutPayload({
        lines,
        gstEnabled,
        cartDiscountType,
        cartDiscountValue,
        payment,
        grandTotal: quote.totals.grandTotal,
        posLinkedCustomerId,
        posCustomerName,
        posCustomerPhone,
        saleDate,
        saleDateExplicit,
      });
      const { orderId } = await apiPostJsonAuthed<{ orderId: string }>(
        "/api/v1/billing/checkout",
        checkoutBody,
      );

      let invoiceNumber: string | null = null;
      let amountPaid = quote.totals.grandTotal;
      let customerName = snapshotName;
      let customerPhone = snapshotPhone;
      // Pull the allocated invoice number / resolved customer for the share message.
      // Non-fatal: the sale already succeeded if this lookup fails.
      try {
        const { invoice } = await apiGetJsonAuthed<InvoiceMetaResponse>(
          `/api/v1/billing/orders/${encodeURIComponent(orderId)}/invoice?format=json`,
        );
        invoiceNumber = invoice.invoiceNumber;
        amountPaid = invoice.totals.grandTotal;
        if (invoice.customer) {
          customerName = invoice.customer.fullName ?? customerName;
          customerPhone = invoice.customer.phone ?? customerPhone;
        }
      } catch {
        // keep the fallbacks captured above
      }

      const sale = { orderId, invoiceNumber, amountPaid, customerName, customerPhone };
      setLastSale(sale);
      setSaleMessage("Sale completed. Stock reduced automatically.");
      // Offer automated WhatsApp delivery when the customer has a usable number.
      setSendErr(null);
      setSendPromptOpen(normalizeWhatsAppPhone(customerPhone) !== null);
      clearCart();
    } catch (e) {
      setSaleMessage(e instanceof Error ? e.message : "Could not complete sale.");
    } finally {
      setSaleBusy(false);
    }
  }

  async function handleAutoSend(force = false) {
    if (!lastSale || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      const out = await sendInvoiceWhatsApp(lastSale.orderId, force);
      setSendPromptOpen(false);
      toast.success(
        out.dryRun
          ? "Invoice queued (WhatsApp is in test mode)"
          : "Invoice sent on WhatsApp",
      );
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Failed to send invoice");
    } finally {
      setSending(false);
    }
  }

  const whatsAppShare = useMemo(() => {
    if (!lastSale) return null;
    const href = buildInvoiceWhatsAppHref({
      phone: lastSale.customerPhone,
      customerName: lastSale.customerName,
      orderId: lastSale.orderId,
      invoiceNumber: lastSale.invoiceNumber,
      amountPaid: lastSale.amountPaid,
    });
    return href ? { href } : null;
  }, [lastSale]);

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Point of sale</h2>
          <p className="text-sm text-muted-foreground">
            Live stock checkout — each variant shows{" "}
            <span className="font-medium text-foreground">available</span> units from inventory logs.
            Completing a sale reduces stock and feeds reports automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-full"
            onClick={() => setInvoicePreviewOpen(true)}
          >
            <Receipt className="size-4" />
            Preview
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="rounded-full"
            onClick={() => clearCart()}
          >
            Clear cart
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card className="border-border/60">
            <CardContent className="p-4">
              <Label htmlFor="pos-search" className="sr-only">
                Product search
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  id="pos-search"
                  placeholder="Name or SKU…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoComplete="off"
                  className="h-11 rounded-xl border-border/80 pl-10 pr-10 text-base shadow-sm"
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-border/60 md:col-span-1">
              <CardContent className="p-0">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <span className="text-sm font-medium">Catalog</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      disabled={catalogLoading}
                      onClick={() => setCatalogRefreshKey((k) => k + 1)}
                    >
                      <RefreshCw className={`size-3.5 ${catalogLoading ? "animate-spin" : ""}`} />
                    </Button>
                    <Badge variant="secondary">
                      {catalogLoading ? "…" : filtered.length}
                    </Badge>
                  </div>
                </div>
                <ScrollArea className="h-[min(52vh,420px)]">
                  <ul className="divide-y divide-border/50 p-2">
                    {filtered.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedProduct(p.id)}
                          className={cn(
                            "flex w-full flex-col rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-150",
                            selectedProductId === p.id
                              ? "bg-foreground/10"
                              : "hover:bg-muted/60",
                          )}
                        >
                          <span className="font-medium">{p.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {p.kind === "SUPPLEMENT" ? "Supplement" : "Accessory"} · {p.variants.length} variants
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Keyboard className="size-4 text-muted-foreground" />
                  Variants
                </div>
                {selected ? (
                  <>
                    <p className="text-sm text-muted-foreground">{selected.name}</p>
                    <div className="flex flex-wrap gap-2">
                      {selected.variants.map((v, i) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setSelectedVariantIndex(i)}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150",
                            selectedVariantIndex === i
                              ? "border-foreground bg-foreground text-background"
                              : "border-border/80 bg-muted/40 hover:bg-muted",
                          )}
                        >
                          <BrandTag brand={v.brand?.name} className="mr-1.5" />
                          <FlavourLabel flavour={v.flavour?.name}>{variantLabel(v)}</FlavourLabel>
                          <span className="ml-1.5 tabular-nums text-muted-foreground">
                            {money(asMoneyNumber(v.listPrice))}
                          </span>
                          <span className="ml-1.5 font-medium tabular-nums text-foreground">
                            avail {v.inventory?.quantity ?? 0}
                          </span>
                        </button>
                      ))}
                    </div>
                    {variant && asMoneyNumber(variant.unitCost ?? 0) > 0 ? (
                      <p className="mb-2 text-xs">
                        <VariantCostLine
                          taxableAtList={
                            // Margin at LIST price, ex-GST, before any discount.
                            variant.gstPricingMode === "INCLUSIVE"
                              ? asMoneyNumber(variant.listPrice) /
                                (1 +
                                  (asMoneyNumber(variant.cgstRate) +
                                    asMoneyNumber(variant.sgstRate) +
                                    asMoneyNumber(variant.igstRate)) /
                                    100)
                              : asMoneyNumber(variant.listPrice)
                          }
                          wac={asMoneyNumber(variant.unitCost ?? 0)}
                          lastCost={
                            variant.lastCost == null ? null : asMoneyNumber(variant.lastCost)
                          }
                          wacIncl={
                            variant.unitCostIncl == null
                              ? null
                              : asMoneyNumber(variant.unitCostIncl)
                          }
                          lastCostIncl={
                            variant.lastCostIncl == null
                              ? null
                              : asMoneyNumber(variant.lastCostIncl)
                          }
                        />
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      className="w-full rounded-xl"
                      disabled={!variant || (variant.inventory?.quantity ?? 0) <= 0}
                      onClick={addCurrentVariant}
                    >
                      {(variant?.inventory?.quantity ?? 0) <= 0 ? "Unavailable" : "Add to bill"}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Select a product from the list to choose flavour or pack size.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-4">
          <Card className="overflow-visible border-border/60 lg:sticky lg:top-0">
            <CardContent className="space-y-4 overflow-visible p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Current bill</span>
                <span className="text-xs text-muted-foreground">{lines.length} lines</span>
              </div>
              <ScrollArea className="h-[min(40vh,320px)] pr-2">
                {lines.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No lines yet — scan or search to add.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="w-[100px] text-right">Qty</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell>
                            <div className="text-sm font-medium leading-tight">{l.name}</div>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <BrandTag brand={l.brandName} />
                              <FlavourLabel flavour={l.flavourName}>{l.variantLabel}</FlavourLabel>
                            </div>
                            {!l.isGiveaway && (l.unitCost ?? 0) > 0 ? (
                              <div className="mt-0.5 text-[11px]">
                                <MarginHint
                                  taxable={lineTaxableById.get(l.variantId) ?? 0}
                                  cost={lineCostById.get(l.variantId) ?? 0}
                                />
                              </div>
                            ) : null}
                            <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                              {l.isGiveaway ? (
                                <span className="font-medium text-amber-700 dark:text-amber-400">
                                  FREE · was {money(l.unitPrice)}
                                </span>
                              ) : (
                                <span>
                                  {money(l.unitPrice)} each · avail {l.availableStock}
                                </span>
                              )}
                            </div>
                            <PosLineGiveaway line={l} />
                            <PosLineDiscount line={l} />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex items-center gap-1 rounded-lg border border-border/80 p-0.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7 rounded-md"
                                onClick={() => setQty(l.id, l.qty - 1)}
                              >
                                <Minus className="size-3.5" />
                              </Button>
                              <span className="min-w-[1.5rem] text-center text-sm tabular-nums">
                                {l.qty}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7 rounded-md"
                                onClick={() => setQty(l.id, l.qty + 1)}
                              >
                                <Plus className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-destructive"
                              aria-label="Remove line"
                              onClick={() => removeLine(l.id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
              <PosCheckoutCustomerBlock />
              <Separator />
              <div className="space-y-1.5">
                <Label htmlFor="sale-date" className="text-xs text-muted-foreground">
                  Sale date (IST)
                </Label>
                <Input
                  id="sale-date"
                  type="date"
                  value={saleDate}
                  max={istYmd()}
                  className="w-full"
                  onChange={(e) => setSaleDate(e.target.value, true)}
                />
                <p className="text-[11px] text-muted-foreground">
                  {saleDateExplicit
                    ? "Booked on the selected IST date."
                    : "Defaults to today in IST if unchanged."}
                </p>
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <Label htmlFor="gst-toggle" className="text-xs text-muted-foreground">
                    GST
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    5% supplements · 18% accessories
                  </p>
                </div>
                <Switch
                  id="gst-toggle"
                  checked={gstEnabled}
                  onCheckedChange={setGstEnabled}
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Payment
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["cash", "Cash"],
                      ["card", "Card"],
                      ["upi", "UPI"],
                    ] as const
                  ).map(([id, label]) => (
                    <Button
                      key={id}
                      type="button"
                      size="sm"
                      variant={payment === id ? "default" : "outline"}
                      className="rounded-full px-4"
                      onClick={() => setPayment(id as PaymentMethod)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              <Separator />
              <PosCartSummary quote={quote} loading={quoteLoading} error={quoteError} />
              {lines.length > 0 && cartCost > 0 ? (
                <div className="mt-3">
                  <MarginSummary taxable={cartTaxable} cost={cartCost} gstEnabled={gstEnabled} />
                </div>
              ) : null}
              <Button
                type="button"
                size="lg"
                className="w-full rounded-xl text-base font-semibold"
                disabled={lines.length === 0 || !quote || quoteLoading || saleBusy}
                onClick={() => void completeSale()}
              >
                {saleBusy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Completing sale…
                  </>
                ) : (
                  "Complete sale"
                )}
              </Button>
              {saleMessage ? (
                <p className="text-xs text-muted-foreground">{saleMessage}</p>
              ) : null}
              {whatsAppShare ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2 rounded-xl border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                  onClick={() =>
                    window.open(whatsAppShare.href, "_blank", "noopener,noreferrer")
                  }
                >
                  <MessageCircle className="size-4" />
                  Share invoice on WhatsApp
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/80 bg-background/95 p-3 backdrop-blur-md lg:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold tabular-nums">
              {money(Number(grandTotal) || 0)}
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            className="min-w-[140px] rounded-xl"
            disabled={lines.length === 0}
            onClick={() => setInvoicePreviewOpen(true)}
          >
            Preview
          </Button>
        </div>
      </div>

      <InvoicePreviewSheet />

      <Dialog
        open={sendPromptOpen}
        onOpenChange={(open) => {
          if (!sending) {
            setSendPromptOpen(open);
            if (!open) setSendErr(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send invoice on WhatsApp?</DialogTitle>
            <DialogDescription>
              {lastSale ? (
                <>
                  Invoice{" "}
                  <span className="font-medium text-foreground">
                    {lastSale.invoiceNumber ?? lastSale.orderId}
                  </span>{" "}
                  for {money(Number(lastSale.amountPaid) || 0)} will be sent to{" "}
                  <span className="font-medium text-foreground">
                    {lastSale.customerName || "the customer"}
                  </span>{" "}
                  ({lastSale.customerPhone}). The invoice PDF link is delivered
                  automatically — no redirect.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {sendErr ? <p className="text-sm text-destructive">{sendErr}</p> : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => setInvoicePreviewSale(lastSale)}
            >
              <Receipt className="size-4" />
              Preview
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={sending}
                onClick={() => {
                  setSendPromptOpen(false);
                  setSendErr(null);
                }}
              >
                Skip
              </Button>
              {sendErr ? (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 border-amber-500/50 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/40"
                  disabled={sending}
                  onClick={() => void handleAutoSend(true)}
                >
                  {sending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Resending…
                    </>
                  ) : (
                    <>
                      <MessageCircle className="size-4" />
                      Resend anyway
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  className="gap-2"
                  disabled={sending}
                  onClick={() => void handleAutoSend(false)}
                >
                  {sending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <MessageCircle className="size-4" />
                      Send now
                    </>
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OrderInvoiceSheet
        orderId={invoicePreviewSale?.orderId ?? null}
        invoiceLabel={invoicePreviewSale?.invoiceNumber ?? null}
        open={invoicePreviewSale !== null}
        onOpenChange={(open) => {
          if (!open) setInvoicePreviewSale(null);
        }}
      />
    </div>
  );
}
