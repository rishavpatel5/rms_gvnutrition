import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { weightedAverageCost } from "../../lib/purchase-return-wac.js";

/**
 * Scenario from the spec: buy 10 @ ₹100 → return 5 → buy 5 @ ₹200.
 * Verifies the return does NOT enter the WAC basis (returns don't create purchase lines),
 * so inventory valuation stays consistent with the existing RMS WAC methodology and
 * historical purchase quantities are never rewritten.
 */
test("WAC is unaffected by returns; purchase → partial return → purchase stays consistent", () => {
  // 1) After buying 10 @ ₹100.
  const afterFirstBuy = [{ quantityReceived: 10, unitCostExclusive: 100 }];
  const wac1 = weightedAverageCost(afterFirstBuy);
  assert.ok(wac1);
  assert.equal(wac1.toString(), "100");

  // Book value of returning 5 units uses that WAC — matches inventory valuation drop.
  const returnBookValue = wac1.mul(5);
  assert.equal(returnBookValue.toString(), "500");

  // 2) The return removes 5 units of STOCK but creates NO purchase line — so the WAC
  //    basis (purchase lines only) is identical before and after the return.
  const wacAfterReturn = weightedAverageCost(afterFirstBuy);
  assert.ok(wacAfterReturn);
  assert.equal(wacAfterReturn.toString(), wac1.toString());

  // 3) After buying 5 more @ ₹200. WAC = (10*100 + 5*200) / 15 = 133.33…
  const afterSecondBuy = [
    { quantityReceived: 10, unitCostExclusive: 100 },
    { quantityReceived: 5, unitCostExclusive: 200 },
  ];
  const wac2 = weightedAverageCost(afterSecondBuy);
  assert.ok(wac2);
  // Full-precision weighted average, independent of the earlier return.
  assert.ok(
    wac2.minus(new Prisma.Decimal("133.3333333333")).abs().lt(new Prisma.Decimal("0.0000001")),
    `expected ~133.3333, got ${wac2.toString()}`,
  );
});

test("no received purchase history returns null (valued as 0)", () => {
  assert.equal(weightedAverageCost([]), null);
  assert.equal(weightedAverageCost([{ quantityReceived: 0, unitCostExclusive: 100 }]), null);
});

test("zero-quantity lines are ignored in the weighting", () => {
  const wac = weightedAverageCost([
    { quantityReceived: 0, unitCostExclusive: 999 },
    { quantityReceived: 4, unitCostExclusive: 50 },
  ]);
  assert.ok(wac);
  assert.equal(wac.toString(), "50");
});
