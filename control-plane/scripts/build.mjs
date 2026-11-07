import { cp, mkdir, rm, readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));
const play = config.redirects.find(route => route.source === '/play/:path*');
if (!play || !/^https:\/\/[a-z0-9-]+\.onrender\.com\/play\/:path\*$/.test(play.destination) || /pending|placeholder|replace/i.test(play.destination)) {
  throw new Error('Configure the assigned Render game origin before publishing this site');
}
await rm(new URL('dist/', root), {recursive:true,force:true});
await mkdir(new URL('dist/', root), {recursive:true});
await cp(new URL('public/', root), new URL('dist/', root), {recursive:true});
console.log('game-only marketing site built; live game redirect target validated');
