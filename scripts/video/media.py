"""Local media inspection and disposable browser previews."""
import json
import math
import os
import pathlib
import subprocess
import uuid
import shutil


def execute(arguments, timeout):
    try:
        return subprocess.run(arguments, stdin=subprocess.DEVNULL, capture_output=True,
                              check=True, timeout=timeout,
                              creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except subprocess.CalledProcessError as error:
        if b'No space left on device' in (error.stderr or b'') or b'not enough space' in (error.stderr or b'').lower():
            raise ValueError('disk_full') from None
        raise


def check_space(directory, additional=0):
    if shutil.disk_usage(directory).free < additional + 256 * 1024 * 1024:
        raise ValueError('disk_full')


def probe(ffprobe, source, require_audio=False):
    result = execute([str(ffprobe), '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(source)], 60)
    data = json.loads(result.stdout)
    streams = data.get('streams', [])
    video = next((s for s in streams if s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic')), None)
    audio = next((s for s in streams if s.get('codec_type') == 'audio'), None)
    if not video or not video.get('width') or not video.get('height'):
        raise ValueError('missing_video')
    if require_audio and not audio:
        raise ValueError('missing_audio')
    duration = float(data.get('format', {}).get('duration', 0))
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('invalid_duration')
    fields = ('codec_type', 'codec_name', 'width', 'height', 'pix_fmt', 'color_transfer')
    return {'duration': duration, 'streams': [{k: s.get(k) for k in fields} for s in streams],
            'browserCandidate': bool({'mov', 'mp4'} & set(data.get('format', {}).get('format_name', '').split(',')))
            and video.get('codec_name') == 'h264' and video.get('pix_fmt') == 'yuv420p'
            and (not audio or audio.get('codec_name') == 'aac')}


def preview(ffmpeg, ffprobe, source, target):
    source = pathlib.Path(source).resolve(strict=True)
    target = pathlib.Path(target).resolve()
    if target == source or (target.exists() and os.path.samefile(source, target)):
        raise ValueError('preview_would_overwrite_source')
    original = probe(ffprobe, source)
    if any(s.get('color_transfer') in ('smpte2084', 'arib-std-b67') for s in original['streams']):
        raise ValueError('hdr_preview_requires_tonemapping')
    if not target.parent.is_dir():
        raise ValueError('invalid_directory')
    check_space(target.parent, source.stat().st_size)
    temporary = target.with_name('.preview-' + uuid.uuid4().hex + '.mp4')
    try:
        execute([str(ffmpeg), '-v', 'error', '-nostdin', '-n', '-i', str(source),
                 '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1',
                 '-vf', "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
                 '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-threads', '2',
                 '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(temporary)], 3600)
        result = probe(ffprobe, temporary, require_audio=any(s['codec_type'] == 'audio' for s in original['streams']))
        if not result['browserCandidate'] or abs(result['duration'] - original['duration']) > max(0.5, original['duration'] * 0.01):
            raise ValueError('preview_validation_failed')
        os.replace(temporary, target)  # Only a disposable cache, never the original asset.
        return result
    finally:
        temporary.unlink(missing_ok=True)


def cover(ffmpeg, source, target):
    source = pathlib.Path(source).resolve(strict=True)
    target = pathlib.Path(target).resolve()
    if target == source or (target.exists() and os.path.samefile(source, target)):
        raise ValueError('preview_would_overwrite_source')
    temporary = target.with_name('.cover-' + uuid.uuid4().hex + '.jpg')
    try:
        execute([str(ffmpeg), '-v', 'error', '-nostdin', '-n', '-i', str(source), '-map', '0:v:0',
                 '-map_metadata', '-1', '-vf', 'scale=320:-2', '-frames:v', '1', '-threads', '1',
                 '-update', '1', str(temporary)], 60)
        if temporary.stat().st_size == 0:
            raise ValueError('preview_validation_failed')
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
