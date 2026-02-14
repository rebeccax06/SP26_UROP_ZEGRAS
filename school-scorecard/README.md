# School Reliability Scorecard

MBTA bus reliability around schools: scheduled vs archived (last week) vs live (Swiftly) headways, with a Mapbox map and scorecard panel.

## Setup

1. **Install dependencies**
   ```bash
   cd school-scorecard && npm install
   ```

2. **Environment**
   - Copy `.env.example` to `.env.local`.
   - Set `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` for the map.
   - Optionally set MBTA archive and Swiftly env vars (see `.env.example`). Leave blank for MVP; scorecard will still show scheduled headways when GTFS is present.

3. **GTFS data (for scheduled headways and stops/routes)**
   - Download [MBTA GTFS static](https://cdn.mbta.com/MBTA_GTFS.zip) and unzip into `school-scorecard/data/gtfs/` (or set `GTFS_DIR` to your path).
   - Required files: `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, `calendar.txt`, `calendar_dates.txt`.

## Run

```bash
npm run dev
```

Open [http://localhost:3000/school/demo](http://localhost:3000/school/demo).

## Structure

- **Data providers** (`src/lib/providers/`): School, Stops (GTFS), Routes (GTFS), Schedule (GTFS), Archived (MBTA), Live (Swiftly). Env-based and swappable.
- **GTFS** (`src/lib/gtfs/`): Load GTFS from `data/gtfs/`, in-memory indexes; `loadGtfs.ts` for scheduled headway computation.
- **Scorecard** (`src/lib/scorecard/`): Assembles scheduled + archived + live into `ScorecardRow`s.
- **API** (`src/app/api/`): `GET /api/schools`, `GET /api/schools/:id`, `GET /api/stops?lat&lon&radiusMeters`, `GET /api/routes?stopIds=...`, `GET /api/scorecard?schoolId&timeWindow&radiusMeters&startDate&endDate`. Server cache (Map + TTL) for scorecard, stops, routes.
- **UI**: `/school/[schoolId]` — left panel (school, radius slider, time window), Mapbox map (school + nearby stops), right panel (scorecard table). SWR for client fetching.

## TODOs

- **MBTA archived**: Set `MBTA_ARCHIVE_BASE_URL` and optionally `MBTA_ARCHIVE_DATASET`. Implement the exact query/fields in `archived-observed-mbta.ts` for your dataset (Open Data / ArcGIS).
- **Swiftly**: Set `SWIFTLY_API_KEY`, `SWIFTLY_BASE_URL`, `SWIFTLY_AGENCY_ID`. Implement the exact headway or arrivals endpoint in `live-observed-swiftly.ts`.

## Tests

```bash
npm test
```

- Unit: median, IQR, scorecard row shape, scheduled headway on fixture GTFS.
- Integration: `GET /api/scorecard` shape (run with dev server or set `TEST_API_BASE`).

## Storage

No large local DB: only GTFS files under `data/gtfs/` and optional in-memory cache (TTL). No SQLite required for MVP.
