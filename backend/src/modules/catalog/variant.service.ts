import { GstPricingMode, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { buildMeta, parsePagination } from "../../lib/pagination.js";
import { defaultIntraStateGstPercentages } from "../../lib/gst-defaults.js";
import { resolveVariantUnitCosts } from "../../lib/variant-cost.js";

export async function listVariantsForProduct(
  productId: string,
  query: Record<string, unknown>,
) {
  const { page, limit, skip } = parsePagination(query);
  const isActive =
    query.isActive === "false" ? false : query.isActive === "true" ? true : true;
  const skuSearch =
    typeof query.search === "string" && query.search.trim().length > 0
      ? query.search.trim()
      : undefined;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }

  const where = {
    productId,
    ...(isActive === undefined ? {} : { isActive }),
    ...(skuSearch
      ? { sku: { contains: skuSearch, mode: "insensitive" as const } }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      skip,
      take: limit,
      orderBy: { sku: "asc" },
      include: {
        brand: true,
        flavour: true,
        packSize: true,
        inventory: true,
      },
    }),
    prisma.productVariant.count({ where }),
  ]);

  // Cost context for the Receive stock screen: what the stock on hand averaged,
  // and what was paid most recently. Shown next to the purchase-rate box so a
  // supplier re-rate is obvious at the moment the rate is typed.
  const ids = items.map((v) => v.id);
  const [wacMap, lastRows] = await Promise.all([
    resolveVariantUnitCosts(prisma, ids),
    ids.length
      ? prisma.$queryRaw<{ variant_id: string; unit_cost: string }[]>(Prisma.sql`
          SELECT DISTINCT ON (poi.variant_id)
            poi.variant_id,
            poi.unit_cost_exclusive::text AS unit_cost
          FROM purchase_order_items poi
          INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE poi.quantity_received > 0
            AND poi.variant_id IN (${Prisma.join(ids)})
          ORDER BY poi.variant_id, po.created_at DESC
        `)
      : Promise.resolve([]),
  ]);
  const lastMap = new Map(lastRows.map((r) => [r.variant_id, r.unit_cost]));

  const withCosts = items.map((v) => ({
    ...v,
    /** Weighted average cost of stock on hand. */
    avgCost: (wacMap.get(v.id) ?? new Prisma.Decimal(0)).toFixed(2),
    /** Rate paid on the most recent receive; null when never purchased. */
    lastCost: lastMap.has(v.id) ? new Prisma.Decimal(lastMap.get(v.id)!).toFixed(2) : null,
  }));

  return { items: withCosts, meta: buildMeta(page, limit, total) };
}

export async function getVariantById(id: string) {
  const row = await prisma.productVariant.findUnique({
    where: { id },
    include: {
      product: true,
      brand: true,
      flavour: true,
      packSize: true,
      inventory: true,
    },
  });
  if (!row) {
    throw new AppError(404, "VARIANT_NOT_FOUND", "Variant not found");
  }
  return row;
}

/** Uppercase, hyphenated, length-capped token for one SKU segment. */
function skuToken(value: string, max: number): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

/**
 * Build an internal SKU as BRAND-PRODUCT-FLAVOUR-PACKSIZE.
 *
 * The brand tag leads, because it is what distinguishes otherwise-identical items:
 * "Whey Protein · Chocolate · 500g" from two companies differ only by brand. Each
 * segment is length-capped so the whole code stays inside the 64-char column even
 * with long names. A numeric suffix is still appended if a collision somehow
 * remains (e.g. two brands whose names truncate to the same token).
 */
async function generateUniqueSku(
  productSlug: string,
  brandId?: string | null,
  flavourId?: string | null,
  packSizeId?: string | null,
): Promise<string> {
  const [brand, flavour, packSize] = await Promise.all([
    brandId ? prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } }) : null,
    flavourId ? prisma.flavour.findUnique({ where: { id: flavourId }, select: { name: true } }) : null,
    packSizeId ? prisma.packSize.findUnique({ where: { id: packSizeId }, select: { code: true } }) : null,
  ]);

  const parts = [
    brand ? skuToken(brand.name, 18) : "",
    skuToken(productSlug, 22),
    flavour ? skuToken(flavour.name, 12) : "",
    packSize ? skuToken(packSize.code, 10) : "",
  ].filter(Boolean);

  const base = parts.join("-").slice(0, 58).replace(/-+$/, "") || "SKU";

  let candidate = base;
  for (let n = 2; n < 1000; n++) {
    const clash = await prisma.productVariant.findUnique({
      where: { sku: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${base}-${n}`;
  }
  throw new AppError(409, "SKU_GENERATION_FAILED", "Could not generate a unique SKU");
}

export async function createVariant(input: {
  productId: string;
  sku?: string;
  listPrice?: number;
  costPrice?: number | null;
  gstEnabled?: boolean;
  gstPricingMode?: GstPricingMode;
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  lowStockThreshold?: number | null;
  brandId?: string | null;
  flavourId?: string | null;
  packSizeId?: string | null;
}) {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
  });
  if (!product) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  if (input.brandId) {
    const b = await prisma.brand.findUnique({ where: { id: input.brandId } });
    if (!b) throw new AppError(404, "BRAND_NOT_FOUND", "Brand not found");
  }
  if (input.flavourId) {
    const f = await prisma.flavour.findUnique({ where: { id: input.flavourId } });
    if (!f) throw new AppError(404, "FLAVOUR_NOT_FOUND", "Flavour not found");
  }
  if (input.packSizeId) {
    const p = await prisma.packSize.findUnique({ where: { id: input.packSizeId } });
    if (!p) throw new AppError(404, "PACK_SIZE_NOT_FOUND", "Pack size not found");
  }

  // SKU is generated, not typed. Format: BRAND-PRODUCT-FLAVOUR-PACKSIZE.
  const sku = input.sku?.trim()
    ? input.sku.trim()
    : await generateUniqueSku(product.slug, input.brandId, input.flavourId, input.packSizeId);

  if (sku.length < 2 || sku.length > 64) {
    throw new AppError(400, "INVALID_SKU", "Invalid SKU length");
  }

  // If an inactive (soft-deleted) variant is squatting on this SKU, free it first
  const squatter = await prisma.productVariant.findUnique({ where: { sku }, select: { id: true, isActive: true } });
  if (squatter && !squatter.isActive) {
    await prisma.productVariant.update({
      where: { id: squatter.id },
      data: { sku: `${sku}__deleted_${squatter.id.slice(-8)}` },
    });
  }

  const rateDefaults = defaultIntraStateGstPercentages(product.kind);
  const cgst = input.cgstRate ?? rateDefaults.cgst;
  const sgst = input.sgstRate ?? rateDefaults.sgst;
  const igst = input.igstRate ?? rateDefaults.igst;

  return prisma.$transaction(async (tx) => {
    try {
      const v = await tx.productVariant.create({
        data: {
          productId: input.productId,
          sku,
          listPrice: new Prisma.Decimal(input.listPrice ?? 0),
          costPrice:
            input.costPrice != null && input.costPrice !== undefined
              ? new Prisma.Decimal(input.costPrice)
              : null,
          gstEnabled: input.gstEnabled ?? true,
          gstPricingMode: input.gstPricingMode ?? GstPricingMode.INCLUSIVE,
          cgstRate: new Prisma.Decimal(cgst),
          sgstRate: new Prisma.Decimal(sgst),
          igstRate: new Prisma.Decimal(igst),
          lowStockThreshold: input.lowStockThreshold ?? null,
          brandId: input.brandId ?? null,
          flavourId: input.flavourId ?? null,
          packSizeId: input.packSizeId ?? null,
        },
      });
      await tx.inventoryBalance.create({
        data: { variantId: v.id, quantity: 0 },
      });
      return tx.productVariant.findUniqueOrThrow({
        where: { id: v.id },
        include: { brand: true, flavour: true, packSize: true, inventory: true },
      });
    } catch (e: unknown) {
      const code =
        typeof e === "object" && e !== null && "code" in e
          ? String((e as { code?: string }).code)
          : "";
      if (code === "P2002") {
        throw new AppError(409, "SKU_IN_USE", "SKU already exists");
      }
      throw e;
    }
  });
}

export async function updateVariant(
  id: string,
  input: {
    sku?: string;
    listPrice?: number;
    costPrice?: number | null;
    gstEnabled?: boolean;
    gstPricingMode?: GstPricingMode;
    cgstRate?: number;
    sgstRate?: number;
    igstRate?: number;
    lowStockThreshold?: number | null;
    brandId?: string | null;
    flavourId?: string | null;
    packSizeId?: string | null;
    isActive?: boolean;
  },
) {
  if (input.brandId) {
    const b = await prisma.brand.findUnique({ where: { id: input.brandId } });
    if (!b) throw new AppError(404, "BRAND_NOT_FOUND", "Brand not found");
  }
  if (input.flavourId) {
    const f = await prisma.flavour.findUnique({ where: { id: input.flavourId } });
    if (!f) throw new AppError(404, "FLAVOUR_NOT_FOUND", "Flavour not found");
  }
  if (input.packSizeId) {
    const p = await prisma.packSize.findUnique({ where: { id: input.packSizeId } });
    if (!p) throw new AppError(404, "PACK_SIZE_NOT_FOUND", "Pack size not found");
  }
  try {
    return await prisma.productVariant.update({
      where: { id },
      data: {
        ...(input.sku !== undefined ? { sku: input.sku.trim() } : {}),
        ...(input.listPrice !== undefined
          ? { listPrice: new Prisma.Decimal(input.listPrice) }
          : {}),
        ...(input.costPrice !== undefined
          ? {
              costPrice:
                input.costPrice === null
                  ? null
                  : new Prisma.Decimal(input.costPrice),
            }
          : {}),
        ...(input.gstEnabled !== undefined ? { gstEnabled: input.gstEnabled } : {}),
        ...(input.gstPricingMode !== undefined
          ? { gstPricingMode: input.gstPricingMode }
          : {}),
        ...(input.cgstRate !== undefined
          ? { cgstRate: new Prisma.Decimal(input.cgstRate) }
          : {}),
        ...(input.sgstRate !== undefined
          ? { sgstRate: new Prisma.Decimal(input.sgstRate) }
          : {}),
        ...(input.igstRate !== undefined
          ? { igstRate: new Prisma.Decimal(input.igstRate) }
          : {}),
        ...(input.lowStockThreshold !== undefined
          ? { lowStockThreshold: input.lowStockThreshold }
          : {}),
        ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
        ...(input.flavourId !== undefined ? { flavourId: input.flavourId } : {}),
        ...(input.packSizeId !== undefined ? { packSizeId: input.packSizeId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      include: { brand: true, flavour: true, packSize: true, inventory: true },
    });
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code?: string }).code)
        : "";
    if (code === "P2025") {
      throw new AppError(404, "VARIANT_NOT_FOUND", "Variant not found");
    }
    if (code === "P2002") {
      throw new AppError(409, "SKU_IN_USE", "SKU already exists");
    }
    throw e;
  }
}

export async function deleteVariant(id: string): Promise<void> {
  const v = await prisma.productVariant.findUnique({
    where: { id },
    include: { inventory: true, _count: { select: { orderItems: true } } },
  });
  if (!v) {
    throw new AppError(404, "VARIANT_NOT_FOUND", "Variant not found");
  }
  if ((v.inventory?.quantity ?? 0) > 0) {
    throw new AppError(
      409,
      "VARIANT_HAS_STOCK",
      "Cannot delete variant with positive on-hand quantity",
    );
  }
  if (v._count.orderItems > 0) {
    // Soft-delete: mangle the SKU so the original is free for re-creation
    await prisma.productVariant.update({
      where: { id },
      data: { isActive: false, sku: `${v.sku}__deleted_${id.slice(-8)}` },
    });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.inventoryBalance.deleteMany({ where: { variantId: id } });
    await tx.productVariant.delete({ where: { id } });
  });
}

const skuLookupInclude = {
  product: {
    select: {
      id: true,
      name: true,
      kind: true,
      hsnCode: true,
    },
  },
  // Brand is on the VARIANT, not the product — nesting it under product.select
  // compiles (the `as const` hides it from Prisma's checker) but 500s at runtime.
  brand: { select: { id: true, name: true } },
  flavour: { select: { name: true } },
  packSize: { select: { label: true, measure: true } },
  inventory: { select: { quantity: true } },
} as const;

/** Live catalog search by product name OR SKU (for the catalog search bar). */
export async function lookupVariantsBySku(query: Record<string, unknown>) {
  const raw =
    typeof query.sku === "string"
      ? query.sku
      : typeof query.q === "string"
        ? query.q
        : "";
  const q = raw.trim();
  if (!q || q.length < 2) {
    throw new AppError(400, "QUERY_REQUIRED", "Enter at least 2 characters to search");
  }

  // Token search: each whitespace-separated word must match somewhere
  // (name / SKU / brand / flavour / pack size). This makes "whey chocolate"
  // match a Whey product in the Chocolate flavour, and "creatine 250g" match
  // by name plus pack size.
  const tokens = q.split(/\s+/).filter(Boolean);
  const matches = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      AND: tokens.map((tok) => ({
        OR: [
          { sku: { contains: tok, mode: "insensitive" as const } },
          { product: { name: { contains: tok, mode: "insensitive" as const } } },
          { brand: { name: { contains: tok, mode: "insensitive" as const } } },
          { flavour: { name: { contains: tok, mode: "insensitive" as const } } },
          { packSize: { label: { contains: tok, mode: "insensitive" as const } } },
        ],
      })),
    },
    take: 50,
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
    include: skuLookupInclude,
  });

  const exactMatch = matches.find((m) => m.sku.toLowerCase() === q.toLowerCase()) ?? null;

  return {
    query: q,
    exists: matches.length > 0,
    exactMatch,
    matches,
  };
}
