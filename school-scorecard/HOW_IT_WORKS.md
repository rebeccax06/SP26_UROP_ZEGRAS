# How the School Reliability Scorecard Works

## Overview

This app measures **MBTA bus reliability around schools** by comparing:
- **Scheduled** headways (from GTFS static schedule)
- **Archived** headways (actual performance from a monthly MBTA Bus Arrival/Departure CSV)

The goal: help identify which bus routes are unreliable for students getting to/from school.

---

## Data Flow

```
1. User selects school → Gets school location (lat/lon)
   ↓
2. Find stops within walk radius (default 800m ≈ 10 min walk)
   ↓
3. Find routes that serve those stops
   ↓
4. For each route/stop combination, compute:
   - Scheduled median headway (from GTFS)
   - Archived median headway (from the loaded MBTA CSV)
   ↓
5. Calculate reliability ratios (observed/scheduled)
   ↓
6. Display in scorecard table + map
```

---

## What Each Component Shows

### 1. **Debug Dashboard** (`/debug`)

**Purpose**: Verify your GTFS data is loading correctly

**Shows**:
- **GTFS Loading Status**: Counts of stops, routes, trips loaded from GTFS files
- **Stops Near School**: List of bus stops within the radius
- **Routes Serving Stops**: Which bus routes serve those stops
- **Scheduled Headways**: Computed scheduled headways for the time window

**Use this to**:
- Check if GTFS files are loading (should show thousands of stops/routes)
- Verify stops are found near your school
- See if routes are detected
- Test if scheduled headway computation works

---

### 2. **School Scorecard Page** (`/school/[schoolId]`)

**Purpose**: Main interface showing reliability metrics

**Left Panel**:
- School name and location
- Count of nearby stops
- List of stops (first 10)

**Center**: **Mapbox Map**
- Blue marker = School location
- Green markers = Bus stops within radius
- Click markers for details

**Right Panel**: **Scorecard Table**

Columns explained:

| Column | What It Shows |
|--------|---------------|
| **Route** | Bus route name (e.g., "1 - Route 1") |
| **Stop** | Key stop name for this route |
| **Sched (min)** | Scheduled median headway (from GTFS schedule) |
| **Archived (min)** | Actual median headway from the loaded MBTA CSV |
| **Archived IQR** | Interquartile range (P25–P75) showing variability |
| **Bunch %** | Percentage of headways that were "bunched" (< 50% of scheduled or < 4 min) |
| **Rel. (arch)** | **Reliability ratio** = Archived/Scheduled (1.0 = perfect, < 0.8 = worse than scheduled, > 1.2 = better than scheduled) |

**Color coding**:
- 🔴 Red reliability ratio (< 0.8) = Worse than scheduled (unreliable)
- 🟢 Green reliability ratio (0.8–1.2) = Close to scheduled (reliable)
- 🔵 Blue reliability ratio (> 1.2) = Better than scheduled (more frequent)

---

## Understanding the Metrics

### **Headway**
Time between consecutive bus arrivals at a stop.
- Example: If buses arrive at 7:10, 7:25, 7:40 → headways are 15 min, 15 min
- **Median headway** = middle value (less affected by outliers)

### **Reliability Ratio**
```
Reliability Ratio = Observed Headway / Scheduled Headway
```

- **1.0** = Exactly as scheduled
- **0.5** = Buses arrive twice as often as scheduled (good!)
- **2.0** = Buses arrive half as often (bad - unreliable)
- **< 0.8** = Significantly worse than scheduled (unreliable)

### **Bunching Rate**
Percentage of headways that are too short (buses bunched together).
- High bunching = Some buses arrive very close together, then long gaps
- Indicates poor service reliability

### **IQR (Interquartile Range)**
Shows variability:
- Small IQR = Consistent headways
- Large IQR = Inconsistent (sometimes short, sometimes long gaps)

---

## Time Windows

The app analyzes three time periods:

1. **AM (Morning Arrival)**: 7:00–9:00
   - When students arrive at school
   - Critical for on-time arrival

2. **PM (Afternoon Dismissal)**: 14:30–16:30
   - When students leave school
   - Critical for getting home

3. **AS (After School)**: 16:00–18:00
   - Extended after-school period
   - Includes activities, late dismissal

---

## How to Use It

### Step 1: Verify Data Loading
1. Go to `/debug`
2. Check GTFS stats show thousands of records
3. Verify stops are found near your school
4. Check routes are detected

### Step 2: View Scorecard
1. Go to `/school/madison-park` (or another configured school)
2. Adjust radius slider if needed (default 800m)
3. Select time window (AM/PM/AS)
4. Review scorecard table

### Step 3: Interpret Results
- **Look for routes with low reliability ratios** (< 0.8) = unreliable
- **Check bunching rates** - High = poor service quality

---

## Example Interpretation

**Example row**:
```
Route: 1 - Route 1
Scheduled: 10.0 min
Archived: 15.0 min
Reliability: 1.5
```

**Meaning**:
- Schedule says buses every 10 minutes
- The archived CSV shows an actual median of 15 minutes
- Reliability ratio 1.5 = buses were 50% less frequent than scheduled
- **Conclusion**: This route is unreliable for students

---

## Technical Details

### Data Sources
1. **GTFS Static** (`data/gtfs/`): MBTA schedule data
   - `stops.txt`: Bus stop locations
   - `routes.txt`: Route information
   - `trips.txt`: Individual trips
   - `stop_times.txt`: When buses arrive at stops
   - `calendar.txt`: Service days

2. **MBTA Bus Arrival/Departure CSV** (`data/mbta-bus/MBTA-Bus-Arrival-Departure-Times_YYYY-MM.csv`): observed arrival/departure rows used for archived metrics, heatmaps, and the `/route-simulation` moving-dots animation.

### Caching
- Server-side cache with TTL:
  - GTFS: cached after first load
  - Stops/Routes: 5 minutes
  - Scorecard: cached for the process lifetime (input is static files)

### Performance
- GTFS loads once and stays in memory
- Only fetches data for stops/routes currently in view
- Minimizes recomputation with caching
