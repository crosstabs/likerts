import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir, stat} from 'node:fs/promises';
import {readEntryIntent} from '../../game/WebSource/live-game/web/entry-intent.mjs';
import {normalizeCode} from '../../game/WebSource/live-game/web/client.mjs';
import {starterQuizDocuments} from '../../game/WebSource/live-game/web/quiz-document.mjs';

const root = new URL('../', import.meta.url);
const game = new URL('../../game/WebSource/live-game/', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const config = JSON.parse(await read('vercel.json'));
const home = await read('public/index.html');
const support = await read('public/game/support.html');
const errorPage = await read('public/404.html');
const stylesheet = await read('public/game/marketing.css');
const siteOrigin = 'https://likerts.com';
const renderOrigin = 'https://likerts-live.onrender.com';
const digest = value => createHash('sha256').update(value).digest('hex');
const decode = value => value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[0-9a-f]+);/gi, entity => {
  const named = {'&amp;':'&', '&quot;':'"', '&apos;':"'", '&lt;':'<', '&gt;':'>', '&nbsp;':' '};
  if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()];
  const hex = entity.toLowerCase().startsWith('&#x');
  return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10));
});
const text = value => decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
function attributes(value) {
  const result = {};
  for (const match of value.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const name = match[1].toLowerCase();
    assert.ok(!Object.hasOwn(result, name), 'Duplicate HTML attribute: ' + name);
    result[name] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}
const openings = (html, tag) => [...html.matchAll(new RegExp('<' + tag + '\\b([^>]*)>', 'gi'))].map(match => attributes(match[1]));
const blocks = (html, tag) => [...html.matchAll(new RegExp('<' + tag + '\\b([^>]*)>([\\s\\S]*?)<\\/' + tag + '>', 'gi'))].map(match => ({attrs:attributes(match[1]), body:match[2], source:match[0]}));
function nameOf(element, html, fallback = text(element.body ?? '')) {
  if (element.attrs['aria-labelledby']) {
    const labels = ['label', 'span', 'h1', 'h2', 'h3', 'p'].flatMap(tag => blocks(html, tag));
    return element.attrs['aria-labelledby'].split(/\s+/).map(id => {
      const label = labels.find(value => value.attrs.id === id);
      assert.ok(label, 'Accessible label target exists: ' + id);
      return text(label.body);
    }).join(' ');
  }
  return element.attrs['aria-label'] ?? fallback;
}
function csp(html) {
  const meta = openings(html, 'meta').find(value => value['http-equiv']?.toLowerCase() === 'content-security-policy');
  assert.ok(meta?.content, 'A CSP meta policy is present');
  const directives = new Map();
  for (const part of meta.content.split(';').map(value => value.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    assert.ok(!directives.has(name), 'Duplicate CSP directive: ' + name);
    directives.set(name, values);
  }
  return directives;
}
const privacy = blocks(home, 'details').find(value => value.attrs.id === 'privacy');
const anchors = html => blocks(html, 'a');
const destination = anchor => new URL(anchor.attrs.href, siteOrigin);
const playRedirect = () => config.redirects.find(route => route.source === '/play/:path*');

test('home is a truthful quiz-first browser destination with mind-reading and support', () => {
  const headings = blocks(home, 'h1');
  assert.equal(headings.length, 1);
  assert.equal(text(headings[0].body), 'Good questions. Great company.');
  const header = blocks(home, 'header')[0];
  assert.ok(header);
  const navigation = anchors(header.body);
  for (const [label, path] of [['Quizzes', '/play/quizzes'], ['Mind-reading', '/play'], ['Support', '/game/support']]) {
    const link = navigation.find(value => text(value.body) === label);
    assert.ok(link, label);
    const url = destination(link);
    assert.equal(url.origin, siteOrigin);
    assert.equal(url.pathname, path);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  }
  const main = blocks(home, 'main')[0];
  assert.ok(main);
  const actions = anchors(main.body);
  const host = actions.find(link => destination(link).searchParams.get('intent') === 'host' && !destination(link).searchParams.has('starter'));
  const create = actions.find(link => destination(link).searchParams.get('intent') === 'create');
  assert.ok(host && create);
  for (const [link, intent] of [[host, 'host'], [create, 'create']]) {
    const url = destination(link);
    assert.equal(url.origin, siteOrigin);
    assert.equal(url.pathname, '/play/quizzes');
    assert.equal(url.hash, '');
    assert.deepEqual([...url.searchParams], [['intent', intent]]);
    assert.equal(readEntryIntent(url.href), intent);
  }
  assert.match(text(host.body), /^Host (?:a )?quiz$/i);
  assert.match(text(create.body), /^Create (?:your own|quiz)$/i);
  assert.match(text(main.body), /Free to play\. No game account needed/);
  assert.match(text(main.body), /2–12 players/);
  assert.match(home, /browser/i);
  assert.doesNotMatch(home, /surveys?|not a playable browser game|no game account, app-operated game server|unlimited players|50 players|free forever/i);
});

test('native GET join form produces the existing room invitation query with an accessible name', () => {
  const forms = blocks(home, 'form');
  assert.equal(forms.length, 1, 'Only the intended room-code form is present');
  const form = forms[0];
  assert.equal(form.attrs.action, '/play');
  assert.equal(form.attrs.method?.toLowerCase(), 'get');
  const controls = ['input', 'select', 'textarea', 'button'].flatMap(tag => openings(form.body, tag).map(attrs => ({tag, attrs})));
  const named = controls.filter(control => control.attrs.name);
  assert.equal(named.length, 1);
  assert.equal(named[0].tag, 'input');
  const input = named[0].attrs;
  assert.equal(input.name, 'room');
  assert.ok(input.id);
  assert.equal(input.type ?? 'text', 'text');
  assert.ok(Object.hasOwn(input, 'required'));
  assert.ok(!Object.hasOwn(input, 'disabled') && !Object.hasOwn(input, 'readonly'));
  assert.equal(input.value ?? '', '', 'A room code is supplied by the visitor');
  assert.equal(openings(form.body, 'fieldset').filter(fieldset => Object.hasOwn(fieldset, 'disabled')).length, 0);
  for (const {attrs:control} of controls) {
    for (const override of ['form', 'formaction', 'formmethod', 'formenctype', 'formnovalidate']) {
      assert.ok(!Object.hasOwn(control, override), 'Controls retain the native form contract: ' + override);
    }
  }
  assert.equal(Number(input.minlength), 6);
  assert.ok(Number(input.maxlength) >= 6 && Number(input.maxlength) <= 16);
  const label = blocks(form.body, 'label').find(value => value.attrs.for === input.id);
  assert.ok(label, 'Visible label is associated with the input');
  const visibleLabel = text(label.body);
  assert.match(visibleLabel, /game code/i);
  const accessibleName = nameOf({attrs:input}, form.body, visibleLabel);
  assert.ok(accessibleName.toLowerCase().includes(visibleLabel.toLowerCase()), 'Visible input label is included in its accessible name');
  const submit = blocks(form.body, 'button').find(value => (value.attrs.type ?? 'submit').toLowerCase() === 'submit');
  assert.ok(submit);
  assert.match(text(submit.body), /^Join game$/i);
  assert.ok(nameOf(submit, form.body).toLowerCase().includes(text(submit.body).toLowerCase()));
  for (const code of ['ABCDEF', 'ab-cd ef']) {
    const url = new URL(form.attrs.action, siteOrigin);
    url.search = new URLSearchParams([[input.name, code]]).toString();
    assert.equal(url.pathname, '/play');
    assert.deepEqual([...url.searchParams.keys()], ['room']);
    assert.equal(normalizeCode(url.searchParams.get('room')), 'ABCDEF');
    assert.equal(readEntryIntent(url.href), null, 'A room invitation retains priority over UI-only hints');
    const redirect = new URL(playRedirect().destination.replace('/:path*', ''));
    assert.equal(redirect.origin, renderOrigin);
    assert.equal(redirect.search, '', 'The redirect declares no competing query parameters');
  }
});

test('three Play quiz covers describe real starters and link to explicit live-host previews', () => {
  const documents = new Map(starterQuizDocuments().map(quiz => [quiz.id, quiz]));
  const cards = blocks(home, 'article');
  assert.equal(cards.length, 3);
  const selected = new Set();
  for (const card of cards) {
    const links = anchors(card.body).filter(link => destination(link).searchParams.has('starter'));
    assert.equal(links.length, 1);
    const link = links[0], url = destination(link);
    assert.equal(url.origin, siteOrigin);
    assert.equal(url.pathname, '/play/quizzes');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['intent', 'starter']);
    assert.deepEqual(url.searchParams.getAll('intent'), ['host']);
    const ids = url.searchParams.getAll('starter');
    assert.equal(ids.length, 1);
    const quiz = documents.get(ids[0]);
    assert.ok(quiz, 'Cover selects an actual canonical starter');
    assert.ok(!selected.has(quiz.id), 'Starter covers are distinct');
    selected.add(quiz.id);
    assert.equal(text(blocks(card.body, 'h3')[0].body), quiz.title);
    assert.match(text(card.body), new RegExp('\\b' + quiz.questions.length + ' questions\\b'));
    assert.equal(text(link.body), 'Play quiz');
    const accessibleName = nameOf(link, card.body);
    assert.ok(accessibleName.toLowerCase().includes('play quiz'));
    assert.ok(accessibleName.includes(quiz.title));
    assert.match(accessibleName, /\blive\b/i);
    assert.equal(readEntryIntent(url.href), 'host');
    assert.ok(openings(card.body, 'img').length > 0);
  }
  // The actual preview/no-admission effect is exercised by game UI tests.
  // Here script-free GET navigation is bound to that real starter/hint contract.
});

test('homepage removes native marketing without erasing truthful privacy disclosures', () => {
  assert.ok(privacy);
  const marketing = home.replace(privacy.source, '');
  assert.doesNotMatch(marketing, /\biPhone\b|\biMessage\b|\bMessages\b|\bApp Store\b|\bnative app\b|coming soon|offline challenge/i);
  assert.doesNotMatch(marketing, /popular quizzes|trending now|\b\d[\d,]* players online|your saved quizzes/i);
  assert.match(privacy.body, /native app keeps offline games and settings locally/);
  assert.match(privacy.body, /Messages cards/);
  assert.match(privacy.body, /Optional native AI processing is on device/);
});

test('existing release guards and live routing remain intact', () => {
  for (const branch of ['codex/free-quiz-entry-20261108', 'codex/web-quality-release-20261108', 'codex/quiz-draft-recovery-20261108']) {
    assert.equal(config.git.deploymentEnabled[branch], false);
  }
  assert.equal(config.git.deploymentEnabled.main, undefined);
  assert.ok(Object.values(config.git.deploymentEnabled).every(value => value === false));
  assert.equal(playRedirect().destination, renderOrigin + '/play/:path*');
});

test('support keeps established private contact and distinguishes native challenge codes', () => {
  assert.match(support, /support@crosstabs\.com/);
  assert.match(support, /six-character room code/);
  assert.match(support, /room code is different from the encoded challenge codes/i);
  assert.doesNotMatch(support, /surveys?|support@likerts\.com/i);
});

test('privacy preserves live uploads, reveal, providers and separate retention truth', () => {
  assert.ok(privacy);
  for (const copy of ['game server', 'answer key', 'until reveal', 'PostgreSQL', 'Vercel', 'Render', 'logs and backups']) assert.ok(privacy.body.includes(copy), copy);
  assert.match(privacy.body, /six hours/);
  assert.match(privacy.body, /two hours idle/);
  assert.match(privacy.body, /ten-minute/);
  assert.match(privacy.body, /Preparing a draft sends nothing/);
  assert.doesNotMatch(privacy.body, /no game account, app-operated game server/i);
});

test('play redirects retain paths and leave invitation queries unclaimed', () => {
  const play = playRedirect();
  assert.ok(play);
  assert.equal(play.permanent, false);
  const url = new URL(play.destination.replace('/:path*', '/quizzes'));
  assert.equal(url.origin, renderOrigin);
  assert.equal(url.pathname, '/play/quizzes');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.ok(!config.rewrites, 'No retired survey/API proxy or serverless replacement');
});

test('CSP permits only the intended native form redirect and keeps scripts/connections disabled', () => {
  const policy = csp(home);
  for (const [directive, expected] of [
    ['default-src', ["'self'"]], ['script-src', ["'none'"]], ['connect-src', ["'none'"]],
    ['style-src', ["'self'"]], ['font-src', ["'self'"]], ['img-src', ["'self'"]],
    ['base-uri', ["'none'"]], ['form-action', ["'self'", renderOrigin]],
  ]) assert.deepEqual(new Set(policy.get(directive)), new Set(expected), directive);
  for (const html of [support, errorPage]) {
    const restricted = csp(html);
    assert.deepEqual(restricted.get('default-src'), ["'none'"]);
    assert.deepEqual(restricted.get('form-action'), ["'none'"]);
    for (const directive of ['script-src', 'connect-src']) assert.deepEqual(restricted.get(directive) ?? restricted.get('default-src'), ["'none'"]);
    assert.equal(blocks(html, 'form').length, 0);
  }
  for (const html of [home, support, errorPage]) {
    if (openings(html, 'link').some(link => link.rel === 'stylesheet' && link.href === '/game/marketing.css')) {
      const shared = csp(html);
      assert.deepEqual(shared.get('font-src') ?? shared.get('default-src'), ["'self'"], 'Pages loading the shared font stylesheet allow self fonts');
    }
  }
  const headers = new Map(config.headers.find(rule => rule.source === '/(.*)').headers.map(header => [header.key.toLowerCase(), header.value]));
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
});

test('public HTML and stylesheet assets resolve locally', async () => {
  const routes = new Set(['/', '/play', '/play/quizzes', '/game/support']);
  for (const html of [home, support, errorPage]) {
    for (const match of html.matchAll(/(?:src|href)="(\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
      const path = match[1];
      if (routes.has(path)) continue;
      assert.ok((await stat(new URL('public' + path, root))).isFile(), path);
    }
  }
  for (const match of stylesheet.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const path = match[2];
    assert.ok(path.startsWith('/game/assets/'), 'CSS assets are self-hosted: ' + path);
    assert.ok((await stat(new URL('public' + path, root))).isFile(), path);
  }
});

test('self-hosted typefaces include real WOFF2 files and their OFL licenses', async () => {
  for (const [font, license] of [['fredoka-latin.woff2', 'fredoka-OFL.txt'], ['nunito-sans-latin.woff2', 'nunitosans-OFL.txt']]) {
    const bytes = await readFile(new URL('public/game/assets/' + font, root));
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'wOF2');
    assert.ok(bytes.length > 0 && bytes.length <= 256 * 1024, 'Font subset is bounded');
    assert.ok(stylesheet.includes('/game/assets/' + font), 'Typeface is actually loaded by the site');
    assert.match(await read('public/game/assets/' + license), /SIL OPEN FONT LICENSE Version 1\.1/);
  }
  assert.doesNotMatch(home + stylesheet, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test('public asset catalog is bounded and uses the original cast bytes', async () => {
  let total = 0;
  for (const name of await readdir(new URL('public/game/assets/', root))) {
    const url = new URL('public/game/assets/' + name, root);
    const info = await stat(url);
    assert.ok(info.isFile(), 'No nested archive/directory is shipped as an asset');
    assert.match(name, /\.(png|woff2|txt)$/);
    assert.ok(info.size > 0 && info.size <= 8 * 1024 * 1024, 'Individual asset bound: ' + name);
    total += info.size;
    if (name.endsWith('.png')) {
      const bytes = await readFile(url);
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', name);
    }
  }
  assert.ok(total <= 32 * 1024 * 1024, 'Public asset catalog stays below 32 MiB');
  for (const name of ['story-cast-celebrate.png', 'story-cast-hold.png', 'story-book-library.png']) {
    assert.equal(digest(await readFile(new URL('public/game/assets/' + name, root))), digest(await readFile(new URL('web/assets/' + name, game))), name + ' preserves the original game art');
  }
});

test('canonical privacy publication remains held and no retired executable product returns', async () => {
  const entries = await readdir(new URL('public/', root), {recursive:true});
  assert.ok(!entries.includes('game/privacy.html') && !entries.includes('game/privacy/index.html'));
  assert.ok(!config.redirects.some(route => route.source === '/game/privacy'));
  assert.ok(entries.every(path => !/^(surveys|docs|demo|downloads|preview|app|status|media)(?:\/|$)/.test(path)));
  assert.ok(!(await readdir(root)).includes('api'));
  assert.ok(!entries.includes('app.js') && !entries.includes('marketing.js'));
});

test('missing routes and discovery stay game-only without publishing native/PWA claims', async () => {
  assert.match(errorPage, /noindex/);
  assert.match(errorPage, /href="\/play"/);
  const discovery = (await read('public/sitemap.xml')) + (await read('public/llms.txt'));
  assert.doesNotMatch(discovery, /surveys?|\/docs|\/downloads|\/demo/i);
  assert.match(discovery, /https:\/\/likerts\.com\/game\/support/);
  assert.doesNotMatch(home, /rel=["']manifest["']|navigator\.serviceWorker|install (?:the )?app|progressive web app/i);
});

test('static marketing has no executable scripts, event handlers or secret placeholders', () => {
  for (const html of [home, support, errorPage]) {
    assert.doesNotMatch(html, /<script\b|\son[a-z]+\s*=|(?:href|src)=["']javascript:|CLERK|BLOB_READ_WRITE_TOKEN|STRIPE_SECRET|__LIKERTS_/i);
    assert.ok(csp(html));
  }
});
