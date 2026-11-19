"""Actual media tests, isolated from the asset database and original media."""

import hashlib
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from fractions import Fraction
from unittest.mock import patch

import av
import numpy as np


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


worker = load("frame_sequence")
indexer = load("frame_index")
ROOT = Path(__file__).resolve().parents[2]
FFPROBE = ROOT / "data/video-runtime/tools/ffprobe.exe"


def fixture(path, lengths, fps=48, variable=False, subtle=False, offset=0):
    with av.open(str(path), "w") as output:
        stream = output.add_stream("libx264", rate=fps)
        stream.width = stream.height = 64
        stream.pix_fmt = "yuv444p"
        input_base = Fraction(1, fps * 2)
        stream.time_base = input_base
        stream.codec_context.time_base = input_base
        stream.options = {"crf": "0", "preset": "fast"}
        ordinal = 0
        for group, length in enumerate(lengths):
            pixels = np.full((64, 64, 3), 30 + (group % 4) * 45, dtype=np.uint8)
            for _ in range(length):
                image = pixels.copy()
                if subtle:
                    image[24:32, 24:32] = 255 if ordinal % 2 else 0
                frame = av.VideoFrame.from_ndarray(image, format="rgb24")
                frame.pts = offset + ordinal * 2 + (ordinal // 3 if variable else 0)
                frame.time_base = input_base
                for packet in stream.encode(frame):
                    output.mux(packet)
                ordinal += 1
        for packet in stream.encode():
            output.mux(packet)


class SequenceTests(unittest.TestCase):
    def setUp(self):
        self.parent = Path(tempfile.mkdtemp(prefix="frame-sequence-test-", dir=ROOT / "data/video-runtime"))
        self.source = self.parent / "source.mp4"
        self.index = self.parent / "index.sqlite"

    def tearDown(self):
        shutil.rmtree(self.parent)

    def media(self, lengths=(4, 6, 2), **kwargs):
        fixture(self.source, lengths, **kwargs)
        digest = hashlib.sha256(self.source.read_bytes()).hexdigest()
        indexer.build(FFPROBE, self.source, self.index, digest)

    def run_worker(self, **kwargs):
        with patch.object(worker, "emit"):
            return worker.process(self.source, self.index, self.parent, **kwargs)

    def test_restores_twos_threes_and_independent_positions(self):
        self.media()
        directory, result = self.run_worker(restore=True, target_fps=24, extract=True)
        self.assertEqual([g["end"] - g["start"] for g in result["holds"]], [4, 6, 2])
        self.assertEqual([f["sourcePosition"] for f in result["frames"]], [0, 0, 4, 4, 4, 10])
        self.assertEqual(len(list(directory.glob("*.png"))), 3)
        self.assertEqual([f["position"] for f in result["frames"]], list(range(6)))
        self.assertAlmostEqual(sum(f["durationMs"] for f in result["frames"]), result["durationMs"])
        with av.open(str(directory / result["frames"][0]["file"])) as decoded:
            self.assertEqual(next(decoded.decode(video=0)).width, 64)

    def test_ambiguous_pattern_needs_manual_rate(self):
        self.media((5, 6, 2))
        _, result = self.run_worker(restore=True)
        self.assertEqual(result["issue"], "TARGET_FPS_REQUIRED")
        self.assertEqual(result["recommendation"]["status"], "uncertain")
        _, manual = self.run_worker(restore=True, target_fps=24)
        self.assertEqual(manual["issue"], None)
        self.assertAlmostEqual(sum(f["durationMs"] for f in manual["frames"]), manual["durationMs"])
        self.assertNotEqual(manual["timingErrorMs"], 0)

    def test_repeated_pattern_can_suggest_rate(self):
        self.media((4, 6, 2) * 4)
        _, result = self.run_worker(restore=True)
        self.assertEqual(result["recommendation"]["suggestedFps"], 24)

    def test_generate_restores_holds_before_output_limit(self):
        self.media((4, 6, 2) * 20)
        _, animated = self.run_worker(restore=True, extract=True, defer_output=True)
        self.assertEqual(animated["issue"], None)
        self.assertEqual(animated["estimatedFrameCount"], 120)
        self.assertEqual(len(animated["frames"]), 120)
        self.assertEqual([f["sourcePosition"] for f in animated["frames"][:6]], [0, 0, 4, 4, 4, 10])
        directory, video = self.run_worker(extract=True, defer_output=True)
        self.assertEqual(video["issue"], "OUTPUT_LIMIT")
        self.assertEqual(video["estimatedFrameCount"], 240)
        self.assertEqual(list(directory.glob("*.png")), [])

    def test_ambiguous_generate_waits_for_rate_without_frame_files(self):
        self.media((5, 6, 2))
        directory, result = self.run_worker(restore=True, extract=True, defer_output=True)
        self.assertEqual(result["issue"], "TARGET_FPS_REQUIRED")
        self.assertEqual(list(directory.glob("*.png")), [])

    def test_sampling_n_k_and_clip_pts(self):
        self.media()
        _, result = self.run_worker(start=4, end=12, every=3, keep=2, extract=True)
        self.assertEqual([f["sourcePosition"] for f in result["frames"]], [4, 5, 7, 8, 10, 11])
        self.assertGreater(result["preparedBytes"], 0)
        self.assertEqual(result["sourceStartFrame"], 4)
        self.assertAlmostEqual(result["frames"][0]["timelineStartMs"], 0)
        self.assertAlmostEqual(sum(f["durationMs"] for f in result["frames"]), result["durationMs"])

    def test_subtle_motion_and_cuts_are_not_merged(self):
        self.media((4, 6, 2), subtle=True)
        _, result = self.run_worker(restore=True, target_fps=48)
        self.assertEqual(len(result["holds"]), 12)
        noise = np.full((64, 64, 3), 60, dtype=np.uint8)
        self.assertTrue(worker.difference(noise, noise + 1)["similar"])
        self.assertFalse(worker.difference(noise, noise + 45)["similar"])

    def test_vfr_is_preserved_without_automatic_cadence(self):
        self.media((4, 6, 2) * 4, variable=True)
        _, result = self.run_worker(restore=True)
        self.assertEqual(result["recommendation"]["reason"], "VARIABLE_FRAME_RATE")
        _, sampled = self.run_worker(every=3)
        self.assertAlmostEqual(sum(f["durationMs"] for f in sampled["frames"]), sampled["durationMs"])

    def test_output_limit_is_not_silent_truncation(self):
        self.media((151,), fps=60)
        _, result = self.run_worker()
        self.assertEqual(result["issue"], "OUTPUT_LIMIT")
        self.assertEqual(result["estimatedFrameCount"], 151)
        self.assertEqual(result["frames"], [])
        _, sampled = self.run_worker(every=2)
        self.assertEqual(len(sampled["frames"]), 76)

    def test_source_limits_clip_bypass_and_cleanup(self):
        self.media()
        cap = self.source.stat().st_size - 1
        with self.assertRaisesRegex(worker.FrameError, "SIZE_LIMIT"):
            self.run_worker(limits=worker.Limits(source_bytes=cap))
        # The clip uses its own prepared byte size even when the original is larger.
        _, result = self.run_worker(start=10, end=12, limits=worker.Limits(source_bytes=cap))
        self.assertLessEqual(result["preparedBytes"], cap)
        for limits, code in ((worker.Limits(source_bytes=1), "SIZE_LIMIT"),
                             (worker.Limits(pixels=1), "PIXEL_LIMIT"),
                             (worker.Limits(output_bytes=1), "OUTPUT_SIZE_LIMIT"),
                             (worker.Limits(reserve_bytes=10**18), "DISK_SPACE")):
            before = set(self.parent.iterdir())
            with self.assertRaisesRegex(worker.FrameError, code):
                self.run_worker(start=4, end=10, extract=True, limits=limits)
            self.assertEqual(before, set(self.parent.iterdir()))

    def test_cancel_during_decode_removes_attempt(self):
        self.media()
        cancel = self.parent / "cancel"
        def progress(*args, **kwargs):
            if kwargs.get("stage") == "analyzing":
                cancel.touch()
        with patch.object(worker, "emit", side_effect=progress):
            with self.assertRaisesRegex(worker.FrameError, "CANCELLED"):
                worker.process(self.source, self.index, self.parent, cancel=cancel)
        self.assertEqual(list(self.parent.glob("video-frames-*")), [])

    def test_stale_index_rejected(self):
        self.media()
        with self.source.open("ab") as output:
            output.write(b"changed")
        with self.assertRaisesRegex(worker.FrameError, "STALE_INDEX"):
            self.run_worker()

    def test_confirmed_output_caps_tail_without_extending_last_frame(self):
        self.media((242,), fps=30)
        _, prepared = self.run_worker()
        self.assertEqual(prepared["estimatedFrameCount"], 242)
        _, output = self.run_worker(extract=True, truncate=True)
        self.assertEqual(len(output["frames"]), 150)
        self.assertEqual(output["estimatedFrameCount"], 242)
        self.assertAlmostEqual(output["durationMs"], 5000)
        self.assertAlmostEqual(output["frames"][-1]["durationMs"], 1000/30)
        _, sampled = self.run_worker(extract=True, truncate=True, every=2)
        self.assertEqual(len(sampled["frames"]), 121)
        self.assertAlmostEqual(sampled["durationMs"], prepared["durationMs"])

    def test_nonzero_start_pts_and_low_target_rate(self):
        self.media((4, 6, 2), offset=96)
        _, result = self.run_worker(restore=True, target_fps=24)
        self.assertEqual(result["durationMs"], 250)
        self.assertGreater(result["sourceStartPts"], 0)
        _, low = self.run_worker(restore=True, target_fps=1)
        self.assertEqual(low["issue"], "TARGET_FPS_TOO_LOW")

    def test_exact_production_duration_and_size_boundaries(self):
        self.media((120,), fps=2)
        _, exact = self.run_worker()
        self.assertEqual(exact["durationMs"], 60000)
        # Append a sparse tail: valid media stream, oversized original container.
        with self.source.open("r+b") as output:
            output.truncate(worker.Limits().source_bytes + 1)
        self.index.unlink()
        indexer.build(FFPROBE, self.source, self.index, "0" * 64)
        with self.assertRaisesRegex(worker.FrameError, "SIZE_LIMIT"):
            self.run_worker(every=2)
        _, clip = self.run_worker(start=0, end=4)
        self.assertEqual(clip["durationMs"], 2000)
        self.assertLess(clip["preparedBytes"], worker.Limits().source_bytes)
        # At the exact size boundary the complete source is accepted.
        with self.source.open("r+b") as output:
            output.truncate(worker.Limits().source_bytes)
        self.index.unlink()
        indexer.build(FFPROBE, self.source, self.index, "0" * 64)
        _, exact_bytes = self.run_worker()
        self.assertEqual(exact_bytes["preparedBytes"], worker.Limits().source_bytes)
        self.source.unlink()
        self.index.unlink()
        self.media((121,), fps=2)
        with self.assertRaisesRegex(worker.FrameError, "DURATION_LIMIT"):
            self.run_worker()

    def test_mpdecimate_baseline_and_compressed_noise(self):
        self.media()
        process = subprocess.run([str(FFPROBE.with_name("ffmpeg.exe")), "-hide_banner", "-i", str(self.source),
                                  "-vf", "mpdecimate,showinfo", "-fps_mode", "vfr", "-f", "null", "-"],
                                 capture_output=True, check=True, timeout=30,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        import re
        self.assertEqual(len(re.findall(rb"Parsed_showinfo_\d+[^\n]* n:", process.stderr)), 3)
        # Real lossy re-encoding, not only noise added to arrays.
        compressed = self.parent / "compressed.mp4"
        subprocess.run([str(FFPROBE.with_name("ffmpeg.exe")), "-v", "error", "-i", str(self.source),
                        "-c:v", "libx264", "-crf", "23", str(compressed)], capture_output=True, check=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=30)
        compressed_index = self.parent / "compressed.sqlite"
        indexer.build(FFPROBE, compressed, compressed_index, hashlib.sha256(compressed.read_bytes()).hexdigest())
        with patch.object(worker, "emit"):
            _, result = worker.process(compressed, compressed_index, self.parent, restore=True, target_fps=24)
        self.assertEqual([g["end"] - g["start"] for g in result["holds"]], [4, 6, 2])


if __name__ == "__main__":
    unittest.main()
