import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSkuBase,
  resolveRowRefs,
  claimUnique,
  claimUniqueSku,
  normKey,
  planVariantWrites,
  slugify,
  variantIdentity,
  type CatalogRefs,
  type PlanRow,
} from "./bulk-import-catalog-plan.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const P_WHEY = "prod_whey";
const B_TN = "brand_tn";
const F_CHOC = "flav_choc";
const S_2KG = "size_2kg";

function refs(over: Partial<CatalogRefs> = {}): CatalogRefs {
  return {
    flavourByName: new Map([["chocolate", F_CHOC]]),
    packByCode: new Map([["2KG", S_2KG]]),
    brandByName: new Map([["tn", B_TN]]),
    productByName: new Map([["ripped whey", P_WHEY]]),
    variantBySku: new Map(),
    variantByIdentity: new Map(),
    takenSkus: new Set(),
    ...over,
  };
}

function row(over: Partial<PlanRow["raw"]> = {}, top: Partial<PlanRow> = {}): PlanRow {
  return {
    rowNum: 2,
    raw: {
      product_name: "Ripped Whey",
      sku: "",
      brand: "TN",
      flavour: "Chocolate",
      pack_size: "2kg",
      cost_price: 3000,
      list_price: 4000,
      cgst_pct: 2.5,
      sgst_pct: 2.5,
      igst_pct: 0,
      low_stock_threshold: 3,
      gst_inclusive: true,
      ...over,
    },
    ...top,
  };
}

// ── Naming helpers ──────────────────────────────────────────────────────────

test("normKey folds case and surrounding whitespace", () => {
  assert.equal(normKey("  Chocolate "), "chocolate");
  assert.equal(normKey("CHOCOLATE"), normKey("chocolate"));
});

test("slugify produces a clean hyphenated slug", () => {
  assert.equal(slugify("Ripped Whey 100%"), "ripped-whey-100");
  assert.equal(slugify("  --Gold-- "), "gold");
});

test("variantIdentity treats missing attributes as empty, not as a match-anything", () => {
  assert.equal(variantIdentity("p", null, null, null), "p|||");
  assert.notEqual(variantIdentity("p", "b", null, null), variantIdentity("p", null, "b", null));
});

test("claimUnique appends -1, -2 and reserves each result", () => {
  const taken = new Set(["whey"]);
  assert.equal(claimUnique("whey", taken), "whey-1");
  assert.equal(claimUnique("whey", taken), "whey-2");
  assert.equal(claimUnique("creatine", taken), "creatine");
});

test("claimUniqueSku starts at -2 and ignores case when detecting a clash", () => {
  const taken = new Set(["TN-WHEY"]);
  assert.equal(claimUniqueSku("TN-WHEY", taken), "TN-WHEY-2");
  assert.equal(claimUniqueSku("TN-WHEY", taken), "TN-WHEY-3");
  // The set holds UPPERCASE; a base arriving in another casing must still clash,
  // because Postgres' unique index is case-sensitive and would accept both.
  const mixed = new Set(["TN-CREATINE"]);
  assert.equal(claimUniqueSku("tn-creatine", mixed), "tn-creatine-2");
});

test("buildSkuBase renders BRAND-PRODUCT-FLAVOUR-PACKSIZE and caps each segment", () => {
  assert.equal(buildSkuBase("TN", "Ripped Whey", "Chocolate", "2kg"), "TN-RIPPED-WHEY-CHOCOLATE-2KG");
  // Missing pieces are dropped, not left as empty segments.
  assert.equal(buildSkuBase("", "Creatine", "", "250g"), "CREATINE-250G");
  assert.ok(buildSkuBase("A".repeat(40), "B".repeat(40), "C".repeat(40), "D".repeat(40)).length <= 58);
});

// ── The retry story: this is what produced the client's duplicates ───────────

test("a first run creates every row", () => {
  const plan = planVariantWrites([row(), row({ flavour: "Coffee" })], refs({
    flavourByName: new Map([["chocolate", F_CHOC], ["coffee", "flav_coffee"]]),
  }));
  assert.equal(plan.toCreate.length, 2);
  assert.equal(plan.toUpdate.length, 0);
  assert.deepEqual(
    plan.toCreate.map((v) => v.sku),
    ["TN-RIPPED-WHEY-CHOCOLATE-2KG", "TN-RIPPED-WHEY-COFFEE-2KG"],
  );
});

test("re-running an interrupted import creates nothing and never mints a -2 twin", () => {
  // Run 1 got as far as writing this variant before timing out.
  const already = refs({
    variantByIdentity: new Map([[variantIdentity(P_WHEY, B_TN, F_CHOC, S_2KG), "var_1"]]),
    variantBySku: new Map([["TN-RIPPED-WHEY-CHOCOLATE-2KG", "var_1"]]),
    takenSkus: new Set(["TN-RIPPED-WHEY-CHOCOLATE-2KG"]),
  });
  // Run 2 replays the SAME scan payload, which still says "create".
  const plan = planVariantWrites([row()], already);

  assert.equal(plan.toCreate.length, 0, "must not create a second variant");
  assert.equal(plan.toUpdate.length, 1, "should refresh the existing variant instead");
  assert.equal(plan.toUpdate[0]!.id, "var_1");
});

test("identity match survives pack-size spelling drift between runs", () => {
  const already = refs({
    variantByIdentity: new Map([[variantIdentity(P_WHEY, B_TN, F_CHOC, S_2KG), "var_1"]]),
    takenSkus: new Set(["TN-RIPPED-WHEY-CHOCOLATE-2KG"]),
  });
  // Second attempt spells it differently; both canonicalise to code "2KG".
  for (const spelling of ["2 KG", "2kg", "2Kg", "2 kg"]) {
    const plan = planVariantWrites([row({ pack_size: spelling })], already);
    assert.equal(plan.toCreate.length, 0, `"${spelling}" should match the existing 2kg variant`);
  }
});

test("brand is part of identity: the same item from two companies stays two items", () => {
  const already = refs({
    brandByName: new Map([["tn", B_TN], ["muscleblaze", "brand_mb"]]),
    variantByIdentity: new Map([[variantIdentity(P_WHEY, B_TN, F_CHOC, S_2KG), "var_1"]]),
    takenSkus: new Set(["TN-RIPPED-WHEY-CHOCOLATE-2KG"]),
  });
  const plan = planVariantWrites([row({ brand: "MuscleBlaze" })], already);
  assert.equal(plan.toCreate.length, 1);
  assert.equal(plan.toCreate[0]!.brandId, "brand_mb");
});

test("the same item listed twice in one sheet is created once", () => {
  const plan = planVariantWrites([row(), row({ pack_size: "2 KG" })], refs());
  assert.equal(plan.toCreate.length, 1);
});

test("an explicit SKU already in the catalog reuses that variant", () => {
  const already = refs({
    variantBySku: new Map([["MB-GOLD-1KG", "var_9"]]),
    takenSkus: new Set(["MB-GOLD-1KG"]),
  });
  // Lowercase in the sheet must still match the stored SKU.
  const plan = planVariantWrites([row({ sku: "mb-gold-1kg" })], already);
  assert.equal(plan.toCreate.length, 0);
  assert.equal(plan.toUpdate[0]!.id, "var_9");
});

test("a scan-supplied variantId always wins", () => {
  const plan = planVariantWrites([row({}, { variantId: "var_scan" })], refs());
  assert.equal(plan.toCreate.length, 0);
  assert.equal(plan.toUpdate[0]!.id, "var_scan");
});

// ── Field mapping ───────────────────────────────────────────────────────────

test("created variants carry the resolved reference ids and GST fields", () => {
  const [v] = planVariantWrites([row()], refs()).toCreate;
  assert.equal(v!.productId, P_WHEY);
  assert.equal(v!.brandId, B_TN);
  assert.equal(v!.flavourId, F_CHOC);
  assert.equal(v!.packSizeId, S_2KG);
  assert.equal(v!.gstPricingMode, "INCLUSIVE");
  assert.equal(String(v!.cgstRate), "2.5");
  assert.equal(String(v!.listPrice), "4000");
  assert.equal(String(v!.costPrice), "3000");
  assert.equal(v!.lowStockThreshold, 3);
});

test("gst_inclusive false switches the pricing mode", () => {
  const [v] = planVariantWrites([row({ gst_inclusive: false })], refs()).toCreate;
  assert.equal(v!.gstPricingMode, "EXCLUSIVE");
});

test("a zero cost price is stored as null rather than as a real 0 cost", () => {
  const [v] = planVariantWrites([row({ cost_price: 0 })], refs()).toCreate;
  assert.equal(v!.costPrice, null);
});

test("blank flavour and pack size are allowed and stay null", () => {
  const [v] = planVariantWrites([row({ flavour: "", pack_size: "" })], refs()).toCreate;
  assert.equal(v!.flavourId, null);
  assert.equal(v!.packSizeId, null);
  assert.equal(v!.sku, "TN-RIPPED-WHEY");
});

test("an unresolvable product is reported, never silently dropped or guessed", () => {
  const plan = planVariantWrites([row({ product_name: "Ghost Product" })], refs());
  assert.equal(plan.toCreate.length, 0);
  assert.deepEqual(plan.unresolved, [2]);
});

test("generated SKUs stay unique across a whole sheet of look-alike rows", () => {
  const rows = Array.from({ length: 50 }, () => row());
  // Distinct identities, identical naming — the SKU generator must still separate them.
  const r = refs();
  const plan = planVariantWrites(
    rows.map((x, i) => ({ ...x, rowNum: i + 2, productId: `prod_${i}` })),
    r,
  );
  const skus = plan.toCreate.map((v) => String(v.sku).toUpperCase());
  assert.equal(skus.length, 50);
  assert.equal(new Set(skus).size, 50, "every generated SKU must be unique");
});

// ── The production failure: fuzzy product match vs. sheet text ──────────────
//
// The scan matches product names at 85% similarity, so a sheet saying
// "High Protein Muesli" is deliberately attached to the catalog's existing
// "HIGH PROTEIN MUESLIE". Step 1 created the variant under that product; step 2
// rebuilt the key from the sheet text, never found it, and reported a SKU it had
// just created as "not in the catalog yet".

test("a scan-supplied productId beats the sheet's own spelling", () => {
  const r = refs({ productByName: new Map([["high protein mueslie", "prod_real"]]) });
  const out = resolveRowRefs(
    row({ product_name: "High Protein Muesli" }, { productId: "prod_real" }),
    r,
  );
  assert.equal(out.productId, "prod_real");
});

test("both import steps derive the SAME identity for a fuzzy-matched row", () => {
  // What the catalog step stored, keyed off the id the scan resolved.
  const r = refs({ productByName: new Map([["high protein mueslie", "prod_real"]]) });
  const sheetRow = row(
    { product_name: "High Protein Muesli", flavour: "Chocolate", pack_size: "1KG" },
    { productId: "prod_real" },
  );
  r.packByCode.set("1KG", S_2KG); // "1KG" canonicalises to code 1KG

  const a = resolveRowRefs(sheetRow, r);
  const b = resolveRowRefs(sheetRow, r);
  assert.equal(
    variantIdentity(a.productId!, a.brandId, a.flavourId, a.packSizeId),
    variantIdentity(b.productId!, b.brandId, b.flavourId, b.packSizeId),
  );
  // And it is the REAL product, not one invented from the sheet spelling.
  assert.equal(a.productId, "prod_real");
});

test("pack size resolves through its canonical code, whatever the sheet typed", () => {
  const r = refs();
  for (const spelling of ["2kg", "2 KG", "2Kg", "2 kg"]) {
    const out = resolveRowRefs(row({ pack_size: spelling }, { packSizeId: undefined }), r);
    assert.equal(out.packSizeId, S_2KG, `"${spelling}" should resolve to the 2kg row`);
  }
});

test("a row with no ids at all still resolves by name", () => {
  const out = resolveRowRefs(row({}, {}), refs());
  assert.equal(out.productId, P_WHEY);
  assert.equal(out.brandId, B_TN);
  assert.equal(out.flavourId, F_CHOC);
  assert.equal(out.packSizeId, S_2KG);
});

test("an unknown name resolves to null rather than guessing", () => {
  const out = resolveRowRefs(row({ product_name: "Nothing Like This" }, {}), refs());
  assert.equal(out.productId, null);
});
