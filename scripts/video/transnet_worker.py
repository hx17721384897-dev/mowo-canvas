"""Source-frame shot detection for MOWO. TransNet V2 model protocol follows
https://github.com/soCzech/TransNetV2. The DXGI adapter enumeration is adapted
from CadensView under MIT; see scripts/video/CadensView-LICENSE.txt.
The video and frame index are read-only; only --output is written.
"""

import argparse
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
import uuid

import av
from av.video.reformatter import VideoReformatter
import numpy as np
import onnxruntime as ort


MODEL_SHA256 = "af5bc7dcbc517613d0d7fb39ee97add80e52a05d8de4717652e500a5bf573810"
ALGORITHM_VERSION = 1


def dxgi_adapters():
    """Enumerate physical DirectML device ordinals from DXGI on Windows."""
    if os.name != "nt" or "DmlExecutionProvider" not in ort.get_available_providers():
        return []
    import ctypes as c
    import ctypes.wintypes as w

    class GUID(c.Structure):
        _fields_ = [("a", w.DWORD), ("b", w.WORD), ("c", w.WORD), ("d", c.c_ubyte * 8)]

    class LUID(c.Structure):
        _fields_ = [("lo", w.DWORD), ("hi", w.LONG)]

    class Description(c.Structure):
        _fields_ = [("name", w.WCHAR * 128), ("vendor", w.UINT), ("device", w.UINT),
                    ("subsystem", w.UINT), ("revision", w.UINT),
                    ("dedicated_video", c.c_size_t), ("dedicated_system", c.c_size_t),
                    ("shared", c.c_size_t), ("luid", LUID), ("flags", w.UINT)]

    def method(pointer, index, result, *parameters):
        table = c.cast(pointer, c.POINTER(c.POINTER(c.c_void_p))).contents
        return c.WINFUNCTYPE(result, c.c_void_p, *parameters)(table[index])

    factory = c.c_void_p()
    guid = GUID(0x770aae78, 0xf26f, 0x4dba,
                (c.c_ubyte * 8)(0xa8, 0x29, 0x25, 0x3c, 0x83, 0xd1, 0xb3, 0x87))
    if c.WinDLL("dxgi.dll").CreateDXGIFactory1(c.byref(guid), c.byref(factory)):
        raise OSError("无法枚举显卡")
    found = []
    seen = set()
    try:
        for ordinal in range(32):
            adapter = c.c_void_p()
            if method(factory, 12, w.LONG, w.UINT, c.POINTER(c.c_void_p))(
                    factory, ordinal, c.byref(adapter)):
                break
            try:
                description = Description()
                if method(adapter, 10, w.LONG, c.POINTER(Description))(
                        adapter, c.byref(description)):
                    continue
                luid = (description.luid.hi, description.luid.lo)
                if description.flags & 2 or luid in seen:
                    continue
                seen.add(luid)
                found.append({"device_id": ordinal, "name": description.name,
                              "dedicated_video_bytes": description.dedicated_video})
            finally:
                method(adapter, 2, w.ULONG)(adapter)
    finally:
        method(factory, 2, w.ULONG)(factory)
    return sorted(found, key=lambda item: item["dedicated_video_bytes"], reverse=True)


def make_session(model, adapter=None):
    options = ort.SessionOptions()
    options.intra_op_num_threads = min(4, os.cpu_count() or 4)
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.enable_mem_pattern = adapter is None
    if adapter is not None:
        options.add_session_config_entry("session.disable_cpu_ep_fallback", "1")
        providers = [("DmlExecutionProvider", {"device_id": adapter["device_id"]})]
    else:
        providers = ["CPUExecutionProvider"]
    session = ort.InferenceSession(str(model), sess_options=options, providers=providers)
    session.disable_fallback()
    expected = "DmlExecutionProvider" if adapter is not None else "CPUExecutionProvider"
    if expected not in session.get_providers():
        raise RuntimeError("分镜运行设备不可用")
    if ([(item.name, item.shape) for item in session.get_inputs()] !=
            [("frames", [1, 100, 27, 48, 3]), ("histograms", [1, 100, 512])]):
        raise ValueError("分镜模型输入不符合预期")
    return session


def first_window(source, pts):
    iterator = source_frames(source, pts)
    try:
        frames = [next(iterator)[0] for _ in range(min(75, len(pts)))]
    finally:
        iterator.close()
    return np.stack([frames[0] if index < 0 else frames[-1]
                     if index >= len(pts) else frames[index]
                     for index in range(-25, 75)])[None]


def choose_session(model, source, pts, mode):
    cpu = make_session(model)
    if mode == "cpu":
        emit("device", device="cpu", reason="requested")
        return cpu, "cpu"
    try:
        adapters = dxgi_adapters()
        if not adapters:
            emit("device", device="cpu", reason="no_directml_adapter")
            return cpu, "cpu"
        window = first_window(source, pts)
        inputs = {"frames": window, "histograms": color_histograms(window)}
        cpu_output = cpu.run(["single", "many"], inputs)
        began = time.perf_counter()
        cpu.run(["single", "many"], inputs)
        cpu_seconds = time.perf_counter() - began
        adapter = adapters[0]
        gpu = make_session(model, adapter)
        gpu_output = gpu.run(["single", "many"], inputs)
        if any(not np.isfinite(value).all() for value in gpu_output):
            raise ValueError("显卡结果含无效数值")
        if any(np.max(np.abs(a - b)) > 1e-5 or not np.array_equal(a > .5, b > .5)
               for a, b in zip(cpu_output, gpu_output)):
            raise ValueError("显卡结果与 CPU 切点不一致")
        began = time.perf_counter()
        gpu.run(["single", "many"], inputs)
        gpu_seconds = time.perf_counter() - began
        if gpu_seconds < cpu_seconds * .85:
            emit("device", device="dml", name=adapter["name"],
                 cpuSeconds=round(cpu_seconds, 3), gpuSeconds=round(gpu_seconds, 3))
            return gpu, "dml"
        emit("device", device="cpu", reason="gpu_not_faster",
             cpuSeconds=round(cpu_seconds, 3), gpuSeconds=round(gpu_seconds, 3))
    except Exception as error:
        emit("device", device="cpu", reason="gpu_unavailable", detail=type(error).__name__)
    return cpu, "cpu"


def emit(kind, **fields):
    print(json.dumps({"type": kind, **fields}, ensure_ascii=False, separators=(",", ":")), flush=True)


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def frame_index(index_path, source):
    with sqlite3.connect(f"file:{index_path.as_posix()}?mode=ro", uri=True) as database:
        metadata = json.loads(database.execute("SELECT json FROM metadata LIMIT 1").fetchone()[0])
        pts = [row[0] for row in database.execute("SELECT pts FROM frames ORDER BY ordinal")]
    stat = source.stat()
    if (metadata.get("algorithmVersion") != 1 or metadata.get("frameCount") != len(pts)
            or metadata.get("sourceBytes") != stat.st_size
            or metadata.get("sourceMtimeNs") != str(stat.st_mtime_ns)):
        raise ValueError("源帧索引与原片不一致，请重新建立索引")
    if not pts:
        raise ValueError("原片没有可分析的视频帧")
    return metadata, pts


def source_frames(source, expected_pts):
    with av.open(str(source), mode="r") as container:
        if not container.streams.video:
            raise ValueError("原片没有视频轨")
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        stream.codec_context.thread_count = min(8, max(1, os.cpu_count() or 4))
        formatter = VideoReformatter()
        decoder = iter(container.decode(video=0))
        ordinal = 0
        while True:
            began = time.perf_counter()
            try:
                frame = next(decoder)
            except StopIteration:
                return
            decode_seconds = time.perf_counter() - began
            if ordinal >= len(expected_pts) or frame.pts != expected_pts[ordinal]:
                raise ValueError(f"第 {ordinal} 帧与源帧索引不一致，请重新建立索引")
            began = time.perf_counter()
            pixels = formatter.reformat(frame, width=48, height=27, format="rgb24",
                                        interpolation="BILINEAR").to_ndarray()
            yield pixels, decode_seconds, time.perf_counter() - began
            ordinal += 1


def color_histograms(frames):
    bins = frames.astype(np.int32) // 32
    bins = bins[..., 0] * 64 + bins[..., 1] * 8 + bins[..., 2]
    bins = bins.reshape(100, 1296) + np.arange(100, dtype=np.int32)[:, None] * 512
    counts = np.bincount(bins.ravel(), minlength=100 * 512).reshape(1, 100, 512).astype(np.float32)
    return counts / np.sqrt(np.sum(counts * counts, axis=2, keepdims=True, dtype=np.float32))


def closed_cuts(scores, offset, final=False):
    """Convert closed >.5 response islands to the first frame of the right shot."""
    mask = np.asarray(scores) > 0.5
    edges = np.diff(np.r_[False, mask, False].astype(np.int8))
    cuts = []
    for lo, hi in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)):
        if hi == len(scores) and not final:
            break
        frame = offset + (int(lo) + int(hi) - 1) // 2 + 1
        cuts.append({"frame": frame, "score": float(np.max(scores[lo:hi]))})
    return cuts


def detect(source, pts, session):
    total = len(pts)
    iterator = iter(source_frames(source, pts))
    frames = deque()
    head = next_frame = 0
    first = last = None
    all_scores = []
    published = set()
    timings = {"decodeSeconds": 0.0, "resizeSeconds": 0.0,
               "histogramSeconds": 0.0, "inferenceSeconds": 0.0}
    for base in range(0, (total + 49) // 50 * 50, 50):
        while next_frame < min(total, base + 75):
            pixels, decoded, resized = next(iterator)
            timings["decodeSeconds"] += decoded
            timings["resizeSeconds"] += resized
            first = pixels if first is None else first
            last = pixels
            frames.append(pixels)
            next_frame += 1
        window = np.stack([first if n < 0 else last if n >= total else frames[n - head]
                           for n in range(base - 25, base + 75)])[None]
        began = time.perf_counter()
        histograms = color_histograms(window)
        timings["histogramSeconds"] += time.perf_counter() - began
        began = time.perf_counter()
        outputs = session.run(["single", "many"], {"frames": window, "histograms": histograms})
        timings["inferenceSeconds"] += time.perf_counter() - began
        scores = outputs[0]
        if scores.shape != (1, 100, 1) or scores.dtype != np.float32 or not np.isfinite(scores).all():
            raise ValueError("分镜模型返回了无效结果")
        all_scores.extend(scores[0, 25:75, 0][:max(0, min(50, total - base))].tolist())
        final = base + 50 >= total
        for cut in closed_cuts(all_scores, 0, final):
            if 0 < cut["frame"] < total and cut["frame"] not in published:
                published.add(cut["frame"])
                emit("cut", **cut)
        emit("progress", current=min(total, base + 50), total=total)
        while head < max(0, base + 25) and frames:
            frames.popleft()
            head += 1
    if len(all_scores) != total:
        raise ValueError("分镜结果与源帧数不一致")
    # Ensure no decoder frames were omitted or added after the final window.
    try:
        next(iterator)
        raise ValueError("原片帧数超过源帧索引")
    except StopIteration:
        pass
    return closed_cuts(all_scores, 0, True), timings


def run(args):
    source, index, model, output = map(Path, (args.source, args.index, args.model, args.output))
    before = source.stat()
    metadata, pts = frame_index(index, source)
    if file_hash(model) != MODEL_SHA256:
        raise ValueError("分镜模型校验失败")
    session, device = choose_session(model, source, pts, args.device)
    started = time.perf_counter()
    try:
        cuts, timings = detect(source, pts, session)
    except Exception:
        if device != "dml":
            raise
        emit("reset", reason="gpu_execution_failed")
        session = make_session(model)
        device = "cpu"
        cuts, timings = detect(source, pts, session)
    after = source.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError("分镜过程中原片发生变化")
    result = {"algorithm": "transnetv2-onnx", "algorithmVersion": ALGORITHM_VERSION,
              "modelSha256": MODEL_SHA256, "device": device, "sourceHash": metadata["contentHash"],
              "sourceBytes": after.st_size, "sourceMtimeNs": str(after.st_mtime_ns),
              "frameCount": len(pts), "cuts": cuts}
    temporary = output.with_name(f".{output.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(result, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    emit("complete", cuts=len(cuts), frameCount=len(pts), device=device,
         seconds=round(time.perf_counter() - started, 3),
         **{name: round(value, 3) for name, value in timings.items()})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("source", "index", "model", "output"):
        parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--device", choices=("auto", "cpu"), default="auto")
    try:
        run(parser.parse_args())
    except Exception as error:
        emit("error", message=str(error))
        sys.exit(1)
