"""Own the slot and kernel job until every descendant has stopped writing."""
import importlib.util
import json
import os
import pathlib
import queue
import subprocess
import sys
import threading
import time


def sibling(name):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


def emit(event, **data):
    print(json.dumps({'v': 1, 'event': event, **data}), flush=True)


def pump(stream, kind, messages):
    try:
        for line in stream:
            messages.put((kind, line))
    finally:
        messages.put((kind, None))


def run(envelope):
    if envelope.get('v') != 1:
        raise ValueError('protocol_version')
    locks, jobs = sibling('locks'), sibling('winjob')
    root = pathlib.Path(envelope['root']).resolve()
    root.mkdir(parents=True, exist_ok=True)
    slot = locks.ExclusiveLock(root / 'execution.lock')
    directory = envelope.get('directory')
    task = locks.ExclusiveLock(pathlib.Path(directory).resolve() / '.task.lock') if directory else None
    job = None; process = None
    if not slot.acquire():
        raise ValueError('execution_slot_busy')
    try:
        if task and not task.acquire():
            raise ValueError('task_directory_busy')
        job_name = jobs.name_for(root)
        job = jobs.ProcessJob(job_name)
        if job.active():
            emit('managed', state='reaping')
            job.terminate()
            if not job.empty():
                raise ValueError('process_tree_unconfirmed')
        messages = queue.Queue(maxsize=1000)
        threading.Thread(target=pump, args=(sys.stdin, 'control', messages), daemon=True).start()
        environment = dict(os.environ, MOWO_VIDEO_JOB=job_name)
        process = subprocess.Popen([sys.executable, '-I', str(pathlib.Path(__file__).with_name('managed-worker.py'))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT if envelope.get('format') == 'lines' else subprocess.DEVNULL,
            text=True, encoding='utf-8', errors='replace', env=environment,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        threading.Thread(target=pump, args=(process.stdout, 'output', messages), daemon=True).start()
        dispatched = False; output_closed = False; worker_done = False
        last_heartbeat = time.monotonic(); started = last_heartbeat
        ttl = envelope.get('heartbeatMs', 5000)
        if not isinstance(ttl, int) or not 500 <= ttl <= 30000:
            raise ValueError('invalid_heartbeat')
        while True:
            now = time.monotonic()
            if now - last_heartbeat > ttl / 1000:
                raise ValueError('heartbeat_lost')
            if not dispatched and now - started > 10:
                raise ValueError('managed_start_failed')
            try:
                kind, line = messages.get(timeout=0.05)
            except queue.Empty:
                kind, line = None, None
            if kind == 'control':
                if line is None:
                    raise ValueError('parent_closed')
                data = json.loads(line)
                if data == {'v': 1, 'heartbeat': True}:
                    last_heartbeat = now
                elif data == {'v': 1, 'cancel': True}:
                    raise ValueError('cancelled')
                else:
                    raise ValueError('control_invalid')
            elif kind == 'output':
                if line is None:
                    output_closed = True
                elif not dispatched:
                    ready = json.loads(line)
                    if ready.get('event') == 'failed' and ready.get('code') in ('job_unavailable', 'job_assignment_failed'):
                        raise ValueError(ready['code'])
                    if ready != {'v': 1, 'event': 'managed_ready'}:
                        raise ValueError('managed_start_failed')
                    process.stdin.write(json.dumps({'command': envelope['command'], 'input': envelope.get('input')}) + '\n')
                    process.stdin.close()
                    dispatched = True
                    emit('managed', state='running')
                elif envelope.get('format') == 'lines':
                    emit('process_log', message=line.rstrip()[:4096])
                else:
                    # The Node protocol boundary validates every forwarded event.
                    if json.loads(line).get('event') == 'done':
                        worker_done = True
                    else:
                        sys.stdout.write(line); sys.stdout.flush()
            if process.poll() is not None:
                # Kill orphaned descendants even if the immediate worker exited normally.
                if job.active():
                    job.terminate()
                if job.empty() and output_closed:
                    emit('managed', state='stopped')
                    if worker_done or envelope.get('format') == 'lines':
                        emit('done')
                    return process.returncode
    finally:
        if job:
            try:
                if job.active():
                    job.terminate()
                if not job.empty():
                    raise ValueError('process_tree_unconfirmed')
            finally:
                job.close()
        if process:
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
            process.wait(timeout=10)
            process.stdout.close()
        if task:
            task.release()
        slot.release()


def main():
    try:
        sys.stdin.reconfigure(encoding='utf-8', errors='strict')
        line = sys.stdin.readline(65537)
        if not line or len(line) > 65536:
            raise ValueError('invalid_request')
        return run(json.loads(line))
    except Exception as error:
        known = {'protocol_version', 'execution_slot_busy', 'task_directory_busy', 'process_tree_unconfirmed',
                 'invalid_heartbeat', 'heartbeat_lost', 'parent_closed', 'cancelled', 'control_invalid',
                 'managed_start_failed', 'job_unavailable', 'job_assignment_failed', 'windows_required', 'invalid_request'}
        emit('failed', code=str(error) if str(error) in known else 'guardian_failed')
        return 1


if __name__ == '__main__':
    sys.exit(main())
