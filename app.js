/* Dawnie — longboard dawn-patrol forecast. No build step, no dependencies.
   Rating rules live in config.js. */
(() => {
  'use strict';

  const C = window.DAWNIE;
  const R = C.rating;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
  };

  /* ---------------- Time (Brisbane is always UTC+10, no daylight saving) ---------------- */
  const BNE = 10 * 3600e3;
  const nowStr = () => new Date(Date.now() + BNE).toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM" Brisbane
  // Local Brisbane strings are treated as if UTC so maths on them is simple and DST-free.
  const toMin = (s) => Date.parse((s.length === 10 ? s + 'T00:00' : s.slice(0, 16)) + 'Z') / 60000;
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const LONGDAY = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
  const dm = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const wd = (d) => WD[new Date(d + 'T00:00Z').getUTCDay()];
  const hourLbl = (h) => (h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : h - 12 + 'pm');
  const clock = (s) => { const h = +s.slice(11, 13), m = s.slice(14, 16); return (h % 12 || 12) + (m === '00' ? '' : ':' + m) + (h < 12 ? 'am' : 'pm'); };
  const dayName = (d) => { const t = nowStr().slice(0, 10); return d === t ? 'Today' : d === addDays(t, 1) ? 'Tomorrow' : wd(d); };

  /* ---------------- Maths ---------------- */
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const angDiff = (a, b) => { const d = Math.abs((((a - b) % 360) + 360) % 360); return d > 180 ? 360 - d : d; };
  const interp = (pts, x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
    }
    return pts[pts.length - 1][1];
  };
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const cmp = (d) => (d == null || isNaN(d) ? '–' : COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16]);
  const f1 = (x) => (x == null || isNaN(x) ? '–' : x.toFixed(1));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ================================================================
     DATA
     ================================================================ */
  async function getJSON(url, ms = 15000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  const MARINE_VARS = [
    'wave_height', 'wave_direction', 'wave_period',
    'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
    'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
    'wind_wave_height', 'wind_wave_direction', 'sea_level_height_msl',
  ].join(',');

  function fetchMarine() {
    const pts = [...C.spots, ...C.buoys];
    return getJSON('https://marine-api.open-meteo.com/v1/marine'
      + `?latitude=${pts.map((p) => p.lat).join(',')}&longitude=${pts.map((p) => p.lon).join(',')}`
      + `&hourly=${MARINE_VARS}&timezone=Australia%2FBrisbane&past_days=1&forecast_days=7&cell_selection=sea`);
  }

  function fetchWind() {
    const pts = C.spots;
    return getJSON('https://api.open-meteo.com/v1/forecast'
      + `?latitude=${pts.map((p) => p.lat).join(',')}&longitude=${pts.map((p) => p.lon).join(',')}`
      + '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=sunrise,sunset'
      + '&wind_speed_unit=kmh&timezone=Australia%2FBrisbane&past_days=1&forecast_days=7');
  }

  const CKAN = 'https://www.data.qld.gov.au/api/3/action/datastore_search';

  // MSQ predicted high/low tides for each port, yesterday → +8 days.
  async function fetchTides() {
    const today = nowStr().slice(0, 10);
    const dates = [];
    for (let i = -1; i <= 8; i++) dates.push(addDays(today, i));
    const out = {};
    // each port settles on its own, so one failing port doesn't drop the other
    await Promise.allSettled(Object.entries(C.tides).map(async ([key, port]) => {
      const byYear = {};
      for (const d of dates) (byYear[d.slice(0, 4)] ||= []).push(`${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`);
      let recs = [];
      for (const [y, ds] of Object.entries(byYear)) {
        const id = port.resources[y];
        if (!id) continue;
        const j = await getJSON(`${CKAN}?resource_id=${id}&limit=200&filters=${encodeURIComponent(JSON.stringify({ Date: ds }))}`);
        recs = recs.concat(j.result.records);
      }
      if (recs.length < 4) throw new Error(`No tide table for ${port.name}`);
      out[key] = recs.map((r) => {
        const [d, m, y] = r.Date.split('/');
        const t = `${y}-${m}-${d}T${r.Time.padStart(5, '0')}`;
        return { t, m: toMin(t), h: +r.Reading, hi: String(r.Ind).trim() === '1' };
      }).sort((a, b) => a.m - b.m);
    }));
    if (!Object.keys(out).length) throw new Error('No tide data');
    return out;
  }

  // Qld Govt Coastal Data System live buoys, last ~24 h.
  async function fetchBuoys() {
    const parse = (r) => {
      const n = (v) => { const x = +v; return isNaN(x) || x <= -90 ? null : x; };
      return { t: String(r.DateTime).trim().slice(0, 16), hs: n(r.Hs), hmax: n(r.Hmax), tp: n(r.Tp), dir: n(r.Direction), sst: n(r.SST) };
    };
    let rows;
    try {
      const j = await getJSON(`${CKAN}?resource_id=${C.waveResourceId}&limit=500&sort=${encodeURIComponent('Seconds desc')}`
        + `&filters=${encodeURIComponent(JSON.stringify({ Site: C.buoys.map((b) => b.site) }))}`);
      rows = j.result.records.map((r) => ({ site: r.Site, ...parse(r) }));
    } catch (e) {
      // Fallback: the full 7-day CSV (bigger, but same source).
      const r = await fetch('https://apps.des.qld.gov.au/data-sets/waves/wave-7dayopdata.csv');
      if (!r.ok) throw e;
      const lines = (await r.text()).split(/\r?\n/);
      const hdr = lines[1].split(',').map((s) => s.trim());
      const want = new Set(C.buoys.map((b) => b.site));
      rows = lines.slice(2).map((l) => l.split(',')).filter((c) => want.has(c[0]))
        .map((c) => { const o = {}; hdr.forEach((h, i) => (o[h] = c[i])); return { site: o.Site, ...parse(o) }; });
    }
    const by = {};
    for (const r of rows) if (r.hs > 0) (by[r.site] ||= []).push(r);
    const cutoff = toMin(nowStr()) - 26 * 60;
    for (const k of Object.keys(by)) by[k] = by[k].filter((r) => toMin(r.t) >= cutoff).sort((a, b) => (a.t < b.t ? -1 : 1));
    return by;
  }

  /* ================================================================
     MODEL + RATING
     ================================================================ */
  function dirFactor(spot, d) {
    if (d == null) return 0.5;
    const diff = angDiff(d, spot.swell.ideal), s = spot.swell.spread, E = R.swellDir.edgeFactor;
    return diff <= s ? 1 - ((1 - E) * diff) / s : Math.max(0, E * (1 - (diff - s) / R.swellDir.fadeBeyond));
  }

  function sizeScore(x) {
    const S = R.size;
    return interp([[S.min * 0.5, 0], [S.min, 0.15], [S.idealLow, 1], [S.idealHigh, 1], [S.max, 0.65], [S.hardMax, 0.12], [S.hardMax + 0.5, 0]], x);
  }

  function windInfo(spot, w) {
    if (w.s == null || w.d == null) return { cat: 'cross', sc: 0.5, light: false, missing: true }; // no data → neutral, never "glassy"
    const W = R.wind, s = w.s, ang = angDiff(w.d, spot.offshore);
    const cat = s < W.glassy ? 'glassy' : ang <= W.offshoreMaxAngle ? 'offshore' : ang <= W.crossMaxAngle ? 'cross' : 'onshore';
    let sc;
    if (cat === 'glassy') sc = 1;
    else if (cat === 'offshore') sc = s <= W.offshoreTooStrong ? 1 : clamp(1 - (s - W.offshoreTooStrong) / 20, 0.4, 1);
    else if (cat === 'cross') sc = s <= W.light ? 0.92 : clamp(0.92 - ((s - W.light) / (W.crossBlownOut - W.light)) * 0.8, 0.06, 0.92);
    else { const L = W.lightOnshore; sc = s <= W.light ? L : clamp(L - ((s - W.light) / (W.onshoreBlownOut - W.light)) * (L - 0.05), 0.03, L); }
    if (w.g > W.gustPenaltyFrom) sc *= clamp(1 - (w.g - W.gustPenaltyFrom) / 60, 0.75, 1);
    return { cat, sc, light: s <= W.light };
  }

  function rate(spot, h) {
    const B = R.periodSizeBoost;
    const comps = [];
    for (const c of [h.sw, h.sw2]) {
      if (!(c && c.h > 0.05)) continue;
      let ex = dirFactor(spot, c.d);
      if (spot.type === 'point') { const P = R.pointWrap; ex *= clamp(((c.p || 8) - P.from) / P.range, P.floor, 1); }
      const boost = clamp(B.base + B.perSecond * (c.p || 8), B.lo, B.hi);
      comps.push({ ...c, ex, eff: c.h * ex * boost * spot.sizeFactor });
    }
    const wwEff = (h.ww.h || 0) * dirFactor(spot, h.ww.d) * spot.sizeFactor * 0.6;
    let e2 = wwEff ** 2, pw = 0, pe = 0;
    for (const c of comps) { e2 += c.eff ** 2; pw += c.eff ** 2 * (c.p || 0); pe += c.eff ** 2; }
    const surf = Math.sqrt(e2);
    const period = pe > 0 ? pw / pe : h.sw.p || 0;
    comps.sort((a, b) => b.eff - a.eff);
    const main = comps[0] || null;
    const sS = sizeScore(surf);
    const pS = interp(R.period, period);
    const wI = windInfo(spot, h.wind);
    const ratio = wwEff / Math.max(0.15, surf);
    const chop = clamp((ratio - R.chop.startRatio) / (R.chop.fullRatio - R.chop.startRatio), 0, 1) * R.chop.maxPenalty
      * (wI.cat === 'offshore' || wI.cat === 'glassy' ? 0.5 : 1);
    const tS = spot.tide === 'all' ? 1 : !h.tide ? 0.5 : clamp(1 - Math.abs(h.tide.norm - R.tideTargets[spot.tide]) * 1.6, 0, 1);
    let score = Math.pow(sS, R.weights.size) * Math.pow(wI.sc, R.weights.wind)
      * (R.periodFloor + (1 - R.periodFloor) * pS) * (R.tideFloor + (1 - R.tideFloor) * tS) * (1 - chop);
    let rating = 1;
    R.thresholds.forEach((th, i) => { if (score >= th) rating = i + 2; });
    const tooBig = Math.min(R.size.hardMax, spot.maxSize || Infinity);
    let flag = surf < R.size.min ? 'flat' : surf > tooBig ? 'big' : null;
    if (flag === 'big') { score = Math.min(score, R.thresholds[0] - 0.01); rating = 1; }
    // waves are there but blown out → "Poor", not "Flat"
    if (flag === 'flat' && (h.sw.h || 0) >= 0.5 && wI.cat === 'onshore') flag = null;
    return { surf, period, main, sS, pS, wI, tS, chop, score, rating, flag };
  }

  const label = (h) => (h.flag === 'flat' ? 'Flat' : h.flag === 'big' ? 'Too big' : R.labels[h.rating - 1]);
  const colour = (h) => (h.flag === 'big' ? 'var(--big)' : `var(--r${h.rating})`);

  function tideWord(t) {
    if (!t) return '';
    const n = t.norm;
    const lvl = n < 0.25 ? 'low' : n > 0.75 ? 'high' : 'mid';
    return (lvl === 'mid' ? (t.rising ? 'rising ' : 'falling ') : '') + lvl + ' tide';
  }

  // One-line "why" for an hour.
  function why(h) {
    const parts = [];
    if (h.flag === 'flat') {
      const open = h.sw.h || 0;
      parts.push(open >= 0.6 && h.main && h.main.ex < 0.35
        ? `${f1(open)} m ${cmp(h.sw.d)} swell won't wrap in`
        : `tiny, about ${f1(h.surf)} m`);
    } else if (h.flag === 'big') {
      parts.push(`${f1(h.surf)} m, too big for longboarding`);
    } else {
      const adj = h.chop > 0.12 ? 'choppy ' : h.wI.sc > 0.85 && h.chop < 0.05 ? 'clean ' : '';
      parts.push(`${adj}${f1(h.surf)} m ${cmp(h.main ? h.main.d : h.sw.d)} @ ${Math.round(h.period)} s`);
    }
    const w = h.wind, s = Math.round(w.s), light = h.wI.light ? 'light ' : '';
    parts.push(
      h.wI.cat === 'glassy' ? 'glassy'
        : h.wI.cat === 'offshore' ? `${light}${cmp(w.d)} offshore`
          : h.wI.cat === 'cross' ? `${light}${cmp(w.d)} cross-shore ${s} km/h`
            : `${light}${cmp(w.d)} onshore ${s} km/h`);
    return parts;
  }

  // Hourly tide from MSQ highs/lows (cosine interpolation), or Open-Meteo sea level as fallback.
  function attachTide(hours, ext) {
    if (ext && ext.length > 1) {
      for (const h of hours) {
        const m = toMin(h.t);
        const k = ext.findIndex((e) => e.m > m);
        if (k <= 0) { h.tide = null; continue; }
        const a = ext[k - 1], b = ext[k];
        const s = (1 - Math.cos((Math.PI * (m - a.m)) / (b.m - a.m))) / 2;
        h.tide = { h: a.h + (b.h - a.h) * s, rising: !a.hi, norm: a.hi ? 1 - s : s, src: 'msq' };
      }
      return;
    }
    const byDay = {};
    for (const h of hours) {
      if (h.sl == null) continue;
      const d = (byDay[h.date] ||= { min: 1e9, max: -1e9 });
      d.min = Math.min(d.min, h.sl); d.max = Math.max(d.max, h.sl);
    }
    hours.forEach((h, i) => {
      if (h.sl == null) { h.tide = null; return; }
      const d = byDay[h.date], nx = hours[i + 1];
      h.tide = { h: h.sl, rising: nx ? nx.sl > h.sl : false, norm: (h.sl - d.min) / Math.max(0.01, d.max - d.min), src: 'om' };
    });
  }

  function buildModel(raw) {
    const { marine, wind } = raw;
    const sun = {};
    const D = wind[0].daily;
    D.time.forEach((d, i) => (sun[d] = { rise: D.sunrise[i], set: D.sunset[i] }));
    const spots = C.spots.map((spot, si) => {
      const M = marine[si].hourly, W = wind[si].hourly;
      const wIdx = new Map(W.time.map((t, i) => [t, i]));
      const g = (k, i) => (M[k] ? M[k][i] : null);
      const hours = [];
      M.time.forEach((t, i) => {
        const wi = wIdx.get(t);
        if (wi == null || g('swell_wave_height', i) == null) return;
        hours.push({
          t, date: t.slice(0, 10), hour: +t.slice(11, 13),
          wave: g('wave_height', i),
          sw: { h: g('swell_wave_height', i), d: g('swell_wave_direction', i), p: g('swell_wave_period', i) },
          sw2: { h: g('secondary_swell_wave_height', i), d: g('secondary_swell_wave_direction', i), p: g('secondary_swell_wave_period', i) },
          ww: { h: g('wind_wave_height', i), d: g('wind_wave_direction', i) },
          wind: { s: W.wind_speed_10m[wi], d: W.wind_direction_10m[wi], g: W.wind_gusts_10m[wi] },
          sl: g('sea_level_height_msl', i),
        });
      });
      attachTide(hours, raw.tides && raw.tides[spot.tidePort]);
      for (const h of hours) Object.assign(h, rate(spot, h));
      return { spot, hours };
    });
    const n = C.spots.length;
    const buoyFc = C.buoys.map((b, i) => marine[n + i] && marine[n + i].hourly);
    return { spots, sun, buoyFc };
  }

  function morningDates() {
    const now = nowStr();
    let start = now.slice(0, 10);
    if (+now.slice(11, 13) > R.morning.endHour) start = addDays(start, 1);
    return [0, 1, 2].map((i) => addDays(start, i));
  }

  function morningFor(sp, date) {
    const rise = model.sun[date] && model.sun[date].rise;
    const first = rise ? toMin(rise) - R.morning.firstLightBeforeSunrise : toMin(date + 'T05:00');
    const startH = Math.ceil((first - toMin(date)) / 60); // first whole hour after first light
    const nowH = nowStr().slice(0, 13);
    const hrs = sp.hours.filter((h) => h.date === date && h.hour >= startH && h.hour <= R.morning.endHour);
    const live = hrs.filter((h) => h.t.slice(0, 13) >= nowH);
    const pool = live.length ? live : hrs;
    if (!pool.length) return null;
    let best = pool[0];
    for (const h of pool) if (h.score > best.score + 1e-9) best = h;
    return { date, hrs, best, startH, firstLight: first };
  }

  /* ================================================================
     STATE
     ================================================================ */
  let raw = null, model = null;
  const status = { marine: 'pending', wind: 'pending', tides: 'pending', buoys: 'pending' };
  const ui = {
    region: store.get('dawnie:region') || C.ui.defaultRegion,
    day: 0,
    view: new URLSearchParams(location.search).get('view') || store.get('dawnie:view') || C.ui.detailView,
  };

  async function load(force) {
    const btn = $('#refresh');
    btn.classList.add('spin');
    const cached = store.get('dawnie:data:v1');
    const fresh = cached && Date.now() - cached.ts < C.ui.cacheMinutes * 60e3;
    if (cached && !raw) { raw = cached.raw; try { model = buildModel(raw); render(); } catch (e) { console.warn(e); } }
    if (fresh && !force) {
      Object.keys(status).forEach((k) => (status[k] = raw[k] ? 'ok' : 'err'));
      if (raw.tidesFallback) status.tides = 'warn';
      btn.classList.remove('spin');
      renderSources();
      // buoys are always fetched live
      fetchBuoys().then((b) => { raw.buoys = b; status.buoys = 'ok'; renderBuoys(); renderSources(); }).catch(() => { status.buoys = 'err'; renderSources(); });
      return;
    }
    const [m, w, t, b] = await Promise.allSettled([fetchMarine(), fetchWind(), fetchTides(), fetchBuoys()]);
    const next = { ...(raw || {}) };
    const take = (key, res) => {
      if (res.status === 'fulfilled') { next[key] = res.value; status[key] = 'ok'; }
      else { status[key] = next[key] ? 'warn' : 'err'; console.warn(key, res.reason); }
    };
    take('marine', m); take('wind', w); take('tides', t); take('buoys', b);
    next.tidesFallback = t.status !== 'fulfilled';
    if (next.tidesFallback) { next.tides = null; status.tides = 'warn'; }
    btn.classList.remove('spin');
    if (!next.marine || !next.wind) {
      renderSources();
      if (!model) $('#hero').innerHTML = `<div class="hero-in"><div class="error-card">Couldn't reach the forecast servers. Check your connection and tap refresh.</div></div>`;
      return;
    }
    raw = next;
    raw.fetchedAt = Date.now();
    store.set('dawnie:data:v1', { ts: Date.now(), raw });
    model = buildModel(raw);
    render();
  }

  /* ================================================================
     RENDER — HOME
     ================================================================ */
  function render() {
    renderHome();
    route();
  }

  function renderHome() {
    const region = ui.region;
    $('.region').dataset.active = region;
    document.querySelectorAll('.region button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.region === region)));
    const fetched = raw.fetchedAt ? new Date(raw.fetchedAt + BNE).toISOString().slice(11, 16) : null;
    $('#updated').textContent = fetched ? `Updated ${clock('xxxxxxxxxxx' + fetched)}` : 'Longboard mornings';

    const dates = morningDates();
    ui.day = Math.min(ui.day, dates.length - 1);
    const spots = model.spots.filter((s) => s.spot.region === region);
    const ranks = dates.map((d) => spots.map((sp) => ({ sp, m: morningFor(sp, d) })).filter((x) => x.m)
      .sort((a, b) => b.m.best.score - a.m.best.score));

    $('#days').innerHTML = dates.map((d, i) => {
      const top = ranks[i][0];
      const named = dayName(d) !== wd(d);
      return `<button class="day" role="tab" data-i="${i}" aria-selected="${i === ui.day}"${top ? ` style="--c:${colour(top.m.best)}"` : ''}>
        <span class="d1">${named ? dayName(d) : LONGDAY[wd(d)]}</span>
        <span class="d2">${named ? wd(d) + ' ' : ''}${dm(d)}</span>
        <span class="d3">${top ? label(top.m.best) : '–'}</span>
      </button>`;
    }).join('');

    const list = ranks[ui.day];
    const date = dates[ui.day];
    const first = list[0] && list[0].m;
    $('#window-meta').textContent = first
      ? `${clock('xxxxxxxxxxx' + new Date(first.firstLight * 60000).toISOString().slice(11, 16))} – ${hourLbl(R.morning.endHour)} · ${wd(date)} ${dm(date)}`
      : '';

    renderHero(list[0], date);

    $('#ranking').innerHTML = list.map(({ sp, m }, i) => {
      const b = m.best;
      const bars = m.hrs.map((h) => `<i class="${h === b ? 'best' : ''}" style="--c:${colour(h)};--v:${barH(h)}"></i>`).join('');
      return `<li class="row" data-spot="${sp.spot.id}" style="--i:${i}">
        <span class="rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="name">${esc(sp.spot.name)}</span>
        <span class="pill" style="--c:${colour(b)}">${label(b)}</span>
        <span class="why">${esc(cap([...why(b), ...(b.tide ? [tideWord(b.tide)] : [])].join(', ')))}</span>
        <span class="strip" aria-label="Best at ${hourLbl(b.hour)}, window ${hourLbl(m.hrs[0].hour)} to ${hourLbl(m.hrs[m.hrs.length - 1].hour)}"><span class="spark-m" aria-hidden="true">${bars}</span><span class="at">best <b>${hourLbl(b.hour)}</b></span></span>
      </li>`;
    }).join('');

    renderBuoys();
    renderSources();
  }

  // Bar height for an hour: its score, full height at Epic, with a floor so every hour reads.
  const barH = (h) => clamp(h.score / 0.8, 0.08, 1).toFixed(3);

  // Hero mini timeline: one column per morning hour, plus the tide as a dashed line.
  function timeline(m) {
    const hrs = m.hrs, n = hrs.length;
    const cols = hrs.map((h) => `<i class="tl-col${h === m.best ? ' best' : ''}" style="--c:${colour(h)};--v:${barH(h)}"></i>`).join('');
    const hours = hrs.map((h) => `<span class="${h === m.best ? 'best' : ''}">${h.hour % 12 || 12}</span>`).join('');
    const tideH = hrs.filter((h) => h.tide);
    let tide = '';
    if (tideH.length === n && n > 1) {
      // column centres on a 0–100 x scale, tide norm mapped to 10–90% of the bar height
      const pts = hrs.map((h, k) => [((k + 0.5) / n) * 100, 46 - (0.1 + 0.8 * h.tide.norm) * 46]);
      const d = pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
      tide = `<svg class="tl-tide" viewBox="0 0 100 46" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
    }
    const t0 = hrs[0].tide, t1 = hrs[n - 1].tide;
    const tideTxt = t0 && t1 ? `${tideWord(t0).replace(' tide', '')} → ${tideWord(t1)}` : '';
    return `<div class="tl" aria-hidden="true">
        <div class="tl-bars">${cols}${tide}</div>
        <div class="tl-hours">${hours}</div>
        <div class="tl-key"><span>First light → ${hourLbl(R.morning.endHour)}</span>${tide ? `<span><i></i>${esc(cap(tideTxt))}</span>` : ''}</div>
      </div>`;
  }

  function arrow(deg, colourVar, size = 14) {
    // arrow points the way the wind is blowing TO
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="transform:rotate(${(deg + 180) % 360}deg);color:${colourVar}" aria-hidden="true"><path d="M12 3v17M6 14l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  const WIND_COL = { offshore: 'var(--w-off)', cross: 'var(--w-cross)', onshore: 'var(--w-on)', glassy: 'var(--w-glassy)' };
  const windCol = (cat) => WIND_COL[cat];

  function renderHero(top, date) {
    const el = $('#hero');
    if (!top) { el.innerHTML = '<div class="hero-in"><p class="hero-why">No forecast for this morning yet.</p></div>'; return; }
    const { sp, m } = top, b = m.best;
    el.style.setProperty('--c', colour(b));
    el.dataset.spot = sp.spot.id;
    const tide = b.tide ? `${f1(b.tide.h)}<small> m</small>` : '–';
    const tideArrow = (up) => `<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" style="color:var(--tide)"><path d="M6 ${up ? '10V2M2.5 5.5 6 2l3.5 3.5' : '2v8M2.5 6.5 6 10l3.5-3.5'}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    el.innerHTML = `<div class="hero-in">
        <div class="eyebrow"><span class="eb-l"><span class="live"></span>Best bet</span><span class="eb-r">${dayName(date)} · ${hourLbl(b.hour)}</span></div>
        <div class="hero-rating">${label(b)}</div>
        <div class="hero-name">${esc(sp.spot.name)}</div>
        <p class="hero-why">${esc(cap(why(b).join(', ')))}.</p>
        ${timeline(m)}
        <div class="stats">
          <div class="stat"><div class="k">Surf</div><div class="v">${f1(b.surf)}<small> m</small></div><div class="s">${cmp(b.main ? b.main.d : b.sw.d)}</div></div>
          <div class="stat"><div class="k">Period</div><div class="v">${Math.round(b.period)}<small> s</small></div><div class="s">${b.sw2.h > 0.2 ? '+' + f1(b.sw2.h) + ' m ' + cmp(b.sw2.d) : 'swell'}</div></div>
          <div class="stat"><div class="k">Wind</div><div class="v">${Math.round(b.wind.s)}<small> km/h</small></div><div class="s" style="color:${windCol(b.wI.cat)}">${cmp(b.wind.d)} ${{ offshore: 'off', onshore: 'on' }[b.wI.cat] || b.wI.cat}</div></div>
          <div class="stat"><div class="k">Tide</div><div class="v">${tide}</div><div class="s">${b.tide ? tideArrow(b.tide.rising) + (b.tide.rising ? 'rising' : 'falling') : ''}</div></div>
        </div>
      </div>`;
  }

  // Re-run the entrance animation on hero + lineup (region / day change only).
  function swapIn() {
    for (const el of [$('#hero'), $('#ranking')]) { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
  }

  function renderBuoys() {
    const el = $('#buoys');
    if (!model) return;
    const buoys = C.buoys.map((b, i) => ({ b, i })).filter(({ b }) => b.region === ui.region);
    const obsAll = raw.buoys || {};
    el.innerHTML = buoys.map(({ b, i }) => {
      const obs = obsAll[b.site] || [];
      const fc = model.buoyFc[i];
      if (!obs.length) return `<div class="buoy"><div class="buoy-head"><h3>${b.name}</h3><span class="age">${status.buoys === 'pending' ? 'loading…' : 'no recent data'}</span></div></div>`;
      const last = obs[obs.length - 1];
      const ageMin = Math.max(0, Math.round(toMin(nowStr()) - toMin(last.t)));
      const age = ageMin < 60 ? `${ageMin} min ago` : `${Math.round(ageMin / 60)} h ago`;
      const fi = fc ? fc.time.indexOf(last.t.slice(0, 13) + ':00') : -1;
      const fH = fi >= 0 ? fc.wave_height[fi] : null;
      const fP = fi >= 0 ? fc.swell_wave_period[fi] : null;
      const fD = fi >= 0 ? fc.wave_direction[fi] : null;
      let verdict = '';
      if (fH) {
        const diff = (last.hs - fH) / fH;
        const pct = Math.round(Math.abs(diff) * 100);
        verdict = Math.abs(diff) < 0.15
          ? `<span class="tag on">On track</span>Buoy within ${pct}% of the model`
          : diff > 0 ? `<span class="tag up">Bigger</span>Running ${pct}% above forecast`
            : `<span class="tag down">Smaller</span>Running ${pct}% below forecast`;
      }
      return `<div class="buoy">
        <div class="buoy-head"><h3>${b.name}</h3><span class="age">${clock(last.t)} · ${age}</span></div>
        <div class="buoy-grid">
          <div class="buoy-big">${last.hs.toFixed(2)}<small>m</small></div>
          <div class="buoy-meta">
            Live <b>${last.tp ? last.tp.toFixed(1) : '–'} s</b> · <b>${cmp(last.dir)}</b>${last.sst ? ` · <b>${last.sst.toFixed(1)}°C</b>` : ''}<br>
            Model <b>${f1(fH)} m</b> · <b>${fP ? fP.toFixed(1) : '–'} s</b> · <b>${cmp(fD)}</b>
          </div>
        </div>
        ${sparkline(obs, fc)}
        <div class="verdict">${verdict}</div>
      </div>`;
    }).join('') + (ui.region === 'sc' ? '<p class="block-meta" style="margin:2px 2px 0">No Noosa buoy is in the live feed. Mooloolaba is the closest.</p>' : '');
  }

  function sparkline(obs, fc) {
    const W = 320, H = 46, P = 3;
    const t0 = toMin(obs[0].t), t1 = toMin(obs[obs.length - 1].t);
    if (t1 - t0 < 60) return '';
    const fpts = [];
    if (fc) fc.time.forEach((t, i) => { const m = toMin(t); if (m >= t0 && m <= t1 && fc.wave_height[i] != null) fpts.push([m, fc.wave_height[i]]); });
    const vals = obs.map((o) => o.hs).concat(fpts.map((p) => p[1]));
    const lo = Math.min(...vals) * 0.9, hi = Math.max(...vals) * 1.05;
    const x = (m) => P + ((m - t0) / (t1 - t0)) * (W - 2 * P);
    const y = (v) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
    const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
    const o = obs.map((r) => [toMin(r.t), r.hs]);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${line(o)} L${x(t1)} ${H} L${x(t0)} ${H}Z" fill="var(--r4)" opacity=".08"/>
      ${fpts.length > 1 ? `<path d="${line(fpts)}" fill="none" stroke="var(--tx-3)" stroke-width="1.4" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : ''}
      <path d="${line(o)}" fill="none" stroke="var(--r4)" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    </svg>
    <div class="spark-legend"><span><i style="background:var(--r4)"></i>Buoy, last 24 h</span><span><i style="background:var(--tx-3)"></i>Model</span></div>`;
  }

  function renderSources() {
    const names = { marine: 'Open-Meteo Marine', wind: 'Open-Meteo Wind', tides: 'MSQ Tides', buoys: 'Qld Wave Buoys' };
    $('#sources').innerHTML = Object.entries(status).map(([k, s]) => {
      const extra = k === 'tides' && s === 'warn' ? ' (model fallback)' : s === 'err' ? ' (offline)' : '';
      return `<li class="${s}">${names[k]}${extra}</li>`;
    }).join('');
  }

  /* ================================================================
     RENDER — SPOT DETAIL
     ================================================================ */
  function route() {
    const m = location.hash.match(/^#\/spot\/([\w-]+)/);
    const home = $('#home'), det = $('#detail');
    if (m && model) {
      const sp = model.spots.find((s) => s.spot.id === m[1]);
      if (sp) {
        home.hidden = true; det.hidden = false;
        renderDetail(sp);
        return;
      }
    }
    det.hidden = true; home.hidden = false;
  }

  const TYPE = { point: 'Point break', beach: 'Beach break', reef: 'Reef break' };

  function renderDetail(sp) {
    const s = sp.spot, el = $('#detail');
    const port = C.tides[s.tidePort].name;
    const mornings = morningDates().map((d) => morningFor(sp, d)).filter(Boolean);
    el.innerHTML = `
      <div class="d-top">
        <button class="icon-btn" id="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <span class="crumb">${s.region === 'sc' ? 'Sunshine Coast' : 'Gold Coast'}</span>
      </div>
      <h1 class="d-title">${esc(s.name)}</h1>
      <div class="d-meta">
        <span>${TYPE[s.type] || ''}</span>
        <span>${arrow((s.faces + 180) % 360, 'var(--tx-2)')}Faces ${cmp(s.faces)}</span>
        <span>Swell ${cmp(s.swell.ideal)} · offshore ${cmp(s.offshore)}</span>
        <span>Tides: ${port}</span>
      </div>
      <p class="d-note">${esc(s.note)}</p>
      <div class="mornings">${mornings.map((m) => `
        <div class="morning" style="--c:${colour(m.best)}">
          <div class="m-day">${dayName(m.date)} ${dm(m.date)}</div>
          <div class="m-rate">${label(m.best)}</div>
          <div class="m-sub">${f1(m.best.surf)} m · ${Math.round(m.best.period)} s<br>${hourLbl(m.best.hour)} · ${Math.round(m.best.wind.s)} ${cmp(m.best.wind.d)}</div>
        </div>`).join('')}
      </div>
      <div class="block-head"><h2>Next 7 days</h2>
        <div class="seg" role="group" aria-label="View">
          <button data-view="charts" aria-pressed="${ui.view === 'charts'}">Charts</button>
          <button data-view="table" aria-pressed="${ui.view === 'table'}">Table</button>
        </div>
      </div>
      ${ui.view === 'charts' ? chartBlock(sp) : ''}
      ${tableBlock(sp)}
    `;
    const sc = $('.chart-scroll', el);
    if (sc) {
      const nowX = +sc.dataset.now || 0;
      sc.scrollLeft = Math.max(0, nowX - 60);
    }
  }

  function chartBlock(sp) {
    const today = nowStr().slice(0, 10);
    const hrs = sp.hours.filter((h) => h.date >= today);
    if (!hrs.length) return '';
    const PX = 12, W = hrs.length * PX;
    const Y = { days: 0, surf: 26, surfH: 118, per: 158, perH: 34, wind: 204, windH: 40, tide: 256, tideH: 56 };
    const H = Y.tide + Y.tideH + 6;
    const maxSurf = Math.max(1.6, ...hrs.map((h) => h.surf)) * 1.12;
    const sy = (v) => Y.surf + Y.surfH - (v / maxSurf) * Y.surfH;
    let svg = '';
    // night shading + day labels
    let lastDate = '';
    hrs.forEach((h, i) => {
      const x = i * PX;
      const sun = model.sun[h.date];
      const night = sun && (h.t < sun.rise.slice(0, 13) + ':00' || h.t > sun.set);
      if (night) svg += `<rect x="${x}" y="${Y.surf}" width="${PX}" height="${H - Y.surf}" fill="#000" opacity=".28"/>`;
      if (h.date !== lastDate) {
        lastDate = h.date;
        svg += `<line x1="${x}" x2="${x}" y1="4" y2="${H}" stroke="var(--line-2)"/>`;
        svg += `<text x="${x + 6}" y="16" font-size="11" style="fill:var(--tx)">${dayName(h.date) === 'Today' ? 'Today' : wd(h.date)} <tspan style="fill:var(--tx-3)">${dm(h.date)}</tspan></text>`;
      }
    });
    // sweet-spot band
    svg += `<rect x="0" y="${sy(R.size.idealHigh)}" width="${W}" height="${sy(R.size.idealLow) - sy(R.size.idealHigh)}" fill="var(--r3)" opacity=".06"/>`;
    [0.5, 1, 1.5, 2, 2.5, 3].filter((v) => v < maxSurf).forEach((v) => {
      svg += `<line x1="0" x2="${W}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--line-2)" stroke-dasharray="2 4"/>`;
      for (let x = 0; x < W; x += 24 * PX) svg += `<text x="${x + 4}" y="${sy(v) - 3}" font-size="8.5" style="fill:var(--tx-3)">${v} m</text>`;
    });
    // surf bars
    hrs.forEach((h, i) => {
      const y = sy(h.surf);
      svg += `<rect x="${i * PX + 1.5}" y="${y.toFixed(1)}" width="${PX - 3}" height="${(Y.surf + Y.surfH - y).toFixed(1)}" rx="2" fill="${colour(h)}" opacity="${h.hour >= 4 && h.hour <= 18 ? 0.95 : 0.4}"/>`;
    });
    // daily peak labels (surf height at noon-ish best)
    const days = [...new Set(hrs.map((h) => h.date))];
    days.forEach((d) => {
      const dh = hrs.filter((h) => h.date === d && h.hour >= 5 && h.hour <= 17);
      if (!dh.length) return;
      const top = dh.reduce((a, b) => (b.score > a.score ? b : a));
      const i = hrs.indexOf(top);
      svg += `<text x="${i * PX + PX / 2}" y="${sy(top.surf) - 5}" font-size="10" text-anchor="middle" style="fill:${colour(top)}">${f1(top.surf)}</text>`;
    });
    // period line
    const py = (p) => Y.per + Y.perH - (clamp(p, 0, 18) / 18) * Y.perH;
    svg += `<path d="${hrs.map((h, i) => `${i ? 'L' : 'M'}${i * PX + PX / 2} ${py(h.period).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--tx-2)" stroke-width="1.4"/>`;
    hrs.forEach((h, i) => { if (h.hour % 6 === 0) svg += `<text x="${i * PX + PX / 2}" y="${py(h.period) - 5}" font-size="9" text-anchor="middle" style="fill:var(--tx-3)">${Math.round(h.period)}s</text>`; });
    // wind arrows
    hrs.forEach((h, i) => {
      if (h.hour % 2) return;
      const cx = i * PX + PX / 2, cy = Y.wind + 12, col = windCol(h.wI.cat);
      const rot = (h.wind.d + 180) % 360;
      const len = clamp(5 + h.wind.s / 4, 6, 11);
      svg += `<g transform="translate(${cx} ${cy}) rotate(${rot})" style="color:${col}"><path d="M0 ${-len} L0 ${len} M-3.5 ${len - 4} L0 ${len} L3.5 ${len - 4}" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
      svg += `<text x="${cx}" y="${Y.wind + 36}" font-size="9" text-anchor="middle" style="fill:${col}">${Math.round(h.wind.s)}</text>`;
    });
    // tide
    const th = hrs.map((h) => (h.tide ? h.tide.h : null));
    const tv = th.filter((v) => v != null);
    if (tv.length) {
      const tlo = Math.min(...tv), thi = Math.max(...tv);
      const ty = (v) => Y.tide + Y.tideH - ((v - tlo) / (thi - tlo || 1)) * (Y.tideH - 10);
      let d = '', started = false;
      th.forEach((v, i) => { if (v == null) return; d += `${started ? 'L' : 'M'}${i * PX + PX / 2} ${ty(v).toFixed(1)} `; started = true; });
      svg += `<path d="${d} L${W - PX / 2} ${Y.tide + Y.tideH} L${PX / 2} ${Y.tide + Y.tideH}Z" fill="var(--tide)" opacity=".16"/>`;
      svg += `<path d="${d}" fill="none" stroke="var(--tide)" stroke-width="1.5"/>`;
      // hi/lo labels from MSQ table
      const ext = raw.tides && raw.tides[sp.spot.tidePort];
      if (ext) {
        const m0 = toMin(hrs[0].t), m1 = toMin(hrs[hrs.length - 1].t);
        ext.filter((e) => e.m >= m0 && e.m <= m1).forEach((e) => {
          const x = ((e.m - m0) / 60) * PX + PX / 2;
          svg += `<text x="${x}" y="${e.hi ? ty(e.h) - 4 : Y.tide + Y.tideH - 3}" font-size="8.5" text-anchor="middle" style="fill:var(--tide)">${clock(e.t).replace(/(am|pm)/, '')}</text>`;
        });
      }
    }
    // now line
    const nowM = toMin(nowStr());
    const nowX = ((nowM - toMin(hrs[0].t)) / 60) * PX + PX / 2;
    svg += `<line x1="${nowX}" x2="${nowX}" y1="22" y2="${H}" stroke="var(--acc)" stroke-width="1.2"/><circle cx="${nowX}" cy="22" r="3" fill="var(--acc)"/>`;

    const labels = [['Surf', Y.surf + 4], ['Period', Y.per + 4], ['Wind', Y.wind + 2], ['Tide', Y.tide + 4]]
      .map(([t, y]) => `<div style="top:${y}px">${t}</div>`).join('');
    return `<div class="chart-wrap">
      <div class="chart-labels">${labels}</div>
      <div class="chart-scroll" data-now="${nowX.toFixed(0)}"><svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="7-day hourly chart">${svg}</svg></div>
    </div>
    <div class="legend">
      ${R.labels.map((l, i) => `<span><i style="background:var(--r${i + 1})"></i>${l}</span>`).join('')}
      <span><i style="background:var(--w-off)"></i>Offshore</span><span><i style="background:var(--w-on)"></i>Onshore</span>
    </div>`;
  }

  function tableBlock(sp) {
    const today = nowStr().slice(0, 10);
    const nowH = nowStr().slice(0, 13);
    const days = [...new Set(sp.hours.map((h) => h.date))].filter((d) => d >= today);
    const ext = raw.tides && raw.tides[sp.spot.tidePort];
    return days.map((d) => {
      const rows = sp.hours.filter((h) => h.date === d && h.hour >= C.ui.detailFromHour && h.hour <= C.ui.detailToHour);
      if (!rows.length) return '';
      const sun = model.sun[d];
      const tides = ext ? ext.filter((e) => e.t.slice(0, 10) === d).map((e) => `${e.hi ? 'H' : 'L'} ${clock(e.t)} ${e.h.toFixed(1)}`).join(' · ') : '';
      return `<div class="tbl-day"><h3>${dayName(d)} <span style="color:var(--tx-3)">${dm(d)}</span></h3>
          <div class="tides">${sun ? `Sunrise ${clock(sun.rise)}` : ''}${tides ? `<br>${tides}` : ''}</div></div>
        <table class="tbl"><thead><tr><th>Time</th><th>Rating</th><th>Surf</th><th>Swell</th><th>Wind</th><th>Tide</th></tr></thead><tbody>
        ${rows.map((h) => {
          const night = sun && (h.t < sun.rise.slice(0, 13) + ':00' || h.t > sun.set);
          const s2 = h.sw2.h > 0.2 ? `<div class="s2">${f1(h.sw2.h)} ${cmp(h.sw2.d)} ${Math.round(h.sw2.p)}s</div>` : '';
          return `<tr class="${night ? 'night' : ''}${h.t.slice(0, 13) === nowH ? ' now' : ''}">
            <td class="t">${hourLbl(h.hour)}</td>
            <td><span class="rb" style="background:${colour(h)}"></span><span class="rw" style="color:${colour(h)}">${label(h)}</span></td>
            <td class="surf">${f1(h.surf)}</td>
            <td class="sw">${f1(h.sw.h)} ${cmp(h.sw.d)} ${Math.round(h.sw.p)}s${s2}</td>
            <td class="wind">${arrow(h.wind.d, windCol(h.wI.cat))}${Math.round(h.wind.s)} <span class="g">${Math.round(h.wind.g)}</span></td>
            <td class="tide">${h.tide ? f1(h.tide.h) + (h.tide.rising ? '↑' : '↓') : '–'}</td>
          </tr>`;
        }).join('')}
        </tbody></table>`;
    }).join('');
  }

  /* ================================================================
     EVENTS
     ================================================================ */
  let homeScroll = 0;
  document.addEventListener('click', (e) => {
    const t = e.target;
    const reg = t.closest('.region button');
    if (reg) { ui.region = reg.dataset.region; store.set('dawnie:region', ui.region); ui.day = 0; renderHome(); swapIn(); return; }
    const day = t.closest('.day');
    if (day) { if (+day.dataset.i !== ui.day) { ui.day = +day.dataset.i; renderHome(); swapIn(); } return; }
    const spot = t.closest('[data-spot]');
    if (spot && !$('#home').hidden) { homeScroll = window.scrollY; location.hash = `#/spot/${spot.dataset.spot}`; return; }
    if (t.closest('#back')) { if (history.length > 1) history.back(); else location.hash = ''; return; }
    const v = t.closest('[data-view]');
    if (v) {
      ui.view = v.dataset.view; store.set('dawnie:view', ui.view);
      const m = location.hash.match(/^#\/spot\/([\w-]+)/);
      const sp = m && model.spots.find((s) => s.spot.id === m[1]);
      if (sp) renderDetail(sp);
      return;
    }
    if (t.closest('#refresh')) load(true);
  });
  window.addEventListener('hashchange', () => {
    const toDetail = location.hash.startsWith('#/spot/');
    route();
    window.scrollTo(0, toDetail ? 0 : homeScroll);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && raw && Date.now() - (raw.fetchedAt || 0) > C.ui.cacheMinutes * 60e3) load(true);
  });

  // first paint: skeleton
  $('#hero').innerHTML = '<div class="hero-in"><div class="skel" style="height:14px;width:40%"></div><div class="skel" style="height:56px;width:55%;margin:18px 0 10px"></div><div class="skel" style="height:22px;width:70%"></div><div class="skel" style="height:60px;margin-top:28px"></div></div>';
  $('#ranking').innerHTML = Array.from({ length: 5 }, () => '<li class="row"><span></span><div class="skel" style="height:18px;width:60%"></div><span></span><div class="skel" style="grid-column:2/4;height:12px;width:85%"></div></li>').join('');
  renderSources();
  load(false);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
