import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, readFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const expectedKinds = new Set([
  'npm-web',
  'npm-react-native',
  'swift-package-source',
  'android-maven-repository',
  'flutter-source-package',
]);
const expectedTargets = new Set(['web', 'react-native', 'ios', 'android', 'flutter']);
const expectedFleetTargets = new Set(['web', 'react_native', 'ios', 'android', 'flutter']);

function parseChecksums(source) {
  const checksums = new Map();
  for (const line of source.split('\n')) {
    if (!line.trim()) continue;
    const match = /^([a-f0-9]{64})  ([^/]+)$/.exec(line);
    assert.ok(match, `Invalid SHA256SUMS line: ${line}`);
    assert.equal(checksums.has(match[2]), false, `Duplicate SHA256SUMS entry: ${match[2]}`);
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function verifySdkRelease(root) {
  const version = (await readFile(join(root, 'sdks/RELEASE-VERSION'), 'utf8')).trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const releaseDir = join(root, 'releases', version);
  const publicDir = join(root, 'control-plane/public/downloads');
  const manifest = JSON.parse(await readFile(join(releaseDir, 'manifest.json'), 'utf8'));
  const compatibility = JSON.parse(await readFile(join(root, 'contracts/sdk-compatibility.json'), 'utf8'));
  const publicChecksums = parseChecksums(await readFile(join(publicDir, 'SHA256SUMS'), 'utf8'));

  assert.equal(manifest.version, version, 'Release manifest version must match RELEASE-VERSION');
  assert.equal(manifest.published, false, 'Registry publication must remain separately evidenced');
  assert.equal(manifest.artifacts.length, expectedKinds.size, 'Release must contain exactly five SDK artifacts');
  assert.deepEqual(new Set(manifest.artifacts.map(({kind}) => kind)), expectedKinds);
  assert.equal(manifest.checks.length, expectedTargets.size, 'Release must contain five install checks');
  assert.deepEqual(new Set(manifest.checks.map(({target}) => target)), expectedTargets);
  assert.ok(manifest.checks.every(({passed}) => passed === true), 'Every SDK install check must pass');

  const installations = compatibility.currentFleet.installations;
  assert.equal(installations.length, expectedTargets.size, 'Compatibility fleet must declare five SDK targets');
  assert.deepEqual(new Set(installations.map(({target}) => target)), expectedFleetTargets);
  assert.ok(installations.every(item => item.sdkVersion === version));
  assert.ok(installations.every(item => JSON.stringify(item.schemaVersions) === JSON.stringify(manifest.schemaVersions)));

  for (const artifact of manifest.artifacts) {
    assert.equal(artifact.file, basename(artifact.file), `Artifact must stay at release root: ${artifact.file}`);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    const releasePath = join(releaseDir, artifact.file);
    const publicPath = join(publicDir, artifact.file);
    const releaseStat = await lstat(releasePath);
    const publicStat = await lstat(publicPath);
    assert.ok(releaseStat.isFile() && publicStat.isFile(), `${artifact.file} must be a regular file`);
    assert.equal(releaseStat.size, artifact.bytes, `${artifact.file} byte count differs from manifest`);
    assert.equal(publicStat.size, artifact.bytes, `${artifact.file} public mirror byte count differs from manifest`);
    assert.equal(await sha256(releasePath), artifact.sha256, `${artifact.file} release checksum differs`);
    assert.equal(await sha256(publicPath), artifact.sha256, `${artifact.file} public mirror checksum differs`);
    assert.equal(publicChecksums.get(artifact.file), artifact.sha256, `${artifact.file} SHA256SUMS entry differs`);
  }

  return {version, artifacts: manifest.artifacts.length, checks: manifest.checks.length};
}

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await verifySdkRelease(root);
  console.log(`SDK ${result.version} immutable release verified: ${result.artifacts} artifacts, ${result.checks} install checks, public mirrors exact.`);
}
