import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import test from "node:test";
import * as state from "../public/workspace-state.js";

const html = await readFile(new URL("../public/app/index.html", import.meta.url), "utf8");
const source = (await readFile(new URL("../public/app.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/, "")
  .replace('"__CLERK_PUBLISHABLE_KEY__"', JSON.stringify(`pk_test_${Buffer.from("safe.clerk.accounts.dev$").toString("base64url")}`))
  .replace('"__LIKERTS_PUBLIC_API_ORIGIN__"', '"https://api.example.com"');

async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.ok(check(), "UI condition did not settle");
}

async function fixture({ signedIn = true, revokeFails = false } = {}) {
  const dom = new JSDOM(html, { url: "https://likerts.test/app", runScripts: "outside-only" });
  const { window } = dom;
  const requests = [];
  let listener;
  let credentials = [{ id: "cred-1", name: "Existing", scopes: ["usage:read"], expiresAt: "2027-01-01T00:00:00Z", revoked: false }];
  Object.assign(window, state);
  window.setTimeout = (fn, ms) => setTimeout(fn, Math.min(ms, 5));
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } } });
  const clerk = {
    session: signedIn ? { id: "session-1", getToken: async () => "owner-token" } : null,
    load: async () => {}, addListener: (fn) => { listener = fn; },
    mountSignIn: (_root, options) => { clerk.signInOptions = options; },
    mountUserButton: (_root, options) => { clerk.userButtonOptions = options; },
  };
  window.Clerk = clerk; window.__internal_ClerkUICtor = {};
  const originalAppend = window.document.head.appendChild.bind(window.document.head);
  window.document.head.appendChild = (node) => { const result = originalAppend(node); queueMicrotask(() => node.onload?.()); return result; };
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    let body; let status = 200;
    if (url.endsWith("/bootstrap")) body = { workspaceId: "ws_test", usage: { acceptedResponses: 901, monthAcceptedResponses: 22 } };
    else if (options.method === "DELETE") { if (revokeFails) { status = 503; body = {}; } else { credentials = []; status = 204; } }
    else if (options.method === "POST" && url.endsWith("/service-credentials")) {
      const input = JSON.parse(options.body); const credential = { id: "cred-2", name: input.name, scopes: input.scopes, expiresAt: input.expiresAt, revoked: false };
      credentials.push(credential); body = { credential, token: "test-only-issued-secret" }; status = 201;
    } else if (url.endsWith("/service-credentials")) body = credentials;
    return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
  };
  window.eval(source);
  await until(() => signedIn ? !window.document.getElementById("workspace-content").hidden : Boolean(clerk.signInOptions));
  return { window, clerk, requests, close: () => dom.window.close(), changeSession: () => listener() };
}

test("signed-in workspace renders unmetered response activity and scoped setup", async () => {
  const f = await fixture();
  try {
    const $ = (id) => f.window.document.getElementById(id);
    assert.equal($("response-status").textContent, "901");
    assert.match($("collection-status").textContent, /does not meter or charge/);
    assert.match($("connection-code").textContent, /ws_test/);
    assert.equal(f.clerk.userButtonOptions.afterSignOutUrl, "/app");
    assert.equal($("scope-preset").value, "read");
    assert.equal(f.requests.some(({ url }) => url.includes("billing")), false);
  } finally { f.close(); }
});

test("failed revocation is recoverable and sign-out clears issued secrets", async () => {
  const f = await fixture({ revokeFails: true });
  try {
    await until(() => f.window.document.querySelector('[aria-label="Revoke Existing"]'));
    const revoke = f.window.document.querySelector('[aria-label="Revoke Existing"]');
    revoke.click();
    await until(() => f.window.document.getElementById("credential-list-status").textContent.includes("not confirmed"));
    assert.equal(revoke.disabled, false);
    f.window.document.getElementById("agent-credential").dispatchEvent(new f.window.Event("submit", { cancelable: true }));
    await until(() => !f.window.document.getElementById("agent-secret").hidden);
    f.clerk.session = null; f.changeSession();
    await until(() => f.window.document.getElementById("workspace-content").hidden);
    assert.equal(f.window.document.getElementById("agent-token").value, "");
  } finally { f.close(); }
});
