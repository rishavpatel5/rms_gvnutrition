# GV Nutrition — Build Handoff & Scope

**Status: BUILT (2026-08-16).** Schema, backend, frontend and rebrand are complete;
verified end-to-end against the dev Supabase DB. Remaining work is deployment plus
the owner-supplied assets in §12.

## AS-BUILT NOTES (read first)

Local ports are **5273 (web) / 4100 (API)** so this app can run alongside Attire
(5173/4000). `docker-compose.yml` is namespaced `gvnutrition-*` on host port 55432 —
it previously carried Attire's container AND data volume names, which would have
attached to Attire's local database.

Run it:
```
npm install                 # repo root, once
npm run dev                 # API :4100 + web :5273
```
Dev login: `dev@gvnutrition.local` / `GvnDev@2026` (created via AUTH_BOOTSTRAP; change it).

**Verified working end-to-end:** brand/category/product/variant creation, purchase
save-and-receive, POS checkout with 5% GST (₹4200 inclusive → ₹4000 taxable + ₹100
CGST + ₹100 SGST), invoice numbering `GVN-2026-0000001`, invoice PDF with HSN column,
manual EXPIRED write-off, stock ledger arithmetic (20 − 4 sold − 3 expired = 13),
inventory valuation at WAC, business position, the two-step bulk import, and all
25 read endpoints.

**THE TRAP — it has bitten three times. Read before any schema change.**
A clean `tsc` proves almost nothing in this codebase. Three separate ways:

  1. **Raw SQL is just a string.** `analytics.service.ts` and
     `purchase-analysis.service.ts` joined the dropped `colors`/`sizes` tables and
     `products.brand_id`. Clean typecheck, 500 at runtime.
  2. **Frontend API types are hand-written.** `catalog-page.tsx` declared
     `brand: string | null` after the API started returning an object — compiled
     fine, crashed the page with `p.brand?.trim is not a function`.
  3. **`as const` hides Prisma include errors.** `skuLookupInclude` kept `brand`
     nested inside `product.select` after brand moved to the variant. The literal
     type slipped past Prisma's checker; the search endpoint 500'd.

Worse, a swallowed `catch` in the stock-adjustment sheet rendered that 500 as
"no results", so it looked like an empty search rather than a broken one.

**After ANY schema change:** run the API, hit every endpoint, and click the screens.
`node /tmp/smoke.mjs`-style sweeps caught all of these; the compiler caught none.
Do not add `catch {}` blocks that hide fetch failures.

## 0. HOW TO USE THIS DOC
Open Claude Code in the GV Nutrition folder. First message:
  "Read docs/GVN_handoff.md and continue the GV Nutrition build.
   Attire is frozen — do not touch its logic/math/data."

## 1. THE ABSOLUTE RULE
Attire by GV's BUSINESS LOGIC, CALCULATIONS, MATH, and DATA are FROZEN — never change them.
(Additive, harmless features in Attire — like the cross-link switch button — are allowed and
already done.) ALL GV Nutrition work happens in its OWN separate copy — never in Attire's repo,
database, or deployment.

## 2. THE MODEL
GV Nutrition = a SEPARATE COPY of Attire's proven system, rebranded and refitted for supplements.
Fully independent:
  - Own GitHub repo: `rms_gvnutrition` (clone of Attire's code).
  - Own Railway PROJECT with its own 2 services (frontend + backend).
  - Own Supabase database (dev + prod).
  - Own domain: **gvnutrition.attirebygv.in**
Trade accepted: shared fixes are done twice; in return, Attire is provably untouched.

## 3. CORE PRINCIPLE — SAME ENGINE, REFITTED FOR NUTRITION
Every screen, flow and calculation is reused AS-IS. What changes is the BRAND and the PRODUCT
MODEL — not how anything works.

Reused unchanged: catalog, variants, inventory (append-only ledger + WAC), purchases + receive +
purchase returns, POS billing + discounts + GST + payments + invoices + credit notes, giveaways,
customers, expenses, capital / business position, reports & analytics, bulk import, WhatsApp, auth.

## 4. WHAT CHANGES

### 4.1 Branding
  - Name: "GV Nutrition".
  - Theme: BLACK & WHITE with GREY accents (Attire is crimson). Charts keep multiple colours.
  - Name/logo via env — `VITE_STORE_NAME`, `VITE_STORE_LOGO_PATH`, backend `STORE_*`.
  - Logo assets: `frontend/public/brand/logo.png` (web) and `backend/assets/logo.png` (invoice PDF).
    Owner supplies the real PNG; use a placeholder in dev, real value set in Railway.
  - **Dark mode: KEPT.** A black-and-white brand makes the toggle more natural, not less —
    light = white ground / black text, dark = black ground / white text. Both are on-brand,
    the infrastructure already exists, and it costs nothing. (Owner left this call to the
    developer.)

### 4.2 Product attributes — the refit
Attire's two optional per-SKU attributes are relabelled and remodelled. SAME mechanism, both
still OPTIONAL (unflavoured creatine or a plain shaker may leave them blank).

  - **Colour → Flavour.** Seed ONLY two rows: **Chocolate** and **Unflavoured**. Everything
    else the owner adds themselves through the UI. Do NOT ship a long preset flavour list.
  - **Size → Pack Size**, which is measure-aware. Staff first pick the MEASURE, then the VALUE.
    Each measure offers common presets AND free manual entry:

    | Measure | Unit    | Presets                                | Used by                     |
    |---------|---------|----------------------------------------|-----------------------------|
    | Weight  | g / kg  | 250g, 400g, 500g, 1kg, 2kg, 3kg, 5kg   | whey, gainer, creatine, oats|
    | Volume  | ml / L  | 250ml, 500ml, 1L                       | liquid supplements          |
    | Count   | pieces  | 30, 60, 90, 120                        | tablets, capsules           |

    Pack sizes are a **SHARED managed table**, exactly like Attire's `Size` — "1kg" is ONE row
    reused by every product that needs it, not free text per product. A manual entry creates a
    new shared row that is then available everywhere. This keeps filtering and reporting clean.

    Store a normalized numeric value alongside the display label so sorting is correct —
    otherwise "500g" sorts before "1kg" alphabetically and every screen looks broken.
    Compare within a measure only; never across measures.

  - **`brand` is a MANAGED ENTITY on the VARIANT (not the product).** Free text fragments into
    "ON" / "Optimum" / "optimum nutrition" and destroys brand-wise reporting, so it is its own
    table with owner-editable CRUD and a dropdown.

    It sits on the **variant** because one product must hold the same flavour and pack size
    from several companies:

    ```
    PRODUCT: Whey Protein          (no brand of its own)
      ├─ Optimum Nutrition · Chocolate · 500g   own SKU, cost, price, stock
      └─ MuscleBlaze       · Chocolate · 500g   own SKU, cost, price, stock
    ```

    Consequences to respect:
      - `products` has NO `brand_id`. Any raw SQL joining `brands` must join `pv.brand_id`.
      - Filtering products by brand means `variants: { some: { brandId } }` — and it must be
        MERGED into the single `variants` key in the where-clause, since a second `variants`
        property silently overwrites the first.
      - The catalog card lists every company found across a product's variants.
      - In the builder, brand is picked on the VARIANT step: choose the company, tick its
        flavours and pack sizes, save, then repeat for the next company.

  - **`ProductKind.APPAREL` → `SUPPLEMENT`.** `ACCESSORY` stays (shakers, gym gear).
    The two-tab split on catalog / inventory / purchases / reports is KEPT:
    "Supplements | Accessories".
  - **`ProductGender` is REMOVED entirely.** It is currently mandatory on product create
    (`catalog.validators.ts`) and rejects empty rows in bulk import — it would block uploading
    whey protein. Not relevant to nutrition.
  - **Categories are DATA, not code.** Full CRUD already exists (`/categories` + "New category"
    in `catalog-page.tsx`). The owner adds/edits categories forever without a developer.
    Do NOT hardcode a category list.

### 4.3 GST — same engine, same numbers
  - Rates: **5% supplements** (2.5 CGST + 2.5 SGST), **18% accessories** (9 + 9).
  - These are NUMERICALLY IDENTICAL to Attire's existing defaults in `lib/gst-defaults.ts`
    (apparel 5%, accessory 18%). Only the enum name changes. **No rate edits needed.**
  - Attire runs with the GST toggle OFF; GV Nutrition runs the SAME feature with it ON.
  - `STORE_GSTIN` supplied by owner; placeholder in dev, real value in Railway.
  - DO NOT build a new GST system — no input-tax-credit engine, no GST returns, no changed
    valuation. The invoice PDF is ALREADY a GST-format tax invoice (prints GSTIN, taxable
    amount, CGST, SGST).

### 4.4 HSN codes — optional, additive
  - Add an OPTIONAL HSN field per product; prints on the invoice only when filled.
  - Rationale: two different rates now coexist (5% / 18%), and HSN justifies the difference;
    required if turnover crosses ₹5 crore or any B2B selling starts. Entered ONCE per product,
    so it is not a recurring data-entry burden. Blank = no burden, no printing.

### 4.5 Cross-link switch button
  - Attire already has "⇄ GV Nutrition" in its top bar (live, additive only).
  - Nutrition needs the mirror "⇄ Attire by GV".
  - **Bug to fix:** `top-bar.tsx` was cloned verbatim, so `OTHER_APP_NAME` still falls back to
    "GV Nutrition" — the wrong direction for this repo. It only looks right in production
    because the Railway var overrides it. Fix the fallback.

## 5. EXPIRED STOCK — MANUAL WRITE-OFF (IN SCOPE)
Read this together with §5.1. The distinction is the whole point: **no expiry data is ever
captured at purchase time.** Staff notice an expired product on the shelf, mark it expired, and
it leaves stock. Effort is incurred only when something actually expires.

What is needed:
  - Add **`EXPIRED`** to the `StockAdjustmentReason` enum (currently DAMAGE, SHRINKAGE, FOUND,
    CORRECTION, OTHER). Keep it a SEPARATE reason from DAMAGE so expiry loss is reportable
    on its own.
  - Build the **stock-adjustment UI** (pick product, quantity, reason, note). The backend is
    ALREADY complete — `POST /adjustments` + `createAdjustment` in `inventory.service.ts` —
    but NOTHING in the frontend calls it today. The inventory page only DISPLAYS existing
    damage/adjustment movements. This one form also unlocks damage, shrinkage and corrections.
  - Report expiry loss separately from damage. Note: analytics currently groups by MOVEMENT TYPE
    (`DAMAGE_OUT`), not by reason — so reporting by reason is a small addition.

How the numbers settle — **no formula is touched**:
  - Quantity leaves via the existing append-only ledger (`DAMAGE_OUT` movement), same
    transaction, never negative.
  - Inventory valuation falls automatically, because valuation is `on-hand qty × WAC`.
  - Cash is UNCHANGED — correct, because that money left when the supplier was paid.

Giving stock away before it turns is also already supported: the POS giveaway
(`isGiveaway` / `giveawayReason`) is costed at WAC in analytics.

## 5.1 EXPLICITLY REJECTED — DO NOT BUILD
These were considered and **declined by the owner**. Do not re-introduce them in a later
session without an explicit new instruction. In particular, do NOT "upgrade" the manual
write-off in §5 into any of the following.

  - **Expiry DATE tracking** — rejected. It costs data entry on EVERY purchase line, forever,
    to surface something the owner already manages by eye.
  - **Batch / lot numbers, FEFO, near-expiry alerts, expired-stock POS blocking** — all rejected
    as consequences of the above.
  - **Supplier expiry-return policy modelling** — not needed: brands accept NO returns on
    expired goods. Expired stock is a 100% loss.
  - **Veg / non-veg mark** — rejected.
  - **FSSAI licence number on invoices** — rejected. `STORE_GSTIN` only.

## 6. MONEY-MODEL INVARIANTS — FROZEN
Never edit: `lib/pricing-engine.ts`, `lib/gst-calculator.ts`, `lib/purchase-return-wac.ts`,
`modules/inventory/inventory.service.ts`, `modules/capital/capital.service.ts`.

  - Cash-in-hand = capital + sales − stockCashOut(received PO grandTotal) − expenses
    − drawings + supplierRefunds.  WAC never enters cash.
  - Inventory valuation = on-hand qty × WAC.
  - WAC = Σ(qty_received × unit_cost_exclusive) / Σ(qty_received), from received purchase lines.
    Purchase returns never move the WAC basis.
  - Append-only inventory ledger; balance changes only with a matching log in the SAME
    transaction; never negative on outbound.
  - Purchase returns: book value = qty × WAC; cash += actual refund; difference = gain/loss;
    atomic; idempotent (unique key; mismatched-payload reuse rejected).
  - Bulk import: two-step (catalog then stock); receive_only updates existing variant prices
    (cost/list > 0, threshold when supplied); commitStock resolves SKUs CASE-INSENSITIVELY.

## 7. BULK IMPORT — READY
Template: `docs/GVN_bulk_import_template.xlsx` (Import + Instructions sheets). Verified
end-to-end through the real scan → commit-catalog → commit-stock path.

Columns: `sr_no, product_name, sku, shelf_category, kind, brand, flavour, pack_size,
quantity, cost_price, list_price, cgst_pct, sgst_pct, igst_pct, low_stock_threshold,
supplier_name, gst_inclusive, hsn_code`

  - **`sku` is left BLANK.** The owner never types SKUs, so the importer generates
    `BRAND-PRODUCT-FLAVOUR-PACKSIZE` via `generateImportSku()` (mirror of
    `generateUniqueSku()` in variant.service.ts — keep them in sync).
  - **Row identity for a blank-SKU row is product + brand + flavour + pack size**
    (`identityKey()`). A match means "receive stock into that variant"; no match means
    create. Re-importing the same sheet therefore adds stock instead of duplicating.
  - The same product + flavour + pack size from TWO companies is two rows and becomes
    two variants of one product — this is the case the template's first two rows show.
  - `commitStock` resolves `row.variantId` FIRST, falling back to the CASE-INSENSITIVE
    SKU map for sheets that do supply codes. Resolving by SKU alone breaks blank-SKU rows.
  - Suppliers are NEVER auto-created; they must exist before importing.
  - Duplicate detection covers both SKUs and identities within one file.

## 8. WHATSAPP
Same WATI account for both businesses; only the TEMPLATE and business NAME differ. The module
already reads the template name from `WATI_INVOICE_TEMPLATE_NAME` + branding. A second
nutrition-branded template must be created and approved (has lead time). Same sender number.
Owner to supply template details.

## 9. AUTH / LOGINS
No staff accounts — two logins total:
  - **Dev:** proposed by the developer, used for local/dev work.
  - **Prod:** `gvnutritionsurat@gmail.com`; password set by the owner DIRECTLY in Railway env.
  - Passwords NEVER go in the repo — environment variables only.
  - First admin via `AUTH_BOOTSTRAP_ENABLED=true` once, then set back to false.

## 10. DEPLOYMENT (Railway — same pattern as Attire)
  - New Railway project → gvnutrition-frontend + gvnutrition-backend, Root Directory "/",
    same Dockerfiles as Attire.
  - Own domain (gvnutrition.attirebygv.in) + own Supabase (dev + prod).
    Backend runs `prisma migrate deploy` per DB.
  - Branding via env: `VITE_STORE_NAME`, `VITE_STORE_LOGO_PATH`, `VITE_API_URL`, etc.
  - Switch button env: `VITE_OTHER_APP_URL=https://attirebygv.in`,
    `VITE_OTHER_APP_NAME=Attire by GV`.

  *** CRITICAL VITE + DOCKERFILE GOTCHA (learned the hard way) ***
  The frontend build is Docker-based. A VITE_* variable reaches production ONLY if you do BOTH:
    1. Set it in the Railway service Variables, AND
    2. Add matching `ARG VITE_X` + `ENV VITE_X=$VITE_X` in frontend/Dockerfile (before
       `RUN npm run build`).
  Skip the Dockerfile step and `vite build` never sees the var → it bakes as undefined.
  Any NEW VITE_* var for nutrition MUST be added to frontend/Dockerfile too.

## 10.1 MIGRATION HISTORY — RESET
Owner decision: **delete Attire's 22 inherited migrations entirely** and start from a fresh
initial migration. This is a new project with its own DB and hosting; Attire's migration
history carries no value here.

  - Remove `backend/prisma/migrations/*`, then generate ONE clean initial migration containing
    the full nutrition schema (Flavour, shared Pack Size, Brand entity, `SUPPLEMENT` enum,
    no `gender`, optional HSN, `EXPIRED` reason).
  - **Precondition: the dev database must be EMPTY.** If Attire's migrations were ever applied
    to it, the tables must be dropped first or the fresh initial migration will collide.
  - Consequence (accepted): this repo can never again be pointed at an Attire-shaped database,
    and future shared fixes involving migrations must be hand-ported rather than merged.

## 11. BUILD ORDER — status
  0. ✅ Migration history reset; one initial migration `init_gvnutrition`, 33 tables.
  1. ✅ Rebrand: black/white/grey theme, name, logo path, env wiring, switch-button default fixed.
  2. ✅ Product model refit: Flavour, measure-aware Pack Size, Brand entity, `SUPPLEMENT`,
        `gender` removed, optional HSN.
  3. ✅ Bulk-import template reshaped → `docs/GVN_bulk_import_template.xlsx` (scanned + committed
        successfully through the real importer).
  4. ✅ GST 5% / 18% carried over unchanged; verified 5.00% on a real sale.
  5. ✅ Stock-adjustment UI + `EXPIRED` reason. NOTE: the backend existed, the UI did not —
        this form also unlocks damage / shrinkage / found / correction.
  6. ⬜ Second WhatsApp template — blocked on owner supplying template details.
        `WHATSAPP_ENABLED=false` until then; nothing else is blocked by it.
  7. ✅ End-to-end verification against the dev DB (see AS-BUILT NOTES).
  8. ✅ Template handed over.
  9. ⬜ Owner fills the template with opening stock + opening balances; import it.
 10. ⬜ Deploy: Railway project, prod Supabase, domain, Dockerfile ARG/ENV per §10.

## 11.2 EXPIRY REPORTING — BUILT (owner-requested)
Expired stock now appears as a cost on the **Expenses** page, at the owner's request.

`getExpenseSummary` joins `inventory_logs` → `stock_adjustments`
(`reference_kind = 'STOCK_ADJUSTMENT'`, `quantity_delta < 0`) and groups by `reason`,
valuing units at the SAME WAC basis as giveaways and inventory valuation. New fields:
`expiredUnits`, `expiredCost`, `expiredCostInclGst`, `otherWriteOffUnits`,
`otherWriteOffCost`, `writeOffCost`, `writeOffByReason`.

**The Expenses page profit formula changed — deliberately:**
```
netProfit = grossRevenue − totalExpenses − promotionalCost − writeOffCost
```
This mirrors the pattern already there: giveaway stock was ALREADY costed at WAC and
subtracted. Expired stock is the same kind of loss, so it is treated the same way.

**What did NOT change — no double counting:**
  - Cash-in-hand: untouched. That money left when the supplier was paid; expiry moves no cash.
  - Inventory valuation: untouched. It already fell when the quantity left the ledger.
  - `analytics/profit/summary`: untouched — that one has real COGS and is a separate figure
    from the Expenses page's simplified profit.
  - The WAC formula, the GST engine and the inventory ledger: untouched.

`expiredCostInclGst` is DISPLAY ONLY (WAC + the GST paid, unrecoverable on binned goods).
It never feeds cash, valuation or netProfit.

Caveat worth knowing: the Expenses page's "Net profit" has never subtracted COGS on sold
goods, so it is revenue minus operating costs minus stock losses — not accounting profit.
Use `analytics/profit/summary` for the COGS-based figure.

## 10.2 SKU — AUTO-GENERATED, NEVER TYPED
It cannot be removed — bulk import matches on it (case-insensitively) to decide
receive-vs-create, and POS lookup searches it. So it is generated, never entered:

  - Format: **`BRAND-PRODUCT-FLAVOUR-PACKSIZE`** (owner asked for the brand tag in the code),
    e.g. `OPTIMUM-NUTRITION-WHEY-PROTEIN-CHOCOLATE-500G`.
  - `sku` is OPTIONAL on `POST /catalog/products/:id/variants`. Omit it and
    `generateUniqueSku()` builds the code. Segments are length-capped (brand 18, product 22,
    flavour 12, pack 8; whole code 58) so long names cannot overflow the 64-char column.
  - A `-2`, `-3`… suffix is still appended on collision — a safety net for two brands whose
    names truncate to the same token.
  - The variant builder shows the code READ-ONLY as "SKU (auto)". `previewSku()` in
    `catalog-page.tsx` mirrors the server rule — **keep the two in sync**.
  - Existing variants keep whatever SKU they were created with; the format is not applied
    retroactively.
  - Do NOT reintroduce a typed/required SKU field.

## 10.3 BRAND MUST BE VISIBLE EVERYWHERE
Because brand sits on the variant and is often the ONLY difference between two
otherwise-identical items, it is shown wherever a variant appears:

  POS variant chips · POS cart rows · Receive stock variant chips + purchase cart ·
  Adjust stock search + selected lines · Catalog SKU dialog · Live stock ·
  Valuation · reports / invoices / purchase returns (brand leads `variantLabel`).

Rendered by `components/catalog/brand-tag.tsx`. It uses **no fixed colours** —
`border-current` + `text-current` + low opacity, so it inherits its surroundings
(dark on a light row, light on a selected black chip). An earlier hardcoded grey
looked dirty against the POS's black selected state. Returns `null` when a variant
has no brand.

**Brand is also SEARCHABLE** in POS (`billing.service.ts` POS search), Receive stock
and catalog (`product.service.ts` — matches brand, flavour, pack size and SKU through
`variants: { some: ... }`), and the SKU lookup used by Adjust stock.

## 11.1 SETTLED DEFAULTS (owner-confirmed)
  - **Invoice numbering: `GVN-` prefix, starting from 1.** Mechanism verified — `allocateInvoiceNumber`
    in `billing.service.ts` atomically increments an `InvoiceSequence` singleton inside the
    transaction and formats `INV-<IST year>-<7 digits>`. Only the literal prefix changes:
    `GVN-2026-0000001`. It is an identifier, not money math. Fresh DB ⇒ starts at 1 naturally.
  - **Dead clothing fields on `Customer`:** `preferredSizes` (Json?) is a clothing concept and is
    **unused anywhere in the codebase** — drop it. `preferredCategories` is also unused but stays
    valid for nutrition; keep it.
  - Schema header comment still reads "Gym Clothing & Accessories RMS" — update it.
  - `EXPIRED` is its OWN stock-adjustment reason, reported separately from DAMAGE.
  - Write-off reports show BOTH stock value at WAC and a display-only "actual cost incl. GST"
    column. Display only — never feeds cash or valuation.
  - HSN: optional field, prints only when filled.
  - Serving size / servings per container: NOT built.
  - Dev DB connection strings (`DATABASE_URL`, `DIRECT_URL`): owner sets them in `backend/.env`
    directly. Migrations cannot run until they are present.
  - WhatsApp: build the functionality now; the template NAME arrives later via
    `WATI_INVOICE_TEMPLATE_NAME`, so nothing is blocked.

## 11.9 BULK IMPORT STEP 1 — REWRITTEN FOR SPEED AND RETRY SAFETY

**The incident.** On the client's first real import, step 1 (catalog creation) ran for
minutes and died part-way. They restarted it and ended up with every product twice:
an orphan on the clean SKU with 0 stock, and a `-2` twin holding the real stock.
Step 2 (receive stock) was never at fault.

**Why it was slow.** `commitCatalog` issued one database round-trip per row per
entity — an existence probe and an insert for each flavour, pack size and brand, a
slug probe loop per product, a SKU-collision probe loop per variant, then a nested
create. Several thousand SEQUENTIAL queries for a few hundred rows. At the ~100 ms
round-trip of the Supabase pooler that is minutes of wall clock.

**Why it duplicated.** Two separate faults, both fixed:
  - The commit trusted the SCAN payload, which was computed *before* the failed run
    wrote anything. On the retry every row still said "create", so
    `generateImportSku` found the SKU taken and appended `-2`.
  - Products were matched only within the current request, never against the
    database. `products.name` has no unique index (only `slug` does), so the retry
    happily created a second product under slug `…-1`.

**What it does now.**
  - Every table is read ONCE into a Map, resolved in memory, and written with
    `createMany`. A fixed ~17 queries regardless of sheet size.
  - Slugs and SKUs are made unique against in-memory sets (`claimUnique`,
    `claimUniqueSku`) instead of a query per candidate. The SKU set holds
    UPPERCASE, because Postgres' unique index is case-sensitive and would
    otherwise accept a lowercase twin.
  - Every row is re-resolved against the CURRENT database at commit time: by
    explicit SKU, then by identity (product + brand + flavour + pack size, **by
    ID**, so `500 g` vs `500g` spelling drift cannot fool it). Anything already
    present is reused and its price fields refreshed — never created again.
  - The refresh path is one `UPDATE … FROM (VALUES …)`, not one statement per row.
    That path matters most on a retry, where every row resolves to an existing
    variant; 400 individual updates took ~22 s, which is how a re-run could time
    out all over again.
  - The `bulk_import_batches` row is written LAST. Created up-front, it survived a
    failed run and left a phantom AWAITING_STOCK batch nothing could receive against.

**Measured on the dev DB, 400 rows** (100 products, 3 brands, 400 variants):
  - first run **1.9 s**; retry of the same payload **0.9 s**
  - duplicates created by the retry: **0**; variants missing an inventory balance: **0**

**Where the logic lives.** The create-vs-reuse decision is in
`src/lib/bulk-import-catalog-plan.ts` — deliberately pure, with no Prisma calls, so
it can be exhaustively unit-tested (`bulk-import-catalog-plan.test.ts`, including
the exact interrupted-import retry). The service only performs the batched I/O.

**Cleaning up an already-duplicated database.** `backend/scripts/dedupe-variants.ts`.

Step 1 groups variants by identity, keeps one per group (most stock, then most
history, then oldest) and deletes the rest ONLY when they are completely untouched —
zero stock and no sale, purchase, return, adjustment or inventory-log line. Anything
else is listed and skipped, never force-deleted. When the survivor is the retry's
`-2` copy and the clean code is freed by a sibling in the same group, the survivor
reclaims it in the same transaction (nothing but the variant row stores a SKU).

Identity here is keyed on **NAMES, not foreign keys**. The interrupted run also
duplicated the PRODUCT row, so `HYDE PRE` exists twice and its two variants
legitimately carry different `product_id` values while being one item to the
shopkeeper. A first pass keyed on ids cleaned only the 7 pairs that happened to
share a product row and left the rest untouched. Flavours, brands and pack sizes
cannot split this way — `name`/`code` are unique — so the product row is the only
thing that ever does.

Step 2 then merges the duplicate product rows: surviving variants are repointed to
one keeper (most variants, then oldest), `offer_products` links are moved rather
than left to CASCADE away with the shell, an HSN code present on only the absorbed
twin is copied to the keeper, and the emptied shells are deleted. Without this the
catalog lists the same product twice and a later import resolves the name to only
one of them.

Dry run by default; `--apply` to write. It prints the target database host (never
credentials) first, so a destructive run cannot be pointed at the wrong DB.

## 11.10 MRP ON RECEIVE STOCK — BUILT (owner-requested)

Cost price already refreshed itself on every receive. The owner asked for the same
for MRP: when a supplier puts the rate up, the shelf price usually has to follow, and
that decision is made at the moment the goods are booked in — not later in the catalog.

Receive stock now has **two** rate boxes: purchase rate and MRP. Both are pre-filled
from the master catalog (`ProductVariant.costPrice` / `listPrice`), both editable, and
both are written back to the catalog **when the stock is received**.

  - Cost pre-fills from `costPrice`, which is itself refreshed on every receive — so it
    is the rate actually paid last time, not a figure frozen at product creation.
  - Each box carries the same live hint: what it was before, and how far the typed
    value moves it (`up ₹200 (13%)`). The MRP hint also shows the resulting margin
    against the typed cost, and warns when the MRP sits below the purchase rate.
  - A note under both boxes says plainly that they are pre-filled, that leaving them
    keeps the current values, and that they should be changed if the rate has moved
    either way. Pre-filled boxes are easy to misread as "already handled".
  - The purchase cart flags any line that repriced the shelf (`MRP ₹2,600 → ₹2,900`).
    An MRP change is the one thing in that cart that outlives the purchase.

**Blank or 0 means "leave the shelf price alone"** — `normalizeLineListPrice` collapses
both to NULL in `purchase.service.ts`. Storing 0 would reprice the item to free.

`purchase_order_items.list_price` (nullable, migration `purchase_line_mrp`) holds the
MRP on the line until receive. It is applied by BOTH receive paths — the staged
`receivePurchase` and the single-shot `saveAndReceivePurchase` the UI calls — so the
staged path cannot silently drop it. **The column is master-data instruction only:**
it takes no part in any purchase total, GST figure, WAC, COGS or cash calculation.
Nothing in the frozen Attire math is touched.

Verified end-to-end against the dev DB: rate 1600→1800 with MRP 7000→2600 applied both;
a receive with the MRP omitted left the shelf price alone while still tracking cost;
an explicit MRP of 0 also left it alone. Test writes were reverted afterwards.

**Schema drift fixed alongside:** `product_variants_brand_id_idx` was created by the
`brand_moves_to_variant` SQL but never declared in `schema.prisma`, so `migrate dev`
generated a `DROP INDEX` for it. The index is now declared. Brand is joined in
analytics and filtered in the catalog — dropping it would have been a silent
performance regression.

## 11.11 CATALOG DELETE — FIXED (raw FK error at the UI)

Deleting a SKU threw a raw Prisma error into a toast:
`Foreign key constraint violated: inventory_logs_variant_id_fkey`.

Both `deleteVariant` and `deleteProduct` decided "safe to hard-delete" by counting
**`orderItems` only**. A variant that had been PURCHASED but never sold therefore
looked disposable and fell through to the hard delete, where the append-only
inventory log's `Restrict` foreign key rejected it. Every one of the five relations
— sales, purchases, returns, adjustments, inventory logs — is `Restrict` on purpose:
a variant that has ever moved must be deactivated, never destroyed, or stock
valuation, COGS and the reports stop reconciling.

Both paths now count all five, via `src/lib/catalog-history.ts` so they cannot drift
apart again. Behaviour:

  - **Stock on hand** → still refused outright (409), unchanged.
  - **Any history** → deactivated, SKU/slug mangled so the code is free to re-create.
    The ledger is untouched.
  - **Nothing at all** → hard-deleted as before.

Two further faults fixed alongside:

  - `deleteProduct`'s soft-delete left its variants ACTIVE, so the product vanished
    from the catalog while its SKUs stayed sellable at the counter. Variants are now
    deactivated with it, in one transaction.
  - `deleteProduct`'s hard-delete path assumed the caller had already removed every
    variant; with any still attached it hit the same `Restrict` wall. It now clears
    balances and variants itself, so it is correct regardless of call order.

The endpoint returns `{ outcome: "deleted" | "deactivated" }` instead of a bare 204,
and the catalog page reports which actually happened — telling the shopkeeper "SKU
deleted" when the row is deliberately still there is a lie they trip over the first
time they open a report. The follow-up product delete in the UI also no longer
swallows its error: that `catch {}` was hiding this very failure, leaving products
that looked deleted and returned on the next refresh.

Verified against the dev DB across all five paths — logs-but-no-sales, product
soft-delete, untouched variant, untouched product with a variant attached, and
stocked-variant refusal. Test writes were restored afterwards.

## 11.12 DEV DATA RESET

`backend/scripts/reset-dev-data.ts` empties every business table and keeps only the
logins. Dry run by default.

```
cd backend
npm run db:reset-dev              # show what would go — writes nothing
npm run db:reset-dev -- --yes     # actually clear it
```

**Kept:** `users` and `refresh_tokens` (you stay signed in), `_prisma_migrations`,
and the `invoice_sequence` singleton — RESET to 0, not deleted, so numbering
restarts at `GVN-<year>-0000001` instead of the billing code hitting a missing row.

**Cleared:** everything else — orders, purchases, returns, inventory and its ledger,
the whole catalog (products, variants, brands, flavours, pack sizes), customers,
suppliers, offers, expenses, capital entries, import batches, notifications,
WhatsApp logs.

The table list is read from `information_schema`, never hardcoded. The script it
replaced (`clear-business-data.mjs`, deleted) carried a hand-written array still
naming `categories`, `colors` and `sizes` after the nutrition refit dropped them —
so it would have failed outright — and had never been taught about `brands`,
`flavours`, `pack_sizes`, `expenses`, `capital_entries`, `purchase_returns`,
`purchase_return_lines` or `bulk_import_batches`. Reading the list from the database
is what stops that recurring.

Guards: refuses `NODE_ENV=production`; prints the target host (no credentials) before
doing anything; requires `--yes`; and afterwards asserts that the target tables are
empty AND that the user and refresh-token counts are unchanged — a stray CASCADE
reaching the logins is the one failure that would actually hurt, so it is checked
rather than assumed.

Verified by running the real `TRUNCATE` inside a transaction and rolling it back:
765 rows cleared, logins untouched, sequence reset, then the dev data restored intact.

**Re-seeding the suppliers afterwards:** `npm run db:seed-suppliers` puts the owner's
33 companies back (`backend/scripts/seed-suppliers.ts`). Additive and idempotent —
matches on name ignoring case and extra spaces, so re-running skips what is already
there and reactivates anything previously soft-deleted rather than adding a twin.
That matching has to live in the script because `suppliers.name` carries only an
ordinary index, not a unique one, so the database will happily take the same company
twice. Spellings are stored exactly as the owner gave them.

## 11.13 EDIT A PRODUCT AFTER CREATION — BUILT (owner-requested)

Only the SKU code was editable once a product existed. A detail missed at creation —
a flavour never entered, a weight left blank, a misspelt name — could not be fixed.

The SKU dialog now edits everything:

  - **Product details:** name, type, HSN code.
  - **Per SKU:** brand, flavour, pack size / weight, MRP, low-stock alert, SKU.
  - Flavours, brands and pack sizes can be created inline from those dropdowns
    ("+ Add a flavour..."), so a value that never existed is no obstacle. Pack sizes
    are PARSED, not taken literally, so "500 G" lands on the same row as "500g" and
    the measure is inferred instead of being asked for.

Everything is a foreign key on the variant, so a change propagates by itself —
billing, live stock, purchase and every report read through the same relation. Only
the SKU is copied text, and nothing else stores it (verified: `sku` appears exactly
once in schema.prisma), so renaming one disturbs no history.

**SKU regeneration.** The code is BRAND-PRODUCT-FLAVOUR-PACKSIZE, so changing an
attribute without rebuilding it leaves a code describing the old one. `updateVariant`
takes `regenerateSku`, and the UI sends it whenever the code has not been typed by
hand — type in the box and it is kept verbatim instead, with a link back to
automatic. `generateUniqueSku` now takes a `selfId` so a variant's own current code
does not count as a collision, which would otherwise push every re-save to "-2".

**Renaming re-slugs.** `generateUniqueSku` builds codes from `product.slug`, so a
rename that left the slug behind would keep minting SKUs spelling the old name.
`updateProduct` now derives a fresh unique slug when the name actually changes and no
slug was passed explicitly. After a rename the dialog offers "Rebuild SKUs" rather
than silently rewriting codes the owner may have chosen deliberately.

Verified against the dev DB across 11 paths: filling in a flavour and a pack size
that were never set; swapping a flavour (old one gone from the code); rename moves
the slug; rebuild picks up the new name; re-saving unchanged drifts neither SKU nor
slug; a hand-typed SKU wins; clearing a flavour back to none; and two variants
collapsing onto one code get "-2" rather than colliding. Fixtures were removed after.

## 11.14 BULK IMPORT STEP 2 — "THESE SKUS ARE NOT IN THE CATALOG YET" (production fix)

Step 1 reported success (1 product, 7 variants created), then step 2 refused two of
the rows: *"These SKUs are not in the catalog yet — create the catalog first: High
Protein Muesli · PINTOLA · Dark Choco · 1KG, ..."*. It had just created them.

**Cause: the two steps identified a row differently.** The scan FUZZY-matches product
names at 85% similarity, so a sheet saying `High Protein Muesli` is deliberately
attached to the catalog's existing `HIGH PROTEIN MUESLIE` (trailing E) and the row
arrives carrying that product's ID. Step 1 correctly created the variant under it.
Step 2 then rebuilt the row's identity from the RAW SHEET TEXT —
`high protein muesli||pintola||dark choco||1kg` — which never matches the stored
`high protein mueslie||...`. Any row the scan resolved to a differently-spelled
existing row hit this: it is not limited to product names.

**Fix: one resolver, used by both steps.** `resolveRowRefs()` in
`bulk-import-catalog-plan.ts` turns a sheet row into the four reference IDs, with the
ids the scan already resolved always winning over a name lookup. Step 1 and step 2 now
call it, and step 2 keys its variant map on `variantIdentity()` (IDs) instead of text.
The two agree by construction rather than by both happening to normalise the same way.
Text matching is kept only as a last resort for rows that carry no ids at all.

Regression tests cover the exact failure (a scan-supplied productId beating the
sheet's own spelling; both steps deriving the same identity for a fuzzy-matched row)
plus pack-size spelling drift and unknown names. Reproduced end-to-end against the dev
DB first — catalog product `ZZREPRO HIGH PROTEIN MUESLIE`, sheet row
`ZZREPRO High Protein Muesli` — and confirmed 10 units land across 2 POs.

**Recovering the stuck production batch:** upload the same sheet again and run both
steps. The catalog step is idempotent (§11.9), so it re-creates nothing; the rows then
resolve to the variants that already exist and the stock goes in.

**Also corrected:** the step-2 panel said *"You can also receive this stock later from
the History tab."* History lists batches and offers a rollback — it has NO receive
control, so that was a dead end for anyone who clicked "Not now". It now describes the
re-upload path instead.

## 11.15 SUPPLIER EDIT & DELETE — BUILT (owner-requested)

The Suppliers directory was read-only: a supplier could be added but never corrected
or removed. A typo in a name was permanent.

Each row now has an inline edit (name / phone / email, Enter to save, Esc to cancel)
and a remove with a confirm step. `PATCH /suppliers/:id` already existed and needed no
change; `DELETE /suppliers/:id` is new.

**Delete follows the same rule as the catalog (§11.11).** `purchase_orders` and
`purchase_returns` both hold `onDelete: Restrict` on their supplier, and rightly so —
those documents are the record of money that left the business, and every purchase
figure, WAC input and cash movement traces back through them. So:

  - **Any purchase history** → the supplier is DEACTIVATED (`isActive: false`), shown
    as *Retired* in the directory, and no longer offered on purchase entry. History
    intact.
  - **Never bought from** → really deleted.

The endpoint returns `{ outcome: "deleted" | "deactivated" }` and the page reports
which actually happened, rather than claiming a deletion that did not occur.

**Retired suppliers are filtered where it matters, not everywhere.** Purchase entry
and Return-to-supplier now request `?isActive=true`; the directory deliberately still
lists them, marked and with a restore button, because that is the screen where you
would notice one was retired by mistake. Filtering them out of the directory too would
have made a retired supplier unrecoverable through the UI.

**Also fixed:** the Add-supplier form swallowed its errors — a rejected email or a
failed save looked exactly like nothing happening. It now surfaces the failure.

Verified against the dev DB across 8 paths: edit all fields; clear phone/email back to
empty; delete an unused supplier (row gone); delete one with a PO (deactivated, PO
survived); hidden from purchase entry while still in the directory; restore; and a
404 on an unknown id. Fixtures removed afterwards.

## 12. PENDING FROM OWNER
  - GV Nutrition logo PNG (placeholder used until then).
  - `STORE_GSTIN` (placeholder used until then).
  - WhatsApp template details.
  - Opening stock + opening balance sheet — after end-to-end testing passes.
  - Prod password — set by owner directly in Railway.
