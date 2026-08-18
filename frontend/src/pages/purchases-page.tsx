import {
  Keyboard,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BrandTag } from "@/components/catalog/brand-tag";
import { FlavourLabel } from "@/components/catalog/flavour-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  apiGetJsonAuthed,
  apiGetJsonAuthedWithMeta,
  apiPostJsonAuthed,
  getStoredAccessToken,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Supplier = { id: string; name: string };

type SearchProduct = {
  id: string;
  name: string;
  kind: string;
  /** Brands come from the variants — a product can span several companies. */
  variants?: { brand: { id: string; name: string } | null }[];
  _count?: { variants: number };
};

/** Distinct company names across a product's variants. */
function searchProductBrands(p: SearchProduct): string[] {
  const set = new Set<string>();
  for (const v of p.variants ?? []) if (v.brand?.name) set.add(v.brand.name);
  return [...set].sort((a, b) => a.localeCompare(b));
}

type VariantRow = {
  id: string;
  sku: string;
  /** Weighted average cost of stock on hand. */
  avgCost?: string | null;
  /** Rate paid on the most recent receive; null if never purchased. */
  lastCost?: string | null;
  brand: { id: string; name: string } | null;
  flavour: { name: string } | null;
  packSize: { label: string } | null;
};

type CartLine = {
  id: string;
  variantId: string;
  productId: string;
  productName: string;
  variantSku: string;
  variantDisplay: string;
  brandName: string | null;
  flavourName: string | null;
  qty: number;
  unitCost: number;
  gstEnabled: boolean;
  gstInclusive: boolean;
  cgst: number;
  sgst: number;
  igst: number;
};

function fmtInr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function defaultRates(kind: string) {
  if (kind === "SUPPLEMENT") return { cgst: 2.5, sgst: 2.5, igst: 0 };
  return { cgst: 9, sgst: 9, igst: 0 };
}

function variantDisplay(v: VariantRow): string {
  return [v.flavour?.name, v.packSize?.label].filter(Boolean).join(" · ") || "Default";
}

function lineMoney(l: CartLine): {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
} {
  const gross = l.qty * l.unitCost;
  if (!l.gstEnabled || gross <= 0) {
    return { taxable: gross, cgst: 0, sgst: 0, igst: 0, total: gross };
  }
  const r = (l.cgst + l.sgst + l.igst) / 100;
  const taxable = l.gstInclusive ? gross / (1 + r) : gross;
  const cgst = (taxable * l.cgst) / 100;
  const sgst = (taxable * l.sgst) / 100;
  const igst = (taxable * l.igst) / 100;
  return { taxable, cgst, sgst, igst, total: taxable + cgst + sgst + igst };
}

export function PurchasesPage() {
  const authed = Boolean(getStoredAccessToken());
  const searchRef = useRef<HTMLInputElement>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [catalog, setCatalog] = useState<SearchProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);

  const [draftQty, setDraftQty] = useState(1);
  const [draftCost, setDraftCost] = useState("");
  const [draftGstEnabled, setDraftGstEnabled] = useState(true);
  const [draftGstInclusive, setDraftGstInclusive] = useState(false);

  const [lines, setLines] = useState<CartLine[]>([]);

  const loadSuppliers = useCallback(async () => {
    if (!authed) return;
    setLoading(true);
    try {
      const { data } = await apiGetJsonAuthedWithMeta<Supplier[]>("/api/v1/suppliers?limit=200");
      setSuppliers(data);
      setSupplierId((prev) => prev || data[0]?.id || "");
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        setCatalogLoading(true);
        try {
          const q = encodeURIComponent(searchQuery.trim());
          const data = await apiGetJsonAuthed<SearchProduct[]>(
            `/api/v1/catalog/products?limit=40${q ? `&search=${q}` : ""}`,
          );
          if (!cancelled) setCatalog(data);
        } catch {
          if (!cancelled) setCatalog([]);
        } finally {
          if (!cancelled) setCatalogLoading(false);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [authed, searchQuery, catalogRefreshKey]);

  useEffect(() => {
    if (!selectedProductId || !authed) {
      setVariants([]);
      setSelectedVariantIndex(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      setVariantsLoading(true);
      try {
        const { data } = await apiGetJsonAuthedWithMeta<VariantRow[]>(
          `/api/v1/catalog/products/${selectedProductId}/variants?limit=200`,
        );
        if (!cancelled) {
          setVariants(data);
          setSelectedVariantIndex(0);
        }
      } catch {
        if (!cancelled) setVariants([]);
      } finally {
        if (!cancelled) setVariantsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed, selectedProductId]);

  const purchasableCatalog = useMemo(
    () => catalog.filter((p) => (p._count?.variants ?? 0) > 0),
    [catalog],
  );
  const hasMasters = purchasableCatalog.length > 0;
  const selectedProduct = useMemo(
    () => purchasableCatalog.find((p) => p.id === selectedProductId) ?? null,
    [purchasableCatalog, selectedProductId],
  );
  const selectedVariant = variants[selectedVariantIndex] ?? null;

  const searchActive = searchQuery.trim().length > 0;
  const noResults = searchActive && !catalogLoading && catalog.length === 0;

  const totals = useMemo(() => {
    let sub = 0;
    let tax = 0;
    let g = 0;
    for (const l of lines) {
      const m = lineMoney(l);
      sub += m.taxable;
      tax += m.cgst + m.sgst + m.igst;
      g += m.total;
    }
    return { sub, tax, grand: g };
  }, [lines]);

  function addToCart() {
    setMsg(null);
    if (!selectedProduct || !selectedVariant) {
      setMsg("Select a master product and variant first.");
      return;
    }
    const unit = Math.max(0, Number(draftCost) || 0);
    const qty = Math.max(1, Math.floor(draftQty) || 1);
    const rates = defaultRates(selectedProduct.kind);
    const row: CartLine = {
      id: crypto.randomUUID(),
      variantId: selectedVariant.id,
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      variantSku: selectedVariant.sku,
      variantDisplay: variantDisplay(selectedVariant),
      brandName: selectedVariant.brand?.name ?? null,
      flavourName: selectedVariant.flavour?.name ?? null,
      qty,
      unitCost: unit,
      gstEnabled: draftGstEnabled,
      gstInclusive: draftGstInclusive,
      cgst: rates.cgst,
      sgst: rates.sgst,
      igst: rates.igst,
    };
    setLines((prev) => {
      const i = prev.findIndex((l) => l.variantId === row.variantId);
      if (i >= 0) {
        return prev.map((l, idx) =>
          idx === i
            ? {
                ...l,
                qty: l.qty + qty,
                unitCost: unit > 0 ? unit : l.unitCost,
                gstEnabled: row.gstEnabled,
                gstInclusive: row.gstInclusive,
                cgst: row.cgst,
                sgst: row.sgst,
                igst: row.igst,
              }
            : l,
        );
      }
      return [...prev, row];
    });
    setDraftQty(1);
    setDraftCost("");
  }

  async function receiveInventory() {
    setMsg(null);
    if (!hasMasters) {
      setMsg("No master products available. Create a master record first.");
      return;
    }
    if (!supplierId) {
      setMsg("Select a supplier.");
      return;
    }
    const payloadLines = lines
      .filter((l) => l.variantId && l.qty > 0)
      .map((l) => ({
        variantId: l.variantId,
        quantityOrdered: l.qty,
        unitCost: l.unitCost,
        gstEnabled: l.gstEnabled,
        gstPricingMode: l.gstInclusive ? "INCLUSIVE" : "EXCLUSIVE",
        cgstRate: l.cgst,
        sgstRate: l.sgst,
        igstRate: l.igst,
      }));
    if (payloadLines.length === 0) {
      setMsg("Add at least one line to the purchase cart.");
      return;
    }
    setBusy(true);
    try {
      await apiPostJsonAuthed("/api/v1/purchases/save-and-receive", {
        supplierId,
        lines: payloadLines,
      });
      setMsg("Inventory received. Stock and movement logs are updated.");
      setLines([]);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not receive inventory.");
    } finally {
      setBusy(false);
    }
  }

  if (!authed) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link to="/login?redirect=/dashboard/purchases" className="underline">
          Sign in
        </Link>{" "}
        to receive stock against purchases.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Receive stock</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Operational stock-in: search your master catalog, pick a variant, set purchase rate and GST,
          then add to your purchase cart — same rhythm as billing. Only existing master products can be
          received.
        </p>
      </div>

      {!hasMasters ? (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/25">
          <CardContent className="space-y-2 py-4 text-sm">
            <p className="font-semibold text-foreground">No master product found.</p>
            <p className="text-muted-foreground">
              Create master record first — blueprint only, no stock until you receive here.
            </p>
            <Button asChild type="button" size="sm" variant="secondary" className="mt-1 rounded-lg">
              <Link to="/dashboard/catalog">Open Master Catalog</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-4">
              <Label htmlFor="purchase-search" className="sr-only">
                Search master products
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  id="purchase-search"
                  placeholder="Search name, brand, flavour or pack size…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoComplete="off"
                  className="h-11 rounded-xl border-border/80 pl-10 pr-10 text-base shadow-sm"
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">/</kbd>{" "}
                focuses search when not typing in a field.
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-0">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <span className="text-sm font-medium">Master matches</span>
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
                    <Badge variant="secondary">{catalogLoading ? "…" : purchasableCatalog.length}</Badge>
                  </div>
                </div>
                <div className="max-h-[min(52vh,400px)] overflow-y-auto p-2">
                  {noResults ? (
                    <div className="px-3 py-8 text-center text-sm">
                      <p className="font-medium text-foreground">No master product found.</p>
                      <p className="mt-1 text-muted-foreground">Create master record first.</p>
                      <Button asChild type="button" size="sm" variant="outline" className="mt-2 h-auto">
                        <Link to="/dashboard/catalog">Go to Master Catalog</Link>
                      </Button>
                    </div>
                  ) : purchasableCatalog.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {catalogLoading ? "Searching…" : "Type to search the catalog."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/50">
                      {purchasableCatalog.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedProductId(p.id)}
                            className={cn(
                              "flex w-full flex-col rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                              selectedProductId === p.id
                                ? "bg-foreground/10"
                                : "hover:bg-muted/60",
                            )}
                          >
                            <span className="font-medium">{p.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {searchProductBrands(p).length > 0
                                ? `${searchProductBrands(p).join(", ")} · `
                                : ""}
                              {p.kind === "SUPPLEMENT" ? "Supplement" : "Accessory"}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-sm">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Keyboard className="size-4 text-muted-foreground" />
                  Variant &amp; purchase rate
                </div>
                {selectedProduct ? (
                  variantsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading variants…</p>
                  ) : variants.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No variants on this product.</p>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">{selectedProduct.name}</p>
                      <div className="flex flex-wrap gap-2">
                        {variants.map((v, i) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setSelectedVariantIndex(i)}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-left text-xs font-medium transition-all",
                              selectedVariantIndex === i
                                ? "border-foreground bg-foreground text-background"
                                : "border-border/80 bg-muted/40 hover:bg-muted",
                            )}
                          >
                            <BrandTag brand={v.brand?.name} className="mr-1.5 align-middle" />
                            <FlavourLabel flavour={v.flavour?.name}>{variantDisplay(v)}</FlavourLabel>
                            <span className="ml-1.5 font-mono opacity-80">{v.sku}</span>
                          </button>
                        ))}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Quantity</Label>
                          <div className="flex items-center gap-1 rounded-lg border border-border/80 p-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 rounded-md"
                              onClick={() => setDraftQty((q) => Math.max(1, q - 1))}
                            >
                              <Minus className="size-3.5" />
                            </Button>
                            <Input
                              className="h-8 border-0 text-center text-sm tabular-nums shadow-none"
                              type="number"
                              min={1}
                              value={draftQty}
                              onChange={(e) =>
                                setDraftQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 rounded-md"
                              onClick={() => setDraftQty((q) => q + 1)}
                            >
                              <Plus className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            Purchase rate (unit)
                            <span className="ml-1 font-normal text-muted-foreground">
                              — this is the new cost price
                            </span>
                          </Label>
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            placeholder="0.00"
                            value={draftCost}
                            onChange={(e) => setDraftCost(e.target.value)}
                            className="h-9 rounded-lg text-sm tabular-nums"
                          />
                          {/* What this variant cost before, so a supplier re-rate is
                              obvious at the moment the new rate is typed. */}
                          {selectedVariant ? (
                            <p className="text-[11px] leading-snug text-muted-foreground">
                              {selectedVariant.lastCost
                                ? `Last bought at ${fmtInr(Number(selectedVariant.lastCost))}`
                                : "Never purchased yet"}
                              {selectedVariant.avgCost && Number(selectedVariant.avgCost) > 0
                                ? ` · avg cost ${fmtInr(Number(selectedVariant.avgCost))}`
                                : ""}
                              {(() => {
                                const typed = Number(draftCost);
                                const last = Number(selectedVariant.lastCost ?? 0);
                                if (!typed || !last) return "";
                                const diff = typed - last;
                                if (Math.abs(diff) < 0.01) return " · same as last time";
                                const pct = (diff / last) * 100;
                                return ` · ${diff > 0 ? "up" : "down"} ${fmtInr(Math.abs(diff))} (${Math.abs(pct).toFixed(0)}%)`;
                              })()}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={draftGstEnabled}
                            onChange={(e) => setDraftGstEnabled(e.target.checked)}
                          />
                          <span>GST on purchase</span>
                        </label>
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={draftGstInclusive}
                            onChange={(e) => setDraftGstInclusive(e.target.checked)}
                            disabled={!draftGstEnabled}
                          />
                          <span className="text-muted-foreground">Inclusive rate</span>
                        </label>
                      </div>
                      <Button type="button" className="w-full rounded-xl" onClick={addToCart}>
                        Add to purchase cart
                      </Button>
                    </>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Choose a product from the list to select flavour / pack size and rate.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-4">
          <Card className="border-border/60 shadow-sm xl:sticky xl:top-4">
            <CardHeader className="space-y-1 pb-2">
              <CardTitle className="text-base">Purchase cart</CardTitle>
              <CardDescription>Select supplier — then receive into live stock.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Supplier</Label>
                <select
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Lines</span>
                <span className="text-xs text-muted-foreground">{lines.length} items</span>
              </div>

              {lines.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 bg-muted/20 py-10 text-center text-sm text-muted-foreground">
                  Cart is empty — search a master product and add lines.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border/60">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Variant</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">GST</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((l) => {
                        const m = lineMoney(l);
                        const gstAmt = m.cgst + m.sgst + m.igst;
                        return (
                          <TableRow key={l.id}>
                            <TableCell>
                              <div className="text-sm font-medium leading-tight">{l.productName}</div>
                              <div className="text-[11px] text-muted-foreground">{l.variantSku}</div>
                            </TableCell>
                            <TableCell className="max-w-[120px] text-xs text-muted-foreground">
                              <BrandTag brand={l.brandName} className="mr-1.5 align-middle" />
                              <FlavourLabel flavour={l.flavourName}>{l.variantDisplay}</FlavourLabel>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="inline-flex items-center gap-0.5 rounded-md border border-border/70 p-0.5">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  onClick={() =>
                                    setLines((prev) =>
                                      prev.map((x) =>
                                        x.id === l.id
                                          ? { ...x, qty: Math.max(1, x.qty - 1) }
                                          : x,
                                      ),
                                    )
                                  }
                                >
                                  <Minus className="size-3" />
                                </Button>
                                <span className="min-w-[1.25rem] text-center text-xs tabular-nums">
                                  {l.qty}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  onClick={() =>
                                    setLines((prev) =>
                                      prev.map((x) =>
                                        x.id === l.id ? { ...x, qty: x.qty + 1 } : x,
                                      ),
                                    )
                                  }
                                >
                                  <Plus className="size-3" />
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {fmtInr(l.unitCost)}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {l.gstEnabled ? fmtInr(gstAmt) : "—"}
                            </TableCell>
                            <TableCell className="text-right text-xs font-medium tabular-nums">
                              {fmtInr(m.total)}
                            </TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8 text-muted-foreground hover:text-destructive"
                                aria-label="Remove"
                                onClick={() => setLines((prev) => prev.filter((x) => x.id !== l.id))}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="space-y-1 rounded-lg bg-muted/30 px-3 py-2 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Taxable value</span>
                  <span className="tabular-nums text-foreground">{fmtInr(totals.sub)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>GST</span>
                  <span className="tabular-nums text-foreground">{fmtInr(totals.tax)}</span>
                </div>
                <div className="flex justify-between border-t border-border/50 pt-2 font-semibold">
                  <span>Cart total</span>
                  <span className="tabular-nums">{fmtInr(totals.grand)}</span>
                </div>
              </div>

              <Button
                type="button"
                size="lg"
                className="w-full rounded-xl text-base font-semibold"
                disabled={busy || lines.length === 0 || !hasMasters}
                onClick={() => void receiveInventory()}
              >
                {busy ? "Receiving…" : "Receive inventory"}
              </Button>
              {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
