import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, stat} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const config=JSON.parse(await read('vercel.json'));
const home=await read('public/index.html');
const support=await read('public/game/support.html');
const errorPage=await read('public/404.html');

test('home offers actual browser entry and local quizzes without the retired product',()=>{
  assert.match(home, /href="\/play"/);
  assert.match(home, /href="\/play\/quizzes"/);
  assert.doesNotMatch(home, /surveys?|not a playable browser game|no game account, app-operated game server/i);
  assert.match(home, /browser/i);
  assert.match(home, /coming soon/i);
});
test('quiz-first entry uses three explicit UI-only destinations and preserves mind-reading',()=>{
  const hero=home.match(/<section class="hero[\s\S]*?<\/section>/)[0];
  for(const [label,path] of [['Create quiz','/play/quizzes?intent=create'],['Host quiz','/play/quizzes?intent=host'],['Join game','/play?intent=join']]){
    assert.ok(hero.includes('href="'+path+'">'+label+'</a>'),label);
  }
  assert.match(hero,/Free to play\. No game account needed/);
  assert.match(hero,/2–12 players/);
  assert.match(hero,/href="\/play">Or read each other’s minds/);
  assert.match(hero,/likerts-game-icon\.png/);
  assert.doesNotMatch(home,/unlimited players|50 players|free forever/i);
});
test('the local entry branch disables its own Vercel Git preview without changing play routing',()=>{
  assert.equal(config.git.deploymentEnabled['codex/free-quiz-entry-20261108'],false);
  assert.equal(config.git.deploymentEnabled['codex/web-quality-release-20261108'],false);
  assert.equal(config.redirects.find(route=>route.source==='/play/:path*').destination,'https://likerts-live.onrender.com/play/:path*');
  assert.equal(config.git.deploymentEnabled.main,undefined);
});
test('support keeps the established private contact and separates live room from native challenge codes',()=>{
  assert.match(support, /support@crosstabs\.com/);
  assert.match(support, /six-character room code/);
  assert.match(support, /room code is different from the encoded challenge codes/i);
  assert.doesNotMatch(support, /surveys?|support@likerts\.com/i);
});
test('privacy discloses server uploads, reveal, providers and separate backup retention',()=>{
  for(const copy of ['game server','answer key','until reveal','PostgreSQL','Vercel','Render','logs and backups']) assert.ok(home.includes(copy),copy);
  assert.match(home,/six hours/);assert.match(home,/two hours idle/);assert.match(home,/ten-minute/);
  assert.doesNotMatch(home,/no game account, app-operated game server/i);
});
test('play redirects retain paths through a temporary HTTPS Render redirect',()=>{
  const play=config.redirects.find(route=>route.source==='/play/:path*');assert.ok(play);
  assert.equal(play.permanent,false);
  const url=new URL(play.destination.replace('/:path*','/quizzes'));
  assert.equal(url.protocol,'https:');assert.ok(url.hostname.endsWith('.onrender.com'));
  assert.equal(url.pathname,'/play/quizzes');assert.equal(url.search,'');
  assert.doesNotMatch(url.hostname,/pending|placeholder|replace/);
  assert.ok(!config.rewrites,'No survey/API proxy or serverless replacement');
});
test('public asset and stylesheet references resolve within this static site',async()=>{
  for(const html of [home,support,errorPage])for(const match of html.matchAll(/(?:src|href)="(\/[^"?#]+)(?:[?#][^"]*)?"/g)){
    const path=match[1];if(['/','/play','/play/quizzes','/game/support'].includes(path))continue;
    const file=new URL('public'+path,root);assert.ok((await stat(file)).isFile(),path);
  }
});
test('the website has no old executable product API or pages',async()=>{
  const entries=await readdir(new URL('public/',root),{recursive:true});
  assert.ok(entries.every(path=>! /^(surveys|docs|demo|downloads|preview|app|status|media)(?:\/|$)/.test(path)));
  const top=await readdir(root);assert.ok(!top.includes('api'));
  assert.ok(!entries.includes('app.js'));assert.ok(!entries.includes('marketing.js'));
});
test('missing routes use a noindex game-only page and published discovery is game-only',async()=>{
  assert.match(errorPage,/noindex/);assert.match(errorPage,/href="\/play"/);
  const discovery=(await read('public/sitemap.xml'))+(await read('public/llms.txt'));
  assert.doesNotMatch(discovery,/surveys?|\/docs|\/downloads|\/demo/i);
  assert.match(discovery,/https:\/\/likerts\.com\/game\/support/);
});
test('marketing source has no analytics scripts, forms or secret placeholders',()=>{
  for(const html of [home,support,errorPage]){
    assert.doesNotMatch(html,/<script\b|<form\b|CLERK|BLOB_READ_WRITE_TOKEN|STRIPE_SECRET|__LIKERTS_/i);
    assert.match(html,/Content-Security-Policy/);
  }
});
