import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production readiness CI runs local quality gates without live evals or deploys', async () => {
  const workflow = await readFile(new URL('../.github/workflows/production-readiness.yml', import.meta.url), 'utf8');
  const browserGate = await readFile(new URL('../scripts/verify-browser.mjs', import.meta.url), 'utf8');
  const studyLibraryBrowserGate = await readFile(new URL('../scripts/verify-study-library-browser.mjs', import.meta.url), 'utf8');

  assert.match(workflow, /node scripts\/ci-static-check\.mjs/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /run:\s*npm run studies:verify\s*$/m);
  assert.match(workflow, /node scripts\/ci-security-check\.mjs/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /npm run verify:browser/);
  assert.match(workflow, /STUDY_LIBRARY_URL=http:\/\/127\.0\.0\.1:4173\/studies\/index\.html/);
  assert.match(workflow, /STUDY_LIBRARY_DETAIL_URL=http:\/\/127\.0\.0\.1:4173\/en-us\/studies\/ai-copilot-pilot-small-business-us\/index\.html/);
  assert.match(workflow, /npm run studies:verify:browser/);
  assert.match(workflow, /LIKERTS_BROWSER_ATTESTATION_OUT/);
  assert.match(workflow, /LIKERTS_BROWSER_BUILD_DIRECTORY:\s*dist/);
  assert.match(workflow, /LIKERTS_BROWSER_ATTESTATION_PUBLICATION_STATUS:\s*CI_ARTIFACT/);
  assert.match(workflow, /npm run attestation:bundle --/);
  assert.match(workflow, /npm run attestation:bundle:verify -- artifacts\/localization-browser\/evidence-bundle/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /VITE_LIKERTS_VERCEL_ANALYTICS:\s*["']disabled["']/);
  assert.doesNotMatch(workflow, /VITE_LIKERTS_VERCEL_ANALYTICS:\s*["']release-approved["']/);
  assert.doesNotMatch(workflow, /attestation:promote/);
  assert.doesNotMatch(workflow, /eval:live|LIKERTS_EVAL_LIVE:\s*["']?1/i);
  assert.doesNotMatch(workflow, /vercel\s+deploy|npx\s+vercel|--prod/i);
  assert.match(studyLibraryBrowserGate, /const widths = \[320, 375, 768, 1440\];/);

  const buildStep = workflow.indexOf('run: npm run build');
  const studyContentStep = workflow.indexOf('run: npm run studies:verify');
  const previewStart = workflow.indexOf('npm run preview --');
  const cjkBrowserStep = workflow.indexOf('npm run verify:browser');
  const studyBrowserStep = workflow.indexOf('npm run studies:verify:browser');
  assert.ok(buildStep >= 0 && buildStep < studyContentStep, 'study content verification must follow the build');
  assert.ok(previewStart >= 0 && previewStart < cjkBrowserStep && cjkBrowserStep < studyBrowserStep, 'study browser verification must run inside the ready preview gate');
  assert.match(browserGate, /samples-persistence-and-lineage/);
  assert.match(browserGate, /sampleCoverage/);
  assert.match(browserGate, /process\.env\.LIKERTS_BROWSER_BUILD_DIRECTORY\s*\|\|\s*['"]dist['"]/);
  assert.match(browserGate, /validateLocalizationBrowserAttestation\(attestation/);
  assert.match(browserGate, /liveBackendValidated:\s*false/);
  assert.match(browserGate, /liveModelValidated:\s*false/);
  assert.match(browserGate, /observedHumanResponses:\s*false/);
  assert.match(browserGate, /participantPanelConnected:\s*false/);
  assert.match(browserGate, /function createAccessibilitySurfaceEvidence\(/);
  assert.match(browserGate, /LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS/);
  assert.match(browserGate, /LOCALIZATION_BROWSER_ACCESSIBILITY_DEEP_SURFACE_IDS/);
  assert.match(browserGate, /surfaceChecks,/);
  assert.match(browserGate, /snapshotCount:/);
  for (const surfaceId of [
    'first-run',
    'study-authoring',
    'results-overview',
    'stability',
    'evidence-ledger',
    'population-frame',
    'qualitative-exploration',
    'research-design-and-human-handoff',
    'required-source-error',
    'specialized-method-results',
    'specialized-method-handoffs',
    'static-sample-detail',
    'restored-sample-project',
  ]) assert.match(browserGate, new RegExp(`snapshot\\('${surfaceId}'\\)`));
  assert.equal((browserGate.match(/new AxeBuilder\(\{ page \}\)/g) || []).length, 1, 'axe execution stays centralized in the named-surface collector');
});

test('signed browser evidence binds a complete build manifest to every served artifact before output', async () => {
  const browserGate = await readFile(new URL('../scripts/verify-browser.mjs', import.meta.url), 'utf8');
  const artifactBinding = await readFile(new URL('../server/browser-artifact-binding.js', import.meta.url), 'utf8');

  assert.match(browserGate, /process\.env\.LIKERTS_BROWSER_BUILD_DIRECTORY\s*\|\|\s*['"]dist['"]/);
  assert.match(artifactBinding, /export async function buildBrowserArtifactManifest\(/);
  assert.match(artifactBinding, /fs\.readdir\(directory,\s*\{\s*withFileTypes:\s*true\s*\}\)/);
  assert.match(artifactBinding, /if \(entry\.isDirectory\(\)\)[\s\S]*await visit\(absolutePath, relativePath\)/);
  assert.match(artifactBinding, /else if \(entry\.isFile\(\)\)[\s\S]*discoveredFiles\.push\(\{ absolutePath, relativePath \}\)/);
  assert.match(artifactBinding, /for \(const file of discoveredFiles\)[\s\S]*contentDigest:\s*contentDigest\(bytes\)/);
  assert.match(artifactBinding, /export async function verifyServedBrowserArtifactManifest\(/);
  assert.match(artifactBinding, /for \(const entry of manifest\.files\)[\s\S]*await fetchExactArtifactBytes\(/);
  assert.match(artifactBinding, /verifiedFiles\.length !== manifest\.files\.length/);
  assert.match(artifactBinding, /verifiedPaths\.some\(\(relativePath, index\) => relativePath !== expectedPaths\[index\]\)/);
  assert.match(artifactBinding, /export function createBrowserArtifactResponseVerifier\(/);
  assert.match(artifactBinding, /BROWSER_ARTIFACT_NOT_MANIFESTED/);
  assert.match(artifactBinding, /BROWSER_ARTIFACT_BYTES_MISMATCH/);
  assert.match(artifactBinding, /export async function assertBrowserArtifactOutputOutsideRoot\(/);
  assert.match(browserGate, /await assertBrowserArtifactOutputOutsideRoot\(/);
  assert.match(browserGate, /createBrowserArtifactResponseVerifier\(\{ manifest: attestationArtifactManifest, candidateUrl: baseUrl \}\)/);
  assert.match(browserGate, /status === 200 \? await response\.body\(\) : null/);
  assert.match(browserGate, /Chromium artifact binding errors/);

  const callPositions = (pattern) => [...browserGate.matchAll(pattern)].map((match) => match.index);
  const manifestCalls = callPositions(/await buildBrowserArtifactManifest\(/g);
  const servedVerificationCalls = callPositions(/await verifyServedBrowserArtifactManifest\(/g);
  const outputContainmentCalls = callPositions(/await assertBrowserArtifactOutputOutsideRoot\(/g);
  const browserLaunch = browserGate.indexOf('await chromium.launch(');
  const artifactDigestAssignment = browserGate.indexOf('const artifactDigest = attestationArtifactManifest.artifactDigest');
  const createAttestation = browserGate.indexOf('const attestation = createLocalizationBrowserAttestation(');
  const prepareOutputDirectory = browserGate.lastIndexOf('await fs.mkdir(path.dirname(attestationOutputPath)');
  const writeAttestation = browserGate.indexOf('await fs.writeFile(resolvedAttestationOutputPath');

  assert.equal(manifestCalls.length, 2, 'the artifact directory is manifested before and after the browser matrix');
  assert.equal(servedVerificationCalls.length, 2, 'the served artifact is verified before and after the browser matrix');
  assert.equal(outputContainmentCalls.length, 2, 'the output path is checked before the matrix and again at the final write boundary');
  assert.ok(manifestCalls[0] < servedVerificationCalls[0] && servedVerificationCalls[0] < browserLaunch);
  assert.ok(browserLaunch < artifactDigestAssignment && artifactDigestAssignment < createAttestation);
  assert.ok(createAttestation < prepareOutputDirectory);
  assert.ok(prepareOutputDirectory < outputContainmentCalls[1] && outputContainmentCalls[1] < manifestCalls[1]);
  assert.ok(manifestCalls[1] < servedVerificationCalls[1] && servedVerificationCalls[1] < writeAttestation);

  const finalBindingChecks = browserGate.slice(manifestCalls[1], writeAttestation);
  assert.match(finalBindingChecks, /finalArtifactManifest\.artifactDigest/);
  assert.match(finalBindingChecks, /finalArtifactManifest\.files\.map\(\(\{ relativePath, byteLength, contentDigest \}\)/);
  assert.match(finalBindingChecks, /finalServedArtifact\.verifiedFileCount/);
  assert.match(finalBindingChecks, /finalServedArtifact\.verifiedPaths/);
});

test('browser replay waits for the replacement run before opening stability evidence', async () => {
  const browserGate = await readFile(new URL('../scripts/verify-browser.mjs', import.meta.url), 'utf8');
  const replayClick = browserGate.indexOf("page.locator('.report-actions button').nth(2).click()");
  const stabilityTab = browserGate.indexOf("await tab(page, 'stability', label)");
  const replayResponseWait = browserGate.lastIndexOf('const replayResponsePromise = page.waitForResponse(', replayClick);
  const replayResponseCompletion = browserGate.indexOf('await replayResponsePromise', replayClick);
  const replacementRunWait = browserGate.indexOf('replayRunId', replayClick);

  assert.ok(replayClick >= 0, 'the exact replay control remains exercised');
  assert.ok(replayResponseWait >= 0 && replayResponseWait < replayClick, 'the gate subscribes to the replay response before clicking');
  assert.ok(replayResponseCompletion > replayClick && replayResponseCompletion < stabilityTab, 'the gate waits for the replay response before changing report tabs');
  assert.ok(replacementRunWait >= 0 && replacementRunWait < stabilityTab, 'the gate waits for the replacement run identity before changing report tabs');
});

test('production readiness runbook covers migration, rollback, manual deploy, and smoke gates', async () => {
  const runbook = await readFile(new URL('../docs/production-readiness-runbook.md', import.meta.url), 'utf8');

  assert.match(runbook, /## Migration/i);
  assert.match(runbook, /## Rollback/i);
  assert.match(runbook, /## Manual Deploy/i);
  assert.match(runbook, /## Post-Deploy Smoke/i);
  assert.match(runbook, /LIKERTS_EXECUTION_DISABLED/);
  assert.match(runbook, /DEGRADED_NOT_GLOBALLY_DURABLE/);
  assert.match(runbook, /DURABLE_ADMISSION_REQUIRED/);
  assert.match(runbook, /actual admission adapter/i);
  assert.match(runbook, /no live eval/i);
});
