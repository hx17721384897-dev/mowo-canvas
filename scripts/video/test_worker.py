import contextlib
import importlib.util
import io
import pathlib
import unittest
from unittest.mock import patch, MagicMock
import urllib.error

spec = importlib.util.spec_from_file_location('worker', pathlib.Path(__file__).with_name('worker.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class BoundaryTests(unittest.TestCase):
    def test_short_link_validates_redirect_before_following(self):
        opener = MagicMock()
        opener.open.side_effect = urllib.error.HTTPError('https://b23.tv/test', 302, '', {'Location': 'https://www.bilibili.com/video/BV1xx411c7mu?p=2&tracking=1'}, None)
        with patch.object(worker.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(worker.resolve_short('https://b23.tv/test'), 'https://www.bilibili.com/video/BV1xx411c7mu?p=2')
            opener.open.assert_called_once()
        for target in ['http://127.0.0.1/private', 'https://evil.test/video/BV1xx411c7mu', 'https://b23.tv/again']:
            opener.reset_mock()
            opener.open.side_effect = urllib.error.HTTPError('https://b23.tv/test', 302, '', {'Location': target}, None)
            with patch.object(worker.urllib.request, 'build_opener', return_value=opener), self.assertRaises(ValueError):
                worker.resolve_short('https://b23.tv/test')
            opener.open.assert_called_once()

    def test_normalization_removes_tracking(self):
        self.assertEqual(worker.normalize('https://www.bilibili.com/video/BV1xx411c7mu?p=2&secret=value'),
                         'https://www.bilibili.com/video/BV1xx411c7mu?p=2')

    def test_only_supported_https_video_inputs(self):
        for value in ['http://www.bilibili.com/video/BV1xx411c7mu',
                      'https://bilibili.com.evil/video/BV1xx411c7mu',
                      'https://user:secret@bilibili.com/video/BV1xx411c7mu',
                      'https://www.bilibili.com:444/video/BV1xx411c7mu',
                      'https://www.bilibili.com/bangumi/play/ep1',
                      'https://www.bilibili.com/video/BV1xx411c7mu?p=0',
                      'https://www.bilibili.com/video/BV1xx411c7mu?p=1&p=2']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                worker.normalize(value)

    def test_public_metadata_never_contains_media_urls_or_headers(self):
        result = worker.public_info({'id': 'x', 'url': 'SECRET', 'http_headers': {'Cookie': 'SECRET'},
            'formats': [{'format_id': '1', 'width': 1920, 'url': 'SECRET',
                         'http_headers': {'Cookie': 'SECRET'}}]})
        self.assertNotIn('SECRET', str(result))
        self.assertEqual(result['formats'][0]['width'], 1920)

    def test_event_stream_survives_downloader_stdout_redirect(self):
        output = io.StringIO()
        original = worker.sys.__stdout__
        try:
            worker.sys.__stdout__ = output
            with contextlib.redirect_stdout(io.StringIO()):
                worker.emit('progress', downloaded=10)
        finally:
            worker.sys.__stdout__ = original
        self.assertIn('progress', output.getvalue())


if __name__ == '__main__':
    unittest.main()
