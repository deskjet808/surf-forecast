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
