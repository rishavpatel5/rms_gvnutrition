export type RetailDiscountType = "PERCENT" | "FLAT_AMOUNT";

export type PosQuoteLine = {
  variantId: string;
  quantity: number;
  unitPrice: string;
  grossAmount: string;
  itemDiscountType: RetailDiscountType | null;
  itemDiscountValue: string | null;
  itemDiscountAmount: string;
  cartDiscountAllocated: string;
  lineDiscount: string;
  taxableValue: string;
  cgstRate: string;
  sgstRate: string;
  igstRate: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
  isGiveaway: boolean;
  giveawayReason: string | null;
};

export type PosQuoteTotals = {
  grossSubtotal: string;
  subtotal: string;
  itemDiscountTotal: string;
  cartDiscountAmount: string;
  discountTotal: string;
  taxableValue: string;
  cgstTotal: string;
  sgstTotal: string;
  igstTotal: string;
  grandTotal: string;
  roundingAdjustment: string;
};

export type PosQuote = {
  lines: PosQuoteLine[];
  totals: PosQuoteTotals;
  cartDiscount: {
    type: RetailDiscountType | null;
    value: string | null;
    amount: string;
  };
  /** Live on-hand stock for each variant on the bill (server-side, at quote time). */
  stockByVariant?: Record<string, number>;
};
