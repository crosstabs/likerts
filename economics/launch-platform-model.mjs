import { readFile, writeFile } from "node:fs/promises";

const source = new URL("./launch-platform-assumptions.json", import.meta.url);
export const assumptions = JSON.parse(await readFile(source, "utf8"));

const gb = (bytes) => bytes / 1_000_000_000;
const money = (value) => Math.round(value * 1e6) / 1e6;

export function evaluate({ acceptedResponses, newWorkspaces }) {
  if (!Number.isSafeInteger(acceptedResponses) || acceptedResponses < 0) throw new Error("invalid acceptedResponses");
  if (!Number.isSafeInteger(newWorkspaces) || newWorkspaces < 0) throw new Error("invalid newWorkspaces");
  const grantResponses = Math.min(acceptedResponses, newWorkspaces * assumptions.freeResponsesPerNewWorkspace);
  const billableResponses = acceptedResponses - grantResponses;
  const usageRevenueUsd = billableResponses * assumptions.responsePriceUsd;
  const stripeRateAtMinimum = assumptions.stripePercent + assumptions.stripeFixedUsd / assumptions.minimumCreditPurchaseUsd;
  const processingUsd = usageRevenueUsd * stripeRateAtMinimum;

  const r = assumptions.render;
  const renderUsd = r.apiInstances * r.apiInstanceUsdMonth
    + r.remoteMcpGateways * r.remoteMcpGatewayUsdMonth
    + r.callbackWorkers * r.callbackWorkerUsdMonth;
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
  return {
    acceptedResponses, newWorkspaces, grantResponses, billableResponses,
    grantFaceValueUsd: money(grantResponses * assumptions.responsePriceUsd),
    usageRevenueUsd: money(usageRevenueUsd),
    processingUsd: money(processingUsd),
    blobUsageUsd: money(blobUsageUsd),
    renderUsd: money(renderUsd), neonUsd: money(neonUsd), vercelUsd: money(vercelUsd), clerkUsd: assumptions.clerk.hobbyMonthlyUsd,
    fixedPlatformUsd: money(fixedPlatformUsd),
    contributionBeforeLaborUsd: money(usageRevenueUsd - processingUsd - fixedPlatformUsd),
  };
}

export const scenarios = [
  { acceptedResponses: 1_000, newWorkspaces: 1 },
  { acceptedResponses: 10_000, newWorkspaces: 10 },
  { acceptedResponses: 100_000, newWorkspaces: 25 },
  { acceptedResponses: 1_000_000, newWorkspaces: 100 },
].map(evaluate);

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const output = { generatedFor: assumptions.modelDate, assumptions, scenarios };
  await writeFile(new URL("./launch-platform-results.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
  const rows = scenarios.map((s) => `| ${s.acceptedResponses.toLocaleString("en-US")} | ${s.newWorkspaces} | ${s.grantResponses.toLocaleString("en-US")} | $${s.usageRevenueUsd.toFixed(2)} | $${s.blobUsageUsd.toFixed(2)} | $${s.contributionBeforeLaborUsd.toFixed(2)} |`).join("\n");
  const markdown = `# Render + Vercel + Neon + Clerk launch economics\n\nModel date ${assumptions.modelDate}. This is a reproducible planning model, not a provider bill or capacity result. It uses conservative published regional Blob maxima where Singapore varies, a representative Neon Launch workload, Clerk Hobby for passwordless email OTP, Render list prices, and the US domestic-card Stripe reference. Taxes, Render workspace fees and bandwidth, support, labor, compliance, abuse, Clerk add-ons and vendor overages are excluded.\n\nThe modeled platform floor is **$${scenarios[0].fixedPlatformUsd.toFixed(2)}/month**: two Render API instances ($50), one remote MCP gateway ($7), one callback worker ($7), representative Neon Launch usage ($${scenarios[0].neonUsd.toFixed(2)}), Vercel Pro ($20 including its usage credit), and Clerk Hobby ($0). Neon is usage-based, so its amount is a workload assumption rather than a fixed fee. The MCP gateway is isolated from database and provider secrets. The inert migration cron has no standing compute allocation; actual executions and Render workspace charges must be measured.\n\n| Accepted | New workspaces | Free responses used | Usage revenue | Blob planning cost | Contribution before labor |\n| ---: | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\nA verified workspace receives one nonrenewing 1,000-response grant. The model treats its **$10 face value** as forgone revenue, not a $10 cash expense. It bills only accepted responses above the aggregate grants. A $5 purchase adds 500 credits; the 2.9% + $0.30 reference consumes **8.9%** of a $5 payment. Actual processor geography and payment mix must replace this reference before launch.\n\nAnonymous respondents do not consume Clerk operator MRUs. Clerk Hobby supplies passwordless email OTP and the model assigns it $0/month. Passkeys require the optional **+$${assumptions.clerk.optionalPasskeysProUpgradeUsd}/month** Pro upgrade and are excluded from the launch floor. Enterprise connections and production entitlement details require a quote/check before enabling them.\n\nBlob cost uses the measured JSON export size (${assumptions.exports.measuredJsonBytesPerResponse.toFixed(2)} bytes/response), three copies, one-day retention, one authenticated download, and conservative published regional rates. Vercel's $20 usage credit absorbs the modeled Blob amount in these rows. Private Blob remains a provider dependency and its Rust control protocol is pinned and locally contract-tested; a provider sandbox is still required.\n\nSources: [Render pricing](${assumptions.sources.render}), [Neon pricing](${assumptions.sources.neon}), [Vercel pricing](${assumptions.sources.vercel}), [Blob pricing](${assumptions.sources.vercelBlob}), [regional pricing](${assumptions.sources.vercelRegional}), [Clerk pricing](${assumptions.sources.clerk}), [Stripe pricing](${assumptions.sources.stripe}).\n`;
  await writeFile(new URL("./LAUNCH-PLATFORM-ECONOMICS.md", import.meta.url), markdown);
}
