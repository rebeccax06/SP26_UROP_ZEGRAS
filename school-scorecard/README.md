# School Reliability Scorecard

MBTA bus reliability around schools: **scheduled** (from GTFS) vs **archived** (from a monthly MBTA Bus Arrival/Departure CSV) headways, rendered as a Mapbox map plus a scorecard panel.

## Setup

1. **Install dependencies**
   ```bash
   cd school-scorecard && npm install
   ```

2. **Environment**
   - Copy `.env.example` to `.env.local`.
   - Set `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` (required for the map).
   - Optionally point `MBTA_BUS_ARRIVAL_CSV` / `MBTA_BUS_ARRIVAL_MONTH` at a specific CSV (see below).

3. **GTFS static (required for scheduled headways, stops, routes, shapes)**
   - Download [MBTA GTFS static](https://cdn.mbta.com/MBTA_GTFS.zip) and unzip into `school-scorecard/data/gtfs/` (or set `GTFS_DIR` to your path).
   - Required files: `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, `calendar.txt`, `calendar_dates.txt`, `shapes.txt`.

4. **MBTA Bus Arrival/Departure CSV (required for archived metrics, heatmaps, and the simulation)**
   - Drop the CSV into `school-scorecard/data/mbta-bus/MBTA-Bus-Arrival-Departure-Times_YYYY-MM.csv`.
   - Default filename if `MBTA_BUS_ARRIVAL_MONTH` is unset: `MBTA-Bus-Arrival-Departure-Times_2026-01.csv`.
   - Or set `MBTA_BUS_ARRIVAL_CSV=/absolute/or/relative/path/to/file.csv` to override.

## Run

```bash
npm run dev
```

`http://localhost:3000/` redirects to `/school/madison-park`.; add more in [`src/config/schools.ts`](./src/config/schools.ts).

## Data sources

| What | Provider file | Where it reads |
|---|---|---|
| **Scheduled headways** | `src/lib/providers/schedule-gtfs.ts` | GTFS static on disk (`data/gtfs/` or `$GTFS_DIR`). For each route+stop on the requested service date, collects `stop_times.txt` departures within the window and takes the median consecutive gap. |
| **Archived headways** | `src/lib/providers/archived-observed-csv.ts` | One **static monthly** MBTA Bus Arrival/Departure CSV (default `data/mbta-bus/MBTA-Bus-Arrival-Departure-Times_2026-01.csv`). This is whichever month you put on disk — **not** rolling "last week". |
| Stops near a point | `src/lib/providers/stops-gtfs.ts` | GTFS static. |
| Routes serving stops | `src/lib/providers/routes-gtfs.ts` | GTFS static. |
| Per-route stop metrics (optional) | `src/lib/analysis/getAnalysisFilePath.ts` | `analysis_output/route{N}_{month}_stop_metrics.json` produced by `../data-analysis.py`. The month matches `MBTA_BUS_ARRIVAL_MONTH`; the loader also accepts the legacy month-less filename. Used to enrich the map overlay with on-time / bunching rates. |

Everything reads from local files — no HTTP calls are made to external transit APIs.

## Structure

- **Providers** (`src/lib/providers/`): pluggable adapters for schools, stops, routes, scheduled, archived. Today only the GTFS and CSV implementations exist (`*-gtfs.ts`, `archived-observed-csv.ts`).
- **GTFS loader** (`src/lib/gtfs/loadGtfs.ts`): parses the static feed into in-memory indexes once per server process.
- **Scorecard** (`src/lib/scorecard/computeScorecard.ts`): merges scheduled + archived into `ScorecardRow[]` and per-stop headways. Takes only `scheduleProvider` + `archivedProvider` — there's no live provider hook.
- **Analysis libs** (`src/lib/analysis/`): CSV → heatmap grid, ridership parsing, route-specific corridor orderings (used by the heatmap and route-headway endpoints).
- **Simulation** (`src/lib/simulation/`): builds animated trip-position datasets from CSV + GTFS shapes for `/route-simulation` (the moving-dots visualization).
- **API** (`src/app/api/`): see route table below.
- **UI** (`src/app/`): pages for the scorecard, heatmap, trip-spike charts, simulation, and debug dashboard.

### API routes

| Path | Returns |
|---|---|
| `GET /api/schools/[id]` | One school config. |
| `GET /api/scorecard?schoolId&date&startTime&endTime&radiusMeters` | Composed `ScorecardRow[]` + per-stop headways for the map. |
| `GET /api/route-headways?routeId&date&startTime&endTime` | Map overlay (segments, on-time, optional ridership load). |
| `GET /api/heatmap-data?routeId` | Heatmap grid payload. |
| `GET /api/heatmap-drilldown?…` | Trips behind one heatmap cell. |
| `GET /api/bus-ridership?…` | Optional ridership trip list / per-trip stops. |
| `GET /api/route-trip-series?routeId` | End-to-end trip observations for the `/route-trip-charts` spike plot. |
| `GET /api/route-simulation?routeId&date` | Animated trip-position dataset for `/route-simulation` (the moving-dots page). |
| `GET /api/debug/{gtfs,stops,routes,schedule}` | Diagnostics page backends. |

Note the scorecard endpoint uses `date` + `startTime` + `endTime`, **not** the legacy `timeWindow` parameter mentioned in older docs.

### Pages

| Path | What it shows |
|---|---|
| `/` | Redirects to `/school/madison-park`. |
| `/school/[schoolId]` | Scorecard table + Mapbox map for a school. |
| `/debug` | GTFS / stops / routes / schedule diagnostics. |
| `/route-heatmap?routeId=…` | Interactive on-time / bunching heatmap. |
| `/route-trip-charts?routeId=…` | **Trip-duration spike charts** — one vertical spike per half-trip (height = observed end-to-end minutes, red = >3 min longer than scheduled). Live web version of `data-analysis.py`'s `route{N}_{month}_trip_spikes_{in,out}bound.png`. Defaults to route 28. |
| `/route-simulation?routeId=…&date=…` | **Animated "moving dots" simulation** — blue = scheduled bus position interpolated from GTFS, red = actual position interpolated from the CSV timepoints, dashed lines show schedule deviation per trip. Defaults to route 28 on 2026-01-15 if no params. |

## Generating the analysis JSON (optional)

The Mapbox **route overlay** on `/school/[schoolId]` reads a precomputed JSON file when it's available. Without it, the overlay still works but loses two stats:

- **Bunching rate per stop** is always `null` → the map can't color stops by bunching.
- **On-time rate per stop** is `null` *unless* the request specifies a single `date` (in which case it's computed live from the CSV).

Generating the JSON also unlocks an `?hour=N` parameter on those endpoints, so the map can show "on-time at 8am" without recomputing.

To generate it, run `data-analysis.py` against the same month as `MBTA_BUS_ARRIVAL_MONTH`:

```bash
cd ..
python data-analysis.py \
    --month 2026-01 \
    --focus-route 28 \
    --stops school-scorecard/data/gtfs/stops.txt
```

This writes `analysis_output/route{N}_{month}_stop_metrics.json` containing `{ overall: [...], byHour: { "0": [...], "1": [...], ... } }`. The app picks them up via `ANALYSIS_OUTPUT_DIR=` or the default sibling-directory fallback in [`getAnalysisFilePath.ts`](./src/lib/analysis/getAnalysisFilePath.ts), matching the month from `MBTA_BUS_ARRIVAL_MONTH`. The loader also accepts the older month-less name `route{N}_stop_metrics.json` if you've got that on disk from a previous run.

> The `/route-heatmap` page does **not** use this JSON — it reads the CSV directly. So skipping this step only affects the school-scorecard map overlay.

## Tests

```bash
npm test
```

- `__tests__/utils/median.test.ts` — pure unit test of the median helper.
- `__tests__/gtfs/scheduled-headway.test.ts` — fixture GTFS through `createScheduleProviderGTFS`.
- `__tests__/scorecard/merge.test.ts` — shape assertions on `ScorecardRow`.
- `__tests__/api/scorecard.test.ts` — integration test; needs a running dev server (set `TEST_API_BASE` or run `npm run dev` first).

## Storage

- **GTFS**: `data/gtfs/` (or `$GTFS_DIR`).
- **MBTA Bus Arrival/Departure CSV**: `data/mbta-bus/` (or `$MBTA_BUS_ARRIVAL_CSV`).
- **Crowding annotations**: optional `data/crowding-annotations.json` — array of `{ "stopId", "routeId", "type": "crowding" | "denied_boardings", "note?" }`. Use GTFS `stop_id` / `route_id` values. The map popup shows "(crowding reported)" / "(denied boardings)" for matching pairs.
- **Cache**: in-memory `Map` with TTL (`src/lib/cache/server-cache.ts`). No database.

## Known gaps

- **"Last week" semantics**: archived metrics come from one fixed CSV, not a rolling window.
- **Multi-month archives**: only one CSV is read at a time.
- **Crowing**: wanted to explore adding annotations to this/seeing how crowdedness affects on time rate
