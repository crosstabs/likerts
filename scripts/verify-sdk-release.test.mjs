import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {verifySdkRelease} from './verify-sdk-release.mjs';

const targets = ['web', 'react-native', 'ios', 'android', 'flutter'];
const fleetTargets = ['web', 'react_native', 'ios', 'android', 'flutter'];
const kinds = ['npm-web', 'npm-react-native', 'swift-package-source', 'android-maven-repository', 'flutter-source-package'];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'likerts-release-verify-'));
  const releaseDir = join(root, 'releases/1.2.3');
  const publicDir = join(root, 'control-plane/public/downloads');
  await mkdir(join(root, 'sdks'), {recursive: true});
  await mkdir(join(root, 'contracts'), {recursive: true});
  await mkdir(releaseDir, {recursive: true});
  await mkdir(publicDir, {recursive: true});
  await writeFile(join(root, 'sdks/RELEASE-VERSION'), '1.2.3\n');
  const artifacts = [];
  const sums = [];
  for (let index = 0; index < targets.length; index += 1) {
    const file = `${targets[index]}.tgz`;
    const bytes = Buffer.from(`artifact-${index}`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(releaseDir, file), bytes);
    await writeFile(join(publicDir, file), bytes);
    artifacts.push({file, kind: kinds[index], bytes: bytes.length, sha256: digest});
    sums.push(`${digest}  ${file}`);
  }
  const checks = targets.map(target => ({target, passed: true, verification: 'fixture'}));
  await writeFile(join(releaseDir, 'manifest.json'), `${JSON.stringify({version: '1.2.3', schemaVersions: [1], published: false, artifacts, checks})}\n`);
  await writeFile(join(publicDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  await writeFile(join(root, 'contracts/sdk-compatibility.json'), `${JSON.stringify({currentFleet: {installations: fleetTargets.map(target => ({target, sdkVersion: '1.2.3', schemaVersions: [1]}))}})}\n`);
  return {root, publicDir};
}

test('verifies immutable release artifacts and their public mirrors', async () => {
  const {root} = await fixture();
  assert.deepEqual(await verifySdkRelease(root), {version: '1.2.3', artifacts: 5, checks: 5});
});

test('rejects a changed public artifact', async () => {
  const {root, publicDir} = await fixture();
  await writeFile(join(publicDir, 'web.tgz'), 'changed');
  await assert.rejects(() => verifySdkRelease(root), /public mirror byte count differs/);
});
