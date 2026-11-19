import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import unittest

source = pathlib.Path(__file__).with_name('locks.py')
spec = importlib.util.spec_from_file_location('locks', source)
locks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(locks)


def child_code(path, hold=False):
    return ('import importlib.util; s=importlib.util.spec_from_file_location("l",' + repr(str(source)) + ');'
            'l=importlib.util.module_from_spec(s); s.loader.exec_module(l);'
            'lock=l.ExclusiveLock(' + repr(str(path)) + '); print(lock.acquire(),flush=True);' +
            ('import time; time.sleep(60)' if hold else 'lock.release()'))


class LockTests(unittest.TestCase):
    def test_competing_process_cannot_take_held_slot(self):
        with tempfile.TemporaryDirectory(prefix='mowo-lock-') as directory:
            path = pathlib.Path(directory) / 'slot.lock'
            with locks.ExclusiveLock(path):
                result = subprocess.run([sys.executable, '-I', '-c', child_code(path)], capture_output=True, check=True, timeout=10)
                self.assertEqual(result.stdout.strip(), b'False')
            with locks.ExclusiveLock(path):
                pass

    def test_killed_worker_releases_os_lock(self):
        with tempfile.TemporaryDirectory(prefix='mowo-lock-') as directory:
            path = pathlib.Path(directory) / 'slot.lock'
            child = subprocess.Popen([sys.executable, '-I', '-c', child_code(path, hold=True)], stdout=subprocess.PIPE)
            try:
                self.assertEqual(child.stdout.readline().strip(), b'True')
                competing = locks.ExclusiveLock(path)
                self.assertFalse(competing.acquire())
                child.kill()
                child.wait(timeout=10)
                self.assertTrue(competing.acquire())
                competing.release()
            finally:
                if child.poll() is None:
                    child.kill(); child.wait(timeout=10)
                child.stdout.close()

    def test_new_leader_does_not_imply_free_execution_slot(self):
        with tempfile.TemporaryDirectory(prefix='mowo-lock-') as directory:
            slot = pathlib.Path(directory) / 'slot.lock'
            leader = pathlib.Path(directory) / 'leader.lock'
            with locks.ExclusiveLock(slot):
                with locks.ExclusiveLock(leader):
                    pass  # The former coordinator exits while its worker still holds the slot.
                with locks.ExclusiveLock(leader):
                    result = subprocess.run([sys.executable, '-I', '-c', child_code(slot)], capture_output=True, check=True, timeout=10)
                    self.assertEqual(result.stdout.strip(), b'False')


if __name__ == '__main__':
    unittest.main()
