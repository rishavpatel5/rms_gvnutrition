import { GstPricingMode, PurchaseOrderStatus } from "@prisma/client";
import { z } from "zod";

const decimalLike = z.coerce.number().finite();

export const createPurchaseOrderBodySchema = z.object({
  supplierId: z.string().cuid(),
});

export const updatePurchaseOrderBodySchema = z.object({
  status: z.nativeEnum(PurchaseOrderStatus).optional(),
});

export const purchaseLineInputSchema = z.object({
  variantId: z.string().cuid(),
  quantityOrdered: z.coerce.number().int().min(1).max(1_000_000),
  unitCost: decimalLike.min(0).max(1_000_000),
  /**
   * New selling price (MRP) for this variant, applied to the catalog when the
   * line is RECEIVED. Optional: omit — or send 0 — to leave the shelf price
   * alone. Master data only; it never enters a purchase total, GST figure or WAC.
   */
  listPrice: decimalLike.min(0).max(1_000_000).optional(),
  gstEnabled: z.boolean().optional().default(true),
  gstPricingMode: z.nativeEnum(GstPricingMode).optional().default(GstPricingMode.EXCLUSIVE),
  cgstRate: decimalLike.min(0).max(100).optional().default(0),
  sgstRate: decimalLike.min(0).max(100).optional().default(0),
  igstRate: decimalLike.min(0).max(100).optional().default(0),
});

export const replacePurchaseLinesBodySchema = z.object({
  lines: z.array(purchaseLineInputSchema).min(1).max(500),
});

export const receivePurchaseBodySchema = z.object({
  /** Per line receive; omit to receive all remaining quantities. */
  lines: z
    .array(
      z.object({
        itemId: z.string().cuid(),
        quantity: z.coerce.number().int().min(1).max(1_000_000),
      }),
    )
    .optional(),
});

export const recordPurchasePaymentBodySchema = z.object({
  amount: decimalLike.min(0.01).max(1_000_000_000),
});
