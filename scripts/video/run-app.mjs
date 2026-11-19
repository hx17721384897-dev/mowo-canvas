// Local application entry: one protected Next tree and one protected video executor.
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { invokeEngine } from './engine-client.mjs';
import nextEnvironment from '@next/env';
import { access, readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const mode = args.shift();
nextEnvironment.loadEnvConfig(process.cwd(), mode === 'dev');
const videoIndex = args.indexOf('--video');
const video = videoIndex >= 0;
if (video) args.splice(videoIndex, 1);
if (mode !== 'dev' && mode !== 'start') throw new Error('Use run-app.mjs dev|start [--project directory] [Next options]');
const index = args.indexOf('--project');
const project = index < 0 ? process.cwd() : resolve(args.splice(index, 2)[1]);
const configuredRoot = process.env.MOWO_DATA_ROOT?.trim();
const dataRoot = configuredRoot ? resolve(configuredRoot) : join(homedir(), 'Documents', 'MOWO Canvas Data');
const configuredControl = process.env.MOWO_APP_CONTROL_ROOT?.trim();
const controlRoot = configuredControl ? resolve(configuredControl) : join(dataRoot, 'runtime/application');
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
let executor;
try {
  if (video) {
    const manifest = JSON.parse(await readFile(new URL('./python-runtime.json', import.meta.url), 'utf8'));
    try {
      await Promise.all([resolve('data/video-runtime', manifest.directory, 'python.exe'), resolve('data/video-runtime/tools/ffmpeg.exe'), resolve('data/video-runtime/tools/ffprobe.exe')].map(path => access(path)));
      const health = await invokeEngine({ action: 'health' });
      if (health[0].python !== manifest.version) throw new Error();
    } catch { throw new Error('视频运行环境未准备好，请运行 npm run video:setup 后重试。'); }
    let ready, failed;
    const started = new Promise((accept, reject) => { ready = accept; failed = reject; });
    executor = invokeEngine({}, { timeoutMs: 0, signal: stop.signal,
      managed: { root: join(dataRoot, 'runtime/video-executor'), command: [process.execPath,
        '--no-warnings', '--experimental-strip-types', resolve('scripts/video/service.ts')] },
      onEvent: event => {
        if (event.event === 'process_log' && event.message.includes('Video download service ready')) ready();
      },
    });
    executor.catch(error => { failed(error); stop.abort(); });
    executor.then(() => { failed(new Error('video_service_stopped')); stop.abort(); }, () => {});
    const timer = setTimeout(() => failed(new Error('video_service_start_timeout')), 30000);
    try { await started; } finally { clearTimeout(timer); }
  }
  await invokeEngine({}, { timeoutMs: 0, signal: stop.signal,
    managed: { root: controlRoot, command: [process.execPath, resolve('node_modules/next/dist/bin/next'), mode, project, ...args] },
    onEvent: event => { if (event.event === 'process_log') process.stdout.write(event.message + '\n'); },
  });
  stop.abort();
} catch (error) {
  if (!(error instanceof Error) || error.message !== 'video_cancelled') {
    console.error(error instanceof Error ? error.message : 'Application lifecycle failed'); process.exitCode = 1;
  }
} finally { stop.abort(); if (executor) await executor.catch(() => {}); }
