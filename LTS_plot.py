"""
Render the LTS data computed by `LTS_OSM.py` into a Mapbox-ready GeoJSON.

Reads `data/{region}_4_all_lts.csv`, drops LTS=0 (unrated) edges, trims to
just the columns the map UI needs, and writes `plots/{region}_LTS.json`
(plus a working copy `plots/LTS.json` for the live web viewer).
"""
import shutil
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

dataFolder = 'data'
plotFolder = 'plots'

# Map LTS 0-4 to a color for the map legend. Index = LTS value.
ltsColors = ['grey', 'green', 'deepskyblue', 'orange', 'red']


def load_data(region):
    """
    Load the LTS CSV for `region` (or concatenate several) and add a `color`
    column matching `ltsColors[LTS]`.

    Accepts either a single region name or a list of names; in the list case
    each region's CSV is concatenated row-wise.
    """
    if isinstance(region, list):
        frames = []
        for r in region:
            dfr = pd.read_csv(f'{dataFolder}/{r}_4_all_lts.csv', low_memory=False)
            frames.append(dfr)
            print(f'{dfr.shape=} | {r}')
        df = pd.concat(frames)
    else:
        df = pd.read_csv(f'{dataFolder}/{region}_4_all_lts.csv', low_memory=False)

    geodf = gpd.GeoDataFrame(
        df.loc[:, [c for c in df.columns if c != "geometry"]],
        geometry=gpd.GeoSeries.from_wkt(df["geometry"]),
        crs='wgs84',
    )

    conditions = [(geodf['LTS'] == lts_value) for lts_value in range(5)]
    geodf['color'] = np.select(conditions, ltsColors, default='grey')

    return geodf


def plot_lts_geojson(region, all_lts):
    """
    Export the rated (LTS > 0) edges to `plots/{region}_LTS.json` and copy it
    to `plots/LTS.json` so the live viewer (`web.py` / Mapbox) picks it up.
    """
    lts = all_lts[all_lts['LTS'] > 0]

    fields_general = [
        'geometry', 'LTS', 'osmid', 'name', 'highway',
        'speed', 'speed_rule',
        'centerline', 'centerline_rule',
        'ADT', 'ADT_rule',
        'lane_count', 'oneway',
        'street_narrow_wide',
        'width_street', 'width_street_rule',
        'zoom',
    ]
    fields_dirs_base = [
        'bike_allowed', 'bike_lane', 'separation',
        'parking', 'parking_width',
        'buffer', 'buffer_rule', 'bike_width', 'bike_width_rule', 'bike_reach',
        'LTS_mixed', 'LTS_bikelane_noparking', 'LTS_bikelane_yesparking',
        'LTS_bike_access', 'LTS_separation', 'LTS',
    ]
    fields_dirs = (
        [f + '_fwd' for f in fields_dirs_base]
        + [f + '_rev' for f in fields_dirs_base]
    )

    geo_json = lts[fields_general + fields_dirs].to_json()

    output_path = Path(plotFolder) / f'{region}_LTS.json'
    output_path.write_text(geo_json + '\n')
    shutil.copy(output_path, Path(plotFolder) / 'LTS.json')


def main(region, format="json"):
    """Load LTS data for `region` and write the GeoJSON output for it."""
    Path(plotFolder).mkdir(exist_ok=True)
    all_lts = load_data(region)
    if format == "json":
        plot_lts_geojson(region, all_lts)


if __name__ == '__main__':
    main('Boston')
