import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
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
  const appHtml = await readFile(new URL("../dist/app/index.html", import.meta.url), "utf8");
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(policy);
  assert.match(policy, /connect-src 'self' https:\/\/api\.likerts\.example:8443 https:\/\/safe\.clerk\.accounts\.dev/);
  assert.match(policy, /script-src 'self' https:\/\/safe\.clerk\.accounts\.dev/);
  assert.match(policy, /worker-src 'self' blob:/);
  assert.doesNotMatch(policy, /\*/);
  assert.doesNotMatch(appHtml, /__LIKERTS_CONTENT_SECURITY_POLICY__/);
  assert.match(appHtml, /script src="\/app\.js"/);
  assert.doesNotMatch(html, /script src="\/app\.js"/);
  assert.match(html, /script src="\/marketing\.js"/);

  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(config.outputDirectory, "dist");

  const downloads = await readFile(new URL("../dist/downloads/index.html", import.meta.url), "utf8");
  assert.match(downloads, /Likerts downloads/);
  for (const file of [
    "SHA256SUMS",
    "likerts-web-0.0.3.tgz",
    "likerts-react-native-0.0.3.tgz",
    "Likerts-ios-0.0.3.tar.gz",
    "likerts-android-maven-0.0.3.tar.gz",
    "likerts-flutter-0.0.3.tar.gz",
    "likerts-cli-source-0.1.0.tar.gz",
  ]) {
    await access(new URL(`../dist/downloads/${file}`, import.meta.url));
    assert.match(downloads, new RegExp(file.replaceAll(".", "\\.")));
  }
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

test("marketing site is separate from the authenticated control plane", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const marketingHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/app/index.html", import.meta.url), "utf8");
  assert.match(app, /clerk\.mountSignIn/);
  assert.match(app, /clerk\.mountUserButton/);
  assert.match(app, /dataset\.clerkPublishableKey = publishableKeyForScript/);
  assert.match(app, /telemetry: false/);
  assert.match(app, /session\.getToken\(\)/);
  assert.match(app, /\/v1\/browser\/bootstrap/);
  assert.match(app, /\/v1\/browser\/oauth-grants/);
  assert.match(app, /\/v1\/browser\/service-credentials/);
  assert.match(app, /\/v1\/browser\/billing\/checkout/);
  assert.match(app, /crypto\.randomUUID/);
  assert.match(app, /credentials: "omit"/);
  assert.match(app, /untrusted Clerk frontend domain/);
  assert.match(app, /clerk\.likerts\.com/);
  assert.doesNotMatch(html, /type="password"|disabled>Sign in/);
  assert.match(html, /Approve for 30 days/);
  assert.match(html, /value="identity:write"/);
  assert.match(html, /500 responses — \$5/);
  assert.match(html, /Web · React Native · iOS · Android · Flutter/);
  assert.match(html, /href="\/downloads\/"/);
  assert.match(marketingHtml, /Survey collection infrastructure/);
  assert.match(marketingHtml, /One survey contract/);
  assert.match(marketingHtml, /Operate it from your agent/);
  assert.match(marketingHtml, /1¢/);
  assert.match(marketingHtml, /href="\/app\/"/);
  assert.doesNotMatch(marketingHtml, /id="auth-root"/);
});
