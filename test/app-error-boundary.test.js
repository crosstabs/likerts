import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { localizedCrashCopy } from '../src/lib/crashCopy.js';

const boundarySource = readFileSync(new URL('../src/components/AppErrorBoundary.jsx', import.meta.url), 'utf8');

test('crash fallback copy covers every enabled interface language', () => {
  for (const locale of ['en-US', 'zh-CN', 'ja-JP', 'ko-KR']) {
    const copy = localizedCrashCopy(locale);
    assert.ok(copy.title);
    assert.ok(copy.body);
    assert.ok(copy.reload);
  }
});

test('error boundary reports render failures and renders a reload action', () => {
  assert.match(boundarySource, /componentDidCatch\(error\)/);
  assert.match(boundarySource, /captureKind: 'react-boundary', action: 'render'/);
  assert.match(boundarySource, /role="alert"/);
  assert.match(boundarySource, /globalThis\.location\?\.reload\(\)/);
});
