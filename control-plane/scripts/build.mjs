import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../dist/", import.meta.url));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL("../public/", import.meta.url), output, { recursive: true });
// Historical preview archives are retained in Git for provenance, but the
// community edition site links current public packages and release assets.
await rm(new URL("../dist/downloads/", import.meta.url), { recursive: true, force: true });
await mkdir(new URL("../dist/downloads/", import.meta.url), { recursive: true });
await cp(new URL("../public/downloads/index.html", import.meta.url), new URL("../dist/downloads/index.html", import.meta.url));

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
if (publishableKey && !/^pk_(test|live)_[A-Za-z0-9_-]{10,}$/.test(publishableKey)) {
  throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is malformed");
}
let clerkOrigin = "";
if (publishableKey) {
  const encodedDomain = publishableKey.split("_").slice(2).join("_");
  let decodedDomain;
  try {
    decodedDomain = Buffer.from(encodedDomain, "base64url").toString("utf8");
  } catch {
    throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY contains an invalid frontend domain");
  }
  const domain = decodedDomain.endsWith("$") ? decodedDomain.slice(0, -1) : "";
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.clerk\.accounts\.dev$/.test(domain)
    && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.clerk\.com$/.test(domain)
    && domain !== "clerk.likerts.com") {
    throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY contains an untrusted frontend domain");
  }
  clerkOrigin = `https://${domain}`;
}
const appPath = new URL("../dist/app.js", import.meta.url);
const app = await readFile(appPath, "utf8");
const apiOrigin = process.env.LIKERTS_PUBLIC_API_ORIGIN ?? "";
if (apiOrigin) {
  let parsed;
  try {
    parsed = new URL(apiOrigin);
  } catch {
    throw new Error("LIKERTS_PUBLIC_API_ORIGIN must be an exact HTTPS or loopback HTTP origin");
  }
  const loopbackHttp = parsed.protocol === "http:"
    && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
  const dnsName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(parsed.hostname);
  if ((parsed.protocol !== "https:" && !loopbackHttp)
    || !parsed.hostname
    || (!dnsName && parsed.hostname !== "[::1]")
    || parsed.username
    || parsed.password
    || parsed.origin !== apiOrigin
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash) {
    throw new Error("LIKERTS_PUBLIC_API_ORIGIN must be an exact HTTPS or loopback HTTP origin");
  }
}
await writeFile(appPath, app
  .replace('"__CLERK_PUBLISHABLE_KEY__"', JSON.stringify(publishableKey))
  .replace('"__LIKERTS_PUBLIC_API_ORIGIN__"', JSON.stringify(apiOrigin)));

const selfAnd = (...origins) => ["'self'", ...origins.filter(Boolean)].join(" ");
const policy = [
  "default-src 'self'",
  `connect-src ${selfAnd(apiOrigin, clerkOrigin)}`,
  `img-src ${selfAnd("data:", "https://img.clerk.com")}`,
  "style-src 'self' 'unsafe-inline'",
  `script-src ${selfAnd(clerkOrigin)}`,
  `frame-src ${selfAnd(clerkOrigin)}`,
  "worker-src 'self' blob:",
  "base-uri 'none'",
  `form-action ${selfAnd(clerkOrigin)}`,
].join("; ");
for (const relativePath of ["index.html", "app/index.html"]) {
  const htmlPath = new URL(`../dist/${relativePath}`, import.meta.url);
  const html = await readFile(htmlPath, "utf8");
  await writeFile(htmlPath, html.replace("__LIKERTS_CONTENT_SECURITY_POLICY__", policy));
}

for (const file of ["index.html", "app/index.html", "app.js", "marketing.js", "styles.css"]) {
  const contents = await readFile(new URL(`../dist/${file}`, import.meta.url), "utf8");
  if (/BLOB_READ_WRITE_TOKEN|LIKERTS_VERCEL_BLOB_TOKEN|CLERK_SECRET_KEY|STRIPE_SECRET/i.test(contents)) {
    throw new Error(`server secret reference found in browser asset ${file}`);
  }
}
console.log("control-plane static build complete");
