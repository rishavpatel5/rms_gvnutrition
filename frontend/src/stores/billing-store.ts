import { create } from "zustand";
import { istYmd } from "@/lib/ist-time";

export type PaymentMethod = "cash" | "card" | "upi";

export type RetailDiscountType = "PERCENT" | "FLAT_AMOUNT";

export type PosCustomerSearchRow = {
  id: string;
  fullName: string;
  phone: string | null;
  orderCount: number;
  lifetimeSpend: string;
  lastPurchaseAt: string | null;
};

export type BillingLine = {
  id: string;
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  brandName: string | null;
  /** WAC (or catalog cost) per unit — shown so the owner can see the margin. */
  unitCost: number;
  flavourName: string | null;
  sku: string;
  qty: number;
  unitPrice: number;
  availableStock: number;
  gstPricingMode: "INCLUSIVE" | "EXCLUSIVE";
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  itemDiscountType: RetailDiscountType | null;
  itemDiscountValue: number | null;
  /**
   * Per-unit price the cashier negotiated via "Sell at". While set, the line
   * discount is re-derived on qty changes so the per-unit price holds
   * (1 × ₹3000 → 3 × ₹3000 = ₹9000). Cleared by any manual discount edit.
   */
  negotiatedUnitPrice: number | null;
  isGiveaway: boolean;
  giveawayReason: string | null;
};

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/**
 * Rupee item discount on the whole line, mirroring backend `resolveItemDiscountAmount`:
 * flat is a line-level amount, percent applies to qty × unitPrice; capped at gross.
 */
export function lineItemDiscountAmount(
  l: Pick<BillingLine, "qty" | "unitPrice" | "itemDiscountType" | "itemDiscountValue" | "isGiveaway">,
): number {
  const gross = l.qty * l.unitPrice;
  const v = l.itemDiscountValue ?? 0;
  if (l.isGiveaway || !l.itemDiscountType || v <= 0 || gross <= 0) return 0;
  const amt = l.itemDiscountType === "PERCENT" ? (gross * v) / 100 : v;
  return Math.min(Math.max(amt, 0), gross);
}

/**
 * Discount (in the given mode) that makes `qty × unitPrice` come to `total`.
 * A total at or above the gross means no discount.
 */
function discountForSellingTotal(
  unitPrice: number,
  qty: number,
  total: number,
  type: RetailDiscountType,
): Pick<BillingLine, "itemDiscountType" | "itemDiscountValue" | "negotiatedUnitPrice"> {
  const gross = unitPrice * qty;
  if (gross <= 0 || qty <= 0 || total >= gross) {
    return { itemDiscountType: null, itemDiscountValue: null, negotiatedUnitPrice: null };
  }
  const safeTotal = Math.max(total, 0);
  const off = gross - safeTotal;
  return {
    itemDiscountType: type,
    // 4dp matches the backend's Decimal(4) storage, so % lands on the typed price.
    itemDiscountValue: type === "PERCENT" ? round((off / gross) * 100, 4) : round(off, 2),
    negotiatedUnitPrice: safeTotal / qty,
  };
}

/** Re-apply a negotiated per-unit price after the line's qty changed. */
function withQty(l: BillingLine, qty: number): BillingLine {
  if (l.negotiatedUnitPrice == null || l.isGiveaway) return { ...l, qty };
  return {
    ...l,
    qty,
    ...discountForSellingTotal(
      l.unitPrice,
      qty,
      round(l.negotiatedUnitPrice * qty, 2),
      l.itemDiscountType ?? "FLAT_AMOUNT",
    ),
  };
}

type BillingState = {
  lines: BillingLine[];
  gstEnabled: boolean;
  payment: PaymentMethod;
  searchQuery: string;
  selectedProductId: string | null;
  selectedVariantIndex: number;
  /** POS customer: typed name (also used when linking). */
  posCustomerName: string;
  /** POS customer: typed phone (digits-friendly). */
  posCustomerPhone: string;
  /** When set, checkout sends `customerId` (server-trusted). */
  posLinkedCustomerId: string | null;
  /** Snapshot used to detect edits after a link. */
  posLinkedSnapshot: { fullName: string; phone: string } | null;
  /** Lightweight stats after link or selection. */
  posCustomerSummary: {
    orderCount: number;
    lifetimeSpend: string;
    lastPurchaseAt: string | null;
  } | null;
  cartDiscountType: RetailDiscountType | null;
  cartDiscountValue: number | null;
  /** IST sale date shown in POS; defaults to today. */
  saleDate: string;
  /** True when the cashier picked a date other than the live default. */
  saleDateExplicit: boolean;
  setSearchQuery: (q: string) => void;
  setSelectedProduct: (id: string | null) => void;
  setSelectedVariantIndex: (index: number) => void;
  setGstEnabled: (on: boolean) => void;
  setPayment: (p: PaymentMethod) => void;
  setPosCustomerName: (v: string) => void;
  setPosCustomerPhone: (v: string) => void;
  linkPosCustomer: (row: PosCustomerSearchRow) => void;
  clearPosCustomer: () => void;
  setLineItemDiscount: (
    lineId: string,
    type: RetailDiscountType,
    value: number,
  ) => void;
  clearLineItemDiscount: (lineId: string) => void;
  /**
   * Set the line's total selling price (what the customer pays for all units).
   * Fills the discount in `type` (defaults to the line's current mode, else ₹).
   */
  setLineSellingTotal: (lineId: string, total: number, type?: RetailDiscountType) => void;
  setLineGiveaway: (lineId: string, isGiveaway: boolean) => void;
  setLineGiveawayReason: (lineId: string, reason: string) => void;
  setCartDiscount: (type: RetailDiscountType, value: number) => void;
  clearCartDiscount: () => void;
  setSaleDate: (date: string, explicit?: boolean) => void;
  addOrIncrementLine: (
    line: Omit<
      BillingLine,
      | "id"
      | "qty"
      | "itemDiscountType"
      | "itemDiscountValue"
      | "negotiatedUnitPrice"
      | "isGiveaway"
      | "giveawayReason"
    > & { qty?: number; isGiveaway?: boolean },
  ) => void;
  setQty: (lineId: string, qty: number) => void;
  removeLine: (lineId: string) => void;
  clearCart: () => void;
};

function uid() {
  return crypto.randomUUID();
}

const defaultPosCustomer = {
  posCustomerName: "",
  posCustomerPhone: "",
  posLinkedCustomerId: null as string | null,
  posLinkedSnapshot: null as { fullName: string; phone: string } | null,
  posCustomerSummary: null as BillingState["posCustomerSummary"],
};

const defaultCartDiscount = {
  cartDiscountType: null as RetailDiscountType | null,
  cartDiscountValue: null as number | null,
};

export const useBillingStore = create<BillingState>((set, get) => ({
  lines: [],
  gstEnabled: true,
  payment: "cash",
  searchQuery: "",
  selectedProductId: null,
  selectedVariantIndex: 0,
  ...defaultPosCustomer,
  ...defaultCartDiscount,
  saleDate: istYmd(),
  saleDateExplicit: false,
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedProduct: (selectedProductId) =>
    set({ selectedProductId, selectedVariantIndex: 0 }),
  setSelectedVariantIndex: (selectedVariantIndex) => set({ selectedVariantIndex }),
  setGstEnabled: (gstEnabled) => set({ gstEnabled }),
  setPayment: (payment) => set({ payment }),
  setPosCustomerName: (posCustomerName) =>
    set((s) => {
      if (
        s.posLinkedSnapshot &&
        posCustomerName.trim() !== s.posLinkedSnapshot.fullName.trim()
      ) {
        return {
          posCustomerName,
          posLinkedCustomerId: null,
          posLinkedSnapshot: null,
          posCustomerSummary: null,
        };
      }
      return { posCustomerName };
    }),
  setPosCustomerPhone: (posCustomerPhone) =>
    set((s) => {
      const nextDigits = posCustomerPhone.replace(/\D/g, "");
      const snapDigits = (s.posLinkedSnapshot?.phone ?? "").replace(/\D/g, "");
      if (s.posLinkedSnapshot && nextDigits !== snapDigits) {
        return {
          posCustomerPhone,
          posLinkedCustomerId: null,
          posLinkedSnapshot: null,
          posCustomerSummary: null,
        };
      }
      return { posCustomerPhone };
    }),
  linkPosCustomer: (row) =>
    set({
      posLinkedCustomerId: row.id,
      posCustomerName: row.fullName,
      posCustomerPhone: row.phone ?? "",
      posLinkedSnapshot: {
        fullName: row.fullName,
        phone: row.phone ?? "",
      },
      posCustomerSummary: {
        orderCount: row.orderCount,
        lifetimeSpend: row.lifetimeSpend,
        lastPurchaseAt: row.lastPurchaseAt,
      },
    }),
  clearPosCustomer: () => set({ ...defaultPosCustomer }),
  setLineItemDiscount: (lineId, itemDiscountType, itemDiscountValue) =>
    set({
      lines: get().lines.map((l) =>
        l.id === lineId
          ? { ...l, itemDiscountType, itemDiscountValue, negotiatedUnitPrice: null }
          : l,
      ),
    }),
  clearLineItemDiscount: (lineId) =>
    set({
      lines: get().lines.map((l) =>
        l.id === lineId
          ? { ...l, itemDiscountType: null, itemDiscountValue: null, negotiatedUnitPrice: null }
          : l,
      ),
    }),
  setLineSellingTotal: (lineId, total, type) =>
    set({
      lines: get().lines.map((l) =>
        l.id === lineId && !l.isGiveaway
          ? {
              ...l,
              ...discountForSellingTotal(
                l.unitPrice,
                l.qty,
                total,
                type ?? l.itemDiscountType ?? "FLAT_AMOUNT",
              ),
            }
          : l,
      ),
    }),
  setLineGiveaway: (lineId, isGiveaway) =>
    set({
      lines: get().lines.map((l) =>
        l.id === lineId
          ? {
              ...l,
              isGiveaway,
              giveawayReason: isGiveaway ? l.giveawayReason : null,
              itemDiscountType: isGiveaway ? null : l.itemDiscountType,
              itemDiscountValue: isGiveaway ? null : l.itemDiscountValue,
              negotiatedUnitPrice: isGiveaway ? null : l.negotiatedUnitPrice,
            }
          : l,
      ),
    }),
  setLineGiveawayReason: (lineId, giveawayReason) =>
    set({
      lines: get().lines.map((l) =>
        l.id === lineId ? { ...l, giveawayReason: giveawayReason.trim() || null } : l,
      ),
    }),
  setCartDiscount: (cartDiscountType, cartDiscountValue) =>
    set({ cartDiscountType, cartDiscountValue }),
  clearCartDiscount: () => set({ ...defaultCartDiscount }),
  setSaleDate: (date, explicit = true) =>
    set({ saleDate: date, saleDateExplicit: explicit }),
  addOrIncrementLine: (payload) => {
    const { lines } = get();
    const isGiveaway = payload.isGiveaway ?? false;
    const match = lines.find(
      (l) => l.variantId === payload.variantId && l.isGiveaway === isGiveaway,
    );
    const addQty = payload.qty ?? 1;
    if (match) {
      set({
        lines: lines.map((l) =>
          l.id === match.id ? withQty(l, Math.min(l.availableStock, l.qty + addQty)) : l,
        ),
      });
      return;
    }
    set({
      lines: [
        ...lines,
        {
          id: uid(),
          productId: payload.productId,
          variantId: payload.variantId,
          name: payload.name,
          variantLabel: payload.variantLabel,
          brandName: payload.brandName ?? null,
          unitCost: payload.unitCost ?? 0,
          flavourName: payload.flavourName ?? null,
          sku: payload.sku,
          qty: Math.min(payload.availableStock, addQty),
          unitPrice: payload.unitPrice,
          availableStock: payload.availableStock,
          gstPricingMode: payload.gstPricingMode,
          cgstRate: payload.cgstRate,
          sgstRate: payload.sgstRate,
          igstRate: payload.igstRate,
          itemDiscountType: null,
          itemDiscountValue: null,
          negotiatedUnitPrice: null,
          isGiveaway,
          giveawayReason: null,
        },
      ],
    });
  },
  setQty: (lineId, qty) => {
    const next = Math.max(0, Math.floor(qty));
    if (next === 0) {
      get().removeLine(lineId);
      return;
    }
    set({
      lines: get().lines.map((l) =>
        l.id === lineId ? withQty(l, Math.min(next, l.availableStock)) : l,
      ),
    });
  },
  removeLine: (lineId) =>
    set({ lines: get().lines.filter((l) => l.id !== lineId) }),
  clearCart: () =>
    set({
      lines: [],
      searchQuery: "",
      selectedProductId: null,
      selectedVariantIndex: 0,
      saleDate: istYmd(),
      saleDateExplicit: false,
      ...defaultPosCustomer,
      ...defaultCartDiscount,
    }),
}));

export function buildPosQuotePayload(input: {
  lines: BillingLine[];
  gstEnabled: boolean;
  cartDiscountType: RetailDiscountType | null;
  cartDiscountValue: number | null;
}) {
  const body: Record<string, unknown> = {
    gstEnabled: input.gstEnabled,
    gstPricingMode: "INCLUSIVE",
    currency: "INR",
    lines: input.lines.map((l) => ({
      variantId: l.variantId,
      quantity: l.qty,
      unitPrice: l.unitPrice.toFixed(2),
      gstPricingMode: l.gstPricingMode,
      cgstRate: l.cgstRate,
      sgstRate: l.sgstRate,
      igstRate: l.igstRate,
      ...(l.itemDiscountType && l.itemDiscountValue != null && !l.isGiveaway
        ? {
            itemDiscountType: l.itemDiscountType,
            itemDiscountValue: String(l.itemDiscountValue),
          }
        : {}),
      ...(l.isGiveaway
        ? {
            isGiveaway: true,
            ...(l.giveawayReason ? { giveawayReason: l.giveawayReason } : {}),
          }
        : {}),
    })),
  };
  if (input.cartDiscountType && input.cartDiscountValue != null && input.cartDiscountValue > 0) {
    body.cartDiscount = {
      type: input.cartDiscountType,
      value: String(input.cartDiscountValue),
    };
  }
  return body;
}

export function buildPosCheckoutPayload(
  input: Parameters<typeof buildPosQuotePayload>[0] & {
    payment: PaymentMethod;
    grandTotal: string;
    posLinkedCustomerId: string | null;
    posCustomerName: string;
    posCustomerPhone: string;
    saleDateExplicit: boolean;
    saleDate: string;
  },
) {
  const checkout = buildPosQuotePayload(input) as Record<string, unknown>;
  if (input.saleDateExplicit) {
    checkout.saleDate = input.saleDate;
  }
  checkout.payments = [
    {
      method:
        input.payment === "cash" ? "CASH" : input.payment === "card" ? "CARD" : "UPI",
      amount: input.grandTotal,
      nature: "RECEIPT",
    },
  ];
  if (input.posLinkedCustomerId) {
    checkout.customerId = input.posLinkedCustomerId;
  } else {
    const name = input.posCustomerName.trim();
    const phone = input.posCustomerPhone.trim();
    const phoneDigits = phone.replace(/\D/g, "");
    if (name.length > 0 || phoneDigits.length > 0) {
      checkout.customerSnapshot = {
        ...(name ? { fullName: name } : {}),
        ...(phone ? { phone } : {}),
      };
    }
  }
  return checkout;
}
