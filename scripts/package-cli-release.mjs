import { readFile, writeFile, mkdir, cp, mkdtemp, rm, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = await readFile(join(root, 'tools/cli/Cargo.toml'), 'utf8');
const version = manifest.match(/^version = "([0-9.]+)"$/m)?.[1];
assert.ok(version, 'CLI version missing');
const output = join(root, 'releases/cli', version);
await mkdir(output, { recursive: true });
const prior = await readFile(join(output, 'manifest.json'), 'utf8').catch(() => null);
assert.equal(prior, null, 'Successful CLI releases are immutable; increment the version');
const work = await mkdtemp(join(tmpdir(), 'likerts-cli-release-'));
const command = async (name, args, cwd = root) => (await exec(name, args, { cwd, maxBuffer: 1024 * 1024 * 4 })).stdout;
try {
  await command('cargo', ['build', '--release', '--locked', '--manifest-path', 'tools/cli/Cargo.toml']);
  const source = join(work, 'source'); await mkdir(join(source, 'tools/cli'), { recursive: true });
  for (const item of ['Cargo.toml', 'Cargo.lock', 'src']) await cp(join(root, 'tools/cli', item), join(source, 'tools/cli', item), { recursive: true });
  await cp(join(root, 'tools/capabilities.json'), join(source, 'tools/capabilities.json'));
  await writeFile(join(source, 'README.md'), `# Likerts CLI ${version}\n\nInstall with Cargo: \`cargo install --locked --path tools/cli\`.\n\nSet \`LIKERTS_API_URL=https://likerts-api.onrender.com\` and supply a scoped \`LIKERTS_TOKEN\` from your secret manager. Then run \`likerts call usage_get\`. Assisted preview requires an invitation.\n\nFull setup, API/CLI examples and agent configuration: https://likerts.com/docs/\n\nKeep management credentials out of browser/mobile applications and model tool arguments.\n`);
  await writeFile(join(source, 'INSTALL.txt'), `Likerts CLI ${version}\nInstall: cargo install --locked --path tools/cli\nDocs: https://likerts.com/docs/\nSet LIKERTS_API_URL=https://likerts-api.onrender.com\nSupply LIKERTS_TOKEN from your secret manager, then run: likerts call usage_get\nNever put management credentials in browser/mobile applications.\n`);
  const sourceName = `likerts-cli-source-${version}.tar.gz`;
  await command('tar', ['-czf', join(output, sourceName), '-C', source, 'tools', 'README.md', 'INSTALL.txt']);
  const host = (await command('rustc', ['-vV'])).match(/^host: (.+)$/m)?.[1];
  assert.match(host, /^[a-z0-9_-]+$/);
  const binary = join(root, 'tools/cli/target/release/likerts');
  assert.equal((await command(binary, ['--version'])).trim(), `likerts ${version}`);
  const registry = JSON.parse(await readFile(join(root, 'tools/capabilities.json'), 'utf8'));
  const capabilityLines = (await command(binary, ['capabilities'])).trim().split('\n');
  assert.deepEqual(capabilityLines.map(line => line.split('\t')[0]), registry.map(item => item.name));
  const native = join(work, 'native'); await mkdir(native);
  await cp(binary, join(native, 'likerts')); await chmod(join(native, 'likerts'), 0o755);
  await writeFile(join(native, 'INSTALL.txt'), `Likerts CLI ${version} for ${host}\nThis standalone binary is not notarized and has no automatic updater.\nVerify SHA256SUMS before extracting. Put likerts on your PATH.\nIf your organization requires signed software, use the checksummed Cargo source instead.\nDocumentation: https://likerts.com/docs/\n`);
  const binaryName = `likerts-cli-${version}-${host}.tar.gz`;
  await command('tar', ['-czf', join(output, binaryName), '-C', native, 'likerts', 'INSTALL.txt']);
  const extracted = join(work, 'extracted'); await mkdir(extracted);
  await command('tar', ['-xzf', join(output, binaryName), '-C', extracted]);
  assert.equal((await command(join(extracted, 'likerts'), ['capabilities'])).trim().split('\n').length, registry.length);
  const artifacts = [];
  for (const file of [sourceName, binaryName]) {
    const bytes = await readFile(join(output, file));
    artifacts.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    await cp(join(output, file), join(root, 'control-plane/public/downloads', file));
  }
  const checksums = join(root, 'control-plane/public/downloads/SHA256SUMS');
  const previous = await readFile(checksums, 'utf8');
  assert.ok(artifacts.every(a => !previous.includes(a.file)), 'Cannot replace an already published archive');
  await writeFile(checksums, previous.trimEnd() + '\n' + artifacts.map(a => `${a.sha256}  ${a.file}`).join('\n') + '\n');
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ version, measuredAt: new Date().toISOString(), host, capabilities: registry.length, artifacts,
    verification: ['Release compilation with locked dependencies', 'Native --version and exact operation-registry parity', 'Fresh native archive extraction and execution'],
    limitations: ['Only the named native target was built and executed.', 'Native binary is not notarized; no automatic updater.', 'Source archive includes installation instructions; public registry publication is separate.'] }, null, 2) + '\n');
  console.log(`CLI ${version}: source and ${host} archive verified with ${registry.length} operations.`);
} finally { await rm(work, { recursive: true, force: true }); }
