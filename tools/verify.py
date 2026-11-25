"""Forecast vs buoy track record.

Run by .github/workflows/verify.yml twice a day (stdlib only):
  1. Saves what Open-Meteo forecast for each buoy in config.js, the same day,
     one day ahead and two days ahead (its previous-runs data).
  2. Saves the buoys' measured wave height (Hs), averaged to each hour.
  3. Scores every hour that has both, and writes a small summary the app reads.

data/verify.json  raw store (forecasts + readings, last KEEP_DAYS days)
data/track.json   summary for the app (last WINDOW_DAYS days)
"""
import csv
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / 'data' / 'verify.json', ROOT / 'data' / 'track.json'
BNE = timezone(timedelta(hours=10))  # Queensland has no daylight saving
LEADS = 3                 # same day, a day ahead, two days ahead
VARS = ['wave_height', 'wave_height_previous_day1', 'wave_height_previous_day2']
PAST_DAYS = 14
KEEP_DAYS = 60
WINDOW_DAYS = 30
READY_DAYS = 7            # the app shows "Collecting" until this many days are scored
TOL = 0.2                 # a forecast hour is a hit when within 0.2 m of the buoy
HOURS = range(4, 20)      # daylight only: 4am to 7pm
WAVE_RES = '2bbef99e-9974-49b9-a316-57402b00609c'
CKAN = 'https://www.data.qld.gov.au/api/3/action/datastore_search'
CSV = 'https://apps.des.qld.gov.au/data-sets/waves/wave-7dayopdata.csv'
UA = {'User-Agent': 'cowabunga-verify/1.0'}


def get(url, timeout=40):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read().decode('utf-8', 'replace')


def buoys():
    src = (ROOT / 'config.js').read_text(encoding='utf-8')
    block = src[src.index('buoys: ['):]
    block = block[:block.index('\n  ],')]
    out = []
    for line in block.splitlines():
        m = re.search(r"site:\s*'([^']+)'.*?region:\s*'(\w+)'.*?lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)", line)
        if m and 'upstream: true' not in line:  # upstream buoys are an early warning, not this region's record
            out.append({'site': m[1], 'region': m[2], 'lat': float(m[3]), 'lon': float(m[4])})
    if not out:
        sys.exit('No buoys found in config.js')
    return out


def save_forecasts(store, bs, now):
    # Open-Meteo keeps earlier runs: for each past hour, wave_height is the
    # same-day forecast, *_previous_day1 the one issued a day earlier, and so on.
    # Re-reading the last PAST_DAYS each run fills any runs GitHub skipped.
    url = ('https://marine-api.open-meteo.com/v1/marine?'
           + urllib.parse.urlencode({
               'latitude': ','.join(str(b['lat']) for b in bs),
               'longitude': ','.join(str(b['lon']) for b in bs),
               'hourly': ','.join(VARS), 'timezone': 'Australia/Brisbane',
               'past_days': PAST_DAYS, 'forecast_days': 1, 'cell_selection': 'sea'}))
    data = json.loads(get(url))
    if isinstance(data, dict):
        data = [data]
    stamp = now.strftime('%Y-%m-%dT%H')
    n = 0
    for b, d in zip(bs, data):
        fc = store['fc'].setdefault(b['site'], {})
        h = d['hourly']
        for i, t in enumerate(h['time']):
            if t[:13] >= stamp or int(t[11:13]) not in HOURS:
                continue  # only hours that have happened
            row = [h[v][i] for v in VARS]
            if any(v is not None for v in row):
                fc[t[:13]] = [None if v is None else round(v, 2) for v in row]
                n += 1
    return n


def fetch_readings(bs):
    want = {b['site'] for b in bs}
    try:
        q = urllib.parse.urlencode({'resource_id': WAVE_RES, 'limit': 2000, 'sort': 'Seconds desc',
                                    'filters': json.dumps({'Site': sorted(want)})})
        rows = json.loads(get(f'{CKAN}?{q}'))['result']['records']
    except Exception as e:  # noqa: BLE001 - fall back to the 7-day CSV from the same source
        print('CKAN failed, using CSV:', e)
        lines = get(CSV, 90).splitlines()
        rows = list(csv.DictReader(io.StringIO('\n'.join(lines[1:]))))
        rows = [{k.strip(): (v or '').strip() for k, v in r.items() if k} for r in rows]
    out = []
    for r in rows:
        site = str(r.get('Site', '')).strip()
        try:
            hs = float(r.get('Hs'))
        except (TypeError, ValueError):
            continue
        if site in want and hs > 0:
            out.append((site, str(r['DateTime']).strip()[:16], hs))
    return out


def save_readings(store, rows):
    # Average each buoy's readings within 30 min either side of the hour.
    acc = {}
    for site, t, hs in rows:
        dt = datetime.fromisoformat(t.replace(' ', 'T'))
        hour = (dt + timedelta(minutes=30)).replace(minute=0)
        if hour.hour in HOURS:
            acc.setdefault((site, hour.strftime('%Y-%m-%dT%H')), []).append(hs)
    for (site, h), v in acc.items():
        store['obs'].setdefault(site, {})[h] = round(sum(v) / len(v), 2)
    return len(acc)


def prune(store, today):
    cut = (datetime.fromisoformat(today) - timedelta(days=KEEP_DAYS)).strftime('%Y-%m-%d')
    for k in ('fc', 'obs'):
        for site in store[k]:
            store[k][site] = {h: v for h, v in sorted(store[k][site].items()) if h >= cut}


def summarise(store, bs, today):
    cut = (datetime.fromisoformat(today) - timedelta(days=WINDOW_DAYS)).strftime('%Y-%m-%d')
    regions = {}
    for b in bs:
        reg = regions.setdefault(b['region'], {'days': set(), 'leads': [[] for _ in range(LEADS)]})
        fc, obs = store['fc'].get(b['site'], {}), store['obs'].get(b['site'], {})
        for h, o in obs.items():
            if h < cut or h[:10] >= today or h not in fc:  # only finished days
                continue
            for lead, f in enumerate(fc[h]):
                if f is not None:
                    reg['leads'][lead].append(f - o)
                    reg['days'].add(h[:10])
    out = {}
    for key, reg in regions.items():
        leads = []
        for errs in reg['leads']:
            n = len(errs)
            leads.append({'n': n,
                          'hit': round(sum(abs(e) <= TOL + 1e-9 for e in errs) / n, 3) if n else None,
                          'bias': round(sum(errs) / n, 2) if n else None,
                          'mae': round(sum(abs(e) for e in errs) / n, 2) if n else None})
        days = sorted(reg['days'])
        out[key] = {'days': len(days), 'from': days[0] if days else None, 'to': days[-1] if days else None, 'leads': leads}
    return {'updated': datetime.now(BNE).strftime('%Y-%m-%dT%H:%M'), 'since': store.get('since'),
            'tol': TOL, 'window': WINDOW_DAYS, 'ready': READY_DAYS,
            'hours': [HOURS.start, HOURS.stop], 'regions': out}


def main():
    bs = buoys()
    now = datetime.now(BNE)
    today = now.strftime('%Y-%m-%d')
    store = json.loads(RAW.read_text()) if RAW.exists() else {'since': today, 'fc': {}, 'obs': {}}
    errors = []
    try:
        print('forecast hours added:', save_forecasts(store, bs, now))
    except Exception as e:  # noqa: BLE001
        errors.append(f'forecast: {e}')
    try:
        print('reading hours saved:', save_readings(store, fetch_readings(bs)))
    except Exception as e:  # noqa: BLE001
        errors.append(f'buoys: {e}')
    prune(store, today)
    RAW.parent.mkdir(exist_ok=True)
    RAW.write_text(json.dumps(store, separators=(',', ':'), sort_keys=True))
    summary = summarise(store, bs, today)
    OUT.write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary['regions']))
    if len(errors) == 2:
        sys.exit('; '.join(errors))
    for e in errors:
        print('warning:', e)


if __name__ == '__main__':
    main()
