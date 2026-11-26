/* =============================================================================
   DAWNIE — CONFIG
   -----------------------------------------------------------------------------
   Everything you might want to tweak lives in this one file:
     1. RATING  – how a forecast hour is turned into a 1–5 rating
     2. SPOTS   – each break: where it is, which way it faces, what it likes
     3. BUOYS   – Queensland Government wave buoys shown in "Buoy check"
     4. TIDES   – Maritime Safety Queensland tide prediction tables
     5. OUTLOOK – 16-day length, "days to watch", model confidence
     6. MAPS    – spot map and Windy view positions
     7. UI      – display defaults

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

    /* Point breaks need period to wrap. The period factor is
       clamp((period - from) / range, floor, 1): 6 s ≈ 30 %, 10 s+ = 100 %.
       Each point's `wrap` (0–1) sets how much that factor applies there:
       swell × (1 − wrap × (1 − factor)). Noosa needs long period (high wrap);
       the Gold Coast points take short-period E swell well (low wrap). */
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
     wrap         points only: 0–1, how much short-period swell is lost wrapping in
                  (1 = full pointWrap penalty, 0 = none; default 1)
     maxSize      optional: break height (m) above which it's 'Too big' for you here
     buoy         nearest Qld Govt wave buoy (see BUOYS)
     tidePort     key into TIDES
     =========================================================================== */
  spots: [
    // ---------------- Sunshine Coast ----------------
    // Coordinates: OpenStreetMap features + wannasurf GPS, take-off offset by hand (±50–150 m).
    { id: 'first-point', name: 'First Point, Noosa Heads', short: 'Noosa First Pt', region: 'sc', type: 'point',
      lat: -26.38420, lon: 153.09430, faces: 355, offshore: 180,
      swell: { ideal: 80, spread: 40 }, wrap: 0.7, sizeFactor: 0.55, tide: 'all',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      log: "Long, soft right that peels for ages",
      note: 'The longboard mecca. Sand-bottom right that needs E–NE swell to wrap the headland. Glassy in SE–S winds; NE wind blows it out.' },

    { id: 'boiling-pot', name: 'Boiling Pot, Noosa National Park', short: 'Boiling Pot', region: 'sc', type: 'point',
      lat: -26.38055, lon: 153.09805, faces: 350, offshore: 175,
      swell: { ideal: 80, spread: 40 }, wrap: 0.7, sizeFactor: 0.58, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: 'Rocky little point between First Point and Nationals. Needs E–NE swell to wrap; clean in SE–S winds. Rocks close in: a small-day wave for a learner.' },

    { id: 'nationals', name: 'Noosa National Park', short: 'Noosa Nationals', region: 'sc', type: 'point',
      lat: -26.37890, lon: 153.10040, faces: 340, offshore: 170,
      swell: { ideal: 80, spread: 40 }, wrap: 0.7, sizeFactor: 0.62, tide: 'lowmid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      log: "Long walls when the swell lines up",
      note: 'Most consistent of the inner points, from Boiling Pot towards Little Cove. Holds more swell than First Point; sheltered in SE winds.' },

    { id: 'tea-tree', name: 'Tea Tree Bay, Noosa National Park', short: 'Tea Tree Bay', region: 'sc', type: 'point',
      lat: -26.37800, lon: 153.10690, faces: 330, offshore: 160,
      swell: { ideal: 75, spread: 40 }, wrap: 0.7, sizeFactor: 0.6, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      log: "Gentle, peeling right in a sheltered bay",
      note: 'Long, gentle right over rock and sand into the bay. Needs E–NE swell, protected from SE winds. Busy with loggers when on.' },

    { id: 'alex', name: 'Alexandra Headland', short: 'Alex Headland', region: 'sc', type: 'point',
      lat: -26.67150, lon: 153.11250, faces: 45, offshore: 225,
      swell: { ideal: 120, spread: 50 }, wrap: 0.3, sizeFactor: 0.85, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      log: "Mellow right point on small swells",
      note: 'Right off the bluff into Alex beach plus beach peaks. Likes SE groundswell; SE wind is cross-shore, so go early or in S–SW winds.' },

    { id: 'moffat', name: 'Moffat Beach', short: 'Moffat', region: 'sc', type: 'point',
      lat: -26.79010, lon: 153.14670, faces: 55, offshore: 235,
      swell: { ideal: 105, spread: 50 }, wrap: 0.3, sizeFactor: 0.85, tide: 'all',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      log: "Soft rights off the point",
      note: 'Soft, peeling rights over a sloping rock shelf — a logger favourite. E or wrapping SE swell; some shelter in S–SE winds.' },

    { id: 'kings', name: 'Kings Beach, Caloundra', short: 'Kings Beach', region: 'sc', type: 'beach',
      lat: -26.80500, lon: 153.14180, faces: 135, offshore: 315,
      swell: { ideal: 140, spread: 50 }, sizeFactor: 0.9, tide: 'all',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: "Caloundra's swell magnet: A-frames on SE swell. Needs NW–W wind, so go early before the SE sea breeze." },

    { id: 'happys', name: 'Happy Valley, Caloundra', short: 'Happy Valley', region: 'sc', type: 'beach',
      lat: -26.80900, lon: 153.13700, faces: 140, offshore: 320,
      swell: { ideal: 150, spread: 45 }, sizeFactor: 0.8, tide: 'mid',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: 'Cruisy lefts on the channel-mouth banks at Happy Valley. Needs SE–S swell and N–NW wind. Banks shift since the 2022 Bribie breakthrough; watch run-out currents.' },

    // ---- From Surfline favourites (added 24/11/2026). Settings are estimates from the coastline, not measured. ----
    { id: 'teewah', name: 'Teewah Beach', short: 'Teewah', region: 'sc', type: 'beach',
      lat: -26.27777, lon: 153.06754, faces: 95, offshore: 275,
      swell: { ideal: 105, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Long open beach north of Noosa, 4WD access only. Picks up everything; best on light W winds early." },

    { id: 'noosa-north-shore', name: 'Noosa North Shore Beach', short: 'Noosa Nth Shore', region: 'sc', type: 'beach',
      lat: -26.37111, lon: 153.07377, faces: 60, offshore: 240,
      swell: { ideal: 100, spread: 50 }, sizeFactor: 0.85, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Open beach across the river from Noosa (ferry or 4WD). Banks shift with the river; clean in light W\u2013SW winds." },

    { id: 'noosa-bar', name: 'Noosa River Bar, Noosa Heads', short: 'Noosa Bar', region: 'sc', type: 'beach',
      lat: -26.38018, lon: 153.08124, faces: 35, offshore: 215,
      swell: { ideal: 75, spread: 40 }, sizeFactor: 0.5, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "River-mouth sandbar at the west end of Main Beach. Strong tidal currents on the run-out; best on the incoming tide." },

    { id: 'noosa-main', name: 'Main Beach, Noosa Heads', short: 'Noosa Main', region: 'sc', type: 'beach',
      lat: -26.38529, lon: 153.09022, faces: 5, offshore: 185,
      swell: { ideal: 75, spread: 40 }, sizeFactor: 0.4, tide: 'all',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      log: "Soft, forgiving and patrolled",
      note: "Sheltered north-facing beach below Hastings St. Gentle and patrolled: the easiest wave in Noosa when the points are small." },

    { id: 'granite-bay', name: 'Granite Bay, Noosa National Park', short: 'Granite Bay', region: 'sc', type: 'point',
      lat: -26.37787, lon: 153.11216, faces: 20, offshore: 200,
      swell: { ideal: 80, spread: 40 }, wrap: 0.6, maxSize: 1.2, sizeFactor: 0.65, tide: 'lowmid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Outer Noosa point, a walk through the National Park. Rocky, faster and heavier than the inner points; needs E\u2013NE swell." },

    { id: 'alexandria-bay', name: 'Alexandria Bay, Noosa National Park', short: 'Alexandria Bay', region: 'sc', type: 'beach',
      lat: -26.38384, lon: 153.11696, faces: 80, offshore: 260,
      swell: { ideal: 100, spread: 50 }, maxSize: 1.2, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Exposed beach on the Noosa headland, a 20-minute walk in. Takes all swell; strong rips and no patrol." },

    { id: 'sunshine-beach', name: 'Sunshine Beach', short: 'Sunshine Beach', region: 'sc', type: 'beach',
      lat: -26.40794, lon: 153.11364, faces: 90, offshore: 270,
      swell: { ideal: 100, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Open east-facing beach south of Noosa. Consistent banks; best early before the NE sea breeze." },

    { id: 'castaways', name: 'Castaways Beach', short: 'Castaways', region: 'sc', type: 'beach',
      lat: -26.43194, lon: 153.10851, faces: 95, offshore: 275,
      swell: { ideal: 100, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Quiet open beach between Sunshine and Peregian. Unpatrolled; needs light W winds." },

    { id: 'peregian', name: 'Peregian Beach', short: 'Peregian', region: 'sc', type: 'beach',
      lat: -26.48034, lon: 153.09983, faces: 95, offshore: 275,
      swell: { ideal: 100, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Long open beach with shifting banks and a patrolled area. Clean in W\u2013SW winds." },

    { id: 'point-arkwright', name: 'Point Arkwright, Yaroomba', short: 'Pt Arkwright', region: 'sc', type: 'point',
      lat: -26.54599, lon: 153.10491, faces: 70, offshore: 250,
      swell: { ideal: 100, spread: 50 }, wrap: 0.3, maxSize: 1.2, sizeFactor: 0.9, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Rocky headland between Yaroomba and Coolum. Rocks everywhere; best on smaller swells with W winds." },

    { id: 'yaroomba', name: 'Yaroomba Beach', short: 'Yaroomba', region: 'sc', type: 'beach',
      lat: -26.54999, lon: 153.10266, faces: 90, offshore: 270,
      swell: { ideal: 100, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Open beach north of Coolum. Banks near Point Arkwright; quiet and unpatrolled." },

    { id: 'coolum', name: 'Coolum Beach', short: 'Coolum', region: 'sc', type: 'beach',
      lat: -26.53127, lon: 153.09435, faces: 75, offshore: 255,
      swell: { ideal: 100, spread: 50 }, sizeFactor: 0.9, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Main beach beside Point Perry. The headland gives a little SE shelter; patrolled and good for learning." },

    { id: 'marcoola', name: 'Marcoola Beach', short: 'Marcoola', region: 'sc', type: 'beach',
      lat: -26.58191, lon: 153.10058, faces: 90, offshore: 270,
      swell: { ideal: 100, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Long open beach by the airport. Consistent and uncrowded; clean in W winds." },

    { id: 'old-woman-ledge', name: 'Old Woman Ledge, Mudjimba Island', short: 'Old Woman Ledge', region: 'sc', type: 'reef',
      lat: -26.61309, lon: 153.11486, faces: 60, offshore: 240,
      swell: { ideal: 100, spread: 50 }, maxSize: 0.9, sizeFactor: 1.0, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Reef on the north side of Mudjimba Island: long paddle or boat. Not a learner wave; only on tiny clean days." },

    { id: 'old-woman-ledge-south', name: 'Old Woman Ledge South, Mudjimba Island', short: 'Old Woman Sth', region: 'sc', type: 'reef',
      lat: -26.61595, lon: 153.11594, faces: 150, offshore: 330,
      swell: { ideal: 140, spread: 45 }, maxSize: 0.9, sizeFactor: 0.9, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "South side of Mudjimba Island, works in N\u2013NE winds. Long paddle or boat; experienced surfers only." },

    { id: 'mudjimba', name: 'Mudjimba Beach', short: 'Mudjimba', region: 'sc', type: 'beach',
      lat: -26.61494, lon: 153.10307, faces: 85, offshore: 265,
      swell: { ideal: 100, spread: 55 }, sizeFactor: 0.9, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Beach opposite Mudjimba Island. The island shapes the banks; best in light W\u2013SW winds." },

    { id: 'pincushion', name: 'Pincushion, Maroochydore', short: 'Pincushion', region: 'sc', type: 'beach',
      lat: -26.64622, lon: 153.10474, faces: 55, offshore: 235,
      swell: { ideal: 90, spread: 45 }, sizeFactor: 0.7, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Maroochy River mouth at Cotton Tree. Sheltered from SE winds; watch the river current." },

    { id: 'maroochydore', name: 'Maroochydore Beach', short: 'Maroochydore', region: 'sc', type: 'beach',
      lat: -26.65323, lon: 153.10707, faces: 60, offshore: 240,
      swell: { ideal: 95, spread: 50 }, sizeFactor: 0.8, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Patrolled main beach. Partly sheltered from SE; a good learner option on small days." },

    { id: 'the-bluff', name: 'The Bluff, Alexandra Headland', short: 'Alex Bluff', region: 'sc', type: 'point',
      lat: -26.67103, lon: 153.11491, faces: 50, offshore: 230,
      swell: { ideal: 120, spread: 50 }, wrap: 0.3, sizeFactor: 0.85, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Rocky bluff at the south end of Alex. Right-hander in SE swell and S winds; rocky entry." },

    { id: 'mooloolaba', name: 'Mooloolaba Beach', short: 'Mooloolaba', region: 'sc', type: 'beach',
      lat: -26.67869, lon: 153.12223, faces: 10, offshore: 190,
      swell: { ideal: 100, spread: 45 }, sizeFactor: 0.4, tide: 'all',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      log: "Gentle, sheltered rollers in a big swell",
      note: "North-facing bay behind Point Cartwright. Only breaks in big E\u2013SE swell; then a gentle, sheltered learner wave." },

    { id: 'point-cartwright', name: 'Point Cartwright, Buddina', short: 'Pt Cartwright', region: 'sc', type: 'reef',
      lat: -26.67588, lon: 153.13483, faces: 75, offshore: 255,
      swell: { ideal: 110, spread: 50 }, maxSize: 1.0, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Reef and rocks off the lighthouse headland. Exposed and rocky; for experienced surfers when it is bigger." },

    { id: 'kawana', name: 'Kawana Beach, Buddina', short: 'Kawana', region: 'sc', type: 'beach',
      lat: -26.68446, lon: 153.14131, faces: 85, offshore: 265,
      swell: { ideal: 105, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Mooloolaba', tidePort: 'mooloolaba',
      note: "Open beach south of Point Cartwright. Consistent banks; best early in light W winds." },

    { id: 'warana', name: 'Warana Beach', short: 'Warana', region: 'sc', type: 'beach',
      lat: -26.72700, lon: 153.13660, faces: 90, offshore: 270,
      swell: { ideal: 105, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: "Patrolled open beach. Consistent, uncrowded banks; clean in W winds." },

    { id: 'long-track', name: 'Long Track, Bokarina', short: 'Long Track', region: 'sc', type: 'beach',
      lat: -26.76035, lon: 153.13886, faces: 90, offshore: 270,
      swell: { ideal: 105, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: "Quiet stretch of open beach north of Wurtulla. Unpatrolled." },

    { id: 'wurtulla', name: 'Wurtulla Rocks', short: 'Wurtulla', region: 'sc', type: 'beach',
      lat: -26.76404, lon: 153.13982, faces: 90, offshore: 270,
      swell: { ideal: 105, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: "Beach with a patch of coffee rock that holds a bank. Clean in W winds; watch the rocks at low tide." },

    { id: 'ann-street', name: 'Ann Street Reef, Dicky Beach', short: 'Ann St Reef', region: 'sc', type: 'reef',
      lat: -26.77714, lon: 153.14088, faces: 90, offshore: 270,
      swell: { ideal: 110, spread: 50 }, sizeFactor: 0.9, tide: 'mid',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: "Small coffee-rock reef at Dicky Beach. Shallow at low tide; best mid to high." },

    { id: 'dicky', name: 'Dicky Beach', short: 'Dicky Beach', region: 'sc', type: 'beach',
      lat: -26.78195, lon: 153.14184, faces: 95, offshore: 275,
      swell: { ideal: 110, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: "Patrolled beach with consistent banks. A good learner beach on small days in W winds." },

    { id: 'shellys', name: 'Shelly Beach, Caloundra', short: 'Shellys', region: 'sc', type: 'beach',
      lat: -26.79400, lon: 153.15100, faces: 95, offshore: 275,
      swell: { ideal: 110, spread: 50 }, sizeFactor: 0.85, tide: 'mid',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: "Small beach between Moffat and Kings with rock shelves. Best on small days and mid tide." },

    { id: 'wickham-point', name: 'Wickham Point, Caloundra', short: 'Wickham Point', region: 'sc', type: 'point',
      lat: -26.80203, lon: 153.15205, faces: 80, offshore: 260,
      swell: { ideal: 115, spread: 45 }, wrap: 0.4, sizeFactor: 0.8, tide: 'mid',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: "Rocky point south of Shelly Beach. Needs SE\u2013E swell; rocky entry." },

    { id: 'caloundra-bar', name: 'Caloundra Bar, Pumicestone Passage', short: 'Caloundra Bar', region: 'sc', type: 'beach',
      lat: -26.80904, lon: 153.13624, faces: 130, offshore: 310,
      swell: { ideal: 130, spread: 50 }, maxSize: 0.8, sizeFactor: 0.85, tide: 'mid',
      buoy: 'Caloundra', tidePort: 'mooloolaba',
      note: "Pumicestone Passage entrance. Shifting sandbars, strong tidal currents and boat traffic: not a learner spot." },

    // ---------------- Gold Coast ----------------
    { id: 'currumbin', name: 'Currumbin Alley, Currumbin', short: 'Currumbin Alley', region: 'gc', type: 'point',
      lat: -28.12450, lon: 153.48720, faces: 40, offshore: 220,
      swell: { ideal: 110, spread: 45 }, wrap: 0.15, sizeFactor: 0.75, tide: 'lowmid',
      buoy: 'Palm Beach Mk4', tidePort: 'goldcoast',
      log: "Long, rolling right off the alley",
      note: 'Gentle sand-bottom right off Currumbin Rock into the creek mouth. Sheltered from SE — the go-to small-wave log spot. Strong rip on the run-out.' },

    { id: 'rainbow', name: 'Rainbow Bay, Coolangatta', short: 'Rainbow Bay', region: 'gc', type: 'point',
      lat: -28.16300, lon: 153.54760, faces: 345, offshore: 180,
      swell: { ideal: 115, spread: 45 }, wrap: 0.2, sizeFactor: 0.7, tide: 'all',
      buoy: 'Palm Beach Mk4', tidePort: 'goldcoast',
      log: "Lined-up right: a classic log wave",
      note: 'The softer inside of the Superbank below Snapper. E–SE swell wraps in; stays clean in SE–S winds.' },

    { id: 'kirra', name: 'Kirra Point, Coolangatta', short: 'Kirra', region: 'gc', type: 'point',
      lat: -28.16480, lon: 153.53530, faces: 5, offshore: 180, maxSize: 1.2,
      swell: { ideal: 120, spread: 40 }, wrap: 0.5, sizeFactor: 0.75, tide: 'lowmid',
      buoy: 'Palm Beach Mk4', tidePort: 'goldcoast',
      note: 'Fast, hollow right off the groyne. Needs solid E–SE swell; only a longboard wave on small days.' },

    { id: 'burleigh', name: 'Burleigh Point, Burleigh Heads', short: 'Burleigh Point', region: 'gc', type: 'point',
      lat: -28.09000, lon: 153.45720, faces: 55, offshore: 225, maxSize: 1.3,
      swell: { ideal: 130, spread: 45 }, wrap: 0.15, sizeFactor: 0.85, tide: 'lowmid',
      buoy: 'Palm Beach Mk4', tidePort: 'goldcoast',
      note: 'Powerful right over sand and boulders. Longboard it small or on the inside; sheltered from S–SE winds.' },

    { id: 'narrowneck', name: 'Narrowneck Reef, Main Beach', short: 'Narrowneck', region: 'gc', type: 'reef',
      lat: -27.98500, lon: 153.43220, faces: 85, offshore: 265,
      swell: { ideal: 100, spread: 60 }, sizeFactor: 0.9, tide: 'mid',
      buoy: 'Gold Coast Mk4', tidePort: 'goldcoast',
      note: 'Open beach with peaks shaped by the artificial reef. Picks up most swell but only clean in W winds — early mornings.' },
    // ---------------- Northern NSW ---------------- (tides: modelled sea level; no MSQ table in NSW)
    { id: 'duranbah', name: 'Duranbah Beach, Tweed Heads', short: 'Duranbah', region: 'nnsw', type: 'beach',
      lat: -28.16708, lon: 153.55169, faces: 70, offshore: 250,
      swell: { ideal: 110, spread: 55 }, sizeFactor: 1.0, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Punchy beach between the Tweed wall and Point Danger. Picks up every swell; crowded and fast, more shortboard than log." },

    { id: 'kingscliff', name: 'Kingscliff Beach', short: 'Kingscliff', region: 'nnsw', type: 'beach',
      lat: -28.25300, lon: 153.57900, faces: 70, offshore: 250,
      swell: { ideal: 105, spread: 55 }, sizeFactor: 0.85, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Open beach with rock walls holding the sand. Friendly banks on small days; clean in W winds." },

    { id: 'cabarita', name: 'Norries Headland, Cabarita Beach', short: 'Cabarita', region: 'nnsw', type: 'point',
      lat: -28.33445, lon: 153.57739, faces: 40, offshore: 220,
      swell: { ideal: 120, spread: 45 }, wrap: 0.3, sizeFactor: 0.8, tide: 'mid',
      buoy: null, tidePort: null,
      log: "Soft right off Norries on small days",
      note: "Right-hand point in the lee of Norries Head. Sheltered in SE winds; soft and long on small swells." },

    { id: 'hastings-point', name: 'Hastings Point', short: 'Hastings Point', region: 'nnsw', type: 'point',
      lat: -28.36000, lon: 153.58100, faces: 35, offshore: 215,
      swell: { ideal: 115, spread: 45 }, wrap: 0.4, sizeFactor: 0.75, tide: 'mid',
      buoy: null, tidePort: null,
      log: "Mellow right point, a log favourite",
      note: "Small rocky point by the creek mouth. Mellow right in SE swell and S winds; watch the creek current." },

    { id: 'the-pass', name: 'The Pass, Byron Bay', short: 'Byron Pass', region: 'nnsw', type: 'point',
      lat: -28.63682, lon: 153.62756, faces: 10, offshore: 190,
      swell: { ideal: 120, spread: 45 }, wrap: 0.5, sizeFactor: 0.65, tide: 'all',
      buoy: null, tidePort: null,
      log: "Iconic long right; logs rule here",
      note: "Byron’s famous right point under Cape Byron. Long, peeling walls in SE swell; very crowded, strict etiquette." },

    { id: 'wategos', name: 'Wategos Beach, Byron Bay', short: 'Wategos', region: 'nnsw', type: 'point',
      lat: -28.63438, lon: 153.63419, faces: 0, offshore: 180,
      swell: { ideal: 110, spread: 40 }, wrap: 0.6, sizeFactor: 0.55, tide: 'all',
      buoy: null, tidePort: null,
      log: "Slow, peeling right made for logs",
      note: "North-facing bay beside the Cape. Slow, gentle rights; the softest wave in Byron when there’s enough swell." },

    { id: 'clarkes', name: 'Clarkes Beach, Byron Bay', short: 'Clarkes', region: 'nnsw', type: 'beach',
      lat: -28.63800, lon: 153.61900, faces: 15, offshore: 195,
      swell: { ideal: 100, spread: 45 }, sizeFactor: 0.65, tide: 'all',
      buoy: null, tidePort: null,
      log: "Gentle peaks for learning on a log",
      note: "Sheltered beach between Main Beach and The Pass. Gentle peaks that suit learning on a log." },

    { id: 'byron-main', name: 'Main Beach, Byron Bay', short: 'Byron Main', region: 'nnsw', type: 'beach',
      lat: -28.64108, lon: 153.61461, faces: 10, offshore: 190,
      swell: { ideal: 95, spread: 45 }, sizeFactor: 0.6, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Patrolled town beach. Sheltered from SE winds; small and friendly most days." },

    { id: 'broken-head', name: 'Broken Head', short: 'Broken Head', region: 'nnsw', type: 'point',
      lat: -28.70400, lon: 153.61700, faces: 40, offshore: 220,
      swell: { ideal: 110, spread: 45 }, wrap: 0.4, sizeFactor: 0.85, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Right-hand point in a nature reserve south of Byron. Clean in S\u2013SW winds; rocks at the top of the point." },

    { id: 'lennox', name: 'Lennox Point, Lennox Head', short: 'Lennox Point', region: 'nnsw', type: 'point',
      lat: -28.80012, lon: 153.59755, faces: 40, offshore: 225,
      swell: { ideal: 130, spread: 45 }, wrap: 0.3, maxSize: 1.0, sizeFactor: 0.95, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Long, powerful right over boulders. A world-class wave for experienced surfers: not a learner spot." },

    { id: 'seven-mile', name: 'Seven Mile Beach, Lennox Head', short: 'Lennox 7 Mile', region: 'nnsw', type: 'beach',
      lat: -28.77100, lon: 153.60000, faces: 95, offshore: 275,
      swell: { ideal: 100, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Long open beach north of Lennox. Plenty of peaks to yourself; best in light W winds." },

    { id: 'ballina-lighthouse', name: 'Lighthouse Beach, Ballina', short: 'Ballina Lighthouse', region: 'nnsw', type: 'beach',
      lat: -28.87150, lon: 153.59250, faces: 95, offshore: 275,
      swell: { ideal: 110, spread: 55 }, sizeFactor: 0.95, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Patrolled open beach south of the Ballina breakwall. Consistent banks; strong rips near the wall." },

    { id: 'shelly-ballina', name: 'Shelly Beach, East Ballina', short: 'Ballina Shelly', region: 'nnsw', type: 'reef',
      lat: -28.86100, lon: 153.59600, faces: 50, offshore: 230,
      swell: { ideal: 110, spread: 50 }, sizeFactor: 0.8, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Small bay with rock shelves south of Lighthouse Beach. Best mid tide on small, clean days." },

    // ---------------- Sydney (east) ---------------- (tides: modelled sea level; no MSQ table in NSW)
    { id: 'manly', name: 'South Steyne, Manly', short: 'South Steyne', region: 'syd', type: 'beach',
      lat: -33.79700, lon: 151.29000, faces: 100, offshore: 280,
      swell: { ideal: 110, spread: 50 }, sizeFactor: 0.75, tide: 'mid',
      buoy: null, tidePort: null,
      log: "Sheltered corner; a longboard institution",
      note: "Sheltered south corner of Manly. A longboard institution: gentle waves and protection from S winds." },

    { id: 'collaroy', name: 'Collaroy Beach', short: 'Collaroy', region: 'syd', type: 'beach',
      lat: -33.73200, lon: 151.30500, faces: 80, offshore: 260,
      swell: { ideal: 90, spread: 45 }, sizeFactor: 0.75, tide: 'mid',
      buoy: null, tidePort: null,
      log: "Soft waves sheltered by Long Reef",
      note: "Northern-beaches bay sheltered by Long Reef. Soft waves that suit logs and learners." },

    { id: 'bondi', name: 'Bondi Beach', short: 'Bondi', region: 'syd', type: 'beach',
      lat: -33.89216, lon: 151.27793, faces: 140, offshore: 320,
      swell: { ideal: 135, spread: 55 }, sizeFactor: 0.85, tide: 'mid',
      buoy: null, tidePort: null,
      log: "Gentle north end on small days",
      note: "The famous one. The north end is gentle on small days; crowded, with a strong rip at the south end." },

    { id: 'tamarama', name: 'Tamarama Beach', short: 'Tamarama', region: 'syd', type: 'beach',
      lat: -33.90090, lon: 151.27109, faces: 120, offshore: 300,
      swell: { ideal: 115, spread: 45 }, maxSize: 1.0, sizeFactor: 0.95, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Tiny, punchy bay with rocks and strong rips. For experienced surfers only." },

    { id: 'bronte', name: 'Bronte Beach', short: 'Bronte', region: 'syd', type: 'beach',
      lat: -33.90402, lon: 151.26901, faces: 95, offshore: 275,
      swell: { ideal: 120, spread: 50 }, sizeFactor: 0.9, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Exposed beach with a notorious rip (the Bronte Express). Best on small days in W winds." },

    { id: 'clovelly', name: 'Clovelly Reef', short: 'Clovelly', region: 'syd', type: 'reef',
      lat: -33.91800, lon: 151.26300, faces: 90, offshore: 270,
      swell: { ideal: 120, spread: 45 }, maxSize: 1.0, sizeFactor: 0.9, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Reef at the mouth of the Clovelly inlet. Shallow and rocky; experienced surfers only." },

    { id: 'coogee', name: 'Coogee Beach', short: 'Coogee', region: 'syd', type: 'beach',
      lat: -33.92100, lon: 151.25800, faces: 90, offshore: 270,
      swell: { ideal: 120, spread: 45 }, sizeFactor: 0.7, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Patrolled bay partly sheltered by Wedding Cake Island. Small and mellow most days." },

    { id: 'maroubra', name: 'Maroubra Beach', short: 'Maroubra', region: 'syd', type: 'beach',
      lat: -33.94857, lon: 151.25722, faces: 100, offshore: 280,
      swell: { ideal: 130, spread: 55 }, sizeFactor: 1.0, tide: 'mid',
      buoy: null, tidePort: null,
      note: "Sydney’s most consistent beach. Powerful and heavily localised; not a log wave." },

    { id: 'malabar', name: 'Malabar Beach', short: 'Malabar', region: 'syd', type: 'beach',
      lat: -33.96390, lon: 151.25230, faces: 80, offshore: 260,
      swell: { ideal: 110, spread: 45 }, sizeFactor: 0.65, tide: 'mid',
      buoy: null, tidePort: null,
      log: "Soft, sheltered bay waves",
      note: "Long Bay’s sheltered beach. Soft, small waves that suit a longboard." },

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
    // Upstream: south swell reaches these first, so a jump here is an early warning ("Swell arriving").
    { site: 'Brisbane Mk4',   name: 'Point Lookout',  region: 'sc', upstream: true, lead: '2–3 hours', lat: -27.48950, lon: 153.63329 },
    { site: 'Tweed Offshore', name: 'Tweed Offshore', region: 'gc', upstream: true, lead: 'within the hour', also: ['nnsw'], lat: -28.21352, lon: 153.68170 },
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
     5. OUTLOOK + CONFIDENCE
     ---------------------------------------------------------------------------
     Days 1–9 come from Open-Meteo's default wave model; after that the GFS
     wave model fills in to day 16. Confidence compares independent models
     (waves: default / GFS / ECMWF; wind: default / ECMWF / GFS) over the
     morning window, then fades with lead time.
     =========================================================================== */
  outlook: {
    days: 16,          // forecast length
    trendFromDay: 8,   // day 8 onwards is shown faded and labelled "trend"
    watchMin: 3,       // a day needs at least this rating (3 = Good) to be a "day to watch"
    watchMax: 3,       // show at most this many days to watch
  },
  confidence: {
    // model spread → disagreement 0..1, linear between [agree, disagree]
    waveSpread: [0.12, 0.45],   // (max − min) / mean wave height
    windSpread: [5, 15],        // km/h between models
    windDirSpread: [30, 100],   // degrees between models (only counted when wind > 8 km/h)
    // lead-time multiplier: [days ahead, factor]
    lead: [[0, 1], [3, 0.95], [7, 0.78], [11, 0.58], [15, 0.42]],
    levels: [0.7, 0.45],        // ≥ first = High, ≥ second = Medium, else Low
  },

  /* ===========================================================================
     6. MAPS — spot map tiles and the Windy embed
     =========================================================================== */
  maps: {
    centre: { sc: [-26.60, 153.11, 10], gc: [-28.07, 153.47, 11], nnsw: [-28.55, 153.58, 9], syd: [-33.86, 151.27, 11] },   // lat, lon, zoom
    windy:  { sc: [-26.6, 153.4, 7],    gc: [-28.0, 153.7, 7],    nnsw: [-28.6, 153.9, 7],   syd: [-33.9, 151.6, 7] },
  },

  /* ===========================================================================
     AREAS — the region switch: state first, then area. `wind` is the BoM
     station shown in "Wind now" on Today; spot pages use their nearest station.
     =========================================================================== */
  states: { qld: 'Queensland', nsw: 'New South Wales' },
  areas: [
    { id: 'sc',   state: 'qld', name: 'Sunshine Coast', wind: '94569' },
    { id: 'gc',   state: 'qld', name: 'Gold Coast',     wind: '94592' },
    { id: 'nnsw', state: 'nsw', name: 'Northern NSW',   wind: '94599' },
    { id: 'syd',  state: 'nsw', name: 'Sydney',         wind: '95766' },
  ],

  /* BoM automatic weather stations for live wind (fetched every 30 min by
     .github/workflows/live.yml into data/live.json; BoM blocks browser requests). */
  windStations: [
    { id: '94570', product: 'IDQ60801', name: 'Tewantin',               lat: -26.39, lon: 153.04 },
    { id: '94569', product: 'IDQ60801', name: 'Marcoola airport',       lat: -26.60, lon: 153.09 },
    { id: '94580', product: 'IDQ60801', name: 'Gold Coast Seaway',      lat: -27.94, lon: 153.43 },
    { id: '94592', product: 'IDQ60801', name: 'Coolangatta',            lat: -28.17, lon: 153.50 },
    { id: '94599', product: 'IDN60801', name: 'Cape Byron',             lat: -28.64, lon: 153.64 },
    { id: '94596', product: 'IDN60801', name: 'Ballina',                lat: -28.84, lon: 153.56 },
    { id: '95766', product: 'IDN60801', name: 'Sydney Harbour',         lat: -33.84, lon: 151.29 },
    { id: '94767', product: 'IDN60801', name: 'Sydney Airport',         lat: -33.95, lon: 151.17 },
  ],

  /* ===========================================================================
     7. UI
     =========================================================================== */
  ui: {
    defaultRegion: 'sc',
    detailView: 'charts',   // 'charts' (charts + table) or 'table'
    detailFromHour: 4,      // hourly table shows 4am…
    detailToHour: 19,       // …to 7pm
    cacheMinutes: 20,       // re-use data younger than this without refetching

    /* --- GO / MAYBE / SKIP verdict at the top of the home hero.
           Based on the rating (1 Poor … 5 Epic) of the best spot in the region
           for the selected morning:  rating ≥ go → Go,  ≥ maybe → Maybe,  else Skip.
           Lined up with the rating words: Good or better = Go, Fair = Maybe, Poor = Skip.
           'Too big' and 'Flat' are always Skip. */
    verdict: { go: 3, maybe: 2 },

    /* One-line taglines under the verdict. The first matching situation wins
       (see `tagline()` in app.js):
         tooBig     – best spot is over your size limit
         flat       – nothing reaching the beach
         blownOut   – wind has wrecked it (wind sub-score below 0.35)
         glassy     – Go, and the wind is under the glassy limit
         offshore   – Go, with offshore wind
         go         – Go, anything else
         smallClean – Maybe, under the sweet spot but clean
         bumpy      – Maybe, with noticeable chop
         maybe      – Maybe, anything else
         tiny       – Skip, just too small
         skip       – Skip, anything else */
    taglines: {
      tooBig: 'Too big for the log',
      flat: 'Flat as a tack — sleep in',
      blownOut: 'Blown out, stay in bed',
      glassy: 'Glassy and fun',
      offshore: 'Clean lines, grab the log',
      go: 'Worth the alarm',
      smallClean: 'Small but clean — log day',
      bumpy: 'A bit bumpy, still surfable',
      maybe: 'Fun enough if you’re keen',
      tiny: 'Knee-high at best',
      skip: 'Not worth the wetsuit',
    },
  },
};
