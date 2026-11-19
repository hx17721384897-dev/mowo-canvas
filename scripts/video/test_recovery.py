import hashlib
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import pathlib
import re
import tempfile
import threading
import unittest
import yt_dlp
from yt_dlp.downloader.http import HttpFD

spec = importlib.util.spec_from_file_location('recovery', pathlib.Path(__file__).with_name('recovery.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class IdentityTests(unittest.TestCase):
    def test_expiring_query_can_change_but_not_media_identity(self):
        info = {'id': 'BV1xx411c7mu_p1', 'formats': [{'format_id': 'v', 'width': 1920, 'url': 'https://cdn.test/blob?token=SECRET'}]}
        with tempfile.TemporaryDirectory(prefix='mowo-resume-') as directory:
            self.assertEqual(recovery.prepare(directory, 'public-video-url', info, ['v'], 'pinned'), 0)
            path = pathlib.Path(directory) / 'source.mp4.part'; path.write_bytes(b'partial')
            manifest = (path.parent / 'identity.json').read_text()
            self.assertNotIn('SECRET', manifest)
            info['formats'][0]['url'] = 'https://other-cdn.test/blob?token=REFRESHED'
            self.assertEqual(recovery.prepare(directory, 'public-video-url', info, ['v'], 'pinned'), 7)
            info['formats'][0]['width'] = 1280
            with self.assertRaisesRegex(ValueError, 'resume_identity_changed'):
                recovery.prepare(directory, 'public-video-url', info, ['v'], 'pinned')
            self.assertEqual(path.read_bytes(), b'partial')

    def test_unverified_partial_is_preserved_and_rejected(self):
        with tempfile.TemporaryDirectory(prefix='mowo-resume-') as directory:
            path = pathlib.Path(directory) / 'source.mp4.part'; path.write_bytes(b'keep')
            info = {'id': 'id', 'formats': [{'format_id': 'v', 'url': 'https://cdn.test/blob'}]}
            with self.assertRaisesRegex(ValueError, 'resume_unverified'):
                recovery.prepare(directory, 'public', info, ['v'], 'version')
            self.assertEqual(path.read_bytes(), b'keep')

    def test_changed_part_or_extractor_requires_explicit_retry(self):
        with tempfile.TemporaryDirectory(prefix='mowo-resume-') as directory:
            info = {'id': 'p1', 'formats': [{'format_id': 'v', 'url': 'https://cdn.test/blob'}]}
            recovery.prepare(directory, 'public?p=1', info, ['v'], 'a')
            for url, version in [('public?p=2', 'a'), ('public?p=1', 'b')]:
                with self.assertRaisesRegex(ValueError, 'resume_identity_changed'):
                    recovery.prepare(directory, url, info, ['v'], version)


class RangeTests(unittest.TestCase):
    def test_range_resume_and_server_ignoring_range_both_preserve_correct_output(self):
        payload = bytes(range(256)) * 8192
        for supports_range in [True, False]:
            requests = []
            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *_): pass
                def do_GET(self):
                    header = self.headers.get('Range', '')
                    requests.append(header)
                    match = re.fullmatch(r'bytes=(\d+)-', header)
                    offset = int(match[1]) if match and supports_range else 0
                    self.send_response(206 if offset else 200)
                    self.send_header('Content-Length', str(len(payload) - offset))
                    if offset:
                        self.send_header('Content-Range', 'bytes %d-%d/%d' % (offset, len(payload) - 1, len(payload)))
                    self.end_headers()
                    self.wfile.write(payload[offset:])
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                with self.subTest(supports_range=supports_range), tempfile.TemporaryDirectory(prefix='mowo-range-') as directory:
                    target = pathlib.Path(directory) / 'media.bin'
                    partial = target.with_suffix('.bin.part'); partial.write_bytes(payload[:512 * 1024])
                    with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True, 'proxy': '', 'cachedir': False}) as ydl:
                        download = HttpFD(ydl, {'continuedl': True, 'quiet': True, 'noprogress': True})
                        self.assertTrue(download.real_download(str(target), {'url': 'http://127.0.0.1:%d/media' % server.server_port,
                            'http_headers': {}, 'ext': 'bin'}))
                    self.assertEqual(requests[0], 'bytes=524288-')
                    self.assertEqual(hashlib.sha256(target.read_bytes()).digest(), hashlib.sha256(payload).digest())
                    self.assertFalse(partial.exists())
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=5)


if __name__ == '__main__':
    unittest.main()
