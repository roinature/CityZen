#!/usr/bin/env node
// Frees the dev server port before `npm run dev` starts the server.
//
// A previous run can leave things behind: a server still listening on the
// port, or a detached `tsx watch` (from a closed terminal or editor) that
// respawns a server on the port whenever a source file changes. Both make the
// new server fail with EADDRINUSE, so stop them first.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] ?? process.env.PORT ?? 3030);
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return ''; // lsof/ps exit non-zero when nothing matches
  }
}

const pids = (out) => out.split('\n').map(Number).filter(pid => pid > 0 && pid !== process.pid);

function commandOf(pid) {
  return run('ps', ['-o', 'command=', '-p', String(pid)]).trim();
}

function parentOf(pid) {
  return Number(run('ps', ['-o', 'ppid=', '-p', String(pid)]).trim());
}

function cwdOf(pid) {
  const line = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find(l => l.startsWith('n'));
  return line?.slice(1);
}

const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

if (process.platform === 'win32') process.exit(0); // relies on lsof/ps

const targets = new Map();

// Whatever is listening on the port, plus the watcher that would respawn it.
for (const pid of pids(run('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN']))) {
  targets.set(pid, commandOf(pid));
  const parent = parentOf(pid);
  if (parent > 1 && /tsx.*\bwatch\b/.test(commandOf(parent))) targets.set(parent, commandOf(parent));
}

// Stray watchers for this server whose child already died (they would grab
// the port again on the next file change).
for (const pid of pids(run('pgrep', ['-f', 'tsx watch src/index.ts']))) {
  if (cwdOf(pid) === serverDir) targets.set(pid, commandOf(pid));
}

if (targets.size === 0) process.exit(0);

for (const [pid, command] of targets) {
  console.log(`[free-port] stopping leftover process ${pid} on port ${port}: ${command.slice(0, 100)}`);
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
}

// Give them a moment to exit cleanly, then force it.
const deadline = Date.now() + 3000;
while ([...targets.keys()].some(isAlive) && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 100));
}
for (const pid of targets.keys()) {
  if (isAlive(pid)) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}
