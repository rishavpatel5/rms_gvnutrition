import { ChevronLeft, ChevronRight, Loader2, PackagePlus, Palette, Pencil, Plus, Rows3, Ruler, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BrandTag } from "@/components/catalog/brand-tag";
import { FlavourLabel } from "@/components/catalog/flavour-label";
import { SkuLookupCard } from "@/components/catalog/sku-lookup-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PACK_MEASURES,
  PACK_PRESETS,
  measureHint,
  measureLabel,
  parsePackSizeLabel,
  type PackMeasure,
} from "@/lib/pack-size";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  apiDeleteAuthed,
  apiDeleteJsonAuthed,
  apiGetJsonAuthed,
  apiGetJsonAuthedWithMeta,
  apiPatchJsonAuthed,
  apiPostJsonAuthed,
  getStoredAccessToken,
} from "@/lib/api-client";
import { fetchAllPaginated } from "@/lib/fetch-paginated";
import { kindLabel, splitByProductKind } from "@/lib/product-kind";
import { cn } from "@/lib/utils";

type Flavour = { id: string; name: string };
type PackSize = { id: string; label: string; code: string; measure: string };

const KINDS = ["SUPPLEMENT", "ACCESSORY"] as const;
type BrandRef = { id: string; name: string; slug: string };

/**
 * Preview of the SKU the SERVER will generate: BRAND-PRODUCT-FLAVOUR-PACKSIZE.
 * Mirrors generateUniqueSku() in backend/src/modules/catalog/variant.service.ts —
 * keep the two in sync. Shown read-only; the server remains the source of truth
 * and adds a -2 suffix if a code is somehow already taken.
 */
function skuToken(value: string, max: number): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

function previewSku(
  brandName: string | undefined,
  productName: string,
  flavourName: string | undefined,
  packCode: string | undefined,
): string {
  const parts = [
    brandName ? skuToken(brandName, 18) : "",
    skuToken(slugify(productName || "sku"), 22),
    flavourName ? skuToken(flavourName, 12) : "",
    packCode ? skuToken(packCode, 8) : "",
  ].filter(Boolean);
  return parts.join("-").slice(0, 58).replace(/-+$/, "") || "SKU";
}

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function AuthGate() {
  return (
    <div className="mx-auto max-w-lg py-12 text-center text-sm text-muted-foreground">
      <Link to="/login?redirect=/dashboard/catalog" className="underline">
        Sign in
      </Link>{" "}
      to manage the catalog.
    </div>
  );
}

type MatrixRow = { flavourId: string; packSizeId: string; sku: string; key: string };

type CatalogProductRow = {
  id: string;
  name: string;
  kind: string;
  /** Brands come from the VARIANTS now — one product can span several companies. */
  variants?: { brand: { id: string; name: string; slug: string } | null }[];
  _count?: { variants: number };
};

/** Distinct company names across a product's variants. */
function productBrandNames(p: CatalogProductRow): string[] {
  const set = new Set<string>();
  for (const v of p.variants ?? []) if (v.brand?.name) set.add(v.brand.name);
  return [...set].sort((a, b) => a.localeCompare(b));
}

const BLUEPRINT_STEPS = [
  { n: 1, title: "Identity", sub: "Classification" },
  { n: 2, title: "Variants", sub: "Flavours, pack sizes & SKUs" },
  { n: 3, title: "Pricing & tax", sub: "Shelf economics" },
  { n: 4, title: "Complete", sub: "Ready for stock" },
] as const;

const selectControl =
  "flex h-11 w-full cursor-pointer rounded-xl border-2 border-border/60 bg-muted/15 px-3.5 text-sm font-medium shadow-sm transition-colors hover:border-border/90 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

type SkuVariant = {
  id: string;
  sku: string;
  brand: { name: string } | null;
  flavour: { name: string } | null;
  packSize: { label: string } | null;
};

function ProductSkuDialog({
  product,
  open,
  onClose,
  onProductDeleted,
}: {
  product: CatalogProductRow | null;
  open: boolean;
  onClose: () => void;
  onProductDeleted: (id: string) => void;
}) {
  const [variants, setVariants] = useState<SkuVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSku, setEditSku] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !product) {
      setVariants([]);
      setEditingId(null);
      setConfirmDeleteId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const { data } = await apiGetJsonAuthedWithMeta<SkuVariant[]>(
          `/api/v1/catalog/products/${product.id}/variants?limit=200`,
        );
        if (!cancelled) setVariants(data);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load variants");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, product]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  function startEdit(v: SkuVariant) {
    setEditingId(v.id);
    setEditSku(v.sku);
    setConfirmDeleteId(null);
  }

  async function saveEdit(variantId: string) {
    const trimmed = editSku.trim();
    if (!trimmed) return;
    setSavingId(variantId);
    try {
      await apiPatchJsonAuthed(`/api/v1/catalog/variants/${variantId}`, { sku: trimmed });
      setVariants((prev) => prev.map((v) => (v.id === variantId ? { ...v, sku: trimmed } : v)));
      setEditingId(null);
      toast.success("SKU updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update SKU");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteVariant(variantId: string) {
    setDeletingId(variantId);
    try {
      const res = await apiDeleteJsonAuthed<{ outcome: "deleted" | "deactivated" }>(
        `/api/v1/catalog/variants/${variantId}`,
      );
      const remaining = variants.filter((v) => v.id !== variantId);
      setVariants(remaining);
      setConfirmDeleteId(null);
      // A SKU with stock movements behind it is deactivated, not destroyed — the
      // inventory ledger it appears in has to keep adding up. Say so, rather than
      // claiming a deletion that did not happen.
      if (res?.outcome === "deactivated") {
        toast.success("SKU removed from the catalog", {
          description:
            "It has purchase or sales history, so the record is kept for your reports. The SKU code is free to use again.",
        });
      } else {
        toast.success("SKU deleted");
      }
      if (remaining.length === 0 && product) {
        // The last SKU is gone, so the product goes with it. The API decides
        // whether that is a real delete or a deactivation; either way it now
        // succeeds, so a failure here is a genuine problem and must be surfaced
        // rather than swallowed — silently ignoring it once left products that
        // looked deleted but came back on the next refresh.
        try {
          await apiDeleteAuthed(`/api/v1/catalog/products/${product.id}`);
          onProductDeleted(product.id);
          onClose();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not remove the product");
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete variant");
    } finally {
      setDeletingId(null);
    }
  }

  function variantLabel(v: SkuVariant) {
    const parts = [v.flavour?.name, v.packSize?.label].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "Default";
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle className="leading-snug">{product?.name ?? ""}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading SKUs…
          </div>
        ) : variants.length === 0 && !loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No variants on this product.</p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/60">
            {variants.map((v) => {
              const isEditing = editingId === v.id;
              const isDeleting = deletingId === v.id;
              const isSaving = savingId === v.id;
              const confirmingDelete = confirmDeleteId === v.id;

              return (
                <li key={v.id} className="flex flex-col gap-2 bg-background px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <BrandTag brand={v.brand?.name} className="mb-1" />
                      <FlavourLabel flavour={v.flavour?.name}>
                        <span className="text-sm font-medium">{variantLabel(v)}</span>
                      </FlavourLabel>
                    </div>
                    {!isEditing && !confirmingDelete ? (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8 text-muted-foreground hover:text-foreground"
                          onClick={() => startEdit(v)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            setConfirmDeleteId(v.id);
                            setEditingId(null);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Input
                        ref={editInputRef}
                        className="h-8 font-mono text-xs"
                        value={editSku}
                        onChange={(e) => setEditSku(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEdit(v.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 shrink-0 rounded-lg"
                        disabled={isSaving || !editSku.trim()}
                        onClick={() => void saveEdit(v.id)}
                      >
                        {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 shrink-0"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <p className="font-mono text-xs text-muted-foreground">{v.sku}</p>
                  )}

                  {confirmingDelete ? (
                    <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                      <span className="flex-1 text-destructive">Delete this SKU?</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="h-7 rounded-md"
                        disabled={isDeleting}
                        onClick={() => void handleDeleteVariant(v.id)}
                      >
                        {isDeleting ? <Loader2 className="size-3 animate-spin" /> : "Delete"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-md"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          {variants.length} SKU{variants.length === 1 ? "" : "s"} · Deleting all SKUs will remove this
          product.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function CatalogProductCard({
  p,
  onClick,
}: {
  p: CatalogProductRow;
  onClick: (p: CatalogProductRow) => void;
}) {
  return (
    <Card
      className="cursor-pointer border-border/60 shadow-sm transition-shadow hover:shadow-md"
      onClick={() => onClick(p)}
    >
      <CardHeader className="space-y-2 pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{p.name}</CardTitle>
          <Badge variant="secondary" className="shrink-0 whitespace-nowrap text-[10px] uppercase">
            Ready for stock
          </Badge>
        </div>
        <CardDescription>
          {productBrandNames(p).length > 0 ? productBrandNames(p).join(", ") : "No brand"}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {p._count?.variants ?? 0} SKU{(p._count?.variants ?? 0) === 1 ? "" : "s"} — click to view &amp;
        manage
      </CardContent>
    </Card>
  );
}

function CatalogBrowseByKind({
  rows,
  onProductClick,
}: {
  rows: CatalogProductRow[];
  onProductClick: (p: CatalogProductRow) => void;
}) {
  const { supplement, accessory } = splitByProductKind(rows);
  return (
    <div className="space-y-8">
      <CatalogKindSection title={kindLabel("SUPPLEMENT")} products={supplement} onProductClick={onProductClick} />
      <CatalogKindSection title={kindLabel("ACCESSORY")} products={accessory} onProductClick={onProductClick} />
    </div>
  );
}

function CatalogKindSection({
  title,
  products,
  onProductClick,
}: {
  title: string;
  products: CatalogProductRow[];
  onProductClick: (p: CatalogProductRow) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-2">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {products.length} product{products.length === 1 ? "" : "s"}
        </span>
      </div>
      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">No {title.toLowerCase()} in the catalog yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <CatalogProductCard key={p.id} p={p} onClick={onProductClick} />
          ))}
        </div>
      )}
    </section>
  );
}

function BrandPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

export function CatalogPage() {
  if (!getStoredAccessToken()) return <AuthGate />;

  const [view, setView] = useState<"browse" | "create">("browse");
  const [catalogRows, setCatalogRows] = useState<CatalogProductRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [activeBrand, setActiveBrand] = useState<string | null>(null); // null = All brands

  const [step, setStep] = useState(1);
  const [colors, setColors] = useState<Flavour[]>([]);
  const [sizes, setSizes] = useState<PackSize[]>([]);
  const [loadingRef, setLoadingRef] = useState(true);

  const [pName, setPName] = useState("");
  const [pKind, setPKind] = useState<(typeof KINDS)[number]>("SUPPLEMENT");
  const [pHsnCode, setPHsnCode] = useState("");
  const [pBrandId, setPBrandId] = useState("");
  const [brandOptions, setBrandOptions] = useState<BrandRef[]>([]);
  const [sheetBrandOpen, setSheetBrandOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [sheetBrandBusy, setSheetBrandBusy] = useState(false);

  const [selColors, setSelColors] = useState<string[]>([]);
  const [selSizes, setSelSizes] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);

  const [costPrice, setCostPrice] = useState("");
  const [listPrice, setListPrice] = useState("");
  const [gstInclusive, setGstInclusive] = useState(true);
  const [cgstPct, setCgstPct] = useState("2.5");
  const [sgstPct, setSgstPct] = useState("2.5");
  const [igstPct, setIgstPct] = useState("0");
  const [lowStockThr, setLowStockThr] = useState("5");

  const [productId, setProductId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [skuDialogProduct, setSkuDialogProduct] = useState<CatalogProductRow | null>(null);

  const [nameMatches, setNameMatches] = useState<CatalogProductRow[]>([]);
  const [nameSearchLoading, setNameSearchLoading] = useState(false);


  const [sheetFlavourOpen, setSheetFlavourOpen] = useState(false);
  const [newFlavourName, setNewFlavourName] = useState("");
  const [sheetFlavourBusy, setSheetFlavourBusy] = useState(false);

  const [sheetSizeOpen, setSheetSizeOpen] = useState(false);
  const [newSizeLabel, setNewSizeLabel] = useState("");
  const [newSizeMeasure, setNewSizeMeasure] = useState<PackMeasure>("WEIGHT");
  const [sheetSizeBusy, setSheetSizeBusy] = useState(false);

  const loadRef = useCallback(async () => {
    setLoadingRef(true);
    try {
      const [col, siz, brs] = await Promise.all([
        apiGetJsonAuthedWithMeta<Flavour[]>("/api/v1/catalog/reference/flavours?limit=200"),
        apiGetJsonAuthedWithMeta<PackSize[]>("/api/v1/catalog/reference/pack-sizes?limit=200"),
        apiGetJsonAuthedWithMeta<BrandRef[]>("/api/v1/catalog/reference/brands?limit=200"),
      ]);
      setColors(col.data);
      setSizes(siz.data);
      setBrandOptions(brs.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load reference data");
    } finally {
      setLoadingRef(false);
    }
  }, []);

  useEffect(() => {
    void loadRef();
  }, [loadRef]);

  useEffect(() => {
    if (view !== "browse" || loadingRef) return;
    let cancelled = false;
    void (async () => {
      setCatalogLoading(true);
      try {
        const data = await fetchAllPaginated<CatalogProductRow>(
          (page) => `/api/v1/catalog/products?limit=100&page=${page}`,
        );
        if (!cancelled) setCatalogRows(data);
      } catch {
        if (!cancelled) setCatalogRows([]);
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, loadingRef]);

  const toggle = (id: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  async function refreshColors(): Promise<Flavour[]> {
    const { data } = await apiGetJsonAuthedWithMeta<Flavour[]>("/api/v1/catalog/reference/flavours?limit=200");
    setColors(data);
    return data;
  }

  async function submitQuickBrand() {
    const name = newBrandName.trim();
    if (!name) {
      toast.error("Brand name is required.");
      return;
    }
    setSheetBrandBusy(true);
    try {
      const created = await apiPostJsonAuthed<{ id: string }>("/api/v1/catalog/reference/brands", { name });
      const { data } = await apiGetJsonAuthedWithMeta<BrandRef[]>(
        "/api/v1/catalog/reference/brands?limit=200",
      );
      setBrandOptions(data);
      setPBrandId(created.id);
      setSheetBrandOpen(false);
      setNewBrandName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add brand");
    } finally {
      setSheetBrandBusy(false);
    }
  }

  async function refreshSizes(): Promise<PackSize[]> {
    const { data } = await apiGetJsonAuthedWithMeta<PackSize[]>("/api/v1/catalog/reference/pack-sizes?limit=200");
    setSizes(data);
    return data;
  }

  function goBlueprintStep(n: number) {
    if (n === 1) {
      setStep(1);
      return;
    }
    if (!productId) return;
    if (n >= 2 && n <= 4) setStep(n);
  }

  function useExistingProduct(p: CatalogProductRow) {
    setProductId(p.id);
    setPName(p.name);
    setPKind(p.kind as (typeof KINDS)[number]);
    setNameMatches([]);
    setStep(2);
  }

  async function submitQuickFlavour() {
    const name = newFlavourName.trim();
    if (!name) {
      toast.error("Flavour name is required.");
      return;
    }
    setSheetFlavourBusy(true);
    try {
      const created = await apiPostJsonAuthed<{ id: string }>("/api/v1/catalog/reference/flavours", {
        name,
        hexCode: null,
      });
      await refreshColors();
      setSelColors((prev) => [...prev, created.id]);
      setSheetFlavourOpen(false);
      setNewFlavourName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add flavour");
    } finally {
      setSheetFlavourBusy(false);
    }
  }

  async function submitQuickSize() {
    const label = newSizeLabel.trim();
    if (!label) {
      toast.error("Enter a pack size, e.g. 1kg, 500ml or 60 tablets.");
      return;
    }
    // The label itself determines the measure and the sortable magnitude —
    // "1kg" is WEIGHT/1000g. Reject anything we cannot read rather than guessing.
    const parsed = parsePackSizeLabel(label);
    if (!parsed) {
      toast.error(`"${label}" not understood. Use a number with a unit — 1kg, 500g, 500ml, 1L — or a plain count like 60.`);
      return;
    }
    if (parsed.measure !== newSizeMeasure) {
      toast.error(
        `"${label}" reads as ${measureLabel(parsed.measure)}, but ${measureLabel(newSizeMeasure)} is selected.`,
      );
      return;
    }
    setSheetSizeBusy(true);
    try {
      const created = await apiPostJsonAuthed<{ id: string }>("/api/v1/catalog/reference/pack-sizes", {
        label: parsed.label,
        code: parsed.code,
        measure: parsed.measure,
        normalizedValue: parsed.normalizedValue,
      });
      await refreshSizes();
      setSelSizes((prev) => [...prev, created.id]);
      setSheetSizeOpen(false);
      setNewSizeLabel("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add pack size");
    } finally {
      setSheetSizeBusy(false);
    }
  }

  useEffect(() => {
    if (!sheetFlavourOpen) return;
    setNewFlavourName("");
  }, [sheetFlavourOpen]);

  useEffect(() => {
    if (!sheetSizeOpen) return;
    setNewSizeLabel("");
    setNewSizeMeasure("WEIGHT");
  }, [sheetSizeOpen]);

  useEffect(() => {
    const q = pName.trim();
    if (q.length < 2 || view !== "create" || step !== 1 || productId) {
      setNameMatches([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        setNameSearchLoading(true);
        try {
          const data = await apiGetJsonAuthed<CatalogProductRow[]>(
            `/api/v1/catalog/products?search=${encodeURIComponent(q)}&limit=10`,
          );
          if (!cancelled) {
            const lower = q.toLowerCase();
            setNameMatches(data.filter((p) => p.name.toLowerCase().includes(lower)));
          }
        } catch {
          if (!cancelled) setNameMatches([]);
        } finally {
          if (!cancelled) setNameSearchLoading(false);
        }
      })();
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pName, view, step, productId]);

  useEffect(() => {
    if (pKind !== "SUPPLEMENT" || selColors.length === 0 || selSizes.length === 0) {
      setMatrix([]);
      return;
    }
    const slug = slugify(pName || "sku");
    const rows: MatrixRow[] = [];
    for (const c of selColors) {
      for (const s of selSizes) {
        const color = colors.find((x) => x.id === c)?.name ?? "c";
        const size = sizes.find((x) => x.id === s)?.code ?? "s";
        const sku = `${slug}-${color.replace(/\s+/g, "")}-${size}`.toUpperCase().slice(0, 64);
        rows.push({ flavourId: c, packSizeId: s, sku, key: `${c}-${s}` });
      }
    }
    setMatrix(rows);
  }, [pKind, selColors, selSizes, colors, sizes, pName]);

  async function persistStep1() {
    if (!pName.trim()) {
      toast.error("Product name is required.");
      return;
    }
    setBusy(true);
    try {
      // Brand is NOT sent here — it belongs to each variant, so one product can
      // hold the same flavour and pack size from several companies.
      const created = await apiPostJsonAuthed<{ id: string }>("/api/v1/catalog/products", {
        name: pName.trim(),
        hsnCode: pHsnCode.trim() || null,
        kind: pKind,
      });
      setProductId(created.id);
      setNameMatches([]);
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create product");
    } finally {
      setBusy(false);
    }
  }

  async function persistStep2() {
    if (!productId) return;
    setBusy(true);
    try {
      // SKU is omitted everywhere: the server generates a unique internal code.
      // That matters here — two companies sharing a flavour and pack size would
      // otherwise produce the same SKU and collide on the unique constraint.
      if (pKind === "ACCESSORY") {
        await apiPostJsonAuthed(`/api/v1/catalog/products/${productId}/variants`, {
          listPrice: Number(listPrice) || 0,
          brandId: pBrandId || null,
          flavourId: selColors[0] || null,
          packSizeId: null,
        });
      } else {
        for (const row of matrix) {
          await apiPostJsonAuthed(`/api/v1/catalog/products/${productId}/variants`, {
            listPrice: 0,
            brandId: pBrandId || null,
            flavourId: row.flavourId,
            packSizeId: row.packSizeId,
          });
        }
      }
      setCgstPct(pKind === "SUPPLEMENT" ? "2.5" : "9");
      setSgstPct(pKind === "SUPPLEMENT" ? "2.5" : "9");
      setIgstPct("0");
      setStep(3);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create variants");
    } finally {
      setBusy(false);
    }
  }

  async function persistStep3() {
    if (!productId) return;
    setBusy(true);
    try {
      const detail = await apiGetJsonAuthed<{
        variants: { id: string; sku: string }[];
      }>(`/api/v1/catalog/products/${productId}`);
      const lp = Number(listPrice) || 0;
      const cp = costPrice.trim() === "" ? null : Number(costPrice);
      const gstPricingMode = gstInclusive ? "INCLUSIVE" : "EXCLUSIVE";
      const thr =
        lowStockThr.trim() === "" ? null : Math.max(0, Math.floor(Number(lowStockThr) || 0));
      for (const v of detail.variants) {
        await apiPatchJsonAuthed(`/api/v1/catalog/variants/${v.id}`, {
          listPrice: lp,
          costPrice: cp,
          gstPricingMode,
          cgstRate: Number(cgstPct) || 0,
          sgstRate: Number(sgstPct) || 0,
          igstRate: Number(igstPct) || 0,
          lowStockThreshold: thr,
          gstEnabled: true,
        });
      }
      setStep(4);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update pricing");
    } finally {
      setBusy(false);
    }
  }

  // Distinct brands across the catalog (for the brand switcher pills).
  // NOTE: these hooks must stay above any early return so hook order is stable.
  const brands = useMemo(() => {
    const set = new Set<string>();
    for (const p of catalogRows) for (const n of productBrandNames(p)) set.add(n);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [catalogRows]);

  // Products shown in the grid, filtered by the active brand (null = All).
  const visibleRows = useMemo(
    () =>
      activeBrand
        ? catalogRows.filter((p) => productBrandNames(p).includes(activeBrand))
        : catalogRows,
    [catalogRows, activeBrand],
  );

  // Global search → jump to the picked item's brand and open its product.
  // Brand lives on the VARIANT, so read it from the match itself, not from
  // match.product (which silently yielded undefined and never set the filter).
  const handlePickSearch = useCallback(
    (match: { product: { id: string }; brand: { name: string } | null }) => {
      setActiveBrand(match.brand?.name ?? null);
      const row = catalogRows.find((p) => p.id === match.product.id);
      if (row) setSkuDialogProduct(row);
    },
    [catalogRows],
  );

  if (loadingRef) {
    return (
      <div className="flex items-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        Loading catalog references…
      </div>
    );
  }

  return (
    <div className={cn("mx-auto space-y-8", view === "create" ? "max-w-6xl" : "max-w-5xl")}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Master catalog</h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            Step 1 of your retail flow: product blueprint only — no stock is created here. After you save,
            each product shows as <span className="font-medium text-foreground">Ready for stock</span> until
            you receive inventory on Purchases.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={view === "browse" ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setView("browse")}
          >
            <Rows3 className="mr-1.5 size-4" />
            Records
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "create" ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setView("create")}
          >
            <PackagePlus className="mr-1.5 size-4" />
            New blueprint
          </Button>
        </div>
      </div>

      <SkuLookupCard onPick={handlePickSearch} />

      <ProductSkuDialog
        product={skuDialogProduct}
        open={skuDialogProduct !== null}
        onClose={() => setSkuDialogProduct(null)}
        onProductDeleted={(id) =>
          setCatalogRows((prev) => prev.filter((p) => p.id !== id))
        }
      />

      {view === "browse" ? (
        <div className="space-y-4">
          {brands.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Brand
              </span>
              <BrandPill label="All brands" active={activeBrand === null} onClick={() => setActiveBrand(null)} />
              {brands.map((b) => (
                <BrandPill key={b} label={b} active={activeBrand === b} onClick={() => setActiveBrand(b)} />
              ))}
            </div>
          ) : null}
          {catalogLoading ? (
            <div className="flex items-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              Loading records…
            </div>
          ) : catalogRows.length === 0 ? (
            <Card className="border-dashed border-border/70 bg-muted/15">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No master records yet. Switch to <strong className="text-foreground">New blueprint</strong>{" "}
                to create your first product identity.
              </CardContent>
            </Card>
          ) : visibleRows.length === 0 ? (
            <Card className="border-dashed border-border/70 bg-muted/15">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No products under <strong className="text-foreground">{activeBrand}</strong>.{" "}
                <button type="button" className="underline" onClick={() => setActiveBrand(null)}>
                  Show all brands
                </button>
              </CardContent>
            </Card>
          ) : (
            <CatalogBrowseByKind
              rows={visibleRows}
              onProductClick={(p) => setSkuDialogProduct(p)}
            />
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,15rem)_1fr] xl:gap-10">
            <aside className="h-fit space-y-1 rounded-2xl border border-border/70 bg-gradient-to-b from-muted/50 to-background p-2 shadow-sm lg:sticky lg:top-6">
              {BLUEPRINT_STEPS.map((s) => {
                const locked = s.n > 1 && !productId;
                const active = step === s.n;
                return (
                  <button
                    key={s.n}
                    type="button"
                    disabled={locked}
                    onClick={() => goBlueprintStep(s.n)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-all",
                      active
                        ? "bg-foreground text-background shadow-md"
                        : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                      locked && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full border text-xs font-bold tabular-nums",
                        active ? "border-white/30 bg-white/10" : "border-border/80 bg-background/80",
                      )}
                    >
                      {s.n}
                    </span>
                    <span className="min-w-0 pt-0.5">
                      <span className="block text-sm font-semibold leading-tight">{s.title}</span>
                      <span
                        className={cn(
                          "mt-0.5 block text-[11px] leading-snug",
                          active ? "text-white/80" : "text-muted-foreground",
                        )}
                      >
                        {s.sub}
                      </span>
                    </span>
                  </button>
                );
              })}
            </aside>

            <div className="min-w-0 overflow-hidden rounded-2xl border-2 border-border/60 bg-gradient-to-br from-card via-card to-muted/15 shadow-[0_28px_90px_-36px_rgba(15,23,42,0.28)] ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
              <div className="border-b border-border/60 bg-muted/20 px-6 py-5 sm:px-9">
                {(() => {
                  const meta = BLUEPRINT_STEPS.find((s) => s.n === step) ?? BLUEPRINT_STEPS[0];
                  return (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                        Step {meta.n} of 4
                      </p>
                      <h3 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{meta.title}</h3>
                      <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{meta.sub}</p>
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-8 px-6 py-8 sm:px-9 sm:py-10">
      {step === 1 ? (
        <div className="space-y-10">
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              Product identity
            </p>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Blueprint only — no stock is created until you receive goods on Purchases. You can extend your
              taxonomy without leaving this screen.
            </p>
          </div>

          <div className="space-y-3">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Product name
            </Label>
            <Input
              value={pName}
              onChange={(e) => setPName(e.target.value)}
              placeholder="e.g. Gold Standard Whey"
              className="h-14 rounded-2xl border-2 border-border/70 bg-background px-4 text-lg font-semibold tracking-tight shadow-sm placeholder:font-normal placeholder:text-muted-foreground"
            />
            {nameSearchLoading ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Checking existing products…
              </p>
            ) : nameMatches.length > 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-4 space-y-3">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {nameMatches.length === 1
                    ? "A product with this name already exists."
                    : `${nameMatches.length} products with a similar name already exist.`}{" "}
                  Add the missing flavour or pack size to an existing product instead of creating a duplicate.
                </p>
                <ul className="space-y-2">
                  {nameMatches.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <span className="text-sm font-medium">{p.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {p._count?.variants ?? 0} SKU
                          {(p._count?.variants ?? 0) === 1 ? "" : "s"}
                        </span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="shrink-0 rounded-full"
                        onClick={() => useExistingProduct(p)}
                      >
                        Add variants
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Keep typing a different name to create a brand-new product.
                </p>
              </div>
            ) : null}
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-3">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Product type
              </Label>
              <div className="grid grid-cols-2 gap-2 rounded-2xl border-2 border-border/50 bg-muted/20 p-1">
                <Button
                  type="button"
                  variant={pKind === "SUPPLEMENT" ? "default" : "ghost"}
                  className="h-11 rounded-xl font-medium"
                  onClick={() => setPKind("SUPPLEMENT")}
                >Supplement</Button>
                <Button
                  type="button"
                  variant={pKind === "ACCESSORY" ? "default" : "ghost"}
                  className="h-11 rounded-xl font-medium"
                  onClick={() => setPKind("ACCESSORY")}
                >
                  Accessory
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                HSN code <span className="normal-case text-muted-foreground/70">(optional)</span>
              </Label>
              <Input
                value={pHsnCode}
                onChange={(e) => setPHsnCode(e.target.value)}
                placeholder="e.g. 2106"
                className="h-11 rounded-xl border-2 border-border/60 bg-background px-4 text-sm shadow-sm"
              />
              <p className="text-xs text-muted-foreground">
                Entered once per product. Leave blank and it simply won't print on the invoice.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t border-border/50 pt-8">
            <Button
              type="button"
              size="lg"
              className="rounded-full px-10 font-semibold shadow-md"
              disabled={busy || !pName.trim()}
              onClick={() => void persistStep1()}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  Save identity & continue
                  <ChevronRight className="ml-2 size-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-6 rounded-2xl border border-border/50 bg-muted/5 p-6 shadow-inner sm:p-8">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {pKind === "SUPPLEMENT"
                ? "Pick the company, then the flavours and pack sizes it supplies."
                : "One sellable item — pick the company and an optional flavour."}
            </p>
          </div>

          {/* Brand sits on the VARIANT, so the same flavour + pack size can come
              from two companies and stay distinct. Add one company's range, save,
              then come back and add the next company's. */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Company / brand
              </Label>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 rounded-full gap-1.5 px-3 text-xs font-medium"
                onClick={() => setSheetBrandOpen(true)}
              >
                <Plus className="size-3.5" />
                New brand
              </Button>
            </div>
            <select
              className={selectControl}
              value={pBrandId}
              onChange={(e) => setPBrandId(e.target.value)}
            >
              <option value="">No brand</option>
              {brandOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Everything you create below is tagged with this company. Chocolate 500g
              from another company is a separate item on this same product.
            </p>
          </div>

            {pKind === "SUPPLEMENT" ? (
              <>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Palette className="size-4 text-muted-foreground" aria-hidden />
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Colours
                      </Label>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-8 rounded-full gap-1 px-3 text-xs"
                      onClick={() => setSheetFlavourOpen(true)}
                    >
                      <Plus className="size-3.5" />
                      New flavour
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {colors.map((c) => (
                      <Button
                        key={c.id}
                        type="button"
                        size="sm"
                        variant={selColors.includes(c.id) ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => toggle(c.id, selColors, setSelColors)}
                      >
                        {c.name}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Ruler className="size-4 text-muted-foreground" aria-hidden />
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Sizes
                      </Label>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-8 rounded-full gap-1 px-3 text-xs"
                      onClick={() => setSheetSizeOpen(true)}
                    >
                      <Plus className="size-3.5" />
                      New size
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {sizes.map((s) => (
                      <Button
                        key={s.id}
                        type="button"
                        size="sm"
                        variant={selSizes.includes(s.id) ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => toggle(s.id, selSizes, setSelSizes)}
                      >
                        {s.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {matrix.length} item{matrix.length === 1 ? "" : "s"} will be created
                  {pBrandId
                    ? ` for ${brandOptions.find((b) => b.id === pBrandId)?.name ?? "this company"}`
                    : ""}
                  .
                </p>
                {matrix.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border border-border/60">
                    <table className="w-full min-w-[320px] text-left text-xs">
                      <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-2 py-2 font-medium">Company</th>
                          <th className="px-2 py-2 font-medium">Flavour / pack size</th>
                          <th className="px-2 py-2 font-medium">SKU (auto)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* SKU is read-only: generated server-side as
                            BRAND-PRODUCT-FLAVOUR-PACKSIZE. Never typed. */}
                        {matrix.map((row) => {
                          const brandName = brandOptions.find((b) => b.id === pBrandId)?.name;
                          const flavourName = colors.find((c) => c.id === row.flavourId)?.name ?? "";
                          const packSize = sizes.find((s) => s.id === row.packSizeId);
                          return (
                            <tr key={row.key} className="border-b border-border/40 last:border-0">
                              <td className="px-2 py-2 text-muted-foreground">{brandName ?? "—"}</td>
                              <td className="px-2 py-2 text-muted-foreground">
                                <FlavourLabel flavour={flavourName}>
                                  {flavourName} · {packSize?.label ?? ""}
                                </FlavourLabel>
                              </td>
                              <td className="px-2 py-2 font-mono text-[11px] text-muted-foreground">
                                {previewSku(brandName, pName, flavourName, packSize?.code)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Optional colour
                  </Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 rounded-full gap-1 px-3 text-xs"
                    onClick={() => setSheetFlavourOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    New flavour
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setSelColors([])}>
                      None
                    </Button>
                    {colors.map((c) => (
                      <Button
                        key={c.id}
                        type="button"
                        size="sm"
                        variant={selColors[0] === c.id ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => setSelColors([c.id])}
                      >
                        {c.name}
                      </Button>
                    ))}
                  </div>
              </div>
            )}
            <Separator className="my-2" />
            <div className="flex flex-wrap justify-between gap-3 pt-2">
              <Button type="button" variant="ghost" className="rounded-full" onClick={() => setStep(1)}>
                <ChevronLeft className="mr-1 size-4" /> Back
              </Button>
              <Button
                type="button"
                className="rounded-full px-8 font-semibold"
                disabled={busy || (pKind === "SUPPLEMENT" && matrix.length === 0)}
                onClick={() => void persistStep2()}
              >
                Continue <ChevronRight className="ml-1 size-4" />
              </Button>
            </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-6 rounded-2xl border border-border/50 bg-muted/5 p-6 shadow-inner sm:p-8">
          <p className="max-w-xl text-sm text-muted-foreground">
            These defaults apply to every variant on this product. Supplements use 5% (2.5+2.5 CGST/SGST);
            accessories often use 18% (9+9).
          </p>
          <div className="grid max-w-lg gap-5">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cost price (optional)
              </Label>
              <Input
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                type="number"
                min={0}
                className="h-11 rounded-xl border-2 border-border/60"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Selling price (list)
              </Label>
              <Input
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
                type="number"
                min={0}
                className="h-11 rounded-xl border-2 border-border/60"
              />
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/80 px-4 py-3">
              <input
                id="gst-inc"
                type="checkbox"
                className="size-4 rounded border-input"
                checked={gstInclusive}
                onChange={(e) => setGstInclusive(e.target.checked)}
              />
              <Label htmlFor="gst-inc" className="cursor-pointer text-sm font-medium">
                GST inclusive list price
              </Label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">CGST %</Label>
                <Input
                  className="h-11 rounded-xl border-2 border-border/60 tabular-nums"
                  value={cgstPct}
                  onChange={(e) => setCgstPct(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">SGST %</Label>
                <Input
                  className="h-11 rounded-xl border-2 border-border/60 tabular-nums"
                  value={sgstPct}
                  onChange={(e) => setSgstPct(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">IGST %</Label>
                <Input
                  className="h-11 rounded-xl border-2 border-border/60 tabular-nums"
                  value={igstPct}
                  onChange={(e) => setIgstPct(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Low-stock alert (units)
              </Label>
              <Input
                className="h-11 rounded-xl border-2 border-border/60 tabular-nums"
                value={lowStockThr}
                onChange={(e) => setLowStockThr(e.target.value)}
                placeholder="e.g. 5"
              />
            </div>
            <div className="flex flex-wrap justify-between gap-3 border-t border-border/40 pt-6">
              <Button type="button" variant="ghost" className="rounded-full" onClick={() => setStep(2)}>
                <ChevronLeft className="mr-1 size-4" /> Back
              </Button>
              <Button
                type="button"
                className="rounded-full px-8 font-semibold"
                disabled={busy}
                onClick={() => void persistStep3()}
              >
                Continue <ChevronRight className="ml-1 size-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-6 rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/5 via-card to-card p-6 shadow-inner sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <h4 className="text-lg font-semibold tracking-tight">Blueprint saved</h4>
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
              Ready for stock
            </Badge>
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            No inventory yet — receive stock from{" "}
            <Link to="/dashboard/purchases" className="font-medium text-foreground underline underline-offset-2">
              Purchases
            </Link>{" "}
            when goods arrive.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="rounded-full px-6 font-semibold">
              <Link to="/dashboard/purchases">Receive stock</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => {
                setStep(1);
                setProductId(null);
                setPName("");
                setMatrix([]);
                setSelColors([]);
                setSelSizes([]);
                setNameMatches([]);
              }}
            >
              Create another blueprint
            </Button>
            <Button type="button" variant="ghost" className="rounded-full" onClick={() => setView("browse")}>
              View records
            </Button>
          </div>
        </div>
      ) : null}
              </div>
            </div>
          </div>

          <Sheet open={sheetFlavourOpen} onOpenChange={setSheetFlavourOpen}>
            <SheetContent side="right" className="sm:max-w-md">
              <SheetHeader>
                <SheetTitle>New flavour</SheetTitle>
                <SheetDescription>Adds to your palette and selects it for this blueprint.</SheetDescription>
              </SheetHeader>
              <div className="mt-6 grid gap-4">
                <div className="space-y-2">
                  <Label>Flavour name</Label>
                  <Input
                    value={newFlavourName}
                    onChange={(e) => setNewFlavourName(e.target.value)}
                    placeholder="e.g. Chocolate"
                    className="h-11 rounded-xl"
                  />
                </div>
              </div>
              <SheetFooter className="mt-8">
                <Button type="button" variant="outline" onClick={() => setSheetFlavourOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" disabled={sheetFlavourBusy} onClick={() => void submitQuickFlavour()}>
                  {sheetFlavourBusy ? <Loader2 className="size-4 animate-spin" /> : "Save flavour"}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <Sheet open={sheetBrandOpen} onOpenChange={setSheetBrandOpen}>
            <SheetContent side="right" className="sm:max-w-md">
              <SheetHeader>
                <SheetTitle>New brand</SheetTitle>
                <SheetDescription>
                  Brands are a managed list so reports stay consistent — add each one once.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 grid gap-4">
                <div className="space-y-2">
                  <Label>Brand name</Label>
                  <Input
                    value={newBrandName}
                    onChange={(e) => setNewBrandName(e.target.value)}
                    placeholder="e.g. Optimum Nutrition"
                    className="h-11 rounded-xl"
                  />
                </div>
              </div>
              <SheetFooter className="mt-8">
                <Button type="button" variant="outline" onClick={() => setSheetBrandOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" disabled={sheetBrandBusy} onClick={() => void submitQuickBrand()}>
                  {sheetBrandBusy ? <Loader2 className="size-4 animate-spin" /> : "Save brand"}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <Sheet open={sheetSizeOpen} onOpenChange={setSheetSizeOpen}>
            <SheetContent side="right" className="sm:max-w-md">
              <SheetHeader>
                <SheetTitle>New pack size</SheetTitle>
                <SheetDescription>
                  Pick how the pack is measured, then choose a common size or type your own.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 grid gap-5">
                <div className="space-y-2">
                  <Label>Measured by</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {PACK_MEASURES.map((m) => (
                      <Button
                        key={m}
                        type="button"
                        variant={newSizeMeasure === m ? "default" : "outline"}
                        className="h-11 rounded-xl"
                        onClick={() => {
                          setNewSizeMeasure(m);
                          setNewSizeLabel("");
                        }}
                      >
                        {measureLabel(m)}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{measureHint(newSizeMeasure)}</p>
                </div>

                <div className="space-y-2">
                  <Label>Common sizes</Label>
                  <div className="flex flex-wrap gap-2">
                    {PACK_PRESETS[newSizeMeasure].map((preset) => (
                      <Button
                        key={preset}
                        type="button"
                        size="sm"
                        variant={newSizeLabel === preset ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => setNewSizeLabel(preset)}
                      >
                        {preset}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Or type it yourself</Label>
                  <Input
                    value={newSizeLabel}
                    onChange={(e) => setNewSizeLabel(e.target.value)}
                    placeholder={
                      newSizeMeasure === "WEIGHT"
                        ? "e.g. 750g"
                        : newSizeMeasure === "VOLUME"
                          ? "e.g. 330ml"
                          : "e.g. 45 tablets"
                    }
                    className="h-11 rounded-xl"
                  />
                  {newSizeLabel.trim() ? (
                    (() => {
                      const parsed = parsePackSizeLabel(newSizeLabel);
                      if (!parsed) {
                        return (
                          <p className="text-xs text-destructive">
                            Not understood — use a number with a unit (1kg, 500ml) or a plain count (60).
                          </p>
                        );
                      }
                      if (parsed.measure !== newSizeMeasure) {
                        return (
                          <p className="text-xs text-destructive">
                            Reads as {measureLabel(parsed.measure)}, but {measureLabel(newSizeMeasure)} is selected.
                          </p>
                        );
                      }
                      return (
                        <p className="text-xs text-muted-foreground">
                          Saves as <span className="font-medium text-foreground">{parsed.label}</span> · code{" "}
                          <span className="font-mono">{parsed.code}</span> · sorts by {parsed.normalizedValue}
                          {parsed.measure === "WEIGHT" ? "g" : parsed.measure === "VOLUME" ? "ml" : " pcs"}
                        </p>
                      );
                    })()
                  ) : null}
                </div>
              </div>
              <SheetFooter className="mt-8">
                <Button type="button" variant="outline" onClick={() => setSheetSizeOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" disabled={sheetSizeBusy} onClick={() => void submitQuickSize()}>
                  {sheetSizeBusy ? <Loader2 className="size-4 animate-spin" /> : "Save pack size"}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}
