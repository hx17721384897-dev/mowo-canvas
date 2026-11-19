"""Build an atomic SQLite index of source display frames using bundled ffprobe."""

import argparse
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import uuid


def inspect_stream(ffprobe: pathlib.Path, source: pathlib.Path) -> dict:
    result = subprocess.run(
        [str(ffprobe), '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=time_base,duration_ts,nb_frames,width,height',
         '-of', 'json', str(source)],
        stdin=subprocess.DEVNULL, capture_output=True, check=True,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), timeout=60,
    )
    streams = json.loads(result.stdout).get('streams', [])
    if not streams:
        raise ValueError('missing_video_stream')
    stream = streams[0]
    numerator, denominator = (int(part) for part in stream['time_base'].split('/'))
    if numerator <= 0 or denominator <= 0:
        raise ValueError('invalid_time_base')
    return {
        'timeBaseNumerator': numerator,
        'timeBaseDenominator': denominator,
        'width': int(stream['width']),
        'height': int(stream['height']),
        'durationTicks': int(stream['duration_ts']) if stream.get('duration_ts') else None,
    }


def build(ffprobe: pathlib.Path, source: pathlib.Path, target: pathlib.Path, content_hash: str) -> dict:
    source = source.resolve(strict=True)
    ffprobe = ffprobe.resolve(strict=True)
    target = target.resolve()
    if not target.parent.is_dir() or target == source:
        raise ValueError('invalid_index_target')
    before = source.stat()
    metadata = inspect_stream(ffprobe, source)
    temporary = target.with_name('.frame-index-' + uuid.uuid4().hex + '.sqlite')
    process = None
    connection = None
    try:
        connection = sqlite3.connect(temporary)
        connection.execute('CREATE TABLE frames (ordinal INTEGER PRIMARY KEY, pts INTEGER NOT NULL, keyframe INTEGER NOT NULL)')
        connection.execute('CREATE INDEX frames_pts_idx ON frames(pts)')
        connection.execute('CREATE TABLE metadata (json TEXT NOT NULL)')
        process = subprocess.Popen(
            [str(ffprobe), '-v', 'error', '-select_streams', 'v:0', '-show_frames',
             '-show_entries', 'frame=key_frame,best_effort_timestamp', '-of', 'csv=p=0', str(source)],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding='utf-8', errors='replace',
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        count = 0
        last_pts = None
        batch = []
        for line in process.stdout:
            fields = line.strip().split(',', 2)
            if len(fields) < 2 or fields[0] not in ('0', '1'):
                raise ValueError('invalid_frame_index_row')
            pts = int(fields[1])
            if last_pts is not None and pts < last_pts:
                raise ValueError('frame_pts_out_of_order')
            batch.append((count, pts, int(fields[0])))
            count += 1
            last_pts = pts
            if len(batch) >= 4096:
                connection.executemany('INSERT INTO frames VALUES (?,?,?)', batch)
                batch.clear()
        if batch:
            connection.executemany('INSERT INTO frames VALUES (?,?,?)', batch)
        stderr = process.stderr.read(4096)
        if process.wait(timeout=10) != 0:
            raise RuntimeError('ffprobe_failed: ' + stderr.strip())
        if count == 0:
            raise ValueError('no_display_frames')
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('source_changed_during_index')
        metadata.update({'frameCount': count, 'firstPts': connection.execute('SELECT pts FROM frames WHERE ordinal=0').fetchone()[0],
                         'lastPts': last_pts, 'sourceBytes': after.st_size, 'sourceMtimeNs': str(after.st_mtime_ns),
                         'contentHash': content_hash, 'algorithmVersion': 1})
        connection.execute('INSERT INTO metadata VALUES (?)', (json.dumps(metadata, separators=(',', ':')),))
        connection.commit()
        connection.close()
        connection = None
        os.replace(temporary, target)
        return metadata
    finally:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait()
        if process is not None:
            process.stdout.close()
            process.stderr.close()
        if connection is not None:
            connection.close()
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--ffprobe', required=True, type=pathlib.Path)
    parser.add_argument('--source', required=True, type=pathlib.Path)
    parser.add_argument('--target', required=True, type=pathlib.Path)
    parser.add_argument('--content-hash', required=True)
    args = parser.parse_args()
    try:
        if len(args.content_hash) != 64 or any(c not in '0123456789abcdef' for c in args.content_hash):
            raise ValueError('invalid_content_hash')
        print(json.dumps(build(args.ffprobe, args.source, args.target, args.content_hash)), flush=True)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
