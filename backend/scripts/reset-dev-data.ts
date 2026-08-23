/**
 * Wipe every row of business data, keeping only the logins.
 *
 * Kept: `users` and `refresh_tokens` (so you stay signed in), `_prisma_migrations`
 * (schema bookkeeping), and the `invoice_sequence` singleton — which is RESET to 0
 * rather than removed, so invoice numbers restart at GVN-<year>-0000001.
 *
 * Everything else goes: orders, purchases, returns, inventory and its ledger, the
 * whole catalog (products, variants, brands, flavours, pack sizes), customers,
 * suppliers, offers, expenses, capital entries, import batches, notifications and
 * WhatsApp logs.
 *
 * The table list is read FROM THE DATABASE, never hardcoded. The previous version
 * of this script carried a hand-written array that still named `categories`,
 * `colors` and `sizes` long after the nutrition refit dropped them, and had never
 * been taught about `brands`, `flavours`, `pack_sizes`, `expenses`,
 * `capital_entries`, `purchase_returns`, `purchase_return_lines` or
 * `bulk_import_batches` — so it would have failed outright, and had it run, it
 * would have left a third of the data behind.
 *
 * DEV ONLY. Refuses to run against NODE_ENV=production. Dry run by default:
 *   npx tsx scripts/reset-dev-data.ts          # show what would be deleted
 *   npx tsx scripts/reset-dev-data.ts --yes    # actually delete it
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--yes");

/** Never truncated. `invoice_sequence` is reset in place instead of emptied. */
const KEEP = new Set(["users", "refresh_tokens", "invoice_sequence", "_prisma_migrations"]);

/** Host only — never credentials. Printed so this cannot be aimed at the wrong DB. */
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

async function listTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  return rows.map((r) => r.table_name);
}

async function countTable(table: string): Promise<number> {
  // Identifier comes from information_schema, not from user input.
  const rows = await prisma.$queryRawUnsafe<{ c: number }[]>(
    `SELECT COUNT(*)::int AS c FROM "${table}"`,
  );
  return rows[0]?.c ?? 0;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (backend/.env)");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run with NODE_ENV=production. This is a dev-only reset.");
  }

  console.log(`Target database: ${targetDatabase()}`);
  console.log(`Mode           : ${APPLY ? "APPLY — rows will be deleted" : "DRY RUN — nothing written"}\n`);

  const all = await listTables();
  const targets = all.filter((t) => !KEEP.has(t));
  const kept = all.filter((t) => KEEP.has(t));

  // Snapshot the logins so we can prove afterwards that they survived.
  const usersBefore = await prisma.user.count();
  const tokensBefore = await prisma.refreshToken.count();

  let total = 0;
  console.log("Will be cleared:");
  for (const t of targets) {
    const c = await countTable(t);
    total += c;
    if (c > 0) console.log(`  ${t.padEnd(26)} ${String(c).padStart(6)}`);
  }
  if (total === 0) console.log("  (already empty)");

  console.log("\nWill be kept:");
  for (const t of kept) {
    console.log(`  ${t.padEnd(26)} ${String(await countTable(t)).padStart(6)}`);
  }
  console.log(`\n  users: ${usersBefore}   refresh tokens: ${tokensBefore}`);
  console.log(`  rows to delete: ${total}`);

  if (!APPLY) {
    console.log("\nNothing was written. Re-run with --yes to clear.");
    return;
  }

  // One statement for all of them: TRUNCATE sorts out the foreign-key order itself,
  // which a hand-ordered list of DELETEs gets wrong the moment a relation is added.
  // Every target is named explicitly, so CASCADE has nothing left to reach for.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${targets.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );

  // Reset rather than delete: the row is a singleton the billing code expects to
  // find, so invoice numbering restarts at 1 instead of crashing on a missing row.
  await prisma.$executeRawUnsafe(
    `UPDATE "invoice_sequence" SET "next_seq" = 0, "updated_at" = NOW() WHERE "id" = 'singleton'`,
  );

  // Verify, rather than assume. A stray CASCADE reaching the logins is the one
  // failure that would actually hurt, so it is checked explicitly.
  let remaining = 0;
  for (const t of targets) remaining += await countTable(t);
  const usersAfter = await prisma.user.count();
  const tokensAfter = await prisma.refreshToken.count();

  console.log(`\nCleared. Rows left in target tables: ${remaining}`);
  console.log(`Logins intact: ${usersAfter}/${usersBefore} users, ${tokensAfter}/${tokensBefore} tokens`);

  if (remaining > 0) throw new Error("Some target tables still contain rows.");
  if (usersAfter !== usersBefore) throw new Error("Users were affected — this must never happen.");
  if (tokensAfter !== tokensBefore) throw new Error("Refresh tokens were affected.");

  console.log("Invoice numbering reset to 1. Schema and migrations untouched.");
}

main()
  .catch((e) => {
    console.error("\nERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
