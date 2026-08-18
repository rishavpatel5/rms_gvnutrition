-- Move brand from Product to ProductVariant.
--
-- Why: one product ("Whey Protein") must be able to carry the same flavour and
-- pack size from several companies. Chocolate 500g from Company A and Company B
-- are two distinct sellable items, each with its own cost, price and stock, so
-- the manufacturer belongs on the variant rather than the product.
--
-- Existing data is carried across, not dropped: every variant inherits the brand
-- its product currently has.

-- 1) New column on the variant.
ALTER TABLE "product_variants" ADD COLUMN "brand_id" TEXT;

-- 2) Backfill from the product BEFORE the old column goes away.
UPDATE "product_variants" pv
SET "brand_id" = p."brand_id"
FROM "products" p
WHERE p."id" = pv."product_id"
  AND p."brand_id" IS NOT NULL;

-- 3) Index + foreign key on the new column.
CREATE INDEX "product_variants_brand_id_idx" ON "product_variants"("brand_id");
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Retire the product-level brand.
ALTER TABLE "products" DROP CONSTRAINT "products_brand_id_fkey";
DROP INDEX "products_brand_id_idx";
ALTER TABLE "products" DROP COLUMN "brand_id";
