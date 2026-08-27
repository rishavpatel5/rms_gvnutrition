import type { PackSizeMeasure, ProductKind, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { buildMeta, parsePagination } from "../../lib/pagination.js";
import { isValidSlug, slugify } from "../../lib/slug.js";
import { countProductVariantHistory } from "../../lib/catalog-history.js";

export async function listProducts(query: Record<string, unknown>) {
  const { page, limit, skip } = parsePagination(query);
  const kind = query.kind as ProductKind | undefined;
  const brandId =
    typeof query.brandId === "string" && query.brandId.length > 0
      ? query.brandId
      : undefined;
  const isActive =
    query.isActive === "false" ? false : query.isActive === "true" ? true : true;
  const search =
    typeof query.search === "string" && query.search.trim().length > 0
      ? query.search.trim()
      : undefined;

  const where: Prisma.ProductWhereInput = {
    ...(kind ? { kind } : {}),
    isActive,
    // Brand lives on the variant now, so a brand filter narrows to products that
    // HAVE such a variant. Must be merged into this single `variants` key — a
    // second `variants` property would silently overwrite the first.
    variants: { some: { isActive: true, ...(brandId ? { brandId } : {}) } },
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { slug: { contains: search, mode: "insensitive" } },
            { hsnCode: { contains: search, mode: "insensitive" } },
            // Brand / flavour / pack size live on the VARIANT, so match through it.
            { variants: { some: { sku: { contains: search, mode: "insensitive" } } } },
            { variants: { some: { brand: { name: { contains: search, mode: "insensitive" } } } } },
            { variants: { some: { flavour: { name: { contains: search, mode: "insensitive" } } } } },
            { variants: { some: { packSize: { label: { contains: search, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ updatedAt: "desc" }],
      include: {
        // Brands present on this product's variants — a product can span companies.
        variants: {
          where: { isActive: true },
          select: { brand: { select: { id: true, name: true, slug: true } } },
        },
        _count: { select: { variants: { where: { isActive: true } } } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return { items, meta: buildMeta(page, limit, total) };
}

export async function getProductById(id: string) {
  const row = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: {
        orderBy: { sku: "asc" },
        include: {
          brand: true,
          flavour: true,
          packSize: true,
          inventory: true,
        },
      },
    },
  });
  if (!row) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  return row;
}

export async function createProduct(input: {
  name: string;
  slug?: string;
  kind: ProductKind;
  hsnCode?: string | null;
}) {
  const slug = (input.slug?.trim() || slugify(input.name)).toLowerCase();
  if (!isValidSlug(slug)) {
    throw new AppError(400, "INVALID_SLUG", "Invalid slug format");
  }
  // If an inactive (soft-deleted) product is squatting on this slug, free it first
  const squatter = await prisma.product.findUnique({ where: { slug }, select: { id: true, isActive: true } });
  if (squatter && !squatter.isActive) {
    await prisma.product.update({
      where: { id: squatter.id },
      data: { slug: `${slug}__deleted_${squatter.id.slice(-8)}` },
    });
  }

  try {
    return await prisma.product.create({
      data: {
        name: input.name.trim(),
        slug,
        kind: input.kind,
        hsnCode: input.hsnCode?.trim() || null,
      },
    });
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code?: string }).code)
        : "";
    if (code === "P2002") {
      throw new AppError(409, "SLUG_IN_USE", "Product slug already exists");
    }
    throw e;
  }
}

/**
 * A free product slug based on `base`, appending -2, -3 ... past anything taken.
 * `selfId` is skipped so a product keeps its own slug when the name is unchanged
 * in substance (e.g. re-cased), instead of drifting to "-2" on every save.
 */
async function uniqueProductSlug(base: string, selfId?: string): Promise<string> {
  const root = base || "product";
  let candidate = root;
  for (let n = 2; n < 1000; n++) {
    const clash = await prisma.product.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash || clash.id === selfId) return candidate;
    candidate = `${root}-${n}`;
  }
  throw new AppError(409, "SLUG_GENERATION_FAILED", "Could not generate a unique slug");
}

export async function updateProduct(
  id: string,
  input: {
    name?: string;
    slug?: string;
    kind?: ProductKind;
    hsnCode?: string | null;
      isActive?: boolean;
  },
) {
  if (input.slug !== undefined && !isValidSlug(input.slug)) {
    throw new AppError(400, "INVALID_SLUG", "Invalid slug format");
  }

  // Renaming has to move the slug with it. generateUniqueSku() builds variant codes
  // from product.slug, so a product renamed "Blood Lock" -> "Blood Lock Pro" would
  // otherwise keep minting SKUs that still say BLOOD-LOCK. Only derived when the
  // caller did not set a slug explicitly, and only when the name actually changed.
  let derivedSlug: string | undefined;
  if (input.name !== undefined && input.slug === undefined) {
    const current = await prisma.product.findUnique({
      where: { id },
      select: { name: true, slug: true },
    });
    if (current && current.name.trim() !== input.name.trim()) {
      derivedSlug = await uniqueProductSlug(slugify(input.name), id);
    }
  }

  try {
    const data: Prisma.ProductUncheckedUpdateInput = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.slug !== undefined
        ? { slug: input.slug.trim().toLowerCase() }
        : derivedSlug
          ? { slug: derivedSlug }
          : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.hsnCode !== undefined
        ? { hsnCode: input.hsnCode?.trim() || null }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    return await prisma.product.update({ where: { id }, data });
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code?: string }).code)
        : "";
    if (code === "P2025") {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
    }
    if (code === "P2002") {
      throw new AppError(409, "SLUG_IN_USE", "Product slug already exists");
    }
    throw e;
  }
}

export async function deleteProduct(id: string): Promise<void> {
  const stocked = await prisma.inventoryBalance.count({
    where: { variant: { productId: id }, quantity: { gt: 0 } },
  });
  if (stocked > 0) {
    throw new AppError(
      409,
      "PRODUCT_HAS_STOCK",
      "Cannot delete product while variants have on-hand quantity",
    );
  }
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { slug: true },
  });
  if (!existing) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }

  // Same rule as deleteVariant: any movement anywhere under this product — a
  // purchase, sale, return, write-off or inventory log — makes it permanent.
  // Counting sales alone let a purchased-but-never-sold product reach the hard
  // delete, where its variants' Restrict FK rejected it.
  const history = await countProductVariantHistory(prisma, id);
  if (history > 0) {
    // Soft-delete: mangle slug so the original name/slug is free for re-creation.
    // The variants go inactive with it — otherwise the product vanishes from the
    // catalog while its SKUs stay sellable at the counter.
    await prisma.$transaction(async (tx) => {
      const live = await tx.productVariant.findMany({
        where: { productId: id, isActive: true },
        select: { id: true, sku: true },
      });
      for (const v of live) {
        await tx.productVariant.update({
          where: { id: v.id },
          data: { isActive: false, sku: `${v.sku}__deleted_${v.id.slice(-8)}` },
        });
      }
      await tx.product.update({
        where: { id },
        data: { isActive: false, slug: `${existing.slug}__deleted_${id.slice(-8)}` },
      });
    });
    return;
  }

  // Nothing has ever touched it, so it can go for real — variants included. The
  // caller may or may not have removed them first; handle both.
  await prisma.$transaction(async (tx) => {
    const variantIds = (
      await tx.productVariant.findMany({ where: { productId: id }, select: { id: true } })
    ).map((v) => v.id);
    if (variantIds.length > 0) {
      await tx.inventoryBalance.deleteMany({ where: { variantId: { in: variantIds } } });
      await tx.productVariant.deleteMany({ where: { id: { in: variantIds } } });
    }
    await tx.product.delete({ where: { id } });
  });
}

// ---------------------------------------------------------------------------
// Flavours (was Colours) — first optional per-SKU attribute
// ---------------------------------------------------------------------------

export async function listFlavours(query: Record<string, unknown>) {
  const { page, limit, skip } = parsePagination(query);
  const isActive =
    query.isActive === "false" ? false : query.isActive === "true" ? true : undefined;
  const search =
    typeof query.search === "string" && query.search.trim().length > 0
      ? query.search.trim()
      : undefined;
  const where: Prisma.FlavourWhereInput = {
    ...(isActive === undefined ? {} : { isActive }),
    ...(search
      ? { name: { contains: search, mode: "insensitive" } }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.flavour.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.flavour.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
}

export async function createFlavour(input: { name: string; sortOrder?: number }) {
  return prisma.flavour.create({
    data: {
      name: input.name.trim(),
      sortOrder: input.sortOrder ?? 0,
    },
  });
}

// ---------------------------------------------------------------------------
// Pack sizes (was Sizes) — second optional per-SKU attribute.
// Ordered by measure then normalized magnitude so "500g" never sorts before "1kg".
// ---------------------------------------------------------------------------

export async function listPackSizes(query: Record<string, unknown>) {
  const { page, limit, skip } = parsePagination(query);
  const isActive =
    query.isActive === "false" ? false : query.isActive === "true" ? true : undefined;
  const measure =
    typeof query.measure === "string" && query.measure.length > 0
      ? (query.measure as PackSizeMeasure)
      : undefined;
  const search =
    typeof query.search === "string" && query.search.trim().length > 0
      ? query.search.trim()
      : undefined;
  const where: Prisma.PackSizeWhereInput = {
    ...(isActive === undefined ? {} : { isActive }),
    ...(measure ? { measure } : {}),
    ...(search
      ? {
          OR: [
            { label: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.packSize.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { measure: "asc" },
        { normalizedValue: "asc" },
        { sortOrder: "asc" },
      ],
    }),
    prisma.packSize.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
}

export async function createPackSize(input: {
  label: string;
  code: string;
  measure: PackSizeMeasure;
  normalizedValue: number;
  sortOrder?: number;
}) {
  const code = input.code.trim().toUpperCase();
  try {
    return await prisma.packSize.create({
      data: {
        label: input.label.trim(),
        code,
        measure: input.measure,
        normalizedValue: input.normalizedValue,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  } catch (e: unknown) {
    const errCode =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code?: string }).code)
        : "";
    if (errCode === "P2002") {
      throw new AppError(409, "PACK_SIZE_IN_USE", "Pack size code or label already exists");
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Brands — a managed entity so brand-wise reporting cannot fragment
// ---------------------------------------------------------------------------

export async function listBrands(query: Record<string, unknown>) {
  const { page, limit, skip } = parsePagination(query);
  const isActive =
    query.isActive === "false" ? false : query.isActive === "true" ? true : undefined;
  const search =
    typeof query.search === "string" && query.search.trim().length > 0
      ? query.search.trim()
      : undefined;
  const where: Prisma.BrandWhereInput = {
    ...(isActive === undefined ? {} : { isActive }),
    ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.brand.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.brand.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
}

export async function createBrand(input: {
  name: string;
  slug?: string;
  sortOrder?: number;
}) {
  const slug = (input.slug?.trim() || slugify(input.name)).toLowerCase();
  if (!isValidSlug(slug)) {
    throw new AppError(400, "INVALID_SLUG", "Invalid slug format");
  }
  try {
    return await prisma.brand.create({
      data: {
        name: input.name.trim(),
        slug,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code?: string }).code)
        : "";
    if (code === "P2002") {
      throw new AppError(409, "BRAND_IN_USE", "Brand name or slug already exists");
    }
    throw e;
  }
}

export { slugify };
