"""OS-backed lock primitive; never unlink a lock file while processes may use it."""
import pathlib
import sys


class ExclusiveLock:
    def __init__(self, path):
        self.path = pathlib.Path(path)
        self.file = None

    def acquire(self):
        if self.file is not None:
            return True
        self.path.parent.mkdir(parents=True, exist_ok=True)
        file = self.path.open('a+b')
        try:
            if file.seek(0, 2) == 0:
                file.write(b'\x00')
                file.flush()
            file.seek(0)
            if sys.platform == 'win32':
                import msvcrt
                msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            file.close()
            if error.errno in (11, 13, 35, 36):
                return False
            raise
        self.file = file
        return True

    def release(self):
        if self.file is None:
            return
        file = self.file
        self.file = None
        try:
            file.seek(0)
            if sys.platform == 'win32':
                import msvcrt
                msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(file.fileno(), fcntl.LOCK_UN)
        finally:
            file.close()

    def __enter__(self):
        if not self.acquire():
            raise BlockingIOError('video_lock_busy')
        return self

    def __exit__(self, *_):
        self.release()
