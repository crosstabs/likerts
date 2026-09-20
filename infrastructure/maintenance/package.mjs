import { readFile, writeFile, mkdir, copyFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../..');
const [input, platform] = process.argv.slice(2);
if (!input || !['linux/arm64', 'linux/amd64'].includes(platform)) throw new Error('Expected binary directory and linux/arm64 or linux/amd64');
const arch = platform === 'linux/arm64' ? 'arm64' : 'x64';
const machine = arch === 'arm64' ? 183 : 62;
const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
const source = JSON.parse(await readFile(join(input, 'source.json'), 'utf8'));
const sourceCommit = source.sourceCommit;
if (sourceCommit !== git(['rev-parse', 'HEAD'])) throw new Error('Repository HEAD changed during build; rebuild from one reviewed commit');
const sourceDirty = source.sourceDirty || git(['status', '--porcelain', '--untracked-files=all', '--', 'backend', 'infrastructure/maintenance']).length !== 0;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
for (const kind of ['cleanup', 'archive']) {
  const name = kind === 'cleanup' ? 'likerts-export-cleanup' : 'likerts-erasure-archive';
  const bytes = await readFile(join(input, name));
  if (bytes.subarray(0, 4).toString('hex') !== '7f454c46' || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== machine) throw new Error('Binary architecture mismatch');
  // Reject an ELF interpreter even when someone invokes package.mjs directly.
  const offset = Number(bytes.readBigUInt64LE(32)), size = bytes.readUInt16LE(54), count = bytes.readUInt16LE(56);
  for (let index = 0; index < count; index++) if (bytes.readUInt32LE(offset + index * size) === 3) throw new Error('Dynamic ELF is unsupported');
  const project = resolve(input, 'projects', kind);
  const output = join(project, '.vercel/output');
  const functionDir = join(output, 'functions/api/run.func');
  await mkdir(functionDir, { recursive: true });
  await copyFile(join(input, name), join(functionDir, 'worker'));
  await chmod(join(functionDir, 'worker'), 0o755);
  await copyFile(join(input, 'ca-certificates.crt'), join(functionDir, 'ca-certificates.crt'));
  await copyFile(join(here, 'handler.mjs'), join(functionDir, 'handler.mjs'));
  await copyFile(join(here, kind, 'index.mjs'), join(functionDir, 'index.mjs'));
  await writeJson(join(functionDir, 'manifest.json'), { ...source, kind, arch, sourceCommit, sourceDirty, sha256: digest(bytes) });
  await writeJson(join(functionDir, '.vc-config.json'), { runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: true, architecture: arch === 'arm64' ? 'arm64' : 'x86_64', maxDuration: 240, regions: ['sin1'] });
  await writeJson(join(output, 'config.json'), { version: 3, routes: [
    { src: '/api/run', dest: '/api/run' },
    { src: '/api/status', dest: '/api/run?likerts_action=status' },
    { src: '/.*', status: 404 },
  ], crons: [{ path: '/api/run', schedule: kind === 'cleanup' ? '7,22,37,52 * * * *' : '11,26,41,56 * * * *' }] });
  await writeJson(join(project, 'vercel.json'), { version: 2, framework: null });
  console.log(JSON.stringify({ kind, arch, sourceCommit, sourceDirty, binarySha256: digest(bytes), project }));
}
