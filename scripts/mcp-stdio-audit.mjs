// Transparent test-only relay. Persist fixed counters/results, never JSON-RPC payloads or credentials.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [entry, evidencePath] = process.argv.slice(2);
if (!entry || !evidencePath) throw new Error('MCP audit needs an entry point and evidence path');
const audit = { started: true, initializeRequests: 0, initializeResults: 0, discoveryRequests: 0, discoveredTools: null, surveyListRequests: 0, emptySurveyListResults: 0, toolErrors: 0, spawnFailed: false };
const pending = new Map();
const save = () => writeFileSync(evidencePath, JSON.stringify(audit), { mode: 0o600 });
save();
const server = spawn(process.execPath, [entry], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
function observe(stream, outgoing) {
  let buffered = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffered += chunk;
    if (buffered.length > 4 * 1024 * 1024) { buffered = ''; return; }
    let end;
    while ((end = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
      let value;
      try { value = JSON.parse(line); } catch { continue; }
      if (!outgoing) {
        const kind = value.method === 'initialize' ? 'initialize' : value.method === 'tools/list' ? 'discovery' : value.method === 'tools/call' && value.params?.name === 'surveys_list' ? 'surveys' : null;
        if (kind && value.id !== undefined) {
          pending.set(value.id, kind);
          audit[kind === 'initialize' ? 'initializeRequests' : kind === 'discovery' ? 'discoveryRequests' : 'surveyListRequests']++;
        }
      } else {
        const kind = pending.get(value.id);
        if (!kind) continue;
        pending.delete(value.id);
        if (value.error || value.result?.isError) audit.toolErrors++;
        else if (kind === 'initialize' && value.result?.protocolVersion) audit.initializeResults++;
        else if (kind === 'discovery' && Array.isArray(value.result?.tools)) audit.discoveredTools = value.result.tools.length;
        else if (kind === 'surveys') {
          const result = value.result;
          const empty = value => Array.isArray(value) && value.length === 0;
          const emptyText = result?.content?.some(block => {
            if (block.type !== 'text') return false;
            try { const value = JSON.parse(block.text); return empty(value) || empty(value?.result); } catch { return false; }
          });
          if (empty(result?.structuredContent?.result) || emptyText) audit.emptySurveyListResults++;
        }
      }
      save();
    }
  });
}
observe(process.stdin, false);
observe(server.stdout, true);
process.stdin.pipe(server.stdin);
server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);
server.on('error', () => { audit.spawnFailed = true; save(); process.exitCode = 1; });
server.on('exit', code => { save(); process.exitCode = code ?? 1; });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { save(); server.kill(signal); });
