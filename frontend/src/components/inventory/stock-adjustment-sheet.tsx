import { Loader2, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiGetJsonAuthed, apiPostJsonAuthed } from "@/lib/api-client";
import { BrandTag } from "@/components/catalog/brand-tag";
import { cn } from "@/lib/utils";

/**
 * Manual stock write-off / correction.
 *
 * EXPIRED is deliberately its own reason (not folded into DAMAGE) so expiry loss
 * is reportable on its own. NO expiry dates are captured anywhere — staff spot an
 * expired product on the shelf and write it off here.
 *
 * This posts to the existing /inventory/adjustments endpoint, so quantity leaves
 * through the same append-only ledger as every other movement. Inventory value
 * follows automatically (valuation = on-hand qty x WAC) and cash is untouched —
 * that money left when the supplier was paid.
 */

type Reason = "EXPIRED" | "DAMAGE" | "SHRINKAGE" | "FOUND" | "CORRECTION" | "OTHER";

const REASONS: { value: Reason; label: string; hint: string; direction: "out" | "in" | "either" }[] = [
  { value: "EXPIRED", label: "Expired", hint: "Past its date — total write-off", direction: "out" },
  { value: "DAMAGE", label: "Damaged", hint: "Torn, leaking or unsellable", direction: "out" },
  { value: "SHRINKAGE", label: "Shrinkage", hint: "Missing or lost stock", direction: "out" },
  { value: "FOUND", label: "Found", hint: "Stock located that wasn't counted", direction: "in" },
  { value: "CORRECTION", label: "Correction", hint: "Fixing a miscount", direction: "either" },
  { value: "OTHER", label: "Other", hint: "Anything else — add a note", direction: "either" },
];

type VariantHit = {
  id: string;
  sku: string;
  product: { name: string };
  brand: { name: string } | null;
  flavour: { name: string } | null;
  packSize: { label: string } | null;
  inventory: { quantity: number } | null;
};

type DraftLine = {
  variantId: string;
  brandName: string | null;
  label: string;
  sku: string;
  onHand: number;
  quantity: number;
};

export function StockAdjustmentSheet({
  open,
  onOpenChange,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
}) {
  const [reason, setReason] = useState<Reason>("EXPIRED");
  const [note, setNote] = useState("");
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<VariantHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);

  const selectedReason = REASONS.find((r) => r.value === reason)!;
  // FOUND adds stock back; everything else takes it out.
  const isInbound = selectedReason.direction === "in";

  useEffect(() => {
    if (open) return;
    setReason("EXPIRED");
    setNote("");
    setTerm("");
    setHits([]);
    setLines([]);
  }, [open]);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const res = await apiGetJsonAuthed<{ matches: VariantHit[] }>(
            `/api/v1/catalog/variants/lookup?q=${encodeURIComponent(q)}`,
          );
          if (!cancelled) setHits(res.matches ?? []);
        } catch (e) {
          // Never swallow this: a silent catch here made a server 500 look like
          // "no results", which is indistinguishable from an empty search.
          if (!cancelled) {
            setHits([]);
            toast.error(e instanceof Error ? e.message : "Product search failed");
          }
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const addLine = useCallback((v: VariantHit) => {
    setLines((prev) => {
      if (prev.some((l) => l.variantId === v.id)) return prev;
      const variantLabel = [v.flavour?.name, v.packSize?.label].filter(Boolean).join(" / ");
      return [
        ...prev,
        {
          variantId: v.id,
          brandName: v.brand?.name ?? null,
          label: variantLabel ? `${v.product.name} · ${variantLabel}` : v.product.name,
          sku: v.sku,
          onHand: v.inventory?.quantity ?? 0,
          quantity: 1,
        },
      ];
    });
    setTerm("");
    setHits([]);
  }, []);

  function setQty(variantId: string, qty: number) {
    setLines((prev) =>
      prev.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.max(0, qty) } : l)),
    );
  }

  async function submit() {
    const usable = lines.filter((l) => l.quantity > 0);
    if (usable.length === 0) {
      toast.error("Add at least one product with a quantity.");
      return;
    }
    // Outbound adjustments can never take stock negative — the ledger rejects it
    // server-side too, but catching it here gives a clearer message.
    if (!isInbound) {
      const over = usable.find((l) => l.quantity > l.onHand);
      if (over) {
        toast.error(`${over.sku}: only ${over.onHand} in stock, cannot remove ${over.quantity}.`);
        return;
      }
    }

    setBusy(true);
    try {
      await apiPostJsonAuthed("/api/v1/inventory/adjustments", {
        reason,
        note: note.trim() || null,
        lines: usable.map((l) => ({
          variantId: l.variantId,
          quantityDelta: isInbound ? l.quantity : -l.quantity,
          movementType: isInbound
            ? "ADJUSTMENT_IN"
            : reason === "EXPIRED" || reason === "DAMAGE"
              ? "DAMAGE_OUT"
              : "ADJUSTMENT_OUT",
        })),
      });
      const units = usable.reduce((sum, l) => sum + l.quantity, 0);
      toast.success(
        `${selectedReason.label}: ${units} unit${units === 1 ? "" : "s"} ${isInbound ? "added" : "written off"}.`,
      );
      onOpenChange(false);
      onCompleted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the adjustment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Adjust stock</SheetTitle>
          <SheetDescription>
            Write off expired or damaged stock, or correct a miscount. Inventory value updates
            automatically; cash is not affected.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Reason</Label>
            <div className="grid grid-cols-2 gap-2">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReason(r.value)}
                  className={cn(
                    "rounded-xl border-2 px-3 py-2.5 text-left transition-colors",
                    reason === r.value
                      ? "border-primary bg-primary/5"
                      : "border-border/60 hover:border-border",
                  )}
                >
                  <div className="text-sm font-semibold">{r.label}</div>
                  <div className="text-xs text-muted-foreground">{r.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Find product</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search by name, SKU, flavour or pack size…"
                className="h-11 rounded-xl pl-9"
              />
              {searching ? (
                <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            {hits.length > 0 ? (
              <ul className="max-h-52 overflow-y-auto rounded-xl border border-border/60 divide-y divide-border/60">
                {hits.map((v) => {
                  const variantLabel = [v.flavour?.name, v.packSize?.label].filter(Boolean).join(" / ");
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => addLine(v)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/50"
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <BrandTag brand={v.brand?.name} />
                            <span className="min-w-0 truncate font-medium">{v.product.name}</span>
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {v.sku}
                            {variantLabel ? ` · ${variantLabel}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {v.inventory?.quantity ?? 0} in stock
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          {lines.length > 0 ? (
            <div className="space-y-2">
              <Label>{isInbound ? "Adding" : "Removing"}</Label>
              <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
                {lines.map((l) => {
                  const tooMany = !isInbound && l.quantity > l.onHand;
                  return (
                    <li key={l.variantId} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <BrandTag brand={l.brandName} />
                          <span className="truncate text-sm font-medium">{l.label}</span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {l.sku} · {l.onHand} in stock
                        </div>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        value={l.quantity}
                        onChange={(e) => setQty(l.variantId, Number(e.target.value))}
                        className={cn(
                          "h-9 w-20 rounded-lg text-right tabular-nums",
                          tooMany && "border-destructive text-destructive",
                        )}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-9 shrink-0"
                        onClick={() =>
                          setLines((prev) => prev.filter((x) => x.variantId !== l.variantId))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Note {reason === "OTHER" ? "" : "(optional)"}</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. found during monthly shelf check"
              className="h-11 rounded-xl"
            />
          </div>
        </div>

        <SheetFooter className="mt-6 shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Save adjustment"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
