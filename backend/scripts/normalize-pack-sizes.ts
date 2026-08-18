/**
 * One-off: rewrite existing pack-size rows to their CANONICAL label/code.
 *
 * "500G", "500 g" and "500grams" must all resolve to one row ("500g"), and the
 * count suffix moved to the short form ("60 tablets" → "60 tabs"). Rows whose
 * canonical form already exists are merged: variants are repointed first, then
 * the duplicate row is removed, so no stock loses its pack size.
 *
 * Run from backend/: npx tsx scripts/normalize-pack-sizes.ts
 */
import { PrismaClient } from "@prisma/client";
import { parsePackSizeLabel } from "../src/lib/pack-size.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows = await prisma.packSize.findMany({ orderBy: { label: "asc" } });
  for (const r of rows) {
    const p = parsePackSizeLabel(r.label);
    if (!p) {
      console.log(`  UNPARSEABLE, left alone: "${r.label}"`);
      continue;
    }
    if (p.label === r.label && p.code === r.code && p.measure === r.measure) continue;

    const clash = await prisma.packSize.findUnique({ where: { code: p.code } });
    if (clash && clash.id !== r.id) {
      await prisma.productVariant.updateMany({
        where: { packSizeId: r.id },
        data: { packSizeId: clash.id },
      });
      await prisma.packSize.delete({ where: { id: r.id } });
      console.log(`  merged "${r.label}" into existing "${clash.label}"`);
    } else {
      await prisma.packSize.update({
        where: { id: r.id },
        data: {
          label: p.label,
          code: p.code,
          measure: p.measure,
          normalizedValue: p.normalizedValue,
        },
      });
      console.log(`  "${r.label}" -> "${p.label}" (${p.measure})`);
    }
  }

  console.log("\n--- pack sizes now ---");
  const final = await prisma.packSize.findMany({
    orderBy: [{ measure: "asc" }, { normalizedValue: "asc" }],
  });
  for (const r of final) {
    console.log(`  ${r.measure.padEnd(7)} ${r.label.padEnd(12)} code=${r.code}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
