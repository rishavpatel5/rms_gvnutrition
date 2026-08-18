-- Remove product categories from the system (owner's decision).
--
-- Brand is the grouping that matters for this business, and the category filter in
-- analytics was never wired to any UI control, so nothing the owner uses is lost.
-- NOTE: this does NOT touch "ExpenseCategory" (RENT / SALARY / …) — that is a
-- separate enum on expenses and stays.

ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_category_id_fkey";
DROP INDEX IF EXISTS "products_category_id_idx";
ALTER TABLE "products" DROP COLUMN IF EXISTS "category_id";

ALTER TABLE "customers" DROP COLUMN IF EXISTS "preferred_categories";

DROP TABLE IF EXISTS "categories";
