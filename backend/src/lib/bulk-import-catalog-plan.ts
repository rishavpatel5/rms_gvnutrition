import { GstPricingMode, Prisma } from "@prisma/client";
import { parsePackSizeLabel } from "./pack-size.js";
import {
  resolveVariantMasterFields,
  type VariantMasterFields,
} from "./bulk-import-variant-update.js";

/**
 * Pure decision layer for step 1 of the bulk import (catalog creation).
 *
 * Given the catalog as it exists RIGHT NOW (the maps in CatalogRefs, each read
 * from the database in a single query) plus the rows the user is committing,
 * work out which variants must be created and which already exist and only need
 * their price fields refreshed.
 *
 * Kept free of Prisma calls on purpose: this is where an interrupted import
 * either does or does not duplicate the client's catalog, so it has to be
 * exhaustively testable without a database.
 */

// ── Naming helpers ──────────────────────────────────────────────────────────

/** Case- and whitespace-insensitive key for matching sheet text against the DB. */
export function normKey(value: string): string {
  return value.trim().toLowerCase();
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Identity of a variant: product + company + flavour + pack size, by ID.
 * Brand is part of the key because the same flavour and pack size from two
 * companies are two different sellable items. IDs rather than names, so a
 * re-import can't be fooled by "500 g" vs "500g" spelling drift.
 */
export function variantIdentity(
  productId: string,
  brandId: string | null,
  flavourId: string | null,
  packSizeId: string | null,
): string {
  return [productId, brandId ?? "", flavourId ?? "", packSizeId ?? ""].join("|");
}

/**
 * Reserve `base`, appending -1, -2 … until it is free, then claim the result so
 * the next caller in the same batch can't take it too. Replaces the old
 * one-query-per-candidate loop: on a 500-row sheet that was 500+ sequential
 * round-trips just to settle slugs.
 */
export function claimUnique(base: string, taken: Set<string>): string {
  let candidate = base;
  for (let n = 1; taken.has(candidate); n++) candidate = `${base}-${n}`;
  taken.add(candidate);
  return candidate;
}

/** Same, for SKUs: suffixes start at -2, and matching ignores case. */
export function claimUniqueSku(base: string, takenUpper: Set<string>): string {
  let candidate = base;
  for (let n = 2; takenUpper.has(candidate.toUpperCase()); n++) candidate = `${base}-${n}`;
  takenUpper.add(candidate.toUpperCase());
  return candidate;
}

/** One SKU segment: uppercase, hyphenated, length-capped. */
export function skuToken(value: string, max: number): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

/**
 * BRAND-PRODUCT-FLAVOUR-PACKSIZE for an import row whose SKU cell is blank.
 * Mirrors generateUniqueSku() in catalog/variant.service.ts — keep the two in sync.
 * Pure: uniqueness is settled by claimUniqueSku() against an in-memory set.
 */
export function buildSkuBase(
  brand: string,
  productName: string,
  flavour: string,
  packSize: string,
): string {
  const parts = [
    brand ? skuToken(brand, 18) : "",
    skuToken(productName, 22),
    flavour ? skuToken(flavour, 12) : "",
    packSize ? skuToken(packSize, 10) : "",
  ].filter(Boolean);
  return parts.join("-").slice(0, 58).replace(/-+$/, "") || "SKU";
}

// ── Planning ────────────────────────────────────────────────────────────────

/** Only the cells the catalog step reads. Structurally satisfied by RawRow. */
export type PlanRawRow = {
  product_name: string;
  sku: string;
  brand: string;
  flavour: string;
  pack_size: string;
  cost_price: number;
  list_price: number;
  cgst_pct: number;
  sgst_pct: number;
  igst_pct: number;
  low_stock_threshold: number | null;
  gst_inclusive: boolean;
};

/** Structurally satisfied by CommitRow. */
export type PlanRow = {
  rowNum: number;
  raw: PlanRawRow;
  variantId?: string;
  productId?: string;
  brandId?: string;
  flavourId?: string;
  packSizeId?: string;
};

/** The catalog as it exists right now, each map filled by a single findMany. */
export type CatalogRefs = {
  /** normKey(name) → id */
  flavourByName: Map<string, string>;
  /** canonical pack code → id */
  packByCode: Map<string, string>;
  /** normKey(name) → id */
  brandByName: Map<string, string>;
  /** normKey(name) → id */
  productByName: Map<string, string>;
  /** UPPERCASE sku → variant id */
  variantBySku: Map<string, string>;
  /** variantIdentity() → variant id */
  variantByIdentity: Map<string, string>;
  /** every UPPERCASE sku already in use; mutated as new ones are claimed */
  takenSkus: Set<string>;
};

/** One existing variant whose sheet-controlled fields need refreshing. */
export type VariantMasterPatch = VariantMasterFields & { id: string };

export type CatalogPlan = {
  toCreate: Prisma.ProductVariantCreateManyInput[];
  toUpdate: VariantMasterPatch[];
  /** Rows that named a product no lookup could resolve; reported, never guessed. */
  unresolved: number[];
};

export function planVariantWrites(rows: PlanRow[], refs: CatalogRefs): CatalogPlan {
  const toCreate: Prisma.ProductVariantCreateManyInput[] = [];
  const toUpdate: VariantMasterPatch[] = [];
  const unresolved: number[] = [];
  const claimedIdentities = new Set<string>(); // same item listed twice in one sheet

  for (const row of rows) {
    const r = row.raw;

    const flavourId =
      row.flavourId ?? (r.flavour?.trim() ? refs.flavourByName.get(normKey(r.flavour)) ?? null : null);
    const packSizeId =
      row.packSizeId ??
      (r.pack_size?.trim()
        ? refs.packByCode.get(parsePackSizeLabel(r.pack_size)?.code ?? "") ?? null
        : null);
    const brandId =
      row.brandId ?? (r.brand?.trim() ? refs.brandByName.get(normKey(r.brand)) ?? null : null);
    const productId = row.productId ?? refs.productByName.get(normKey(r.product_name)) ?? null;

    if (!productId) {
      unresolved.push(row.rowNum);
      continue;
    }

    const identity = variantIdentity(productId, brandId, flavourId, packSizeId);
    const sheetSku = r.sku?.trim();

    // Resolve against the CURRENT catalog, not against the scan payload — that
    // payload was computed before an interrupted run wrote anything, so it still
    // says "create" for rows that now exist. This is what stops a retry from
    // producing a "-2" twin of every row.
    const existingId =
      row.variantId ??
      (sheetSku ? refs.variantBySku.get(sheetSku.toUpperCase()) : undefined) ??
      refs.variantByIdentity.get(identity);

    if (existingId) {
      // Keep the SAME variant and refresh only the Excel-controlled price and
      // threshold fields (see resolveVariantMasterFields for the exact rules).
      // GST and product-level fields are intentionally left untouched.
      const fields = resolveVariantMasterFields(r);
      const changesSomething =
        fields.costPrice !== null || fields.listPrice !== null || fields.lowStockThreshold !== null;
      if (changesSomething) toUpdate.push({ id: existingId, ...fields });
      continue;
    }

    if (claimedIdentities.has(identity)) continue;
    claimedIdentities.add(identity);

    // A blank SKU cell means "generate one" — the same
    // BRAND-PRODUCT-FLAVOUR-PACKSIZE rule the catalog screen uses. Build it from
    // the CANONICAL pack label, not the raw cell: "500 g" and "500G" must yield
    // the same SKU, and "30 sachets" should read as 30-PCS rather than a
    // truncated "30-SACHE" once the 10-character segment cap bites.
    const canonicalPack = r.pack_size?.trim()
      ? parsePackSizeLabel(r.pack_size)?.label ?? r.pack_size
      : "";
    let sku: string;
    if (sheetSku) {
      sku = sheetSku;
      refs.takenSkus.add(sheetSku.toUpperCase());
    } else {
      sku = claimUniqueSku(
        buildSkuBase(r.brand, r.product_name, r.flavour, canonicalPack),
        refs.takenSkus,
      );
    }

    toCreate.push({
      productId,
      sku,
      listPrice: new Prisma.Decimal(r.list_price),
      costPrice: r.cost_price > 0 ? new Prisma.Decimal(r.cost_price) : null,
      gstEnabled: true,
      gstPricingMode: r.gst_inclusive ? GstPricingMode.INCLUSIVE : GstPricingMode.EXCLUSIVE,
      cgstRate: new Prisma.Decimal(r.cgst_pct),
      sgstRate: new Prisma.Decimal(r.sgst_pct),
      igstRate: new Prisma.Decimal(r.igst_pct),
      lowStockThreshold:
        r.low_stock_threshold != null ? Math.max(0, Math.floor(r.low_stock_threshold)) : null,
      brandId,
      flavourId,
      packSizeId,
    });
  }

  return { toCreate, toUpdate, unresolved };
}
