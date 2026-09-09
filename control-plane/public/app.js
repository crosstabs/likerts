const set = (id, value, ready) => {
  const node = document.getElementById(id);
  node.textContent = value;
  node.dataset.ready = String(ready);
};

const publishableKey = "__CLERK_PUBLISHABLE_KEY__";
const apiOrigin = "__LIKERTS_PUBLIC_API_ORIGIN__";
let activeClerk;
let activeWorkspace;

async function loadWorkspace(clerk) {
  if (!apiOrigin || !clerk.session) {
    set("workspace-status", "API pending", false);
    return;
  }
  const token = await clerk.session.getToken();
  if (!token) throw new Error("session token unavailable");
  const response = await fetch(`${apiOrigin}/v1/browser/bootstrap`, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`workspace bootstrap failed: ${response.status}`);
  const result = await response.json();
  activeClerk = clerk;
  activeWorkspace = result.workspaceId;
  set("workspace-status", result.workspaceId, true);
  set("response-status", String(result.usage.totalResponses), true);
  set("credit-status", String(result.usage.credits.availableCredits), result.usage.credits.availableCredits > 0);
  document.getElementById("oauth-approval").hidden = false;
  document.getElementById("agent-credential").hidden = false;
  document.getElementById("credit-checkout").hidden = false;
  await loadAgentCredentials();
}

async function browserRequest(path, options = {}) {
  if (!activeClerk?.session || !activeWorkspace) throw new Error("missing workspace context");
  const token = await activeClerk.session.getToken();
  return fetch(`${apiOrigin}${path}`, {
    ...options,
    credentials: "omit",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Likerts-Workspace": activeWorkspace,
      ...(options.headers || {}),
    },
  });
}

async function loadAgentCredentials() {
  const root = document.getElementById("agent-credentials");
  const response = await browserRequest("/v1/browser/service-credentials");
  if (!response.ok) throw new Error(`credential list failed: ${response.status}`);
  const credentials = await response.json();
  root.replaceChildren();
  for (const credential of credentials.filter((item) => !item.revoked)) {
    const row = document.createElement("div");
    row.className = "credential-row";
    const label = document.createElement("span");
    label.textContent = `${credential.name} · expires ${new Date(credential.expiresAt).toLocaleDateString()}`;
    const revoke = document.createElement("button");
    revoke.type = "button";
    revoke.textContent = "Revoke";
    revoke.addEventListener("click", async () => {
      revoke.disabled = true;
      const result = await browserRequest(`/v1/browser/service-credentials/${encodeURIComponent(credential.id)}`, {method: "DELETE"});
      if (!result.ok) throw new Error(`credential revoke failed: ${result.status}`);
      await loadAgentCredentials();
    });
    row.append(label, revoke);
    root.append(row);
  }
}

document.getElementById("agent-credential").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const output = document.getElementById("agent-status");
  const button = form.querySelector('button[type="submit"]');
  const scopes = [...form.querySelectorAll('input[name="scope"]:checked')].map((input) => input.value);
  output.textContent = "Creating…";
  button.disabled = true;
  try {
    const response = await browserRequest("/v1/browser/service-credentials", {
      method: "POST",
      body: JSON.stringify({name: document.getElementById("agent-name").value, scopes, expiresAt: new Date(Date.now() + 90 * 86400_000).toISOString()}),
    });
    if (!response.ok) throw new Error(`credential create failed: ${response.status}`);
    const result = await response.json();
    document.getElementById("agent-token").value = result.token;
    document.getElementById("agent-secret").hidden = false;
    output.textContent = "Credential created. Copy the token now; it will not be shown again.";
    await loadAgentCredentials();
  } catch {
    output.textContent = "Credential could not be created.";
  } finally {
    button.disabled = false;
  }
});

document.getElementById("copy-agent-token").addEventListener("click", async () => {
  const token = document.getElementById("agent-token").value;
  await navigator.clipboard.writeText(token);
  document.getElementById("agent-status").textContent = "Token copied.";
});

document.getElementById("credit-checkout").addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = document.getElementById("checkout-status");
  const button = event.currentTarget.querySelector("button");
  const amountCents = Number(document.getElementById("checkout-amount").value);
  const storageKey = `likerts-checkout-${activeWorkspace}-${amountCents}`;
  const idempotencyKey = sessionStorage.getItem(storageKey) || crypto.randomUUID();
  sessionStorage.setItem(storageKey, idempotencyKey);
  output.textContent = "Opening secure checkout…";
  button.disabled = true;
  try {
    if (!activeClerk?.session || !activeWorkspace) throw new Error("missing checkout context");
    const token = await activeClerk.session.getToken();
    const response = await fetch(`${apiOrigin}/v1/browser/billing/checkout`, {
      method: "POST", credentials: "omit", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Likerts-Workspace": activeWorkspace },
      body: JSON.stringify({ amountCents, idempotencyKey }),
    });
    if (!response.ok) throw new Error(`checkout failed: ${response.status}`);
    const checkout = await response.json();
    if (!checkout.checkoutUrl) {
      output.textContent = checkout.status === "paid" ? "Credits added" : `Checkout ${checkout.status}`;
      sessionStorage.removeItem(storageKey);
      return;
    }
    window.location.assign(checkout.checkoutUrl);
  } catch {
    output.textContent = "Checkout could not be started. Retry safely with the same request.";
    button.disabled = false;
  }
});

document.getElementById("oauth-approval").addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = document.getElementById("approval-status");
  const form = event.currentTarget;
  const scopes = [...form.querySelectorAll('input[name="scope"]:checked')].map((input) => input.value);
  const clientId = document.getElementById("oauth-client-id").value;
  output.textContent = "Approving…";
  try {
    if (!activeClerk?.session || !activeWorkspace || scopes.length === 0) throw new Error("missing approval context");
    const token = await activeClerk.session.getToken();
    const response = await fetch(`${apiOrigin}/v1/browser/oauth-grants`, {
      method: "POST", credentials: "omit", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Likerts-Workspace": activeWorkspace },
      body: JSON.stringify({ clientId, scopes }),
    });
    if (!response.ok) throw new Error(`approval failed: ${response.status}`);
    const grant = await response.json();
    output.textContent = `Approved until ${new Date(grant.expiresAt).toLocaleDateString()}`;
  } catch {
    output.textContent = "Approval failed";
  }
});

async function loadClerk() {
  const authRoot = document.getElementById("auth-root");
  const checkoutResult = new URLSearchParams(window.location.search).get("checkout");
  if (checkoutResult === "success") set("checkout-status", "Payment received. Updating credits…", true);
  if (checkoutResult === "cancelled") set("checkout-status", "Checkout cancelled", false);
  if (!publishableKey) {
    authRoot.textContent = "Identity configuration pending";
    return;
  }
  const encodedDomain = publishableKey.split("_").slice(2).join("_");
  if (!encodedDomain) throw new Error("invalid publishable key");
  const domain = atob(encodedDomain.replace(/-/g, "+").replace(/_/g, "/")).slice(0, -1);
  if (!/^[a-z0-9.-]+\.clerk\.accounts\.dev$/.test(domain)
    && !/^[a-z0-9.-]+\.clerk\.com$/.test(domain)
    && domain !== "clerk.likerts.com") {
    throw new Error("untrusted Clerk frontend domain");
  }
  const loadScript = (source, publishableKeyForScript) => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.async = true;
    script.crossOrigin = "anonymous";
    if (publishableKeyForScript) script.dataset.clerkPublishableKey = publishableKeyForScript;
    script.onload = resolve;
    script.onerror = () => reject(new Error("identity SDK unavailable"));
    document.head.appendChild(script);
  });
  await loadScript(`https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await loadScript(`https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, publishableKey);
  const clerk = window.Clerk;
  await clerk.load({ telemetry: false, ui: { ClerkUI: window.__internal_ClerkUICtor } });
  authRoot.replaceChildren();
  const mount = document.createElement("div");
  authRoot.appendChild(mount);
  if (clerk.isSignedIn) {
    clerk.mountUserButton(mount);
    await loadWorkspace(clerk);
  } else {
    clerk.mountSignIn(mount);
    set("workspace-status", "Sign in required", false);
  }
}

loadClerk().catch(() => {
  document.getElementById("auth-root").textContent = "Secure sign-in is unavailable";
  set("workspace-status", "Unavailable", false);
});

fetch("/api/health", { credentials: "same-origin", cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error("unavailable");
    return response.json();
  })
  .then((health) => {
    set("control-status", "Ready", health.status === "ok");
    set("api-status", health.configuration.apiOrigin ? "Configured" : "Pending", health.configuration.apiOrigin);
    set("identity-status", health.configuration.identity ? "Configured" : "Pending", health.configuration.identity);
  })
  .catch(() => {
    set("control-status", "Unavailable", false);
    set("api-status", "Unknown", false);
    set("identity-status", "Unknown", false);
  });
