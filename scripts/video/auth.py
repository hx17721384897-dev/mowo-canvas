"""Bilibili QR experiment: credentials never leave this process as plaintext."""
import base64
import ctypes
from ctypes import wintypes
import http.cookies
import json
import os
import pathlib
import re
import struct
import sys
import tempfile
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlencode, urlparse
import zlib

ALLOWED = {'SESSDATA', 'bili_jct', 'DedeUserID', 'buvid3', 'buvid4'}
MAGIC = b'MOWOBILI1\x00'
ENTROPY = b'MOWO Bilibili credentials v1'
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
           'Referer': 'https://www.bilibili.com/'}


class Blob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]


def protect(data, decrypt=False):
    if sys.platform != 'win32':
        raise ValueError('windows_required')
    # Keep backing arrays alive until the native call has completed.
    source_array = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    entropy_array = (ctypes.c_ubyte * len(ENTROPY)).from_buffer_copy(ENTROPY)
    source = Blob(len(data), source_array)
    entropy = Blob(len(ENTROPY), entropy_array)
    output = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob),
                         ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not function(ctypes.byref(source), None, ctypes.byref(entropy), None, None, 1, ctypes.byref(output)):
        raise ValueError('credential_unavailable')
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel.LocalFree(output.pbData)


def read_credentials(path):
    path = pathlib.Path(path)
    if not path.exists():
        return {}
    if path.stat().st_size > 65536:
        raise ValueError('credential_unavailable')
    content = path.read_bytes()
    if not content.startswith(MAGIC):
        raise ValueError('credential_unavailable')
    try:
        result = json.loads(protect(content[len(MAGIC):], decrypt=True))
        if not isinstance(result, dict) or not result.get('SESSDATA'):
            raise ValueError()
        return {k: v for k, v in result.items() if k in ALLOWED and isinstance(v, str)}
    except Exception:
        raise ValueError('credential_unavailable') from None


def save_credentials(path, cookies):
    if not cookies.get('SESSDATA'):
        raise ValueError('credential_missing')
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = MAGIC + protect(json.dumps({k: v for k, v in cookies.items() if k in ALLOWED}).encode('utf-8'))
    fd, temporary = tempfile.mkstemp(prefix='.credential-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api(url, cookies=None):
    # Callers only use hard-coded official API endpoints. Never follow login callbacks.
    headers = dict(HEADERS)
    if cookies:
        headers['Cookie'] = '; '.join(k + '=' + v for k, v in cookies.items() if k in ALLOWED)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(urllib.request.Request(url, headers=headers), timeout=15) as response:
        body = response.read(2 * 1024 * 1024 + 1)
        if len(body) > 2 * 1024 * 1024:
            raise ValueError('platform_response_invalid')
        return json.loads(body), response.headers


def verify(cookies):
    if not cookies.get('SESSDATA'):
        return False
    data, _ = api('https://api.bilibili.com/x/web-interface/nav', cookies)
    return data.get('code') == 0 and data.get('data', {}).get('isLogin') is True


def cookies_from_poll(data, headers):
    cookies = {}
    # Cookie values in a callback are parsed locally; the URL is never fetched or logged.
    callback = urlparse(data.get('url', ''))
    if callback.scheme == 'https' and callback.hostname in ('passport.bilibili.com', 'passport.biligame.com'):
        cookies.update({k: v[-1] for k, v in parse_qs(callback.query).items() if k in ALLOWED})
    for raw in headers.get_all('Set-Cookie', []):
        jar = http.cookies.SimpleCookie()
        jar.load(raw)
        cookies.update({k: v.value for k, v in jar.items() if k in ALLOWED})
    return cookies


def qr_png(text):
    import qrcode
    matrix = qrcode.QRCode(border=4, box_size=1)
    matrix.add_data(text)
    matrix.make(fit=True)
    rows = matrix.get_matrix()
    scale = 5
    size = len(rows) * scale
    pixels = b''.join((b'\x00' + bytes(0 if item else 255 for item in row for _ in range(scale))) * scale for row in rows)
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    image = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 0, 0, 0, 0))
    image += chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')
    return base64.b64encode(image).decode('ascii')


def run(request):
    if request.get('v') != 1:
        raise ValueError('protocol_version')
    action = request.get('action')
    if action == 'generate':
        result, _ = api('https://passport.bilibili.com/x/passport-login/web/qrcode/generate')
        data = result.get('data') or {}
        key = data.get('qrcode_key', '')
        url = data.get('url', '')
        if result.get('code') != 0 or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', key):
            raise ValueError('qr_unavailable')
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.hostname not in ('passport.bilibili.com', 'account.bilibili.com') or parsed.username or parsed.port not in (None, 443):
            raise ValueError('qr_unavailable')
        return {'event': 'qr', 'key': key, 'image': qr_png(url), 'expiresIn': 180}
    if action == 'poll':
        key = request.get('key', '')
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', key):
            raise ValueError('invalid_qr_key')
        result, headers = api('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?' + urlencode({'qrcode_key': key}))
        if result.get('code') != 0:
            raise ValueError('qr_unavailable')
        data = result.get('data') or {}
        code = data.get('code')
        status = {86101: 'waiting', 86090: 'scanned', 86038: 'expired'}.get(code)
        if status:
            return {'event': 'qr_status', 'status': status}
        if code != 0:
            raise ValueError('qr_unavailable')
        cookies = cookies_from_poll(data, headers)
        if not verify(cookies):
            raise ValueError('session_invalid')
        save_credentials(request['credentialFile'], cookies)
        return {'event': 'qr_status', 'status': 'success'}
    if action == 'status':
        cookies = read_credentials(request['credentialFile'])
        return {'event': 'auth', 'loggedIn': verify(cookies), 'stored': bool(cookies)}
    if action == 'logout':
        pathlib.Path(request['credentialFile']).unlink(missing_ok=True)
        return {'event': 'auth', 'loggedIn': False, 'stored': False}
    raise ValueError('unsupported_action')


def main():
    try:
        line = sys.stdin.buffer.readline(65537)
        if len(line) > 65536:
            raise ValueError('invalid_request')
        request = json.loads(line)
        result = run(request)
        print(json.dumps({'v': 1, **result}), flush=True)
        print(json.dumps({'v': 1, 'event': 'done'}), flush=True)
        return 0
    except Exception as error:
        allowed = {'windows_required', 'credential_unavailable', 'credential_missing', 'invalid_request',
                   'protocol_version', 'qr_unavailable', 'invalid_qr_key', 'session_invalid', 'unsupported_action'}
        code = str(error) if str(error) in allowed else 'auth_unavailable'
        if isinstance(error, urllib.error.HTTPError) and error.code in (412, 429):
            code = 'platform_rejected'
        print(json.dumps({'v': 1, 'event': 'failed', 'code': code}), flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
