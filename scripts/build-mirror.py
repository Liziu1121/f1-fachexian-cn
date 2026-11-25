from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import sleep
from urllib.request import Request, urlopen
import json
import re

origin = 'https://f1-fachexian.briskrhubarb8.chatgpt.site'
output = Path('public')
output.mkdir(exist_ok=True)
(output / '.nojekyll').touch()

def pull(path):
    request = Request(origin + '/' + path, headers={'User-Agent': 'F1-Fachexian-Public-Mirror/1.0'})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=20) as response:
                return response.read()
        except OSError as error:
            if attempt == 2:
                raise OSError(f'Unable to fetch {path or "/"}') from error
            sleep(0.5 * (attempt + 1))

index = pull('').decode('utf-8')
if 'F1 发车线' not in index or 'src="./app.js"' not in index:
    raise SystemExit('Unexpected response from the primary site')
index = re.sub(r'^[ \t]*<link rel="stylesheet" href="https://fonts\.googleapis\.com/[^"\n]+">\n', '', index, flags=re.M)
index = re.sub(r'href="/(favicon\.ico|site\.webmanifest|icons/[^"\n]+)"', r'href="./\1"', index)
(output / 'index.html').write_text(index, encoding='utf-8')

files = ['style.css', 'app.js', 'data.js', 'content.js', 'editorial.js', 'locale.js',
         'news-archive.js', 'news-reports.js', 'track-history.js', 'trophy-art.js',
         'video.js', 'video-archive.js', 'favicon.ico', 'site.webmanifest']

def asset(path):
    data = pull(path)
    dest = output / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)

with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(asset, files))
    manifest_path = output / 'site.webmanifest'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    for field in ('id', 'start_url', 'scope'):
        manifest[field] = './'
    list(pool.map(asset, [icon['src'].lstrip('/') for icon in manifest['icons']] +
                  ['icons/favicon-32.png', 'icons/apple-touch-180.png']))
    for icon in manifest['icons']:
        icon['src'] = './' + icon['src'].lstrip('/')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')

    for name in ('app.js', 'video.js'):
        path = output / name
        script = path.read_text(encoding='utf-8')
        script = script.replace('fetch("/api/" + path,', 'fetch("./api/" + path + ".json",')
        script = script.replace('fetch("/api/videos/mainland",', 'fetch("./api/videos/mainland.json",')
        path.write_text(script, encoding='utf-8')

    apis = [f'standings/{year}/{kind}' for year in range(2023, 2027) for kind in ('drivers', 'team')]
    try:
        edition = json.loads(Path('.live-cache/edition.json').read_text(encoding='utf-8'))
        refresh_edition = int(datetime.now(timezone.utc).timestamp() // 10800) != edition['window']
    except (OSError, ValueError, TypeError, KeyError):
        refresh_edition = True
    if refresh_edition:
        apis += ['news/latest']
    try:
        video = json.loads(Path('.live-cache/official-video.json').read_text(encoding='utf-8'))
        refresh_video = (int(datetime.now(timezone.utc).timestamp() // 10800) != video['window'] or video.get('sourceVersion') != 2)
    except (OSError, ValueError, TypeError, KeyError):
        refresh_video = True
    if refresh_video:
        apis += ['videos/mainland']
    data = (output / 'data.js').read_text(encoding='utf-8').split('=', 1)[1].lstrip()
    races = json.JSONDecoder().raw_decode(data)[0]['races']
    now = datetime.now(timezone.utc)
    for race, details in races.items():
        for session, stamp in details['sessions'].items():
            when = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
            if now - timedelta(days=21) < when <= now:
                apis.append(f'results/{race}/{session}')
                if session == 'q':
                    apis.append(f'results/{race}/grid')

    def snapshot(path):
        try:
            body = pull('api/' + path)
            data = json.loads(body)
            if not isinstance(data, dict) or 'error' in data:
                return
            dest = output / ('api/' + path + '.json')
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(body)
        except (OSError, ValueError) as error:
            print(f'::warning::Snapshot unavailable for {path}: {error}')

    list(pool.map(snapshot, apis))
