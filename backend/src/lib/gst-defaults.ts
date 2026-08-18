import { ProductKind } from "@prisma/client";

/**
 * Intra-state CGST+SGST split: supplements 5% (2.5+2.5), accessories 18% (9+9).
 *
 * These are the SAME numbers the apparel system used (apparel 5%, accessories 18%) —
 * only the enum name changed. The GST engine itself is untouched.
 */
export function defaultIntraStateGstPercentages(kind: ProductKind): {
  cgst: number;
  sgst: number;
  igst: number;
} {
  if (kind === "SUPPLEMENT") {
    return { cgst: 2.5, sgst: 2.5, igst: 0 };
  }
  return { cgst: 9, sgst: 9, igst: 0 };
}
