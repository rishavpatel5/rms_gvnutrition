/**
 * GV Nutrition reference-data seed. Idempotent — safe to re-run.
 *
 * Deliberately MINIMAL. Categories, brands and most flavours are owner-managed
 * through the UI, so seeding a long list would just create rows to delete.
 * Only Chocolate + Unflavoured are seeded (owner's instruction); pack sizes are
 * seeded because they need a measure and a normalized magnitude that would be
 * tedious to key in by hand.
 *
 * Run: npm run db:seed  (from backend/)
 */
import { PackSizeMeasure, PrismaClient } from "@prisma/client";
import { packSizeCode } from "../src/lib/pack-size.js";

const prisma = new PrismaClient();

const FLAVOURS = ["Chocolate", "Unflavoured"];

// normalizedValue is in the measure's base unit: grams / millilitres / pieces.
const PACK_SIZES: { label: string; measure: PackSizeMeasure; normalizedValue: number }[] = [
  // Powders — whey, gainer, creatine, oats
  { label: "250g", measure: PackSizeMeasure.WEIGHT, normalizedValue: 250 },
  { label: "400g", measure: PackSizeMeasure.WEIGHT, normalizedValue: 400 },
  { label: "500g", measure: PackSizeMeasure.WEIGHT, normalizedValue: 500 },
  { label: "1kg", measure: PackSizeMeasure.WEIGHT, normalizedValue: 1000 },
  { label: "2kg", measure: PackSizeMeasure.WEIGHT, normalizedValue: 2000 },
  { label: "3kg", measure: PackSizeMeasure.WEIGHT, normalizedValue: 3000 },
  { label: "5kg", measure: PackSizeMeasure.WEIGHT, normalizedValue: 5000 },
  // Liquids
  { label: "250ml", measure: PackSizeMeasure.VOLUME, normalizedValue: 250 },
  { label: "500ml", measure: PackSizeMeasure.VOLUME, normalizedValue: 500 },
  { label: "1L", measure: PackSizeMeasure.VOLUME, normalizedValue: 1000 },
  // Tablets / capsules — short canonical suffix "tabs"
  { label: "30 tabs", measure: PackSizeMeasure.COUNT, normalizedValue: 30 },
  { label: "60 tabs", measure: PackSizeMeasure.COUNT, normalizedValue: 60 },
  { label: "90 tabs", measure: PackSizeMeasure.COUNT, normalizedValue: 90 },
  { label: "120 tabs", measure: PackSizeMeasure.COUNT, normalizedValue: 120 },
  // Sachets / single-serve packets in a box — canonical suffix "pcs"
  { label: "10 pcs", measure: PackSizeMeasure.SACHET, normalizedValue: 10 },
  { label: "15 pcs", measure: PackSizeMeasure.SACHET, normalizedValue: 15 },
  { label: "20 pcs", measure: PackSizeMeasure.SACHET, normalizedValue: 20 },
  { label: "30 pcs", measure: PackSizeMeasure.SACHET, normalizedValue: 30 },
];

async function main(): Promise<void> {
  for (const [i, name] of FLAVOURS.entries()) {
    await prisma.flavour.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: i },
    });
  }
  console.log(`Flavours seeded: ${FLAVOURS.join(", ")}`);

  for (const [i, ps] of PACK_SIZES.entries()) {
    const code = packSizeCode(ps.label);
    await prisma.packSize.upsert({
      where: { code },
      update: {},
      create: {
        label: ps.label,
        code,
        measure: ps.measure,
        normalizedValue: ps.normalizedValue,
        sortOrder: i,
      },
    });
  }
  console.log(`Pack sizes seeded: ${PACK_SIZES.length} rows`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
