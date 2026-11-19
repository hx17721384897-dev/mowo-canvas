"""Read one indexed source display frame as JPEG, verifying the decoded PTS."""

import argparse
import json
import pathlib
import re
import sqlite3
import subprocess
import sys


def render(ffmpeg: pathlib.Path, source: pathlib.Path, index: pathlib.Path, ordinal: int) -> bytes:
    source = source.resolve(strict=True)
    index = index.resolve(strict=True)
    with sqlite3.connect(f'file:{index.as_posix()}?mode=ro', uri=True) as database:
        metadata = json.loads(database.execute('SELECT json FROM metadata LIMIT 1').fetchone()[0])
        info = source.stat()
        if info.st_size != metadata['sourceBytes'] or str(info.st_mtime_ns) != metadata['sourceMtimeNs']:
            raise ValueError('source_changed_after_index')
        row = database.execute('SELECT pts FROM frames WHERE ordinal=?', (ordinal,)).fetchone()
        if row is None:
            raise ValueError('frame_out_of_range')
        target_pts = row[0]
        duplicate = database.execute('SELECT count(*) FROM frames WHERE pts=?', (target_pts,)).fetchone()[0] > 1
        anchor = database.execute('SELECT pts FROM frames WHERE ordinal<=? AND keyframe=1 ORDER BY ordinal DESC LIMIT 1', (ordinal,)).fetchone()
        numerator = metadata['timeBaseNumerator']
        denominator = metadata['timeBaseDenominator']
        anchor_seconds = max(0, anchor[0] * numerator / denominator) if anchor else 0

    def decode(use_ordinal: bool) -> bytes | None:
        expression = f'eq(n\\,{ordinal})' if use_ordinal else f'eq(pts\\,{target_pts})'
        args = [str(ffmpeg), '-v', 'info', '-nostdin']
        if not use_ordinal and anchor_seconds:
            args += ['-ss', f'{anchor_seconds:.9f}', '-copyts']
        args += ['-i', str(source), '-map', '0:v:0', '-vf', f'select={expression},showinfo',
                 '-frames:v', '1', '-q:v', '3', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']
        result = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, timeout=120,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode != 0 or not result.stdout:
            return None
        found = re.search(rb'\[Parsed_showinfo_\d+[^\]]*\] n:\s*\d+ pts:\s*(-?\d+)', result.stderr)
        if not found or int(found.group(1)) != target_pts:
            return None
        return result.stdout

    image = decode(duplicate)
    if image is None and not duplicate:
        image = decode(True)
    if image is None or not image.startswith(b'\xff\xd8') or not image.endswith(b'\xff\xd9'):
        raise ValueError('frame_decode_mismatch')
    return image


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--ffmpeg', required=True, type=pathlib.Path)
    parser.add_argument('--source', required=True, type=pathlib.Path)
    parser.add_argument('--index', required=True, type=pathlib.Path)
    parser.add_argument('--ordinal', required=True, type=int)
    args = parser.parse_args()
    try:
        sys.stdout.buffer.write(render(args.ffmpeg, args.source, args.index, args.ordinal))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
