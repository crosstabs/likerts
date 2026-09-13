#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Maintained documentation only. Frozen releases and generated/private trees
// are intentionally outside this file-target check; headings are not validated.
const roots = ['docs','infrastructure','sdks','tools','examples','backend','contracts','control-plane'];
const excluded = new Set(['.git','.tools','.validation-private','.qa-artifacts','.next','.vercel','node_modules','target','dist','build','releases','test-results','coverage','output','.build','.swiftpm','.derived','.dart_tool','.gradle']);
function withoutCode(source) {
  return source.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm, match => match.replace(/[^\n]/g, ' '))
    .replace(/(`+)[^\n]*?\1/g, match => ' '.repeat(match.length))
    .replace(/<!--[\s\S]*?-->/g, match => match.replace(/[^\n]/g, ' '));
}
function destination(source, start) {
  let index = start;
  while (/\s/.test(source[index] ?? '') && index < source.length) index++;
  if (source[index] === '<') {
    const end = source.indexOf('>', index + 1);
    return end < 0 ? '' : source.slice(index + 1, end);
  }
  let depth = 0, target = '';
  for (; index < source.length; index++) {
    const char = source[index];
    if (char === '\\' && index + 1 < source.length) { target += source[++index]; continue; }
    if (/\s/.test(char) || (char === ')' && depth === 0)) break;
    if (char === '(') depth++;
    if (char === ')') depth--;
    target += char;
  }
  return target;
}
export function localTargets(markdown) {
  const source = withoutCode(markdown);
  const matches = [];
  for (const match of source.matchAll(/(?<!!)\[[^\]\n]*\]\(/g)) {
    matches.push({ offset: match.index, target: destination(source, match.index + match[0].length) });
  }
  for (const match of source.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*/gm)) {
    matches.push({ offset: match.index, target: destination(source, match.index + match[0].length) });
  }
  return matches.filter(({ target }) => target && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target));
}
export async function checkDocuments(root, documents) {
  const broken = [];
  let checked = 0;
  for (const document of documents) {
    const filename = resolve(root, document);
    const markdown = await readFile(filename, 'utf8');
    for (const item of localTargets(markdown)) {
      const line = markdown.slice(0, item.offset).split('\n').length;
      try {
        const file = decodeURIComponent(item.target.split(/[?#]/, 1)[0]);
        if (!file) continue;
        checked++;
        await stat(resolve(dirname(filename), file));
      } catch {
        broken.push({ document, line, target: item.target });
      }
    }
  }
  return { documents: documents.length, checked, broken };
}
export async function maintainedDocuments(root) {
  const documents = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.name.startsWith('.') || /\.(?:xcodeproj|xcworkspace)$/.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) documents.push(relative(root, path));
    }
  }
  for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isFile() && /\.md$/i.test(entry.name)) documents.push(entry.name);
  for (const directory of roots) {
    try { await walk(join(root, directory)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return documents.sort();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2 && (process.argv.length !== 4 || process.argv[2] !== '--root')) throw new Error('Usage: node scripts/check-markdown-links.mjs [--root DIRECTORY]');
  const root = process.argv[2] === '--root' ? resolve(process.argv[3]) : fileURLToPath(new URL('../', import.meta.url));
  const result = await checkDocuments(root, await maintainedDocuments(root));
  for (const failure of result.broken) console.error(`${failure.document}:${failure.line}: missing target ${failure.target}`);
  console.log(`Markdown file targets: ${result.documents} maintained documents, ${result.checked} links, ${result.broken.length} broken.`);
  if (result.broken.length) process.exitCode = 1;
}
