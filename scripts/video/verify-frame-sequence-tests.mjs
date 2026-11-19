import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const runtime = JSON.parse(readFileSync('scripts/video/python-runtime.json', 'utf8'));
if (!/^python-[\d.]+$/.test(runtime.directory)) throw new Error('Invalid media runtime');
const steps = [
  [process.execPath, ['--no-warnings', '--experimental-strip-types', 'src/features/frame-extraction/video-frame-policy.test.ts']],
  [resolve('data/video-runtime', runtime.directory, 'python.exe'), ['-I', 'scripts/video/test_frame_sequence.py']],
  [process.execPath, ['--no-warnings', '--experimental-strip-types', '--test', 'src/features/frame-extraction/server/video-frame-runtime.test.ts']],
  [process.execPath, ['--no-warnings', '--experimental-strip-types', '--test', 'src/features/frame-extraction/server/video-frame-job-store.test.ts', 'src/features/frame-extraction/server/video-frame-executor.test.ts']],
];
for (const [command, args] of steps) {
  const result = spawnSync(command, args, { windowsHide: true, stdio: 'inherit', timeout: 120000 });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
