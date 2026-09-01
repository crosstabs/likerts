import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { localizedFeedbackCopy } from '../src/lib/feedbackCopy.js';

const widgetSource = readFileSync(new URL('../src/components/FeedbackWidget.jsx', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('feedback copy covers every enabled interface language', () => {
  for (const locale of ['en-US', 'zh-CN', 'ja-JP', 'ko-KR']) {
    const copy = localizedFeedbackCopy(locale);
    assert.ok(copy.trigger);
    assert.ok(copy.title);
    assert.ok(copy.privacy);
    assert.ok(copy.successTitle);
  }
});

test('feedback widget is an explicit, keyboard-dismissable dialog with privacy guidance', () => {
  assert.match(widgetSource, /role="dialog"/);
  assert.match(widgetSource, /aria-controls="feedback-panel"/);
  assert.match(widgetSource, /event\.key === 'Escape'/);
  assert.match(widgetSource, /credentials: 'omit'/);
  assert.match(widgetSource, /pagePath: currentPagePath\(\)/);
  assert.match(widgetSource, /id="feedback-privacy"/);
  assert.match(widgetSource, /maxLength=\{800\}/);
});

test('feedback control stays edge-mounted on desktop and reachable on mobile', () => {
  assert.match(styleSource, /\.feedback-widget \{ position: fixed;/);
  assert.match(styleSource, /\.feedback-panel \{ position: fixed;/);
  assert.match(styleSource, /\.feedback-widget \{ inset-block-start: auto; inset-block-end: 16px;/);
});
