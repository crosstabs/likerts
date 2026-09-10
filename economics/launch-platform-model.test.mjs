import assert from "node:assert/strict";
import test from "node:test";
import { assumptions, evaluate, admissionCost, cohortUsage, prepaidFlow, costRanges } from "./launch-platform-model.mjs";

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
  const floor = evaluate({ acceptedResponses: 0, newWorkspaces: 0 });
  assert.equal(floor.renderComputeUsd, 65);
  assert.equal(floor.renderUsd, 90);
  assert.equal(floor.fixedPlatformUsd, 125.39);
  assert.equal(floor.incrementalOnExistingPaidPlatformsUsd, 80.39);
  assert.equal(assumptions.clerk.optionalPasskeysProUpgradeUsd, 25);
});

test("inputs reject ambiguous fractional counts", () => {
  assert.throws(() => evaluate({ acceptedResponses: 1.5, newWorkspaces: 1 }));
  assert.throws(() => evaluate({ acceptedResponses: 1, newWorkspaces: -1 }));
});

test('admission bills EVAL and nested commands; paid tiers do not receive the free allowance', () => {
  const result = admissionCost({ redisChecks: 100000, otherCommands: 0, plan: 'payg' });
  assert.deepEqual(result.paygCommandCostRangeUsd, [0.6, 0.8]);
  assert.deepEqual(result.selectedPlanCostRangeUsd, [0.6, 0.8]);
  const exact = admissionCost({ redisChecks: 100, otherCommands: 7, exactStates: { firstWindowChecks: 10, continuingAllowedChecks: 70, deniedChecks: 20 } });
  assert.equal(exact.minimumCommands, 377); assert.equal(exact.maximumCommands, 377);
  assert.throws(() => admissionCost({ redisChecks: 100, exactStates: { firstWindowChecks: 1, continuingAllowedChecks: 1, deniedChecks: 1 } }));
});

test('Free remains zero-cost but infeasible beyond quota and never silently upgrades', () => {
  const result = admissionCost({ redisChecks: 200000, otherCommands: 0 });
  assert.equal(result.currentFreePlanCostUsd, 0);
  assert.equal(result.freeQuotaStatus, 'exceeds_command_quota');
  assert.deepEqual(result.selectedPlanCostRangeUsd, [0, 0]);
  assert.equal(assumptions.admission.observedProviderConfiguration.autoUpgrade, false);
  assert.equal(admissionCost({ redisChecks: 125000, otherCommands: 0 }).freeQuotaStatus, 'within_estimated_command_quota');
  assert.equal(admissionCost({ redisChecks: 150000, otherCommands: 0 }).freeQuotaStatus, 'depends_on_actual_command_mix');
});

test('grant consumption is per workspace and returning free credits are not erased', () => {
  const concentrated = cohortUsage([{ workspaces: 1, responsesPerWorkspace: 10000, isNew: true }, { workspaces: 9, responsesPerWorkspace: 0, isNew: true }]);
  assert.equal(concentrated.grantResponses, 1000); assert.equal(concentrated.billableResponses, 9000);
  assert.equal(concentrated.remainingPromotionalCredits, 9000);
  const returning = evaluate({ workspaceCohorts: [{ workspaces: 10, responsesPerWorkspace: 1000, isNew: false, openingPromotionalCreditsPerWorkspace: 400 }] });
  assert.equal(returning.newWorkspaces, 0); assert.equal(returning.grantResponses, 4000);
  assert.equal(returning.usageRevenueUsd, 60);
  assert.throws(() => evaluate({ acceptedResponses: 1, workspaceCohorts: [{ workspaces: 1, responsesPerWorkspace: 2, isNew: true }] }));
});

test('cash purchases and earned usage reconcile independently without premature revenue or extra processing', () => {
  const purchased = prepaidFlow({ billableResponses: 100, purchaseCount: 10 });
  assert.equal(purchased.cashCollectedUsd, 50); assert.equal(purchased.usageValueEarnedUsd, 1);
  assert.equal(purchased.processingUsd, 4.45); assert.equal(purchased.closingPaidCredits, 4900);
  const consumed = prepaidFlow({ billableResponses: 5000, openingPaidCredits: 5000 });
  assert.equal(consumed.cashCollectedUsd, 0); assert.equal(consumed.processingUsd, 0);
  assert.equal(consumed.usageValueEarnedUsd, 50); assert.equal(consumed.closingPaidCredits, 0);
  assert.throws(() => prepaidFlow({ billableResponses: 501, purchaseCount: 1 }));
  assert.throws(() => prepaidFlow({ billableResponses: 0, purchaseCount: 1, purchaseSizeUsd: 1 }));
  const explicit = evaluate({ acceptedResponses: 5000, newWorkspaces: 0, payments: { openingPaidCredits: 5000, purchaseCount: 0 } });
  assert.equal(explicit.processingUsd, 0); assert.equal(explicit.processingBasis, 'explicit cash purchases');
});

test('local rejection saves Redis checks, while support and abuse remain explicit costs', () => {
  const base = evaluate({ acceptedResponses: 100, newWorkspaces: 1, admissionPlan: 'payg', traffic: { matchedApiRequests: 1000, locallyRejectedRequests: 900, otherCommands: 0 }, activeWorkspaces: 2, labor: { supportMinutesPerActiveWorkspace: 6 } });
  assert.equal(base.admission.redisChecks, 100); assert.equal(base.supportUsd, 15);
  assert.equal(base.sharedLaborUsd, 3600);
  assert.ok(base.serviceCostWithBudgetedLaborRangeUsd[0] > base.serviceCostRangeUsd[0]);
  assert.throws(() => evaluate({ acceptedResponses: 100, newWorkspaces: 1, traffic: { matchedApiRequests: 100, locallyRejectedRequests: 1 } }));
  for (const range of costRanges) {
    assert.ok(range.serviceCostRangeUsd[0] <= range.serviceCostRangeUsd[1]);
    assert.ok(range.withBudgetedLaborRangeUsd[0] > range.serviceCostRangeUsd[0]);
  }
});
