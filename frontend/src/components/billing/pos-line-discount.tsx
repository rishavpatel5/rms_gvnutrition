import { useState } from "react";
import { cn } from "@/lib/utils";
import type { BillingLine, RetailDiscountType } from "@/stores/billing-store";
import { lineItemDiscountAmount, useBillingStore } from "@/stores/billing-store";

type Props = {
  line: BillingLine;
};

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

const fieldBox =
  "flex h-9 items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 transition-colors focus-within:border-foreground/50 focus-within:ring-2 focus-within:ring-ring/20";
const fieldInput =
  "h-full w-full min-w-0 flex-1 appearance-none bg-transparent text-right text-sm font-semibold tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const fieldLabel = "mb-1 block text-[11px] font-medium text-muted-foreground";

export function PosLineDiscount({ line }: Props) {
  const setLineItemDiscount = useBillingStore((s) => s.setLineItemDiscount);
  const clearLineItemDiscount = useBillingStore((s) => s.clearLineItemDiscount);
  const setLineSellingTotal = useBillingStore((s) => s.setLineSellingTotal);
  // While the cashier is typing a selling price, show exactly what they typed;
  // otherwise the field is derived from the stored discount.
  const [priceDraft, setPriceDraft] = useState<string | null>(null);

  if (line.isGiveaway) return null;

  // Default to flat (₹); percent only when explicitly selected.
  const mode: "percent" | "flat" =
    line.itemDiscountType === "PERCENT" ? "percent" : "flat";

  const activeType: RetailDiscountType = mode === "percent" ? "PERCENT" : "FLAT_AMOUNT";
  const presets = mode === "percent" ? [5, 10, 15, 20] : [49, 99, 199, 299];

  const gross = line.qty * line.unitPrice;
  /** What the customer pays for the whole line (all units), before any cart discount. */
  const derivedTotal = round(gross - lineItemDiscountAmount(line), 2);
  const hasDiscount = Boolean(line.itemDiscountType || line.itemDiscountValue);

  /** Negotiated line total → discount in whichever mode is selected. */
  function applySellingTotal(raw: string) {
    setPriceDraft(raw);
    if (raw === "") {
      clearLineItemDiscount(line.id);
      return;
    }
    const total = Number(raw);
    if (Number.isNaN(total) || total < 0) return;
    setLineSellingTotal(line.id, total, activeType);
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label
          className="min-w-0"
          title="Total selling price for this line (all units) — fills the discount automatically"
        >
          <span className={fieldLabel}>
            Sell at{line.qty > 1 ? ` (${line.qty} units)` : ""}
          </span>
          <div className={fieldBox}>
            <span className="text-sm text-muted-foreground">₹</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={gross}
              step={1}
              placeholder={String(gross)}
              aria-label="Selling price for this line"
              value={priceDraft ?? derivedTotal}
              onFocus={(e) => {
                setPriceDraft(String(derivedTotal));
                e.currentTarget.select();
              }}
              onBlur={() => setPriceDraft(null)}
              onChange={(e) => applySellingTotal(e.target.value)}
              className={fieldInput}
            />
          </div>
        </label>
        <div className="min-w-0">
          <span className={fieldLabel}>Discount</span>
          <div className={cn(fieldBox, "pl-1")}>
            <select
              className="h-7 w-11 shrink-0 cursor-pointer rounded-md bg-muted/60 px-1 text-xs font-medium outline-none"
              value={mode}
              aria-label="Discount type"
              onChange={(e) => {
                const t = e.target.value as "percent" | "flat";
                const type: RetailDiscountType = t === "flat" ? "FLAT_AMOUNT" : "PERCENT";
                if (line.negotiatedUnitPrice != null) {
                  // Keep the negotiated price; just re-express the discount in the new mode.
                  setLineSellingTotal(line.id, derivedTotal, type);
                } else {
                  setLineItemDiscount(line.id, type, line.itemDiscountValue ?? 0);
                }
              }}
            >
              <option value="flat">₹</option>
              <option value="percent">%</option>
            </select>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={mode === "percent" ? 1 : 10}
              max={mode === "percent" ? 100 : undefined}
              placeholder="0"
              aria-label="Discount"
              value={line.itemDiscountValue ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  clearLineItemDiscount(line.id);
                  return;
                }
                const v = Number(raw);
                if (Number.isNaN(v)) return;
                setLineItemDiscount(line.id, activeType, v);
              }}
              className={fieldInput}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
              line.itemDiscountType === activeType && line.itemDiscountValue === p
                ? "border-foreground bg-foreground text-background"
                : "border-border/80 text-muted-foreground hover:bg-muted/60",
            )}
            onClick={() => setLineItemDiscount(line.id, activeType, p)}
          >
            {mode === "percent" ? `${p}%` : `₹${p}`}
          </button>
        ))}
        {hasDiscount && (
          <button
            type="button"
            className="ml-auto text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => {
              setPriceDraft(null);
              clearLineItemDiscount(line.id);
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
