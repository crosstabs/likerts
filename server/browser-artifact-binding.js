import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const BROWSER_ARTIFACT_MANIFEST_SCHEMA_VERSION = 'browser-artifact-manifest-v1';

export class BrowserArtifactBindingError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'BrowserArtifactBindingError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new BrowserArtifactBindingError(code, message, cause ? { cause } : undefined);
}

function contentDigest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function updateArtifactDigest(digest, relativePath, bytes) {
  digest.update(`${Buffer.byteLength(relativePath)}\0${relativePath}\0${bytes.length}\0`);
  digest.update(bytes);
}

/** Canonical artifact paths sort by unsigned UTF-8 bytes, never process locale. */
export function compareCanonicalBrowserArtifactPaths(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function exactKeys(value, expectedKeys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...expectedKeys].sort().join(',');
}

function validateArtifactFileSet(files) {
  const paths = files.map((entry) => entry?.relativePath);
  if (paths.some((relativePath) => typeof relativePath !== 'string'
    || !relativePath
    || relativePath.includes('\0')
    || relativePath.startsWith('/')
    || relativePath !== path.posix.normalize(relativePath)
    || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..'))
    || new Set(paths).size !== paths.length
    || paths.some((relativePath, index) => (
      index > 0 && compareCanonicalBrowserArtifactPaths(paths[index - 1], relativePath) >= 0
    ))) {
    fail('ARTIFACT_FILE_SET_INVALID', 'The browser artifact manifest file set must be unique, normalized, and sorted.');
  }
  return paths;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || !Array.isArray(manifest.files) || manifest.files.length === 0
    || !SHA256_PATTERN.test(manifest.artifactDigest || '')) {
    fail('ARTIFACT_MANIFEST_INVALID', 'The browser artifact manifest is missing or malformed.');
  }

  const paths = validateArtifactFileSet(manifest.files);

  const digest = createHash('sha256');
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !Buffer.isBuffer(entry.bytes)
      || !Number.isInteger(entry.byteLength) || entry.byteLength < 0
      || entry.byteLength !== entry.bytes.length
      || !SHA256_PATTERN.test(entry.contentDigest || '')
      || contentDigest(entry.bytes) !== entry.contentDigest) {
      fail('ARTIFACT_FILE_INVALID', `The browser artifact manifest entry is malformed: ${entry?.relativePath || '<unknown>'}.`);
    }
    updateArtifactDigest(digest, entry.relativePath, entry.bytes);
  }
  if (`sha256:${digest.digest('hex')}` !== manifest.artifactDigest) {
    fail('ARTIFACT_DIGEST_MISMATCH', 'The browser artifact manifest no longer matches its aggregate digest.');
  }
  return paths;
}

export function validatePortableBrowserArtifactManifest(manifest) {
  if (!exactKeys(manifest, ['schemaVersion', 'artifactDigest', 'files'])
    || manifest.schemaVersion !== BROWSER_ARTIFACT_MANIFEST_SCHEMA_VERSION
    || !SHA256_PATTERN.test(manifest.artifactDigest || '')
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0) {
    fail('ARTIFACT_MANIFEST_INVALID', 'The portable browser artifact manifest is missing or malformed.');
  }
  const paths = validateArtifactFileSet(manifest.files);
  for (const entry of manifest.files) {
    if (!exactKeys(entry, ['relativePath', 'byteLength', 'contentDigest'])
      || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0
      || !SHA256_PATTERN.test(entry.contentDigest || '')) {
      fail('ARTIFACT_FILE_INVALID', `The portable browser artifact manifest entry is malformed: ${entry?.relativePath || '<unknown>'}.`);
    }
  }
  return paths;
}

export function verifyPortableBrowserArtifactManifestBytes({ manifest, files } = {}) {
  const expectedPaths = validatePortableBrowserArtifactManifest(manifest);
  if (!Array.isArray(files) || files.length !== expectedPaths.length) {
    fail('ARTIFACT_FILE_SET_INVALID', 'Fetched browser artifact bytes do not match the portable manifest file set.');
  }
  const filesByPath = new Map();
  for (const entry of files) {
    if (!entry || typeof entry.relativePath !== 'string'
      || !(Buffer.isBuffer(entry.bytes) || entry.bytes instanceof Uint8Array)
      || filesByPath.has(entry.relativePath)) {
      fail('ARTIFACT_FILE_INVALID', `Fetched browser artifact bytes are malformed: ${entry?.relativePath || '<unknown>'}.`);
    }
    filesByPath.set(entry.relativePath, Buffer.from(entry.bytes));
  }
  if (expectedPaths.some((relativePath) => !filesByPath.has(relativePath))) {
    fail('ARTIFACT_FILE_SET_INVALID', 'Fetched browser artifact bytes do not match the portable manifest file set.');
  }
  const hydratedManifest = {
    artifactDigest: manifest.artifactDigest,
    files: manifest.files.map((entry) => ({
      ...entry,
      bytes: filesByPath.get(entry.relativePath),
    })),
  };
  validateManifest(hydratedManifest);
  return {
    artifactDigest: manifest.artifactDigest,
    verifiedFileCount: expectedPaths.length,
    verifiedPaths: expectedPaths,
  };
}

function candidateRootUrl(candidateUrl) {
  let root;
  try {
    root = new URL(candidateUrl);
  } catch (error) {
    fail('CANDIDATE_URL_INVALID', 'The tested browser candidate URL is invalid.', error);
  }
  if (!['http:', 'https:'].includes(root.protocol)
    || root.username || root.password || root.search || root.hash
    || !root.pathname.endsWith('/')) {
    fail('CANDIDATE_URL_INVALID', 'The tested browser candidate must be an HTTP(S) directory URL without credentials, query, or fragment.');
  }
  return root;
}

function pathIsWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveThroughExistingAncestor(targetPath) {
  const missingSegments = [];
  let cursor = path.resolve(targetPath);
  while (true) {
    try {
      const resolved = await fs.realpath(cursor);
      return path.join(resolved, ...missingSegments.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missingSegments.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function entryForBrowserResponseUrl({ entriesByPath, root, responseUrl }) {
  let url;
  try {
    url = new URL(responseUrl);
  } catch (error) {
    fail('BROWSER_ARTIFACT_URL_INVALID', 'Chromium returned an invalid artifact response URL.', error);
  }
  if (url.origin !== root.origin || url.username || url.password || url.hash) {
    fail('BROWSER_ARTIFACT_URL_INVALID', `Chromium loaded an artifact response outside the tested candidate origin: ${url.href}.`);
  }

  let relativePath;
  if (url.pathname === root.pathname) {
    relativePath = 'index.html';
  } else {
    if (url.search || !url.pathname.startsWith(root.pathname)) {
      fail('BROWSER_ARTIFACT_NOT_MANIFESTED', `Chromium loaded an unmanifested same-origin URL: ${url.href}.`);
    }
    const encodedRelativePath = url.pathname.slice(root.pathname.length);
    try {
      relativePath = encodedRelativePath.split('/').map(decodeURIComponent).join('/');
    } catch (error) {
      fail('BROWSER_ARTIFACT_URL_INVALID', `Chromium loaded an invalid encoded artifact path: ${url.href}.`, error);
    }
  }
  const entry = entriesByPath.get(relativePath);
  if (!entry) fail('BROWSER_ARTIFACT_NOT_MANIFESTED', `Chromium loaded an unmanifested same-origin artifact: ${url.href}.`);
  return { entry, url };
}

function artifactFileUrl(root, relativePath) {
  const encodedPath = relativePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const fileUrl = new URL(encodedPath, root);
  if (fileUrl.origin !== root.origin || !fileUrl.pathname.startsWith(root.pathname)) {
    fail('ARTIFACT_URL_INVALID', `The artifact path escaped the tested candidate origin: ${relativePath}.`);
  }
  return fileUrl;
}

async function fetchExactArtifactBytes({ fetchImpl, url, entry, label }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        accept: '*/*',
        'accept-encoding': 'gzip, deflate, br',
      },
    });
  } catch (error) {
    fail('ARTIFACT_FETCH_FAILED', `Could not fetch ${label} from the tested candidate.`, error);
  }
  if (!response || response.status !== 200 || response.redirected) {
    fail('ARTIFACT_RESPONSE_INVALID', `${label} did not return an exact 200 response from the tested candidate.`);
  }
  if (response.url) {
    const responseUrl = new URL(response.url);
    if (responseUrl.origin !== url.origin || responseUrl.href !== url.href) {
      fail('ARTIFACT_RESPONSE_INVALID', `${label} resolved to a different URL than its explicit artifact path.`);
    }
  }

  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    fail('ARTIFACT_FETCH_FAILED', `Could not read ${label} from the tested candidate.`, error);
  }
  const receivedDigest = contentDigest(bytes);
  if (bytes.length !== entry.byteLength
    || receivedDigest !== entry.contentDigest
    || !bytes.equals(entry.bytes)) {
    fail('SERVED_ARTIFACT_MISMATCH', `${label} bytes do not match the hashed browser candidate.`);
  }
  return {
    relativePath: entry.relativePath,
    byteLength: bytes.length,
    contentDigest: receivedDigest,
  };
}

export async function buildBrowserArtifactManifest(rootDirectory) {
  const resolvedRoot = path.resolve(rootDirectory);
  const discoveredFiles = [];

  async function visit(directory, relativeDirectory = '') {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      fail('ARTIFACT_DIRECTORY_UNREADABLE', `Could not read browser artifact directory: ${directory}.`, error);
    }
    entries.sort((left, right) => compareCanonicalBrowserArtifactPaths(left.name, right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        discoveredFiles.push({ absolutePath, relativePath });
      } else {
        fail('ARTIFACT_ENTRY_UNSUPPORTED', `Browser artifact contains a non-regular filesystem entry: ${relativePath}.`);
      }
    }
  }

  await visit(resolvedRoot);
  discoveredFiles.sort((left, right) => (
    compareCanonicalBrowserArtifactPaths(left.relativePath, right.relativePath)
  ));
  if (discoveredFiles.length === 0) fail('ARTIFACT_DIRECTORY_EMPTY', `Browser artifact directory is empty: ${resolvedRoot}.`);

  const aggregateDigest = createHash('sha256');
  const files = [];
  for (const file of discoveredFiles) {
    let bytes;
    try {
      bytes = await fs.readFile(file.absolutePath);
    } catch (error) {
      fail('ARTIFACT_FILE_UNREADABLE', `Could not read browser artifact file: ${file.relativePath}.`, error);
    }
    updateArtifactDigest(aggregateDigest, file.relativePath, bytes);
    files.push({
      relativePath: file.relativePath,
      byteLength: bytes.length,
      contentDigest: contentDigest(bytes),
      bytes,
    });
  }

  const manifest = {
    rootDirectory: resolvedRoot,
    artifactDigest: `sha256:${aggregateDigest.digest('hex')}`,
    files,
  };
  validateManifest(manifest);
  return manifest;
}

export async function assertBrowserArtifactOutputOutsideRoot({ rootDirectory, outputPath } = {}) {
  const lexicalRoot = path.resolve(rootDirectory || '.');
  const lexicalOutput = path.resolve(outputPath || '.');
  if (pathIsWithin(lexicalRoot, lexicalOutput)) {
    fail('ARTIFACT_OUTPUT_PATH_CONTAINED', 'Browser attestation output must be outside the hashed build directory.');
  }

  let realRoot;
  let resolvedOutput;
  try {
    realRoot = await fs.realpath(lexicalRoot);
    resolvedOutput = await resolveThroughExistingAncestor(lexicalOutput);
  } catch (error) {
    fail('ARTIFACT_OUTPUT_PATH_INVALID', 'Could not safely resolve the browser build and attestation output paths.', error);
  }
  if (pathIsWithin(realRoot, resolvedOutput)) {
    fail('ARTIFACT_OUTPUT_PATH_CONTAINED', 'Browser attestation output resolves inside the hashed build directory.');
  }
  return { buildRoot: realRoot, outputPath: resolvedOutput };
}

export function createBrowserArtifactResponseVerifier({ manifest, candidateUrl } = {}) {
  validateManifest(manifest);
  const root = candidateRootUrl(candidateUrl);
  const entriesByPath = new Map(manifest.files.map((entry) => [entry.relativePath, entry]));
  const verifiedResponseUrls = new Set();

  return ({ responseUrl, status, bytes = null } = {}) => {
    const { entry, url } = entryForBrowserResponseUrl({ entriesByPath, root, responseUrl });
    if (status === 304) {
      if (!verifiedResponseUrls.has(url.href)) {
        fail('BROWSER_ARTIFACT_RESPONSE_INVALID', `Chromium reused unverified cached bytes for ${entry.relativePath}.`);
      }
      return { relativePath: entry.relativePath, contentDigest: entry.contentDigest, notModified: true };
    }
    if (status !== 200 || !(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)) {
      fail('BROWSER_ARTIFACT_RESPONSE_INVALID', `Chromium did not receive an exact 200 artifact body for ${entry.relativePath}.`);
    }
    const receivedBytes = Buffer.from(bytes);
    const receivedDigest = contentDigest(receivedBytes);
    if (receivedBytes.length !== entry.byteLength
      || receivedDigest !== entry.contentDigest
      || !receivedBytes.equals(entry.bytes)) {
      fail('BROWSER_ARTIFACT_BYTES_MISMATCH', `Chromium received bytes that differ from the hashed candidate for ${entry.relativePath}.`);
    }
    verifiedResponseUrls.add(url.href);
    return { relativePath: entry.relativePath, contentDigest: receivedDigest, notModified: false };
  };
}

export async function verifyServedBrowserArtifactManifest({ manifest, candidateUrl, fetchImpl = globalThis.fetch } = {}) {
  const expectedPaths = validateManifest(manifest);
  if (typeof fetchImpl !== 'function') fail('ARTIFACT_FETCH_UNAVAILABLE', 'A fetch implementation is required to verify the browser artifact.');
  const root = candidateRootUrl(candidateUrl);
  const verifiedFiles = [];

  for (const entry of manifest.files) {
    const url = artifactFileUrl(root, entry.relativePath);
    verifiedFiles.push(await fetchExactArtifactBytes({
      fetchImpl,
      url,
      entry,
      label: `artifact file ${entry.relativePath}`,
    }));
  }

  const indexEntry = manifest.files.find((entry) => entry.relativePath === 'index.html');
  if (!indexEntry) fail('ARTIFACT_ENTRYPOINT_MISSING', 'The browser artifact manifest does not contain index.html.');
  await fetchExactArtifactBytes({
    fetchImpl,
    url: root,
    entry: indexEntry,
    label: 'browser candidate root entrypoint',
  });

  const verifiedPaths = verifiedFiles.map((entry) => entry.relativePath);
  if (verifiedFiles.length !== manifest.files.length
    || verifiedPaths.length !== expectedPaths.length
    || verifiedPaths.some((relativePath, index) => relativePath !== expectedPaths[index])) {
    fail('SERVED_ARTIFACT_FILE_SET_MISMATCH', 'The served browser artifact file set does not exactly match the hashed manifest.');
  }
  return {
    artifactDigest: manifest.artifactDigest,
    verifiedFileCount: verifiedFiles.length,
    verifiedPaths,
  };
}
