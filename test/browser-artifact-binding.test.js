import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  assertBrowserArtifactOutputOutsideRoot,
  buildBrowserArtifactManifest,
  createBrowserArtifactResponseVerifier,
  verifyServedBrowserArtifactManifest,
} from '../server/browser-artifact-binding.js';

async function artifactFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'likerts-browser-artifact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await mkdir(path.join(root, 'nested'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<!doctype html><main>candidate</main>\n');
  await writeFile(path.join(root, 'assets', 'app.js'), 'globalThis.__candidate = true;\n');
  await writeFile(path.join(root, 'nested', 'data.json'), '{"candidate":true}\n');
  await writeFile(path.join(root, 'sp ace.txt'), 'encoded path\n');
  return root;
}

function independentArtifactDigest(files) {
  const digest = createHash('sha256');
  for (const entry of files) {
    digest.update(`${Buffer.byteLength(entry.relativePath)}\0${entry.relativePath}\0${entry.bytes.length}\0`);
    digest.update(entry.bytes);
  }
  return `sha256:${digest.digest('hex')}`;
}

function artifactIdentityForLocale(rootDirectory, locale) {
  const moduleUrl = new URL('../server/browser-artifact-binding.js', import.meta.url).href;
  const script = `
    import { buildBrowserArtifactManifest } from ${JSON.stringify(moduleUrl)};
    const manifest = await buildBrowserArtifactManifest(process.argv[1]);
    process.stdout.write(JSON.stringify({
      artifactDigest: manifest.artifactDigest,
      relativePaths: manifest.files.map((entry) => entry.relativePath),
    }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script, rootDirectory], {
    encoding: 'utf8',
    env: { ...process.env, LANG: locale, LC_ALL: locale },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function startArtifactServer(t, manifest, responseForPath = () => null) {
  const entries = new Map(manifest.files.map((entry) => [entry.relativePath, entry]));
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    requests.push(url.pathname);
    const relativePath = url.pathname === '/candidate/'
      ? 'index.html'
      : url.pathname.startsWith('/candidate/')
        ? url.pathname.slice('/candidate/'.length).split('/').map(decodeURIComponent).join('/')
        : null;
    const entry = entries.get(relativePath);
    const override = responseForPath(relativePath, entry, url.pathname);
    if (override?.redirect) {
      response.writeHead(302, { location: override.redirect });
      response.end();
      return;
    }
    if (override?.status) {
      response.writeHead(override.status);
      response.end(override.body || '');
      return;
    }
    if (!entry) {
      response.writeHead(404);
      response.end('missing');
      return;
    }
    const body = override?.body === undefined ? entry.bytes : Buffer.from(override.body);
    if (relativePath === 'assets/app.js') {
      response.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/javascript' });
      response.end(gzipSync(body));
      return;
    }
    response.writeHead(200, { 'content-type': relativePath === 'index.html' ? 'text/html' : 'application/octet-stream' });
    response.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return {
    candidateUrl: `http://127.0.0.1:${address.port}/candidate/`,
    requests,
  };
}

test('artifact manifest enumerates every regular file and derives its digest from those exact bytes', async (t) => {
  const root = await artifactFixture(t);
  const manifest = await buildBrowserArtifactManifest(root);

  assert.deepEqual(manifest.files.map((entry) => entry.relativePath), [
    'assets/app.js',
    'index.html',
    'nested/data.json',
    'sp ace.txt',
  ]);
  assert.equal(manifest.artifactDigest, independentArtifactDigest(manifest.files));
  assert.ok(manifest.files.every((entry) => entry.byteLength === entry.bytes.length));
  assert.ok(manifest.files.every((entry) => /^sha256:[a-f0-9]{64}$/.test(entry.contentDigest)));

  const repeated = await buildBrowserArtifactManifest(root);
  assert.equal(repeated.artifactDigest, manifest.artifactDigest);
  assert.deepEqual(
    repeated.files.map(({ relativePath, byteLength, contentDigest }) => ({ relativePath, byteLength, contentDigest })),
    manifest.files.map(({ relativePath, byteLength, contentDigest }) => ({ relativePath, byteLength, contentDigest })),
  );

  await writeFile(path.join(root, 'extra.txt'), 'late extra file\n');
  const changed = await buildBrowserArtifactManifest(root);
  assert.notEqual(changed.artifactDigest, manifest.artifactDigest);
  assert.equal(changed.files.some((entry) => entry.relativePath === 'extra.txt'), true);
});

test('artifact identity uses one canonical Unicode path order across process locales', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'likerts-browser-artifact-unicode-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'z.js'), 'ascii path\n');
  await writeFile(path.join(root, 'ä.js'), 'unicode path\n');

  const english = artifactIdentityForLocale(root, 'en_US.UTF-8');
  const swedish = artifactIdentityForLocale(root, 'sv_SE.UTF-8');

  assert.deepEqual(english, swedish);
  assert.deepEqual(english.relativePaths, ['z.js', 'ä.js']);
});

test('served artifact verification fetches every explicit path plus the root alias and compares decompressed bytes', async (t) => {
  const root = await artifactFixture(t);
  const manifest = await buildBrowserArtifactManifest(root);
  const server = await startArtifactServer(t, manifest);

  const verification = await verifyServedBrowserArtifactManifest({
    manifest,
    candidateUrl: server.candidateUrl,
  });

  assert.equal(verification.artifactDigest, manifest.artifactDigest);
  assert.equal(verification.verifiedFileCount, manifest.files.length);
  assert.deepEqual(verification.verifiedPaths, manifest.files.map((entry) => entry.relativePath));
  assert.deepEqual(server.requests, [
    '/candidate/assets/app.js',
    '/candidate/index.html',
    '/candidate/nested/data.json',
    '/candidate/sp%20ace.txt',
    '/candidate/',
  ]);
});

test('served artifact verification rejects missing, altered, fallback, redirected, and wrong-root responses', async (t) => {
  const root = await artifactFixture(t);
  const manifest = await buildBrowserArtifactManifest(root);
  const indexBytes = manifest.files.find((entry) => entry.relativePath === 'index.html').bytes;
  const cases = [
    {
      label: 'missing file',
      override: (relativePath) => relativePath === 'nested/data.json' ? { status: 404 } : null,
      code: 'ARTIFACT_RESPONSE_INVALID',
    },
    {
      label: 'altered bytes',
      override: (relativePath) => relativePath === 'nested/data.json' ? { body: 'changed' } : null,
      code: 'SERVED_ARTIFACT_MISMATCH',
    },
    {
      label: 'SPA fallback bytes',
      override: (relativePath) => relativePath === 'nested/data.json' ? { body: indexBytes } : null,
      code: 'SERVED_ARTIFACT_MISMATCH',
    },
    {
      label: 'redirected file',
      override: (relativePath) => relativePath === 'nested/data.json' ? { redirect: '/candidate/index.html' } : null,
      code: 'ARTIFACT_RESPONSE_INVALID',
    },
    {
      label: 'wrong root alias',
      override: (_relativePath, _entry, pathname) => pathname === '/candidate/' ? { body: 'wrong root' } : null,
      code: 'SERVED_ARTIFACT_MISMATCH',
    },
  ];

  for (const { label, override, code } of cases) {
    const server = await startArtifactServer(t, manifest, override);
    await assert.rejects(
      verifyServedBrowserArtifactManifest({ manifest, candidateUrl: server.candidateUrl }),
      (error) => error?.code === code,
      label,
    );
  }
});

test('artifact binding rejects unsafe candidate roots, duplicate manifests, and non-regular build entries', async (t) => {
  const root = await artifactFixture(t);
  const manifest = await buildBrowserArtifactManifest(root);
  await assert.rejects(
    verifyServedBrowserArtifactManifest({ manifest, candidateUrl: 'http://127.0.0.1:4173/candidate' }),
    (error) => error?.code === 'CANDIDATE_URL_INVALID',
  );

  const duplicatedManifest = {
    ...manifest,
    files: [...manifest.files, { ...manifest.files[0], bytes: Buffer.from(manifest.files[0].bytes) }],
  };
  await assert.rejects(
    verifyServedBrowserArtifactManifest({ manifest: duplicatedManifest, candidateUrl: 'http://127.0.0.1:4173/' }),
    (error) => error?.code === 'ARTIFACT_FILE_SET_INVALID',
  );

  await symlink(path.join(root, 'index.html'), path.join(root, 'linked-index.html'));
  await assert.rejects(
    buildBrowserArtifactManifest(root),
    (error) => error?.code === 'ARTIFACT_ENTRY_UNSUPPORTED',
  );
});

test('Chromium response verification rejects varying and unmanifested same-origin bytes', async (t) => {
  const root = await artifactFixture(t);
  const manifest = await buildBrowserArtifactManifest(root);
  const candidateUrl = 'http://127.0.0.1:4173/candidate/';
  const indexEntry = manifest.files.find((entry) => entry.relativePath === 'index.html');
  const scriptEntry = manifest.files.find((entry) => entry.relativePath === 'assets/app.js');
  const verifyResponse = createBrowserArtifactResponseVerifier({ manifest, candidateUrl });

  assert.deepEqual(verifyResponse({
    responseUrl: `${candidateUrl}?sample=registered-sample`,
    status: 200,
    bytes: indexEntry.bytes,
  }), {
    relativePath: 'index.html',
    contentDigest: indexEntry.contentDigest,
    notModified: false,
  });
  assert.equal(verifyResponse({
    responseUrl: `${candidateUrl}assets/app.js`,
    status: 200,
    bytes: scriptEntry.bytes,
  }).relativePath, 'assets/app.js');
  assert.equal(verifyResponse({
    responseUrl: `${candidateUrl}assets/app.js`,
    status: 304,
  }).notModified, true);

  assert.throws(
    () => verifyResponse({ responseUrl: `${candidateUrl}nested/data.json`, status: 200, bytes: Buffer.from('user-agent variant') }),
    (error) => error?.code === 'BROWSER_ARTIFACT_BYTES_MISMATCH',
  );
  assert.throws(
    () => verifyResponse({ responseUrl: `${candidateUrl}assets/unmanifested.js`, status: 200, bytes: Buffer.from('extra') }),
    (error) => error?.code === 'BROWSER_ARTIFACT_NOT_MANIFESTED',
  );
  assert.throws(
    () => verifyResponse({ responseUrl: 'http://127.0.0.1:4173/assets/app.js', status: 200, bytes: scriptEntry.bytes }),
    (error) => error?.code === 'BROWSER_ARTIFACT_NOT_MANIFESTED',
  );
  assert.throws(
    () => createBrowserArtifactResponseVerifier({ manifest, candidateUrl })({
      responseUrl: `${candidateUrl}assets/app.js`,
      status: 304,
    }),
    (error) => error?.code === 'BROWSER_ARTIFACT_RESPONSE_INVALID',
  );
});

test('attestation output must remain outside the build root through lexical and symlink paths', async (t) => {
  const root = await artifactFixture(t);
  const outsideOutput = path.join(path.dirname(root), `${path.basename(root)}-evidence`, 'attestation.json');
  await assert.doesNotReject(assertBrowserArtifactOutputOutsideRoot({ rootDirectory: root, outputPath: outsideOutput }));

  for (const outputPath of [root, path.join(root, 'attestation.json'), path.join(root, 'nested', 'attestation.json')]) {
    await assert.rejects(
      assertBrowserArtifactOutputOutsideRoot({ rootDirectory: root, outputPath }),
      (error) => error?.code === 'ARTIFACT_OUTPUT_PATH_CONTAINED',
    );
  }

  const alias = `${root}-alias`;
  await symlink(root, alias, 'dir');
  t.after(() => rm(alias, { force: true }));
  await assert.rejects(
    assertBrowserArtifactOutputOutsideRoot({ rootDirectory: root, outputPath: path.join(alias, 'attestation.json') }),
    (error) => error?.code === 'ARTIFACT_OUTPUT_PATH_CONTAINED',
  );
});

test('final containment recheck catches an output ancestor swapped into the build after preflight', async (t) => {
  const root = await artifactFixture(t);
  const swappedParent = `${root}-swapped-evidence`;
  const swappedOutput = path.join(swappedParent, 'attestation.json');
  await assert.doesNotReject(assertBrowserArtifactOutputOutsideRoot({ rootDirectory: root, outputPath: swappedOutput }));
  await symlink(root, swappedParent, 'dir');
  t.after(() => rm(swappedParent, { force: true }));
  await assert.rejects(
    assertBrowserArtifactOutputOutsideRoot({ rootDirectory: root, outputPath: swappedOutput }),
    (error) => error?.code === 'ARTIFACT_OUTPUT_PATH_CONTAINED',
  );
});
