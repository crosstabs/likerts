import assert from "node:assert/strict";
import test from "node:test";
import { SCOPE_PRESETS, usageView, checkoutView, connectionExamples } from "../public/workspace-state.js";

const usage = (overrides = {}) => ({acceptedResponses: 900, blockedReason: null, credits: {promotionalCredits: 100, promotionalResponses: 900, paidCredits: 500, paidResponses: 0, paidCreditDebt: 0, availableCredits: 600, ...overrides}});
test("balances and thresholds follow authoritative counters, not charge cents or query flags", () => {
  const view = usageView(usage());
  assert.equal(view.accepted, 900); assert.equal(view.promotional, 100); assert.equal(view.paid, 500);
  assert.deepEqual(view.promotionalThreshold, {percent: 90, level: 90});
  assert.deepEqual(view.paidThreshold, {percent: 0, level: null});
  assert.equal(usageView(usage({promotionalCredits: 200, promotionalResponses: 800})).promotionalThreshold.level, 80);
  assert.equal(usageView(usage({promotionalCredits: 0, promotionalResponses: 1000})).promotionalThreshold.level, 100);
  const exhausted = usage(); exhausted.blockedReason = "credits_exhausted";
  assert.match(usageView(exhausted).status, /paused/);
});
test("paid thresholds reset with topups and reconcile with balance adjustments", () => {
  assert.equal(usageView(usage({paidResponses: 900, paidCredits: 100})).paidThreshold.level, 90);
  assert.equal(usageView(usage({paidResponses: 900, paidCredits: 1100})).paidThreshold.level, null);
  assert.equal(usageView(usage({paidResponses: 0, paidCredits: 0})).paidThreshold.percent, 0);
});
test("only a paid server record confirms a purchase", () => {
  for (const status of ["open", "pending", "unknown", undefined]) assert.equal(checkoutView({status}).terminal, false);
  assert.match(checkoutView({status: "paid", responseCredits: 500}).message, /confirmed by Likerts/);
  for (const status of ["failed", "expired", "cancelled"]) { assert.equal(checkoutView({status}).terminal, true); assert.equal(checkoutView({status}).state, status); }
});
test("safe scope defaults and connection examples do not embed credentials", () => {
  assert.ok(SCOPE_PRESETS.read.every((scope) => scope.endsWith(":read")));
  for (const scope of ["responses:write", "identity:write", "billing:write", "webhooks:write", "exports:write"]) assert.ok(!SCOPE_PRESETS.build.includes(scope));
  const examples = connectionExamples("ws_test", "https://api.example.com");
  assert.match(examples.cli, /likerts call usage_get/);
  assert.match(examples.codex, /mcp\/ws_test/);
  assert.equal(JSON.parse(examples.claude).mcpServers.likerts.headers.Authorization, "Bearer ${LIKERTS_TOKEN}");
});
