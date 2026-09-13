import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const [repository, staging, buildImage] = process.argv.slice(2);
if (!repository || !staging || !buildImage) throw new Error('Expected repository, staged source and build image');
const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
const hash = createHash('sha256');
async function add(folder) {
  for (const entry of (await readdir(join(staging, folder), { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
    const relative = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await add(relative);
    else if (entry.isFile()) { hash.update(relative + '\0'); hash.update(await readFile(join(staging, relative))); hash.update('\0'); }
    else throw new Error('Unexpected staged source type');
  }
}
await add('');
await writeFile(resolve(staging,'source.json'),JSON.stringify({sourceCommit:git(['rev-parse','HEAD']),sourceDirty:git(['status','--porcelain','--untracked-files=all','--','backend','infrastructure/maintenance']).length!==0,backendSourceSha256:hash.digest('hex'),buildImage})+'\n');
