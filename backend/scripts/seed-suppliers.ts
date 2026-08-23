/**
 * Seed the supplier list.
 *
 * Additive and idempotent: a name already present (ignoring case and extra spaces)
 * is left alone, so this is safe to re-run — in particular after
 * `npm run db:reset-dev`, which clears suppliers along with everything else.
 *
 * `suppliers.name` carries no unique index, only an ordinary one, so nothing in the
 * database stops the same company being added twice. The matching therefore has to
 * happen here.
 *
 *   npx tsx scripts/seed-suppliers.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** As supplied by the owner — spellings kept verbatim, not "corrected". */
const SUPPLIERS = [
  "TRUNATIV",
  "MUSCLETRIAL",
  "PINTOLA",
  "WELLCORE",
  "MUSCLEBLAZE",
  "MUSCLEGEAR",
  "BIG MUSCLES",
  "ON",
  "IMMUE LABZ",
  "INSANE LABZ",
  "MUSCLEBLAST",
  "AVVATAR",
  "GNC",
  "MUSCLETECH",
  "BSN",
  "LABRADA",
  "BPI",
  "RUN",
  "XTEND",
  "TN",
  "ISOPURE",
  "BIG DADDY",
  "RC",
  "MY FITNESS",
  "AS IT IS",
  "PROMANIAX",
  "AMERICAN",
  "EVOLVED GENETIC",
  "HEALTHFARM",
  "PRO SUPP",
  "KAVIPA",
  "KEVIN LEVRONE",
  "WHOLE TRUTH",
];

const norm = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

/** Host only — never credentials. */
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
  console.log(`Target database: ${targetDatabase()}\n`);

  const existing = await prisma.supplier.findMany({ select: { id: true, name: true, isActive: true } });
  const byName = new Map(existing.map((s) => [norm(s.name), s]));

  const toCreate: string[] = [];
  const reactivate: { id: string; name: string }[] = [];
  const seen = new Set<string>();

  for (const name of SUPPLIERS) {
    const key = norm(name);
    if (seen.has(key)) continue; // guard against a repeat inside the list itself
    seen.add(key);

    const match = byName.get(key);
    if (!match) {
      toCreate.push(name.trim());
    } else if (!match.isActive) {
      // Previously soft-deleted: bring it back rather than adding a second row.
      reactivate.push({ id: match.id, name: match.name });
    } else {
      console.log(`  skip     ${name} (already there)`);
    }
  }

  for (const s of reactivate) console.log(`  reactivate ${s.name}`);
  for (const name of toCreate) console.log(`  create   ${name}`);

  if (reactivate.length > 0) {
    await prisma.supplier.updateMany({
      where: { id: { in: reactivate.map((s) => s.id) } },
      data: { isActive: true },
    });
  }
  if (toCreate.length > 0) {
    await prisma.supplier.createMany({ data: toCreate.map((name) => ({ name })) });
  }

  const total = await prisma.supplier.count();
  console.log(
    `\nCreated ${toCreate.length}, reactivated ${reactivate.length}, ` +
      `skipped ${SUPPLIERS.length - toCreate.length - reactivate.length}. ` +
      `${total} suppliers now.`,
  );
}

main()
  .catch((e) => {
    console.error("\nERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
