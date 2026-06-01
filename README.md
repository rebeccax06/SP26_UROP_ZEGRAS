# LTS-OSM - Calculating Level of Traffic Stress using Open Street Map Data

MIT Spring 2026 UROP with Prof. P. Christopher Zegras
Two parallel research tracks, each fully self-contained inside this repo:

| Track | Code | Output |
|---|---|---|
| **Cycling Level of Traffic Stress (LTS)** | `LTS_OSM.py`, `LTS_plot.py`, `lts_functions.py`, `main.py`, `web.py`, etc. | GeoJSON / Mapbox tiles of street-segment stress, per city |
| **MBTA bus reliability around schools** | `data-analysis.py` and the [`school-scorecard/`](./school-scorecard) Next.js app | Heatmaps, JSON metrics, interactive school-by-school scorecard |

The two tracks share this directory but are otherwise independent; the only thing is that `data-analysis.py`'s `analysis_output/route{N}_stop_metrics.json` files in the root directory use the data in school-scorecard.

---

## Repository layout

```
.
├── README.md                          (this file)
├── requirements.txt                   Python deps (LTS + data-analysis)
│
├── LTS-OSM track
│   ├── main.py                        CLI entry: process / plot / combine cities
│   ├── LTS_OSM.py                     Overpass download → graph → edge LTS CSV
│   ├── LTS_plot.py                    LTS CSV → GeoJSON for Mapbox / web view
│   ├── lts_functions.py               YAML-driven LTS rule engine
│   ├── constants.py                   CITIES dict (OSM relation key/value)
│   ├── build_query.py                 Standalone helper to write Overpass .query yml
│   ├── isochrone.py                   Experimental LTS-aware isochrone plots
│   ├── web.py                         Local HTTP server for index.html / GoPro overlay
│   ├── index.html, map/, mapbox/      Web viewers + Mapbox tileset recipe
│   ├── config/                        tables.yml, rating_dict.yml, lane_parse.yml
│   ├── query/                         Generated *.query files for Overpass
│   ├── data/                          Generated artifacts (*_1.json, *_3.graphml, *_4_all_lts.csv)
│   └── plots/                         Generated GeoJSON output for maps
│
├── Bus-reliability track
│   ├── data-analysis.py               MBTA Bus arrival/departure analysis (heatmaps + JSON)
│   ├── analysis_output/               Generated PNGs + route{N}_stop_metrics.json
│   └── school-scorecard/              Next.js app — see school-scorecard/README.md
│
└── notebooks
    ├── isochrone_notepad.ipynb        Scratch driver for isochrone.py
    └── yaml_config_testing.ipynb      Scratch notebook for tuning config/*.yml
```

Anything under `data/`, `plots/`, `analysis_output/`, `venv/`, `__pycache__/`, `school-scorecard/.next/`, or `school-scorecard/node_modules/` is **generated or third-party** — safe to delete and regenerate.

---

## Setup

```bash
# 1. Python deps (LTS + data-analysis)
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Node deps (school-scorecard app only)
cd school-scorecard
npm install
```

Tested with Python 3.12 and Node 18+.

---

## Track 1 — Cycling Level of Traffic Stress (LTS)

Calculates cycling [Level of Traffic Stress](https://peterfurth.sites.northeastern.edu/level-of-traffic-stress/) for every road and path segment in a region using OpenStreetMap data.

Adapted from [Bike Ottawa's stressmodel](https://github.com/BikeOttawa/stressmodel) and Madeleine Bonsma-Fisher's [LTS-OSM](https://github.com/mbonsma/LTS-OSM) fork (which added intersection/node LTS).

### Quick start

```bash
# Process a single city (downloads OSM + computes edge LTS)
python main.py process -city Boston --rebuild

# Process several at once and stitch them
python main.py process -cities Boston,Cambridge,Somerville --combine

# Export a GeoJSON for Mapbox / the local viewer
python main.py plot -city Boston --format=json

# Serve plots/LTS.json over http://localhost:8000 via index.html
python web.py

# Overlay GoPro JPEG geotags on top of the LTS map
python web.py -plot-go-pro /path/to/folder/of/gopro/jpgs
```

### Adding a new city

1. Find the OSM relation on [openstreetmap.org](https://www.openstreetmap.org/) and copy a `key=value` pair that uniquely identifies it (e.g. `wikipedia=en:Brookline, Massachusetts`).
2. Add an entry to `constants.CITIES`.
3. Run `python main.py process -city YourCity --rebuild`.

### Pipeline outputs (`data/`)

Each stage saves an intermediate; deleting a file forces re-computation from that step onward:

| File | Producer | Notes |
|---|---|---|
| `{city}_1.json` | `LTS_OSM.download_osm` | Raw Overpass response |
| `{city}_2_way_tags.csv` | `LTS_OSM.extract_tags` | All OSM tag names present |
| `{city}_3.graphml` | `LTS_OSM.download_data` | OSMnx street graph |
| `{city}_4_all_lts.csv` | `LTS_OSM.lts_edges` | **Edge-level LTS** (main output) |
| `{city}_6_gdf_nodes.csv` | `LTS_OSM.lts_nodes` (off by default) | Intersection LTS, slow |
| `plots/{city}_LTS.json` | `LTS_plot.plot_lts_geojson` | Mapbox-ready GeoJSON |

> Note: `Boston_LTS.json` is ~40 MB and renders slowly in browsers.

### Mapbox publishing

See [`mapbox/mapbox_readme.md`](./mapbox/mapbox_readme.md) for the `tilesets` CLI workflow (upload `plots/LTS.json`, validate `mapbox/recipe.json`, publish).

---

## Track 2 — School bus-reliability scorecard

`data-analysis.py` ingests MBTA Bus Arrival/Departure CSVs and produces:

- Stop-level on-time rate + bunching heatmaps (PNG)
- Per-route end-to-end trip-time "spike" charts
- `analysis_output/route{N}_stop_metrics.json` consumed by the Next.js scorecard

### Definitions (kept in sync with school-scorecard)

- **On-time**: arrival within `[scheduled - 1 min, scheduled + 5 min]`.
- **Bunching**: a pair of arrivals at the same stop within `min(50% of scheduled headway, 4 min)`.
- **Delayed trip**: end-to-end actual duration exceeds scheduled by > 3 min.

Tunable at the top of `data-analysis.py` (`ON_TIME_*`, `BUNCHING_*`, `TRIP_DELAY_THRESHOLD_SEC`).

### Usage

```bash
# Default: month = 2026-01, focus route = 28, comparison routes = 1, 39, 66
python data-analysis.py --stops school-scorecard/data/gtfs/stops.txt

# Override month / route / output dir
python data-analysis.py \
    --csv data/mbta-bus/MBTA-Bus-Arrival-Departure-Times_2026-04.csv \
    --month 2026-04 \
    --focus-route 28 \
    --output-dir analysis_output \
    --stops school-scorecard/data/gtfs/stops.txt
```

### The Next.js app

The interactive UI lives under [`school-scorecard/`](./school-scorecard) and has its own README. Run it with:

```bash
cd school-scorecard
npm run dev          # http://localhost:3000
```

It reads the JSON files this script writes, plus MBTA static GTFS, and (optionally) the same arrival/departure CSV.

---

## Conventions

- **`if __name__ == '__main__'` guards** — every script that's runnable also exposes a `main()` function so it can be imported.
- **Intermediate files** — every long-running stage saves to `data/` or `analysis_output/`. To re-run from a given step, delete that file (and everything depending on it).
- **YAML config** — LTS rules live in `config/*.yml` so the rule engine can be tuned without touching Python.
- **No secrets in the repo** — the Mapbox token goes in `school-scorecard/.env.local`. See `school-scorecard/.env.example`.

---
