import importlib.util
import pathlib
import struct
import subprocess
import sys
import tempfile
import unittest
from email.message import Message
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('auth', pathlib.Path(__file__).with_name('auth.py'))
auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auth)


class AuthTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'win32', 'Windows DPAPI')
    def test_encrypted_save_survives_another_process_and_corruption_is_reported(self):
        with tempfile.TemporaryDirectory(prefix='mowo-credential-') as directory:
            path = pathlib.Path(directory) / 'credential.dat'
            auth.save_credentials(path, {'SESSDATA': 'TEST_SECRET', 'other': 'drop'})
            self.assertNotIn(b'TEST_SECRET', path.read_bytes())
            self.assertEqual(auth.read_credentials(path), {'SESSDATA': 'TEST_SECRET'})
            # A new Python process must read the credential; no module global is involved.
            code = ('import importlib.util,json; s=importlib.util.spec_from_file_location("a",' +
                    repr(str(pathlib.Path(auth.__file__))) + '); a=importlib.util.module_from_spec(s);'
                    's.loader.exec_module(a); print(a.read_credentials(' + repr(str(path)) + ') == {"SESSDATA":"TEST_SECRET"})')
            result = subprocess.run([sys.executable, '-I', '-c', code], capture_output=True, check=True)
            self.assertEqual(result.stdout.strip(), b'True')
            damaged = bytearray(path.read_bytes()); damaged[-1] ^= 1; path.write_bytes(damaged)
            with self.assertRaisesRegex(ValueError, 'credential_unavailable'):
                auth.read_credentials(path)
            result = auth.run({'v': 1, 'action': 'logout', 'credentialFile': str(path)})
            self.assertFalse(result['loggedIn'])
            self.assertFalse(path.exists())

    def test_callback_is_parsed_without_fetching_it(self):
        headers = Message(); headers.add_header('Set-Cookie', 'SESSDATA=COOKIE; Secure; Path=/')
        self.assertEqual(auth.cookies_from_poll({'url': 'https://evil.test/?SESSDATA=EVIL'}, headers), {'SESSDATA': 'COOKIE'})
        self.assertEqual(auth.cookies_from_poll({'url': 'https://passport.bilibili.com/?SESSDATA=OK&other=NO'}, Message()), {'SESSDATA': 'OK'})

    def test_poll_does_not_store_credentials_before_session_verification(self):
        payload = {'code': 0, 'data': {'code': 0, 'url': 'https://passport.bilibili.com/?SESSDATA=TEST'}}
        with patch.object(auth, 'api', return_value=(payload, Message())), patch.object(auth, 'verify', return_value=False), patch.object(auth, 'save_credentials') as save:
            with self.assertRaisesRegex(ValueError, 'session_invalid'):
                auth.run({'v': 1, 'action': 'poll', 'key': 'valid-key', 'credentialFile': 'unused'})
            save.assert_not_called()

    def test_qr_statuses(self):
        for code, status in [(86101, 'waiting'), (86090, 'scanned'), (86038, 'expired')]:
            with patch.object(auth, 'api', return_value=({'code': 0, 'data': {'code': code}}, Message())):
                self.assertEqual(auth.run({'v': 1, 'action': 'poll', 'key': 'valid'})['status'], status)

    def test_official_account_qr_host_is_accepted_but_lookalikes_are_rejected(self):
        for host, accepted in [('account.bilibili.com', True), ('passport.bilibili.com', True), ('account.bilibili.com.evil.test', False)]:
            payload = {'code': 0, 'data': {'qrcode_key': 'key', 'url': 'https://' + host + '/login?secret=key'}}
            with self.subTest(host=host), patch.object(auth, 'api', return_value=(payload, Message())):
                if accepted:
                    self.assertEqual(auth.run({'v': 1, 'action': 'generate'})['event'], 'qr')
                else:
                    with self.assertRaisesRegex(ValueError, 'qr_unavailable'):
                        auth.run({'v': 1, 'action': 'generate'})

    def test_qr_is_a_local_png_without_external_image_service(self):
        import base64
        data = base64.b64decode(auth.qr_png('https://passport.bilibili.com/test'))
        self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
        width, height = struct.unpack('>II', data[16:24])
        self.assertEqual(width, height)
        self.assertGreater(width, 100)


if __name__ == '__main__':
    unittest.main()
