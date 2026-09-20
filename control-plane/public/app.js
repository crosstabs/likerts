import { SCOPE_PRESETS, connectionExamples } from "/workspace-state.js";

const publishableKey = "__CLERK_PUBLISHABLE_KEY__";
const apiOrigin = "__LIKERTS_PUBLIC_API_ORIGIN__";
const apiTokenTemplate = "likerts-api";
const $ = (id) => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
let activeClerk;
let activeWorkspace;
let sessionVersion = 0;
let sessionId;
let issuedCredentialId;
let connectionCode = "";
let activeAnalysis;

async function browserRequest(path, options = {}) {
  if (!activeClerk?.session) throw new Error("Sign in required");
  const version = sessionVersion;
  const workspace = activeWorkspace;
  const token = await activeClerk.session.getToken({template: apiTokenTemplate});
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
  text("response-status", Number(usage.acceptedResponses ?? 0).toLocaleString());
  text("collection-status", "Ready to accept responses. Likerts does not meter or charge them.");
  $("collection-status").dataset.blocked = "false";
}

function metric(label, value) {
  const root = document.createElement("div");
  const name = document.createElement("span"); name.textContent = label;
  const number = document.createElement("strong"); number.textContent = Number(value ?? 0).toLocaleString();
  root.append(name, number); return root;
}

function renderResults(analysis) {
  activeAnalysis = analysis;
  const selected = $("results-collection").value;
  const collections = selected ? analysis.collections.filter((item) => item.collectionId === selected) : analysis.collections;
  const findings = analysis.findings.filter((item) => !selected || !item.collectionId || item.collectionId === selected);
  const visualizations = analysis.visualizations.filter((item) => !selected || item.collectionId === selected);
  const responseCount = collections.reduce((sum, item) => sum + Number(item.responseCount || 0), 0);
  $("results-summary").replaceChildren(metric("Responses", responseCount), metric("Collections", collections.length), metric("Charts", visualizations.length));
  const findingRoot = $("results-findings"); findingRoot.replaceChildren();
  for (const finding of findings.slice(0, 6)) {
    const item = document.createElement("article"); item.className = "result-finding";
    const title = document.createElement("h3"); title.textContent = finding.title;
    const detail = document.createElement("p"); detail.textContent = finding.detail;
    item.append(title, detail); findingRoot.append(item);
  }
  const chartRoot = $("results-charts"); chartRoot.replaceChildren();
  for (const visualization of visualizations) {
    const figure = document.createElement("figure"); figure.className = "result-chart";
    const caption = document.createElement("figcaption"); caption.textContent = visualization.title;
    const max = Math.max(...visualization.data.map((point) => Number(point.count)), 1);
    const plot = document.createElement("div"); plot.className = "bar-plot";
    for (const point of visualization.data) {
      const row = document.createElement("div"); row.className = "bar-row";
      const label = document.createElement("span"); label.className = "bar-label"; label.textContent = point.label;
      const track = document.createElement("div"); track.className = "bar-track";
      const bar = document.createElement("span"); bar.className = "bar-fill"; bar.style.width = `${Math.max(2, Number(point.count) / max * 100)}%`;
      track.append(bar);
      const value = document.createElement("span"); value.className = "bar-value"; value.textContent = `${Number(point.count).toLocaleString()} · ${point.percentage}%`;
      row.setAttribute("aria-label", `${point.label}: ${point.count} responses, ${point.percentage} percent`);
      row.append(label, track, value); plot.append(row);
    }
    figure.append(caption, plot); chartRoot.append(figure);
  }
  text("results-status", analysis.responseCount ? `Updated ${new Date(analysis.generatedAt).toLocaleString()}.` : "No responses yet. Publish and distribute a collection, then refresh.");
  text("results-privacy", analysis.privacy.note);
}

async function loadResults() {
  text("results-status", "Loading privacy-safe results…");
  try {
    const analysis = await browserRequest("/v1/browser/results?minimumGroupSize=3");
    const select = $("results-collection");
    const previous = select.value;
    select.replaceChildren(new Option("All collections", ""));
    for (const collection of analysis.collections) select.append(new Option(`${collection.title} · ${collection.responseCount}`, collection.collectionId));
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    renderResults(analysis);
  } catch (error) {
    activeAnalysis = undefined;
    $("results-summary").replaceChildren(); $("results-findings").replaceChildren(); $("results-charts").replaceChildren();
    text("results-status", `Results are unavailable. ${error.message}`);
    text("results-privacy", "No response data was placed in the page.");
  }
}

async function loadWorkspace({initial = false} = {}) {
  const version = sessionVersion;
  text("refresh-status", "Refreshing workspace…");
  const result = await browserRequest("/v1/browser/bootstrap", {method: "POST", body: "{}"});
  if (version !== sessionVersion) return;
  activeWorkspace = result.workspaceId;
  text("workspace-status", activeWorkspace);
  renderUsage(result.usage);
  $("signed-out-panel").hidden = true;
  $("workspace-content").hidden = false;
  $("retry-workspace").hidden = true;
  text("session-status", "Signed in. Your workspace is ready.");
  text("refresh-status", "Updated just now. Refresh to see new responses.");
  renderConnection();
  await loadResults();
  if (version !== sessionVersion) return;
  if (initial) {
    await loadAgentCredentials();
    if (version !== sessionVersion) return;
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
  text("scope-description", event.target.value === "build" ? "Allows survey edits/publication and collection creation, closure and revocation. Response erasure, access and callback writes remain off unless you choose them." : event.target.value === "read" ? "Read surveys, responses, usage and existing exports. No write permissions." : "Review each selected capability. Write scopes may change or delete resources.");
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
$("results-collection").addEventListener("change", () => { if (activeAnalysis) renderResults(activeAnalysis); });

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
  activeClerk = clerk; activeWorkspace = undefined;
  activeAnalysis = undefined;
  clearSecret();
  $("workspace-content").hidden = true; $("signed-out-panel").hidden = false;
  $("agent-credentials").replaceChildren();
  $("results-summary").replaceChildren(); $("results-findings").replaceChildren(); $("results-charts").replaceChildren();
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
