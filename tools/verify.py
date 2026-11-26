"""Forecast accuracy: what the models said vs what the buoys and wind stations measured.

Run by .github/workflows/verify.yml twice a day (stdlib only):
  1. Saves what three wave models and three wind models forecast for each buoy and
     BoM wind station: the same day, one day ahead and two days ahead (Open-Meteo
     keeps earlier runs as *_previous_day1/2).
       main  = Open-Meteo best match: the forecast Cowabunga rates with
       ecmwf = ECMWF (European)      gfs = NOAA GFS (American)
  2. Saves what was measured: wave height, direction and peak period from the Qld
     Government buoys and the NSW (Manly Hydraulics Lab) buoys, and hourly wind from
     the BoM stations (tools/live.py keeps data/windhist.json).
  3. Scores every daylight hour that has both.

data/verify.json    raw store (forecasts + measurements, last KEEP_DAYS days)
data/track.json     the app's track record: main wave model, last WINDOW_DAYS days
data/accuracy.json  the private accuracy dashboard: every model, waves and wind, daily series
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
RAW, OUT, ACC = ROOT / 'data' / 'verify.json', ROOT / 'data' / 'track.json', ROOT / 'data' / 'accuracy.json'
WINDHIST = ROOT / 'data' / 'windhist.json'
BNE = timezone(timedelta(hours=10))  # Queensland has no daylight saving
LEADS = 3                 # same day, a day ahead, two days ahead
PAST_DAYS = 14
KEEP_DAYS = 35           # a little more than WINDOW_DAYS
WINDOW_DAYS = 30
READY_DAYS = 7            # the app shows "Collecting" until this many days are scored
TOL = 0.2                 # a wave hour is a hit when within 0.2 m of the buoy
WIND_TOL = 7              # a wind hour is a hit when within 7 km/h ...
DIR_TOL = 45              # ... and (if not light) within 45° of the measured direction
DIR_MIN_KMH = 8           # direction is only scored when the wind is at least this strong
HOURS = range(4, 20)      # daylight only: 4am to 7pm
WAVE_RES = '2bbef99e-9974-49b9-a316-57402b00609c'
CKAN = 'https://www.data.qld.gov.au/api/3/action/datastore_search'
CSV = 'https://apps.des.qld.gov.au/data-sets/waves/wave-7dayopdata.csv'
MHL = 'https://mhl.nsw.gov.au/s3/www/stations/wave/{}.json'
UA = {'User-Agent': 'Mozilla/5.0 (compatible; cowabunga-verify/2.0; +https://deskjet808.github.io/surf-forecast/)'}

MODELS = {'main': 'best_match', 'ecmwf': 'ecmwf_wam025', 'gfs': 'ncep_gfswave025'}
WIND_MODELS = {'main': 'best_match', 'ecmwf': 'ecmwf_ifs025', 'gfs': 'gfs_seamless'}
MODEL_NAMES = {'main': 'Cowabunga (Open-Meteo best match)', 'ecmwf': 'ECMWF (European)', 'gfs': 'GFS (American)'}
REGION_NAMES = {'sc': 'Sunshine Coast', 'gc': 'Gold Coast', 'nnsw': 'Northern NSW', 'syd': 'Sydney'}

# Buoys that score a region but aren't in config.js's buoy list (that list feeds the app's
# Qld "Buoy check"). NSW buoys are MHL's; their times are Australian Eastern Standard Time.
# Positions are approximate (only used to pick the model grid cell).
EXTRA_BUOYS = [
    {'site': 'Tweed Offshore', 'region': 'nnsw', 'lat': -28.21352, 'lon': 153.68170, 'src': 'qld'},
    {'site': 'Byron Bay', 'region': 'nnsw', 'lat': -28.82, 'lon': 153.72, 'src': 'mhl', 'code': 'BYRBOW'},
    {'site': 'Sydney', 'region': 'syd', 'lat': -33.78, 'lon': 151.42, 'src': 'mhl', 'code': 'SYDDOW'},
]


def get(url, timeout=40):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read().decode('utf-8', 'replace')


def config_block(name):
    src = (ROOT / 'config.js').read_text(encoding='utf-8')
    block = src[src.index(f'{name}: ['):]
    return block[:block.index('\n  ],')]


def buoys():
    out = []
    for line in config_block('buoys').splitlines():
        m = re.search(r"site:\s*'([^']+)'.*?region:\s*'(\w+)'.*?lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)", line)
        if m and 'upstream: true' not in line:  # upstream buoys are an early warning, not this region's record
            out.append({'site': m[1], 'region': m[2], 'lat': float(m[3]), 'lon': float(m[4]), 'src': 'qld'})
    if not out:
        sys.exit('No buoys found in config.js')
    return out + EXTRA_BUOYS


def region_of(lat):
    return 'syd' if lat < -33 else 'nnsw' if lat < -28.3 else 'gc' if lat < -27.5 else 'sc'


def stations():
    return [{'id': m[1], 'name': m[2], 'lat': float(m[3]), 'lon': float(m[4]), 'region': region_of(float(m[3]))}
            for m in re.finditer(r"id: '(\d+)', product: '\w+', name: '([^']+)',\s*lat: (-?[\d.]+), lon: (-?[\d.]+)",
                                 config_block('windStations'))]


def om(base, pts, hourly, models, extra=None):
    q = {'latitude': ','.join(str(p['lat']) for p in pts), 'longitude': ','.join(str(p['lon']) for p in pts),
         'hourly': ','.join(hourly), 'models': ','.join(models), 'timezone': 'Australia/Brisbane',
         'past_days': PAST_DAYS, 'forecast_days': 1, **(extra or {})}
    data = json.loads(get(f'{base}?{urllib.parse.urlencode(q)}', 90))
    return data if isinstance(data, list) else [data]


def col(h, var, model):
    """Open-Meteo names a variable var_<model> when several models are asked for at once."""
    for k in (f'{var}_{model}', f'{var}_marine_{model}', var):
        if k in h:
            return h[k]
    return None


def done_hours(h, now):
    stamp = now.strftime('%Y-%m-%dT%H')
    return [(i, t[:13]) for i, t in enumerate(h['time']) if t[:13] < stamp and int(t[11:13]) in HOURS]


def r2(v, nd=2):
    return None if v is None else round(v, nd)


def save_wave_forecasts(store, bs, now):
    hv = ['wave_height', 'wave_height_previous_day1', 'wave_height_previous_day2', 'wave_direction', 'swell_wave_period']
    data = om('https://marine-api.open-meteo.com/v1/marine', bs, hv, MODELS.values(), {'cell_selection': 'sea'})
    n = 0
    for b, d in zip(bs, data):
        h = d['hourly']
        fc, wf = store['fc'].setdefault(b['site'], {}), store['wf'].setdefault(b['site'], {})
        for i, t in done_hours(h, now):
            row = {}
            for key, m in MODELS.items():
                hs = [r2((col(h, v, m) or [None] * (i + 1))[i]) for v in hv[:3]]
                if any(v is not None for v in hs):
                    row[key] = hs
            main = col(h, 'wave_direction', MODELS['main']), col(h, 'swell_wave_period', MODELS['main'])
            if 'main' in row:
                fc[t] = row['main']  # the app's track record keeps its original shape
                row['dir'] = r2(main[0][i], 0) if main[0] else None
                row['per'] = r2(main[1][i], 1) if main[1] else None
            if row:
                wf[t] = row
                n += 1
    return n


def save_wind_forecasts(store, sts, now):
    hv = ['wind_speed_10m', 'wind_speed_10m_previous_day1', 'wind_speed_10m_previous_day2',
          'wind_direction_10m', 'wind_direction_10m_previous_day1', 'wind_direction_10m_previous_day2']
    data = om('https://api.open-meteo.com/v1/forecast', sts, hv, WIND_MODELS.values(), {'wind_speed_unit': 'kmh'})
    n = 0
    for s, d in zip(sts, data):
        h = d['hourly']
        wf = store['windfc'].setdefault(s['id'], {})
        for i, t in done_hours(h, now):
            row = {}
            for key, m in WIND_MODELS.items():
                vals = [(col(h, v, m) or [None] * (i + 1))[i] for v in hv]
                if any(v is not None for v in vals):
                    row[key] = [r2(v, 0) for v in vals]  # [speed ×3 leads, direction ×3 leads]
            if row:
                wf[t] = row
                n += 1
    return n


def hour_of(dt):
    return (dt + timedelta(minutes=30)).replace(minute=0, second=0)


def fetch_qld(sites):
    try:
        q = urllib.parse.urlencode({'resource_id': WAVE_RES, 'limit': 4000, 'sort': 'Seconds desc',
                                    'filters': json.dumps({'Site': sorted(sites)})})
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
        num = lambda k: (lambda v: v if v is not None and v > 0 else None)(_f(r.get(k)))
        if site in sites and hs > 0:
            out.append((site, datetime.fromisoformat(str(r['DateTime']).strip()[:16].replace(' ', 'T')), hs, num('Direction'), num('Tp')))
    return out


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch_mhl(b):
    d = json.loads(get(MHL.format(b['code']), 60))
    ids = {v['id']: k for k, v in d['summary'].items()}
    out = []
    for t, r in d['readings'].items():
        hs = _f(r.get(ids.get('hsig')))
        if hs and hs > 0:
            out.append((b['site'], datetime.fromisoformat(t[:16].replace(' ', 'T')), hs,
                        _f(r.get(ids.get('wdir'))), _f(r.get(ids.get('tp1')))))
    return out


def save_readings(store, bs):
    rows, errors = [], []
    qld = {b['site'] for b in bs if b['src'] == 'qld'}
    try:
        rows += fetch_qld(qld)
    except Exception as e:  # noqa: BLE001
        errors.append(f'qld buoys: {e}')
    for b in bs:
        if b['src'] == 'mhl':
            try:
                rows += fetch_mhl(b)
            except Exception as e:  # noqa: BLE001
                errors.append(f"{b['site']}: {e}")
    acc = {}
    for site, dt, hs, dr, tp in rows:
        hour = hour_of(dt)
        if hour.hour in HOURS:
            acc.setdefault((site, hour.strftime('%Y-%m-%dT%H')), []).append((hs, dr, tp))
    for (site, h), v in acc.items():
        store['obs'].setdefault(site, {})[h] = round(sum(x[0] for x in v) / len(v), 2)
        drs, tps = [x[1] for x in v if x[1] is not None], sorted(x[2] for x in v if x[2] is not None)
        store['obsx'].setdefault(site, {})[h] = [round(circ_mean(drs)) if drs else None,
                                                 round(tps[len(tps) // 2], 1) if tps else None]
    return len(acc), errors


def circ_mean(ds):
    import math
    s = sum(math.sin(math.radians(d)) for d in ds)
    c = sum(math.cos(math.radians(d)) for d in ds)
    return math.degrees(math.atan2(s, c)) % 360


def save_wind_obs(store):
    if not WINDHIST.exists():
        return 0
    n = 0
    for sid, hours in json.loads(WINDHIST.read_text(encoding='utf-8')).items():
        dst = store['windobs'].setdefault(sid, {})
        for h, v in hours.items():
            if int(h[11:13]) in HOURS:
                dst[h] = v
                n += 1
    return n


def prune(store, today):
    cut = (datetime.fromisoformat(today) - timedelta(days=KEEP_DAYS)).strftime('%Y-%m-%d')
    for k in ('fc', 'obs', 'wf', 'obsx', 'windfc', 'windobs', 'bom'):
        for site in store[k]:
            store[k][site] = {h: v for h, v in sorted(store[k][site].items()) if h >= cut}


def angdiff(a, b):
    return abs((a - b + 180) % 360 - 180)


def stats(errs, tol):
    n = len(errs)
    if not n:
        return {'n': 0, 'hit': None, 'bias': None, 'mae': None}
    return {'n': n, 'hit': round(sum(abs(e) <= tol + 1e-9 for e in errs) / n, 3),
            'bias': round(sum(errs) / n, 2), 'mae': round(sum(abs(e) for e in errs) / n, 2)}


def summarise(store, bs, today):
    """The app's track record: the main wave model only (unchanged shape)."""
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
        days = sorted(reg['days'])
        out[key] = {'days': len(days), 'from': days[0] if days else None, 'to': days[-1] if days else None,
                    'leads': [stats(e, TOL) for e in reg['leads']]}
    return {'updated': datetime.now(BNE).strftime('%Y-%m-%dT%H:%M'), 'since': store.get('since'),
            'tol': TOL, 'window': WINDOW_DAYS, 'ready': READY_DAYS,
            'hours': [HOURS.start, HOURS.stop], 'regions': out}


def accuracy(store, bs, sts, today):
    """Everything the private dashboard shows."""
    cut = (datetime.fromisoformat(today) - timedelta(days=WINDOW_DAYS)).strftime('%Y-%m-%d')
    R = {k: {'name': n, 'buoys': [], 'stations': [], 'days': set(),
             'wave': {m: [[] for _ in range(LEADS)] for m in MODELS}, 'dir': [], 'per': [],
             'wind': {m: [[] for _ in range(LEADS)] for m in WIND_MODELS},
             'daily': {}} for k, n in REGION_NAMES.items()}

    for b in bs:
        r = R[b['region']]
        r['buoys'].append(b['site'])
        wf, obs, obsx = store['wf'].get(b['site'], {}), store['obs'].get(b['site'], {}), store['obsx'].get(b['site'], {})
        for h, o in obs.items():
            if h < cut or h[:10] >= today or h not in wf:
                continue
            r['days'].add(h[:10])
            day = r['daily'].setdefault(h[:10], {'wave': [], 'wind': [], 'windhit': []})
            for m in MODELS:
                for lead, f in enumerate(wf[h].get(m) or []):
                    if f is not None:
                        r['wave'][m][lead].append(f - o)
                        if m == 'main' and lead == 1:
                            day['wave'].append(abs(f - o))
            x = obsx.get(h) or [None, None]
            if x[0] is not None and wf[h].get('dir') is not None:
                r['dir'].append(angdiff(wf[h]['dir'], x[0]))
            if x[1] is not None and wf[h].get('per') is not None:
                r['per'].append(wf[h]['per'] - x[1])

    for s in sts:
        r = R[s['region']]
        r['stations'].append(s['name'])
        wf, obs = store['windfc'].get(s['id'], {}), store['windobs'].get(s['id'], {})
        for h, (odir, ospd) in obs.items():
            if h < cut or h[:10] >= today or h not in wf or ospd is None:
                continue
            day = r['daily'].setdefault(h[:10], {'wave': [], 'wind': [], 'windhit': []})
            for m in WIND_MODELS:
                row = wf[h].get(m)
                if not row:
                    continue
                for lead in range(LEADS):
                    spd, dr = row[lead], row[LEADS + lead]
                    if spd is None:
                        continue
                    de = angdiff(dr, odir) if (dr is not None and odir is not None and ospd >= DIR_MIN_KMH) else None
                    hit = abs(spd - ospd) <= WIND_TOL and (de is None or de <= DIR_TOL)
                    r['wind'][m][lead].append((spd - ospd, de, hit))
                    if m == 'main' and lead == 1:
                        day['wind'].append(abs(spd - ospd))
                        day['windhit'].append(hit)

    def wind_stats(rows):
        n = len(rows)
        if not n:
            return {'n': 0, 'mae': None, 'bias': None, 'dir': None, 'hit': None}
        des = [d for _, d, _ in rows if d is not None]
        return {'n': n, 'mae': round(sum(abs(e) for e, _, _ in rows) / n, 1), 'bias': round(sum(e for e, _, _ in rows) / n, 1),
                'dir': round(sum(des) / len(des)) if des else None, 'hit': round(sum(h for _, _, h in rows) / n, 3)}

    mean = lambda v, nd=2: round(sum(v) / len(v), nd) if v else None
    out = {}
    for k, r in R.items():
        days = sorted(r['days'] | set(r['daily']))
        out[k] = {
            'name': r['name'], 'buoys': r['buoys'], 'stations': r['stations'], 'days': len(days),
            'from': days[0] if days else None, 'to': days[-1] if days else None,
            'wave': {m: [stats(e, TOL) for e in r['wave'][m]] for m in MODELS},
            'waveDir': {'n': len(r['dir']), 'mae': mean(r['dir'], 0)},
            'wavePeriod': {'n': len(r['per']), 'mae': mean([abs(e) for e in r['per']], 1), 'bias': mean(r['per'], 1)},
            'wind': {m: [wind_stats(e) for e in r['wind'][m]] for m in WIND_MODELS},
            'daily': [{'d': d, 'wave': mean(v['wave']), 'wind': mean(v['wind'], 1),
                       'windHit': mean([1 if x else 0 for x in v['windhit']], 3)} for d, v in sorted(r['daily'].items())],
        }
    return {'updated': datetime.now(BNE).strftime('%Y-%m-%dT%H:%M'), 'since': store.get('since'),
            'window': WINDOW_DAYS, 'hours': [HOURS.start, HOURS.stop],
            'tol': {'wave': TOL, 'wind': WIND_TOL, 'dir': DIR_TOL, 'dirMin': DIR_MIN_KMH},
            'models': MODEL_NAMES, 'regions': out, 'bom': bom_scores(store, bs, sts, today)}


# ---- BoM coastal waters forecasts: the official forecast, scored the same way --------------
BOM_AREAS = {'sc': ('IDQ11290', 'QLD_MW012'), 'gc': ('IDQ11290', 'QLD_MW014'),
             'nnsw': ('IDN11001', 'NSW_MW008'), 'syd': ('IDN11003', 'NSW_MW004')}
MORNING = range(5, 10)    # BoM's first wind clause is the morning; scored over 5am–10am
COMPASS = {'north': 0, 'northeast': 45, 'east': 90, 'southeast': 135, 'south': 180, 'southwest': 225, 'west': 270, 'northwest': 315,
           'north-northeast': 22.5, 'east-northeast': 67.5, 'east-southeast': 112.5, 'south-southeast': 157.5,
           'south-southwest': 202.5, 'west-southwest': 247.5, 'west-northwest': 292.5, 'north-northwest': 337.5}
KT = 1.852


def _dir_word(parts):
    parts = [x for x in parts if x]
    key = parts[0] + '-' + parts[1] + parts[2] if len(parts) == 3 else ''.join(parts)
    return COMPASS.get(key)


def parse_wind(text):
    """'Northwest to southwesterly 10 to 15 knots turning ...' → (dir°, lo km/h, hi km/h). First clause only."""
    first = re.split(r'\.|,| turning | tending | becoming | shifting | then ', text, 1)[0].lower()
    if 'variable' in first and not re.search(r'erly', first):
        d = None
    else:
        words = re.findall(r'(north|south|east|west)(?:[-]?(north|south|east|west))?(?:[-]?(north|south|east|west))?(?:erly|ly)?', first.split('knot')[0])
        degs = [_dir_word(w) for w in words]
        degs = [x for x in degs if x is not None]
        d = round(circ_mean(degs)) if degs else None
    m = re.search(r'(\d+) to (\d+) knots', first)
    if m:
        lo, hi = int(m[1]), int(m[2])
    elif (m := re.search(r'(?:below|less than) (\d+) knots', first)):
        lo, hi = 0, int(m[1])
    elif (m := re.search(r'(?:about|around|up to) (\d+) knots', first)):
        lo, hi = max(0, int(m[1]) - 3), int(m[1])
    elif (m := re.search(r'(\d+) knots', first)):
        lo, hi = max(0, int(m[1]) - 3), int(m[1]) + 3
    else:
        return None
    return [d, round(lo * KT), round(hi * KT)]


def parse_height(text):
    """'Easterly 1 to 1.5 metres ...' / 'Below 1 metre' → middle of the first height given (m)."""
    t = (text or '').lower()
    if (m := re.search(r'(\d+(?:\.\d+)?) to (\d+(?:\.\d+)?) metre', t)):
        return (float(m[1]) + float(m[2])) / 2
    if (m := re.search(r'(?:below|less than) (\d+(?:\.\d+)?) metre', t)):
        return float(m[1]) / 2
    if (m := re.search(r'(\d+(?:\.\d+)?) metre', t)):
        return float(m[1])
    return None


def save_bom(store, now):
    import xml.etree.ElementTree as ET
    today = now.strftime('%Y-%m-%d')
    docs, n = {}, 0
    for reg, (prod, aac) in BOM_AREAS.items():
        if prod not in docs:
            with urllib.request.urlopen(f'ftp://ftp.bom.gov.au/anon/gen/fwo/{prod}.xml', timeout=60) as r:
                docs[prod] = ET.fromstring(r.read())
        area = next((a for a in docs[prod].iter('area') if a.get('aac') == aac), None)
        if area is None:
            continue
        for p in area.iter('forecast-period'):
            st = p.get('start-time-local') or ''
            if int(st[11:13] or 99) > 6:
                continue  # a period that starts after dawn doesn't cover the morning
            day = st[:10]
            lead = (datetime.fromisoformat(day) - datetime.fromisoformat(today)).days
            if not 0 <= lead < LEADS:
                continue
            tx = {t.get('type'): (t.text or '') for t in p.iter('text')}
            wind = parse_wind(tx.get('forecast_winds', ''))
            sw, se = parse_height(tx.get('forecast_swell1')), parse_height(tx.get('forecast_seas'))
            hs = round((sw ** 2 + se ** 2) ** 0.5, 2) if sw is not None and se is not None else sw
            store['bom'].setdefault(reg, {})[f'{day}/{lead}'] = {
                'wind': wind, 'hs': hs, 'text': {'wind': tx.get('forecast_winds', '')[:160],
                                                 'swell': tx.get('forecast_swell1', '')[:120], 'seas': tx.get('forecast_seas', '')[:120]}}
            n += 1
    return n


def bom_scores(store, bs, sts, today):
    """Per region: BoM's morning forecast vs measured, beside Cowabunga's (main model) for the same mornings."""
    cut = (datetime.fromisoformat(today) - timedelta(days=WINDOW_DAYS)).strftime('%Y-%m-%d')
    out = {}
    for reg in BOM_AREAS:
        rb = [b for b in bs if b['region'] == reg]
        rs = [s for s in sts if s['region'] == reg]
        res = {'wind': {'bom': [], 'main': []}, 'wave': {'bom': [], 'main': []}, 'recent': []}
        for key, f in sorted(store['bom'].get(reg, {}).items()):
            day, lead = key.split('/')
            lead = int(lead)
            if lead != 1 or day < cut or day >= today:
                continue  # score the day-ahead forecast, finished days only
            hours = [f'{day}T{h:02d}' for h in MORNING]
            # measured morning wind (mean of the region's stations) and Cowabunga's for the same hours
            ow, mw = [], []
            for s in rs:
                for h in hours:
                    o = store['windobs'].get(s['id'], {}).get(h)
                    fc = (store['windfc'].get(s['id'], {}).get(h) or {}).get('main')
                    if o and o[1] is not None:
                        ow.append(o)
                        if fc and fc[1] is not None:
                            mw.append((fc[1], fc[LEADS + 1]))
            row = {'d': day, 'bomText': f['text']['wind'], 'bomWind': f['wind'], 'bomHs': f['hs']}
            if ow and f['wind']:
                spd = sum(o[1] for o in ow) / len(ow)
                dirs = [o[0] for o in ow if o[0] is not None and o[1] >= DIR_MIN_KMH]
                odir = circ_mean(dirs) if dirs else None
                d, lo, hi = f['wind']
                err = 0 if lo <= spd <= hi else min(abs(spd - lo), abs(spd - hi))
                ok_dir = odir is None or d is None or angdiff(d, odir) <= DIR_TOL
                res['wind']['bom'].append((err, err <= 5 and ok_dir))
                row['obsWind'] = [None if odir is None else round(odir), round(spd)]
                if mw:
                    ms = sum(x[0] for x in mw) / len(mw)
                    md = circ_mean([x[1] for x in mw if x[1] is not None]) if any(x[1] is not None for x in mw) else None
                    merr = abs(ms - spd)
                    res['wind']['main'].append((merr, merr <= WIND_TOL and (odir is None or md is None or angdiff(md, odir) <= DIR_TOL)))
                    row['mainWind'] = [None if md is None else round(md), round(ms)]
            oh, mh = [], []
            for b in rb:
                for h in hours:
                    o = store['obs'].get(b['site'], {}).get(h)
                    fc = (store['wf'].get(b['site'], {}).get(h) or {}).get('main')
                    if o is not None:
                        oh.append(o)
                        if fc and fc[1] is not None:
                            mh.append(fc[1])
            if oh and f['hs'] is not None:
                ob = sum(oh) / len(oh)
                res['wave']['bom'].append(f['hs'] - ob)
                row['obsHs'] = round(ob, 2)
                if mh:
                    res['wave']['main'].append(sum(mh) / len(mh) - ob)
                    row['mainHs'] = round(sum(mh) / len(mh), 2)
            res['recent'].append(row)
        w = lambda v: {'n': len(v), 'mae': round(sum(e for e, _ in v) / len(v), 1) if v else None,
                       'hit': round(sum(h for _, h in v) / len(v), 3) if v else None}
        out[reg] = {'area': BOM_AREAS[reg][1], 'wind': {k: w(v) for k, v in res['wind'].items()},
                    'wave': {k: stats(v, 0.3) for k, v in res['wave'].items()}, 'recent': res['recent'][-14:]}
    return out


def dump_store(store):
    """One hour per line: the file changes by a few lines per run, so git stores it as a small diff."""
    c = lambda v: json.dumps(v, separators=(',', ':'), sort_keys=True)
    out = ['{']
    keys = sorted(store)
    for i, k in enumerate(keys):
        v = store[k]
        if isinstance(v, dict):
            out.append(f'{c(k)}:{{')
            sites = sorted(v)
            for j, s in enumerate(sites):
                hours = sorted(v[s].items())
                out.append(f' {c(s)}:{{')
                out += [f'  {c(h)}:{c(x)}' + (',' if n < len(hours) - 1 else '') for n, (h, x) in enumerate(hours)]
                out.append(' }' + (',' if j < len(sites) - 1 else ''))
            out.append('}' + (',' if i < len(keys) - 1 else ''))
        else:
            out.append(f'{c(k)}:{c(v)}' + (',' if i < len(keys) - 1 else ''))
    return '\n'.join(out + ['}']) + '\n'


def main():
    bs, sts = buoys(), stations()
    now = datetime.now(BNE)
    today = now.strftime('%Y-%m-%d')
    store = json.loads(RAW.read_text()) if RAW.exists() else {'since': today}
    for k in ('fc', 'obs', 'wf', 'obsx', 'windfc', 'windobs', 'bom'):
        store.setdefault(k, {})
    store.setdefault('since2', today)  # when the multi-model / wind / NSW scoring started
    errors = []
    for label, fn in (('wave forecasts', lambda: save_wave_forecasts(store, bs, now)),
                      ('wind forecasts', lambda: save_wind_forecasts(store, sts, now)),
                      ('wind readings', lambda: save_wind_obs(store)),
                      ('BoM forecasts', lambda: save_bom(store, now))):
        try:
            print(f'{label}:', fn())
        except Exception as e:  # noqa: BLE001
            errors.append(f'{label}: {e}')
    n, errs = save_readings(store, bs)
    print('buoy hours:', n)
    errors += errs
    prune(store, today)
    RAW.parent.mkdir(exist_ok=True)
    RAW.write_text(dump_store(store))
    OUT.write_text(json.dumps(summarise(store, bs, today), indent=1))
    ACC.write_text(json.dumps(accuracy(store, bs, sts, today), separators=(',', ':')))
    for e in errors:
        print('warning:', e)
    if not n and len(errors) >= 3:
        sys.exit('; '.join(errors))


if __name__ == '__main__':
    main()
