#!/usr/bin/env python3
"""
Route 28 bus bunching and stop-level on-time performance analysis.

Uses MBTA Bus Arrival/Departure CSV (MBTA-Bus-Arrival-Departure-Times_YYYY-MM.csv).
Analyzes Route 28 over a month and compares to a small set of other routes.

Definitions:
  - On-time: arrival is within [scheduled - 1 min, scheduled + 5 min].
    (Not more than 1 min early, not more than 5 min late.)
  - Bunching: two buses arrive at the same stop within a threshold.
    Threshold = min(50% of scheduled headway, 4 minutes), per stop/direction/date.
  - Trip charts: each half-trip is a vertical spike (actual end-to-end time). Rows may be
    standard_type Schedule or Headway (route 28 is usually Headway in the MBTA CSV).
    "Delayed" (red) = actual duration more than 3 minutes longer than scheduled (first→last time point).

Dependencies: pandas, numpy, matplotlib (e.g. pip install pandas numpy matplotlib).

Usage:
  python data-analysis.py [--csv PATH] [--output-dir DIR] [--month YYYY-MM] [--focus-route ID]
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import calendar as calendar_mod

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

# ---------------------------------------------------------------------------
# Constants and assumptions (explicit for reproducibility)
# ---------------------------------------------------------------------------

FOCUS_ROUTE = "28"
COMPARISON_ROUTES = ["1", "39", "66"]  # high-ridership / similar urban routes
ON_TIME_EARLY_MIN = 1   # max minutes early to still count as "on time"
ON_TIME_LATE_MIN = 5    # max minutes late to still count as "on time"
BUNCHING_PCT_OF_SCHEDULED = 0.5   # headway < this fraction of scheduled = bunched
BUNCHING_MAX_SEC = 4 * 60         # cap: headway < 4 min counts as bunching
MIN_SAMPLES_FOR_RATE = 5          # min observations before reporting a rate
# Whole-trip "delayed" if actual end-to-end time exceeds scheduled by more than this (seconds).
TRIP_DELAY_THRESHOLD_SEC = 3 * 60

CSV_COLUMNS = [
    "service_date", "route_id", "direction_id", "half_trip_id", "stop_id",
    "time_point_id", "time_point_order", "point_type", "standard_type",
    "scheduled", "actual", "scheduled_headway", "headway",
]

# Columns for per-stop aggregates (used when hourly slice is empty so downstream code can filter safely).
AGG_STOP_BY_ROUTE_COLUMNS = [
    "route_id",
    "stop_id",
    "direction_id",
    "time_point_order",
    "on_time_rate",
    "bunching_rate",
    "n_obs",
]


def _empty_agg_stop_by_route() -> pd.DataFrame:
    return pd.DataFrame(columns=AGG_STOP_BY_ROUTE_COLUMNS)


# Route 28 corridor (single source of truth)
#
# The 28 bus corridor below is the user-specified Mattapan → Ruggles ordering.
# Each row is `(stop_name, stop_id)` where `stop_id` matches MBTA GTFS `stops.txt`.
# The heatmap Y-axis uses this ARRAY ORDER as-is (no name- or alphabetical sorting),
# and only these 37 stops are shown — no Longwood or post-Ruggles tails.
# Keep in sync with school-scorecard/src/lib/analysis/route28HeatmapCorridorStopNames.ts.

ROUTE_28_CORRIDOR: tuple[tuple[str, str], ...] = (
    ("Mattapan", "18511"),
    ("Blue Hill Ave @ Mattapan Sq", "1722"),
    ("Blue Hill Ave @ Babson St", "1723"),
    ("Blue Hill Ave opp Woodhaven St", "1724"),
    ("1458 Blue Hill Ave opp Almont St", "1725"),
    ("Blue Hill Ave @ Mattapan Library", "1726"),
    ("Blue Hill Ave @ Fessenden St", "1728"),
    ("Blue Hill Ave @ Woolson St", "1730"),
    ("Blue Hill Ave @ Morton St", "1731"),
    ("Blue Hill Ave @ Woodrow Ave", "1732"),
    ("Blue Hill Ave @ Arbutus St", "1733"),
    ("Blue Hill Ave @ Callender St", "1734"),
    ("Blue Hill Ave @ Westview St", "1735"),
    ("Blue Hill Ave opp Health Ctr", "1736"),
    ("Blue Hill Ave @ Harvard St", "1737"),
    ("Blue Hill Ave @ Wales St", "381"),
    ("Blue Hill Ave @ Charlotte St", "382"),
    ("Blue Hill Ave @ Ellington St", "383"),
    ("Blue Hill Ave @ Pasadena Rd", "384"),
    ("Blue Hill Ave @ Castlegate Rd", "385"),
    ("Warren St @ Sunderland St", "386"),
    ("Warren St @ Intervale St", "387"),
    ("Warren St @ Gaston St", "388"),
    ("Warren St @ Quincy St", "390"),
    ("Warren St @ Maywood St", "392"),
    ("Warren St @ Woodbine St", "393"),
    ("Warren St @ Waverly St", "394"),
    ("Warren St @ Whiting St", "395"),
    ("Warren St @ Moreland St", "396"),
    ("Warren St @ Kearsarge Ave", "21151"),
    ("Nubian", "64000"),
    ("Malcolm X Blvd @ Shawmut Ave", "1148"),
    ("Malcolm X Blvd @ O'Bryant HS", "11149"),
    ("Malcolm X Blvd @ Madison Park HS", "11148"),
    ("Malcolm X Blvd @ Tremont St", "21148"),
    ("Tremont St opp Prentiss St", "1224"),
    ("Ruggles", "17861"),
)


# Outbound corridor (Ruggles → Mattapan). Stop names come from GTFS (longest
# direction_id=0 trip 73766456 in the 2026-01 feed). Each stop_id is the
# outbound-side platform; many sit across the street from their inbound twin.
# We start at the outbound Ruggles platform (17862) so the heatmap reads
# top-to-bottom as Mattapan → Ruggles → Mattapan.
ROUTE_28_OUTBOUND_CORRIDOR: tuple[tuple[str, str], ...] = (
    ("Ruggles", "17862"),
    ("Malcolm X Blvd @ King St", "11257"),
    ("Malcolm X Blvd opp Madison Park HS", "1259"),
    ("Malcolm X Blvd opp O'Bryant HS", "11323"),
    ("Malcolm X Blvd @ Shawmut Ave", "11259"),
    ("Nubian", "64000"),
    ("Warren St @ Dabney Pl", "40001"),
    ("Warren St @ Walnut Ave", "401"),
    ("Warren St opp Waverly St", "404"),
    ("Warren St opp Woodbine St", "405"),
    ("Warren St @ ML King Blvd", "406"),
    ("Warren St @ Townsend St", "407"),
    ("Warren St @ Waumbeck St", "410"),
    ("Warren St @ Brunswick St", "411"),
    ("Warren St @ Crawford St", "412"),
    ("Blue Hill Ave @ Wayne St", "413"),
    ("Blue Hill Ave @ Seaver St", "414"),
    ("Blue Hill Ave @ Franklin Park Rd", "415"),
    ("Blue Hill Ave opp McLellan St", "416"),
    ("Blue Hill Ave @ American Legion Hwy", "417"),
    ("Blue Hill Ave @ Angell St", "419"),
    ("Blue Hill Ave @ Harvard St", "1706"),
    ("Blue Hill Ave @ Paxton St", "1708"),
    ("Blue Hill Ave @ Greenock St", "1709"),
    ("Blue Hill Ave @ Johnston Rd", "1710"),
    ("Blue Hill Ave @ Morton St", "11712"),
    ("Blue Hill Ave @ Goodale Rd", "1713"),
    ("Blue Hill Ave @ Wellington Hill St", "1714"),
    ("Blue Hill Ave @ Mattapan St", "1716"),
    ("Blue Hill Ave @ Almont St", "1717"),
    ("Blue Hill Ave @ Woodhaven St", "1718"),
    ("Blue Hill Ave opp Babson St", "11719"),
    ("Blue Hill Ave @ Mattapan Sq", "1720"),
    ("Blue Hills Pkwy @ River St", "1721"),
    ("Mattapan", "18511"),
)


def route28_corridor_stop_ids(direction: Literal["Inbound", "Outbound"]) -> list[str]:
    """Ordered stop_ids along the Route 28 corridor for the given direction.

    Inbound:  Mattapan → Ruggles (uses ROUTE_28_CORRIDOR)
    Outbound: Ruggles → Mattapan (uses ROUTE_28_OUTBOUND_CORRIDOR)
    """
    if direction == "Inbound":
        return [sid for _, sid in ROUTE_28_CORRIDOR]
    if direction == "Outbound":
        return [sid for _, sid in ROUTE_28_OUTBOUND_CORRIDOR]
    raise ValueError(f"direction must be 'Inbound' or 'Outbound', got {direction!r}")

# Stop_id aliases for the Route 28 corridor.
#
# MBTA occasionally reassigns a platform/berth mid-feed and the CSV starts
# logging the same physical stop under a NEW stop_id. We collapse those
# aliases into the canonical corridor stop_id so the heatmap row stays
# continuous instead of going blank.
#
# Add entries here as new feeds expose new aliases. Keys = alias stop_id,
# Values = canonical corridor stop_id (must be one of the *_CORRIDOR ids).
# ---------------------------------------------------------------------------
ROUTE_28_CORRIDOR_STOP_ID_ALIASES: dict[str, str] = {
    # 2026-04: outbound Ruggles berth changed from 17862 to 17865 on 2026-04-05.
    # Both have point_type=Startpoint and time_point_id="rugg" in the CSV.
    "17865": "17862",
}


def canonicalize_route28_stop_id(stop_id: object) -> str:
    """Map any alias stop_id to its canonical corridor stop_id (idempotent)."""
    sid = str(stop_id).strip()
    return ROUTE_28_CORRIDOR_STOP_ID_ALIASES.get(sid, sid)


def route28_corridor_name_overrides() -> dict[str, str]:
    """
    Mapping stop_id -> the corridor's official label, for both inbound and
    outbound corridors. Used to render Y-axis labels exactly as specified, even
    when GTFS stop_name differs slightly (e.g. GTFS prefixes a street number).
    Note: stop_ids that appear in both directions (e.g. 18511 Mattapan, 64000
    Nubian) collapse to a single label, which is fine because the heatmap row
    key includes direction so each direction renders its own row.
    """
    return {
        **{sid: name for name, sid in ROUTE_28_CORRIDOR},
        **{sid: name for name, sid in ROUTE_28_OUTBOUND_CORRIDOR},
    }


def route28_corridor_row_index() -> list[tuple[str, str]]:
    """
    (direction, stop_id) row index for the Route 28 heatmap: inbound corridor
    on top (Mattapan -> Ruggles), then outbound corridor (Ruggles -> Mattapan).
    Direction tokens match the canonical CSV labels normalized via
    `_norm_direction_token`.
    """
    return (
        [("Inbound", sid) for sid in route28_corridor_stop_ids("Inbound")]
        + [("Outbound", sid) for sid in route28_corridor_stop_ids("Outbound")]
    )



def _norm_direction_token(value: object) -> str:
    """
    Canonical direction label for matching CSV rows to corridor blocks.
    MBTA arrival/departure CSVs use 'Inbound'/'Outbound' strings; GTFS uses
    '0' (outbound) / '1' (inbound). Both are mapped here.
    """
    s = str(value).strip().lower()
    if s in ("inbound", "1", "1.0"):
        return "Inbound"
    if s in ("outbound", "0", "0.0"):
        return "Outbound"
    return str(value).strip()


# ---------------------------------------------------------------------------
# Stop name normalization & matching
#
# Matching CSV rows to GTFS stops is done by `stop_id` (exact). This block
# only validates the corridor against GTFS by stop_name, and surfaces close
# matches when an expected stop_id is missing. It tolerates small differences
# like leading street numbers ("1624 "), "@" vs "at", "opp" vs "opp.",
# punctuation, and extra whitespace.
# ---------------------------------------------------------------------------

_STOP_NAME_TOKEN_REPLACEMENTS = (
    (re.compile(r"\bavenue\b"), "ave"),
    (re.compile(r"\bstreet\b"), "st"),
    (re.compile(r"\bboulevard\b"), "blvd"),
    (re.compile(r"\bsquare\b"), "sq"),
    (re.compile(r"\bopposite\b"), "opp"),
)


def _normalize_stop_name(raw: str) -> str:
    """Lowercase, drop punctuation/leading street numbers, collapse whitespace."""
    if not raw:
        return ""
    s = raw.lower().strip()
    s = s.replace("@", " at ").replace("&", " at ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    for pattern, replacement in _STOP_NAME_TOKEN_REPLACEMENTS:
        s = pattern.sub(replacement, s)
    s = re.sub(r"^\d+\s+", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _close_stop_name_matches(target: str, stop_names: dict[str, str], k: int = 3) -> list[str]:
    """Top-k human-readable GTFS stops whose normalized name is closest to `target`."""
    target_norm = _normalize_stop_name(target)
    if not target_norm:
        return []
    indexed: list[tuple[str, str, str]] = [
        (sid, name, _normalize_stop_name(name)) for sid, name in stop_names.items() if name
    ]
    candidates = [norm for _, _, norm in indexed]
    matches = difflib.get_close_matches(target_norm, candidates, n=k, cutoff=0.6)
    out: list[str] = []
    for m in matches:
        for sid, name, norm in indexed:
            if norm == m and (label := f"{name} (stop_id={sid})") not in out:
                out.append(label)
                break
    return out


def validate_route28_corridor(stop_names: dict[str, str]) -> None:
    """
    Print a warning for every corridor stop_id (inbound + outbound) that is
    missing from `stops.txt`, or whose GTFS stop_name disagrees with the
    corridor label after normalization. Always prints close-match suggestions
    so name typos can be diagnosed quickly.
    """
    if not stop_names:
        print("Warning: no GTFS stops loaded; skipping corridor validation.", file=sys.stderr)
        return
    missing = 0
    mismatched = 0
    blocks = (
        ("Inbound  (Mattapan -> Ruggles)", ROUTE_28_CORRIDOR),
        ("Outbound (Ruggles -> Mattapan)", ROUTE_28_OUTBOUND_CORRIDOR),
    )
    for label, block in blocks:
        for expected_name, stop_id in block:
            gtfs_name = stop_names.get(stop_id)
            if gtfs_name is None:
                missing += 1
                close = _close_stop_name_matches(expected_name, stop_names, k=3)
                print(
                    f"Warning: {label} stop '{expected_name}' (stop_id={stop_id}) "
                    f"not found in GTFS stops.txt.",
                    file=sys.stderr,
                )
                if close:
                    print(f"  Possible matches: {close}", file=sys.stderr)
                continue
            if _normalize_stop_name(expected_name) != _normalize_stop_name(gtfs_name):
                mismatched += 1
                print(
                    f"Note: {label} stop_id={stop_id} expected '{expected_name}', "
                    f"GTFS has '{gtfs_name}' (still used; corridor label preserved).",
                    file=sys.stderr,
                )
    total = len(ROUTE_28_CORRIDOR) + len(ROUTE_28_OUTBOUND_CORRIDOR)
    if missing == 0 and mismatched == 0:
        print(
            f"Route 28 corridor: all {total} stops "
            f"({len(ROUTE_28_CORRIDOR)} inbound + {len(ROUTE_28_OUTBOUND_CORRIDOR)} outbound) "
            f"resolved against GTFS."
        )
    if ROUTE_28_CORRIDOR_STOP_ID_ALIASES:
        names = route28_corridor_name_overrides()
        aliases_pretty = ", ".join(
            f"{alias}->{canonical} ({names.get(canonical, '?')})"
            for alias, canonical in ROUTE_28_CORRIDOR_STOP_ID_ALIASES.items()
        )
        print(f"Route 28 corridor: applying stop_id aliases [{aliases_pretty}].")


def gtfs_longest_trip_stop_order(
    gtfs_dir: Path | None,
    route_short_name_or_id: str,
) -> list[str] | None:
    """
    Stop order along the longest GTFS trip on a given route.

    Used as a heatmap Y-axis when there's no hand-curated corridor for the
    route. "Longest trip" = the trip with the most ``stop_times`` rows, which
    in MBTA feeds is reliably the canonical full-corridor pattern (short
    turns, deadheads, and bell-time variants all have fewer stops). Mirrors
    the rule used by school-scorecard's ``route1HeatmapStopOrder.ts``.

    Args:
        gtfs_dir: Directory holding ``routes.txt``, ``trips.txt``,
            ``stop_times.txt``. If ``None`` or any file is missing, returns
            ``None`` and the caller should fall back to its own ordering.
        route_short_name_or_id: GTFS short name as riders see it (``"1"``,
            ``"28"``, ``"SL5"``). If no row in ``routes.txt`` matches that
            short name, the value is retried as a literal ``route_id``. This
            dual lookup tolerates MBTA feeds where short_name and route_id
            sometimes coincide and sometimes don't.

    Returns:
        Ordered, deduped stop_ids along the longest matching trip, or
        ``None`` when GTFS is missing, the route has no trips, or any read
        fails.
    """
    if gtfs_dir is None:
        return None
    routes_p = gtfs_dir / "routes.txt"
    trips_p = gtfs_dir / "trips.txt"
    st_p = gtfs_dir / "stop_times.txt"
    if not routes_p.is_file() or not trips_p.is_file() or not st_p.is_file():
        return None

    target = str(route_short_name_or_id).strip()
    if not target:
        return None

    try:
        # 1. routes.txt -> route_ids whose user-facing short name matches.
        # MBTA's short_name is what riders see ("1", "28"); route_id is an
        # internal handle. The two values sometimes align and sometimes
        # don't, so we look up by short_name first and fall back to treating
        # the input as a route_id directly.
        routes = pd.read_csv(routes_p, dtype=str)
        if "route_id" not in routes.columns or "route_short_name" not in routes.columns:
            return None
        mask = routes["route_short_name"].astype(str).str.strip() == target
        route_ids = (
            routes.loc[mask, "route_id"].dropna().astype(str).str.strip().unique().tolist()
        )
        if not route_ids:
            route_ids = [target]

        # 2. trips.txt -> trip_ids on those route_ids.
        trips = pd.read_csv(trips_p, dtype=str, usecols=["route_id", "trip_id"])
        tids = (
            trips[trips["route_id"].isin(route_ids)]["trip_id"]
            .dropna().astype(str).str.strip().unique().tolist()
        )
        if not tids:
            return None
        tid_set = frozenset(tids)

        # 3. First chunked pass over stop_times.txt: count rows per trip_id.
        # stop_times is the big file (millions of rows in MBTA feeds), so we
        # stream it in chunks and only keep rows whose trip_id is on our
        # route. The trip with the highest count wins as "longest".
        trip_counts: dict[str, int] = {}
        for chunk in pd.read_csv(
            st_p, dtype=str, usecols=["trip_id", "stop_id", "stop_sequence"], chunksize=800000
        ):
            sub = chunk[chunk["trip_id"].isin(tid_set)]
            if sub.empty:
                continue
            for tid, grp in sub.groupby("trip_id"):
                k = str(tid)
                trip_counts[k] = trip_counts.get(k, 0) + len(grp)
        if not trip_counts:
            return None
        best_tid = max(trip_counts, key=trip_counts.get)

        # 4. Second chunked pass: pull just the winning trip's rows. A second
        # streaming pass is cheaper than buffering every candidate trip's
        # full rows in memory during pass 1.
        parts: list[pd.DataFrame] = []
        for chunk in pd.read_csv(
            st_p, dtype=str, usecols=["trip_id", "stop_id", "stop_sequence"], chunksize=800000
        ):
            sub = chunk[chunk["trip_id"].astype(str).str.strip() == str(best_tid).strip()]
            if not sub.empty:
                parts.append(sub)
        if not parts:
            return None

        # 5. Sort numerically by stop_sequence (string sort would put "10"
        # before "2"), then dedupe while preserving order so loop routes that
        # revisit a stop only contribute one row to the heatmap axis.
        st = pd.concat(parts, ignore_index=True)
        st["_seq"] = pd.to_numeric(st["stop_sequence"], errors="coerce").fillna(0)
        st = st.sort_values("_seq")
        out: list[str] = []
        seen: set[str] = set()
        for sid in st["stop_id"].tolist():
            s = str(sid).strip()
            if not s or s in seen:
                continue
            seen.add(s)
            out.append(s)
        return out or None
    except Exception:
        # GTFS files are read on a best-effort basis (this script runs on
        # whatever the user happens to have on disk). On any read/parse
        # failure, return None so the caller can fall back gracefully.
        return None


def parse_ts_to_seconds(ts: str) -> float:
    """
    Parse MBTA scheduled/actual timestamp to seconds since midnight.
    Accepts ISO with T ('1900-01-01THH:MM:SSZ') and older CSVs with a space
    ('1900-01-01 05:07:00.000'). Returns -1 if invalid.
    """
    if pd.isna(ts) or not ts or not isinstance(ts, str):
        return -1.0
    s = ts.strip()
    if "T" in s:
        time_part = s.split("T", 1)[1]
    elif " " in s:
        time_part = s.split(" ", 1)[1]
    else:
        return -1.0
    time_part = time_part.rstrip("Z").strip()
    hms = time_part.split(":")
    if len(hms) < 3:
        return -1.0
    try:
        h, m = int(hms[0]), int(hms[1])
        sec = float(hms[2])
        return h * 3600 + m * 60 + sec
    except (ValueError, IndexError):
        return -1.0


def local_hour_from_ts(ts: str) -> float:
    """Fractional hour (e.g. 8.5 for 08:30) from timestamp."""
    sec = parse_ts_to_seconds(ts)
    if sec < 0:
        return -1.0
    return sec / 3600.0


# ---------------------------------------------------------------------------
# Step 1: Load and clean data
# ---------------------------------------------------------------------------

def find_csv(custom_path: str | None, month: str) -> Path | None:
    """Locate CSV file: custom path, or school-scorecard/data/mbta-bus, or data/mbta-bus."""
    if custom_path:
        p = Path(custom_path)
        if p.is_file():
            return p
        return None
    stem = f"MBTA-Bus-Arrival-Departure-Times_{month}.csv"
    for base in [Path("school-scorecard/data/mbta-bus"), Path("data/mbta-bus"), Path(".")]:
        candidate = base / stem
        if candidate.is_file():
            return candidate
    return None


def find_stops_txt(custom_path: str | None) -> Path | None:
    """Locate stops.txt: custom path, or school-scorecard/data/gtfs, data/gtfs, or ."""
    if custom_path:
        p = Path(custom_path)
        if p.is_file():
            return p
        return None
    for base in [
        Path("school-scorecard/data/gtfs"),
        Path("school-scorecard/data"),
        Path("data/gtfs"),
        Path("data"),
        Path("."),
    ]:
        candidate = base / "stops.txt"
        if candidate.is_file():
            return candidate
    return None


def load_stop_names(stops_path: Path) -> dict[str, str]:
    """
    Load stop_id -> stop_name from GTFS stops.txt.
    Expects header: stop_id, stop_name, ... (extra columns ignored).
    """
    out: dict[str, str] = {}
    try:
        stops_df = pd.read_csv(stops_path, dtype=str, usecols=["stop_id", "stop_name"])
        for _, row in stops_df.iterrows():
            sid = (row.get("stop_id") or "").strip()
            name = (row.get("stop_name") or "").strip() or sid
            if sid:
                out[sid] = name
    except Exception as e:
        print(f"Warning: could not load stop names from {stops_path}: {e}", file=sys.stderr)
    return out


def load_and_clean(csv_path: Path) -> pd.DataFrame:
    """
    Load CSV and return a cleaned DataFrame with:
    - service_date, route_id, direction_id, stop_id, time_point_order
    - scheduled_sec, actual_sec, local_hour
    - scheduled_headway_sec, actual_headway_sec (filled where possible)
    - standard_type
    Rows with invalid/missing actual or non-Schedule/Headway standard_type are dropped.
    """
    df = pd.read_csv(
        csv_path,
        header=0,
        names=CSV_COLUMNS,
        usecols=range(len(CSV_COLUMNS)),
        dtype={
            "service_date": str,
            "route_id": str,
            "direction_id": str,
            "stop_id": str,
            "scheduled": str,
            "actual": str,
            "standard_type": str,
        },
        low_memory=False,
    )

    # Restrict to rows we can use
    df = df[df["standard_type"].isin(["Schedule", "Headway"])].copy()
    df["scheduled_sec"] = df["scheduled"].map(parse_ts_to_seconds)
    df["actual_sec"] = df["actual"].map(parse_ts_to_seconds)
    df["local_hour"] = df["scheduled"].map(local_hour_from_ts)

    # Drop rows without valid scheduled or actual
    df = df[(df["scheduled_sec"] >= 0) & (df["actual_sec"] >= 0)].copy()

    # Numeric headway columns
    df["scheduled_headway_sec"] = pd.to_numeric(df["scheduled_headway"], errors="coerce").fillna(-1).astype(int)
    df["headway_sec"] = pd.to_numeric(df["headway"], errors="coerce").fillna(-1).astype(int)
    df["actual_headway_sec"] = df["headway_sec"].where(df["headway_sec"] > 0, -1)

    # Sort so we can compute consecutive headways where needed
    df = df.sort_values(["route_id", "stop_id", "direction_id", "service_date", "scheduled_sec"]).reset_index(drop=True)

    # Fill actual_headway from consecutive actual times when CSV headway is missing.
    # Use a vectorized groupby-diff path to avoid apply shape edge-cases across datasets.
    group_cols = ["route_id", "stop_id", "direction_id", "service_date"]
    diff = df.groupby(group_cols)["actual_sec"].diff()
    missing_or_invalid = df["actual_headway_sec"].isna() | (df["actual_headway_sec"] < 0)
    can_fill_from_diff = diff > 0
    df.loc[missing_or_invalid & can_fill_from_diff, "actual_headway_sec"] = diff[missing_or_invalid & can_fill_from_diff]
    df["actual_headway_sec"] = pd.to_numeric(df["actual_headway_sec"], errors="coerce").fillna(-1).astype(float)

    return df


# ---------------------------------------------------------------------------
# Step 2: Filter to Route 28 and comparison routes
# ---------------------------------------------------------------------------

def filter_routes(df: pd.DataFrame, focus: str = FOCUS_ROUTE, comparison: list[str] | None = None) -> pd.DataFrame:
    """Keep only focus route and comparison routes. comparison defaults to COMPARISON_ROUTES."""
    comparison = comparison or COMPARISON_ROUTES
    routes = [focus] + [r for r in comparison if r != focus]
    return df[df["route_id"].isin(routes)].copy()


# ---------------------------------------------------------------------------
# Step 3: Compute stop-level reliability and bunching metrics
# ---------------------------------------------------------------------------

def is_on_time(actual_sec: float, scheduled_sec: float) -> bool:
    """True if arrival is within [scheduled - 1 min, scheduled + 5 min]."""
    diff_sec = actual_sec - scheduled_sec
    return -ON_TIME_EARLY_MIN * 60 <= diff_sec <= ON_TIME_LATE_MIN * 60


def bunching_threshold_sec(scheduled_headway_sec: float) -> float:
    """Threshold below which we consider two buses 'bunched'."""
    if scheduled_headway_sec <= 0:
        return BUNCHING_MAX_SEC
    return min(scheduled_headway_sec * BUNCHING_PCT_OF_SCHEDULED, BUNCHING_MAX_SEC)


def compute_stop_metrics(df: pd.DataFrame) -> pd.DataFrame:
    """
    Per (route_id, stop_id, direction_id, service_date) compute:
    - n_obs, on_time_count, on_time_rate
    - bunched_count, bunching_rate (using actual_headway vs threshold)
    - median_scheduled_headway_sec, median_actual_headway_sec
    - time_point_order (min, for ordering stops along route)
    """
    rows = []

    for key, g in df.groupby(["route_id", "stop_id", "direction_id", "service_date"]):
        route_id, stop_id, direction_id, service_date = key
        g = g.sort_values("scheduled_sec")
        n = len(g)
        if "time_point_order" in g.columns:
            tpo = pd.to_numeric(g["time_point_order"], errors="coerce").min()
            time_point_order = int(tpo) if pd.notna(tpo) else 0
        else:
            time_point_order = 0

        # On-time: vectorized version of is_on_time().
        diff_sec = g["actual_sec"] - g["scheduled_sec"]
        on_time = diff_sec.between(-ON_TIME_EARLY_MIN * 60, ON_TIME_LATE_MIN * 60)
        on_time_count = on_time.sum()
        on_time_rate = on_time_count / n if n else np.nan

        # Scheduled headway (for threshold): use median of non-zero scheduled headways, or diff of scheduled times
        sched_hw = g["scheduled_headway_sec"].replace(-1, np.nan).dropna()
        if sched_hw.empty:
            sched_hw = g["scheduled_sec"].diff().dropna()
        median_sched = float(sched_hw.median()) if len(sched_hw) else np.nan

        # Actual headway and bunching
        actual_hw = g["actual_headway_sec"].replace(-1, np.nan).dropna()
        median_actual = float(actual_hw.median()) if len(actual_hw) else np.nan
        thresh = bunching_threshold_sec(median_sched) if not np.isnan(median_sched) else BUNCHING_MAX_SEC
        bunched = (g["actual_headway_sec"] > 0) & (g["actual_headway_sec"] < thresh)
        bunched_count = bunched.sum()
        bunching_rate = bunched_count / n if n else np.nan

        rows.append({
            "route_id": route_id,
            "stop_id": stop_id,
            "direction_id": direction_id,
            "service_date": service_date,
            "time_point_order": time_point_order,
            "n_obs": n,
            "on_time_count": int(on_time_count),
            "on_time_rate": on_time_rate,
            "bunched_count": int(bunched_count),
            "bunching_rate": bunching_rate,
            "median_scheduled_headway_sec": median_sched,
            "median_actual_headway_sec": median_actual,
        })

    if not rows:
        return pd.DataFrame(
            columns=[
                "route_id",
                "stop_id",
                "direction_id",
                "service_date",
                "time_point_order",
                "n_obs",
                "on_time_count",
                "on_time_rate",
                "bunched_count",
                "bunching_rate",
                "median_scheduled_headway_sec",
                "median_actual_headway_sec",
            ]
        )
    return pd.DataFrame(rows)


def aggregate_stop_metrics_over_dates(metrics: pd.DataFrame) -> pd.DataFrame:
    """
    Aggregate per (route_id, stop_id, direction_id): median on_time_rate, median bunching_rate,
    min time_point_order, sum n_obs. Drops rows with n_obs < MIN_SAMPLES_FOR_RATE for rate stability.
    """
    if metrics.empty:
        return _empty_agg_stop_by_route()
    agg = (
        metrics.groupby(["route_id", "stop_id", "direction_id"], as_index=False)
        .agg(
            time_point_order=("time_point_order", "min"),
            on_time_rate=("on_time_rate", "median"),
            bunching_rate=("bunching_rate", "median"),
            n_obs=("n_obs", "sum"),
        )
    )
    agg = agg[agg["n_obs"] >= MIN_SAMPLES_FOR_RATE].copy()
    return agg


def compute_stop_metrics_by_hour(df: pd.DataFrame, hour: int) -> pd.DataFrame:
    """
    Filter df to rows where floor(local_hour) == hour, then compute stop metrics per (route, stop, direction, date),
    then aggregate over dates: median on_time_rate, median bunching_rate per (route_id, stop_id, direction_id).
    """
    df_h = df[(df["local_hour"] >= hour) & (df["local_hour"] < hour + 1)].copy()
    if df_h.empty:
        return _empty_agg_stop_by_route()
    metrics_h = compute_stop_metrics(df_h)
    return aggregate_stop_metrics_over_dates(metrics_h)


def export_route_metrics_json(
    metrics: pd.DataFrame,
    df: pd.DataFrame,
    route_id: str,
    out_path: Path,
) -> None:
    """
    Export { "overall": [...], "byHour": { "0": [...], "1": [...], ... } } for the given route.
    Each list item: stop_id, direction_id, time_point_order, on_time_rate, bunching_rate, n_obs.
    """
    route_metrics = metrics[metrics["route_id"] == route_id]
    overall_agg = aggregate_stop_metrics_over_dates(route_metrics)
    overall_list = [
        {
            "stop_id": row["stop_id"],
            "direction_id": str(row["direction_id"]),
            "time_point_order": int(row["time_point_order"]),
            "on_time_rate": float(row["on_time_rate"]) if not np.isnan(row["on_time_rate"]) else None,
            "bunching_rate": float(row["bunching_rate"]) if not np.isnan(row["bunching_rate"]) else None,
            "n_obs": int(row["n_obs"]),
        }
        for _, row in overall_agg.iterrows()
    ]

    by_hour: dict[str, list] = {}
    for hour in range(24):
        agg_h = compute_stop_metrics_by_hour(df, hour)
        if agg_h.empty or "route_id" not in agg_h.columns:
            continue
        agg_h = agg_h[agg_h["route_id"] == route_id]
        if agg_h.empty:
            continue
        by_hour[str(hour)] = [
            {
                "stop_id": row["stop_id"],
                "direction_id": str(row["direction_id"]),
                "time_point_order": int(row["time_point_order"]),
                "on_time_rate": float(row["on_time_rate"]) if not np.isnan(row["on_time_rate"]) else None,
                "bunching_rate": float(row["bunching_rate"]) if not np.isnan(row["bunching_rate"]) else None,
                "n_obs": int(row["n_obs"]),
            }
            for _, row in agg_h.iterrows()
        ]

    payload = {"overall": overall_list, "byHour": by_hour}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


# ---------------------------------------------------------------------------
# Trip-level: end-to-end duration (Schedule + Headway rows; see schedule_trip_dataframe)
# ---------------------------------------------------------------------------

def parse_service_date(s: str) -> pd.Timestamp:
    """Parse service_date from MBTA CSV (often YYYYMMDD or ISO)."""
    raw = str(s).strip()
    if not raw:
        return pd.NaT
    if len(raw) == 8 and raw.isdigit():
        return pd.to_datetime(raw, format="%Y%m%d", errors="coerce")
    return pd.to_datetime(raw, errors="coerce")


def _format_service_date_with_dow(s: object) -> str:
    """
    Format a service_date for x-axis labels with a weekday abbreviation, e.g.
    "2026-01-05 Mon". Falls back to the raw string when the date is unparseable.
    """
    raw = str(s).strip()
    ts = parse_service_date(raw)
    if pd.isna(ts):
        return raw
    return f"{ts.strftime('%Y-%m-%d')} ({ts.strftime('%a')})"


def schedule_trip_dataframe(df: pd.DataFrame, route_id: str) -> pd.DataFrame:
    """
    One row per time point per trip: dedupe on (date, direction, half_trip_id, time_point_order).

    MBTA CSVs use standard_type \"Schedule\" or \"Headway\" by route; headway-based routes are
    almost entirely \"Headway\" rows. We keep both and prefer \"Schedule\" when both exist for
    the same key so trip charts are not empty for routes like 28.
    """
    d = df[df["route_id"] == str(route_id)].copy()
    if d.empty:
        return d
    d["_st_ord"] = d["standard_type"].map({"Schedule": 0, "Headway": 1}).fillna(2).astype(int)
    d = d.sort_values("_st_ord", kind="stable")
    d = d.drop_duplicates(
        subset=["service_date", "direction_id", "half_trip_id", "time_point_order"],
        keep="first",
    )
    d = d.drop(columns=["_st_ord"], errors="ignore")
    d["_dt"] = d["service_date"].map(parse_service_date)
    return d


def collect_route_trip_summaries(df_sched: pd.DataFrame) -> pd.DataFrame:
    """
    One row per half_trip_id: actual trip duration (min), scheduled duration, delayed flag.
    Delayed = actual end-to-end time exceeds scheduled by more than TRIP_DELAY_THRESHOLD_SEC.
    """
    rows: list[dict] = []
    for (service_date, direction_id, half_trip_id), g in df_sched.groupby(
        ["service_date", "direction_id", "half_trip_id"], sort=False
    ):
        g = g.sort_values("time_point_order")
        if len(g) < 2:
            continue
        a0, a1 = float(g["actual_sec"].iloc[0]), float(g["actual_sec"].iloc[-1])
        s0, s1 = float(g["scheduled_sec"].iloc[0]), float(g["scheduled_sec"].iloc[-1])
        if a1 < a0 or s1 <= s0:
            continue
        act_sec = a1 - a0
        sched_sec = s1 - s0
        rows.append(
            {
                "service_date": service_date,
                "direction_id": direction_id,
                "half_trip_id": half_trip_id,
                "_dt": parse_service_date(service_date),
                "first_sched_sec": s0,
                "trip_min": act_sec / 60.0,
                "sched_trip_min": sched_sec / 60.0,
                "delayed": (act_sec - sched_sec) > TRIP_DELAY_THRESHOLD_SEC,
            }
        )
    if not rows:
        return pd.DataFrame(
            columns=[
                "service_date",
                "direction_id",
                "half_trip_id",
                "_dt",
                "first_sched_sec",
                "trip_min",
                "sched_trip_min",
                "delayed",
            ]
        )
    return pd.DataFrame(rows)


# GTFS-style 0/1 and MBTA CSV text labels both appear in arrival/departure files.
_TRIP_OUTBOUND_IDS = frozenset({"0", "outbound"})
_TRIP_INBOUND_IDS = frozenset({"1", "inbound"})


def _trip_direction_norm_ids(s: pd.Series) -> pd.Series:
    """Lowercase tokens for grouping trip rows into outbound vs inbound charts."""
    x = s.astype(str).str.strip().str.lower()
    return x.replace({"0.0": "0", "1.0": "1", "nan": ""})


def print_route_trip_counts(trips: pd.DataFrame, route_id: str) -> None:
    """Log how many half-trips we plot (helps validate charts vs empty-looking graphs)."""
    t = trips.dropna(subset=["_dt"])
    if t.empty:
        print(f"Trip charts: no valid dates for route {route_id} (0 trips).")
        return
    day = t["_dt"].dt.normalize()
    per_day = t.groupby(day, sort=False).size()
    print(
        f"Trip charts (route {route_id}): {len(t)} half-trips total; "
        f"per service day — min={int(per_day.min())}, max={int(per_day.max())}, "
        f"median={per_day.median():.0f}, mean={per_day.mean():.1f}"
    )


def chart_route_trip_spikes_by_day(
    trips: pd.DataFrame,
    route_id: str,
    out_path: Path,
    direction_label: str | None = None,
) -> None:
    """
    Each trip = one vertical spike. X = calendar day + horizontal position from first scheduled
    time that day (so many trips do not stack on one line). Y = actual end-to-end trip time (min).
    Red if delayed vs scheduled (>3 min).
    If direction_label is set (e.g. \"Inbound\" / \"Outbound\"), it appears in the title.
    """
    t = trips.dropna(subset=["_dt"]).copy()
    dir_str = f" — {direction_label}" if direction_label else ""
    if t.empty:
        plt.figure(figsize=(10, 4))
        plt.text(0.5, 0.5, f"No trip duration data for route {route_id}{dir_str}", ha="center", va="center")
        plt.savefig(out_path, bbox_inches="tight", dpi=150)
        plt.close()
        return

    t["day"] = t["_dt"].dt.normalize()
    dates = sorted(t["day"].unique())
    xs: list[float] = []
    ys: list[float] = []
    colors: list[str] = []
    rng = np.random.default_rng(42)
    for day in dates:
        sub = t[t["day"] == day].sort_values("first_sched_sec")
        n = len(sub)
        base = mdates.date2num(pd.Timestamp(day))
        day_secs = sub["first_sched_sec"].to_numpy(dtype=float)
        frac = np.clip(day_secs / 86400.0, 0.0, 0.999)
        jitter = rng.uniform(-0.00025, 0.00025, size=n) if n else np.array([])
        xs_day = base + 0.02 + frac * 0.96 + jitter
        xs.extend(xs_day.tolist())
        ys.extend(sub["trip_min"].tolist())
        colors.extend(["#c0392b" if bool(d) else "#2c3e50" for d in sub["delayed"]])

    fig_w = max(10.0, len(dates) * 0.32)
    fig, ax = plt.subplots(figsize=(fig_w, 5.0))
    ax.vlines(xs, 0, ys, colors=colors, linewidth=0.85, alpha=0.88)
    ax.set_ylabel("Observed trip time (minutes, actual first→last time point)")
    ax.set_xlabel("Day (horizontal position within day ≈ first scheduled trip time)")
    ax.set_title(
        f"Route {route_id}{dir_str} — every half-trip (vertical spike)\n"
        f"Height = observed duration; red if >{TRIP_DELAY_THRESHOLD_SEC // 60} min longer than scheduled end-to-end"
    )
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(ax.xaxis.get_major_locator()))
    ax.grid(True, axis="y", alpha=0.35)
    ax.set_ylim(bottom=0)
    legend_elems = [
        Line2D([0], [0], color="#2c3e50", lw=2, label="Not delayed vs schedule"),
        Line2D([0], [0], color="#c0392b", lw=2, label=f"Delayed (>{TRIP_DELAY_THRESHOLD_SEC // 60} min over scheduled)"),
    ]
    ax.legend(handles=legend_elems, loc="upper right", fontsize=8)
    fig.autofmt_xdate()
    plt.tight_layout()
    plt.savefig(out_path, bbox_inches="tight", dpi=150)
    plt.close()


def _draw_month_calendar_grid(
    ax: plt.Axes,
    trips: pd.DataFrame,
    year: int,
    month: int,
    route_id: str,
    ymax: float,
) -> None:
    """Calendar grid: columns Mon–Sun, rows = weeks; each trip is a vertical line in its day cell."""
    weeks = calendar_mod.monthcalendar(year, month)
    n_weeks = len(weeks)
    sub = trips[(trips["_dt"].dt.year == year) & (trips["_dt"].dt.month == month)].copy()
    if ymax <= 0:
        ymax = 1.0

    # Vertical dividers at half-integers: weekday column di is centered on x=di (Mon=0 … Sun=6).
    for g in range(8):
        ax.axvline(g - 0.5, color="#dddddd", lw=0.8)
    for g in range(n_weeks + 1):
        ax.axhline(g - 0.5, color="#dddddd", lw=0.8)

    for wi, week in enumerate(weeks):
        y0 = float(n_weeks - 1 - wi)
        for di, dom in enumerate(week):
            if dom == 0:
                continue
            day_trips = sub[sub["_dt"].dt.day == dom].sort_values("first_sched_sec")
            n = len(day_trips)
            if n == 0:
                continue
            # Center spikes on the column midline (integer di); spread horizontally within the cell.
            half_span = 0.42
            if n == 1:
                x_positions = np.array([float(di)], dtype=float)
            else:
                x_positions = np.linspace(float(di) - half_span, float(di) + half_span, n)
            for x, (_, tr) in zip(x_positions, day_trips.iterrows()):
                h = float(tr["trip_min"]) / ymax * 0.88
                color = "#c0392b" if bool(tr["delayed"]) else "#2c3e50"
                ax.plot([x, x], [y0, y0 + h], color=color, lw=1.1, solid_capstyle="round", alpha=0.9)

    ax.set_xlim(-0.5, 6.5)
    ax.set_ylim(-0.5, float(n_weeks) + 0.5)
    ax.set_xticks(range(7))
    ax.set_xticklabels(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    ax.set_yticks([])
    ax.set_title(f"{year}-{month:02d} (top row = first week)", fontsize=10, fontweight="bold")
    ax.set_xlabel("Weekday")


def chart_route_trip_calendar_vertical(
    trips: pd.DataFrame,
    route_id: str,
    out_path: Path,
    direction_label: str | None = None,
) -> None:
    """
    Month calendar: weekdays as columns, week rows as in a wall calendar; trips on a day are
    parallel vertical lines in that cell (height = trip time vs global max for the figure).
    If direction_label is provided it is shown in the title (e.g. "Inbound" / "Outbound").
    """
    t = trips.dropna(subset=["_dt"]).copy()
    dir_str = f" — {direction_label}" if direction_label else ""
    if t.empty:
        plt.figure(figsize=(10, 4))
        plt.text(0.5, 0.5, f"No trip data for route {route_id}{dir_str}", ha="center", va="center")
        plt.savefig(out_path, bbox_inches="tight", dpi=150)
        plt.close()
        return

    ymax = float(t["trip_min"].max()) if len(t) else 1.0
    periods = sorted(t["_dt"].dt.to_period("M").unique().tolist())
    n_m = len(periods)
    fig_w = 6.5 * n_m
    fig_h = 7.5
    fig, axes = plt.subplots(1, n_m, figsize=(fig_w, fig_h), squeeze=False)
    for ax, per in zip(axes.flat, periods):
        _draw_month_calendar_grid(ax, t, per.year, per.month, route_id, ymax)

    fig.suptitle(
        f"Route {route_id}{dir_str} — calendar (spike height ∝ observed trip time; red = >{TRIP_DELAY_THRESHOLD_SEC // 60} min over scheduled end-to-end)",
        fontsize=11,
        y=1.02,
    )
    legend_elems = [
        Line2D([0], [0], color="#2c3e50", lw=2, label="Not delayed"),
        Line2D([0], [0], color="#c0392b", lw=2, label=f"Delayed >{TRIP_DELAY_THRESHOLD_SEC // 60} min"),
    ]
    fig.legend(handles=legend_elems, loc="upper right", fontsize=9, bbox_to_anchor=(1.0, 1.08))
    plt.tight_layout()
    plt.savefig(out_path, bbox_inches="tight", dpi=150)
    plt.close()


# ---------------------------------------------------------------------------
# Step 4: Generate visualizations
# ---------------------------------------------------------------------------

def heatmap_stop_date(
    metrics: pd.DataFrame,
    route_id: str,
    value_col: str,
    title: str,
    ylabel: str,
    out_path: Path,
    cmap: str = "RdYlGn",
    vmin: float | None = None,
    vmax: float | None = None,
    stop_names: dict[str, str] | None = None,
    stops_txt_path: Path | None = None,
) -> None:
    """
    Pivot (stop_id, service_date) -> value_col and draw heatmap.
    For on_time_rate, higher is better (green); for bunching_rate, lower is better (we'll invert or use reversed cmap).
    If stop_names is provided, y-axis shows stop names instead of stop_id.
    For route 1, pass stops_txt_path so GTFS siblings (trips/stop_times) can fix Y-axis order.
    """
    route_metrics = metrics[metrics["route_id"] == route_id].copy()
    route_metrics = route_metrics[route_metrics["n_obs"] >= MIN_SAMPLES_FOR_RATE]
    if route_metrics.empty:
        plt.figure(figsize=(10, 4))
        plt.text(0.5, 0.5, f"No data for route {route_id}", ha="center", va="center")
        plt.savefig(out_path, bbox_inches="tight", dpi=150)
        plt.close()
        return

    rid = route_id.strip()

    # ----- Route 28: split inbound vs outbound rows -----
    # Pivot includes direction so that stop_ids shared by both directions
    # (Mattapan, Nubian, Ruggles) render as two separate rows. Y-axis is locked
    # to the inbound corridor (Mattapan → Ruggles) followed by the outbound
    # corridor (Ruggles → Mattapan). Stops without CSV data are still kept so
    # the corridor order is fully preserved.
    if rid == "28":
        rm = route_metrics.copy()
        rm["direction_norm"] = rm["direction_id"].map(_norm_direction_token)
        # Collapse alias stop_ids (e.g. 17865 -> 17862 for outbound Ruggles in
        # 2026-04+) so platform reassignments don't blank out corridor rows.
        rm["stop_id"] = rm["stop_id"].map(canonicalize_route28_stop_id)
        pivot = rm.pivot_table(
            index=["direction_norm", "stop_id"],
            columns="service_date",
            values=value_col,
            aggfunc="mean",
        )
        full_order = route28_corridor_row_index()
        pivot = pivot.reindex(full_order)
        # Drop corridor rows that have no observations on any service date so
        # the heatmap doesn't waste vertical space on empty stops. The
        # remaining rows still follow corridor order.
        pivot = pivot.dropna(how="all")
    else:
        pivot = route_metrics.pivot_table(
            index="stop_id", columns="service_date", values=value_col, aggfunc="mean"
        )

        axis: list[str] | None = None
        # Route 1 uses the GTFS longest-trip stop order as its heatmap axis;
        # all other routes fall through to the (direction_id, time_point_order)
        # ordering computed from CSV metrics below. To enable longest-trip
        # ordering for additional routes, just widen this gate (the helper is
        # generic — it takes any route short name).
        if rid == "1":
            gdir = stops_txt_path.parent if stops_txt_path else None
            axis = gtfs_longest_trip_stop_order(gdir, rid)

        if axis is not None:
            axis_set = set(axis)
            full_order = list(axis) + [s for s in pivot.index if s not in axis_set]
            pivot = pivot.reindex(full_order)
        else:
            # Order stops by (direction_id, time_point_order) then by stop_id for stable heatmap
            stop_order_df = (
                route_metrics.groupby(["stop_id", "direction_id"])["time_point_order"].min().reset_index()
                .sort_values(["direction_id", "time_point_order"])
            )
            stop_order = list(dict.fromkeys(stop_order_df["stop_id"].tolist()))
            stop_order = [s for s in stop_order if s in route_metrics["stop_id"].unique()]
            if not stop_order:
                stop_order = list(route_metrics["stop_id"].unique())
            route_metrics["stop_ord"] = route_metrics["stop_id"].astype("category").cat.set_categories(
                stop_order, ordered=True
            )
            route_metrics = route_metrics.sort_values(["stop_ord", "service_date"])
            pivot = route_metrics.pivot_table(
                index="stop_id", columns="service_date", values=value_col, aggfunc="mean"
            )
            pivot = pivot.reindex([s for s in stop_order if s in pivot.index])

    if pivot.empty or pivot.size == 0:
        plt.figure(figsize=(10, 4))
        plt.text(0.5, 0.5, f"No pivot data for route {route_id}", ha="center", va="center")
        plt.savefig(out_path, bbox_inches="tight", dpi=150)
        plt.close()
        return

    n_stops = pivot.shape[0]
    n_dates = pivot.shape[1]
    # Height: enough for each stop so labels don't overlap (min ~0.22 in per row for text)
    fig_h = max(6, n_stops * 0.22)
    fig_w = max(10, n_dates * 0.4)
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    if value_col == "bunching_rate":
        # Lower is better: use reversed colormap
        cmap = plt.get_cmap(cmap).reversed()
        if vmin is None:
            vmin = 0
        if vmax is None:
            vmax = 0.5
    else:
        if vmin is None:
            vmin = 0
        if vmax is None:
            vmax = 1.0
    im = ax.imshow(pivot.values, aspect="auto", cmap=cmap, vmin=vmin, vmax=vmax)
    ax.set_yticks(np.arange(n_stops))
    # Y-axis labels:
    # - Route 28 rows are (direction, stop_id); show "Inbound: <corridor name>".
    # - Other routes are stop_id only; fall back to GTFS stop_name then stop_id.
    if rid == "28":
        corridor_names = route28_corridor_name_overrides()
        y_labels = []
        first_outbound_row: int | None = None
        for i, entry in enumerate(pivot.index.tolist()):
            direction, sid = entry  # MultiIndex tuple
            name = (
                corridor_names.get(sid)
                or (stop_names.get(sid, sid) if stop_names else sid)
            )
            y_labels.append(f"{direction}: {name}")
            if direction == "Outbound" and first_outbound_row is None:
                first_outbound_row = i
        if first_outbound_row is not None:
            ax.axhline(first_outbound_row - 0.5, color="#222", linewidth=1.0, alpha=0.7)
    else:
        y_labels = [
            (stop_names.get(sid, sid) if stop_names else sid)
            for sid in pivot.index.tolist()
        ]
    # Scale font size so labels fit: smaller when many stops
    y_fontsize = max(5, min(9, 120 // max(1, n_stops)))
    ax.set_yticklabels(y_labels, fontsize=y_fontsize)
    ax.set_xticks(np.arange(n_dates))
    ax.set_xticklabels(
        [_format_service_date_with_dow(d) for d in pivot.columns.tolist()],
        rotation=45,
        ha="right",
        fontsize=6,
    )
    ax.set_xlabel("Service date")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    plt.colorbar(im, ax=ax, label=value_col.replace("_", " ").title())
    plt.tight_layout()
    # Leave room for y-axis labels (especially long stop names)
    plt.subplots_adjust(left=0.22)
    plt.savefig(out_path, bbox_inches="tight", dpi=150)
    plt.close()


def heatmap_stop_hour(
    metrics: pd.DataFrame,
    df: pd.DataFrame,
    route_id: str,
    value_col: str,
    title: str,
    out_path: Path,
    cmap: str = "RdYlGn",
    vmin: float | None = None,
    vmax: float | None = None,
    stop_names: dict[str, str] | None = None,
) -> None:
    """
    Heatmap: rows = stops (ordered by direction + time_point_order), columns = hour of day (0-23).
    Value = median metric for that stop in that hour over the month.
    Saves to out_path (same directory as other analysis outputs).
    """
    # Canonical stop order from overall aggregates (direction, time_point_order)
    route_metrics = metrics[metrics["route_id"] == route_id]
    route_metrics = route_metrics[route_metrics["n_obs"] >= MIN_SAMPLES_FOR_RATE]
    if route_metrics.empty:
        plt.figure(figsize=(12, 4))
        plt.text(0.5, 0.5, f"No data for route {route_id}", ha="center", va="center")
        plt.savefig(out_path, bbox_inches="tight", dpi=150)
        plt.close()
        return

    rid = str(route_id).strip()
    if rid == "28":
        # Route 28: lock Y axis to inbound corridor (Mattapan→Ruggles) followed
        # by outbound corridor (Ruggles→Mattapan). Direction tokens normalize
        # both 'Inbound'/'Outbound' (CSV) and '0'/'1' (GTFS) to the same labels.
        row_index = route28_corridor_row_index()
    else:
        stop_order_df = (
            route_metrics.groupby(["stop_id", "direction_id"])["time_point_order"].min().reset_index()
            .sort_values(["direction_id", "time_point_order"])
        )
        row_index = list(zip(stop_order_df["direction_id"].tolist(), stop_order_df["stop_id"].tolist()))

    # Build matrix: (direction_id, stop_id) x hour -> value
    rows_data: list[dict] = []
    for hour in range(24):
        agg_h = compute_stop_metrics_by_hour(df, hour)
        if agg_h.empty or "route_id" not in agg_h.columns:
            continue
        agg_h = agg_h[agg_h["route_id"] == route_id]
        for _, row in agg_h.iterrows():
            direction_key = (
                _norm_direction_token(row["direction_id"]) if rid == "28" else row["direction_id"]
            )
            sid_key = (
                canonicalize_route28_stop_id(row["stop_id"]) if rid == "28" else row["stop_id"]
            )
            rows_data.append({
                "direction_id": direction_key,
                "stop_id": sid_key,
                "time_point_order": row["time_point_order"],
                "hour": hour,
                value_col: row[value_col],
            })

    if not rows_data:
        plt.figure(figsize=(12, 4))
        plt.text(0.5, 0.5, f"No by-hour data for route {route_id}", ha="center", va="center")
        plt.savefig(out_path, bbox_inches="tight", dpi=150)
        plt.close()
        return

    build = pd.DataFrame(rows_data)
    pivot = build.pivot_table(
        index=["direction_id", "stop_id"],
        columns="hour",
        values=value_col,
        aggfunc="mean",
    )
    # Order rows to match route order, then drop rows with no observations.
    pivot = pivot.reindex(row_index)
    pivot = pivot.dropna(how="all")
    if pivot.empty or pivot.size == 0:
        plt.figure(figsize=(12, 4))
        plt.text(0.5, 0.5, f"No pivot for route {route_id} by hour", ha="center", va="center")
        plt.savefig(out_path, bbox_inches="tight", dpi=150)
        plt.close()
        return

    n_stops = pivot.shape[0]
    n_hours = pivot.shape[1]
    fig_h = max(6, n_stops * 0.2)
    fig_w = max(10, n_hours * 0.45)
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))

    if value_col == "bunching_rate":
        cmap = plt.get_cmap(cmap).reversed()
        if vmin is None:
            vmin = 0
        if vmax is None:
            vmax = 0.5
    else:
        if vmin is None:
            vmin = 0
        if vmax is None:
            vmax = 1.0

    im = ax.imshow(pivot.values, aspect="auto", cmap=cmap, vmin=vmin, vmax=vmax)
    ax.set_yticks(np.arange(n_stops))
    corridor_names = route28_corridor_name_overrides() if rid == "28" else {}
    y_labels = []
    first_outbound_row: int | None = None
    for i, (direction_id, stop_id) in enumerate(pivot.index):
        name = (
            corridor_names.get(stop_id)
            or (stop_names.get(stop_id, stop_id) if stop_names else stop_id)
        )
        dir_label = _norm_direction_token(direction_id) if rid == "28" else (
            "Inbound" if str(direction_id) in ("1", "Inbound") else "Outbound"
        )
        y_labels.append(f"{dir_label}: {name}")
        if rid == "28" and dir_label == "Outbound" and first_outbound_row is None:
            first_outbound_row = i
    if first_outbound_row is not None:
        ax.axhline(first_outbound_row - 0.5, color="#222", linewidth=1.0, alpha=0.7)
    y_fontsize = max(5, min(9, 140 // max(1, n_stops)))
    ax.set_yticklabels(y_labels, fontsize=y_fontsize)
    ax.set_xticks(np.arange(n_hours))
    ax.set_xticklabels([f"{h}" for h in pivot.columns], fontsize=7)
    ax.set_xlabel("Hour of day")
    ax.set_ylabel("Stop")
    ax.set_title(title)
    plt.colorbar(im, ax=ax, label=value_col.replace("_", " ").title())
    plt.tight_layout()
    plt.subplots_adjust(left=0.28)
    plt.savefig(out_path, bbox_inches="tight", dpi=150)
    plt.close()


def route_comparison_chart(metrics: pd.DataFrame, output_dir: Path, focus_route: str = FOCUS_ROUTE, month_tag: str = "") -> None:
    """Bar chart: route-level median on_time_rate and median bunching_rate for focus vs comparison routes."""
    route_agg = (
        metrics.groupby("route_id")
        .agg(
            on_time_rate=("on_time_rate", "median"),
            bunching_rate=("bunching_rate", "median"),
            n_stop_days=("on_time_rate", "count"),
        )
        .reset_index()
    )
    route_agg = route_agg[route_agg["n_stop_days"] >= 10]  # at least some coverage
    if route_agg.empty:
        return

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4))
    routes = route_agg["route_id"].tolist()
    x = np.arange(len(routes))
    width = 0.35

    ax1.bar(x, route_agg["on_time_rate"], color="steelblue", edgecolor="black")
    ax1.set_ylabel("Median on-time rate")
    ax1.set_xticks(x)
    ax1.set_xticklabels(routes)
    ax1.set_title("On-time performance by route")
    ax1.set_ylim(0, 1.05)

    ax2.bar(x, route_agg["bunching_rate"], color="coral", edgecolor="black")
    ax2.set_ylabel("Median bunching rate")
    ax2.set_xticks(x)
    ax2.set_xticklabels(routes)
    ax2.set_title("Bunching rate by route")
    ax2.set_ylim(0, min(1.0, route_agg["bunching_rate"].max() * 1.2) if route_agg["bunching_rate"].max() > 0 else 1.05)

    plt.suptitle(f"Route {focus_route} vs comparison routes ({month_tag or 'monthly'} stop-day aggregates)")
    plt.tight_layout()
    suffix = f"_{month_tag}" if month_tag else ""
    plt.savefig(output_dir / f"route_comparison{suffix}.png", bbox_inches="tight", dpi=150)
    plt.close()


# ---------------------------------------------------------------------------
# Step 5: Textual summary
# ---------------------------------------------------------------------------

def print_summary(df: pd.DataFrame, metrics: pd.DataFrame, focus_route: str) -> None:
    """Print a short summary of key findings."""
    print("\n" + "=" * 60)
    print(f"ROUTE {focus_route} BUS BUNCHING & ON-TIME ANALYSIS — SUMMARY")
    print("=" * 60)
    print(f"\nDefinitions:")
    print(f"  - On-time: actual arrival within [scheduled - {ON_TIME_EARLY_MIN} min, scheduled + {ON_TIME_LATE_MIN} min].")
    print(f"  - Bunching: actual headway < min(50% of scheduled headway, 4 min).")
    print(f"  - Rates computed only for stop-days with >={MIN_SAMPLES_FOR_RATE} observations.")

    dates = df["service_date"].unique()
    print(f"\nData: {len(df):,} rows, {len(dates)} dates, routes: {sorted(df['route_id'].unique().tolist())}.")

    m28 = metrics[metrics["route_id"] == focus_route]
    if m28.empty:
        print(f"\nNo metrics for route {focus_route}.")
        return

    n_stop_days = len(m28)
    m28_valid = m28[m28["n_obs"] >= MIN_SAMPLES_FOR_RATE]
    if not m28_valid.empty:
        med_ot = m28_valid["on_time_rate"].median()
        med_bunch = m28_valid["bunching_rate"].median()
        print(f"\nRoute {focus_route}:")
        print(f"  - Stop-days with sufficient data: {len(m28_valid)}.")
        print(f"  - Median on-time rate: {med_ot:.1%}.")
        print(f"  - Median bunching rate: {med_bunch:.1%}.")

    others = metrics[metrics["route_id"] != focus_route]
    if not others.empty:
        other_agg = others.groupby("route_id").agg(
            on_time_rate=("on_time_rate", "median"),
            bunching_rate=("bunching_rate", "median"),
        ).reset_index()
        print("\nComparison routes (median on-time / bunching):")
        for _, r in other_agg.iterrows():
            print(f"  - Route {r['route_id']}: on-time {r['on_time_rate']:.1%}, bunching {r['bunching_rate']:.1%}.")

    # Worst stops by bunching (focus route)
    if not m28_valid.empty and "bunching_rate" in m28_valid.columns:
        worst = m28_valid.nlargest(5, "bunching_rate")[["stop_id", "bunching_rate", "n_obs"]].drop_duplicates("stop_id")
        print(f"\nRoute {focus_route} — stops with highest bunching rate (sample):")
        for _, r in worst.head(5).iterrows():
            print(f"  - Stop {r['stop_id']}: bunching rate {r['bunching_rate']:.1%} (n={int(r['n_obs'])})")

    print("\n" + "=" * 60)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    """
    CLI entry: load the MBTA arrival/departure CSV for the chosen month, run
    every analysis step, and write the resulting PNGs + per-route JSON
    metrics to `--output-dir` (default `analysis_output/`).

    Returns 0 on success, 1 if the CSV could not be found.
    """
    parser = argparse.ArgumentParser(
        description="Analyze MBTA bus bunching and on-time performance from MBTA arrival/departure CSV."
    )
    parser.add_argument(
        "--csv",
        type=str,
        default=None,
        help="Path to MBTA Bus Arrival/Departure CSV. If not set, script looks in school-scorecard/data/mbta-bus/ and data/mbta-bus/.",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="analysis_output",
        help="Directory to save charts (default: analysis_output).",
    )
    parser.add_argument(
        "--month",
        type=str,
        default="2026-01",
        help="Month for default CSV filename, e.g. 2026-01 (used only when --csv is not set).",
    )
    parser.add_argument(
        "--stops",
        type=str,
        default=None,
        help="Path to GTFS stops.txt for stop names on heatmap. If not set, looks in school-scorecard/data/gtfs, data/gtfs, etc.",
    )
    parser.add_argument(
        "--focus-route",
        type=str,
        default=FOCUS_ROUTE,
        help=f"Route id for heatmaps, trip charts, and summary (default: {FOCUS_ROUTE}).",
    )
    args = parser.parse_args()
    focus = str(args.focus_route).strip()

    csv_path = find_csv(args.csv, args.month)
    if csv_path is None:
        print("Error: CSV file not found. Set --csv PATH or place MBTA-Bus-Arrival-Departure-Times_YYYY-MM.csv in school-scorecard/data/mbta-bus/ or data/mbta-bus/.", file=sys.stderr)
        return 1

    print(f"Loading CSV: {csv_path}")
    df = load_and_clean(csv_path)
    print(f"Loaded {len(df):,} rows after cleaning.")

    df = filter_routes(df, focus=focus, comparison=COMPARISON_ROUTES)
    print(f"Filtered to routes {focus} and {COMPARISON_ROUTES}: {len(df):,} rows.")

    metrics = compute_stop_metrics(df)
    print(f"Computed metrics for {len(metrics):,} stop-date combinations.")

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    month_tag = args.month

    stop_names: dict[str, str] = {}
    stops_path = find_stops_txt(args.stops)
    if stops_path:
        stop_names = load_stop_names(stops_path)
        print(f"Loaded {len(stop_names)} stop names from {stops_path}.")
    else:
        print("No stops.txt found; heatmaps will use stop IDs. Use --stops PATH to provide GTFS stops.txt.")

    # Sanity-check the Route 28 corridor against the loaded GTFS stops.
    if focus == "28":
        validate_route28_corridor(stop_names)

    heatmap_stop_date(
        metrics,
        focus,
        "on_time_rate",
        title=f"Route {focus} ({month_tag}) — Stop-level on-time rate by date",
        ylabel="Stop",
        out_path=out_dir / f"route{focus}_{month_tag}_on_time_heatmap.png",
        vmin=0,
        vmax=1,
        stop_names=stop_names,
        stops_txt_path=stops_path,
    )
    heatmap_stop_date(
        metrics,
        focus,
        "bunching_rate",
        title=f"Route {focus} ({month_tag}) — Bunching rate by stop and date",
        ylabel="Stop",
        out_path=out_dir / f"route{focus}_{month_tag}_bunching_heatmap.png",
        cmap="RdYlGn",
        vmin=0,
        vmax=0.5,
        stop_names=stop_names,
        stops_txt_path=stops_path,
    )
    heatmap_stop_hour(
        metrics,
        df,
        focus,
        "on_time_rate",
        title=f"Route {focus} ({month_tag}) — On-time rate by time of day",
        out_path=out_dir / f"route{focus}_{month_tag}_on_time_by_time.png",
        vmin=0,
        vmax=1,
        stop_names=stop_names,
    )
    heatmap_stop_hour(
        metrics,
        df,
        focus,
        "bunching_rate",
        title=f"Route {focus} ({month_tag}) — Bunching rate by time of day",
        out_path=out_dir / f"route{focus}_{month_tag}_bunching_by_time.png",
        cmap="RdYlGn",
        vmin=0,
        vmax=0.5,
        stop_names=stop_names,
    )
    route_comparison_chart(metrics, out_dir, focus_route=focus, month_tag=month_tag)

    df_focus_sched = schedule_trip_dataframe(df, focus)
    if not df_focus_sched.empty:
        trips_focus = collect_route_trip_summaries(df_focus_sched)
        print_route_trip_counts(trips_focus, focus)
        if not trips_focus.empty:
            dn = _trip_direction_norm_ids(trips_focus["direction_id"])
            wrote_paths: list[str] = []
            for dir_label, key_set in [("outbound", _TRIP_OUTBOUND_IDS), ("inbound", _TRIP_INBOUND_IDS)]:
                dir_trips = trips_focus[dn.isin(key_set)].copy()
                if dir_trips.empty:
                    continue
                spike_path = out_dir / f"route{focus}_{month_tag}_trip_spikes_{dir_label}.png"
                cal_path = out_dir / f"route{focus}_{month_tag}_trip_calendar_{dir_label}.png"
                chart_route_trip_spikes_by_day(
                    dir_trips,
                    focus,
                    spike_path,
                    direction_label=dir_label.capitalize(),
                )
                chart_route_trip_calendar_vertical(
                    dir_trips,
                    route_id=focus,
                    out_path=cal_path,
                    direction_label=dir_label.capitalize(),
                )
                wrote_paths.append(str(spike_path.name))
                wrote_paths.append(str(cal_path.name))
            if wrote_paths:
                print(f"Wrote trip charts: {', '.join(wrote_paths)}")
            else:
                sample = sorted({str(v) for v in trips_focus["direction_id"].dropna().unique().tolist()})[:12]
                print(
                    "Warning: no inbound/outbound trip spike or calendar files were written "
                    f"(unrecognized direction_id values in data: {sample}).",
                    file=sys.stderr,
                )

    print(f"Charts saved to {out_dir.absolute()}.")

    # Export stop-level metrics JSON (overall + byHour) for map overlay
    for rid in [focus] + [r for r in COMPARISON_ROUTES if r != focus]:
        if metrics[metrics["route_id"] == rid].empty:
            continue
        export_route_metrics_json(metrics, df, rid, out_dir / f"route{rid}_{month_tag}_stop_metrics.json")
    print(f"Exported stop metrics JSON to {out_dir.absolute()}.")

    print_summary(df, metrics, focus)
    return 0


if __name__ == "__main__":
    sys.exit(main())
