import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from 'node:url';

const source = new URL("./launch-platform-assumptions.json", import.meta.url);
export const assumptions = JSON.parse(await readFile(source, "utf8"));

const gb = (bytes) => bytes / 1_000_000_000;
const money = (value) => Math.round(value * 1e6) / 1e6;

const count = (value, name) => { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid ${name}`); return value; };
const finite = (value, name) => { if (!Number.isFinite(value) || value < 0) throw new Error(`invalid ${name}`); return value; };

export function admissionCost({ redisChecks, otherCommands = assumptions.admission.otherCommandsPerMonthPlanningReserve, exactStates, plan = 'free' }) {
  count(redisChecks, 'redisChecks'); count(otherCommands, 'otherCommands');
  if (!['free', 'payg', 'fixed250mb'].includes(plan)) throw new Error('invalid admission plan');
  let minimumCommands = redisChecks * 3 + otherCommands;
  let maximumCommands = redisChecks * 4 + otherCommands;
  if (exactStates) {
    const { firstWindowChecks, continuingAllowedChecks, deniedChecks } = exactStates;
    for (const value of [firstWindowChecks, continuingAllowedChecks, deniedChecks]) count(value, 'exact state');
    if (firstWindowChecks + continuingAllowedChecks + deniedChecks !== redisChecks) throw new Error('state counts do not reconcile');
    minimumCommands = maximumCommands = (firstWindowChecks + deniedChecks) * 3 + continuingAllowedChecks * 4 + otherCommands;
  }
  const a = assumptions.admission;
  const paidCommandCost = commands => money(commands / 100000 * a.paidUsdPer100kCommands);
  return { redisChecks, otherCommands, minimumCommands, maximumCommands,
    freeQuotaStatus: maximumCommands <= a.freeMonthlyCommands ? 'within_estimated_command_quota' : minimumCommands > a.freeMonthlyCommands ? 'exceeds_command_quota' : 'depends_on_actual_command_mix',
    currentFreePlanCostUsd: 0,
    currentUsageUnknown: a.observedProviderConfiguration.currentCommandsUsed === null,
    paygCommandCostRangeUsd: [paidCommandCost(minimumCommands), paidCommandCost(maximumCommands)],
    selectedScenarioPlan: plan,
    selectedPlanCostRangeUsd: plan === 'free' ? [0, 0] : plan === 'fixed250mb' ? [a.fixed250MbUsdMonth, a.fixed250MbUsdMonth] : [paidCommandCost(minimumCommands), paidCommandCost(maximumCommands)],
    assumesNoReadRegions: true };
}

export function cohortUsage(cohorts) {
  if (!Array.isArray(cohorts) || !cohorts.length) throw new Error('cohorts required');
  let acceptedResponses = 0, newWorkspaces = 0, activeWorkspaces = 0, grantResponses = 0, remainingPromotionalCredits = 0;
  for (const cohort of cohorts) {
    const workspaces = count(cohort.workspaces, 'cohort workspaces');
    const responses = count(cohort.responsesPerWorkspace, 'cohort responses');
    if (typeof cohort.isNew !== 'boolean') throw new Error('cohort isNew required');
    const opening = cohort.isNew ? assumptions.freeResponsesPerNewWorkspace : count(cohort.openingPromotionalCreditsPerWorkspace, 'opening promotional credits');
    if (opening > assumptions.freeResponsesPerNewWorkspace) throw new Error('cohort promotional balance exceeds launch grant');
    acceptedResponses += workspaces * responses;
    newWorkspaces += cohort.isNew ? workspaces : 0;
    activeWorkspaces += responses > 0 ? workspaces : 0;
    grantResponses += workspaces * Math.min(responses, opening);
    remainingPromotionalCredits += workspaces * Math.max(0, opening - responses);
  }
  count(acceptedResponses, 'cohort aggregate');
  return { acceptedResponses, newWorkspaces, activeWorkspaces, grantResponses, remainingPromotionalCredits, billableResponses: acceptedResponses - grantResponses };
}

export function prepaidFlow({ billableResponses, openingPaidCredits = 0, purchaseCount = 0, purchaseSizeUsd = assumptions.minimumCreditPurchaseUsd }) {
  count(billableResponses, 'billableResponses'); count(openingPaidCredits, 'openingPaidCredits'); count(purchaseCount, 'purchaseCount');
  finite(purchaseSizeUsd, 'purchaseSizeUsd');
  const creditsPerPurchase = Math.round(purchaseSizeUsd / assumptions.responsePriceUsd);
  if (purchaseSizeUsd < assumptions.minimumCreditPurchaseUsd || Math.abs(creditsPerPurchase * assumptions.responsePriceUsd - purchaseSizeUsd) > 1e-8) throw new Error('invalid purchase denomination');
  const purchasedCredits = creditsPerPurchase * purchaseCount;
  const closingPaidCredits = openingPaidCredits + purchasedCredits - billableResponses;
  if (closingPaidCredits < 0) throw new Error('accepted paid responses exceed prepaid credits');
  const cashCollectedUsd = purchaseCount * purchaseSizeUsd;
  const processingUsd = cashCollectedUsd * assumptions.stripePercent + purchaseCount * assumptions.stripeFixedUsd;
  return { openingPaidCredits, purchasedCredits, closingPaidCredits, purchaseCount, purchaseSizeUsd,
    cashCollectedUsd: money(cashCollectedUsd), usageValueEarnedUsd: money(billableResponses * assumptions.responsePriceUsd),
    closingUnusedPaidCreditFaceValueUsd: money(closingPaidCredits * assumptions.responsePriceUsd),
    processingUsd: money(processingUsd), cashAfterProcessingUsd: money(cashCollectedUsd - processingUsd),
    basis: 'Explicit prepaid purchases and consumption; no expiry, refund or breakage assumption.' };
}

export function evaluate({ acceptedResponses, newWorkspaces, grantResponsesUsed, workspaceCohorts, traffic = {}, activeWorkspaces, labor = {}, payments, admissionPlan = 'free' }) {
  const cohort = workspaceCohorts ? cohortUsage(workspaceCohorts) : null;
  if (cohort) {
    if ((acceptedResponses !== undefined && acceptedResponses !== cohort.acceptedResponses) || (newWorkspaces !== undefined && newWorkspaces !== cohort.newWorkspaces)) throw new Error('cohort totals do not reconcile');
    ({ acceptedResponses, newWorkspaces } = cohort);
  }
  if (!Number.isSafeInteger(acceptedResponses) || acceptedResponses < 0) throw new Error("invalid acceptedResponses");
  if (!Number.isSafeInteger(newWorkspaces) || newWorkspaces < 0) throw new Error("invalid newWorkspaces");
  const grantResponses = cohort?.grantResponses ?? grantResponsesUsed ?? Math.min(acceptedResponses, newWorkspaces * assumptions.freeResponsesPerNewWorkspace);
  count(grantResponses, 'grantResponses');
  if (grantResponses > acceptedResponses) throw new Error('grant use exceeds accepted responses');
  const billableResponses = acceptedResponses - grantResponses;
  const usageRevenueUsd = billableResponses * assumptions.responsePriceUsd;
  const stripeRateAtMinimum = assumptions.stripePercent + assumptions.stripeFixedUsd / assumptions.minimumCreditPurchaseUsd;
  const paymentFlow = payments ? prepaidFlow({ ...payments, billableResponses }) : null;
  const processingUsd = paymentFlow?.processingUsd ?? usageRevenueUsd * stripeRateAtMinimum;

  const r = assumptions.render;
  const renderComputeUsd = r.apiInstances * r.apiInstanceUsdMonth
    + r.remoteMcpGateways * r.remoteMcpGatewayUsdMonth
    + r.callbackWorkers * r.callbackWorkerUsdMonth
    + r.migrationCronMinimumUsdMonth;
  const renderUsd = r.proWorkspaceUsdMonth + renderComputeUsd;
  const n = assumptions.neon;
  const neonUsd = n.computeCuHoursMonth * n.computeUsdCuHour
    + n.databaseStorageGbMonth * n.databaseStorageUsdGbMonth
    + n.historyStorageGbMonth * n.historyStorageUsdGbMonth;
  const exportBytes = acceptedResponses * assumptions.exports.measuredJsonBytesPerResponse * assumptions.exports.copiesPerAcceptedResponse;
  const objects = Math.ceil(acceptedResponses / assumptions.exports.responsesPerJob) * assumptions.exports.copiesPerAcceptedResponse;
  const blobUsageUsd = gb(exportBytes) * assumptions.exports.retentionDays / 30 * assumptions.vercel.blobStorageUsdGbMonth
    + objects * 2 / 1_000_000 * assumptions.vercel.blobAdvancedOpsUsdMillion
    + gb(exportBytes) * assumptions.exports.downloadsPerObject * assumptions.vercel.privateBlobTransferUsdGb;
  const vercelUsd = assumptions.vercel.proBaseUsdMonth
    + Math.max(0, blobUsageUsd - assumptions.vercel.includedUsageCreditUsdMonth);
  const fixedPlatformUsd = renderUsd + neonUsd + vercelUsd + assumptions.clerk.hobbyMonthlyUsd;
  const incrementalOnExistingPaidPlatformsUsd = fixedPlatformUsd
    - r.proWorkspaceUsdMonth
    - assumptions.vercel.proBaseUsdMonth;
  const t = { ...assumptions.traffic, ...traffic };
  for (const name of ['duplicateRetriesPerAccepted', 'invalidRequestsPerAccepted', 'collectionReadsPerAccepted', 'managementRequestsPerNewWorkspace']) finite(t[name], name);
  const matchedApiRequests = traffic.matchedApiRequests ?? acceptedResponses + Math.ceil(acceptedResponses * (t.duplicateRetriesPerAccepted + t.invalidRequestsPerAccepted + t.collectionReadsPerAccepted)) + newWorkspaces * t.managementRequestsPerNewWorkspace;
  count(matchedApiRequests, 'matchedApiRequests'); count(t.locallyRejectedRequests, 'locallyRejectedRequests');
  if (matchedApiRequests < acceptedResponses || t.locallyRejectedRequests > matchedApiRequests - acceptedResponses) throw new Error('invalid admission traffic totals');
  const admission = admissionCost({ redisChecks: matchedApiRequests - t.locallyRejectedRequests, otherCommands: traffic.otherCommands, exactStates: traffic.exactStates, plan: admissionPlan });
  const l = { ...assumptions.labor, ...labor };
  for (const [name, value] of Object.entries(l)) finite(value, name);
  if (l.assumedResponsesPerActiveWorkspace <= 0) throw new Error('active workspace divisor required');
  const active = activeWorkspaces ?? cohort?.activeWorkspaces ?? Math.max(newWorkspaces, Math.ceil(acceptedResponses / l.assumedResponsesPerActiveWorkspace));
  count(active, 'activeWorkspaces');
  const supportUsd = active * l.supportMinutesPerActiveWorkspace / 60 * l.loadedHourlyUsd;
  const sharedLaborUsd = (l.sdkMaintenanceHoursMonth + l.operationsHoursMonth) * l.loadedHourlyUsd;
  return {
    acceptedResponses, newWorkspaces, grantResponses, billableResponses,
    grantFaceValueUsd: money(grantResponses * assumptions.responsePriceUsd),
    usageRevenueUsd: money(usageRevenueUsd),
    processingUsd: money(processingUsd),
    blobUsageUsd: money(blobUsageUsd),
    renderComputeUsd: money(renderComputeUsd), renderUsd: money(renderUsd), neonUsd: money(neonUsd), vercelUsd: money(vercelUsd), clerkUsd: assumptions.clerk.hobbyMonthlyUsd,
    fixedPlatformUsd: money(fixedPlatformUsd),
    incrementalOnExistingPaidPlatformsUsd: money(incrementalOnExistingPaidPlatformsUsd),
    contributionBeforeLaborUsd: money(usageRevenueUsd - processingUsd - fixedPlatformUsd),
    legacyContributionLimitation: 'Retained baseline arithmetic, excludes admission/support/shared labor and other unmodeled costs; not a margin claim.',
    grantBasis: cohort ? 'per-workspace cohort balances' : grantResponsesUsed !== undefined ? 'explicit measured/scenario consumption' : 'legacy aggregate grant upper bound; assumes new-workspace grant use can cover aggregate traffic',
    remainingPromotionalCredits: cohort?.remainingPromotionalCredits ?? null,
    processingBasis: paymentFlow ? 'explicit cash purchases' : 'steady-state fee equivalent at minimum top-up; not current-month cash fees',
    paymentFlow, matchedApiRequests, admission, activeWorkspaces: active,
    supportUsd: money(supportUsd), sharedLaborUsd: money(sharedLaborUsd),
    serviceCostRangeUsd: admission.selectedPlanCostRangeUsd.map(cost => money(fixedPlatformUsd + processingUsd + cost)),
    serviceCostWithBudgetedLaborRangeUsd: admission.selectedPlanCostRangeUsd.map(cost => money(fixedPlatformUsd + processingUsd + cost + supportUsd + sharedLaborUsd)),
  };
}

export const scenarios = [
  { acceptedResponses: 1_000, newWorkspaces: 1 },
  { acceptedResponses: 10_000, newWorkspaces: 10 },
  { acceptedResponses: 100_000, newWorkspaces: 25 },
  { acceptedResponses: 1_000_000, newWorkspaces: 100 },
].map(evaluate);

export const paidScenarios = scenarios.map(({ acceptedResponses, newWorkspaces }) => evaluate({ acceptedResponses, newWorkspaces, admissionPlan: 'payg' }));
export const costRanges = scenarios.map(({ acceptedResponses, newWorkspaces }) => {
  const low = evaluate({ acceptedResponses, newWorkspaces, admissionPlan: 'payg', traffic: { duplicateRetriesPerAccepted: .02, invalidRequestsPerAccepted: 0, collectionReadsPerAccepted: .1, managementRequestsPerNewWorkspace: 10 }, labor: { supportMinutesPerActiveWorkspace: .2 } });
  const high = evaluate({ acceptedResponses, newWorkspaces, admissionPlan: 'payg', traffic: { duplicateRetriesPerAccepted: .5, invalidRequestsPerAccepted: 10, collectionReadsPerAccepted: 1, managementRequestsPerNewWorkspace: 50 }, labor: { supportMinutesPerActiveWorkspace: 6 } });
  return { acceptedResponses, newWorkspaces, serviceCostRangeUsd: [low.serviceCostRangeUsd[0], high.serviceCostRangeUsd[1]], withBudgetedLaborRangeUsd: [low.serviceCostWithBudgetedLaborRangeUsd[0], high.serviceCostWithBudgetedLaborRangeUsd[1]], assumedActiveWorkspaces: low.activeWorkspaces };
});
export const grantDistribution = [
  { name: 'Ten new workspaces each use 1,000 responses', cohorts: [{ workspaces: 10, responsesPerWorkspace: 1000, isNew: true }] },
  { name: 'One new workspace uses 10,000; nine use none', cohorts: [{ workspaces: 1, responsesPerWorkspace: 10000, isNew: true }, { workspaces: 9, responsesPerWorkspace: 0, isNew: true }] },
  { name: 'Returning ten workspaces consume 400 remaining free credits each', cohorts: [{ workspaces: 10, responsesPerWorkspace: 1000, isNew: false, openingPromotionalCreditsPerWorkspace: 400 }] },
].map(item => ({ name: item.name, ...cohortUsage(item.cohorts) }));
export const cashTiming = [
  { name: 'Buy now, consume some', billableResponses: 100, openingPaidCredits: 0, purchaseCount: 10 },
  { name: 'Use credits purchased earlier', billableResponses: 5000, openingPaidCredits: 5000, purchaseCount: 0 },
].map(({ name, ...input }) => ({ name, ...prepaidFlow(input) }));
export const abuseSensitivity = [0, 1, 10, 100].map(invalidRequestsPerAccepted => ({ invalidRequestsPerAccepted, ...evaluate({ acceptedResponses: 100000, newWorkspaces: 25, admissionPlan: 'payg', traffic: { invalidRequestsPerAccepted } }) }));
export const supportSensitivity = [.2, 1.2, 6].map(supportMinutesPerActiveWorkspace => ({ supportMinutesPerActiveWorkspace, ...evaluate({ acceptedResponses: 100000, newWorkspaces: 25, admissionPlan: 'payg', labor: { supportMinutesPerActiveWorkspace } }) }));

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const a = assumptions.admission;
  const saturationChecks = assumptions.render.apiInstances * a.localRequestsPerSecondPerApiInstance * a.planningMonthDays * 86400;
  const commandCeiling = { freeNominalRedisChecksRange: [Math.floor(a.freeMonthlyCommands / 4), Math.floor(a.freeMonthlyCommands / 3)], conservativePreviewChecksAfterReserve: Math.floor((a.freeMonthlyCommands * a.previewCommandBudgetFraction - a.otherCommandsPerMonthPlanningReserve) / 4), saturationChecksAtCurrentCodeDefaults: saturationChecks, saturationPaygCommandCostUpperUsd: money(saturationChecks * 4 / 100000 * a.paidUsdPer100kCommands) };
  const limitations = ['Current Upstash Free plan has no modeled cash charge but is quota bounded and fail closed. Current used command count is unknown.', 'Cost ranges are workload/labor scenarios, not measured vendor bills, capacity, margin or a promise that fixed infrastructure can serve these volumes.', 'Prepaid credits are consumed per workspace; aggregate grant subtraction is retained only as a labeled historical comparison.', 'No automatic credit expiry, breakage revenue, refund rate or paid upgrade is assumed.', 'Render/Neon/Vercel/Clerk/Stripe assumptions retained from the prior model; actual invoices, entitlements and merchant geography need reconciliation.'];
  const output = { generatedFor: assumptions.modelDate, assumptions, scenarios, paidScenarios, costRanges, grantDistribution, cashTiming, abuseSensitivity, supportSensitivity, commandCeiling, limitations };
  await writeFile(new URL('./launch-platform-results.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
  const usd = value => '$' + value.toFixed(2);
  const range = values => values.map(usd).join('–');
  const number = value => value.toLocaleString('en-US');
  const legacyRows = scenarios.map(s => `| ${number(s.acceptedResponses)} | ${s.newWorkspaces} | ${number(s.grantResponses)} | ${usd(s.usageRevenueUsd)} | ${usd(s.processingUsd)} | ${usd(s.fixedPlatformUsd)} | ${s.admission.freeQuotaStatus.replaceAll('_', ' ')} |`).join('\n');
  const rangeRows = costRanges.map(s => `| ${number(s.acceptedResponses)} | ${s.assumedActiveWorkspaces} | ${range(s.serviceCostRangeUsd)} | ${range(s.withBudgetedLaborRangeUsd)} |`).join('\n');
  const grantRows = grantDistribution.map(s => `| ${s.name} | ${number(s.grantResponses)} | ${number(s.billableResponses)} | ${number(s.remainingPromotionalCredits)} |`).join('\n');
  const cashRows = cashTiming.map(s => `| ${s.name} | ${usd(s.cashCollectedUsd)} | ${usd(s.usageValueEarnedUsd)} | ${usd(s.processingUsd)} | ${usd(s.closingUnusedPaidCreditFaceValueUsd)} |`).join('\n');
  const abuseRows = abuseSensitivity.map(s => `| ${s.invalidRequestsPerAccepted} | ${number(s.admission.redisChecks)} | ${number(s.admission.minimumCommands)}–${number(s.admission.maximumCommands)} | ${range(s.admission.paygCommandCostRangeUsd)} |`).join('\n');
  const supportRows = supportSensitivity.map(s => `| ${s.supportMinutesPerActiveWorkspace} | ${s.activeWorkspaces} | ${usd(s.supportUsd)} | ${usd(s.sharedLaborUsd)} |`).join('\n');
  const markdown = `# Launch economics: costs, free allowance and prepaid usage

Model date ${assumptions.modelDate}. The existing fully allocated platform assumption remains **${usd(scenarios[0].fixedPlatformUsd)}/month**, or **${usd(scenarios[0].incrementalOnExistingPaidPlatformsUsd)}/month** if the existing Render Pro and Vercel Pro subscriptions are treated as sunk costs. This is a planning floor, not a current invoice or volume guarantee. One-cent pricing must cover free usage, request traffic and support as well as accepted paid responses.

## Current provider state and admission ceiling

The parent operator verified the Vercel store \`likerts-production-admission\` on September 10: **Free**, primary \`iad1\`, no read regions, auto-upgrade disabled, eviction disabled. No paid upgrade was made. Its current command usage was not retrieved. The published Free allowance is 500,000 commands/month, 256 MB and 10 GB bandwidth; the paid comparison is $0.20/100,000 commands and Fixed 250 MB is $10/month without per-command billing. Paid command pricing starts from the first command; do not subtract a Free allowance from PAYG. [Upstash pricing](${assumptions.sources.upstash})

A single HTTP EVAL is not a single billed command. Upstash's own cost tables count EVAL plus executed nested commands. Our \`backend/src/admission.rs\` script costs **3 commands** for a new window or a Redis denial, and **4 commands** for a continuing allowed check. Local rejection costs zero Redis commands; health and unmatched routes bypass this layer. [Upstash command accounting](${assumptions.sources.upstashCommandBilling})

With a completely unused quota and no other commands, that permits **${number(commandCeiling.freeNominalRedisChecksRange[0])}–${number(commandCeiling.freeNominalRedisChecksRange[1])} Redis-reaching checks**, not accepted responses. At 80% quota with a 10,000-command planning reserve, the conservative budget is **${number(commandCeiling.conservativePreviewChecksAfterReserve)} checks**. SDK reads, duplicate retries, invalid requests, console/API/MCP traffic and shared-store fixture/administrative operations use that budget too. Actual remaining headroom must subtract metered commands. Exhaustion/network failure causes production admission 503; a zero-dollar plan does not mean unlimited service. The confirmed US-region dependency adds a round trip from Singapore and needs latency acceptance.

## Existing comparisons, now qualified

These rows retain the previous aggregate-grant arithmetic and fixed-provider assumptions for comparison. The payment column is a steady-state fee equivalent at $5 top-ups, not a cash forecast. The Free quota status uses the request assumptions below and is not permission to serve volumes above its allowance.

| Accepted/month | New workspaces | Assumed grants consumed | Paid usage value | Equivalent processing | Baseline platform | Current Free command feasibility |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
${legacyRows}

The baseline uses Render $90 (API $50, MCP $7, callback worker $7, cron $1, Pro $25), representative Neon $15.39, Vercel Pro $20 and Clerk Hobby $0. These prior inputs are dated ${assumptions.retainedPriceInputsDate}; this update rechecked admission pricing and does not independently reconcile every existing subscription/invoice. The incremental figure removes only already-paid Render/Vercel base subscriptions, not their usage. Optional passkeys/enterprise entitlements remain separate.

## Conditional cost range, without a margin claim

The following paid-admission scenarios show a range rather than asserting profitability. Low traffic assumes 0.02 duplicate retries, 0 invalid requests and 0.1 collection reads per accepted response plus 10 management calls/new workspace. High traffic assumes 0.5 duplicates, 10 invalids and 1 read plus 50 management calls/new workspace. Both assume zero local rejections, so every modeled attempt reaches Redis. A 10,000-command reserve is added. The support range is 0.2–6 minutes/active workspace at $75/hour, with 48 shared SDK/operations hours ($3,600/month). Workspace counts are assumed from 1,000 responses/active workspace, not observed customers.

| Accepted/month | Assumed active workspaces | Platform + fee equivalent + PAYG admission | Including stated support and shared labor |
| ---: | ---: | ---: | ---: |
${rangeRows}

This range is **not** a confidence interval or total operating-cost bound. Render CPU/egress, Neon storage/compute growth, webhook attempts, host/function traffic and other vendor overages do not scale automatically in this small model. Large-volume rows require capacity and billing measurement. Included Vercel usage credit is assumed otherwise available; other projects may consume it.

## Grants belong to individual workspaces

Grant face value is forgone potential usage revenue, not cash expense. A new workspace receives 1,000 nonrenewing credits, and unused credits can carry into later months; no expiration/breakage is assumed. Simply subtracting \`newWorkspaces × 1,000\` from total responses can understate paid use and ignores returning-workspace free balances. Use \`workspaceCohorts\` or an explicit measured \`grantResponsesUsed\` input.

| Distribution (10,000 accepted in each case) | Free consumed | Paid consumed | Free balance remaining |
| --- | ---: | ---: | ---: |
${grantRows}

## Cash arrives before consumption

\`prepaidFlow\` separately records purchases, fees, consumption and remaining paid credits. It rejects modeled paid acceptance beyond available credits. A $5 purchase adds 500 credits and incurs $0.445 under the retained US 2.9% + $0.30 reference (8.9%). There is no implicit minimum monthly spend or automatic charge. Actual merchant country, fees, refunds/disputes and tax must replace that reference; this is a commercial unit model, not an accounting-policy conclusion.

| Example | Cash collected now | Paid usage value now | Processing now | Closing unused paid-credit value |
| --- | ---: | ---: | ---: | ---: |
${cashRows}

Unspent prepayments are future service obligations, not current response usage. Using old credits earns usage value without new cash or new payment fees in that month. The default fee-equivalent rows cannot be used to forecast runway.

## Abuse and support sensitivity

At 100,000 accepted responses/month and 25 new workspaces, with the baseline duplicate/read/setup assumptions:

| Invalid attempts per accepted | Checks reaching Redis | Billed command range | PAYG command cost |
| ---: | ---: | ---: | ---: |
${abuseRows}

The implemented local per-process limits bound normal Redis dispatch (current defaults total 50 checks/s per API process). With 2 stable processes and 30 days, a sustained attack could still approach **${number(commandCeiling.saturationChecksAtCurrentCodeDefaults)} checks**, or **${usd(commandCeiling.saturationPaygCommandCostUpperUsd)} in command charges** at the conservative 4-command mix, before other costs. This is a static no-restart/config-change ceiling, not a guaranteed bill cap or throughput result. Free quota could be exhausted much earlier. A provider budget/approved fixed plan and monitoring are separate decisions; no upgrade is implied by this model.

| Support minutes/active workspace | Assumed active workspaces | Support budget/month | Shared SDK/operations labor/month |
| ---: | ---: | ---: | ---: |
${supportRows}

Rate limits bound work and spending at the cost of availability. They do not remove Render ingress/connection costs or support/abuse handling. A real request/command histogram, workspace activation distribution and support time log are needed to narrow these sensitivities.

## Evidence and exclusions

Hosted private Blob create/download and deletion-triggered export revocation are already recorded in [hosted evidence](../infrastructure/render/hosted-evidence.json); a provider sandbox is no longer an uncompleted prerequisite. These tests establish functional paths, not monthly cost, expiry cleanup or failover. The model retains ${assumptions.exports.measuredJsonBytesPerResponse.toFixed(2)} JSON bytes/response, 3 export copies, one-day retention and one download as explicit workload assumptions. Allocation/egress differences and actual invoices remain unmeasured.

Excluded from the displayed totals: tax, sales/acquisition, general overhead, compliance/legal work, refund/dispute losses and fees, incident labor outside the stated budget, abuse bandwidth/compute scaling, callback queue growth/egress, provider metering changes, paid Clerk features, extra Redis regions/Prod Pack, and backup/recovery costs beyond the retained Neon allowance. There is no profitability or SLA claim.

Reproduce with \`node economics/launch-platform-model.mjs\` and \`node --test economics/launch-platform-model.test.mjs\`. Inputs and per-scenario outputs are saved in adjacent JSON. Attach the sustained hosted runner's actual requests/statuses/latencies and provider command deltas when available; do not infer full-month scale from the bounded run.

Retained provider references: [Render](${assumptions.sources.render}), [Neon](${assumptions.sources.neon}), [Vercel](${assumptions.sources.vercel}), [Blob](${assumptions.sources.vercelBlob}), [regional rates](${assumptions.sources.vercelRegional}), [Clerk](${assumptions.sources.clerk}), [Stripe](${assumptions.sources.stripe}).
`;
  await writeFile(new URL('./LAUNCH-PLATFORM-ECONOMICS.md', import.meta.url), markdown);
}
