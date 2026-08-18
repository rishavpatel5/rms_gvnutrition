import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Flavour-aware label (replaces the apparel colour-swatch components).
 *
 * Deliberately has NO colour swatch. Flavours are owner-defined free text — there
 * is no canonical colour for "Cookies & Cream", and a guessed palette would fight
 * the black-and-white theme. A neutral marker keeps the visual rhythm of the old
 * layout without inventing meaning.
 */
export function FlavourDot({
  flavour,
  className,
}: {
  flavour?: string | null;
  className?: string;
}) {
  if (!flavour?.trim()) return null;
  return (
    <span
      aria-label={flavour}
      title={flavour}
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full border border-foreground/25 bg-foreground/15",
        className,
      )}
    />
  );
}

export function FlavourLabel({
  flavour,
  children,
  className,
  dotClassName,
}: {
  flavour?: string | null;
  children: ReactNode;
  className?: string;
  dotClassName?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <FlavourDot flavour={flavour} className={dotClassName} />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
