import hashlib
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('media', pathlib.Path(__file__).with_name('media.py'))
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)
tools = pathlib.Path(__file__).resolve().parents[2] / 'data/video-runtime/tools'
ffmpeg, ffprobe = tools / 'ffmpeg.exe', tools / 'ffprobe.exe'


def generate(path, audio=True):
    args = [str(ffmpeg), '-v', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=854x480:rate=24']
    if audio:
        args += ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100']
    args += ['-t', '1', '-c:v', 'libx265', '-x265-params', 'pools=1:frame-threads=1:log-level=error', '-pix_fmt', 'yuv420p']
    if audio:
        args += ['-c:a', 'aac']
    media.execute(args + [str(path)], 60)


class MediaTests(unittest.TestCase):
    def test_space_estimate_keeps_reserve_before_media_processing(self):
        with patch.object(media.shutil, 'disk_usage') as usage:
            usage.return_value.free = 256 * 1024 * 1024 + 100
            media.check_space('.', 100)
            usage.return_value.free -= 1
            with self.assertRaisesRegex(ValueError, 'disk_full'):
                media.check_space('.', 100)

    def test_hevc_to_browser_preview_keeps_original_and_audio(self):
        with tempfile.TemporaryDirectory(prefix='mowo-media-') as directory:
            source, target = pathlib.Path(directory) / 'source.mp4', pathlib.Path(directory) / 'preview.mp4'
            generate(source)
            original = hashlib.sha256(source.read_bytes()).digest()
            self.assertFalse(media.probe(ffprobe, source)['browserCandidate'])
            result = media.preview(ffmpeg, ffprobe, source, target)
            self.assertTrue(result['browserCandidate'])
            self.assertTrue(any(s['codec_type'] == 'audio' for s in result['streams']))
            self.assertEqual(hashlib.sha256(source.read_bytes()).digest(), original)
            media.execute([str(ffmpeg), '-v', 'error', '-i', str(target), '-f', 'null', '-'], 30)

    def test_silent_video_is_valid_and_preview_can_be_silent(self):
        with tempfile.TemporaryDirectory(prefix='mowo-silent-') as directory:
            source, target = pathlib.Path(directory) / 'source.mp4', pathlib.Path(directory) / 'preview.mp4'
            generate(source, audio=False)
            media.probe(ffprobe, source)
            with self.assertRaisesRegex(ValueError, 'missing_audio'):
                media.probe(ffprobe, source, require_audio=True)
            self.assertTrue(media.preview(ffmpeg, ffprobe, source, target)['browserCandidate'])

    def test_preview_cannot_overwrite_its_source(self):
        with tempfile.TemporaryDirectory(prefix='mowo-original-') as directory:
            source = pathlib.Path(directory) / 'source.mp4'; source.write_bytes(b'preserve')
            with self.assertRaisesRegex(ValueError, 'preview_would_overwrite_source'):
                media.preview(ffmpeg, ffprobe, source, source)
            self.assertEqual(source.read_bytes(), b'preserve')


if __name__ == '__main__':
    unittest.main()
