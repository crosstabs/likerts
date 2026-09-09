import assert from "node:assert/strict";
import test from "node:test";
import { assumptions, evaluate } from "./launch-platform-model.mjs";

test("free grant is one thousand accepted responses per new workspace", () => {
  assert.equal(evaluate({ acceptedResponses: 1000, newWorkspaces: 1 }).usageRevenueUsd, 0);
  const result = evaluate({ acceptedResponses: 100000, newWorkspaces: 25 });
  assert.equal(result.grantResponses, 25000);
  assert.equal(result.billableResponses, 75000);
  assert.equal(result.usageRevenueUsd, 750);
});

test("minimum purchase fee and modeled launch floor are explicit", () => {
  const stripeRate = assumptions.stripePercent + assumptions.stripeFixedUsd / assumptions.minimumCreditPurchaseUsd;
  assert.equal(stripeRate, 0.089);
  assert.equal(evaluate({ acceptedResponses: 0, newWorkspaces: 0 }).fixedPlatformUsd, 99.39);
  assert.equal(assumptions.clerk.optionalPasskeysProUpgradeUsd, 25);
});

test("inputs reject ambiguous fractional counts", () => {
  assert.throws(() => evaluate({ acceptedResponses: 1.5, newWorkspaces: 1 }));
  assert.throws(() => evaluate({ acceptedResponses: 1, newWorkspaces: -1 }));
});
