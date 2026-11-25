"""Live wind (BoM) and beach safety (SLSA Beachsafe) for the app.

Run by .github/workflows/live.yml every 30 minutes (stdlib only). Neither source
can be read from a browser page, so the app reads these saved copies.

data/live.json    BoM wind observations (public FTP) for config.js `windStations`, last ~3 h
data/safety.json  Beachsafe patrol hours, hazard rating and hazards for each spot in
                  tools/beachsafe.json. Refreshed once a day (after 4am Brisbane).
"""
import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIVE, SAFETY = ROOT / 'data' / 'live.json', ROOT / 'data' / 'safety.json'
MAP = ROOT / 'tools' / 'beachsafe.json'
BNE = timezone(timedelta(hours=10))
UA = 'Mozilla/5.0 (compatible; cowabunga-forecast/1.0; +https://deskjet808.github.io/surf-forecast/)'
KEEP_OBS = 8  # about 3 hours of half-hourly readings


def get_json(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))


def stations():
    src = (ROOT / 'config.js').read_text(encoding='utf-8')
    block = src[src.index('windStations: ['):]
    block = block[:block.index('\n  ],')]
    return [{'id': m[1], 'product': m[2], 'name': m[3]} for m in
            re.finditer(r"id: '(\d+)', product: '(\w+)', name: '([^']+)'", block)]


def wind(old):
    """Latest reading per station from BoM's public FTP state summaries (IDQ60920, IDN60920),
    appended to the readings already saved so the app can show a short trend."""
    want = {s['id']: s for s in stations()}
    states = {'IDQ60801': 'IDQ60920', 'IDN60801': 'IDN60920'}
    latest = {}
    for prod in sorted({states[s['product']] for s in want.values()}):
        try:
            with urllib.request.urlopen(f'ftp://ftp.bom.gov.au/anon/gen/fwo/{prod}.xml', timeout=60) as r:
                root = ET.fromstring(r.read())
        except Exception as e:  # noqa: BLE001 - one state failing must not drop the other
            print('wind', prod, e)
            continue
        for st in root.iter('station'):
            sid = st.get('wmo-id')
            per = st.find('period')
            if sid not in want or per is None:
                continue
            el = {e.get('type'): e.text for e in per.iter('element')}
            if el.get('wind_spd_kmh') is None:
                continue
            num = lambda k: None if el.get(k) in (None, '') else float(el[k])
            # NSW reports in its own (summer) time; the app works in Brisbane time throughout
            t = datetime.fromisoformat(per.get('time-local')).astimezone(BNE).strftime('%Y-%m-%dT%H:%M')
            latest[sid] = {'t': t, 'dir': el.get('wind_dir') or '',
                           'deg': num('wind_dir_deg'), 'kmh': num('wind_spd_kmh'), 'gust': num('gust_kmh')}
    out = {}
    for sid, s in want.items():
        obs = list((old.get(sid) or {}).get('obs', []))
        if sid in latest and (not obs or obs[0]['t'] != latest[sid]['t']):
            obs.insert(0, latest[sid])
        if obs:
            out[sid] = {'name': s['name'], 'obs': obs[:KEEP_OBS]}
    return out


def nsw_summer(date):
    """NSW daylight saving: first Sunday of October to first Sunday of April."""
    d = datetime.fromisoformat(date)
    first_sun = lambda y, m: next(datetime(y, m, k) for k in range(1, 8) if datetime(y, m, k).weekday() == 6)
    return d >= first_sun(d.year, 10) or d < first_sun(d.year, 4)


def to_brisbane(hhmm, date, state):
    """Beachsafe gives local clock times; shift NSW summer time back an hour to Brisbane time."""
    if not hhmm or state != 'NSW' or not nsw_summer(date):
        return hhmm
    h, m = map(int, hhmm.split(':'))
    return f'{(h - 1) % 24:02d}:{m:02d}'


def merge_days(patrols, state):
    """Several services (club, lifeguards) can patrol one beach: widest hours per day."""
    days = {}
    for p in patrols:
        for d in p.get('days', []):
            if not d.get('is_patrol') or not d.get('start_time'):
                days.setdefault(d['date'], None)
                continue
            cur = days.get(d['date'])
            s = to_brisbane(d['start_time'][:5], d['date'], state)
            e = to_brisbane((d.get('end_time') or '')[:5], d['date'], state)
            days[d['date']] = (min(cur[0], s), max(cur[1], e)) if cur else (s, e)
    return days


def safety(today):
    mapping = json.loads(MAP.read_text(encoding='utf-8'))
    week = [(datetime.fromisoformat(today) + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(7)]
    by_slug, out = {}, {}
    for sid, m in mapping.items():
        slug = m['slug']
        if slug not in by_slug:
            try:
                b = get_json(f'https://beachsafe.org.au/api/v4/beach/{slug}')['beach']
                days = {}
                for start in (week[0], week[-1]):
                    days.update(merge_days(get_json(f"https://beachsafe.org.au/api/v4/beach/{b['id']}/patrols?date={start}").get('patrols', []), b.get('state')))
                    time.sleep(0.4)
                clubs = [c.get('title') for c in (b.get('clubs') or []) if c.get('title')]
                hazards = [f['name'] for f in (b.get('facilities') or []) if re.search('hazard', f.get('type') or '', re.I)]
                by_slug[slug] = {
                    'title': b.get('title'), 'url': f"https://beachsafe.org.au/beach{b['postcode_url']}/{slug}" if b.get('postcode_url') else 'https://beachsafe.org.au/',
                    'hazard': b.get('hazard'), 'clubs': clubs[:2], 'hazards': hazards[:5],
                    'week': [{'d': d, 's': days[d][0], 'e': days[d][1]} if days.get(d) else {'d': d} for d in week],
                }
            except Exception as e:  # noqa: BLE001
                print('safety', sid, slug, e)
                by_slug[slug] = None
            time.sleep(0.4)
        if by_slug[slug]:
            out[sid] = by_slug[slug]
    return out


def main():
    now = datetime.now(BNE)
    today = now.strftime('%Y-%m-%d')
    prev = json.loads(LIVE.read_text(encoding='utf-8')).get('wind', {}) if LIVE.exists() else {}
    w = wind(prev)
    if not w:
        sys.exit('No wind stations answered')
    LIVE.parent.mkdir(exist_ok=True)
    LIVE.write_text(json.dumps({'updated': now.strftime('%Y-%m-%dT%H:%M'), 'wind': w}, separators=(',', ':')))
    print('wind stations:', len(w))

    old = json.loads(SAFETY.read_text(encoding='utf-8')) if SAFETY.exists() else {}
    if '--safety' in sys.argv or (old.get('date') != today and now.hour >= 4):
        s = safety(today)
        if s:
            SAFETY.write_text(json.dumps({'updated': now.strftime('%Y-%m-%dT%H:%M'), 'date': today, 'spots': s},
                                         ensure_ascii=False, separators=(',', ':')))
        print('safety spots:', len(s))


if __name__ == '__main__':
    main()
