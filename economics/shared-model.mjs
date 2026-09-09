import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const read = async name => JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const [prices, assumption, benchmark] = await Promise.all([read('./aws-prices.json'),read('./shared-assumptions.json'),read('./local-benchmark.json')]);
assert.equal(prices.region,'ap-southeast-1');
assert.ok(benchmark.storage.validOnlyRelationBytesPerAcceptedResponse > 0,'rerun current benchmark to obtain valid-only storage growth');
assert.equal(benchmark.accounting.acceptedResponses,benchmark.accounting.chargedCents);
const rate = name => {
  assert.ok(prices.rates[name]?.usdPerUnit >= 0, `missing rate ${name}`);
  return prices.rates[name].usdPerUnit;
};
const round = n => Math.round(n * 100) / 100;
const gib = bytes => bytes / 2 ** 30;
const jsonExport = benchmark.exports.find(e => e.format === 'json');
const paced = benchmark.phases.find(p => p.name === 'paced-valid-100-rps');
const measured = {
  sourceImage: benchmark.environment.imageId,
  measuredAt: benchmark.measuredAt,
  responseStorageBytes: benchmark.storage.validOnlyRelationBytesPerAcceptedResponse,
  submissionBytes: benchmark.fixture.submissionJsonBytes,
  receiptBytes: paced.responseBytes / paced.requests,
  jsonExportObjectBytesPerResponse: jsonExport.objectBytes / jsonExport.responses,
  jsonExportWireBytesPerResponse: jsonExport.wireBytes / jsonExport.responses,
};

function scenario(responses, overrides = {}) {
  const a = { ...assumption, ...overrides };
  const hours = a.hoursPerMonth;
  const monthlySeconds = hours * 3600;
  const unpaid = responses * a.unpaidRequestsPerAcceptedResponse;
  const requests = responses * (2 + a.retryRequestsPerAcceptedResponse) + unpaid;
  const peakRps = requests / monthlySeconds * a.peakToAverageTraffic;
  const tasks = Math.max(a.minimumApiTasks,Math.ceil(peakRps / a.planningRequestsPerSecondPerTask));
  const exportResponseEquivalents = responses * a.exportCopiesPerMonthlyResponse;
  const exportJobs = Math.ceil(exportResponseEquivalents / a.exportResponsesPerJob);
  const exportBytes = measured.jsonExportObjectBytesPerResponse * exportResponseEquivalents;
  const egressBytes = responses * (a.schemaResponseBytes + measured.receiptBytes * (1 + a.retryRequestsPerAcceptedResponse))
    + measured.jsonExportWireBytesPerResponse * exportResponseEquivalents + unpaid * a.unpaidResponseBytes;
  const ingressBytes = responses * measured.submissionBytes * (1 + a.retryRequestsPerAcceptedResponse) + unpaid * a.unpaidRequestBytes;
  const networkGb = gib(ingressBytes + egressBytes);
  const peakNewConnections = peakRps * a.newConnectionFraction;
  const lcuBudget = Math.max(a.minimumLcuBudget,
    networkGb / hours * a.peakToAverageTraffic,
    peakNewConnections / 25,
    peakNewConnections * a.connectionLifetimeSeconds / 3000);
  // Conservatively add a separate receipt/accounting allowance to the observed
  // three-month storage footprint. This deliberately overcounts overlapping rows.
  const databaseGb = Math.max(a.minimumDatabaseGb,Math.ceil(gib(responses * (
    measured.responseStorageBytes * a.rawRetentionMonths
    + a.retainedReceiptAndAccountingBytes * a.accountingStoragePlanningMonths
  )) * a.storageSlackFactor));
  const logGb = a.fixedLogGbMonth + gib(requests * a.logBytesPerRequest);
  const aws = {
    fargate: tasks * hours * (a.apiVcpuPerTask * rate('fargateArmVcpuHour') + a.apiMemoryGbPerTask * rate('fargateArmGbHour')),
    // Multi-AZ SKU already includes primary + standby: never multiply by two.
    rdsCompute: hours * rate('rdsT4gMediumMultiAzHour'),
    rdsStorage: databaseGb * rate('rdsGp3MultiAzGbMonth'),
    rdsExcessBackupBudget: databaseGb * a.backupExcessStorageBudgetFraction * rate('rdsExcessBackupGbMonth'),
    rdsCapacityContingency: hours * rate('rdsT4gMediumMultiAzHour') * a.rdsCapacityContingencyFraction,
    loadBalancer: hours * rate('albHour') + hours * lcuBudget * rate('albLcuHour'),
    nat: a.natGateways * hours * rate('natGatewayHour') + a.natControlTrafficGbMonth * rate('natGatewayGb'),
    ipv4: a.publicIpv4Addresses * hours * rate('publicIpv4Hour'),
    secrets: a.secrets * rate('secretMonth') + a.secretApiRequestsMonth * rate('secretApiRequest'),
    logs: logGb * rate('logIngestGb') + logGb * a.logRetentionMonths * rate('logStoredGbMonth'),
    internetEgress: gib(egressBytes) * rate('internetEgressGb'),
    s3: gib(exportBytes) * (a.exportStorageDays / 30) * rate('s3StandardGbMonth')
      + exportJobs * (rate('s3PutRequest') + rate('s3GetRequest')),
    waf: a.wafAclMonthlyUsd + a.wafRuleCount * a.wafRuleMonthlyUsd + requests / 1e6 * a.wafPerMillionRequestsUsd,
    otherOperationsAllowance: a.otherAwsOperationsAllowanceUsdMonth,
  };
  const infrastructure = Object.values(aws).reduce((sum,cost) => sum+cost,0);
  const revenue = responses * a.pricePerAcceptedResponseUsd;
  // Effective payment cost assumes accrued revenue is settled at this average
  // charge size. It does not imply fractional payment transactions occur.
  const processing = revenue * (a.cardPercentage + a.cardFixedFeeUsd / a.averageSettledPaymentUsd);
  const losses = revenue * a.uncollectibleRevenueFraction;
  const activeWorkspaces = Math.ceil(responses / a.averageResponsesPerActiveWorkspaceMonth);
  const support = activeWorkspaces * a.supportMinutesPerActiveWorkspaceMonth / 60 * a.loadedHourlyLaborUsd;
  const maintenance = (a.sdkMaintenanceHoursMonth + a.operationsHoursMonth) * a.loadedHourlyLaborUsd;
  const serviceContribution = revenue - infrastructure - processing - losses - a.identityBudgetUsdMonth;
  const contributionAfterBudgetedLabor = serviceContribution - support - maintenance;
  const totalCost = revenue - contributionAfterBudgetedLabor;
  return {
    responses, activeWorkspaces, requestAttempts: requests, unpaidRequests: unpaid,
    assumedAverageSettledPaymentUsd: a.averageSettledPaymentUsd,
    assumedSupportMinutesPerWorkspace: a.supportMinutesPerActiveWorkspaceMonth,
    apiTasks: tasks, peakPlanningRps: round(peakRps), provisionedDatabaseGb: databaseGb,
    capacityValidatedOnAws: false, revenueUsd: round(revenue),
    awsBreakdownUsd: Object.fromEntries(Object.entries(aws).map(([key,cost]) => [key,round(cost)])),
    awsBudgetUsd: round(infrastructure), processingUsd: round(processing), uncollectibleUsd: round(losses),
    identityBudgetUsd: a.identityBudgetUsdMonth, supportBudgetUsd: round(support), sdkAndOperationsLaborUsd: round(maintenance),
    serviceContributionBeforeLaborUsd: round(serviceContribution), contributionAfterBudgetedLaborUsd: round(contributionAfterBudgetedLabor),
    totalModeledCostUsd: round(totalCost), costPerAcceptedResponseUsd: responses ? totalCost / responses : null,
  };
}
const scenarios = [0,1000,10000,100000,1000000,10000000].map(n => scenario(n));
const paymentSensitivity = [.5,1,5].map(averageSettledPaymentUsd => scenario(100000,{averageSettledPaymentUsd}));
const abuseSensitivity = [0,1,10,100,1000].map(unpaidRequestsPerAcceptedResponse => scenario(100000,{unpaidRequestsPerAcceptedResponse}));
const supportSensitivity = [.2,1.2,6].map(supportMinutesPerActiveWorkspaceMonth => scenario(1000000,{supportMinutesPerActiveWorkspaceMonth}));
const breakEven = field => {
  // Search exact planning scenarios, including stepwise task/storage/workspace counts.
  for (let responses = 1000; responses <= 10000000; responses += 1000) if (scenario(responses)[field] >= 0) return responses;
  return null;
};
const result = {
  generatedAt:new Date().toISOString(),currency:'USD',region:prices.region,
  conclusion:'A shared service can support one-cent pricing under explicit traffic, settlement and support assumptions. Local throughput and public rates are evidence; AWS capacity, actual vendor bills and full business profitability remain unverified.',
  measuredInputs:measured,assumptions:assumption,
  serviceBreakEvenMonthlyResponses:breakEven('serviceContributionBeforeLaborUsd'),
  breakEvenIncludingBudgetedLaborMonthlyResponses:breakEven('contributionAfterBudgetedLaborUsd'),
  scenarios,paymentSensitivity,abuseSensitivity,supportSensitivity,
};
assert.equal(scenarios[0].revenueUsd,0);
assert.ok(scenarios[0].awsBudgetUsd > 0,'idle fleet must cost money');
assert.equal(paymentSensitivity[2].processingUsd,89,'USD 5 payments at US reference fees cost 8.9%');
assert.ok(paymentSensitivity[0].processingUsd > paymentSensitivity[2].processingUsd);
assert.ok(abuseSensitivity.at(-1).awsBudgetUsd > abuseSensitivity[0].awsBudgetUsd);
await writeFile(new URL('./shared-results.json',import.meta.url),`${JSON.stringify(result,null,2)}\n`);
const usd = n => `$${n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const rows = scenarios.map(s => `| ${s.responses.toLocaleString('en-US')} | ${usd(s.revenueUsd)} | ${usd(s.awsBudgetUsd)} | ${usd(s.processingUsd)} | ${usd(s.serviceContributionBeforeLaborUsd)} | ${usd(s.contributionAfterBudgetedLaborUsd)} |`).join('\n');
const latencyRows = benchmark.phases.map(p => `| ${p.name} | ${p.requests} | ${p.requestsPerSecond} | ${p.latencyMs.p95} ms | ${JSON.stringify(p.statuses)} |`).join('\n');
const rateRows = Object.entries(prices.rates).map(([key,value])=>`| ${key} | ${value.usdPerUnit} / ${value.unit} | [${value.sku}](${value.source}) |`).join('\n');
const markdown = `# Shared-service economics and local performance\n\nGenerated ${result.generatedAt}. This is the current embedded/API/MCP/CLI product model; historical dedicated-hosting estimates do not apply. Price remains **US$0.01 per accepted completed response**, with no subscription or minimum spend.\n\nScope limit: this measured/planning snapshot predates the separate response-callback worker. Its idle budget and break-even figures exclude callback worker tasks, callback queue/attempt storage and callback HTTPS/NAT egress. Those hosted quantities must be modeled and validated under OPS-02 before these figures can describe the complete current deployment; they are not assumed free.\n\n## What the evidence says\n\nThe isolated ARM64 service accepted 100 requests/second for 30 seconds with p95 ${paced.latencyMs.p95} ms. That is a local Docker result with a 0.5-vCPU/1-GiB API, not an AWS SLA. The run accepted ${benchmark.accounting.acceptedResponses.toLocaleString('en-US')} responses, recorded exactly the same number of cents, and charged nothing for 2,200 invalid/unauthorized/oversized requests. A 25-response cap accepted exactly 25 of 200 concurrent attempts; 500 identical retries produced one accepted response. No 429s were observed in this snapshot: rejecting bad payloads is not proof of rate limiting.\n\n| Local phase | Requests | Achieved requests/s | HTTP p95 | Status counts |\n| --- | ---: | ---: | ---: | --- |\n${latencyRows}\n\nThe six-question fixture is ${benchmark.fixture.submissionJsonBytes} bytes, including a 512-character pseudorandom comment and 128-character session metadata. PostgreSQL fsync, synchronous_commit and full_page_writes were on. Valid-traffic tenant relation growth was ${measured.responseStorageBytes.toFixed(1)} bytes per accepted response; the complete run generated ${benchmark.storage.walGrowthBytes.toLocaleString('en-US')} WAL bytes. Relation totals include indexes and allocation overhead; they are not a long-term vacuum/retention steady state.\n\nCSV and JSON exports covered ${benchmark.accounting.acceptedResponses} responses each. CSV was ${benchmark.exports.find(e=>e.format==='csv').objectBytes.toLocaleString('en-US')} bytes and ready in ${benchmark.exports.find(e=>e.format==='csv').readyMs} ms; JSON was ${jsonExport.objectBytes.toLocaleString('en-US')} bytes and ready in ${jsonExport.readyMs} ms. The current JSON/base64 response increases download wire size; the model uses that measured wire cost. Exports used local files, not S3. Resource readings in local-benchmark.json are snapshots, not peaks.\n\n## Monthly planning result\n\nBase assumptions: two ARM Fargate tasks (0.5 vCPU/1 GiB each), one db.t4g.medium **Multi-AZ SKU counted once**, 20 GiB minimum Multi-AZ gp3 storage, two NAT gateways, minimum four public IPv4 addresses, ALB, basic WAF budget, logs/secrets and explicit operations/capacity allowances. No free credits or transfer allowances are assumed. The modeled AWS idle budget is **${usd(scenarios[0].awsBudgetUsd)}/month** across the shared fleet, not per customer.\n\n| Accepted responses/month | Usage revenue | AWS budget | Processing | Contribution before labor* | After budgeted labor* |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n*Contribution includes a provisional USD 100 identity budget and 0.5% uncollectible usage allowance. Budgeted labor adds 40 SDK-maintenance hours + 8 operations hours/month at USD 75/hour, plus 1.2 support minutes per active workspace; average workspace volume is 1,000 responses/month. These labor and identity numbers are assumptions, not actual expenses or a Clerk quote. This is not net business profit: tax, acquisition, sales, compliance and general company overhead are excluded.\n\nUnder these assumptions, service contribution turns nonnegative at approximately **${result.serviceBreakEvenMonthlyResponses.toLocaleString('en-US')} responses/month**; including the stated labor budget requires approximately **${result.breakEvenIncludingBudgetedLaborMonthlyResponses.toLocaleString('en-US')}**. Task counts scale on an assumed 25× peak-to-average shape and 50 requests/s per task. The fixed database size and contingency have not been capacity-tested on RDS; high-volume rows are planning sensitivities, not validated margins.\n\n## The expensive edges\n\nThe US domestic-card reference is 2.9% + USD 0.30 per successful payment ([Stripe pricing](https://stripe.com/pricing)). At USD 5 average settlement that consumes **8.9% of revenue**; at USD 1 it consumes **32.9%**; at USD 0.50 it consumes **62.9%**. Month-end hobbyist charges can therefore cost materially more than the optimistic USD 5 base case. Balances below the applicable processor minimum carry forward; usage revenue and cash collection are not the same event. Replace the US reference with the actual merchant country, currency, card mix and any additional billing-product fees before launch.\n\nSupport is equally material. At one million responses/month across 1,000 active workspaces, 1.2 support minutes/workspace costs USD 1,500; six minutes costs USD 7,500. All-five-SDK maintenance is a shared fixed labor obligation even when collection infrastructure is cheap.\n\nUnpaid traffic produces no revenue. At 100,000 accepted responses/month, the model's AWS budget rises from ${usd(abuseSensitivity[0].awsBudgetUsd)} with no unpaid attempts to ${usd(abuseSensitivity.at(-1).awsBudgetUsd)} with 1,000 unpaid attempts per accepted response. This is a conditional capacity/cost budget; real edge rejection, connection patterns and RDS load could change it substantially. Rate limits, caps and cost alerts are launch requirements.\n\nThe model conservatively adds a separate 512-byte receipt/accounting allowance for twelve planning months on top of the measured three-month raw-data footprint and 50% space slack. Twelve months is a sensitivity input, **not** an approved financial-retention policy. Retention, backup churn, bloat and non-response metadata must be measured over longer runs.\n\n## Source-backed AWS inputs\n\nAWS regional Price List API records were retrieved ${prices.retrievedAt}. Each saved rate includes the SKU, exact price dimension, effective/publication dates and source URL in aws-prices.json. Rates below are USD public on-demand first-tier rates for Singapore. Multi-AZ instance/storage rates already include the standby.\n\n| Input | USD rate | Official regional source/SKU |\n| --- | ---: | --- |\n${rateRows}\n\nBasic WAF uses published [ACL/rule/request prices](https://aws.amazon.com/waf/pricing/); its configuration and other quantities are planning assumptions. ALB uses the maximum connection/active-connection/byte dimension with an intentionally conservative peak-hour budget across the month ([capacity pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)). No premium managed rules, CAPTCHA or bot-control products are included.\n\n## Reproduce and finish validation\n\nRun \`bash scripts/benchmark-local.sh\` for a fresh image, isolated database and benchmark. For the unchanged tested image only, \`LIKERTS_SKIP_IMAGE_BUILD=1 bash scripts/benchmark-local.sh\` skips compilation. Run \`node economics/refresh-aws-prices.mjs\` to refresh the exact official SKUs, then \`node economics/shared-model.mjs\` to regenerate this report and shared-results.json. shared-assumptions.json exposes every unmeasured quantity; shared-results.json contains payment, abuse and support sensitivities.\n\nLocal load/accounting/cap/export/storage evidence is complete for this fixture. Remaining OPS-02 evidence needs representative AWS staging: TLS/ALB/WAF path, multi-replica routing, RDS latency/CPU credits/IOPS/Multi-AZ, sustained load and maintenance cycles, S3 lifecycle/downloads, failover, actual CloudWatch metering and AWS cost reconciliation. Merchant and identity quotes and real customer traffic/support data remain commercial validation inputs. No AWS resources were provisioned for this analysis.\n`;
await writeFile(new URL('./SHARED-ECONOMICS.md',import.meta.url),markdown);
console.log(`Shared economics generated: idle AWS ${usd(scenarios[0].awsBudgetUsd)}, service break-even ${result.serviceBreakEvenMonthlyResponses}, with budgeted labor ${result.breakEvenIncludingBudgetedLaborMonthlyResponses} responses/month`);
