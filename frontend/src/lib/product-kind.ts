export const PRODUCT_KINDS = ["SUPPLEMENT", "ACCESSORY"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export function kindLabel(kind: string): string {
  return kind === "SUPPLEMENT" ? "Supplements" : "Accessories";
}

/**
 * Split a list into the two catalog tabs. Anything not explicitly ACCESSORY is
 * treated as a supplement — supplements are the bulk of the business, so an
 * unknown value falls into the main tab rather than being hidden in Accessories.
 */
export function splitByProductKind<T extends { kind?: string; productKind?: string }>(
  items: T[],
): { supplement: T[]; accessory: T[] } {
  const supplement: T[] = [];
  const accessory: T[] = [];
  for (const item of items) {
    const k = item.productKind ?? item.kind;
    if (k === "ACCESSORY") accessory.push(item);
    else supplement.push(item);
  }
  return { supplement, accessory };
}
