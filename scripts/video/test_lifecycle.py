import ctypes
from ctypes import wintypes
import importlib.util
import json
import os
import pathlib
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest

HERE = pathlib.Path(__file__).resolve().parent
FFMPEG = HERE.parents[1] / 'data/video-runtime/tools/ffmpeg.exe'


def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


jobs, locks = module('winjob'), module('locks')
FIXTURE = '''import json,os,subprocess,sys,time
r=json.loads(sys.stdin.buffer.readline())
p=subprocess.Popen([r['ffmpeg'],'-v','error','-re','-f','lavfi','-i','testsrc2=size=64x64:rate=5','-t',str(r.get('duration',60)),'-c:v','libx264','-threads','1','-f','null','-'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
print(json.dumps({'v':1,'event':'fixture','child':p.pid}),flush=True)
if r.get('orphan'):
 print('{"v":1,"event":"done"}',flush=True);os._exit(0)
p.wait()
print('{"v":1,"event":"done"}',flush=True)
'''


def process_handle(pid):
    api = jobs.kernel()
    api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    api.OpenProcess.restype = wintypes.HANDLE
    api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    api.WaitForSingleObject.restype = wintypes.DWORD
    handle = api.OpenProcess(0x100000, False, pid)
    if not handle and ctypes.get_last_error() not in (87, 1168):
        raise RuntimeError('Unable to observe test process')
    return api, handle


def dead(pid, timeout=5000):
    api, handle = process_handle(pid)
    if not handle:
        return True
    try:
        return api.WaitForSingleObject(handle, timeout) == 0
    finally:
        api.CloseHandle(handle)


class Controller:
    def __init__(self, root, fixture, *, directory=None, heartbeat=True, **payload):
        self.process = subprocess.Popen([sys.executable, '-I', str(HERE / 'guardian.py')], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8')
        self.messages = queue.Queue(); self.events = []; self.stop = threading.Event()
        self.process.stdin.write(json.dumps({'v': 1, 'root': str(root), 'directory': str(directory) if directory else None,
            'heartbeatMs': 800, 'command': [sys.executable, '-I', str(fixture)],
            'input': {'ffmpeg': str(FFMPEG), **payload}}) + '\n'); self.process.stdin.flush()
        def read():
            for line in self.process.stdout:
                self.messages.put(json.loads(line))
        self.reader = threading.Thread(target=read, daemon=True); self.reader.start()
        def beat():
            while not self.stop.wait(0.1):
                try:
                    self.process.stdin.write('{"v":1,"heartbeat":true}\n'); self.process.stdin.flush()
                except (OSError, ValueError):
                    return
        self.beater = threading.Thread(target=beat, daemon=True) if heartbeat else None
        if self.beater: self.beater.start()

    def event(self, kind, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try: item = self.messages.get(timeout=0.1)
            except queue.Empty: continue
            self.events.append(item)
            if item['event'] == kind: return item
        raise AssertionError('Missing lifecycle event: ' + kind + ' ' + str(self.events))

    def pause_heartbeat(self):
        self.stop.set()
        if self.beater: self.beater.join(timeout=2)

    def close(self):
        self.pause_heartbeat()
        if not self.process.stdin.closed:
            try: self.process.stdin.close()
            except OSError: pass  # Windows may report EINVAL when a killed peer closed the pipe.
        try: self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill(); self.process.wait(timeout=10)
        self.reader.join(timeout=2)
        self.process.stdout.close()


@unittest.skipUnless(sys.platform == 'win32', 'Windows process job tests')
class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mowo-lifecycle-')
        self.root = pathlib.Path(self.temp.name)
        self.fixture = self.root / 'fixture.py'; self.fixture.write_text(FIXTURE, encoding='utf-8')
        self.controllers = []

    def start(self, **options):
        controller = Controller(self.root / 'runtime', self.fixture, **options)
        self.controllers.append(controller); return controller

    def tearDown(self):
        for controller in self.controllers: controller.close()
        self.temp.cleanup()

    def test_normal_completion_stops_tree_and_releases_slot(self):
        c = self.start(duration=0.2); pid = c.event('fixture')['child']; c.event('done'); c.close()
        self.assertTrue(dead(pid))
        self.assertEqual(c.events[-2], {'v': 1, 'event': 'managed', 'state': 'stopped'})
        with locks.ExclusiveLock(self.root / 'runtime/execution.lock'): pass

    def test_parent_pipe_closing_kills_ffmpeg(self):
        c = self.start(); pid = c.event('fixture')['child']; c.close()
        self.assertTrue(dead(pid))

    def test_lost_heartbeat_kills_ffmpeg(self):
        c = self.start(); pid = c.event('fixture')['child']; c.pause_heartbeat()
        self.assertEqual(c.event('failed')['code'], 'heartbeat_lost'); c.close()
        self.assertTrue(dead(pid))

    def test_guardian_crash_closes_job_and_kills_ffmpeg(self):
        c = self.start(); pid = c.event('fixture')['child']
        c.process.kill(); c.process.wait(timeout=10)
        self.assertTrue(dead(pid)); c.close()

    def test_competing_guardian_cannot_start_or_kill_active_work(self):
        c = self.start(); pid = c.event('fixture')['child']
        other = self.start(); self.assertEqual(other.event('failed')['code'], 'execution_slot_busy')
        self.assertFalse(dead(pid, timeout=0))

    def test_takeover_reaps_old_tree_even_when_a_job_handle_outlives_guardian(self):
        c = self.start(); old_pid = c.event('fixture')['child']
        api = jobs.kernel(); handle = api.OpenJobObjectW(4, False, jobs.name_for(self.root / 'runtime'))
        self.assertTrue(handle)
        try:
            c.process.kill(); c.process.wait(timeout=10)
            self.assertFalse(dead(old_pid, timeout=0), 'the fixture must reproduce an old process surviving')
            other = self.start(); other.event('fixture')
            self.assertTrue(dead(old_pid, timeout=0), 'new work must wait until the old job is empty')
            self.assertEqual(other.events[0], {'v': 1, 'event': 'managed', 'state': 'reaping'})
        finally:
            api.CloseHandle(handle)

    def test_worker_exiting_does_not_leave_orphan_ffmpeg(self):
        c = self.start(orphan=True); pid = c.event('fixture')['child']; c.event('done'); c.close()
        self.assertTrue(dead(pid))


if __name__ == '__main__':
    unittest.main()
