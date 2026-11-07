import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const topics = JSON.parse(await readFile(new URL('shared/topics.json', root), 'utf8'));
const rounds = [];
const ids = new Set(), statements = new Set();
const relations = new Set(['inspect','offer','balance','stack','hide','share','choose','carry','orbit','build']);
for (const [ordinal, topic] of topics.entries()) {
  const items = JSON.parse(await readFile(new URL(`shared/TopicData/${topic.id}.json`, root), 'utf8'));
  if (items.length !== 50) throw new Error(`Wrong catalogue count for ${topic.id}`);
  for (const r of items) {
    const normalized = r.text.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '');
    if (!Number.isInteger(r.id) || r.id < 1001 + ordinal * 50 || r.id >= 1051 + ordinal * 50 || ids.has(r.id)
      || r.topic !== topic.id || !r.text.trim() || r.text.length > 220 || statements.has(normalized)
      || !topic.props.includes(r.scene.primary) || !topic.props.includes(r.scene.secondary)
      || !relations.has(r.scene.relation) || !r.sceneSummary.trim()) throw new Error(`Invalid catalogue row ${r.id}`);
    ids.add(r.id); statements.add(normalized); rounds.push(r);
  }
}
rounds.sort((a,b) => a.id-b.id);
if (topics.length !== 20 || rounds.length !== 1000) throw new Error('Incomplete catalogue');
const data = { version:1, locale:'en', topics:topics.map(({id,title})=>({id,title})), rounds };
const sha256 = createHash('sha256').update(JSON.stringify(data)).digest('hex');
const output = `${JSON.stringify({...data,sha256}, null, 2)}\n`;
const target = new URL('shared/catalogue.json', root);
if (process.argv.includes('--check')) {
  if (await readFile(target,'utf8') !== output) throw new Error('Catalogue drift; rebuild from preserved sources');
} else await writeFile(target, output);
console.log(`Reviewed catalogue v1: ${rounds.length} rounds, ${topics.length} topics, SHA256 ${sha256}`);
