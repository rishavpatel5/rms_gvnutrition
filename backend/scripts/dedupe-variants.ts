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
 * Identity is keyed on NAMES, not on foreign keys. The interrupted run also
 * duplicated the PRODUCT row — `products.name` carries no unique index, only
 * `slug` does — so "HYDE PRE" exists twice and its variants point at different
 * product ids while being the same item to the shopkeeper. Keying on ids missed
 * exactly those pairs. Flavours, brands and pack sizes cannot duplicate this way
 * (name/code are unique), so the product row is the only thing that splits.
 *
 * Step 2 then merges the duplicate product rows themselves: surviving variants
 * are repointed to one keeper and the emptied shells are removed, so the catalog
 * stops listing the same product twice.
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

const norm = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * What makes two variants the same sellable item, by NAME. Deliberately not by
 * foreign key: the interrupted import created a second `products` row with the
 * same name, so the duplicate pair legitimately carries two different product
 * ids. Keying on ids left every one of those pairs behind.
 */
function identityKey(v: Variant): string {
  return [
    norm(v.product.name),
    norm(v.brand?.name ?? ""),
    norm(v.flavour?.name ?? ""),
    norm(v.packSize?.label ?? ""),
  ].join("|");
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
    const key = identityKey(v);
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

  // A product whose every variant is going becomes an empty shell in the catalog.
  const doomedIds = new Set(doomed.map((v) => v.id));
  const emptyProducts = new Map<string, string>();
  for (const v of doomed) {
    const survivors = variants.filter((o) => o.productId === v.productId && !doomedIds.has(o.id));
    if (survivors.length === 0) emptyProducts.set(v.productId, v.product.name);
  }

  // ── Step 2: the duplicate PRODUCT rows behind those variants ───────────────
  // Same name, two rows, because only `slug` is unique. Left alone, the catalog
  // lists the item twice and a future import resolves the name to just one of
  // them — so surviving variants get gathered onto a single keeper.
  const products = await prisma.product.findMany({
    select: {
      id: true, name: true, slug: true, hsnCode: true, createdAt: true,
      _count: { select: { variants: true, offerProducts: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const byName = new Map<string, typeof products>();
  for (const p of products) {
    const list = byName.get(norm(p.name));
    if (list) list.push(p);
    else byName.set(norm(p.name), [p]);
  }

  const merges: { keeperId: string; keeperName: string; absorbIds: string[] }[] = [];
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    // Keeper: most variants left after the cleanup above, then the oldest row.
    const survivingVariants = (pid: string) =>
      variants.filter((v) => v.productId === pid && !doomedIds.has(v.id)).length;
    const sorted = [...list].sort((a, b) => {
      const byCount = survivingVariants(b.id) - survivingVariants(a.id);
      if (byCount !== 0) return byCount;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const keeper = sorted[0]!;
    const absorb = sorted.slice(1);
    merges.push({ keeperId: keeper.id, keeperName: keeper.name, absorbIds: absorb.map((p) => p.id) });
    console.log(`▸ MERGE product "${keeper.name}"`);
    console.log(`   KEEP    ${keeper.slug.padEnd(48)} variants=${survivingVariants(keeper.id)}`);
    for (const p of absorb) {
      console.log(`   ABSORB  ${p.slug.padEnd(48)} variants=${survivingVariants(p.id)}`);
    }
    console.log();
  }

  console.log("──────────────────────────────────────────────");
  console.log(`Duplicate variant groups : ${[...groups.values()].filter((g) => g.length > 1).length}`);
  console.log(`Variants to delete       : ${doomed.length}`);
  console.log(`Skipped (still in use)   : ${skipped.length}`);
  console.log(`SKUs to tidy up          : ${renames.length}`);
  console.log(`Duplicate products to merge: ${merges.length}`);
  console.log(`Products left empty      : ${emptyProducts.size}`);
  for (const name of emptyProducts.values()) console.log(`   · ${name}`);

  if (!APPLY) {
    console.log("\nNothing was written. Re-run with --apply to delete.");
    return;
  }
  if (doomed.length === 0 && merges.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  if (doomed.length > 0) {
    // inventory_balances FK is onDelete: Restrict, so the balance row goes first.
    // One transaction: either the variant is fully gone or it is untouched —
    // never a variant stripped of its balance.
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
  }

  for (const m of merges) {
    await prisma.$transaction(async (tx) => {
      await tx.productVariant.updateMany({
        where: { productId: { in: m.absorbIds } },
        data: { productId: m.keeperId },
      });
      // offer_products would CASCADE away with the shell; move the links instead.
      const links = await tx.offerProduct.findMany({
        where: { productId: { in: m.absorbIds } },
        select: { offerId: true },
      });
      if (links.length > 0) {
        await tx.offerProduct.deleteMany({ where: { productId: { in: m.absorbIds } } });
        await tx.offerProduct.createMany({
          data: links.map((l) => ({ offerId: l.offerId, productId: m.keeperId })),
          skipDuplicates: true,
        });
      }
      // An HSN code entered on only one of the twins would otherwise be lost.
      const keeper = await tx.product.findUnique({
        where: { id: m.keeperId },
        select: { hsnCode: true },
      });
      if (!keeper?.hsnCode) {
        const donor = await tx.product.findFirst({
          where: { id: { in: m.absorbIds }, hsnCode: { not: null } },
          select: { hsnCode: true },
        });
        if (donor?.hsnCode) {
          await tx.product.update({ where: { id: m.keeperId }, data: { hsnCode: donor.hsnCode } });
        }
      }
      await tx.product.deleteMany({ where: { id: { in: m.absorbIds }, variants: { none: {} } } });
    });
  }
  if (merges.length > 0) console.log(`Merged ${merges.length} duplicate product rows.`);

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
