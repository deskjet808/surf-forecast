# Cowabunga

A longboard dawn-patrol surf forecast for the Sunshine Coast and Gold Coast (Queensland). It's a static page with no build step, hosted on GitHub Pages.

- **Rating rules** are all in [`config.js`](config.js) and are commented so you can tweak them.
- **Data sources** are free, with no API keys:
  - [Open-Meteo Marine](https://open-meteo.com/en/docs/marine-weather-api) and [Forecast](https://open-meteo.com/en/docs) for swell and wind
  - [Maritime Safety Queensland tide predictions](https://www.msq.qld.gov.au/tides/open-data) via data.qld.gov.au
  - [Qld Government near real-time wave buoys](https://www.data.qld.gov.au/dataset/coastal-data-system-near-real-time-wave-data)

## Outlook, maps and tides

- **16-day outlook** (Outlook tab): Open-Meteo's default wave model to about day 9, then the GFS wave model to day 16. Day 8 onward is shown faded as a trend. "Days to watch" pins the standout mornings.
- **Confidence**: compares independent models (waves: default / GFS / ECMWF; wind: default / ECMWF / GFS) over the morning, faded by lead time. Tuning lives in `config.js`.
- **The morning**: a plain-English summary under the hero on Today.
- **Map tab**: spot pins coloured by rating (Leaflet + OpenStreetMap tiles), plus Windy's free embed for swell, wind and rain.
- **Spot pages**: a tide planner for any date MSQ has published, plus a spot guide and links to free cams (`guides.js`).

## Dawn, Midday and Arvo

Every day is split into three blocks: **Dawn** (first light to 10am), **Midday** (10am to 2pm) and **Arvo** (2pm to 25 minutes after sunset). The switch on Today and Outlook ranks spots for the chosen block and opens on whichever block is on now. A block that has finished for today moves on to tomorrow.

## Confidence %

Each rating shows a confidence figure (5–95%) with three dots. It comes from how closely independent wave models (default, GFS, ECMWF) and wind models (ECMWF, GFS) agree for those hours, reduced the further out the day is. It is an estimate of agreement, not a measured hit rate.

## Forecast track record

`.github/workflows/verify.yml` runs `tools/verify.py` at 7:17am and 7:17pm Brisbane. It saves what Open-Meteo forecast at each buoy the same day, a day ahead and two days ahead (its previous-runs data), saves the buoys' hourly wave height, and writes `data/track.json`. Buoy check shows how often the forecast was within 0.2 m of the buoys between 4am and 7pm over the last 30 days. It needs a week of data before it shows figures. GitHub can turn scheduled jobs off after 60 days without other activity in the repo; if the figures stop updating, re-enable it in the Actions tab.

## Regions

The switch at the top picks a state (Queensland, New South Wales), then an area: Sunshine Coast, Gold Coast, Northern NSW or Sydney. Areas live in `config.js` (`areas`). NSW has no Maritime Safety Queensland tide table, so its tides are modelled from Open-Meteo sea level (heights relative to mean sea level; turn times about ±30 min). All times are Brisbane time, NSW included.

## Wind now, beach safety, swell arriving

- **Wind now:** `.github/workflows/live.yml` runs `tools/live.py` every 30 minutes and saves the latest Bureau of Meteorology readings (public FTP, `windStations` in `config.js`) to `data/live.json`. Today shows the area's station; each spot page shows its nearest one.
- **Beach safety:** once a day the same job reads Surf Life Saving's Beachsafe patrol hours, hazard rating and hazards into `data/safety.json`. `tools/beachsafe.json` maps each spot to its nearest Beachsafe beach; re-run `python tools/beachsafe_match.py` after adding spots and check the matches.
- **Swell arriving:** when an upstream buoy (`upstream: true` in `config.js`: Point Lookout for the Sunshine Coast, Tweed Offshore for the Gold Coast) jumps 0.3 m or more in 3 hours on a south to east swell, Today shows a banner. There's no open buoy feed for Byron or Sydney.

## Longboard picks 🤙

Spots with a `log` note in `config.js` get a 🤙 wherever their name appears, plus the note on their spot page.
