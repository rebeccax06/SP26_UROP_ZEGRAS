#!/usr/bin/env python3
"""
Standalone helper that writes an Overpass QL query file for one region.

The same query template is used by `LTS_OSM.build_query` during the normal
pipeline; this script just exposes it as a one-shot CLI when you want to
generate the .query file without running the full LTS workflow.

Usage:
    python build_query.py <region> [<key>] [<value>]

Example:
    python build_query.py eastyork wikidata Q167585
"""
import argparse
from pathlib import Path

QUERY_TEMPLATE = """\
[timeout:600][out:json][maxsize:2000000000];
area["{key}"="{value}"]->.search_area;
.search_area out body;

(
    way[highway][footway!=sidewalk][service!=parking_aisle](area.search_area);
    way[footway=sidewalk][bicycle][bicycle!=no][bicycle!=dismount](area.search_area);
);
out;
"""


def build_query(region, key, value):
    """Write `query/{region}.query` for the given OSM relation lookup. Skips if it exists."""
    filepath = Path('query') / f'{region}.query'
    filepath.parent.mkdir(exist_ok=True)
    if filepath.exists():
        print(f"{region} query already exists")
        return

    filepath.write_text(QUERY_TEMPLATE.format(key=key, value=value))
    print(f'{filepath} created')


def main():
    parser = argparse.ArgumentParser(
        description='Build an OSM Overpass query file for a region.',
    )
    parser.add_argument('region', type=str,
                        help='Name of the region (used as the query filename).')
    parser.add_argument('key', type=str, default="wikidata", nargs='?',
                        help='OSM key for the relation lookup (default: wikidata).')
    parser.add_argument('value', type=str, nargs='?',
                        help='OSM value for the relation lookup.')

    args = parser.parse_args()
    build_query(args.region, args.key, args.value)


if __name__ == "__main__":
    main()
