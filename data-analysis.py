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

Dependencies: pandas, numpy, matplotlib (e.g. pip install pandas numpy matplotlib).

Usage:
  python data-analysis.py [--csv PATH] [--output-dir DIR] [--month YYYY-MM]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

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

CSV_COLUMNS = [
    "service_date", "route_id", "direction_id", "half_trip_id", "stop_id",
    "time_point_id", "time_point_order", "point_type", "standard_type",
    "scheduled", "actual", "scheduled_headway", "headway",
]


def parse_ts_to_seconds(ts: str) -> float:
    """Parse ISO-like time '1900-01-01THH:MM:SSZ' to seconds since midnight. Returns -1 if invalid."""
    if pd.isna(ts) or not ts or not isinstance(ts, str):
        return -1.0
    parts = ts.strip().split("T")
    if len(parts) < 2:
        return -1.0
    time_part = parts[1].rstrip("Z").strip()
    hms = time_part.split(":")
    if len(hms) != 3:
        return -1.0
    try:
        h, m, s = int(hms[0]), int(hms[1]), int(hms[2])
        return h * 3600 + m * 60 + s
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

    # Fill actual_headway from consecutive actual times when CSV headway is missing
    def fill_actual_headway(g: pd.DataFrame) -> pd.Series:
        out = g["actual_headway_sec"].astype(float).copy()
        diff = g["actual_sec"].diff()
        mask = (diff > 0) & ((out < 0) | out.isna())
        out.loc[mask] = diff.loc[mask]
        return out

    df["actual_headway_sec"] = (
        df.groupby(["route_id", "stop_id", "direction_id", "service_date"], group_keys=False)
        .apply(fill_actual_headway)
    )
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
        time_point_order = int(g["time_point_order"].min()) if "time_point_order" in g.columns else 0

        # On-time
        on_time = g.apply(lambda r: is_on_time(r["actual_sec"], r["scheduled_sec"]), axis=1)
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

    return pd.DataFrame(rows)


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
) -> None:
    """
    Pivot (stop_id, service_date) -> value_col and draw heatmap.
    For on_time_rate, higher is better (green); for bunching_rate, lower is better (we'll invert or use reversed cmap).
    If stop_names is provided, y-axis shows stop names instead of stop_id.
    """
    route_metrics = metrics[metrics["route_id"] == route_id].copy()
    route_metrics = route_metrics[route_metrics["n_obs"] >= MIN_SAMPLES_FOR_RATE]
    if route_metrics.empty:
        plt.figure(figsize=(10, 4))
        plt.text(0.5, 0.5, f"No data for route {route_id}", ha="center", va="center")
        plt.savefig(out_path, bbox_inches="tight", dpi=150)
        plt.close()
        return

    # Order stops by (direction_id, time_point_order) then by stop_id for stable heatmap
    stop_order_df = (
        route_metrics.groupby(["stop_id", "direction_id"])["time_point_order"].min().reset_index()
        .sort_values(["direction_id", "time_point_order"])
    )
    stop_order = list(dict.fromkeys(stop_order_df["stop_id"].tolist()))
    stop_order = [s for s in stop_order if s in route_metrics["stop_id"].unique()]
    if not stop_order:
        stop_order = route_metrics["stop_id"].unique().tolist()
    route_metrics["stop_ord"] = route_metrics["stop_id"].astype("category").cat.set_categories(stop_order, ordered=True)
    route_metrics = route_metrics.sort_values(["stop_ord", "service_date"])

    pivot = route_metrics.pivot_table(
        index="stop_id", columns="service_date", values=value_col, aggfunc="mean"
    )
    # Reindex to stop_order so heatmap order is stable
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
    # Use stop names when available; fall back to stop_id
    y_labels = [
        (stop_names.get(sid, sid) if stop_names else sid)
        for sid in pivot.index.tolist()
    ]
    # Scale font size so labels fit: smaller when many stops
    y_fontsize = max(5, min(9, 120 // max(1, n_stops)))
    ax.set_yticklabels(y_labels, fontsize=y_fontsize)
    ax.set_xticks(np.arange(n_dates))
    ax.set_xticklabels(pivot.columns.tolist(), rotation=45, ha="right", fontsize=6)
    ax.set_xlabel("Service date")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    plt.colorbar(im, ax=ax, label=value_col.replace("_", " ").title())
    plt.tight_layout()
    # Leave room for y-axis labels (especially long stop names)
    plt.subplots_adjust(left=0.22)
    plt.savefig(out_path, bbox_inches="tight", dpi=150)
    plt.close()


def route_comparison_chart(metrics: pd.DataFrame, output_dir: Path) -> None:
    """Bar chart: route-level median on_time_rate and median bunching_rate for Route 28 vs comparison routes."""
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

    plt.suptitle("Route 28 vs comparison routes (monthly stop-day aggregates)")
    plt.tight_layout()
    plt.savefig(output_dir / "route_comparison.png", bbox_inches="tight", dpi=150)
    plt.close()


# ---------------------------------------------------------------------------
# Step 5: Textual summary
# ---------------------------------------------------------------------------

def print_summary(df: pd.DataFrame, metrics: pd.DataFrame, focus_route: str) -> None:
    """Print a short summary of key findings."""
    print("\n" + "=" * 60)
    print("ROUTE 28 BUS BUNCHING & ON-TIME ANALYSIS — SUMMARY")
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
        print(f"\nRoute 28:")
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

    # Worst stops by bunching (Route 28)
    if not m28_valid.empty and "bunching_rate" in m28_valid.columns:
        worst = m28_valid.nlargest(5, "bunching_rate")[["stop_id", "bunching_rate", "n_obs"]].drop_duplicates("stop_id")
        print("\nRoute 28 — stops with highest bunching rate (sample):")
        for _, r in worst.head(5).iterrows():
            print(f"  - Stop {r['stop_id']}: bunching rate {r['bunching_rate']:.1%} (n={int(r['n_obs'])})")

    print("\n" + "=" * 60)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Analyze Route 28 bus bunching and on-time performance from MBTA CSV."
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
    args = parser.parse_args()

    csv_path = find_csv(args.csv, args.month)
    if csv_path is None:
        print("Error: CSV file not found. Set --csv PATH or place MBTA-Bus-Arrival-Departure-Times_YYYY-MM.csv in school-scorecard/data/mbta-bus/ or data/mbta-bus/.", file=sys.stderr)
        return 1

    print(f"Loading CSV: {csv_path}")
    df = load_and_clean(csv_path)
    print(f"Loaded {len(df):,} rows after cleaning.")

    df = filter_routes(df, focus=FOCUS_ROUTE, comparison=COMPARISON_ROUTES)
    print(f"Filtered to routes {FOCUS_ROUTE} and {COMPARISON_ROUTES}: {len(df):,} rows.")

    metrics = compute_stop_metrics(df)
    print(f"Computed metrics for {len(metrics):,} stop-date combinations.")

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    stop_names: dict[str, str] = {}
    stops_path = find_stops_txt(args.stops)
    if stops_path:
        stop_names = load_stop_names(stops_path)
        print(f"Loaded {len(stop_names)} stop names from {stops_path}.")
    else:
        print("No stops.txt found; heatmaps will use stop IDs. Use --stops PATH to provide GTFS stops.txt.")

    heatmap_stop_date(
        metrics,
        FOCUS_ROUTE,
        "on_time_rate",
        title=f"Route {FOCUS_ROUTE} — Stop-level on-time rate by date",
        ylabel="Stop",
        out_path=out_dir / "route28_on_time_heatmap.png",
        vmin=0,
        vmax=1,
        stop_names=stop_names,
    )
    heatmap_stop_date(
        metrics,
        FOCUS_ROUTE,
        "bunching_rate",
        title=f"Route {FOCUS_ROUTE} — Bunching rate by stop and date",
        ylabel="Stop",
        out_path=out_dir / "route28_bunching_heatmap.png",
        cmap="RdYlGn",
        vmin=0,
        vmax=0.5,
        stop_names=stop_names,
    )
    route_comparison_chart(metrics, out_dir)
    print(f"Charts saved to {out_dir.absolute()}.")

    print_summary(df, metrics, FOCUS_ROUTE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
