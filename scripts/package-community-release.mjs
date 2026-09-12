import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const command = async (name, args, cwd = root, env = process.env) => (await exec(name, args, { cwd, env, maxBuffer: 8 * 1024 * 1024, timeout: 180000 })).stdout;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const packages = { 'sdks/web': 'web', 'sdks/react-native': 'react-native', 'tools/mcp': 'mcp' };
const targets = ['linux-x64', 'darwin-arm64', 'windows-x64'];

export function validateTag(tag) {
  assert.match(tag, /^community-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Use a community-vX.Y.Z tag');
  return tag;
}

export function validateEntry(name, prefix = '') {
  assert.ok(typeof name === 'string' && name.length > 0 && !/[\x00-\x1f\x7f]/.test(name) && !name.includes('\\') && !name.startsWith('/') && !/^[A-Za-z]:/.test(name), 'Unsafe archive path');
  const parts = name.replace(/\/$/, '').split('/');
  assert.ok(parts.every(part => part && part !== '.' && part !== '..'), 'Unsafe archive path');
  if (prefix) assert.ok(name.startsWith(`${prefix}/`), 'Unexpected archive root');
  assert.ok(!parts.some(part => /^(?:\.git|\.env(?:\..*)?|\.npmrc|\.validation-private|node_modules|test-results|credentials?(?:\..*)?)$/i.test(part)), 'Private or dependency path in archive');
  assert.ok(!/\.(?:pem|key|p12|pfx)$/i.test(name), 'Private-key file in archive');
}

export function scanText(value, name) {
  assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b|\bsk_live_[A-Za-z0-9]{20,}\b/.test(value), `Credential pattern in ${name}`);
}

export function assertCliOutput(versionOutput, capabilitiesOutput, version, registry) {
  assert.equal(versionOutput.trim(), `likerts ${version}`, 'CLI version differs from Cargo.toml');
  assert.deepEqual(capabilitiesOutput.trim().split(/\r?\n/), registry.map(c => `${c.name}\t${c.method} ${c.path}\t${c.description}`), 'Packaged CLI registry differs from source');
}

async function inspectTar(archive, directory, { npm = false } = {}) {
  const entries = (await command('tar', ['-tzf', archive])).trim().split(/\r?\n/);
  for (const entry of entries) validateEntry(entry, npm ? 'package' : '');
  const verbose = (await command('tar', ['-tvzf', archive])).trim().split(/\r?\n/);
  assert.ok(verbose.every(line => /^[-d]/.test(line)), 'Links or special files are not permitted in release archives');
  await mkdir(directory, { recursive: true });
  await command('tar', ['-xzf', archive, '-C', directory]);
  const license = npm ? 'package/LICENSE' : 'LICENSE';
  assert.ok(entries.includes(license), 'Archive must contain LICENSE');
  assert.equal(await readFile(join(directory, license), 'utf8'), await readFile(join(root, 'LICENSE'), 'utf8'), 'Archive license differs from repository MIT license');
  for (const entry of entries.filter(value => !value.endsWith('/'))) {
    if (npm || /\.(?:txt|json|md)$/.test(entry) || entry === 'LICENSE') scanText(await readFile(join(directory, entry), 'utf8'), entry);
  }
  return entries;
}

async function record(artifact, tag, output, details = {}) {
  validateTag(tag);
  const file = basename(artifact);
  validateEntry(file);
  assert.ok(file.startsWith(`${tag}-`), 'Asset must identify its community release tag');
  const bytes = await readFile(artifact);
  const commit = (await command('git', ['rev-parse', 'HEAD'])).trim();
  const sourceDirty = Boolean((await command('git', ['status', '--porcelain', '--untracked-files=normal'])).trim());
  const metadata = { tag, commit, sourceDirty, file, bytes: bytes.length, sha256: digest(bytes), ...details };
  await writeFile(join(output, `${file}.manifest.json`), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
  return metadata;
}

export async function catalog(output, tag, commit) {
  validateTag(tag);
  assert.match(commit, /^[0-9a-f]{40}$/, 'Exact commit SHA required');
  const manifests = (await readdir(output)).filter(file => file.endsWith('.manifest.json')).sort();
  const entries = [];
  for (const manifest of manifests) {
    const item = JSON.parse(await readFile(join(output, manifest), 'utf8'));
    validateEntry(item.file);
    assert.equal(basename(item.file), item.file, 'Assets must be direct children');
    assert.equal(item.tag, tag, 'Mixed release tags');
    assert.equal(item.commit, commit, 'Mixed source commits');
    assert.equal(item.sourceDirty, false, 'Release artifacts must originate from a clean checkout');
    const bytes = await readFile(join(output, item.file));
    assert.equal(bytes.length, item.bytes, 'Artifact size mismatch');
    assert.equal(digest(bytes), item.sha256, 'Artifact checksum mismatch');
    entries.push(item);
  }
  const expected = [...targets.map(target => `${tag}-cli-${target}.tar.gz`), ...Object.values(packages).map(name => `${tag}-${name}.tgz`), `${tag}-runtime-linux-x64.tar.gz`].sort();
  assert.deepEqual(entries.map(item => item.file).sort(), expected, 'Release requires all three CLI targets, all three npm packages, and the runtime image');
  await writeFile(join(output, 'SHA256SUMS'), entries.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
  await writeFile(join(output, 'release-manifest.json'), JSON.stringify({ tag, commit, artifacts: entries }, null, 2) + '\n');
  return entries;
}

async function packageCli(options, output, work) {
  assert.ok(targets.includes(options.target), 'Unsupported CLI target');
  const native = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  assert.equal(options.target, native, 'CLI must be built and executed on its stated native target');
  const binary = resolve(options.binary);
  const manifest = await readFile(join(root, 'tools/cli/Cargo.toml'), 'utf8');
  const version = manifest.match(/^version = "([0-9.]+)"$/m)?.[1];
  assert.ok(version, 'CLI version is missing');
  const registry = JSON.parse(await readFile(join(root, 'tools/capabilities.json'), 'utf8'));
  const check = async path => assertCliOutput(await command(path, ['--version']), await command(path, ['capabilities']), version, registry);
  await check(binary);
  const staging = join(work, 'cli');
  await mkdir(staging);
  const executable = process.platform === 'win32' ? 'likerts.exe' : 'likerts';
  await cp(binary, join(staging, executable));
  await cp(join(root, 'LICENSE'), join(staging, 'LICENSE'));
  await writeFile(join(staging, 'INSTALL.txt'), `Likerts ${options.tag}\nCLI package version: ${version}\nTarget: ${options.target}\n\nVerify this archive with SHA256SUMS, extract it, and put ${executable} on PATH.\nRun: likerts --version\nRun: likerts capabilities\nSetup: https://likerts.com/docs#agents\n\nNative binaries are unsigned and not notarized. Linux builds require glibc 2.35 or newer.\nThis community release tag identifies source independently of the CLI package version.\n`);
  const artifact = join(output, `${options.tag}-cli-${options.target}.tar.gz`);
  await assertAbsent(artifact);
  await command('tar', ['-czf', artifact, '-C', staging, executable, 'LICENSE', 'INSTALL.txt']);
  const extracted = join(work, 'extracted');
  const entries = await inspectTar(artifact, extracted);
  assert.deepEqual(entries.sort(), [executable, 'LICENSE', 'INSTALL.txt'].sort());
  await check(join(extracted, executable));
  return record(artifact, options.tag, output, { kind: 'cli', target: options.target, packageVersion: version, capabilities: registry.length, verification: ['native version and full registry parity', 'extracted executable version and full registry parity', 'allowlisted archive contents and exact MIT license'] });
}

async function packageNpm(options, output, work) {
  const name = packages[options.package];
  assert.ok(name, 'Unsupported npm package');
  const directory = join(root, options.package);
  const original = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const packed = JSON.parse(await command('npm', ['pack', '--json', '--pack-destination', work], directory));
  assert.equal(packed.length, 1);
  validateEntry(packed[0].filename);
  const artifact = join(output, `${options.tag}-${name}.tgz`);
  await assertAbsent(artifact);
  await rename(join(work, packed[0].filename), artifact);
  const extracted = join(work, 'extracted');
  await inspectTar(artifact, extracted, { npm: true });
  const installed = JSON.parse(await readFile(join(extracted, 'package/package.json'), 'utf8'));
  assert.equal(installed.name, original.name);
  assert.equal(installed.version, original.version);
  const consumer = join(work, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  await command('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', artifact], consumer);
  const packageRoot = join(consumer, 'node_modules', original.name);
  if (name === 'web') {
    const api = await import(pathToFileURL(join(packageRoot, 'dist/index.js')).href);
    assert.equal(typeof api.LikertsClient, 'function');
    assert.equal(typeof api.mountSurvey, 'function');
    assert.deepEqual([...api.LIKERTS_SDK_CAPABILITY.schemaVersions], [1, 2, 3, 4, 5]);
  } else if (name === 'react-native') {
    // Native rendering requires a host runtime; verify the installed Metro and type entry points.
    for (const path of [installed['react-native'], installed.types, installed.main, 'lib/offline.d.ts', 'src/offline.ts']) {
      validateEntry(path);
      assert.ok((await stat(join(packageRoot, path))).isFile(), `Missing installed RN entry: ${path}`);
    }
  } else {
    const require = createRequire(join(consumer, 'package.json'));
    const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
    const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(packageRoot, 'dist/main.js')], env: { PATH: process.env.PATH ?? '', LIKERTS_API_URL: 'http://127.0.0.1:8080' }, stderr: 'pipe' });
    const client = new Client({ name: 'community-package-check', version: '1.0.0' });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const registry = JSON.parse(await readFile(join(root, 'tools/capabilities.json'), 'utf8'));
      assert.deepEqual(tools.tools.map(tool => tool.name), registry.map(tool => tool.name));
    } finally { await client.close(); }
  }
  return record(artifact, options.tag, output, { kind: 'npm', package: original.name, packageVersion: original.version, verification: ['archive path and credential-pattern checks', 'exact MIT license', 'fresh consumer installation without lifecycle scripts', name === 'mcp' ? 'installed MCP stdio discovery and exact tool parity' : name === 'web' ? 'installed public Web exports and schema capability' : 'installed Metro, JavaScript and TypeScript entry points (native host rendering checked separately)'] });
}

async function assertAbsent(path) {
  assert.equal(await stat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), false, 'Refusing to overwrite an existing release asset');
}

async function main() {
  const args = process.argv.slice(2);
  assert.equal(args.length % 2, 0, 'Expected --option value pairs');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(['--kind', '--tag', '--target', '--binary', '--package', '--output', '--asset', '--commit'].includes(args[i]), 'Unknown option');
    assert.equal(options[args[i].slice(2)], undefined, 'Duplicate option');
    options[args[i].slice(2)] = args[i + 1];
  }
  validateTag(options.tag);
  const output = resolve(options.output ?? join(root, '.tools/community-release', options.tag));
  const inside = relative(root, output);
  if (!isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`)) {
    assert.ok(inside, 'Do not write release assets at the repository root');
    await command('git', ['check-ignore', '--quiet', output]);
  }
  await mkdir(output, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'likerts-community-package-'));
  try {
    let result;
    if (options.kind === 'cli') result = await packageCli(options, output, work);
    else if (options.kind === 'npm') result = await packageNpm(options, output, work);
    else if (options.kind === 'record') result = await record(resolve(options.asset), options.tag, output, { kind: 'runtime', verification: ['Built and smoke-tested by the staging workflow; see workflow run for runtime evidence'] });
    else if (options.kind === 'catalog') result = await catalog(output, options.tag, options.commit);
    else throw new Error('Expected --kind cli, npm, record, or catalog');
    console.log(JSON.stringify(result, null, 2));
  } finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
