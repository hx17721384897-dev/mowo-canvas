"""Windows kernel job ownership. Handles are never inherited by workers."""
import ctypes
from ctypes import wintypes
import hashlib
import pathlib
import sys
import time


class Limits(ctypes.Structure):
    _fields_ = [('process_time', ctypes.c_longlong), ('job_time', ctypes.c_longlong),
                ('flags', wintypes.DWORD), ('min_ws', ctypes.c_size_t), ('max_ws', ctypes.c_size_t),
                ('process_limit', wintypes.DWORD), ('affinity', ctypes.c_size_t),
                ('priority', wintypes.DWORD), ('scheduling', wintypes.DWORD)]


class Io(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in ('reads', 'writes', 'other', 'read_bytes', 'write_bytes', 'other_bytes')]


class ExtendedLimits(ctypes.Structure):
    _fields_ = [('basic', Limits), ('io', Io), ('process_memory', ctypes.c_size_t),
                ('job_memory', ctypes.c_size_t), ('peak_process_memory', ctypes.c_size_t), ('peak_job_memory', ctypes.c_size_t)]


class Accounting(ctypes.Structure):
    _fields_ = [(name, ctypes.c_longlong) for name in ('user', 'kernel', 'period_user', 'period_kernel')] + [
        (name, wintypes.DWORD) for name in ('faults', 'total', 'active', 'terminated')]


def kernel():
    if sys.platform != 'win32':
        raise ValueError('windows_required')
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    definitions = {
        'CreateJobObjectW': ([ctypes.c_void_p, wintypes.LPCWSTR], wintypes.HANDLE),
        'OpenJobObjectW': ([wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR], wintypes.HANDLE),
        'SetInformationJobObject': ([wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD], wintypes.BOOL),
        'QueryInformationJobObject': ([wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p], wintypes.BOOL),
        'AssignProcessToJobObject': ([wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
        'TerminateJobObject': ([wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
        'CloseHandle': ([wintypes.HANDLE], wintypes.BOOL),
        'GetCurrentProcess': ([], wintypes.HANDLE),
    }
    for name, (arguments, result) in definitions.items():
        function = getattr(api, name); function.argtypes = arguments; function.restype = result
    return api


def name_for(root):
    identity = str(pathlib.Path(root).resolve()).casefold().encode('utf-8')
    return 'Local\\MOWO.Video.' + hashlib.sha256(identity).hexdigest()[:32]


class ProcessJob:
    def __init__(self, name):
        self.api = kernel()
        self.handle = self.api.CreateJobObjectW(None, name)
        if not self.handle:
            raise ValueError('job_unavailable')
        limits = ExtendedLimits(); limits.basic.flags = 0x2000  # KILL_ON_JOB_CLOSE, no breakaway.
        if not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.close(); raise ValueError('job_unavailable')

    def active(self):
        data = Accounting()
        if not self.api.QueryInformationJobObject(self.handle, 1, ctypes.byref(data), ctypes.sizeof(data), None):
            raise ValueError('process_tree_unconfirmed')
        return data.active

    def terminate(self):
        if not self.api.TerminateJobObject(self.handle, 1):
            raise ValueError('process_tree_unconfirmed')

    def empty(self, timeout=5):
        deadline = time.monotonic() + timeout
        while self.active():
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.02)
        return True

    def close(self):
        if self.handle:
            self.api.CloseHandle(self.handle); self.handle = None


def attach(name):
    api = kernel()
    handle = api.OpenJobObjectW(1, False, name)  # Only ASSIGN_PROCESS.
    if not handle:
        raise ValueError('job_unavailable')
    try:
        if not api.AssignProcessToJobObject(handle, api.GetCurrentProcess()):
            raise ValueError('job_assignment_failed')
    finally:
        api.CloseHandle(handle)
