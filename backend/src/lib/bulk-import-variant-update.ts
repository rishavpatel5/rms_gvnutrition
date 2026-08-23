import { Prisma } from "@prisma/client";

/**
 * Which master fields a bulk-import row updates on an EXISTING variant (same SKU).
 * Scope is deliberately narrow (approved):
 *  - costPrice / listPrice update ONLY when the sheet value is > 0 (blank/0 preserves existing).
 *  - lowStockThreshold updates only when a value is supplied (null/blank preserves existing).
 *  - GST fields and product-level fields are NEVER included here.
 * Returns an empty object when nothing should change.
 */
export function resolveVariantMasterUpdate(raw: {
  cost_price: number;
  list_price: number;
  low_stock_threshold: number | null;
}): Prisma.ProductVariantUpdateInput {
  const fields = resolveVariantMasterFields(raw);
  const data: Prisma.ProductVariantUpdateInput = {};
  if (fields.costPrice !== null) data.costPrice = fields.costPrice;
  if (fields.listPrice !== null) data.listPrice = fields.listPrice;
  if (fields.lowStockThreshold !== null) data.lowStockThreshold = fields.lowStockThreshold;
  return data;
}

/**
 * The same three decisions, flattened, where `null` means "leave the existing
 * value alone". The bulk-import catalog step applies hundreds of these in one
 * set-based UPDATE ... FROM (VALUES …), which needs every column present on
 * every row — so "no change" has to be expressible as a value, not an absence.
 */
export type VariantMasterFields = {
  costPrice: Prisma.Decimal | null;
  listPrice: Prisma.Decimal | null;
  lowStockThreshold: number | null;
};

export function resolveVariantMasterFields(raw: {
  cost_price: number;
  list_price: number;
  low_stock_threshold: number | null;
}): VariantMasterFields {
  return {
    costPrice: raw.cost_price > 0 ? new Prisma.Decimal(raw.cost_price) : null,
    listPrice: raw.list_price > 0 ? new Prisma.Decimal(raw.list_price) : null,
    lowStockThreshold:
      raw.low_stock_threshold != null && raw.low_stock_threshold >= 0
        ? Math.max(0, Math.floor(raw.low_stock_threshold))
        : null,
  };
}
