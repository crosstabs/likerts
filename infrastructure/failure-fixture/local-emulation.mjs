// Mounted only by the local Docker check; excluded from the hosted image context.
// This measures public amd64 binaries under ARM-host QEMU, not native PID guard proof.
import { readFileSync, readlinkSync } from 'node:fs';
import { start } from './supervisor.mjs';
await start(process.env, { identify(child) {
  if (!(child.pid > 1) || child.exitCode !== null || child.signalCode !== null || readlinkSync(`/proc/${child.pid}/exe`) !== '/usr/bin/qemu-x86_64') throw Error('unexpected_emulation_identity');
  const text = readFileSync(`/proc/${child.pid}/stat`, 'utf8');
  return { pid: child.pid, startTicks: text.slice(text.lastIndexOf(')') + 2).split(' ')[19] };
} });
