/* =============================================================================
   DAWNIE — CONFIG
   -----------------------------------------------------------------------------
   Everything you might want to tweak lives in this one file:
     1. RATING  – how a forecast hour is turned into a 1–5 rating
     2. SPOTS   – each break: where it is, which way it faces, what it likes
     3. BUOYS   – Queensland Government wave buoys shown in "Buoy check"
     4. TIDES   – Maritime Safety Queensland tide prediction tables
     5. UI      – display defaults

   All directions are compass degrees (0 = N, 90 = E, 180 = S, 270 = W).
   Swell and wind directions are where they come FROM (meteorological).
   Heights are metres, speeds km/h, periods seconds.
   ============================================================================= */

window.DAWNIE = {

  /* ===========================================================================
     1. RATING RULES  (tuned for a learning longboarder on a 9'6")
     ---------------------------------------------------------------------------
     Each forecast hour gets five sub-scores between 0 (bad) and 1 (perfect):
       size   – estimated wave height at the break
       period – swell period (longer = cleaner, more push, wraps better)
       wind   – speed and angle relative to the break's offshore direction
       tide   – how close the tide is to what the break likes
       chop   – penalty when wind-waves are large compared with the swell
     They are combined like this:
       score = size^W.size × wind^W.wind × (P0 + (1-P0)×period) × (T0 + (1-T0)×tide) × (1 - chop)
     Size and wind are multiplied (not added) on purpose: no waves or a
     howling onshore ruins a session no matter how good everything else is.
     =========================================================================== */
  rating: {

    /* --- Wave SIZE at the break (m). Piecewise: below `min` = flat,
           `idealLow`–`idealHigh` = perfect, fades out to `hardMax`. */
    size: {
      min: 0.3,        // anything smaller is basically flat
      idealLow: 0.4,   // start of the sweet spot (knee–waist on a 9'6")
      idealHigh: 1.0,  // end of the sweet spot (learner on a 9'6")
      max: 1.3,        // still fun, getting solid
      hardMax: 1.7,    // beyond this: too big for a learning longboarder
                       // (a spot can set its own lower `maxSize`, e.g. Kirra)
    },

    /* --- Swell PERIOD (s) → score. Points are [period, score], linear between. */
    period: [[4, 0.05], [6, 0.2], [8, 0.5], [10, 0.82], [12, 1], [16, 1]],

    /* How big the period effect is. 0.25 means even the worst period keeps
       25 % of the score (a short-period day can still be fun if it's clean). */
    periodFloor: 0.25,

    /* Point breaks need period to wrap: swell reaching a 'point' is multiplied
       by clamp((period - from) / range, floor, 1). 6 s ≈ 30 %, 10 s+ = 100 %. */
    pointWrap: { from: 6, range: 4, floor: 0.3 },

    /* Longer period swell shows bigger on the beach. Multiplies the open-ocean
       swell height: factor = clamp(base + perSecond × period, lo, hi). */
    periodSizeBoost: { base: 0.7, perSecond: 0.03, lo: 0.85, hi: 1.15 },

    /* --- WIND. `angle` is the difference between the wind direction and the
           break's offshore direction (0° = dead offshore, 180° = dead onshore). */
    wind: {
      glassy: 6,               // km/h — below this it's glassy whatever the direction
      light: 12,               // km/h — light enough that direction barely matters
      offshoreMaxAngle: 50,    // within this of offshore = offshore
      crossMaxAngle: 110,      // within this = cross-shore; beyond = onshore
      offshoreTooStrong: 22,   // strong offshore makes paddling in hard on a longboard
      crossBlownOut: 28,       // cross-shore speed that ruins it
      onshoreBlownOut: 20,     // onshore speed that ruins it
      lightOnshore: 0.7,       // score for light onshore (still a bit mushy)
      gustPenaltyFrom: 35,     // gusts above this knock a little off
    },

    /* --- Wind-wave CHOP. ratio = wind-wave height reaching the break / surf height */
    chop: { startRatio: 0.35, fullRatio: 1.0, maxPenalty: 0.35 },

    /* --- TIDE. Tide level is normalised 0 (that day's low) to 1 (high).
           Each break's `tide` preference sets the target; `tideFloor` caps
           how much a wrong tide can hurt. */
    tideTargets: { low: 0.2, mid: 0.5, high: 0.8, lowmid: 0.35, midhigh: 0.65 },
    tideFloor: 0.8,

    /* --- Exponents for the multiplied parts (bigger = matters more). */
    weights: { size: 1.0, wind: 0.8 },

    /* --- SWELL DIRECTION. Each spot has an `ideal` swell direction and a
           `spread` either side that still works fully-ish. Outside the spread
           the swell fades to nothing over `fadeBeyond` degrees. */
    swellDir: { edgeFactor: 0.7, fadeBeyond: 50 },

    /* --- Score → rating. Score thresholds for ratings 2, 3, 4, 5.
           Epic is deliberately rare. */
    thresholds: [0.18, 0.38, 0.6, 0.85],
    labels: ['Poor', 'Fair', 'Good', 'Great', 'Epic'],

    /* --- MORNING WINDOW used on the home screen: first light → endHour.
           First light = sunrise minus `firstLightBeforeSunrise` minutes. */
    morning: { firstLightBeforeSunrise: 25, endHour: 10 },
  },

  /* ===========================================================================
     2. SPOTS
     ---------------------------------------------------------------------------
     lat/lon      take-off zone
     faces        direction you look when facing the waves (degrees)
     offshore     wind direction (FROM) that's dead offshore
     swell.ideal  best swell direction (FROM); swell.spread = ± degrees that work
     sizeFactor   how much of the open-ocean swell actually reaches the break
                  (wrapping points like Noosa only get part of it)
     tide         low | lowmid | mid | midhigh | high | all
     buoy         nearest Qld Govt wave buoy (see BUOYS)
     tidePort     key into TIDES
     =========================================================================== */
  spots: [
    // ---------------- Sunshine Coast ----------------
    { id: 'first-point', name: 'Noosa First Point', short: 'First Point', region: 'sc', type: 'point',
      lat: -26.38420, lon: 153.09060, faces: 20, offshore: 180,
      swell: { ideal: 75, spread: 30 }, sizeFactor: 0.55, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: 'The longboard mecca. Needs E–NE swell to wrap the headland; loves SE winds.' },

    { id: 'tea-tree', name: 'Tea Tree Bay', short: 'Tea Tree', region: 'sc', type: 'point',
      lat: -26.37830, lon: 153.10230, faces: 15, offshore: 180,
      swell: { ideal: 70, spread: 30 }, sizeFactor: 0.6, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: 'Long peeling rights inside the national park. E–NE swell, SE wind is offshore-ish.' },

    { id: 'nationals', name: 'National Park', short: 'Nationals', region: 'sc', type: 'point',
      lat: -26.38060, lon: 153.09750, faces: 10, offshore: 190,
      swell: { ideal: 75, spread: 30 }, sizeFactor: 0.58, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: 'Sand-bottom right point between First Point and Tea Tree. E–NE swell, SE winds.' },

    { id: 'moffat', name: 'Moffat Beach', short: 'Moffat', region: 'sc', type: 'point',
      lat: -26.79060, lon: 153.14270, faces: 60, offshore: 240,
      swell: { ideal: 120, spread: 35 }, sizeFactor: 0.85, tide: 'mid',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: 'Rocky right point. SE swell, best on SW–W winds.' },

    { id: 'alex', name: 'Alexandra Headland', short: 'Alex', region: 'sc', type: 'point',
      lat: -26.67250, lon: 153.11000, faces: 70, offshore: 250,
      swell: { ideal: 110, spread: 35 }, sizeFactor: 0.85, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: 'Right off the headland into the beach. SE–E swell, W winds offshore.' },

    { id: 'happys', name: 'Happys', short: 'Happys', region: 'sc', type: 'beach',
      lat: -26.79950, lon: 153.14400, faces: 85, offshore: 265,
      swell: { ideal: 115, spread: 35 }, sizeFactor: 0.9, tide: 'lowmid',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: 'Friendly reef/sand peaks at Happy Valley. SE swell, W winds.' },

    { id: 'kings', name: 'Kings Beach', short: 'Kings', region: 'sc', type: 'beach',
      lat: -26.80450, lon: 153.14450, faces: 120, offshore: 300,
      swell: { ideal: 110, spread: 35 }, sizeFactor: 0.9, tide: 'mid',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: 'Open beach peaks. Picks up E–SE swell, wants NW–W winds.' },

    // ---------------- Gold Coast ----------------
    { id: 'currumbin', name: 'Currumbin Alley', short: 'Currumbin', region: 'gc', type: 'point',
      lat: -28.12780, lon: 153.48600, faces: 35, offshore: 210,
      swell: { ideal: 120, spread: 35 }, sizeFactor: 0.75, tide: 'lowmid',
      buoy: 'Palm Beach Mk4', tidePort: 'goldcoast',
      note: 'Soft, rolling rights at the creek mouth — a classic learner longboard wave.' },

    { id: 'rainbow', name: 'Rainbow Bay', short: 'Rainbow', region: 'gc', type: 'point',
      lat: -28.16550, lon: 153.54700, faces: 15, offshore: 200,
      swell: { ideal: 120, spread: 35 }, sizeFactor: 0.75, tide: 'mid',
      buoy: 'Palm Beach Mk4', tidePort: 'goldcoast',
      note: 'Long rights off Snapper/Greenmount. SE swell and SE–S winds.' },

    { id: 'burleigh', name: 'Burleigh Heads', short: 'Burleigh', region: 'gc', type: 'point',
      lat: -28.08850, lon: 153.45500, faces: 45, offshore: 220,
      swell: { ideal: 115, spread: 35 }, sizeFactor: 0.85, tide: 'mid',
      buoy: 'Gold Coast Mk4', tidePort: 'goldcoast',
      note: 'Fast barrelling right point. Best small for longboards; SE–S winds.' },

    { id: 'kirra', name: 'Kirra', short: 'Kirra', region: 'gc', type: 'point',
      lat: -28.16750, lon: 153.52450, faces: 30, offshore: 200,
      swell: { ideal: 120, spread: 30 }, sizeFactor: 0.75, tide: 'mid',
      buoy: 'Palm Beach Mk4', tidePort: 'goldcoast',
      note: 'World-class right. Needs SE swell to wrap; small days suit a longboard.' },

    { id: 'narrowneck', name: 'Narrowneck', short: 'Narrowneck', region: 'gc', type: 'reef',
      lat: -28.01090, lon: 153.43420, faces: 90, offshore: 270,
      swell: { ideal: 110, spread: 40 }, sizeFactor: 0.9, tide: 'mid',
      buoy: 'Gold Coast Mk4', tidePort: 'goldcoast',
      note: 'Artificial reef and beach banks in Main Beach. Open to E–SE swell, W winds.' },
  ],

  /* ===========================================================================
     3. BUOYS — Qld Government Coastal Data System (near real-time).
     There is no Noosa buoy in the live feed; Mooloolaba is the closest.
     `site` must match the Site name in the government feed exactly.
     =========================================================================== */
  buoys: [
    { site: 'Mooloolaba',     name: 'Mooloolaba',  region: 'sc', lat: -26.56743, lon: 153.18136 },
    { site: 'Caloundra',      name: 'Caloundra',   region: 'sc', lat: -26.84746, lon: 153.15433 },
    { site: 'Gold Coast Mk4', name: 'Gold Coast',  region: 'gc', lat: -27.96573, lon: 153.44159 },
    { site: 'Palm Beach Mk4', name: 'Palm Beach',  region: 'gc', lat: -28.09977, lon: 153.48631 },
  ],
  waveResourceId: '2bbef99e-9974-49b9-a316-57402b00609c',

  /* ===========================================================================
     4. TIDES — Maritime Safety Queensland predicted high/low tables on
     data.qld.gov.au (heights above Lowest Astronomical Tide, AEST).
     Add next year's resource id when MSQ publishes it.
     =========================================================================== */
  tides: {
    mooloolaba: { name: 'Mooloolaba', resources: {
      2026: '58920636-0eb3-419f-bc28-68e1d0b88c82',
      2027: '3b846b9c-09b2-47f4-b1a8-07a8da59d355' } },
    goldcoast: { name: 'Gold Coast Seaway', resources: {
      2026: '94a28942-b589-4c41-849c-619bae60f2ba',
      2027: '784e567b-e780-490d-acea-919c52bbf274' } },
  },

  /* ===========================================================================
     5. UI
     =========================================================================== */
  ui: {
    defaultRegion: 'sc',
    detailView: 'charts',   // 'charts' (charts + table) or 'table'
    detailFromHour: 4,      // hourly table shows 4am…
    detailToHour: 19,       // …to 7pm
    cacheMinutes: 20,       // re-use data younger than this without refetching
  },
};
