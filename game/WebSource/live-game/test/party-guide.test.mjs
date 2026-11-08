import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { partyGuide, guideScene, partyCastPresentation } from '../web/quiz-scene.mjs';

const shared = JSON.parse(await readFile(new URL('../../../SharedFixtures/party-guide.json', import.meta.url), 'utf8'));

test('the five editorial cast roles match the native/web presentation contract', () => {
  assert.deepEqual(shared.map(value => value.beat), ['gather', 'question', 'locked', 'reveal', 'finished']);
  assert.deepEqual(shared.map(value => value.characterName), ['Ember', 'Loop', 'Twist', 'Blu', 'Moss']);
  for (const guide of shared) {
    assert.deepEqual(partyGuide(guide.beat), guide);
    assert.ok(guide.voiceLine.length > 0 && [...guide.voiceLine].length <= 48);
    assert.ok(guide.castDescription.length > 0 && [...guide.castDescription].length <= 96);
    assert.equal(guide.voiceLine.includes('\n'), false);
    assert.equal(guide.castDescription.includes('\n'), false);
  }
  assert.equal(partyGuide('pending-unconfirmed'), null);
  assert.throws(() => { partyGuide('gather').cue = 'Changed by a caller'; }, TypeError);
  assert.deepEqual(partyGuide('gather'), shared[0]);
});

test('optional cast introduction matches the shared copy without changing phase cues', async () => {
  const presentation = JSON.parse(await readFile(new URL('../../../SharedFixtures/party-cast-presentation.json', import.meta.url), 'utf8'));
  assert.deepEqual(partyCastPresentation, presentation);
  assert.deepEqual(Object.keys(partyCastPresentation).sort(), ['arc', 'closing', 'intro']);
  for (const [key, maximum] of Object.entries({ intro: 80, arc: 80, closing: 160 })) {
    assert.ok(partyCastPresentation[key].length > 0 && [...partyCastPresentation[key]].length <= maximum);
  }
  assert.throws(() => { partyCastPresentation.intro = 'Changed by a caller'; }, TypeError);
  assert.throws(() => { partyGuide('gather').voiceLine = 'Changed by a caller'; }, TypeError);
  assert.deepEqual(partyGuide('gather'), shared[0]);
});

test('guide art stays original, neutral and decorative in every beat, including provisional finishes', t => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>');
  t.after(() => dom.window.close());
  const el = (tag, attributes = {}, ...children) => {
    const node = dom.window.document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
    return node;
  };
  for (const guide of shared) {
    const stage = guideScene(el, guide.beat);
    assert.equal(stage.getAttribute('aria-hidden'), 'true');
    assert.equal(stage.classList.contains('is-neutral'), true);
    assert.equal(stage.querySelector('button,input,select,textarea,h1,h2'), null);
    assert.equal(stage.dataset.guideCharacter, String(guide.characterValue));
    assert.ok(stage.querySelector('.quiz-guide-sprite'));
    assert.equal(stage.querySelector('img,[data-quiz-entrance],.quiz-celebration'), null);
  }
  assert.equal(guideScene(el, 'unknown'), null);
});

test('friendly guide crops match native hold bounds and preserve each original aspect ratio', async t => {
  const native = await readFile(new URL('../../../NativeSource/Likerts/UI/StoryCastBounds.swift', import.meta.url), 'utf8');
  const hold = native.match(/static let hold:[\s\S]*?= \[([\s\S]*?)\n    \]/)[1];
  const bounds = [...hold.matchAll(/(\d): CGRect\(x: (\d+), y: (\d+), width: (\d+), height: (\d+)\)/g)].map(match => match.slice(1).map(Number));
  assert.equal(bounds.length, 5);
  const css = await readFile(new URL('../web/quiz-scene.css', import.meta.url), 'utf8');
  const png = await readFile(new URL('../web/assets/story-cast-hold.png', import.meta.url));
  const atlasWidth = png.readUInt32BE(16), atlasHeight = png.readUInt32BE(20);
  assert.deepEqual([atlasWidth, atlasHeight], [1983, 793]);
  const dom = new JSDOM('<style>' + css + '</style>'); t.after(() => dom.window.close());
  const rules = [...dom.window.document.styleSheets[0].cssRules];
  const sprite = rules.find(rule => rule.selectorText === '.quiz-guide-sprite').style;
  assert.match(sprite.getPropertyValue('background-image'), /\/play\/assets\/story-cast-hold\.png/);
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, actual + ' ≈ ' + expected);
  for (const [value, x, y, width, height] of bounds) {
    const style = rules.find(rule => rule.selectorText === '.quiz-guide-character[data-guide-character="' + value + '"]>.quiz-guide-sprite').style;
    const ratio = style.getPropertyValue('--guide-ratio').split('/').map(Number);
    close(ratio[0] / ratio[1], width / height);
    const fittedWidth = parseFloat(style.getPropertyValue('--guide-width')), fittedHeight = parseFloat(style.getPropertyValue('--guide-height'));
    close(fittedWidth / fittedHeight, width / height);
    assert.ok(fittedWidth <= 64 && fittedHeight <= 72);
    const size = style.getPropertyValue('--guide-size').split(' ').map(parseFloat);
    const position = style.getPropertyValue('--guide-position').split(' ').map(parseFloat);
    close(size[0], atlasWidth / width * 100); close(size[1], atlasHeight / height * 100);
    close(position[0], x / (atlasWidth - width) * 100); close(position[1], y / (atlasHeight - height) * 100);
    const stage = guideScene((tag, attributes, child) => {
      const element = dom.window.document.createElement(tag);
      for (const [key, entry] of Object.entries(attributes)) element.setAttribute(key, entry);
      if (child) element.append(child); return element;
    }, shared.find(guide => guide.characterValue === value).beat);
    assert.equal(stage.firstElementChild.dataset.spriteRect, [x, y, width, height].join(','));
  }
});
