"""Match each spot in config.js to its nearest Surf Life Saving Beachsafe beach.

Writes tools/beachsafe.json ({spot id: {slug, title, metres}}), which tools/live.py
reads once a day for patrol times and hazards. Re-run after adding spots, then
check the titles by eye: points and reefs map to the nearest patrolled beach.

    python tools/beachsafe_match.py
"""
import json
import math
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tools' / 'beachsafe.json'
UA = {'User-Agent': 'Mozilla/5.0 (compatible; cowabunga-forecast/1.0)', 'Accept': 'application/json'}
BOX = 0.015      # search half-width in degrees (~1.6 km)
MAX_M = 1500     # ignore beaches further than this


def spots():
    src = (ROOT / 'config.js').read_text(encoding='utf-8')
    for m in re.finditer(r"id: '([\w-]+)', name: [\"']([^\"']+)[\"'].*?lat: (-?[\d.]+), lon: (-?[\d.]+)", src, re.S):
        yield m[1], m[2], float(m[3]), float(m[4])


def metres(a, b, c, d):
    k = math.pi / 180
    x = (d - b) * k * math.cos((a + c) / 2 * k)
    return 6371000 * math.hypot(x, (c - a) * k)


def main():
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    out = {}
    for sid, name, la, lo in spots():
        if sid in old and old[sid].get('locked'):
            out[sid] = old[sid]
            continue
        q = urllib.parse.urlencode([('neCoords[]', la + BOX), ('neCoords[]', lo + BOX),
                                    ('swCoords[]', la - BOX), ('swCoords[]', lo - BOX)])
        req = urllib.request.Request(f'https://beachsafe.org.au/api/v4/map/beaches?{q}', headers=UA)
        beaches = json.loads(urllib.request.urlopen(req, timeout=30).read()).get('beaches', [])
        best = min(((metres(la, lo, float(b['latitude']), float(b['longitude'])), b) for b in beaches),
                   default=None, key=lambda x: x[0])
        if best and best[0] <= MAX_M:
            d, b = best
            out[sid] = {'slug': b['url'].rstrip('/').split('/')[-1], 'title': b['title'], 'metres': round(d)}
            print(f'{name:28} -> {b["title"]} ({round(d)} m)')
        else:
            print(f'{name:28} -> (none within {MAX_M} m)')
        time.sleep(0.4)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
