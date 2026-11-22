/* Surf Cowabunga — longboard dawn-patrol forecast. No build step, no dependencies.
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
  const bneStr = (ms) => new Date(ms + BNE).toISOString().slice(0, 16); // epoch ms → Brisbane "YYYY-MM-DDTHH:MM"
  // "6:10am", "yesterday 6:10am" or "20/11 6:10am" — for timestamps in the past.
  const whenStr = (s) => { const t = nowStr().slice(0, 10), d = s.slice(0, 10); return (d === t ? '' : d === addDays(t, -1) ? 'yesterday ' : dm(d) + ' ') + clock(s); };
  const agoStr = (min) => (min < 2 ? 'just now' : min < 60 ? `${min} min ago` : min < 600 ? `${Math.floor(min / 60)} h${min % 60 >= 10 ? ' ' + (min % 60) + ' min' : ''} ago` : `${Math.round(min / 60)} h ago`);
  // One day-label style everywhere: eyebrow Today / Tomorrow / weekday name, sub-line "Wed 25/11".
  const dayLabel = (d) => { const n = dayName(d); return { top: n === wd(d) ? LONGDAY[wd(d)] : n, sub: `${wd(d)} ${dm(d)}` }; };
  const clockExact = (s) => { const h = +s.slice(11, 13); return (h % 12 || 12) + ':' + s.slice(14, 16) + (h < 12 ? 'am' : 'pm'); };
  // Units: number + narrow no-break (thin) space + smaller muted unit.
  const TS = '\u202f'; // narrow no-break space, so a unit never wraps away from its number
  const U = (n, unit) => `${n}${TS}<span class="unit">${unit}</span>`;
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  // Go / Maybe / Skip for a morning's best hour (thresholds in C.ui.verdict).
  function verdict(h) {
    const V = C.ui.verdict;
    if (h.flag) return 'skip';
    return h.rating >= V.go ? 'go' : h.rating >= V.maybe ? 'maybe' : 'skip';
  }
  const VERDICT = { go: 'Go', maybe: 'Maybe', skip: 'Skip' };
  function tagline(h, v) {
    const T = C.ui.taglines;
    if (h.flag === 'big') return T.tooBig;
    if (h.flag === 'flat') return T.flat;
    if (h.wI.sc < 0.35) return T.blownOut;
    if (v === 'go') return h.wI.cat === 'glassy' ? T.glassy : h.wI.cat === 'offshore' ? T.offshore : T.go;
    if (v === 'maybe') return h.surf < R.size.idealLow && h.wI.sc > 0.8 ? T.smallClean : h.chop > 0.12 ? T.bumpy : T.maybe;
    return h.surf < R.size.idealLow ? T.tiny : T.skip;
  }

  /* ---------------- Favourite spots ---------------- */
  const FAV_KEY = 'dawnie:favs';
  const favs = new Set(Array.isArray(store.get(FAV_KEY)) ? store.get(FAV_KEY) : []);
  const isFav = (id) => favs.has(id);
  function toggleFav(id) {
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    store.set(FAV_KEY, [...favs]);
  }
  const starBtn = (id, name, cls = '') => `<button class="fav${cls}" data-fav="${id}" aria-pressed="${isFav(id)}" aria-label="${isFav(id) ? 'Remove' : 'Add'} ${esc(name)} ${isFav(id) ? 'from' : 'to'} favourites"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.5l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z" stroke-linejoin="round"/></svg></button>`;

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
        ? `${f1(open)}${TS}m ${cmp(h.sw.d)} swell won't wrap in`
        : `tiny, about ${f1(h.surf)}${TS}m`);
    } else if (h.flag === 'big') {
      parts.push(`${f1(h.surf)}${TS}m, too big for longboarding`);
    } else {
      const adj = h.chop > 0.12 ? 'choppy ' : h.wI.sc > 0.85 && h.chop < 0.05 ? 'clean ' : '';
      parts.push(`${adj}${f1(h.surf)}${TS}m ${cmp(h.main ? h.main.d : h.sw.d)} @ ${Math.round(h.period)}${TS}s`);
    }
    const w = h.wind, s = Math.round(w.s), light = h.wI.light ? 'light ' : '';
    parts.push(
      h.wI.cat === 'glassy' ? 'glassy'
        : h.wI.cat === 'offshore' ? `${light}${cmp(w.d)} offshore`
          : h.wI.cat === 'cross' ? `${light}${cmp(w.d)} cross-shore ${s}${TS}km/h`
            : `${light}${cmp(w.d)} onshore ${s}${TS}km/h`);
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

  // Network / refresh state, used by the subtitle, refresh button and source list.
  const net = { busy: false, failed: false, flash: 0 };
  const isOffline = () => net.failed || navigator.onLine === false;

  function setBusy(on, result) {
    const btn = $('#refresh');
    net.busy = on;
    btn.setAttribute('aria-busy', String(on));
    btn.classList.remove('ok', 'fail');
    if (on) btn.classList.add('spin');
    else if (reduceMotion() || !btn.classList.contains('spin')) btn.classList.remove('spin');
    else btn.dataset.stop = '1'; // let the current turn finish (see animationiteration below)
    if (result) {
      btn.classList.add(result);
      clearTimeout(setBusy.t);
      setBusy.t = setTimeout(() => btn.classList.remove('ok', 'fail'), result === 'ok' ? 1600 : 2200);
    }
    renderUpdated();
  }

  async function load(force) {
    if (net.busy) return;
    const started = Date.now();
    setBusy(true);
    const cached = store.get('dawnie:data:v1');
    const fresh = cached && Date.now() - cached.ts < C.ui.cacheMinutes * 60e3;
    let cacheOk = false;
    if (cached && !raw) {
      try { raw = cached.raw; model = buildModel(raw); render(); cacheOk = true; }
      catch (e) { console.warn('cache unusable', e); raw = null; model = null; } // old/corrupt cache → fetch fresh
    } else if (raw) cacheOk = true;
    if (fresh && !force && cacheOk) {
      Object.keys(status).forEach((k) => (status[k] = raw[k] ? 'ok' : 'err'));
      if (raw.tidesFallback) status.tides = 'warn';
      status.buoys = 'pending';
      setBusy(false);
      renderSources(); renderBuoys();
      // buoys are always fetched live
      fetchBuoys().then((b) => { raw.buoys = b; status.buoys = 'ok'; renderBuoys(); renderSources(); })
        .catch(() => { status.buoys = raw.buoys ? 'warn' : 'err'; renderBuoys(); renderSources(); });
      return;
    }
    const [m, w, t, b] = await Promise.allSettled([fetchMarine(), fetchWind(), fetchTides(), fetchBuoys()]);
    const next = { ...(raw || {}) };
    const take = (key, res) => {
      if (res.status === 'fulfilled') { next[key] = res.value; status[key] = 'ok'; }
      else { status[key] = next[key] ? 'warn' : 'err'; console.warn(key, res.reason); }
    };
    take('marine', m); take('wind', w); take('tides', t); take('buoys', b);
    if (t.status !== 'fulfilled') {
      // keep the saved MSQ tide table if it still covers the next few days
      const horizon = toMin(addDays(nowStr().slice(0, 10), 4));
      const keep = next.tides && Object.values(next.tides).some((e) => e.length && e[e.length - 1].m >= horizon);
      if (!keep) next.tides = null;
      next.tidesFallback = !keep;
      status.tides = keep ? 'ok' : 'warn';
    } else next.tidesFallback = false;
    const gotForecast = m.status === 'fulfilled' && w.status === 'fulfilled';
    net.failed = !gotForecast;
    // keep the spinner up long enough to read as "checked", not a flicker
    const wait = 650 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!next.marine || !next.wind) {
      setBusy(false, force ? 'fail' : null);
      renderSources();
      if (!model) renderError();
      return;
    }
    raw = next;
    if (gotForecast) {
      raw.fetchedAt = Date.now();
      store.set('dawnie:data:v1', { ts: Date.now(), raw });
    }
    model = buildModel(raw);
    if (force && gotForecast) net.flash = Date.now();
    setBusy(false, force ? (gotForecast ? 'ok' : 'fail') : null);
    render();
  }

  // Subtitle under the wordmark: when the data is from, and whether we're offline.
  function renderUpdated() {
    const el = $('#updated');
    if (!el) return;
    const at = raw && raw.fetchedAt;
    let cls = '', txt;
    if (!at) {
      if (net.busy) { cls = 'busy'; txt = 'Loading the lineup…'; }
      else if (isOffline()) { cls = 'err'; txt = 'Offline · no saved forecast yet'; }
      else txt = 'Longboard mornings';
    } else {
      const when = whenStr(bneStr(at));
      if (net.busy) { cls = 'busy'; txt = 'Checking for new data…'; }
      else if (isOffline()) { cls = 'warn'; txt = `Offline · showing data from ${when}`; }
      else if (Date.now() - net.flash < 2500) { cls = 'ok'; txt = `Up to date · ${when}`; }
      else {
        const stale = Date.now() - at > C.ui.cacheMinutes * 60e3 * 3;
        cls = stale ? 'warn' : '';
        txt = `Updated ${when}`;
      }
    }
    el.className = 'sub' + (cls ? ' is-' + cls : '');
    el.innerHTML = `<i class="sd" aria-hidden="true"></i><span>${esc(txt)}</span>`;
    if (cls === 'ok') { clearTimeout(renderUpdated.t); renderUpdated.t = setTimeout(renderUpdated, 2600); }
  }

  // No forecast at all (first run with no network, or servers down).
  function renderError() {
    dismissSplash();
    const off = navigator.onLine === false;
    $('#hero').innerHTML = `<div class="hero-in state">
      <svg class="state-ic" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="21" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 31c4.5 0 4.5-3 9-3s4.5 3 9 3 4.5-3 9-3 4.5 3 9 3M6 37c4.5 0 4.5-3 9-3s4.5 3 9 3 4.5-3 9-3 4.5 3 9 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M9 9l30 30" stroke="var(--big)" stroke-width="1.6" stroke-linecap="round"/></svg>
      <h3 class="state-title">${off ? "You're offline" : "Can't reach the forecast"}</h3>
      <p class="state-body">${off ? "There's no saved forecast on this phone yet. Surf Cowabunga will load the lineup as soon as you're back online." : "The forecast servers didn't answer. It's usually brief — give it a moment and try again."}</p>
      <button class="btn" data-retry>Try again</button>
    </div>`;
    $('#ranking').innerHTML = '';
    $('#days').innerHTML = '';
    $('#window-meta').textContent = '';
    $('#buoys').innerHTML = '';
  }

  /* ================================================================
     RENDER — HOME
     ================================================================ */
  function render() {
    renderHome();
    route();
    dismissSplash();
  }

  function renderHome() {
    const region = ui.region;
    $('.region').dataset.active = region;
    document.querySelectorAll('.region button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.region === region)));
    renderUpdated();

    const dates = morningDates();
    ui.day = Math.min(ui.day, dates.length - 1);
    const spots = model.spots.filter((s) => s.spot.region === region);
    const ranks = dates.map((d) => spots.map((sp) => ({ sp, m: morningFor(sp, d) })).filter((x) => x.m)
      .sort((a, b) => b.m.best.score - a.m.best.score));

    $('#days').innerHTML = dates.map((d, i) => {
      const top = ranks[i][0];
      const L = dayLabel(d);
      return `<button class="day" role="tab" data-i="${i}" aria-selected="${i === ui.day}"${top ? ` style="--c:${colour(top.m.best)}"` : ''}>
        <span class="d1">${L.top}</span>
        <span class="d2">${L.sub}</span>
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

    // favourites pinned to the top (keeping their score rank number)
    const ranked = list.map((x, i) => ({ ...x, rank: i + 1 }));
    const pinned = ranked.filter((x) => isFav(x.sp.spot.id));
    const rest = ranked.filter((x) => !isFav(x.sp.spot.id));
    // 3+ flat spots (never favourites) fold into one dimmed row that expands on tap
    const flats = rest.filter((x) => x.m.best.flag === 'flat');
    const fold = flats.length >= 3;
    const ordered = [...pinned, ...(fold ? rest.filter((x) => !flats.includes(x)) : rest)];
    const rowHtml = ({ sp, m, rank }, i, extra = '') => {
      const b = m.best, fav = isFav(sp.spot.id);
      const bars = m.hrs.map((h) => `<i class="${h === b ? 'best' : ''}" style="--c:${colour(h)};--v:${barH(h)}"></i>`).join('');
      return `<li class="row${fav ? ' is-fav' : ''}${fav && i === pinned.length - 1 ? ' fav-last' : ''}${extra}" data-spot="${sp.spot.id}" style="--i:${i}">
        <span class="rank">${String(rank).padStart(2, '0')}</span>
        <span class="name"><span class="nm">${esc(sp.spot.name)}</span>${starBtn(sp.spot.id, sp.spot.name)}</span>
        <span class="pill" style="--c:${colour(b)}">${label(b)}</span>
        <span class="why">${esc(cap([...why(b), ...(b.tide ? [tideWord(b.tide)] : [])].join(', ')))}</span>
        <span class="strip" aria-label="Best at ${hourLbl(b.hour)}, window ${hourLbl(m.hrs[0].hour)} to ${hourLbl(m.hrs[m.hrs.length - 1].hour)}"><span class="spark-m" aria-hidden="true">${bars}</span>${tideSpark(m)}<span class="row-wind" style="color:${windCol(b.wI.cat)}" title="${cmp(b.wind.d)} ${b.wI.cat} ${Math.round(b.wind.s)} km/h">${b.wI.cat === 'glassy' ? '<i class="calm"></i>' : arrow(b.wind.d, 'currentColor', 11)}<span>${Math.round(b.wind.s)}</span></span><span class="at">best <b>${hourLbl(b.hour)}</b></span></span>
      </li>`;
    };
    let html = ordered.map((x, i) => rowHtml(x, i)).join('');
    if (fold) {
      const open = !!ui.flatOpen;
      html += `<li class="flat-more" style="--i:${ordered.length}"><button data-flat-toggle aria-expanded="${open}"><span class="fm-dot" aria-hidden="true"></span><span>${open ? 'Hide ' + flats.length : flats.length + ' more'} spots flat</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></li>`;
      if (open) html += flats.map((x, k) => rowHtml(x, ordered.length + 1 + k, ' is-flat')).join('');
    }
    $('#ranking').innerHTML = html;

    renderBuoys();
    renderSources();
  }

  // Bar height for an hour: its score, full height at Epic, with a floor so every hour reads.
  const barH = (h) => clamp(h.score / 0.8, 0.08, 1).toFixed(3);

  // Tiny tide line for a lineup row's morning window, best hour marked.
  function tideSpark(m) {
    const hrs = m.hrs, n = hrs.length;
    if (n < 2 || hrs.some((h) => !h.tide)) return '';
    const W = 36, H = 14, P = 2;
    const pts = hrs.map((h, k) => [P + (k / (n - 1)) * (W - 2 * P), H - P - h.tide.norm * (H - 2 * P)]);
    const d = pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const bp = pts[hrs.indexOf(m.best)];
    return `<svg class="tide-m" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}"/>${bp ? `<circle cx="${bp[0].toFixed(1)}" cy="${bp[1].toFixed(1)}" r="2"/>` : ''}</svg>`;
  }

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
    if (!top) { delete el.dataset.spot; el.innerHTML = '<div class="hero-in"><p class="hero-why">No forecast for this morning yet.</p></div>'; return; }
    const { sp, m } = top, b = m.best;
    el.style.setProperty('--c', colour(b));
    el.dataset.spot = sp.spot.id;
    const tide = b.tide ? U(f1(b.tide.h), 'm') : '–';
    const tideArrow = (up) => `<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" style="color:var(--tide)"><path d="M6 ${up ? '10V2M2.5 5.5 6 2l3.5 3.5' : '2v8M2.5 6.5 6 10l3.5-3.5'}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const v = verdict(b);
    el.innerHTML = `<div class="hero-in">
        <div class="verdict is-${v}"><span class="v-word">${VERDICT[v]}</span><span class="v-tag">${esc(tagline(b, v))}</span></div>
        <div class="eyebrow"><span class="eb-l"><span class="live"></span>Best bet</span><span class="eb-r">${dayLabel(date).top} · ${hourLbl(b.hour)}</span></div>
        <div class="hero-rating">${label(b)}</div>
        <div class="hero-name">${esc(sp.spot.name)}</div>
        <p class="hero-why">${esc(cap(why(b).join(', ')))}.</p>
        ${timeline(m)}
        <div class="stats">
          <div class="stat"><div class="k">Surf</div><div class="v">${U(f1(b.surf), 'm')}</div><div class="s">${cmp(b.main ? b.main.d : b.sw.d)}</div></div>
          <div class="stat"><div class="k">Period</div><div class="v">${U(Math.round(b.period), 's')}</div><div class="s">${b.sw2.h > 0.2 ? `+${f1(b.sw2.h)}${TS}m ${cmp(b.sw2.d)}` : `${cmp(b.sw.d)} swell`}</div></div>
          <div class="stat"><div class="k">Wind</div><div class="v">${U(Math.round(b.wind.s), 'km/h')}</div><div class="s" style="color:${windCol(b.wI.cat)}">${cmp(b.wind.d)} ${{ offshore: 'off', onshore: 'on' }[b.wI.cat] || b.wI.cat}</div></div>
          <div class="stat"><div class="k">Tide</div><div class="v">${tide}</div><div class="s">${b.tide ? tideArrow(b.tide.rising) + (b.tide.rising ? 'rising' : 'falling') : ''}</div></div>
        </div>
      </div>`;
  }

  // Re-run the entrance animation on hero + lineup (region / day change only).
  function swapIn() {
    for (const el of [$('#hero'), $('#ranking')]) { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
  }

  /* ---------------- Buoy check ---------------- */
  // The Qld feed normally lags the clock by 1–3 h, so "fresh" is generous.
  const BUOY_FRESH = 240, BUOY_STALE = 720; // minutes
  const BUOY_AGE_WARN = 90; // the "x min ago" text turns amber past this

  // Model value at a Brisbane timestamp, linearly between hourly steps.
  function fcAt(fc, key, t) {
    if (!fc || !fc[key]) return null;
    const i = fc.time.indexOf(t.slice(0, 13) + ':00');
    if (i < 0 || fc[key][i] == null) return null;
    const f = +t.slice(14, 16) / 60, b = fc[key][i + 1];
    return f && b != null && key !== 'wave_direction' ? fc[key][i] + (b - fc[key][i]) * f : fc[key][i];
  }

  // Last hour vs three hours earlier, averaged to smooth out single-wave noise.
  function buoyTrend(obs) {
    const tl = toMin(obs[obs.length - 1].t);
    const avg = (a, b) => {
      const v = obs.filter((o) => { const m = tl - toMin(o.t); return m >= a && m < b; }).map((o) => o.hs);
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
    };
    const now = avg(0, 60), then = avg(180, 240);
    if (now == null || then == null) return null;
    const d = now - then;
    return { d, k: Math.abs(d) < Math.max(0.05, then * 0.06) ? 'steady' : d > 0 ? 'up' : 'down' };
  }
  const TREND = { up: ['Building', -45], down: ['Easing', 45], steady: ['Steady', 0] };
  const trendIcon = (k) => `<svg viewBox="0 0 16 16" aria-hidden="true" style="transform:rotate(${TREND[k][1]}deg)"><path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const buoySkel = () => `<article class="buoy is-loading" aria-hidden="true">
      <div class="buoy-head"><div class="skel" style="width:96px;height:15px"></div><div class="skel" style="width:84px;height:12px"></div></div>
      <div class="buoy-main"><div class="skel" style="width:112px;height:34px"></div><div class="skel" style="width:76px;height:22px;border-radius:999px"></div></div>
      <div class="skel" style="height:40px;margin-top:16px"></div>
      <div class="skel" style="height:60px;margin-top:16px"></div>
    </article>`;

  function renderBuoys() {
    const el = $('#buoys');
    if (!model) return;
    const list = C.buoys.map((b, i) => ({ b, i })).filter(({ b }) => b.region === ui.region);
    const obsAll = (raw && raw.buoys) || {};
    const nowM = toMin(nowStr());
    el.innerHTML = list.map(({ b, i }) => {
      const obs = obsAll[b.site] || [];
      if (!obs.length) {
        if (status.buoys === 'pending') return buoySkel();
        const down = status.buoys === 'err';
        return `<article class="buoy is-empty">
          <div class="buoy-head"><h3>${esc(b.name)}</h3><span class="age is-${down ? 'err' : 'warn'}"><i></i>${down ? 'Feed unreachable' : 'No recent reading'}</span></div>
          <p class="buoy-empty">${down ? "The Queensland wave buoy feed didn't answer. Tap refresh to try again." : "This buoy hasn't reported in the last 24 hours. It may be offline for maintenance."}</p>
        </article>`;
      }
      const last = obs[obs.length - 1];
      const fc = model.buoyFc[i];
      const ageMin = Math.max(0, Math.round(nowM - toMin(last.t)));
      const ageCls = ageMin <= BUOY_FRESH ? 'ok' : ageMin <= BUOY_STALE ? 'warn' : 'err';
      const ageWarn = ageMin > BUOY_AGE_WARN;
      const fH = fcAt(fc, 'wave_height', last.t), fP = fcAt(fc, 'swell_wave_period', last.t), fD = fcAt(fc, 'wave_direction', last.t);
      let vs = '';
      if (fH) {
        const diff = (last.hs - fH) / fH, pct = Math.round(Math.abs(diff) * 100);
        const [cls, word] = Math.abs(diff) < 0.15 ? ['on', 'On track'] : diff > 0 ? ['up', 'Bigger'] : ['down', 'Smaller'];
        vs = `<div class="buoy-vs"><span class="tag ${cls}">${word}</span><span class="buoy-vs-sub">${pct === 0 ? 'Matches' : (diff > 0 ? '+' : '−') + pct + '%'} vs model</span></div>`;
      }
      const tr = buoyTrend(obs);
      const sstRow = [...obs].reverse().find((o) => o.sst != null);
      const sst = sstRow ? sstRow.sst : null;
      const stat = (k, v, m) => `<div><dt>${k}</dt><dd>${v}</dd><dd class="m">${m}</dd></div>`;
      return `<article class="buoy">
        <div class="buoy-head"><h3>${esc(b.name)}</h3><span class="age is-${ageCls}" title="Latest reading ${whenStr(last.t)}"><i></i>${clockExact(last.t)} · <span class="age-ago${ageWarn ? ' is-old' : ''}">${agoStr(ageMin)}</span></span></div>
        <div class="buoy-main">
          <div class="buoy-now">
            <div class="buoy-big">${U(last.hs.toFixed(2), 'm')}</div>
            <div class="buoy-cap">${fH ? `Model <b>${U(fH.toFixed(2), 'm')}</b>` : 'No model for this hour'}</div>
          </div>
          ${vs}
        </div>
        <dl class="buoy-stats">
          ${stat('Trend', tr ? `<span class="trend is-${tr.k}">${trendIcon(tr.k)}${TREND[tr.k][0]}</span>` : '–', tr ? `${tr.d >= 0 ? '+' : '−'}${Math.abs(tr.d).toFixed(2)}${TS}m/3h` : 'Not enough data')}
          ${stat('Period', last.tp ? U(last.tp.toFixed(1), 's') : '–', `Model ${fP ? fP.toFixed(1) + TS + 's' : '–'}`)}
          ${stat('From', cmp(last.dir), `Model ${cmp(fD)}`)}
          ${sst != null ? stat('Sea', U(sst.toFixed(1), '°C'), 'Surface') : ''}
        </dl>
        ${sparkline(obs, fc, b.site)}
      </article>`;
    }).join('') + (ui.region === 'sc' ? '<p class="buoy-note">No Noosa buoy is in the live feed — Mooloolaba is the closest.</p>' : '');
  }

  function sparkline(obs, fc, key) {
    const W = 300, H = 64, PT = 5, PB = 3;
    const t0 = toMin(obs[0].t), t1 = toMin(obs[obs.length - 1].t);
    if (t1 - t0 < 60) return '';
    const fpts = [];
    if (fc) fc.time.forEach((t, i) => { const m = toMin(t); if (m >= t0 && m <= t1 && fc.wave_height[i] != null) fpts.push([m, fc.wave_height[i]]); });
    const o = obs.map((r) => [toMin(r.t), r.hs]);
    const vals = o.concat(fpts).map((p) => p[1]);
    const mn = Math.min(...vals), mx = Math.max(...vals), span = Math.max(0.3, mx - mn);
    const lo = Math.max(0, mn - span * 0.3), hi = mx + span * 0.15;
    const step = [0.1, 0.2, 0.25, 0.5, 1, 2].find((s) => (hi - lo) / s <= 3) || 2;
    const ticks = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(2));
    const X = (m) => ((m - t0) / (t1 - t0)) * W;
    const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
    const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ');
    const id = 'sg-' + key.replace(/\W/g, '');
    const hs = o.map((p) => p[1]);
    const dec = step === 0.25 ? 2 : 1;
    const midT = new Date(Math.round((t0 + t1) / 60) * 30 * 60000).toISOString().slice(0, 16);
    return `<figure class="spark-fig">
      <figcaption class="spark-head"><span>Last ${Math.round((t1 - t0) / 60)} h</span><span class="spark-key"><i class="k-buoy"></i>Buoy<i class="k-model"></i>Model</span></figcaption>
      <div class="spark-wrap">
        <div class="spark-plot">
          <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Buoy wave height over the last day, ${f1(Math.min(...hs))} to ${f1(Math.max(...hs))} metres">
            <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--r4)" stop-opacity=".22"/><stop offset="1" stop-color="var(--r4)" stop-opacity="0"/></linearGradient></defs>
            ${ticks.map((v) => `<line x1="0" x2="${W}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="spark-grid" vector-effect="non-scaling-stroke"/>`).join('')}
            <path d="${line(o)} L${W} ${H} L0 ${H}Z" fill="url(#${id})"/>
            ${fpts.length > 1 ? `<path d="${line(fpts)}" class="spark-model" vector-effect="non-scaling-stroke"/>` : ''}
            <path d="${line(o)}" class="spark-live" vector-effect="non-scaling-stroke"/>
          </svg>
          <span class="spark-dot" style="top:${((Y(hs[hs.length - 1]) / H) * 100).toFixed(1)}%"></span>
        </div>
        <div class="spark-y" aria-hidden="true">${ticks.map((v, i) => `<span style="top:${((Y(v) / H) * 100).toFixed(1)}%">${v.toFixed(dec)}${i === ticks.length - 1 ? TS + 'm' : ''}</span>`).join('')}</div>
        <div class="spark-x" aria-hidden="true"><span>${clock(obs[0].t)}</span><span>${clock(midT)}</span><span>${clock(obs[obs.length - 1].t)}</span></div>
      </div>
    </figure>`;
  }

  /* ---------------- Data sources ---------------- */
  const SOURCES = { marine: ['Swell', 'Open-Meteo Marine'], wind: ['Wind', 'Open-Meteo'], tides: ['Tides', 'Maritime Safety Qld'], buoys: ['Buoys', 'Qld Coastal Data System'] };
  function renderSources() {
    const at = raw && raw.fetchedAt ? whenStr(bneStr(raw.fetchedAt)) : '';
    let latest = '';
    if (raw && raw.buoys) for (const rows of Object.values(raw.buoys)) { const t = rows.length && rows[rows.length - 1].t; if (t && t > latest) latest = t; }
    const text = (k, s) => {
      if (s === 'pending') return 'Checking…';
      if (s === 'err') return 'Unavailable';
      if (s === 'warn') return k === 'tides' && raw && raw.tidesFallback ? 'Model estimate' : `Saved${at ? ' · ' + at : ''}`;
      if (k === 'buoys') return latest ? `Latest ${whenStr(latest).replace(clock(latest), clockExact(latest))}` : 'Live';
      return isOffline() && at ? `Saved · ${at}` : 'Live';
    };
    $('#sources').innerHTML = Object.entries(status).map(([k, s]) =>
      `<li class="src is-${s}"><i aria-hidden="true"></i><span class="src-k">${SOURCES[k][0]}</span><span class="src-p">${SOURCES[k][1]}</span><span class="src-s">${text(k, s)}</span></li>`).join('');
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
  const TIDE_PREF = { low: 'Low', lowmid: 'Low–mid', mid: 'Mid', midhigh: 'Mid–high', high: 'High', all: 'Any' };

  // Compass rose: swell window wedge, offshore wind marker, facing direction.
  function compassGlyph(s) {
    const c = 36, r = 30, rad = (b) => (b * Math.PI) / 180;
    const p = (b, rr) => [(c + rr * Math.sin(rad(b))).toFixed(1), (c - rr * Math.cos(rad(b))).toFixed(1)];
    const a0 = s.swell.ideal - s.swell.spread, a1 = s.swell.ideal + s.swell.spread, rw = r - 4;
    let ticks = '';
    for (let b = 0; b < 360; b += 30) {
      const [x1, y1] = p(b, r), [x2, y2] = p(b, r - (b % 90 ? 3 : 5));
      ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    }
    const [sx0, sy0] = p(a0, rw), [sx1, sy1] = p(a1, rw), [ax0, ay0] = p(a0, r), [ax1, ay1] = p(a1, r);
    const large = a1 - a0 > 180 ? 1 : 0;
    // offshore: small arrowhead sitting on the rim, pointing into the centre
    const off = s.offshore, [ox, oy] = p(off, r - 9);
    const [fx, fy] = p(s.faces, 17);
    return `<svg class="d-compass" viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="${c}" cy="${c}" r="${r}" class="cr"/>
      <g class="ct">${ticks}</g>
      <path d="M${c} ${c} L${sx0} ${sy0} A${rw} ${rw} 0 ${large} 1 ${sx1} ${sy1}Z" class="cw"/>
      <path d="M${ax0} ${ay0} A${r} ${r} 0 ${large} 1 ${ax1} ${ay1}" class="cwr"/>
      <g transform="translate(${ox} ${oy}) rotate(${(off + 180) % 360})"><path d="M0 4.5 L3.6 -3.5 L0 -1.6 L-3.6 -3.5Z" class="co"/></g>
      <line x1="${c}" y1="${c}" x2="${fx}" y2="${fy}" class="cf"/>
      <circle cx="${fx}" cy="${fy}" r="2.2" class="cfd"/>
      <circle cx="${c}" cy="${c}" r="1.6" class="cfd"/>
      <text x="${c}" y="15.5" text-anchor="middle">N</text>
    </svg>`;
  }

  function renderDetail(sp) {
    const s = sp.spot, el = $('#detail');
    const port = C.tides[s.tidePort].name;
    const mornings = morningDates().map((d) => morningFor(sp, d)).filter(Boolean);
    const win = `${cmp(s.swell.ideal - s.swell.spread)}–${cmp(s.swell.ideal + s.swell.spread)}`;
    el.innerHTML = `
      <div class="d-top">
        <button class="icon-btn" id="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <span class="crumb">${s.region === 'sc' ? 'Sunshine Coast' : 'Gold Coast'}</span>
        ${starBtn(s.id, s.name, ' icon-btn d-fav')}
      </div>
      <header class="d-head">
        <div class="d-kicker">${TYPE[s.type] || 'Surf break'}</div>
        <h1 class="d-title">${esc(s.name)}</h1>
        <div class="d-spec">
          ${compassGlyph(s)}
          <dl>
            <div><dt><i class="k-face"></i>Faces</dt><dd>${cmp(s.faces)}</dd></div>
            <div><dt><i class="k-swell"></i>Swell window</dt><dd>${win}</dd></div>
            <div><dt><i class="k-off"></i>Offshore wind</dt><dd>${cmp(s.offshore)}</dd></div>
            <div><dt><i class="k-tide"></i>Best tide</dt><dd>${TIDE_PREF[s.tide] || '–'}<span>${esc(port)}</span></dd></div>
          </dl>
        </div>
        <p class="d-note">${esc(s.note)}</p>
      </header>
      <section class="d-sec">
        <div class="d-sec-head"><h2>Next mornings</h2><span>First light – ${hourLbl(R.morning.endHour)}</span></div>
        <div class="mornings">${mornings.map((m) => {
          const b = m.best;
          return `
          <article class="morning" style="--c:${colour(b)}">
            <div class="m-day">${dayLabel(m.date).top}<span>${dayLabel(m.date).sub}</span></div>
            <div class="m-rate">${label(b)}</div>
            <div class="m-strip" aria-hidden="true">${m.hrs.map((h) => `<i class="${h === b ? 'best' : ''}" style="background:${colour(h)}"></i>`).join('')}</div>
            <div class="m-sub"><span>${U(f1(b.surf), 'm')} ${U(Math.round(b.period), 's')}</span>
              <span>${hourLbl(b.hour)}<em style="color:${windCol(b.wI.cat)}">${arrow(b.wind.d, 'currentColor', 10)}${Math.round(b.wind.s)}</em></span></div>
          </article>`;
        }).join('')}
        </div>
      </section>
      <section class="d-sec">
        <div class="d-sec-head d-sec-head--seg"><h2>Next 7 days</h2>
          <div class="seg" role="group" aria-label="View">
            <button data-view="charts" aria-pressed="${ui.view === 'charts'}">Charts</button>
            <button data-view="table" aria-pressed="${ui.view === 'table'}">Table</button>
          </div>
        </div>
        ${ui.view === 'charts' ? chartBlock(sp) + '<div class="d-sec-head d-sec-head--sub"><h2>Hour by hour</h2><span>Brisbane time</span></div>' : ''}
        ${tableBlock(sp)}
      </section>
    `;
    // rows scroll to just below the sticky day header (its height varies with the tide curve)
    const th = $('.tday-h', el);
    if (th) $('.tbl-wrap', el).style.setProperty('--th', th.offsetHeight + 'px');
    const sc = $('.chart-scroll', el);
    if (sc) {
      // Fade a day label out as its column scrolls away, rather than showing a clipped fragment.
      const cells = [...sc.querySelectorAll('.cd')];
      let raf = 0;
      const fit = () => {
        raf = 0;
        const left = sc.scrollLeft;
        cells.forEach((c) => c.classList.toggle('tight', c.offsetLeft + c.offsetWidth - left < c.firstElementChild.offsetWidth + 8));
      };
      sc.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(fit); }, { passive: true });
      sc.scrollLeft = Math.max(0, (+sc.dataset.now || 0) - 28);
      fit();
    }
  }

  // High/low tide turning points for a spot: MSQ table, or derived from the modelled sea level.
  function tideTurns(sp) {
    const ext = raw.tides && raw.tides[sp.spot.tidePort];
    if (ext && ext.length) return ext.map((e) => ({ m: e.m, t: e.t, h: e.h, hi: e.hi }));
    const out = [], H = sp.hours;
    for (let i = 1; i < H.length - 1; i++) {
      const a = H[i - 1].tide, b = H[i].tide, c = H[i + 1].tide;
      if (!a || !b || !c) continue;
      if (b.h >= a.h && b.h > c.h) out.push({ m: toMin(H[i].t), t: H[i].t, h: b.h, hi: true });
      else if (b.h <= a.h && b.h < c.h) out.push({ m: toMin(H[i].t), t: H[i].t, h: b.h, hi: false });
    }
    return out;
  }

  // Smooth tide height samples [minute, metres] between m0 and m1: cosine between the
  // MSQ highs/lows (same maths as attachTide), or a smoothed hourly model as fallback.
  function tideSamples(sp, m0, m1, step = 15) {
    const ext = raw.tides && raw.tides[sp.spot.tidePort];
    const out = [];
    if (ext && ext.length > 1) {
      let k = 1;
      for (let m = m0; m <= m1; m += step) {
        while (k < ext.length && ext[k].m <= m) k++;
        if (k >= ext.length || ext[k - 1].m > m) continue;
        const a = ext[k - 1], b = ext[k], s = (1 - Math.cos((Math.PI * (m - a.m)) / (b.m - a.m))) / 2;
        out.push([m, a.h + (b.h - a.h) * s]);
      }
      return out;
    }
    const pts = sp.hours.filter((h) => h.tide).map((h) => [toMin(h.t), h.tide.h]);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ma, a] = pts[i], [mb, b] = pts[i + 1];
      if (mb < m0 || ma > m1 || mb - ma > 90) continue;
      for (let m = ma; m < mb; m += step) {
        const s = (1 - Math.cos((Math.PI * (m - ma)) / (mb - ma))) / 2;
        if (m >= m0 && m <= m1) out.push([m, a + (b - a) * s]);
      }
    }
    return out;
  }
  const smoothPath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');

  // Best daylight hour of a day (for the chart's per-day summary).
  function dayBest(list, d) {
    const sun = model.sun[d];
    const lo = sun ? toMin(sun.rise) - 30 : toMin(d + 'T05:00'), hi = sun ? toMin(sun.set) : toMin(d + 'T18:00');
    const dh = list.filter((h) => h.date === d && toMin(h.t) >= lo && toMin(h.t) <= hi);
    return dh.length ? dh.reduce((a, b) => (b.score > a.score + 1e-9 ? b : a)) : null;
  }

  function chartBlock(sp) {
    const today = nowStr().slice(0, 10);
    const hrs = sp.hours.filter((h) => h.date >= today);
    if (!hrs.length) return '';
    const PX = 12, DR = 34;
    const m0 = toMin(hrs[0].t), m1 = toMin(hrs[hrs.length - 1].t);
    const W = ((m1 - m0) / 60 + 1) * PX; // sized by time, so a missing hour leaves a gap instead of shifting everything
    const xm = (m) => ((m - m0) / 60) * PX + PX / 2; // time → x (hour centres)
    const hx = (h) => xm(toMin(h.t));
    const Y = { surf: 24, surfH: 104, per: 150, perH: 28, wind: 194, windH: 40, tide: 252, tideH: 60 };
    const H = Y.tide + Y.tideH + 4;
    const days = [...new Set(hrs.map((h) => h.date))];
    const nowM = toMin(nowStr()), nowX = xm(nowM), nowIn = nowM >= m0 && nowM <= m1 + 60;
    const daylight = (h) => { const s = model.sun[h.date], m = toMin(h.t); return !s || (m >= toMin(s.rise) - 30 && m <= toMin(s.set) + 15); };
    let svg = '';

    // daylight bands + sunrise/sunset glyphs
    const suns = [];
    days.forEach((d) => {
      const s = model.sun[d];
      if (!s) return;
      const xr = xm(toMin(s.rise)), xs = xm(toMin(s.set));
      svg += `<rect x="${xr.toFixed(1)}" y="0" width="${(xs - xr).toFixed(1)}" height="${H}" class="c-day"/>`;
      suns.push(xr, xs);
      svg += `<path d="M${(xr - 4).toFixed(1)} 13a4 4 0 0 1 8 0z" class="c-sun"/><path d="M${(xs - 4).toFixed(1)} 13a4 4 0 0 1 8 0z" class="c-sun set"/>`;
    });
    // lane rules
    [Y.per - 11, Y.wind - 9, Y.tide - 9].forEach((y) => (svg += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="c-rule"/>`));
    // hour ticks (skip where a sun glyph or the now pill sits)
    hrs.forEach((h, i) => {
      if (h.hour % 6 || h.hour === 0) return;
      const x = hx(h);
      if (suns.some((sx) => Math.abs(sx - x) < 11) || (nowIn && Math.abs(nowX - x) < 24)) return;
      svg += `<text x="${x}" y="13" text-anchor="middle" class="c-hr">${hourLbl(h.hour)}</text>`;
    });
    // midnight separators
    hrs.forEach((h, i) => { if (h.hour === 0 && i) svg += `<line x1="${hx(h) - PX / 2}" x2="${hx(h) - PX / 2}" y1="0" y2="${H}" class="c-sep"/>`; });

    // surf: sweet-spot band, grid, bars, daily best
    const maxSurf = Math.max(1.6, ...hrs.map((h) => h.surf)) * 1.1;
    const sy = (v) => Y.surf + Y.surfH - (v / maxSurf) * Y.surfH;
    const ticks = [0.5, 1, 1.5, 2, 2.5, 3, 4].filter((v) => v < maxSurf && sy(v) > Y.surf + 26);
    svg += `<rect x="0" y="${sy(R.size.idealHigh).toFixed(1)}" width="${W}" height="${(sy(R.size.idealLow) - sy(R.size.idealHigh)).toFixed(1)}" class="c-band"/>`;
    ticks.forEach((v) => (svg += `<line x1="0" x2="${W}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" class="c-grid"/>`));
    svg += `<line x1="0" x2="${W}" y1="${Y.surf + Y.surfH + 0.5}" y2="${Y.surf + Y.surfH + 0.5}" class="c-base"/>`;
    hrs.forEach((h, i) => {
      const y = Math.min(sy(h.surf), Y.surf + Y.surfH - 1.5);
      svg += `<rect x="${(hx(h) - PX / 2 + 1.5).toFixed(1)}" y="${y.toFixed(1)}" width="${PX - 3}" height="${(Y.surf + Y.surfH - y).toFixed(1)}" rx="1.5" fill="${colour(h)}"${daylight(h) ? '' : ' opacity=".32"'}/>`;
    });
    const bests = {};
    days.forEach((d) => {
      const top = dayBest(hrs, d);
      if (!top) return;
      bests[d] = top;
      const x = hx(top);
      svg += `<text x="${x}" y="${Math.max(Y.surf + 7, sy(top.surf) - 5).toFixed(1)}" text-anchor="middle" class="c-peak">${f1(top.surf)}</text>`;
    });

    // period: line + soft area, labelled twice a day
    const py = (p) => Y.per + Y.perH - ((clamp(p, 4, 16) - 4) / 12) * Y.perH;
    const pl = hrs.map((h, i) => `${i ? 'L' : 'M'}${hx(h)} ${py(h.period).toFixed(1)}`).join('');
    svg += `<path d="${pl}L${W - PX / 2} ${Y.per + Y.perH}L${PX / 2} ${Y.per + Y.perH}Z" class="c-per-a"/><path d="${pl}" class="c-per"/>`;
    hrs.forEach((h, i) => {
      if (h.hour !== 6 && h.hour !== 15) return;
      const x = hx(h), y = py(h.period);
      svg += `<circle cx="${x}" cy="${y.toFixed(1)}" r="1.8" class="c-per-d"/><text x="${x}" y="${(y - 5).toFixed(1)}" text-anchor="middle" class="c-num">${Math.round(h.period)}</text>`;
    });

    // wind: arrowheads every 2 h, scaled by speed, coloured by angle to the break
    hrs.forEach((h, i) => {
      if (h.hour % 2) return;
      const x = hx(h), cat = h.wI.cat, dim = daylight(h) ? '' : ' opacity=".45"';
      const k = clamp(0.75 + h.wind.s / 40, 0.75, 1.45).toFixed(2);
      svg += cat === 'glassy'
        ? `<circle cx="${x}" cy="${Y.wind + 10}" r="3" class="c-calm"${dim}/>`
        : `<path transform="translate(${x} ${Y.wind + 10}) rotate(${((h.wind.d + 180) % 360).toFixed(0)}) scale(${k})" d="M0 -6.5L4.6 5.5L0 2.8L-4.6 5.5Z" fill="${windCol(cat)}"${dim}/>`;
      svg += `<text x="${x}" y="${Y.wind + 33}" text-anchor="middle" class="c-num"${dim}>${Math.round(h.wind.s)}</text>`;
    });

    // tide: curve, fill, hi/lo turning points
    const ts = tideSamples(sp, m0, m1);
    const tv = ts.map((p) => p[1]);
    if (tv.length > 1) {
      const tlo = Math.min(...tv), thi = Math.max(...tv);
      const top = Y.tide + 14, bot = Y.tide + Y.tideH - 13;
      const ty = (v) => bot - ((v - tlo) / (thi - tlo || 1)) * (bot - top);
      const d = smoothPath(ts.map(([m, v]) => [xm(m), ty(v)]));
      const x0 = xm(ts[0][0]).toFixed(1), x1 = xm(ts[ts.length - 1][0]).toFixed(1);
      svg += `<defs><linearGradient id="tideFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--tide)" stop-opacity=".28"/><stop offset="1" stop-color="var(--tide)" stop-opacity=".02"/></linearGradient></defs>`;
      svg += `<path d="${d}L${x1} ${Y.tide + Y.tideH}L${x0} ${Y.tide + Y.tideH}Z" fill="url(#tideFill)"/><path d="${d}" class="c-tide"/>`;
      tideTurns(sp).filter((e) => e.m >= m0 && e.m <= m1).forEach((e) => {
        const x = xm(e.m), y = ty(clamp(e.h, tlo, thi));
        const anchor = x < 30 ? 'start' : x > W - 30 ? 'end' : 'middle';
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" class="c-tide-d"/>`;
        svg += `<text x="${x.toFixed(1)}" y="${(e.hi ? y - 6 : y + 12).toFixed(1)}" text-anchor="${anchor}" class="c-tide-t">${clock(e.t)} <tspan>${e.h.toFixed(1)}</tspan></text>`;
      });
    }

    // now: dim the past, accent line + pill
    if (nowIn) {
      svg += `<rect x="0" y="0" width="${nowX.toFixed(1)}" height="${H}" class="c-past"/>`;
      svg += `<line x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="14" y2="${H}" class="c-now"/>`;
      svg += `<rect x="${(nowX - 15).toFixed(1)}" y="2" width="30" height="13" rx="6.5" class="c-now-p"/><text x="${nowX.toFixed(1)}" y="11.4" text-anchor="middle" class="c-now-t">NOW</text>`;
    }

    // HTML day header row (labels stick to the left edge while scrolling)
    const dayRow = days.map((d) => {
      const n = hrs.filter((h) => h.date === d).length, b = bests[d];
      return `<div class="cd" style="width:${n * PX}px"><div class="cd-in"><b>${dayLabel(d).top}</b><span class="cd-d">${dayLabel(d).sub}</span>${b && n >= 14 ? `<span class="cd-r" style="--c:${colour(b)}">${label(b)}</span>` : ''}</div></div>`;
    }).join('');

    const lane = (name, unit, y, extra = '') => `<div class="cl" style="top:${DR + y - 1}px">${name}</div>${unit ? `<div class="cl-u" style="top:${DR + y + 10}px">${unit}</div>` : ''}${extra}`;
    const surfTicks = ticks.map((v) => `<div class="cl-t" style="top:${(DR + sy(v) - 6).toFixed(0)}px">${v}</div>`).join('');
    return `<figure class="chart-wrap" style="--dr:${DR}px">
      <div class="chart-scroll" data-now="${nowX.toFixed(0)}" tabindex="0" aria-label="7-day hourly chart, scroll sideways">
        <div class="chart-inner" style="width:${W}px">
          <div class="chart-days">${dayRow}</div>
          <svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hourly surf height, swell period, wind and tide for the next 7 days">${svg}</svg>
        </div>
      </div>
      <div class="chart-labels" aria-hidden="true">
        ${lane('Surf', 'm', Y.surf, surfTicks)}${lane('Period', 's', Y.per - 2)}${lane('Wind', 'km/h', Y.wind)}${lane('Tide', 'm', Y.tide)}
      </div>
    </figure>
    <div class="chart-key">
      <div class="key-row"><span class="key-k">Rating</span><span class="key-scale">${R.labels.map((l, i) => `<span><i style="background:var(--r${i + 1})"></i>${l}</span>`).join('')}<span><i style="background:var(--big)"></i>Too big</span></span></div>
      <div class="key-row"><span class="key-k">Wind</span><span class="key-wind">${[['offshore', 'Offshore'], ['cross', 'Cross'], ['onshore', 'Onshore']].map(([c, t]) => `<span><svg viewBox="-6 -7 12 13" aria-hidden="true"><path d="M0 -6.5L4.6 5.5L0 2.8L-4.6 5.5Z" transform="rotate(45)" fill="${windCol(c)}"/></svg>${t}</span>`).join('')}<span><svg viewBox="-6 -6 12 12" aria-hidden="true"><circle r="3" fill="${windCol('glassy')}"/></svg>Glassy</span></span></div>
      <p class="key-note">Arrows point where the wind blows. Shaded band is the ${R.size.idealLow}–${R.size.idealHigh}${TS}m longboard sweet spot; lighter columns are daylight.</p>
    </div>`;
  }

  const sunIcon = (set) => `<svg viewBox="0 0 16 12" aria-hidden="true"><path d="M3.5 9a4.5 4.5 0 0 1 9 0" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1 10.5h14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M8 ${set ? '1.2v2.6M6.4 2.4 8 3.9l1.6-1.5' : '3.9V1.2M6.4 2.7 8 1.2l1.6 1.5'}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const tideIcon = (hi) => `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="${hi ? 'M6 2.5 10 8H2z' : 'M6 9.5 10 4H2z'}" fill="currentColor"/></svg>`;

  // A day's tide as a smooth curve over the hours the table shows, highs/lows labelled.
  function tideDay(sp, rows, turns) {
    const m0 = toMin(rows[0].t), m1 = toMin(rows[rows.length - 1].t) + 30;
    if (m1 - m0 < 120) return '';
    // scale to the whole day so the curve keeps a true shape even on a short "today"
    const day = rows[0].date, all = tideSamples(sp, toMin(day), toMin(day) + 1440, 20);
    const ts = all.filter(([m]) => m >= m0 && m <= m1);
    if (ts.length < 3) return '';
    const vals = all.map((p) => p[1]), lo = Math.min(...vals), hi = Math.max(...vals);
    const X = (m) => ((m - m0) / (m1 - m0)) * 100, Y = (v) => 34 - ((v - lo) / (hi - lo || 1)) * 26; // 8…34 of 44
    const line = smoothPath(ts.map(([m, v]) => [X(m) * 10, Y(v)]));
    const marks = turns.filter((e) => e.m >= m0 && e.m <= m1).map((e) => {
      const x = X(e.m), y = Y(clamp(e.h, lo, hi));
      const al = x < 12 ? ' is-start' : x > 88 ? ' is-end' : '';
      return `<span class="td-dot" style="left:${x.toFixed(2)}%;top:${y.toFixed(1)}px"></span>`
        + `<span class="td-lbl${e.hi ? ' is-hi' : ' is-lo'}${al}" style="left:${x.toFixed(2)}%;top:${y.toFixed(1)}px">${e.hi ? 'High' : 'Low'} <b>${e.h.toFixed(1)}</b> ${clock(e.t)}</span>`;
    }).join('');
    const nowM = toMin(nowStr()), now = nowM > m0 && nowM < m1 ? `<span class="td-now" style="left:${X(nowM).toFixed(2)}%"></span>` : '';
    return `<div class="tday-tide" aria-hidden="true">
        <svg viewBox="0 0 1000 44" preserveAspectRatio="none"><path class="td-a" d="${line}L1000 44L0 44Z"/><path class="td-l" d="${line}" vector-effect="non-scaling-stroke"/></svg>
        ${now}${marks}
      </div>`;
  }

  function tableBlock(sp) {
    const today = nowStr().slice(0, 10);
    const nowH = nowStr().slice(0, 13);
    const days = [...new Set(sp.hours.map((h) => h.date))].filter((d) => d >= today);
    const turns = tideTurns(sp);
    const cols = '<colgroup><col class="c-t"><col class="c-r"><col class="c-s"><col class="c-w"><col class="c-wi"><col class="c-ti"></colgroup>';
    return `<div class="tbl-wrap">${days.map((d) => {
      const rows = sp.hours.filter((h) => h.date === d && h.hour >= C.ui.detailFromHour && h.hour <= C.ui.detailToHour
        && (d !== today || h.t.slice(0, 13) >= nowH));
      if (!rows.length) return '';
      const sun = model.sun[d];
      const first = toMin(rows[0].t), last = toMin(rows[rows.length - 1].t) + 59;
      const evs = [];
      if (sun) {
        evs.push({ m: toMin(sun.rise), html: `<span class="ev-sun"><i class="ev-ic">${sunIcon(false)}</i>Sunrise · ${clock(sun.rise)}</span>` });
        evs.push({ m: toMin(sun.set), html: `<span class="ev-sun"><i class="ev-ic">${sunIcon(true)}</i>Sunset · ${clock(sun.set)}</span>` });
      }
      turns.filter((e) => e.t.slice(0, 10) === d).forEach((e) => evs.push({ m: e.m, html: `<span class="ev-tide"><i class="ev-ic">${tideIcon(e.hi)}</i>${e.hi ? 'High' : 'Low'} tide ${e.h.toFixed(2)}${TS}m · ${clock(e.t)}</span>` }));
      const ev = evs.filter((e) => e.m > first && e.m <= last).sort((a, b) => a.m - b.m);
      const best = dayBest(rows, d) || rows.reduce((a, b) => (b.score > a.score + 1e-9 ? b : a));
      let body = '', k = 0;
      rows.forEach((h) => {
        const hm = toMin(h.t);
        while (k < ev.length && ev[k].m <= hm) body += `<tr class="ev"><td colspan="6">${ev[k++].html}</td></tr>`;
        const night = sun && (hm < toMin(sun.rise) - 30 || hm > toMin(sun.set) + 15);
        const isNow = h.t.slice(0, 13) === nowH;
        const s2 = h.sw2.h > 0.2 ? `<span class="s2">+${f1(h.sw2.h)} ${cmp(h.sw2.d)} ${U(Math.round(h.sw2.p), 's')}</span>` : '';
        body += `<tr class="${night ? 'night' : ''}${isNow ? ' now' : ''}${h === best ? ' best' : ''}">
          <td class="t">${isNow ? '<b>Now</b>' : hourLbl(h.hour)}</td>
          <td class="r" style="--c:${colour(h)}"><span>${label(h)}</span></td>
          <td class="surf">${f1(h.surf)}</td>
          <td class="sw">${f1(h.sw.h)} <span class="dir">${cmp(h.sw.d)}</span> ${U(Math.round(h.sw.p), 's')}${s2}</td>
          <td class="wind"><span style="color:${windCol(h.wI.cat)}">${arrow(h.wind.d, 'currentColor', 12)}</span>${Math.round(h.wind.s)}<span class="g">${Math.round(h.wind.g)}</span></td>
          <td class="tide">${h.tide ? `${f1(h.tide.h)}<span>${h.tide.rising ? '↑' : '↓'}</span>` : '–'}</td>
        </tr>`;
      });
      while (k < ev.length) body += `<tr class="ev"><td colspan="6">${ev[k++].html}</td></tr>`;
      return `<section class="tday">
        <header class="tday-h">
          <div class="tday-title"><h3>${dayLabel(d).top}</h3><span class="tday-d">${dayLabel(d).sub}</span>
            <span class="tday-best" style="--c:${colour(best)}">Best <b>${label(best)}</b> ${hourLbl(best.hour)}</span></div>
          ${ui.view === 'table' ? tideDay(sp, rows, turns) : ''}
          <div class="tcols" aria-hidden="true"><span>Time</span><span>Rating</span><span>Surf</span><span>Swell</span><span>Wind<i>km/h</i></span><span>Tide<i>m</i></span></div>
        </header>
        <table class="tbl">${cols}
          <thead class="sr"><tr><th>Time</th><th>Rating</th><th>Surf (m)</th><th>Swell</th><th>Wind and gust (km/h)</th><th>Tide (m)</th></tr></thead>
          <tbody>${body}</tbody></table>
      </section>`;
    }).join('')}</div>`;
  }

  /* ================================================================
     EVENTS
     ================================================================ */
  let homeScroll = 0, cameFromHome = false;
  document.addEventListener('click', (e) => {
    const t = e.target;
    const fav = t.closest('[data-fav]');
    if (fav) {
      toggleFav(fav.dataset.fav);
      const on = isFav(fav.dataset.fav);
      document.querySelectorAll(`[data-fav="${fav.dataset.fav}"]`).forEach((b) => {
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', b.getAttribute('aria-label').replace(/^(Add|Remove)(.*) (to|from) favourites$/, (_, a, n) => `${on ? 'Remove' : 'Add'}${n} ${on ? 'from' : 'to'} favourites`));
      });
      if (model) renderHome(); // re-pin the lineup
      return;
    }
    const flat = t.closest('[data-flat-toggle]');
    if (flat) { haptic(); ui.flatOpen = !ui.flatOpen; renderHome(); return; }
    const reg = t.closest('.region button');
    if (reg) { if (reg.dataset.region !== ui.region) haptic(); ui.region = reg.dataset.region; store.set('dawnie:region', ui.region); ui.day = 0; renderHome(); swapIn(); return; }
    const day = t.closest('.day');
    if (day) { if (+day.dataset.i !== ui.day) { haptic(); ui.day = +day.dataset.i; renderHome(); swapIn(); } return; }
    const spot = t.closest('[data-spot]');
    if (spot && !$('#home').hidden) { markSource(spot); homeScroll = window.scrollY; cameFromHome = true; location.hash = `#/spot/${spot.dataset.spot}`; return; }
    if (t.closest('#back')) {
      // only step back in history if we navigated here from the home screen; otherwise go home
      if (cameFromHome) { cameFromHome = false; history.back(); } else location.hash = '';
      return;
    }
    const v = t.closest('[data-view]');
    if (v) {
      if (v.dataset.view !== ui.view) haptic();
      ui.view = v.dataset.view; store.set('dawnie:view', ui.view);
      const m = location.hash.match(/^#\/spot\/([\w-]+)/);
      const sp = m && model.spots.find((s) => s.spot.id === m[1]);
      if (sp) renderDetail(sp);
      return;
    }
    if (t.closest('#refresh') || t.closest('[data-retry]')) load(true);
  });
  window.addEventListener('hashchange', () => {
    const toDetail = location.hash.startsWith('#/spot/');
    navTransition(toDetail, () => {
      route();
      window.scrollTo(0, toDetail ? 0 : homeScroll);
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && raw && Date.now() - (raw.fetchedAt || 0) > C.ui.cacheMinutes * 60e3) load(true);
  });

  /* ================================================================
     FEEL — splash, haptics, view transitions, pull-to-refresh, day swipe
     ================================================================ */
  function dismissSplash() {
    const el = document.getElementById('splash');
    if (!el || el.classList.contains('is-out')) return;
    requestAnimationFrame(() => el.classList.add('is-out'));
    setTimeout(() => el.remove(), 700);
  }

  // One light tick. Android: Vibration API. iOS 18+ Safari: toggling a native <input switch> fires the system haptic.
  const hapticLabel = $('.haptic');
  function haptic() {
    try {
      if (navigator.vibrate) { if (!navigator.userActivation || navigator.userActivation.hasBeenActive) navigator.vibrate(8); }
      else if (hapticLabel) hapticLabel.click();
    } catch { /* not available */ }
  }
  if (hapticLabel) hapticLabel.addEventListener('click', (e) => e.stopPropagation());

  // Spot card <-> spot page. The tapped name morphs into the detail title (and back).
  let vtSource = null; // { id, hero }
  function markSource(el) { vtSource = { id: el.dataset.spot, hero: el.id === 'hero' }; }
  const nameEl = (src) => src && (src.hero ? $(`#hero[data-spot="${src.id}"] .hero-name`)
    : $(`#ranking [data-spot="${src.id}"] .name`));
  const tag = (el, n) => { if (el) el.style.viewTransitionName = n; };
  const untag = () => document.querySelectorAll('.hero-name, .row .name, .d-title').forEach((el) => (el.style.viewTransitionName = ''));

  function navTransition(toDetail, update) {
    const motion = !reduceMotion();
    if (motion && document.startViewTransition && model) {
      untag();
      tag(toDetail ? nameEl(vtSource) : $('#detail .d-title'), 'spot-name');
      const vt = document.startViewTransition(() => {
        untag();
        update();
        tag(toDetail ? $('#detail .d-title') : nameEl(vtSource), 'spot-name');
      });
      vt.ready.catch(() => {}); vt.updateCallbackDone.catch(() => {});
      vt.finished.then(untag, untag);
      return;
    }
    update();
    if (!motion) return;
    const v = toDetail ? $('#detail') : $('#home');
    v.classList.remove('view-in', 'view-back'); void v.offsetWidth;
    v.classList.add(toDetail ? 'view-in' : 'view-back');
    v.addEventListener('animationend', () => v.classList.remove('view-in', 'view-back'), { once: true });
  }

  // Touch gestures on the home view: pull down at the top to refresh; swipe sideways over the hero/lineup to change morning.
  const ptr = $('#ptr');
  const PTR_MAX = 96, PTR_TRIGGER = 64, SWIPE_MIN = 56;
  let g = null, suppressClick = false;
  const swipeEls = () => [$('#hero'), $('#ranking')];
  const ptrShow = (d) => {
    const p = clamp(d / PTR_TRIGGER, 0, 1);
    ptr.style.opacity = String(Math.min(1, p * 1.4));
    ptr.style.transform = `translateY(${d - 40}px) rotate(${d * 2.2}deg) scale(${0.8 + p * 0.2})`;
    ptr.style.setProperty('--p', String(Math.round(p * 82)));
    ptr.classList.toggle('is-armed', p >= 1);
  };
  const ptrHide = () => {
    ptr.classList.add('is-settling');
    ptr.classList.remove('is-armed', 'is-loading');
    ptr.style.opacity = '0'; ptr.style.transform = '';
    setTimeout(() => ptr.classList.remove('is-settling'), 400);
  };

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || $('#home').hidden || !model) { g = null; return; }
    const t = e.touches[0];
    g = {
      x: t.clientX, y: t.clientY, mode: null, d: 0, dx: 0,
      top: window.scrollY <= 0 && !ptr.classList.contains('is-loading'),
      swipe: !!e.target.closest('#hero, #ranking'),
    };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!g) return;
    const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (g.swipe && Math.abs(dx) > Math.abs(dy) * 1.4) g.mode = 'swipe';
      else if (g.top && dy > 0 && dy > Math.abs(dx) && window.scrollY <= 0) g.mode = 'pull';
      else { g = null; return; } // ordinary scroll: leave it alone
      if (g.mode === 'swipe') swipeEls().forEach((el) => el.classList.add('is-dragging'));
    }
    if (g.mode === 'pull') {
      if (e.cancelable) e.preventDefault();
      g.d = Math.min(PTR_MAX, Math.max(0, dy) * 0.5); // resistance
      ptrShow(g.d);
      if (g.d >= PTR_TRIGGER && !g.armed) { g.armed = true; haptic(); }
      else if (g.d < PTR_TRIGGER) g.armed = false;
    } else {
      const n = document.querySelectorAll('#days .day').length;
      const edge = (dx > 0 && ui.day === 0) || (dx < 0 && ui.day >= n - 1);
      g.dx = dx;
      const off = edge ? dx * 0.15 : dx * 0.4;
      swipeEls().forEach((el) => { el.style.transform = `translateX(${off}px)`; el.style.opacity = String(1 - Math.min(0.35, Math.abs(off) / 400)); });
    }
  }, { passive: false });

  const endGesture = () => {
    if (!g || !g.mode) { g = null; return; }
    suppressClick = true; setTimeout(() => (suppressClick = false), 60);
    if (g.mode === 'pull') {
      if (g.d >= PTR_TRIGGER && !net.busy) {
        ptr.classList.add('is-settling', 'is-loading');
        ptr.style.transform = `translateY(${PTR_TRIGGER - 24}px)`;
        load(true).finally(() => setTimeout(ptrHide, 250));
      } else ptrHide();
    } else {
      const n = document.querySelectorAll('#days .day').length;
      const dir = g.dx <= -SWIPE_MIN ? 1 : g.dx >= SWIPE_MIN ? -1 : 0;
      const next = ui.day + dir;
      swipeEls().forEach((el) => { el.classList.remove('is-dragging'); el.style.transform = ''; el.style.opacity = ''; });
      if (dir && next >= 0 && next < n) {
        haptic();
        ui.day = next;
        renderHome();
        if (!reduceMotion()) swipeEls().forEach((el) => {
          el.classList.remove('slide-from-r', 'slide-from-l', 'swap'); void el.offsetWidth;
          el.classList.add(dir > 0 ? 'slide-from-r' : 'slide-from-l');
          el.addEventListener('animationend', () => el.classList.remove('slide-from-r', 'slide-from-l'), { once: true });
        });
      }
    }
    g = null;
  };
  document.addEventListener('touchend', endGesture, { passive: true });
  document.addEventListener('touchcancel', endGesture, { passive: true });
  // a drag must never also count as a tap on the row/hero underneath
  document.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);

  // first paint: skeletons shaped like the real layout, so nothing jumps when data lands
  const sk = (w, h, extra = '') => `<span class="skel" style="width:${w};height:${h}px;${extra}"></span>`;
  if (!store.get('dawnie:data:v1')) {
    $('#days').innerHTML = Array.from({ length: 3 }, () => `<div class="day sk-day" aria-hidden="true">${sk('54%', 10)}${sk('72%', 14, 'margin-top:8px')}</div>`).join('');
    $('#hero').innerHTML = `<div class="hero-in sk-hero" aria-hidden="true">${sk('38%', 11)}${sk('52%', 50, 'margin-top:20px;border-radius:12px')}${sk('46%', 22, 'margin-top:10px')}${sk('82%', 12, 'margin-top:16px')}${sk('64%', 12, 'margin-top:7px')}
      <div class="sk-stats">${Array.from({ length: 4 }, () => `<div>${sk('60%', 9)}${sk('78%', 17, 'margin-top:8px')}</div>`).join('')}</div></div>`;
    $('#ranking').innerHTML = Array.from({ length: 5 }, (_, i) => `<li class="row sk-row" aria-hidden="true" style="--i:${i}"><span class="rank">${String(i + 1).padStart(2, '0')}</span>${sk(`${58 - i * 5}%`, 15)}${sk('64px', 24, 'border-radius:999px')}<span class="sk-why">${sk('88%', 11)}${sk('100%', 4, 'margin-top:12px;border-radius:2px')}</span></li>`).join('');
    $('#buoys').innerHTML = buoySkel();
  }
  renderUpdated();
  renderSources();
  load(false);

  // Online/offline: reflect it straight away, and catch up when the connection returns.
  window.addEventListener('offline', () => { renderUpdated(); renderSources(); });
  window.addEventListener('online', () => {
    renderUpdated(); renderSources();
    if (!raw || net.failed || Date.now() - (raw.fetchedAt || 0) > C.ui.cacheMinutes * 60e3) load(true);
  });
  // Let the refresh icon finish its turn instead of snapping back mid-rotation.
  $('#refresh').addEventListener('animationiteration', (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.stop) { delete btn.dataset.stop; btn.classList.remove('spin'); }
  });
  // Keep relative times ("3 h ago") honest while the app sits open.
  setInterval(() => { if (model && !document.hidden && !net.busy) { renderUpdated(); renderBuoys(); renderSources(); } }, 60e3);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
