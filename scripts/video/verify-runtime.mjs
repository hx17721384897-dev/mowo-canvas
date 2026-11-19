import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const manifest = JSON.parse(await readFile(new URL('./python-runtime.json', import.meta.url), 'utf8'));
for (const name of ['test_worker.py', 'test_auth.py', 'test_locks.py', 'test_media.py', 'test_recovery.py', 'test_lifecycle.py']) {
  const child = spawn(resolve('data/video-runtime', manifest.directory, 'python.exe'), ['-I', resolve('scripts/video', name)], { windowsHide: true, stdio: 'inherit' });
  if ((await once(child, 'exit'))[0] !== 0) { process.exitCode = 1; break; }
}
