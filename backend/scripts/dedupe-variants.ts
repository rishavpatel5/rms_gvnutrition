/**
 * Remove variants duplicated by an interrupted bulk import.
 *
 * The old catalog step was not idempotent: a run that timed out half-way left
 * its rows behind, and the retry appended "-2" to every SKU it had already
 * created. The result is pairs like TN-RIPPED-WHEY-COFFEE-2KG (0 stock, orphan)
 * and TN-RIPPED-WHEY-COFFEE-2KG-2 (the real one, holding the stock).
 *
 * Variants are grouped by IDENTITY — product + brand + flavour + pack size —
 * not by SKU text, so a duplicate is caught however its code was mangled. In
 * each group one variant is KEPT (most stock, then most history, then oldest)
 * and the others are deleted ONLY if they are completely untouched: zero stock
 * and no sale, purchase, return, adjustment or inventory-log line anywhere.
 * Anything else is skipped and listed, never force-deleted.
 *
 * Dry run (default, writes nothing):
 *   npx tsx scripts/dedupe-variants.ts
 * Apply:
 *   npx tsx scripts/dedupe-variants.ts --apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const selection = {
  id: true, sku: true, createdAt: true,
  productId: true, brandId: true, flavourId: true, packSizeId: true,
  product: { select: { name: true } },
  brand: { select: { name: true } },
  flavour: { select: { name: true } },
  packSize: { select: { label: true } },
  inventory: { select: { quantity: true } },
  _count: {
    select: {
      orderItems: true, purchaseOrderItems: true, logs: true,
      purchaseReturnLines: true, stockAdjustmentLines: true,
    },
  },
} as const;

type Variant = Awaited<ReturnType<typeof loadVariants>>[number];

function loadVariants() {
  return prisma.productVariant.findMany({ select: selection, orderBy: { createdAt: "asc" } });
}

/** Every row anywhere in the system that points at this variant. */
function refCount(v: Variant): number {
  return (
    v._count.orderItems +
    v._count.purchaseOrderItems +
    v._count.logs +
    v._count.purchaseReturnLines +
    v._count.stockAdjustmentLines
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function describe(v: Variant): string {
  return [
    v.product.name,
    v.brand?.name ?? "—",
    v.flavour?.name ?? "—",
    v.packSize?.label ?? "—",
  ].join(" / ");
}

/** Host only — never the credentials. Printed so a destructive run cannot be
 *  pointed at the wrong database by accident. A shell DATABASE_URL wins over
 *  backend/.env here, because dotenv does not override what is already set. */
function targetDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "(DATABASE_URL is not set)";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main(): Promise<void> {
  console.log(`Target database: ${targetDatabase()}`);
  const variants = await loadVariants();
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${variants.length} variants in the catalog\n`);

  const groups = new Map<string, Variant[]>();
  for (const v of variants) {
    const key = [v.productId, v.brandId ?? "", v.flavourId ?? "", v.packSizeId ?? ""].join("|");
    const existing = groups.get(key);
    if (existing) existing.push(v);
    else groups.set(key, [v]);
  }

  const doomed: Variant[] = [];
  const skipped: { v: Variant; why: string }[] = [];
  // Survivors stuck with the retry's "-2" suffix, and the clean code freed for them.
  const renames: { id: string; from: string; to: string }[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    // Keeper: most stock, then most history, then the original (oldest) row.
    const sorted = [...group].sort((a, b) => {
      const byQty = (b.inventory?.quantity ?? 0) - (a.inventory?.quantity ?? 0);
      if (byQty !== 0) return byQty;
      const byRefs = refCount(b) - refCount(a);
      if (byRefs !== 0) return byRefs;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const keeper = sorted[0]!;

    console.log(`▸ ${describe(keeper)}`);
    for (const v of sorted) {
      const qty = v.inventory?.quantity ?? 0;
      const refs = refCount(v);
      const stats = `qty=${String(qty).padStart(4)} refs=${String(refs).padStart(3)}`;
      if (v.id === keeper.id) {
        console.log(`   KEEP    ${v.sku.padEnd(48)} ${stats}`);
      } else if (qty === 0 && refs === 0) {
        doomed.push(v);
        console.log(`   DELETE  ${v.sku.padEnd(48)} ${stats}`);
      } else {
        const why = qty !== 0 ? `holds ${qty} in stock` : `has ${refs} linked record(s)`;
        skipped.push({ v, why });
        console.log(`   SKIP    ${v.sku.padEnd(48)} ${stats}  ← ${why}`);
      }
    }

    // The keeper is usually the retry's copy, so it wears the ugly "-2". If the
    // clean code is being freed from this very group, give it back — nothing but
    // the variant row stores a SKU, so no history is disturbed. Deliberately
    // narrow: only a code released by a sibling in this group qualifies, never a
    // guess at what some other "-2" might have meant.
    const freed = sorted.filter((v) => doomed.includes(v)).map((v) => v.sku);
    const reclaim = freed.find((base) => new RegExp(`^${escapeRegex(base)}-\\d+$`).test(keeper.sku));
    if (reclaim) {
      renames.push({ id: keeper.id, from: keeper.sku, to: reclaim });
      console.log(`   RENAME  ${keeper.sku}  →  ${reclaim}`);
    }
    console.log();
  }

  console.log("──────────────────────────────────────────────");
  console.log(`Duplicate groups : ${[...groups.values()].filter((g) => g.length > 1).length}`);
  console.log(`To delete        : ${doomed.length}`);
  console.log(`Skipped (in use) : ${skipped.length}`);
  console.log(`SKUs to tidy up  : ${renames.length}`);

  // A product whose every variant is going becomes an empty shell in the catalog.
  const doomedIds = new Set(doomed.map((v) => v.id));
  const emptyProducts = new Map<string, string>();
  for (const v of doomed) {
    const survivors = variants.filter((o) => o.productId === v.productId && !doomedIds.has(o.id));
    if (survivors.length === 0) emptyProducts.set(v.productId, v.product.name);
  }
  console.log(`Products left empty: ${emptyProducts.size}`);
  for (const name of emptyProducts.values()) console.log(`   · ${name}`);

  if (!APPLY) {
    console.log("\nNothing was written. Re-run with --apply to delete.");
    return;
  }
  if (doomed.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  // inventory_balances FK is onDelete: Restrict, so the balance row goes first.
  // Both statements share one transaction: either the variant is fully gone or
  // it is untouched — never a variant stripped of its balance.
  const ids = [...doomedIds];
  await prisma.$transaction([
    prisma.inventoryBalance.deleteMany({ where: { variantId: { in: ids } } }),
    prisma.productVariant.deleteMany({ where: { id: { in: ids } } }),
    // Same transaction as the delete: the old code is only freed if the delete
    // sticks, so the unique index can never see both at once.
    ...renames.map((r) =>
      prisma.productVariant.update({ where: { id: r.id }, data: { sku: r.to } }),
    ),
  ]);
  console.log(`\nDeleted ${ids.length} duplicate variants.`);
  if (renames.length > 0) console.log(`Restored ${renames.length} SKUs to their clean code.`);

  if (emptyProducts.size > 0) {
    const removed = await prisma.product.deleteMany({
      where: { id: { in: [...emptyProducts.keys()] }, variants: { none: {} } },
    });
    console.log(`Deleted ${removed.count} products left with no variants.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
