import { spawn } from 'node:child_process';

// Client CLIs may read piped stdin before starting, even when a prompt is an
// argument. Give them immediate EOF and track our timer independently of exit
// status: a process can handle timeout SIGTERM and still exit successfully.
export function runBoundedClient(command, args, { cwd, env, timeout = 180000, maxBuffer = 4 * 1024 * 1024 } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', size = 0, timedOut = false, outputLimit = false, spawnError = false;
    let forceTimer;
    const signal = value => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, value); else child.kill(value); } catch {}
    };
    const stop = () => { signal('SIGTERM'); forceTimer ??= setTimeout(() => signal('SIGKILL'), 5000); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    for (const [stream, append] of [[child.stdout, value => { stdout += value; }], [child.stderr, value => { stderr += value; }]]) {
      stream.setEncoding('utf8');
      stream.on('data', value => { size += Buffer.byteLength(value); if (size > maxBuffer) { outputLimit = true; stop(); } else append(value); });
    }
    child.on('error', () => { spawnError = true; });
    child.on('close', (exitCode, exitSignal) => {
      clearTimeout(timer); clearTimeout(forceTimer);
      resolve({ stdout, stderr, exitCode, exitSignal, timedOut, outputLimit, spawnError, durationMs: Date.now() - started });
    });
  });
}
