"""Reject partial downloads unless an identity manifest without signed media URLs matches."""
import hashlib
import json
import os
import pathlib
import uuid
from urllib.parse import urlparse


def prepare(directory, url, info, selected, version):
    directory = pathlib.Path(directory)
    formats = {f['format_id']: f for f in info['formats']}
    for selected_id in selected:
        remote = urlparse(formats[selected_id].get('url') or '')
        if remote.scheme not in ('http', 'https') or not remote.hostname or not remote.path:
            raise ValueError('resume_unverified')
    identity = {'v': 1, 'url': url, 'id': info['id'], 'formats': selected, 'extractor': version,
                'streams': [{k: formats[f].get(k) for k in ('format_id', 'width', 'height', 'vcodec', 'acodec', 'filesize', 'ext')}
                            | {'object': hashlib.sha256(urlparse(formats[f].get('url', '')).path.encode()).hexdigest()}
                            for f in selected]}
    manifest = directory / 'identity.json'
    files = [p for p in directory.iterdir() if p.name not in ('identity.json', '.task.lock')]
    if manifest.exists():
        try:
            previous = json.loads(manifest.read_text(encoding='utf-8'))
        except (ValueError, UnicodeError):
            raise ValueError('resume_unverified') from None
        if previous != identity:
            raise ValueError('resume_identity_changed')
    elif files:
        raise ValueError('resume_unverified')
    else:
        temporary = directory / ('.identity-' + uuid.uuid4().hex)
        try:
            with temporary.open('x', encoding='utf-8') as file:
                json.dump(identity, file, sort_keys=True)
                file.flush(); os.fsync(file.fileno())
            os.replace(temporary, manifest)
        finally:
            temporary.unlink(missing_ok=True)
    return sum(p.stat().st_size for p in files if p.is_file() and p.name.endswith('.part'))
