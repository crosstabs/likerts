import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const progressSource = await readFile(new URL('../src/components/RunProgress.jsx', import.meta.url), 'utf8');
const runStudySource = appSource.slice(appSource.indexOf('const runStudy ='), appSource.indexOf('const exportStudy ='));

test('run progress reports server-backed states instead of simulated completion', () => {
  assert.doesNotMatch(appSource, /setInterval|activeStage/);
  assert.match(progressSource, /stages\.find\(\(item\) => item\.stage/);
  assert.match(progressSource, /t\('planned'\)/);
  assert.match(progressSource, /t\('inProgress'\)/);
  assert.match(progressSource, /aria-busy=\{running\}/);
});

test('the running state explains that completion time varies', () => {
  assert.match(progressSource, /role="status"/);
  assert.match(progressSource, /t\('runInProgressTitle'\)/);
  assert.match(progressSource, /t\('runInProgressSummary'\)/);
});

test('reruns keep the committed report available and restore it after failure', () => {
  const beforeRequest = runStudySource.slice(0, runStudySource.indexOf('try {'));
  assert.match(runStudySource, /const previousRunComplete = runComplete;/);
  assert.doesNotMatch(beforeRequest, /setRunComplete\(false\)/);
  assert.match(runStudySource, /catch \(requestError\) \{[\s\S]*?setRunComplete\(previousRunComplete\);/);
  assert.match(appSource, /const showReport = runComplete \|\| exampleOpen;/);
});

test('progress is isolated to the current pending run identity and statuses', () => {
  assert.match(appSource, /const \[pendingRunStatus, setPendingRunStatus\] = useState\(null\);/);
  assert.match(runStudySource, /setPendingRunStatus\(\{ runId: pendingRun\.id, stages: \[\] \}\);/);
  assert.match(appSource, /running && pendingRunStatus[\s\S]*?runId=\{pendingRunStatus\.runId\}[\s\S]*?stages=\{pendingRunStatus\.stages\}/);
  assert.doesNotMatch(appSource, /runId=\{result\.meta\?\.runId/);
  assert.doesNotMatch(progressSource, /\bcomplete\b &&|\{ complete,/);
});
