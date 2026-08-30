import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const startSource = await readFile(new URL('../src/components/FirstRunStart.jsx', import.meta.url), 'utf8');

test('fresh sessions gate the seed report behind an explicit example action', () => {
  assert.match(appSource, /const showStartState = !runComplete && !briefOpen && !exampleOpen && !running;/);
  assert.match(appSource, /const showReport = runComplete \|\| exampleOpen;/);
  assert.match(appSource, /showStartState \? <FirstRunStart/);
  assert.match(appSource, /showReport \? \(\s*<ResultsWorkspace/);
  assert.match(appSource, /!showStartState && !exampleOpen \? <button className=\{briefOpen \? 'new-study-button is-secondary' : 'new-study-button'\}/);
  assert.doesNotMatch(startSource, /68%|demo_seed|ResultsWorkspace|Export|Replay/);
});

test('restored runs and sample-prefill links retain their existing entry behavior', () => {
  assert.match(appSource, /const restoredRun = useMemo\(\(\) => samplePrefill \? null : getLatestRun\(\)/);
  assert.match(appSource, /const \[result, setResult\] = useState\(\(\) => withInputHashLineage\(restoredRun\?\.result \|\| initialResult\)\);/);
  assert.match(appSource, /const \[runComplete, setRunComplete\] = useState\(Boolean\(restoredRun\)\);/);
  assert.match(appSource, /const \[briefOpen, setBriefOpen\] = useState\(samplePrefill\?\.shouldOpenBrief === true\);/);
});

test('starting a study opens the composer and focuses the research question', () => {
  assert.match(appSource, /const beginFirstStudy = \(event\) => \{[\s\S]*?setBriefOpen\(true\);[\s\S]*?\};/);
  assert.match(appSource, /document\.getElementById\('research-question'\)\?\.focus\(\);/);
  assert.match(appSource, /<FirstRunStart onStart=\{beginFirstStudy\} onViewExample=\{viewExample\}/);
});

test('new studies use a blank brief and closing the composer restores focus', () => {
  assert.match(appSource, /const blankStudy = \(locale = 'en-US'\) => \{[\s\S]*?prompt: '',[\s\S]*?audience: '',[\s\S]*?concept: '',/);
  assert.match(appSource, /outputLocale: locale,[\s\S]*?instrumentLocale: '',[\s\S]*?priceUnit: defaults\.priceUnit,/);
  assert.doesNotMatch(appSource, /currency: defaults\.currency/);
  assert.match(appSource, /const \[study, setStudy\] = useState\(\(\) => samplePrefill \|\| restoredRun \? restoredStudy : blankStudy\(studyDefaultLocale\)\);/);
  assert.match(appSource, /const closeBrief = \(\) => \{[\s\S]*?first-run-start-button[\s\S]*?target\?\.focus\(\);/);
  assert.match(startSource, /id="first-run-start-button"/);
});

test('starting over is demoted during editing and protects meaningful work', () => {
  assert.match(appSource, /const hasMeaningfulStudyWork = runComplete[\s\S]*?!sameJson\(study, blankStudy\(studyDefaultLocale\)\)[\s\S]*?groundingMaterials\.length > 0[\s\S]*?repeatRuns\.length > 0/);
  assert.match(appSource, /if \(hasMeaningfulStudyWork && !window\.confirm\(t\('startNewStudyConfirm'\)\)\) return;/);
  assert.match(appSource, /briefOpen \? 'new-study-button is-secondary' : 'new-study-button'/);
});

test('the first-run presentation exposes one primary start action and an explicit example boundary', () => {
  for (const key of [
    'firstRunKicker',
    'firstRunTitle',
    'firstRunDescription',
    'startStudy',
    'viewExample',
    'firstRunBoundary',
    'exampleReportLabel',
    'exampleReportDescription',
  ]) assert.match(startSource, new RegExp(`t\\('${key}'\\)`));

  assert.equal((startSource.match(/className="first-run-start-primary"/g) || []).length, 1);
  assert.match(startSource, /className="first-run-start-secondary"/);
  assert.match(startSource, /className="example-report-notice" aria-label=\{t\('exampleReportLabel'\)\}/);
});

test('the application exposes a localized keyboard bypass to the workspace', () => {
  assert.match(appSource, /<a className="app-skip-link" href="#workspace">\{t\('skipToWorkspace'\)\}<\/a>/);
  assert.match(appSource, /<main className="workspace" id="workspace" tabIndex="-1">/);
});
