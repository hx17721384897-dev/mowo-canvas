import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';

const worker = resolve('scripts/video/worker.py');
const guardian = resolve('scripts/video/guardian.py');
const pythonRuntime = JSON.parse(readFileSync(resolve('scripts/video/python-runtime.json'), 'utf8'));
const events = new Set(['health', 'resolved', 'stage', 'progress', 'probed', 'previewed', 'covered', 'recovery', 'downloaded', 'failed', 'done', 'qr', 'qr_status', 'auth', 'managed', 'process_log']);

// Explicit runtime path; never discover Python through PATH or another project's venv.
export function invokeEngine(request, { python = resolve('data/video-runtime', pythonRuntime.directory, 'python.exe'),
  signal, timeoutMs = 60000, onEvent = () => {}, script = worker,
  managed = process.platform === 'win32' && ['download', 'preview', 'cover'].includes(request.action) ? {} : false } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(python, ['-I', managed ? guardian : script], { windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'] });
    let failure;
    let done = false;
    let bytes = 0;
    let heartbeat, forceStop;
    const received = [];
    const stop = (message) => {
      failure ??= new Error(message);
      if (managed) {
        clearInterval(heartbeat);
        child.stdin.end('{"v":1,"cancel":true}\n');
        forceStop ??= setTimeout(() => child.kill(), 2000);
      } else if (child.pid && process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
        killer.on('close', (code) => { if (code !== 0) child.kill(); });
      } else child.kill('SIGTERM');
    };
    const abort = () => stop('video_cancelled');
    const timer = timeoutMs > 0 ? setTimeout(() => stop('video_timeout'), timeoutMs) : undefined;
    signal?.addEventListener('abort', abort, { once: true });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (failure) return;
      bytes += Buffer.byteLength(line);
      if (line.length > 1024 * 1024 || bytes > 16 * 1024 * 1024) return stop('video_protocol_limit');
      try {
        const item = JSON.parse(line);
        if (done || item.v !== 1 || !events.has(item.event)) throw new Error();
        if (item.event === 'failed') failure = new Error('video_' + (typeof item.code === 'string'
          && /^[a-z_]{1,50}$/.test(item.code) ? item.code : 'engine_failed'));
        if (item.event === 'done') done = true;
        if (item.event !== 'progress' && item.event !== 'process_log') received.push(item);
        onEvent(item);
      } catch { stop('video_protocol_invalid'); }
    });
    child.once('error', () => { failure ??= new Error('video_runtime_unavailable'); });
    child.stdin.on('error', () => { /* child exit is handled below */ });
    child.once('close', (code) => {
      clearTimeout(timer);
      clearInterval(heartbeat); clearTimeout(forceStop);
      signal?.removeEventListener('abort', abort);
      lines.close();
      if (failure) reject(failure);
      else if (code !== 0 || !done) reject(new Error('video_engine_interrupted'));
      else accept(received);
    });
    if (signal?.aborted) abort();
    else if (managed) {
      const ttl = managed.heartbeatMs ?? 5000;
      child.stdin.write(JSON.stringify({ v: 1, root: managed.root ?? resolve('data/video-runtime/control'),
        directory: managed.directory ?? request.directory ?? (['preview', 'cover'].includes(request.action) ? dirname(request.target) : undefined), heartbeatMs: ttl,
        command: managed.command ?? [python, '-I', script],
        input: managed.command ? null : { ...request, v: 1 },
        format: managed.command ? 'lines' : 'ndjson' }) + '\n');
      heartbeat = setInterval(() => child.stdin.write('{"v":1,"heartbeat":true}\n'), Math.max(100, Math.floor(ttl / 3)));
    } else child.stdin.end(JSON.stringify({ ...request, v: 1 }) + '\n');
  });
}
