import { cn } from "@/lib/utils";

/**
 * Small brand chip shown next to a variant anywhere it appears.
 *
 * Brand lives on the VARIANT, so it is often the only thing separating two
 * otherwise-identical items ("Whey Protein · Chocolate · 500g" from two
 * companies). Keeping it visible everywhere is what makes billing unambiguous.
 *
 * Styling note: it deliberately uses NO fixed colours. `border-current` +
 * `text-current` + a low opacity means it inherits whatever it sits on — dark
 * ink on a light row, light ink on a selected black chip. A hardcoded grey
 * looked dirty against the black selected state in the POS.
 * Renders nothing when a variant has no brand, so layouts stay tidy.
 */
export function BrandTag({
  brand,
  className,
}: {
  brand?: string | null;
  className?: string;
}) {
  if (!brand?.trim()) return null;
  return (
    <span
      title={brand}
      className={cn(
        "inline-flex max-w-[140px] shrink-0 items-center truncate rounded-full",
        "border border-current px-1.5 py-[1px]",
        "text-[9px] font-semibold uppercase leading-[1.4] tracking-[0.1em]",
        "opacity-50",
        className,
      )}
    >
      {brand}
    </span>
  );
}
