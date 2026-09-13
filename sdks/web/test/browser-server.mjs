import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LIKERTS_SDK_CAPABILITY } from '../dist/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const freePort = async () => {
  const probe = createNetServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
};

/** Shared real-API fixture for the original Chromium smoke and engine/RTL matrix. */
export async function startBrowserFixture({ rtl = false } = {}) {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', join(root, 'backend/Cargo.toml')], { encoding: 'utf8' }));
  const scratch = await mkdtemp(join(tmpdir(), 'likerts-browser-fixture-'));
  const backendBase = `http://127.0.0.1:${await freePort()}`;
  const token = randomBytes(32).toString('hex');
  const environment = Object.fromEntries(['PATH','HOME','LANG','TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const backend = spawn(join(metadata.target_directory, 'debug/likerts-server'), [], {
    cwd: scratch, env: { ...environment, LIKERTS_PORT: new URL(backendBase).port, LIKERTS_BIND_ADDRESS: '127.0.0.1', LIKERTS_ADMISSION_MODE: 'disabled', LIKERTS_ALLOW_MEMORY: '1', LIKERTS_ALLOW_DEV_AUTH: '1', LIKERTS_DEV_TOKENS: JSON.stringify({ [token]: 'web-browser' }), LIKERTS_EXPORT_DIR: join(scratch, 'exports') }, stdio: ['ignore','ignore','pipe']
  });
  // Consume diagnostics without leaking environment or unbounded output.
  backend.stderr.on('data', () => {});
  let backendFailed = false;
  backend.once('error', () => { backendFailed = true; });
  let server;
  const stop = async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (backend.pid && backend.exitCode === null && backend.signalCode === null) {
      const exited = new Promise(resolve => backend.once('exit', resolve));
      backend.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1500))]);
      if (backend.exitCode === null && backend.signalCode === null) { backend.kill('SIGKILL'); await exited; }
    }
    await rm(scratch, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${backendBase}/health`, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch {}
      if (backendFailed || backend.exitCode !== null || backend.signalCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error('Local browser-fixture API did not become ready');
    const json = async (path, body) => {
      const response = await fetch(`${backendBase}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Fixture API ${path.split('?')[0]} returned ${response.status}`);
      return response.json();
    };
    const sdkCapabilities = { installations: [LIKERTS_SDK_CAPABILITY] };
    const authorText = rtl ? { title: 'تجربة الشراء', rating: 'كيف كانت التجربة؟', comment: 'ما الذي يمكن تحسينه؟', good: '1 — جيد', bad: '2 — غير جيد', followup: 'هل تنصح بنا؟' }
      : { title: 'Checkout feedback', rating: 'How was checkout?', comment: 'What should improve?', good: 'Good', bad: 'Bad' };
    const questions = [
      { id: 'rating', type: 'single_choice', label: authorText.rating, required: true, options: [{ id: 'good', label: authorText.good }, { id: 'bad', label: authorText.bad }] },
      { id: 'comment', type: 'text', label: authorText.comment, required: true, maxLength: 100 },
      ...(rtl ? [{ id: 'followup', type: 'scale', label: authorText.followup, required: true, min: 1, max: 5 }] : [])
    ];
    const survey = await json('/v1/surveys', { idempotencyKey: 'browser-survey', title: authorText.title, questions,
      ...(rtl ? { pages: [{ id: 'experience', questionIds: ['rating','comment'] }, { id: 'recommendation', questionIds: ['followup'] }] } : {}) });
    const version = await json(`/v1/surveys/${survey.id}/publish`, { revision: survey.revision, sdkCapabilities });
    const collection = await json('/v1/collections', { idempotencyKey: 'browser-collection', surveyId: survey.id, version: version.version, placement: 'browser-test', sdkCapabilities });
    const messages = rtl ? { selectPlaceholder: 'اختر إجابة', back: 'السابق', next: 'التالي', progress: 'الصفحة {current} من {total}', submit: 'إرسال الإجابة', submitting: 'جار الإرسال', submitted: 'تم الإرسال' }
      : { selectPlaceholder: 'Choose one', submit: 'Send response', submitting: 'Sending…', submitted: 'Response sent' };
    const app = `import {LikertsClient,mountSurvey} from '/sdk/index.js';
window.cspViolations=[];document.addEventListener('securitypolicyviolation',event=>window.cspViolations.push(event.violatedDirective));
const bootstrap=await fetch('/bootstrap.json').then(response=>response.json());
const client=new LikertsClient(location.origin,bootstrap.token);const config=await client.collection(bootstrap.id);
window.disposeSurvey=mountSurvey(document.querySelector('main'),config,client,receipt=>{document.querySelector('#receipt').textContent=receipt.responseId}, {}, {messages:${JSON.stringify(messages)},classNames:{form:'customer-survey'}});
document.querySelector('#ready').textContent='ready';`;
    const css = `.customer-survey{font-family:system-ui;max-inline-size:32rem;margin-inline:auto;padding-inline:1rem}.likerts-question{margin-block:1rem}.likerts-label,.likerts-control{display:block}.likerts-control{margin-block-start:.25rem;max-inline-size:100%;box-sizing:border-box}.likerts-status:focus{outline:2px solid currentColor}`;
    const html = `<!doctype html><html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Likerts browser integration</title><link rel="stylesheet" href="/app.css"><script type="module" src="/app.js"></script></head><body tabindex="-1">${rtl ? '<p lang="en" dir="ltr">Arabic sample translation is unreviewed. This is a synthetic RTL integration example, not a language certification.</p>' : ''}<main></main><output id="ready"></output><output id="receipt"></output></body></html>`;
    const csp = "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    server = createServer(async (req, res) => {
      try {
        if (req.url?.startsWith('/v1/')) {
          const chunks=[]; for await(const chunk of req) chunks.push(chunk);
          const headers={authorization:req.headers.authorization??''}; if(req.headers['content-type']) headers['content-type']=req.headers['content-type'];
          const upstream=await fetch(`${backendBase}${req.url}`, {method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined,redirect:'manual',signal:AbortSignal.timeout(5000)});
          res.writeHead(upstream.status,{'content-type':'application/json'});res.end(Buffer.from(await upstream.arrayBuffer()));return;
        }
        res.setHeader('content-security-policy',csp);res.setHeader('x-content-type-options','nosniff');
        if(req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}
        else if(req.url==='/app.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(app)}
        else if(/^\/sdk\/[a-z-]+\.js$/.test(req.url)){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(await readFile(new URL(`../dist/${basename(req.url)}`,import.meta.url)))}
        else if(req.url==='/app.css'){res.writeHead(200,{'content-type':'text/css; charset=utf-8'});res.end(css)}
        else if(req.url==='/bootstrap.json'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:collection.id,token:collection.token}))}
        else if(req.url==='/result.json'){const usage=await json('/v1/usage');const rows=await json(`/v1/responses?collectionId=${collection.id}`);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({...usage,items:rows.items}))}
        else if(req.url==='/favicon.ico'){res.writeHead(204);res.end()}
        else{res.writeHead(404);res.end()}
      } catch {res.writeHead(500);res.end('Local fixture failed')}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, stop, authorText, messages };
  } catch (error) { await stop(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startBrowserFixture({ rtl: process.argv.includes('--rtl') });
  console.log(fixture.url);
  const stop = () => void fixture.stop();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
