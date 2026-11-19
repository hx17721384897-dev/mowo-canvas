"""Attach before spawning any application/engine descendants; wait for dispatch."""
import importlib.util
import json
import os
import pathlib
import subprocess
import sys

spec = importlib.util.spec_from_file_location('winjob', pathlib.Path(__file__).with_name('winjob.py'))
job = importlib.util.module_from_spec(spec); spec.loader.exec_module(job)


def main():
    job.attach(os.environ['MOWO_VIDEO_JOB'])
    print('{"v":1,"event":"managed_ready"}', flush=True)
    line = sys.stdin.buffer.readline(65537)
    if not line or len(line) > 65536:
        return 1
    envelope = json.loads(line)
    command = envelope['command']
    if not isinstance(command, list) or not command or not all(isinstance(item, str) for item in command):
        return 1
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=sys.stdout, stderr=sys.stderr,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    payload = envelope.get('input')
    process.communicate(None if payload is None else (json.dumps(payload) + '\n').encode('utf-8'))
    return process.returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        code = str(error) if str(error) in ('job_unavailable', 'job_assignment_failed') else 'managed_start_failed'
        print(json.dumps({'v': 1, 'event': 'failed', 'code': code, 'errorClass': type(error).__name__,
                          'nativeError': getattr(error, 'winerror', None)}), flush=True)
        sys.exit(1)
