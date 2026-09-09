import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import { containsSecretField, healthDocument } from "../api/health.js";

const execFileAsync = promisify(execFile);
const controlPlane = new URL("../", import.meta.url);
const clerkDomain = "safe.clerk.accounts.dev";
const clerkKey = `pk_test_${Buffer.from(`${clerkDomain}$`).toString("base64url")}`;

test("public health reports readiness without returning environment values", () => {
  const secret = "never-return-this-value";
  const document = healthDocument({
    LIKERTS_PUBLIC_API_ORIGIN: "https://api.example.com",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
    LIKERTS_VERCEL_BLOB_TOKEN: secret,
    CLERK_SECRET_KEY: secret,
  });
  const encoded = JSON.stringify(document);
  assert.equal(document.configuration.apiOrigin, true);
  assert.equal(document.configuration.identity, true);
  assert.equal(encoded.includes(secret), false);
  assert.equal(containsSecretField(document), false);
});

test("build emits an exact-origin CSP without wildcard connectivity", async () => {
  await execFileAsync(process.execPath, ["scripts/build.mjs"], {
    cwd: controlPlane,
    env: {
      ...process.env,
      LIKERTS_PUBLIC_API_ORIGIN: "https://api.likerts.example:8443",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkKey,
    },
  });
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(policy);
  assert.match(policy, /connect-src 'self' https:\/\/api\.likerts\.example:8443 https:\/\/safe\.clerk\.accounts\.dev/);
  assert.match(policy, /script-src 'self' https:\/\/safe\.clerk\.accounts\.dev/);
  assert.doesNotMatch(policy, /\*/);

  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(config.outputDirectory, "dist");
});

test("build rejects API URLs that are not an exact trusted origin", async () => {
  for (const origin of [
    "https://*.example.com",
    "https://api.example.com/path",
    "https://user:secret@api.example.com",
    "http://api.example.com",
  ]) {
    await assert.rejects(execFileAsync(process.execPath, ["scripts/build.mjs"], {
      cwd: controlPlane,
      env: { ...process.env, LIKERTS_PUBLIC_API_ORIGIN: origin },
    }), /LIKERTS_PUBLIC_API_ORIGIN/);
  }
});

test("browser mounts Clerk sign-in or the signed-in user button", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(app, /Clerk\.mountSignIn/);
  assert.match(app, /Clerk\.mountUserButton/);
  assert.match(app, /session\.getToken\(\)/);
  assert.match(app, /\/v1\/browser\/bootstrap/);
  assert.match(app, /\/v1\/browser\/oauth-grants/);
  assert.match(app, /\/v1\/browser\/billing\/checkout/);
  assert.match(app, /crypto\.randomUUID/);
  assert.match(app, /credentials: "omit"/);
  assert.match(app, /untrusted Clerk frontend domain/);
  assert.doesNotMatch(html, /type="password"|disabled>Sign in/);
  assert.match(html, /Approve for 30 days/);
  assert.match(html, /value="identity:write"/);
  assert.match(html, /500 responses — \$5/);
  assert.match(html, /Web, React Native, iOS, Android and Flutter SDKs/);
});
