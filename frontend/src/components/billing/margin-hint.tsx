import { cn } from "@/lib/utils";

/**
 * Margin helper for the counter: how much room is left before a discount eats
 * the profit on a line or on the whole bill.
 *
 * IMPORTANT — margin is measured against the TAXABLE value, never the MRP.
 * With GST-inclusive pricing a ₹4,200 tub is ₹4,000 of yours plus ₹200 of the
 * government's; comparing ₹4,200 to cost would overstate the margin by the GST
 * and tempt a discount that actually loses money.
 *
 * Cost is the same basis the rest of the system uses for COGS: weighted average
 * cost from received purchase lines, falling back to the catalog cost price.
 * This is display only — it never touches pricing, GST or valuation.
 */

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

export type MarginFigures = {
  /** Revenue that is actually yours — ex-GST, after discount. */
  taxable: number;
  /** Unit cost × quantity. */
  cost: number;
};

export function marginOf({ taxable, cost }: MarginFigures) {
  const profit = taxable - cost;
  // Percent of the selling side, so it reads as "margin", not "markup".
  const pct = taxable > 0 ? (profit / taxable) * 100 : 0;
  return { profit, pct, belowCost: cost > 0 && profit < 0 };
}

/** Compact inline margin, for a single cart line. */
export function MarginHint({
  taxable,
  cost,
  className,
}: MarginFigures & { className?: string }) {
  if (!cost) return null; // no cost recorded yet — say nothing rather than imply zero cost
  const { profit, pct, belowCost } = marginOf({ taxable, cost });
  return (
    <span
      className={cn(
        "tabular-nums",
        belowCost ? "font-semibold text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      cost {inr(cost)} · {belowCost ? "LOSS " : "margin "}
      {inr(profit)} ({pct.toFixed(0)}%)
    </span>
  );
}

/**
 * Cost line for the selected variant, showing the average AND the most recent
 * purchase rate.
 *
 * Why both: WAC is what the stock ON HAND cost and is the right basis for
 * today's margin. The latest rate is what the NEXT delivery costs. When a
 * supplier raises the price, WAC lags behind and a healthy-looking margin can
 * hide the fact that the MRP no longer covers a refill — so the latest rate is
 * called out separately, and flagged when it has moved above the selling price.
 */
export function VariantCostLine({
  taxableAtList,
  wac,
  lastCost,
}: {
  taxableAtList: number;
  wac: number;
  lastCost: number | null;
}) {
  if (!wac) return null;
  const { profit, pct, belowCost } = marginOf({ taxable: taxableAtList, cost: wac });
  const rateRose = lastCost != null && lastCost > wac + 0.01;
  const latestBeatsPrice = lastCost != null && lastCost >= taxableAtList;

  return (
    <span className="block space-y-0.5">
      <span
        className={cn(
          "block tabular-nums",
          belowCost ? "font-semibold text-destructive" : "text-muted-foreground",
        )}
      >
        avg cost {inr(wac)} · {belowCost ? "LOSS " : "margin "}
        {inr(profit)} ({pct.toFixed(0)}%)
      </span>
      {lastCost != null ? (
        <span
          className={cn(
            "block tabular-nums",
            latestBeatsPrice
              ? "font-semibold text-destructive"
              : rateRose
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-foreground",
          )}
        >
          last bought at {inr(lastCost)}
          {latestBeatsPrice
            ? " — above your selling price, raise the MRP"
            : rateRose
              ? " — supplier rate has gone up"
              : ""}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Bill-level summary with the floor price — the lowest total that still breaks
 * even, which is the number the owner actually wants when deciding a discount.
 */
export function MarginSummary({
  taxable,
  cost,
  gstEnabled,
}: MarginFigures & { gstEnabled: boolean }) {
  if (!cost) return null;
  const { profit, pct, belowCost } = marginOf({ taxable, cost });
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5 text-xs",
        belowCost ? "border-destructive/50 bg-destructive/5" : "border-border/70 bg-muted/30",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Stock cost</span>
        <span className="tabular-nums font-medium">{inr(cost)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className="text-muted-foreground">
          {belowCost ? "Loss on this bill" : "Profit on this bill"}
        </span>
        <span
          className={cn(
            "tabular-nums font-semibold",
            belowCost ? "text-destructive" : "text-foreground",
          )}
        >
          {inr(profit)} ({pct.toFixed(0)}%)
        </span>
      </div>
      <p className="mt-1.5 leading-snug text-muted-foreground">
        {belowCost
          ? "This bill is below cost — reduce the discount."
          : `You can discount up to ${inr(profit)} more before this bill stops making money.`}
        {gstEnabled ? " Measured ex-GST." : ""}
      </p>
    </div>
  );
}
