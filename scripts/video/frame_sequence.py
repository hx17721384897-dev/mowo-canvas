"""Bounded source-frame analysis/extraction. Uses the existing PyAV/NumPy runtime.

The caller owns the parent directory; each invocation creates its own attempt.
Indexed source PTS are authoritative, including for clips. No preview is read.
"""

import argparse
from contextlib import closing
from dataclasses import dataclass
from fractions import Fraction
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import time

try:
    import av
    import numpy as np
except ImportError:
    print('{"type":"failed","code":"RUNTIME_PACKAGES_REQUIRED"}', flush=True)
    sys.exit(1)

VERSION = 1


class FrameError(ValueError):
    pass


@dataclass(frozen=True)
class Limits:
    seconds: int = 60
    source_bytes: int = 200 * 1024 * 1024
    output_frames: int = 150
    pixels: int = 4096 * 2160
    work_pixels: int = 4_000_000_000
    source_frames: int = 7200
    output_bytes: int = 512 * 1024 * 1024
    reserve_bytes: int = 512 * 1024 * 1024
    timeout: int = 600


def emit(kind, **fields):
    print(json.dumps({"type": kind, **fields}, separators=(",", ":")), flush=True)


class Guard:
    def __init__(self, directory, limits, cancel=None):
        self.directory, self.limits, self.cancel = directory, limits, cancel
        self.deadline = time.monotonic() + limits.timeout

    def check(self):
        if self.cancel and self.cancel.exists():
            raise FrameError("CANCELLED")
        if time.monotonic() >= self.deadline:
            raise FrameError("TIMEOUT")
        if shutil.disk_usage(self.directory).free < self.limits.reserve_bytes:
            raise FrameError("DISK_SPACE")


def read_range(source, index, start, end, limits):
    with closing(sqlite3.connect(f"file:{index.as_posix()}?mode=ro", uri=True)) as db:
        metadata = json.loads(db.execute("SELECT json FROM metadata LIMIT 1").fetchone()[0])
        info = source.stat()
        if (metadata.get("algorithmVersion") != 1 or metadata.get("sourceBytes") != info.st_size
                or metadata.get("sourceMtimeNs") != str(info.st_mtime_ns)):
            raise FrameError("STALE_INDEX")
        count = metadata["frameCount"]
        end = count if end is None else end
        if not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end <= count:
            raise FrameError("INVALID_RANGE")
        if end - start > limits.source_frames:
            raise FrameError("SOURCE_FRAME_LIMIT")
        pts = [r[0] for r in db.execute("SELECT pts FROM frames WHERE ordinal>=? AND ordinal<? ORDER BY ordinal", (start, end))]
        boundary = db.execute("SELECT pts FROM frames WHERE ordinal=?", (end,)).fetchone()
        end_pts = boundary[0] if boundary else (
            metadata["firstPts"] + metadata["durationTicks"] if metadata.get("durationTicks") is not None else None)
        if (len(pts) != end - start or end_pts is None or end_pts <= pts[-1]
                or any(b <= a for a, b in zip(pts, pts[1:]))):
            raise FrameError("INVALID_TIMESTAMPS")
        base = Fraction(metadata["timeBaseNumerator"], metadata["timeBaseDenominator"])
        duration = (end_pts - pts[0]) * base
        if duration > limits.seconds:
            raise FrameError("DURATION_LIMIT")
        clip = start != 0 or end != count
        if not clip and info.st_size > limits.source_bytes:
            raise FrameError("SIZE_LIMIT")
        return {"metadata": metadata, "pts": pts, "base": base, "endPts": end_pts,
                "start": start, "end": end, "duration": duration, "clip": clip,
                "fingerprint": (info.st_size, info.st_mtime_ns)}


def decoded(source, selected, guard):
    with av.open(str(source)) as container:
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        stream.codec_context.thread_count = min(4, os.cpu_count() or 1)
        if stream.time_base != selected["base"]:
            raise FrameError("INDEX_TIME_BASE_MISMATCH")
        width, height = stream.codec_context.width, stream.codec_context.height
        if (width <= 0 or height <= 0 or width * height > guard.limits.pixels
                or width * height * len(selected["pts"]) > guard.limits.work_pixels):
            raise FrameError("PIXEL_LIMIT")
        container.seek(selected["pts"][0], stream=stream, backward=True, any_frame=False)
        position = 0
        for frame in container.decode(video=0):
            guard.check()
            if frame.pts is None:
                raise FrameError("MISSING_PTS")
            if frame.pts < selected["pts"][0]:
                continue
            if frame.pts != selected["pts"][position]:
                raise FrameError("DECODE_PTS_MISMATCH")
            if frame.width != width or frame.height != height:
                raise FrameError("VARIABLE_DIMENSIONS")
            yield position, frame
            position += 1
            if position == len(selected["pts"]):
                return
        raise FrameError("INCOMPLETE_DECODE")


def prepare_clip(source, selected, directory, guard):
    """Measure a bounded video-only CRF18 preparation; images still use source."""
    if not selected["clip"]:
        return source.stat().st_size
    path = directory / "range.mp4"
    try:
        with av.open(str(path), mode="w", format="mp4") as output:
            encoder = None
            packet_bytes = 0
            for _, frame in decoded(source, selected, guard):
                if encoder is None:
                    encoder = output.add_stream("libx264", rate=24)
                    encoder.width, encoder.height = frame.width, frame.height
                    encoder.pix_fmt = "yuv444p"
                    encoder.time_base = selected["base"]
                    encoder.codec_context.time_base = selected["base"]
                    encoder.options = {"crf": "18", "preset": "fast", "threads": "2"}
                # Do not mutate a frame that will be reused by a caller.
                converted = frame.reformat(format="yuv444p")
                converted.pts = frame.pts - selected["pts"][0]
                converted.time_base = selected["base"]
                for packet in encoder.encode(converted):
                    packet_bytes += packet.size
                    output.mux(packet)
                if packet_bytes > guard.limits.source_bytes or (path.exists() and path.stat().st_size > guard.limits.source_bytes):
                    raise FrameError("SIZE_LIMIT")
                guard.check()
            for packet in encoder.encode():
                packet_bytes += packet.size
                output.mux(packet)
                guard.check()
                if packet_bytes > guard.limits.source_bytes:
                    raise FrameError("SIZE_LIMIT")
        size = path.stat().st_size
        if size > guard.limits.source_bytes:
            raise FrameError("SIZE_LIMIT")
        return size
    finally:
        path.unlink(missing_ok=True)


def difference(reference, image):
    # Full RGB resolution: local blocks stop tiny movement being hidden by a global average.
    diff = np.abs(image.astype(np.int16) - reference.astype(np.int16))
    pixel = diff.max(axis=2)
    height, width = pixel.shape
    padded = np.pad(pixel, ((0, (-height) % 8), (0, (-width) % 8)), mode="edge")
    block = padded.reshape(padded.shape[0] // 8, 8, padded.shape[1] // 8, 8).mean(axis=(1, 3))
    mean, peak, fraction = float(diff.mean()), float(block.max()), float(np.mean(pixel > 12))
    return {"mean": mean, "blockMax": peak, "changedFraction": fraction,
            "similar": mean <= 1.2 and peak <= 3.0 and fraction <= 0.002}


def holds(source, selected, guard, enabled):
    groups, metrics = [], []
    reference = None
    width = height = 0
    for position, frame in decoded(source, selected, guard):
        width, height = frame.width, frame.height
        image = frame.to_ndarray(format="rgb24") if enabled else None
        metric = difference(reference, image) if reference is not None else None
        if metric is None or not metric["similar"]:
            groups.append({"start": position, "end": position + 1})
            reference = image
        else:
            groups[-1]["end"] = position + 1
        if metric:
            metrics.append({"position": position, **metric})
        if position % 30 == 0:
            emit("progress", stage="analyzing", completed=position + 1, total=len(selected["pts"]))
    return groups, metrics, width, height


def cadence(selected, groups):
    # A candidate is a useful editing suggestion, never proof of the authored rate.
    intervals = [b - a for a, b in zip(selected["pts"], selected["pts"][1:])]
    if len(groups) < 6 or not intervals:
        return {"status": "uncertain", "suggestedFps": None, "reason": "INSUFFICIENT_HOLDS"}
    median = sorted(intervals)[len(intervals) // 2]
    if any(abs(interval - median) > 1 for interval in intervals):
        return {"status": "uncertain", "suggestedFps": None, "reason": "VARIABLE_FRAME_RATE"}
    source_fps = float(1 / (median * selected["base"]))
    lengths = [g["end"] - g["start"] for g in groups[1:-1]]
    scores = []
    for fps in (23.976023976, 24, 25, 29.97002997, 30):
        if not 1.5 <= source_fps / fps <= 5:
            continue
        values = [length * fps / source_fps for length in lengths]
        if any(v < 0.75 for v in values):
            continue
        score = sum(abs(v - math.floor(v + 0.5)) for v in values) / len(values)
        if score < 0.08 and len(set(lengths)) >= 2:
            scores.append((score, fps))
    scores.sort()
    alternatives = [score for score in scores[1:] if abs(score[1] - scores[0][1]) > 1] if scores else []
    if not scores or (alternatives and alternatives[0][0] - scores[0][0] < 0.02):
        return {"status": "uncertain", "suggestedFps": None, "reason": "AMBIGUOUS_CADENCE"}
    return {"status": "suggested", "suggestedFps": scores[0][1], "reason": "REPEATED_HOLD_PATTERN"}


def make_plan(selected, groups, every, keep, target_fps, limits, enforce_limit=True):
    if not isinstance(every, int) or not isinstance(keep, int) or not 1 <= keep <= every <= 1_000_000:
        raise FrameError("INVALID_SAMPLING")
    base, pts = selected["base"], selected["pts"]
    duration = selected["duration"]
    if target_fps is None:
        slots = [{"source": i, "groupStart": i, "groupEnd": i + 1, "time": (point - pts[0]) * base}
                 for i, point in enumerate(pts)]
    else:
        fps = Fraction(str(target_fps))
        if not 1 <= fps <= 120:
            raise FrameError("INVALID_TARGET_FPS")
        total = math.floor(duration * fps + Fraction(1, 2))
        if total < len(groups):
            raise FrameError("TARGET_FPS_TOO_LOW")
        slots, last = [], 0
        for group in groups:
            end_time = ((pts[group["end"]] if group["end"] < len(pts) else selected["endPts"]) - pts[0]) * base
            boundary = math.floor(end_time * fps + Fraction(1, 2))
            if boundary <= last:
                raise FrameError("TARGET_FPS_TOO_LOW")
            for ordinal in range(last, boundary):
                slots.append({"source": group["start"], "groupStart": group["start"], "groupEnd": group["end"],
                              "time": ordinal * duration / total})
            last = boundary
    retained = [slot for i, slot in enumerate(slots) if i % every < keep]
    if not retained or (enforce_limit and len(retained) > limits.output_frames):
        raise FrameError("OUTPUT_LIMIT")
    frames = []
    for i, slot in enumerate(retained):
        end_time = retained[i + 1]["time"] if i + 1 < len(retained) else duration
        frames.append({"position": i, "sourcePosition": selected["start"] + slot["source"],
                       "sourceStartFrame": selected["start"] + slot["groupStart"],
                       "sourceEndFrame": selected["start"] + slot["groupEnd"],
                       "sourcePts": pts[slot["source"]], "timelineStartMs": float(slot["time"] * 1000),
                       "durationMs": float((end_time - slot["time"]) * 1000)})
    return frames, float((Fraction(len(slots), 1) / Fraction(str(target_fps)) - duration) * 1000) if target_fps else 0


def write_images(source, selected, frames, directory, guard):
    wanted = {frame["sourcePosition"] - selected["start"] for frame in frames}
    paths, total_bytes = {}, 0
    for position, frame in decoded(source, selected, guard):
        if position not in wanted:
            continue
        path = directory / f"source-{position:06d}.png"
        codec = av.CodecContext.create("png", "w")
        codec.width, codec.height, codec.pix_fmt = frame.width, frame.height, "rgb24"
        packets = [*codec.encode(frame.reformat(format="rgb24")), *codec.encode(None)]
        content = b"".join(bytes(packet) for packet in packets)
        total_bytes += len(content)
        if total_bytes > guard.limits.output_bytes:
            raise FrameError("OUTPUT_SIZE_LIMIT")
        guard.check()
        with path.open("xb") as output:
            output.write(content)
        paths[position] = path.name
        emit("progress", stage="extracting", completed=len(paths), total=len(wanted))
        if len(paths) == len(wanted):
            break
    for frame in frames:
        frame["file"] = paths[frame["sourcePosition"] - selected["start"]]


def process(source, index, parent, *, start=0, end=None, restore=False, target_fps=None,
            every=1, keep=1, extract=False, cancel=None, limits=Limits(), truncate=False, defer_output=False):
    source, index, parent = source.resolve(strict=True), index.resolve(strict=True), parent.resolve(strict=True)
    directory = Path(tempfile.mkdtemp(prefix="video-frames-", dir=parent))
    try:
        guard = Guard(directory, limits, cancel)
        guard.check()
        selected = read_range(source, index, start, end, limits)
        if not isinstance(every, int) or not isinstance(keep, int) or not 1 <= keep <= every <= 1_000_000:
            raise FrameError("INVALID_SAMPLING")
        emit("progress", stage="preparing", completed=0, total=1)
        size = prepare_clip(source, selected, directory, guard)
        groups, metrics, width, height = holds(source, selected, guard, restore)
        recommendation = cadence(selected, groups) if restore else {"status": "disabled", "suggestedFps": None}
        fps = target_fps if restore else None
        if restore and fps is None:
            fps = recommendation["suggestedFps"]
        frames, issue, timing_error, estimated_count = [], None, 0, None
        if restore and fps is None:
            issue = "TARGET_FPS_REQUIRED"
        else:
            try:
                frames, timing_error = make_plan(selected, groups, every, keep, fps, limits, enforce_limit=False)
                estimated_count = len(frames)
                if estimated_count > limits.output_frames:
                    if truncate:
                        frames = frames[:limits.output_frames]
                    else:
                        frames, issue = [], "OUTPUT_LIMIT"
            except FrameError as error:
                if str(error) not in ("OUTPUT_LIMIT", "TARGET_FPS_TOO_LOW"):
                    raise
                issue = str(error)
        if extract:
            if issue and not defer_output:
                raise FrameError(issue)
            if not issue:
                write_images(source, selected, frames, directory, guard)
        guard.check()
        after = source.stat()
        if (after.st_size, after.st_mtime_ns) != selected["fingerprint"]:
            raise FrameError("SOURCE_CHANGED")
        result = {"algorithmVersion": VERSION, "sourceKind": "video", "width": width, "height": height,
                  "sourceContentHash": selected["metadata"]["contentHash"],
                  "sourceStartFrame": selected["start"], "sourceEndFrame": selected["end"],
                  "sourceStartPts": selected["pts"][0], "sourceEndPts": selected["endPts"],
                  "timeBaseNumerator": selected["base"].numerator, "timeBaseDenominator": selected["base"].denominator,
                  "preparedBytes": size, "durationMs": (frames[-1]["timelineStartMs"] + frames[-1]["durationMs"]) if truncate and frames else float(selected["duration"] * 1000),
                  "restore": restore, "targetFps": fps, "every": every, "keep": keep,
                  "recommendation": recommendation, "issue": issue, "estimatedFrameCount": estimated_count, "timingErrorMs": timing_error,
                  "holds": groups, "metrics": metrics, "frames": frames}
        (directory / "manifest.json").write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
        return directory, result
    except BaseException:
        shutil.rmtree(directory)
        raise


def build_index(source, target, content_hash, guard):
    """Build the existing index format without an ffprobe child to orphan on cancel."""
    before = source.stat()
    with closing(sqlite3.connect(target)) as database, av.open(str(source)) as container:
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        stream.codec_context.thread_count = min(4, os.cpu_count() or 1)
        if stream.codec_context.width * stream.codec_context.height > guard.limits.pixels:
            raise FrameError("PIXEL_LIMIT")
        database.executescript("CREATE TABLE frames (ordinal INTEGER PRIMARY KEY, pts INTEGER NOT NULL, keyframe INTEGER NOT NULL);"
                               "CREATE INDEX frames_pts_idx ON frames(pts); CREATE TABLE metadata (json TEXT NOT NULL);")
        count, first, last, last_duration = 0, None, None, None
        for frame in container.decode(video=0):
            guard.check()
            if frame.pts is None or (last is not None and frame.pts <= last):
                raise FrameError("INVALID_TIMESTAMPS")
            if count >= 500000:
                raise FrameError("SOURCE_FRAME_LIMIT")
            database.execute("INSERT INTO frames VALUES (?,?,?)", (count, frame.pts, int(frame.key_frame)))
            first = frame.pts if first is None else first
            last, last_duration = frame.pts, frame.duration
            count += 1
            if count % 300 == 0:
                emit("progress", stage="indexing", completed=count, total=0)
        if not count:
            raise FrameError("EMPTY_SEQUENCE")
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise FrameError("SOURCE_CHANGED")
        duration = stream.duration if stream.duration is not None else last + last_duration - first if last_duration else None
        metadata = {"algorithmVersion": 1, "contentHash": content_hash, "sourceBytes": after.st_size,
                    "sourceMtimeNs": str(after.st_mtime_ns), "frameCount": count, "firstPts": first, "lastPts": last,
                    "durationTicks": duration, "timeBaseNumerator": stream.time_base.numerator,
                    "timeBaseDenominator": stream.time_base.denominator,
                    "width": stream.codec_context.width, "height": stream.codec_context.height}
        database.execute("INSERT INTO metadata VALUES (?)", (json.dumps(metadata),))
        database.commit()


def main():
    parser = argparse.ArgumentParser()
    for name in ("source", "index", "parent"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--end", type=int)
    parser.add_argument("--restore", action="store_true")
    parser.add_argument("--target-fps", type=float)
    parser.add_argument("--every", type=int, default=1)
    parser.add_argument("--keep", type=int, default=1)
    parser.add_argument("--extract", action="store_true")
    parser.add_argument("--truncate", action="store_true")
    parser.add_argument("--defer-output", action="store_true")
    parser.add_argument("--cancel", type=Path)
    parser.add_argument("--build-index", action="store_true")
    parser.add_argument("--content-hash")
    args = vars(parser.parse_args())
    try:
        build = args.pop("build_index")
        content_hash = args.pop("content_hash")
        if build:
            if not content_hash or len(content_hash) != 64:
                raise FrameError("INVALID_CONTENT_HASH")
            build_index(args["source"], args["index"], content_hash, Guard(args["parent"], Limits(), args["cancel"]))
            emit("indexed")
            return
        directory, _ = process(**args)
        emit("ready", directory=str(directory))
    except Exception as error:
        emit("failed", code=str(error) if isinstance(error, FrameError) else "PROCESSING_FAILED")
        sys.exit(1)


if __name__ == "__main__":
    main()
