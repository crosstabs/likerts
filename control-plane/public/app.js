import { SCOPE_PRESETS, usageView, checkoutView, connectionExamples } from "/workspace-state.js";

const publishableKey = "__CLERK_PUBLISHABLE_KEY__";
const apiOrigin = "__LIKERTS_PUBLIC_API_ORIGIN__";
const $ = (id) => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
let activeClerk;
let activeWorkspace;
let sessionVersion = 0;
let sessionId;
let paymentMode = "disabled";
let paymentPoll = 0;
let activePurchase;
let issuedCredentialId;
let connectionCode = "";
const memoryStorage = new Map();
const storage = {
  get(key) { try { return sessionStorage.getItem(key) ?? memoryStorage.get(key); } catch { return memoryStorage.get(key); } },
  set(key, value) { memoryStorage.set(key, value); try { sessionStorage.setItem(key, value); } catch { /* Same-page retries remain safe. */ } },
  remove(key) { memoryStorage.delete(key); try { sessionStorage.removeItem(key); } catch { /* In-memory fallback. */ } },
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function browserRequest(path, options = {}) {
  if (!activeClerk?.session) throw new Error("Sign in required");
  const version = sessionVersion;
  const workspace = activeWorkspace;
  const token = await activeClerk.session.getToken();
  if (version !== sessionVersion) throw new Error("Session changed. Try again.");
  if (!token) throw new Error("Sign in required");
  const response = await fetch(`${apiOrigin}${path}`, {
    ...options, credentials: "omit", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(workspace ? {"X-Likerts-Workspace": workspace} : {}), ...(options.headers || {}) },
  });
  if (!response.ok) {
    if (version === sessionVersion && (response.status === 401 || response.status === 403)) {
      clearSecret();
      $("workspace-content").hidden = true;
      $("signed-out-panel").hidden = false;
      $("retry-workspace").hidden = false;
    }
    const error = new Error(response.status === 401 ? "Your session expired. Sign in again." : response.status === 403 ? "Your account no longer has permission for this workspace." : "The request could not be completed. Please retry.");
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function renderUsage(usage) {
  const view = usageView(usage);
  for (const [id, value] of [["response-status",view.accepted],["promo-status",view.promotional],["paid-status",view.paid]]) text(id, value.toLocaleString());
  text("collection-status", view.status);
  $("collection-status").dataset.blocked = String(view.blocked);
  const label = (name, threshold) => `${name}: ${threshold.percent}% used${threshold.level ? ` — ${threshold.level}% notice reached` : " — below the 80% notice"}.`;
  text("promo-threshold", label("One-time free grant", view.promotionalThreshold));
  text("paid-threshold", label("Paid credits", view.paidThreshold));
  $("credit-debt").hidden = view.debt === 0;
  text("credit-debt", `${view.debt} paid credits require reconciliation.`);
  $("credit-details")?.toggleAttribute("open", Boolean(view.promotionalThreshold.level || view.paidThreshold.level || view.blocked));
}

function renderPaymentMode(mode) {
  paymentMode = ["test", "live"].includes(mode) ? mode : "disabled";
  text("billing-mode", paymentMode === "test" ? "Sandbox checkout — test payments only. No real money is charged. Do not enter real card details." : paymentMode === "live" ? "Live checkout — your payment method will be charged for the selected credit pack." : "Credit purchases are currently unavailable. Your existing response credits remain usable.");
  const button = $("credit-checkout").querySelector('button[type="submit"]');
  button.disabled = paymentMode === "disabled";
  button.textContent = paymentMode === "test" ? "Continue to test checkout" : "Continue to checkout";
}

async function loadWorkspace({initial = false} = {}) {
  const version = sessionVersion;
  text("refresh-status", "Refreshing workspace…");
  const result = await browserRequest("/v1/browser/bootstrap", {method: "POST", body: "{}"});
  if (version !== sessionVersion) return;
  activeWorkspace = result.workspaceId;
  text("workspace-status", activeWorkspace);
  renderUsage(result.usage);
  renderPaymentMode(result.paymentMode);
  $("signed-out-panel").hidden = true;
  $("workspace-content").hidden = false;
  $("retry-workspace").hidden = true;
  text("session-status", "Signed in. Your workspace is ready.");
  text("refresh-status", "Updated just now. Refresh to see new responses and credit changes.");
  renderConnection();
  if (initial) {
    await loadAgentCredentials();
    if (version !== sessionVersion) return;
    const navigation = new URLSearchParams(window.location.search);
    const requestedId = navigation.get("purchase_id");
    let stored;
    try { stored = JSON.parse(storage.get(`likerts-purchase-${activeWorkspace}`) || "null"); } catch { stored = null; }
    activePurchase = requestedId && /^[a-f0-9-]{36}$/i.test(requestedId) ? {id: requestedId, ...(stored?.id === requestedId ? stored : {})} : stored;
    if (activePurchase?.id) await checkPayment({cancelled: navigation.get("checkout") === "cancelled"});
    else if (navigation.has("checkout")) text("checkout-status", "No purchase was identified. Payment has not been confirmed. Your current balance is shown above.");
  }
}

function clearSecret() {
  $("agent-token").value = "";
  $("agent-secret").hidden = true;
  issuedCredentialId = undefined;
}

async function loadAgentCredentials() {
  const version = sessionVersion;
  const credentials = await browserRequest("/v1/browser/service-credentials");
  if (version !== sessionVersion) return;
  const root = $("agent-credentials");
  root.replaceChildren();
  const visible = credentials.filter((item) => !item.revoked);
  text("credential-list-status", visible.length ? "" : "No active credentials. Create one to connect your first tool.");
  for (const credential of visible) {
    const row = document.createElement("div"); row.className = "credential-row";
    const info = document.createElement("div"); info.className = "credential-info";
    const name = document.createElement("strong"); name.textContent = credential.name;
    const expiry = document.createElement("small"); expiry.textContent = `${new Date(credential.expiresAt) <= new Date() ? "Expired" : "Expires"} ${new Date(credential.expiresAt).toLocaleString()}`;
    const scopes = document.createElement("small"); scopes.textContent = `Scopes: ${credential.scopes.join(", ")}`;
    info.append(name, expiry, scopes);
    const revoke = document.createElement("button"); revoke.type = "button"; revoke.textContent = "Revoke";
    revoke.setAttribute("aria-label", `Revoke ${credential.name}`);
    revoke.addEventListener("click", async () => {
      revoke.disabled = true;
      text("credential-list-status", "Revoking credential…");
      try {
        await browserRequest(`/v1/browser/service-credentials/${encodeURIComponent(credential.id)}`, {method: "DELETE"});
        if (version !== sessionVersion) return;
        if (issuedCredentialId === credential.id) clearSecret();
        await loadAgentCredentials();
        text("credential-list-status", "Credential revoked. It can no longer authorize new requests.");
      } catch (error) { if (version === sessionVersion) { text("credential-list-status", `Revocation was not confirmed. ${error.message}`); revoke.disabled = false; } }
    });
    row.append(info, revoke); root.append(row);
  }
}

function renderConnection() {
  if (!activeWorkspace) return;
  const choice = $("connection-client").value;
  connectionCode = connectionExamples(activeWorkspace, apiOrigin)[choice];
  text("connection-code", connectionCode);
  text("connection-help", choice === "claude" ? "Merge this entry into your project's .mcp.json, preserving existing servers. Start Claude Code with LIKERTS_TOKEN supplied by your secret manager." : choice === "cli" ? "Install the checksummed Rust CLI from Downloads first. The usage call needs usage:read." : choice === "codex" ? "Restart or refresh Codex after registration, then ask it to call usage_get. The credential needs usage:read." : "Run in your own terminal. The token is read from the environment, not included in the command's arguments.");
  text("connection-status", "");
}

async function copyValue(value, output, fallback) {
  try { await navigator.clipboard.writeText(value); text(output, "Copied."); }
  catch { if (fallback) { fallback.focus(); fallback.select(); } text(output, fallback ? "Clipboard access is unavailable. The text is selected; copy it manually." : "Clipboard access is unavailable. Select the visible text and copy it manually."); }
}

$("scope-preset").addEventListener("change", (event) => {
  const preset = SCOPE_PRESETS[event.target.value];
  if (preset) for (const input of $("agent-credential").querySelectorAll('input[name="scope"]')) input.checked = preset.includes(input.value);
  text("scope-description", event.target.value === "build" ? "Allows survey edits/publication and collection creation, closure and revocation. Response erasure, access, billing and callback writes remain off unless you choose them." : event.target.value === "read" ? "Read surveys, responses, usage and existing exports. No write permissions." : "Review each selected capability. Write scopes may change or delete resources.");
});
$("agent-credential").querySelectorAll('input[name="scope"]').forEach((input) => input.addEventListener("change", () => { $("scope-preset").value = "custom"; text("scope-description", "Custom permissions. Review each selected capability before creating the credential."); }));
$("agent-credential").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const scopes = [...event.currentTarget.querySelectorAll('input[name="scope"]:checked')].map((input) => input.value);
  if (!scopes.length) { text("agent-status", "Choose at least one capability."); return; }
  if (issuedCredentialId) { text("agent-status", "Save the current token and select ‘I have saved it’ before creating another."); return; }
  const version = sessionVersion;
  button.disabled = true; text("agent-status", "Creating credential…");
  try {
    const result = await browserRequest("/v1/browser/service-credentials", {method: "POST", body: JSON.stringify({name: $("agent-name").value, scopes, expiresAt: new Date(Date.now() + 90 * 86400_000).toISOString()})});
    if (version !== sessionVersion) return;
    issuedCredentialId = result.credential.id;
    $("agent-token").value = result.token; $("agent-secret").hidden = false;
    text("agent-status", "Credential created. Copy the token now; it cannot be retrieved later.");
    try { await loadAgentCredentials(); } catch { text("credential-list-status", "Credential created, but the list could not refresh. Save the token, then refresh the workspace."); }
  } catch (error) { if (version === sessionVersion) text("agent-status", `Creation was not confirmed. ${error.message} Check the credential list before retrying; a lost response can leave an issued token you must revoke.`); }
  finally { button.disabled = false; }
});
$("copy-agent-token").addEventListener("click", () => copyValue($("agent-token").value, "agent-status", $("agent-token")));
$("hide-agent-token").addEventListener("click", () => { clearSecret(); text("agent-status", "Token hidden. Continue with your tool setup below."); });
$("copy-workspace").addEventListener("click", () => copyValue(activeWorkspace, "refresh-status"));
$("copy-connection").addEventListener("click", () => copyValue(connectionCode, "connection-status"));
$("connection-client").addEventListener("change", renderConnection);

function clearPurchase() {
  if (activePurchase?.storageKey) storage.remove(activePurchase.storageKey);
  storage.remove(`likerts-purchase-${activeWorkspace}`);
  activePurchase = undefined;
  paymentPoll++;
  $("check-payment").hidden = true; $("resume-payment").hidden = true; $("new-payment").hidden = true;
  const clean = new URL(window.location.href); clean.searchParams.delete("checkout"); clean.searchParams.delete("purchase_id");
  window.history.replaceState({}, "", clean);
}
function validCheckoutUrl(value) {
  try { const parsed = new URL(value); return parsed.protocol === "https:" && parsed.hostname === "checkout.stripe.com" && !parsed.username && !parsed.password; } catch { return false; }
}
async function checkPayment({cancelled = false} = {}) {
  if (!activePurchase?.id) return;
  const run = ++paymentPoll;
  const version = sessionVersion;
  const purchaseId = activePurchase.id;
  $("check-payment").hidden = false; $("check-payment").disabled = true;
  text("checkout-status", "Checking the purchase record…");
  for (let attempt = 0; attempt < 15; attempt++) {
    if (run !== paymentPoll || version !== sessionVersion) return;
    try {
      const checkout = await browserRequest(`/v1/browser/billing/checkouts/${encodeURIComponent(purchaseId)}`);
      if (run !== paymentPoll || version !== sessionVersion) return;
      const view = checkoutView(checkout);
      text("checkout-status", cancelled && !view.terminal ? "You left checkout. Payment is not confirmed. Resume checkout or check the purchase status again." : view.message);
      $("checkout-status").dataset.state = view.state;
      $("resume-payment").hidden = view.terminal || !activePurchase.storageKey;
      $("new-payment").hidden = !view.terminal;
      if (view.terminal) {
        if (activePurchase.storageKey) storage.remove(activePurchase.storageKey);
        if (view.state === "paid") await loadWorkspace();
        $("check-payment").disabled = false;
        return;
      }
      if (cancelled) break;
      if (attempt < 14) await delay(2000);
    } catch (error) {
      if (run !== paymentPoll || version !== sessionVersion) return;
      text("checkout-status", `Payment could not be confirmed. ${error.message} Check again before starting another purchase.`);
      break;
    }
  }
  if (run === paymentPoll && version === sessionVersion) $("check-payment").disabled = false;
}
async function beginCheckout(event) {
  event?.preventDefault();
  if (paymentMode === "disabled") return;
  if (activePurchase) { await checkPayment(); return; }
  const button = $("credit-checkout").querySelector('button[type="submit"]');
  const amountCents = Number($("checkout-amount").value);
  const storageKey = `likerts-checkout-${activeWorkspace}-${amountCents}`;
  const idempotencyKey = storage.get(storageKey) || crypto.randomUUID();
  storage.set(storageKey, idempotencyKey);
  const version = sessionVersion;
  button.disabled = true; text("checkout-status", "Preparing checkout…");
  try {
    const checkout = await browserRequest("/v1/browser/billing/checkout", {method: "POST", body: JSON.stringify({amountCents, idempotencyKey})});
    if (version !== sessionVersion) return;
    activePurchase = {id: checkout.id, storageKey, amountCents};
    storage.set(`likerts-purchase-${activeWorkspace}`, JSON.stringify(activePurchase));
    if (checkout.checkoutUrl && checkout.status !== "paid") {
      if (!validCheckoutUrl(checkout.checkoutUrl)) throw new Error("Checkout returned an unavailable payment destination.");
      window.location.assign(checkout.checkoutUrl);
    } else await checkPayment();
  } catch (error) { if (version === sessionVersion) text("checkout-status", `Checkout could not be opened. ${error.message} Retry uses the same purchase request.`); }
  finally { if (version === sessionVersion) button.disabled = paymentMode === "disabled"; }
}
$("credit-checkout").addEventListener("submit", beginCheckout);
$("check-payment").addEventListener("click", () => checkPayment());
$("new-payment").addEventListener("click", () => { clearPurchase(); text("checkout-status", "Select a credit pack to start a new checkout."); });
$("resume-payment").addEventListener("click", async () => {
  if (!activePurchase?.storageKey) return;
  const purchase = activePurchase;
  activePurchase = undefined;
  $("checkout-amount").value = String(purchase.amountCents);
  await beginCheckout();
});
async function refresh() {
  $("refresh-workspace").disabled = true;
  try { await loadWorkspace(); await loadAgentCredentials(); }
  catch (error) { text("refresh-status", error.message); text("session-status", error.message); $("retry-workspace").hidden = false; }
  finally { $("refresh-workspace").disabled = false; }
}
$("refresh-workspace").addEventListener("click", refresh);
$("retry-workspace").addEventListener("click", refresh);

async function sessionChanged(clerk) {
  const nextId = clerk.session?.id ?? null;
  if (sessionId === nextId) return;
  sessionId = nextId;
  const version = ++sessionVersion;
  paymentPoll++;
  activeClerk = clerk; activeWorkspace = undefined; activePurchase = undefined;
  clearSecret();
  $("workspace-content").hidden = true; $("signed-out-panel").hidden = false;
  $("agent-credentials").replaceChildren();
  const root = $("auth-root"); root.replaceChildren();
  const mount = document.createElement("div"); root.appendChild(mount);
  if (!nextId) {
    text("session-status", "Sign in with an email code to continue.");
    clerk.mountSignIn(mount, {routing: "hash", forceRedirectUrl: "/app", signUpForceRedirectUrl: "/app", fallbackRedirectUrl: "/app", signUpFallbackRedirectUrl: "/app"});
    return;
  }
  clerk.mountUserButton(mount, {afterSignOutUrl: "/app"});
  text("session-status", "Opening your workspace…");
  try { await loadWorkspace({initial: true}); }
  catch (error) { if (version === sessionVersion) { text("session-status", `Workspace is unavailable. ${error.message}`); $("retry-workspace").hidden = false; } }
}
async function loadClerk() {
  if (!publishableKey || !apiOrigin) { text("auth-root", "Sign-in is not configured for this environment."); return; }
  const encodedDomain = publishableKey.split("_").slice(2).join("_");
  const domain = atob(encodedDomain.replace(/-/g, "+").replace(/_/g, "/")).slice(0, -1);
  if (!/^[a-z0-9.-]+\.clerk\.accounts\.dev$/.test(domain) && !/^[a-z0-9.-]+\.clerk\.com$/.test(domain) && domain !== "clerk.likerts.com") throw new Error("untrusted Clerk frontend domain");
  const loadScript = (source, publishableKeyForScript) => new Promise((resolve, reject) => {
    const script = document.createElement("script"); script.src = source; script.async = true; script.crossOrigin = "anonymous";
    if (publishableKeyForScript) script.dataset.clerkPublishableKey = publishableKeyForScript;
    script.onload = resolve; script.onerror = () => reject(new Error("identity SDK unavailable")); document.head.appendChild(script);
  });
  await loadScript(`https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await loadScript(`https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, publishableKey);
  const clerk = window.Clerk;
  await clerk.load({telemetry: false, ui: {ClerkUI: window.__internal_ClerkUICtor}, signInForceRedirectUrl: "/app", signUpForceRedirectUrl: "/app", afterSignOutUrl: "/app"});
  clerk.addListener(() => { void sessionChanged(clerk); });
  await sessionChanged(clerk);
}
loadClerk().catch(() => { text("auth-root", "Secure sign-in is unavailable. Reload to try again."); text("session-status", "Your workspace has not been opened."); });
