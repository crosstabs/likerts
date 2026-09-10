// Presentation derives from server records; navigation parameters never settle a payment.
export const SCOPE_PRESETS = {
  read: ["surveys:read", "responses:read", "usage:read", "exports:read"],
  build: ["surveys:read", "surveys:write", "collections:write", "responses:read", "usage:read", "exports:read"],
};

export function usageView(usage) {
  const credits = usage.credits;
  const threshold = (used, remaining) => {
    const total = used + remaining;
    const percent = total ? Math.floor(100 * used / total) : 0;
    return { percent, level: percent >= 100 ? 100 : percent >= 90 ? 90 : percent >= 80 ? 80 : null };
  };
  const reasons = {
    credits_exhausted: "New responses are paused: no credits remain. Reads, exports and accepted receipts remain available.",
    payment_dispute: "New responses are paused while a payment dispute is resolved.",
    payment_reconciliation: "New responses are paused while the paid balance is reconciled.",
    billing_paused: "New responses are paused by the workspace billing setting.",
    monthly_spend_cap: "New paid responses are paused at the workspace monthly spending cap.",
  };
  return {
    accepted: usage.acceptedResponses,
    promotional: credits.promotionalCredits,
    paid: credits.paidCredits,
    available: credits.availableCredits,
    debt: credits.paidCreditDebt,
    blocked: Boolean(usage.blockedReason),
    status: usage.blockedReason ? reasons[usage.blockedReason] || "New responses are paused. Check workspace billing with usage_get." : "Ready to accept responses within your collection limits.",
    promotionalThreshold: threshold(credits.promotionalResponses, credits.promotionalCredits),
    paidThreshold: threshold(credits.paidResponses, credits.paidCredits),
  };
}

export function checkoutView(checkout) {
  switch (checkout.status) {
    case "paid": return { state: "paid", terminal: true, message: `Payment confirmed by Likerts. ${checkout.responseCredits.toLocaleString()} response credits were purchased. Current available balance is shown above.` };
    case "failed": return { state: "failed", terminal: true, message: "Checkout failed. No purchased credits were confirmed. You can start a new checkout." };
    case "expired": return { state: "expired", terminal: true, message: "Checkout expired. You can start a new checkout." };
    case "cancelled": return { state: "cancelled", terminal: true, message: "Checkout was cancelled. You can start a new checkout." };
    default: return { state: "pending", terminal: false, message: "Waiting for payment confirmation. Credits appear only after the server confirms payment. You can leave and check again later." };
  }
}

export function connectionExamples(workspaceId, apiOrigin) {
  const mcp = `https://likerts-mcp.onrender.com/mcp/${encodeURIComponent(workspaceId)}`;
  return {
    cli: `export LIKERTS_API_URL=${apiOrigin}\n# Supply LIKERTS_TOKEN through your secret manager.\nlikerts call usage_get`,
    api: `export LIKERTS_API_URL=${apiOrigin}\n# Supply LIKERTS_TOKEN through your secret manager.\nprintf 'header = "Authorization: Bearer %s"\\n' "$LIKERTS_TOKEN" | \\\n  curl --fail-with-body --config - "$LIKERTS_API_URL/v1/usage"`,
    codex: `# Supply LIKERTS_TOKEN to the Codex process through your secret manager.\ncodex mcp add likerts \\\n  --url "${mcp}" \\\n  --bearer-token-env-var LIKERTS_TOKEN`,
    claude: JSON.stringify({mcpServers: {likerts: {type: "http", url: mcp, headers: {Authorization: "Bearer ${LIKERTS_TOKEN}"}}}}, null, 2),
  };
}
