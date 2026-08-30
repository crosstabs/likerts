import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('mobile composer keeps fields before the run/readiness action', async () => {
  const [composer, styles] = await Promise.all([
    readFile(new URL('../src/components/StudyComposer.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.ok(composer.indexOf('<div className="composer-fields">') < composer.indexOf('<div className="composer-actions">'));
  const mobileComposerRule = styles.match(/@media \(max-width: 760px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const actionRule = mobileComposerRule.match(/\.composer-actions \{([^}]+)\}/)?.[1] || '';
  assert.match(actionRule, /flex-direction:\s*column/);
  assert.doesNotMatch(actionRule, /order\s*:/);
});

test('research-material character counts use the selected interface locale', async () => {
  const composer = await readFile(new URL('../src/components/StudyComposer.jsx', import.meta.url), 'utf8');

  assert.match(composer, /formatLocalizedNumber\(material\.originalCharacterCount, locale\)/);
  assert.doesNotMatch(composer, /material\.originalCharacterCount\.toLocaleString\(\)/);
});
