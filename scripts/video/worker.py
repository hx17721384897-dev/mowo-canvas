"""One-request video engine. stdout is versioned NDJSON, never downloader logs."""
import contextlib
import http.cookiejar
import importlib.util
import json
import pathlib
import re
import sys
from urllib.parse import parse_qs, urlparse
import urllib.request
import urllib.error

PROTOCOL = 1


def sibling(name):
    spec = importlib.util.spec_from_file_location('video_' + name, pathlib.Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def emit(event, **data):
    print(json.dumps({'v': PROTOCOL, 'event': event, **data}, ensure_ascii=True), file=sys.__stdout__, flush=True)


def normalize(value):
    if not isinstance(value, str) or len(value) > 2000:
        raise ValueError('invalid_input')
    value = value.strip()
    if re.fullmatch(r'BV[0-9A-Za-z]{10}', value):
        value = 'https://www.bilibili.com/video/' + value
    url = urlparse(value)
    if url.scheme != 'https' or url.username or url.password or url.port not in (None, 443):
        raise ValueError('invalid_input')
    if url.hostname not in ('www.bilibili.com', 'bilibili.com'):
        # Short links require a separately validated redirect resolver, never yt-dlp generic redirects.
        raise ValueError('unsupported_url')
    match = re.fullmatch(r'/video/(BV[0-9A-Za-z]{10})/?', url.path)
    if not match:
        raise ValueError('unsupported_url')
    part = parse_qs(url.query).get('p', ['1'])
    if len(part) != 1 or not part[0].isdigit() or not 1 <= int(part[0]) <= 10000:
        raise ValueError('invalid_part')
    return 'https://www.bilibili.com/video/' + match[1] + '?p=' + str(int(part[0]))


def public_info(info):
    fields = ('format_id', 'ext', 'width', 'height', 'fps', 'vcodec', 'acodec',
              'filesize', 'filesize_approx', 'tbr', 'format_note')
    return {'id': info.get('id'), 'title': info.get('title'),
            'duration': info.get('duration'),
            'formats': [{k: f.get(k) for k in fields} for f in info.get('formats', [])]}


def resolve_short(value):
    parsed = urlparse(value)
    if parsed.hostname != 'b23.tv':
        return normalize(value)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443) or not re.fullmatch(r'/[A-Za-z0-9]{1,32}/?', parsed.path):
        raise ValueError('unsupported_url')
    auth = sibling('auth')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), auth.NoRedirect())
    try:
        with opener.open(urllib.request.Request('https://b23.tv' + parsed.path, headers=auth.HEADERS), timeout=20):
            raise ValueError('unsupported_url')
    except urllib.error.HTTPError as error:
        if error.code not in (301, 302, 303, 307, 308):
            raise
        # Validate the destination before any network request; no arbitrary redirect chain.
        return normalize(error.headers.get('Location', ''))


class QuietLogger:
    def debug(self, message): pass
    def warning(self, message): pass
    def error(self, message): pass


def merge_hook(directory, progress):
    if progress.get('status') == 'started':
        amount = sum(p.stat().st_size for p in directory.iterdir() if p.is_file() and p.suffix in ('.mp4', '.mkv', '.webm', '.m4a', '.part'))
        sibling('media').check_space(directory, amount)
        emit('stage', stage='merging')


def engine(request, overrides=None):
    import yt_dlp
    options = {'quiet': True, 'no_warnings': True, 'logger': QuietLogger(),
               'noplaylist': True, 'socket_timeout': 20, 'retries': 3,
               'cachedir': False, 'ignoreconfig': True,
               'proxy': '',
               'http_headers': {'Referer': 'https://www.bilibili.com/',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'}}
    if request.get('ffmpeg'):
        options['ffmpeg_location'] = str(pathlib.Path(request['ffmpeg']).resolve(strict=True))
    # Cookie values arrive only through stdin and remain in the Python cookie jar.
    options.update(overrides or {})
    ydl = yt_dlp.YoutubeDL(options)
    cookies = request.get('cookies', {})
    if request.get('credentialFile'):
        cookies = sibling('auth').read_credentials(request['credentialFile'])
    for name, value in cookies.items():
        if name not in ('SESSDATA', 'bili_jct', 'DedeUserID', 'buvid3', 'buvid4'):
            continue
        ydl.cookiejar.set_cookie(http.cookiejar.Cookie(
            0, name, value, None, False, '.bilibili.com', True, True,
            '/', True, True, None, True, None, None, {}))
    return ydl


def run(request):
    if request.get('v') != PROTOCOL:
        raise ValueError('protocol_version')
    action = request.get('action')
    if action == 'health':
        import yt_dlp.version
        emit('health', python=sys.version.split()[0], extractor=yt_dlp.version.__version__)
        return
    if action == 'probe':
        emit('probed', **sibling('media').probe(request['ffprobe'], request['file'], request.get('requireAudio', False)))
        return
    if action == 'preview':
        emit('previewed', **sibling('media').preview(request['ffmpeg'], request['ffprobe'], request['file'], request['target']))
        return
    if action == 'cover':
        sibling('media').cover(request['ffmpeg'], request['file'], request['target'])
        emit('covered')
        return
    if action not in ('resolve', 'download'):
        raise ValueError('unsupported_action')
    value = request.get('url')
    if not isinstance(value, str) or len(value) > 2000:
        raise ValueError('invalid_input')
    url = resolve_short(value.strip()) if action == 'resolve' else normalize(value)
    ydl = engine(request)
    with contextlib.redirect_stdout(sys.stderr):
        info = ydl.extract_info(url, download=False)
    ydl.close()
    if not info or info.get('entries') is not None:
        raise ValueError('single_part_required')
    if action == 'resolve':
        video = public_info(info)
        bvid = re.search(r'/video/(BV[0-9A-Za-z]{10})', url)[1]
        result, _ = sibling('auth').api('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid)
        detail = result.get('data') or {}
        pages = detail.get('pages') or []
        part = int(parse_qs(urlparse(url).query)['p'][0])
        page = next((p for p in pages if p.get('page') == part), None)
        if not page:
            raise ValueError('invalid_part')
        video.update(sourceUrl=url, bvid=bvid, part=part, cid=str(page['cid']),
                     cover=detail.get('pic'), pages=[{'part': p['page'], 'title': p.get('part', ''), 'duration': p.get('duration')} for p in pages])
        emit('resolved', video=video)
        return
    selected = request.get('formatIds')
    if not isinstance(selected, list) or not 1 <= len(selected) <= 2:
        raise ValueError('invalid_format')
    available = {f['format_id'] for f in info.get('formats', [])}
    if any(not isinstance(f, str) or not re.fullmatch(r'[\w.-]+', f) or f not in available for f in selected):
        raise ValueError('format_unavailable')
    directory = pathlib.Path(request['directory']).resolve(strict=True)
    if not directory.is_dir():
        raise ValueError('invalid_directory')
    import yt_dlp.version
    candidate = sibling('recovery').prepare(directory, url, info, selected, yt_dlp.version.__version__)
    offsets = {p.stat().st_size for p in directory.iterdir() if p.is_file() and p.name.endswith('.part') and p.stat().st_size > 0}
    existing = any((directory / ('source.' + ext)).is_file() for ext in ('mp4', 'mkv', 'webm'))
    emit('recovery', mode='candidate' if candidate else 'existing' if existing else 'fresh', bytes=candidate)
    emit('stage', stage='downloading')
    # The parent must hold execution and task-directory locks before invoking this action.
    ydl = engine(request, {'format': '+'.join(selected), 'outtmpl': str(directory / 'source.%(ext)s'),
                       'merge_output_format': 'mp4',
                       'progress_hooks': [lambda p: emit('progress',
                           downloaded=p.get('downloaded_bytes'), total=p.get('total_bytes'),
                           speed=p.get('speed'))],
                       'postprocessor_hooks': [lambda p: merge_hook(directory, p)]})
    if request.get('rateLimit') is not None:
        limit = request['rateLimit']
        if not isinstance(limit, int) or not 16384 <= limit <= 10485760:
            raise ValueError('invalid_rate_limit')
        ydl.params['ratelimit'] = limit
    original_urlopen = ydl.urlopen
    def observed_urlopen(req):
        response = original_urlopen(req)
        match = re.fullmatch(r'bytes=(\d+)-.*', getattr(req, 'headers', {}).get('Range', ''))
        if match and int(match[1]) in offsets:
            offsets.discard(int(match[1]))
            content_range = re.match(r'bytes (\d+)-', response.headers.get('Content-Range', ''))
            continued = response.status == 206 and content_range and content_range[1] == match[1]
            emit('recovery', mode='continued' if continued else 'restarted', bytes=int(match[1]) if continued else 0)
        return response
    ydl.urlopen = observed_urlopen
    # Re-process the freshly extracted metadata to preserve exact format selection.
    with ydl, contextlib.redirect_stdout(sys.stderr):
        ydl.process_ie_result(info, download=True)
    files = [p for p in directory.iterdir() if p.suffix in ('.mp4', '.mkv', '.webm')]
    if len(files) != 1:
        raise ValueError('output_not_unique')
    formats = [f for f in info.get('formats', []) if f.get('format_id') in selected]
    emit('downloaded', file=files[0].name, requireAudio=any(f.get('acodec') not in (None, 'none') for f in formats))


def main():
    try:
        line = sys.stdin.buffer.readline(65537)
        if len(line) > 65536:
            raise ValueError('request_too_large')
        request = json.loads(line)
        if not isinstance(request, dict):
            raise ValueError('invalid_request')
        run(request)
        emit('done')
    except Exception as error:
        # Never echo extractor exceptions: they may contain signed URLs or credentials.
        known = {'invalid_input', 'invalid_part', 'unsupported_url', 'protocol_version',
                 'unsupported_action', 'single_part_required', 'invalid_format',
                 'format_unavailable', 'invalid_directory', 'output_not_unique',
                 'missing_video', 'request_too_large', 'invalid_request', 'credential_unavailable',
                 'missing_audio', 'invalid_duration', 'preview_would_overwrite_source', 'preview_validation_failed',
                 'hdr_preview_requires_tonemapping', 'resume_identity_changed', 'resume_unverified', 'invalid_rate_limit', 'disk_full'}
        text = str(error)
        code = text if text in known else 'engine_failed'
        if 'No space left on device' in text or 'not enough space' in text.lower():
            code = 'disk_full'
        if re.search(r'HTTP Error (412|429)', text):
            code = 'platform_rejected'
        elif 'timed out' in text.lower():
            code = 'network_timeout'
        emit('failed', code=code)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
