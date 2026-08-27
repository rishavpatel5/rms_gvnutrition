import { GstPricingMode, PackSizeMeasure, ProductKind } from "@prisma/client";
import { z } from "zod";

const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid slug format");

/** HSN is optional everywhere — blank simply does not print on the invoice. */
const hsnCodeSchema = z.string().trim().max(16).optional().nullable();

/** Brand is NOT here — it lives on the variant, so one product can span companies. */
export const createProductBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  kind: z.nativeEnum(ProductKind),
  hsnCode: hsnCodeSchema,
});

export const updateProductBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  slug: slugSchema.optional(),
  kind: z.nativeEnum(ProductKind).optional(),
  hsnCode: hsnCodeSchema,
  isActive: z.boolean().optional(),
});

export const createVariantBodySchema = z.object({
  /**
   * Optional — omit it and the server generates a unique code. The owner never
   * types SKUs; they exist only so bulk import and POS lookup can match a row.
   */
  sku: z.string().trim().min(2).max(64).optional(),
  listPrice: z.coerce.number().finite().min(0).max(1_000_000).optional().default(0),
  costPrice: z.coerce.number().finite().min(0).max(1_000_000).optional().nullable(),
  gstEnabled: z.boolean().optional(),
  gstPricingMode: z.nativeEnum(GstPricingMode).optional(),
  cgstRate: z.coerce.number().finite().min(0).max(100).optional(),
  sgstRate: z.coerce.number().finite().min(0).max(100).optional(),
  igstRate: z.coerce.number().finite().min(0).max(100).optional(),
  lowStockThreshold: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
  brandId: z.string().cuid().optional().nullable(),
  flavourId: z.string().cuid().optional().nullable(),
  packSizeId: z.string().cuid().optional().nullable(),
});

export const updateVariantBodySchema = z.object({
  sku: z.string().trim().min(2).max(64).optional(),
  listPrice: z.coerce.number().finite().min(0).max(1_000_000).optional(),
  costPrice: z.coerce.number().finite().min(0).max(1_000_000).optional().nullable(),
  gstEnabled: z.boolean().optional(),
  gstPricingMode: z.nativeEnum(GstPricingMode).optional(),
  cgstRate: z.coerce.number().finite().min(0).max(100).optional(),
  sgstRate: z.coerce.number().finite().min(0).max(100).optional(),
  igstRate: z.coerce.number().finite().min(0).max(100).optional(),
  lowStockThreshold: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
  brandId: z.string().cuid().optional().nullable(),
  flavourId: z.string().cuid().optional().nullable(),
  packSizeId: z.string().cuid().optional().nullable(),
  isActive: z.boolean().optional(),
  /** Rebuild BRAND-PRODUCT-FLAVOUR-PACKSIZE from the post-update attributes. */
  regenerateSku: z.boolean().optional(),
});

export const createFlavourBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});

/**
 * Pack sizes are shared rows, not per-product free text. `normalizedValue` is the
 * magnitude in the measure's base unit (grams / millilitres / pieces) and exists
 * purely so listings sort correctly — "500g" must not sort before "1kg".
 */
export const createPackSizeBodySchema = z.object({
  label: z.string().trim().min(1).max(50),
  code: z.string().trim().min(1).max(32),
  measure: z.nativeEnum(PackSizeMeasure),
  normalizedValue: z.coerce.number().finite().positive().max(1_000_000),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});

export const createBrandBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});
