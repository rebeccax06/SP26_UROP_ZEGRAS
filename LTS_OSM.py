'''
Level of Traffic Stress maps with OpenStreetMap.

This pipeline downloads OSM data via Overpass + OSMnx, then computes
edge-level (and optionally node-level) cycling Level of Traffic Stress
using the rules defined in `lts_functions.py` and `config/*.yml`.

Every stage saves an intermediate file under `data/`. Re-running from a
given stage is as simple as deleting that file and any later ones —
each stage checks for its output and skips if found (unless `OVERWRITE`
is enabled). The numeric prefix in each filename encodes pipeline order.
'''

import json
import os
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import numpy as np
import osmnx as ox
import pandas as pd
import requests
from pandas.api.types import CategoricalDtype
from tqdm import tqdm

import lts_functions as lts

# Disable osmnx HTTP cache: when rebuilding we never want stale ways
# (e.g. un-separated cycleways) bleeding into the new run.
ox.settings.use_cache = False

dataFolder = 'data'
queryFolder = 'query'

overpass_url = "http://overpass-api.de/api/interpreter"

# Module-global re-run flag. Set to True when an earlier stage regenerated
# its output, so every later stage is forced to re-run too.
OVERWRITE = False


def build_query(region, key, value):
    '''
    Write an Overpass QL query file for `region` into `query/{region}.query`.

    Looks up the OSM relation matching `key=value` (typically
    `wikipedia=en:Boston`), then selects every highway way except sidewalks
    and parking aisles, plus any sidewalk that explicitly permits bicycles.
    Idempotent: skips if the query file already exists.
    '''
    global OVERWRITE
    filepath = Path('query') / (region + '.query')
    filepath.parent.mkdir(exist_ok=True)
    if filepath.exists():
        print(f"{region} query already exists")
        return
    OVERWRITE = True
    with filepath.open(mode='w') as f:
        f.write('[timeout:600][out:json][maxsize:2000000000];\n')
        f.write(f'area["{key}"="{value}"]->.search_area;\n')
        f.write('.search_area out body;\n')
        f.write("""
(
    way[highway][footway!=sidewalk][service!=parking_aisle](area.search_area);
    way[footway=sidewalk][bicycle][bicycle!=no][bicycle!=dismount](area.search_area);
);
out;
            """)
    print(f'{filepath} created')


def download_osm(region):
    '''
    Run the Overpass query for `region` and save the raw JSON response.

    Output: `data/{region}_1.json`. Skips if the file already exists and
    `OVERWRITE` is False.

    Ref: https://towardsdatascience.com/loading-data-from-openstreetmap-with-python-and-the-overpass-api-513882a27fd0
    '''
    global OVERWRITE
    queryFilepath = os.path.join(queryFolder, f'{region}.query')
    dataFilepath = os.path.join(dataFolder, f'{region}_1.json')

    if os.path.exists(dataFilepath) and not OVERWRITE:
        print(f'OSM data already downloaded for {region}')
        return

    OVERWRITE = True
    with open(queryFilepath, 'r') as f:
        overpass_query = f.read()

    print(f'Downloading OSM map data for {region}...')
    response = requests.get(
        overpass_url,
        params={'data': overpass_query},
        timeout=60 * 5,
    )
    response.raise_for_status()
    data = response.json()

    print(f'\tDownloaded OSM map data for {region}')

    with open(dataFilepath, 'w') as f:
        json.dump(data, f)
        print(f'Saved {region} map data')

def extract_tags(region):
    '''
    Find every unique OSM tag on a way in `data/{region}_1.json` and register
    them with osmnx so they survive the graph download.

    Caches the tag list to `data/{region}_2_way_tags.csv`. Mutates the global
    `ox.settings.useful_tags_way` and `ox.settings.osm_xml_way_tags`.
    '''
    global OVERWRITE
    wayTagsCSV = os.path.join(dataFolder, f'{region}_2_way_tags.csv')

    if os.path.exists(wayTagsCSV) and not OVERWRITE:
        way_tags_series = pd.read_csv(wayTagsCSV, index_col=0)['tag']
        print(f'Read {wayTagsCSV}')
    else:
        OVERWRITE = True
        print(f'Finding way tags for {region}...')
        with open(os.path.join(dataFolder, f'{region}_1.json'), 'r') as f:
            data = json.load(f)

        dfs = [
            pd.DataFrame.from_dict(element['tags'], orient='index')
            for element in data['elements']
            if element['type'] == 'way'
        ]
        tags_df = pd.concat(dfs).reset_index()
        tags_df.columns = ["tag", "tagvalue"]
        tag_counts = tags_df['tag'].value_counts().reset_index()

        print(f"Cycleway tags:\n{tag_counts[tag_counts['tag'].str.contains('cycleway')]}")

        way_tags_series = tag_counts['tag']
        way_tags_series.to_csv(wayTagsCSV)
        print(f'\t{wayTagsCSV} saved.')

    way_tags = list(way_tags_series)

    ox.settings.useful_tags_way += way_tags
    ox.settings.osm_xml_way_tags = way_tags
    print('Way tags added to osmnx settings.')


def download_data(region):
    '''
    Download (or load cached) OSM street network for `region` and return its
    node/edge GeoDataFrames.

    The filter is adapted from osmnx's built-in "bike" filter (keeps footways
    and construction tags so cycling-relevant geometry is retained). Output
    graph is saved to `data/{region}_3.graphml`.
    '''
    global OVERWRITE
    osmfilter = (
        '["highway"]["area"!~"yes"]["access"!~"private"]'
        '["highway"!~"abandoned|bus_guideway|corridor|elevator|escalator|motor|'
        'planned|platform|proposed|raceway|steps"]'
        '["service"!~"private"]'
        '["indoor"!~"yes"]'
        '["service"!="parking_aisle"]'
    )

    filepath = f"{dataFolder}/{region}_3.graphml"
    if os.path.exists(filepath) and not OVERWRITE:
        print(f"Loading saved graph for {region}")
        G = ox.load_graphml(filepath)
    else:
        OVERWRITE = True
        print(f"Downloading {region} data (this may take some time)...")
        G = ox.graph_from_place(
            f"{region}, Massachusetts",
            retain_all=True,
            truncate_by_edge=True,
            simplify=False,
            custom_filter=osmfilter,
        )
        print(f"Saving {region} graph")
        ox.save_graphml(G, filepath)

    gdf_nodes, gdf_edges = ox.graph_to_gdfs(G)

    print(f'{gdf_edges.shape=}')
    print(f'{gdf_nodes.shape=}')

    return gdf_nodes, gdf_edges

def read_lts_csv(filepath):
    '''
    Load `data/{region}_4_all_lts.csv` back into a GeoDataFrame.

    Only the columns listed in `loadCols` are read (the full CSV is wide).
    The geometry column is parsed from WKT. If `(u, v, key)` are present the
    GeoDataFrame is set to that MultiIndex to match osmnx conventions.
    '''
    loadCols = ['u','v','key', 'osmid', 'geometry', 'access_aisle', 'access:conditional', 
            'access:disabled', 'access', 'aeroway', 'alt_name', 'area:highway', 
            'area', 'barrier', 'bicycle', 'bridge:movable', 'bridge:name', 
            'bridge', 'bus:conditional', 'bus:lanes:conditional', 'bus', 
            'busway:left', 'busway:right', 'busway', 'change:lanes:forward', 
            'change', 'class:bicycle', 'construction', 'covered', 'crossing_ref', 
            'crossing:island', 'crossing:markings', 'crossing:signals', 'crossing', 
            'cycleway:both:buffer', 'cycleway:both:lane', 'cycleway:both', 
            'cycleway:buffer', 'cycleway:lane', 'cycleway:left:buffer', 
            'cycleway:left:lane', 'cycleway:left:oneway', 'cycleway:left', 
            'cycleway:right:buffer', 'cycleway:right:lane', 'cycleway:right:oneway', 
            'cycleway:right', 'cycleway:surface', 'cycleway', 'description', 
            'designated_direction', 'designation', 'direction', 'disused', 
            'embedded_rails', 'emergency', 'entrance', 'exit', 'expressway', 
            'fee', 'flashing_lights', 'floating', 'foot', 'footway:surface', 
            'footway', 'highway:conditional', 'highway', 'incline', 'indoor', 
            'informal', 'junction', 'kerb', 'landing', 'lane_markings', 
            'lanes:backward', 'lanes:bus:backward', 'lanes:bus:forward',
            'lanes:conditional', 'lanes:forward', 'lanes', 'layer', 'level', 
            'light_rail', 'location', 'man_made', 'material', 'maxlength', 
            'maxspeed:advisory', 'maxspeed:bus', 'maxspeed:hgv', 'maxspeed:type', 
            'maxspeed:variable', 'maxspeed', 'motor_vehicle:conditional', 
            'motor_vehicle', 'motorcar', 'mtb:scale', 'name:en', 'name', 
            'natural', 'noexit', 'noname', 'official_name', 'oneway:bicycle', 
            'oneway:bus', 'oneway:conditional', 'oneway', 'opening_date', 
            'parking:both:orientation', 'parking:both', 'parking:condition:both:customers', 
            'parking:condition:both:maxstay', 'parking:condition:both:time_interval', 
            'parking:condition:both', 'parking:condition:left:maxstay', 
            'parking:condition:left:time_interval', 'parking:condition:left', 
            'parking:condition:right:maxstay', 'parking:condition:right:time_interval', 
            'parking:condition:right', 'parking:lane:both_1', 'parking:lane:both:parallel', 
            'parking:lane:both', 'parking:lane:left:parallel', 'parking:lane:left', 
            'parking:lane:right:parallel', 'parking:lane:right', 'parking:lane', 
            'parking:left:orientation', 'parking:left', 'parking:right:both', 
            'parking:right:orientation', 'parking:right', 'place', 'placement', 
            'protected', 'psv', 'public_transport', 'railway', 'ramp:bicycle', 
            'ramp:wheelchair', 'ramp', 'ruined', 'sac_scale', 'segregated', 
            'service', 'short_name', 'shoulder:right', 'shoulder', 'sidewalk:both:surface', 
            'sidewalk:both', 'sidewalk:left', 'sidewalk:right:surface', 
            'sidewalk:right', 'sidewalk', 'signal', 'stairs', 'start_date', 
            'step_count', 'subway', 'surface', 'tracktype', 'traffic_calming', 
            'traffic_island', 'traffic_signals:countdown', 'traffic_signals:sound', 
            'traffic_signals:vibration', 'traffic_signals', 'trail_visibility', 
            'trolley_wire', 'trolleybus', 'tunnel', 'turn:lanes:backward', 
            'turn:lanes:conditional', 'turn:lanes:forward', 'turn:lanes', 
            'turn', 'vehicle', 'was:bridge:movable', 'width:feet', 'width',
            # 'biking_permitted', 'biking_permitted_rule_num', 'biking_permitted_rule', 'biking_permitted_condition',
            # 'bike_lane_separation', 'bike_lane_separation_rule_num', 'bike_lane_separation_rule', 'bike_lane_separation_condition',
            # 'bike_lane_exist', 'bike_lane_exist_rule_num', 'bike_lane_exist_rule', 'bike_lane_exist_condition',
            # 'parking', 'parking_rule_num', 'parking_rule', 'parking_condition', 'width_parking',
            'speed', 'speed_rule_num', 'speed_rule', 'speed_condition',
            'lane_count', 'lane_source',
            'centerline', 'centerline_rule_num', 'centerline_rule', 'centerline_condition',
            'width_street', 'width_street_notes',
            # 'width_bikelane', 'width_bikelane_notes', 'width_bikelanebuffer', 'width_bikelanebuffer_notes',
            # 'bikelane_reach', 
            'street_narrow_wide',
            'ADT', 'ADT_rule_num', 'ADT_rule', 'ADT_condition',
            # 'LTS_biking_permitted', 'LTS_bike_lane_separation', 
            # 'LTS_mixed', 'LTS_bikelane_noparking', 'LTS_bikelane_yesparking', 
            'LTS', 'width_street_rule',
            #  'biking_permitted_left', 'biking_permitted_rule_left', 
            # 'bike_lane_separation_left', 'bike_lane_separation_rule_left', 'parking_left', 'parking_rule_left', 'width_parking_left', 
            # 'width_parking_rule_left', 'width_bikelanebuffer_left', 'width_bikelanebuffer_rule_left', 'width_bikelane_left', 
            # 'width_bikelane_rule_left', 'bikelane_reach_left', 'LTS_mixed_left', 'LTS_bikelane_noparking_left', 'LTS_bikelane_yesparking_left',
            # 'LTS_biking_permitted_left', 'LTS_bike_lane_separation_left', 'LTS_left', 'biking_permitted_right', 'biking_permitted_rule_right',
            # 'bike_lane_separation_right', 'bike_lane_separation_rule_right', 
            # 'parking_right', 'parking_rule_right', 'width_parking_right', 'width_parking_rule_right', 'width_bikelanebuffer_right', 
            # 'width_bikelanebuffer_rule_right', 'width_bikelane_right', 'width_bikelane_rule_right', 'bikelane_reach_right', 'LTS_mixed_right',
            # 'LTS_bikelane_noparking_right', 'LTS_bikelane_yesparking_right', 'LTS_biking_permitted_right', 'LTS_bike_lane_separation_right', 'LTS_right',
            
            'parse', 'zoom', 'bike_allowed_fwd', 'bike_lane_fwd', 'separation_fwd', 'parking_fwd', 
            'parking_width_fwd', 'buffer_fwd', 'buffer_rule_fwd', 'bike_width_fwd', 'bike_width_rule_fwd', 
            'bike_reach_fwd', 'LTS_mixed_fwd', 'LTS_bikelane_noparking_fwd', 'LTS_bikelane_yesparking_fwd', 
            'LTS_bike_access_fwd', 'LTS_fwd', 'bike_allowed_rev', 'bike_lane_rev', 'separation_rev', 
            'parking_rev', 'parking_width_rev', 'buffer_rev', 'buffer_rule_rev', 'bike_width_rev', 
            'bike_width_rule_rev', 'bike_reach_rev', 'LTS_mixed_rev', 'LTS_bikelane_noparking_rev', 
            'LTS_bikelane_yesparking_rev', 'LTS_bike_access_rev', 'LTS_rev',
            'LTS_separation_fwd', 'LTS_separation_rev'
            ]

    dtypeDict = {
        'u': 'Int64',
        'v': 'Int64',
        'key': 'Int32',
        'level': 'object',
        'osmid': 'Int64',
        'lanes': 'object',
        'lanes:forward': 'object',
        'lanes:backward': 'object',
        'layer': 'Float32',
        'oneway': 'bool',
        'geometry': 'object',
    }

    dtypes = defaultdict(CategoricalDtype, dtypeDict)
    df = pd.read_csv(
        filepath,
        usecols=lambda x: x in loadCols,
        dtype=dtypes,
        keep_default_na=True,
        na_values="''",
        low_memory=False,
    )

    geodf = gpd.GeoDataFrame(
        df.loc[:, [c for c in df.columns if c != "geometry"]],
        geometry=gpd.GeoSeries.from_wkt(df["geometry"]),
        crs='wgs84',
    )

    geoIndex = ['u', 'v', 'key']
    if set(geoIndex).issubset(geodf.columns):
        geodf.set_index(geoIndex, inplace=True)

    return geodf


def read_gdf_nodes_csv(filepath):
    '''Load a node-level LTS CSV produced by `lts_nodes` back into a GeoDataFrame.'''
    dtypeDict = {
        'x': 'float64',
        'y': 'float64',
        'osmid': 'Int64',
        'street_count': 'Int32',
        'highway': 'category',
        'ref': 'category',
        'geometry': 'object',
        'LTS': 'Int32',
        'message': 'category',
    }

    df = pd.read_csv(
        filepath,
        dtype=dtypeDict,
        keep_default_na=True,
        na_values="''",
        low_memory=False,
    )

    geodf = gpd.GeoDataFrame(
        df.loc[:, [c for c in df.columns if c != "geometry"]],
        geometry=gpd.GeoSeries.from_wkt(df["geometry"]),
        crs='wgs84',
    )

    return geodf


def lts_edges(region, gdf_edges):
    '''
    Compute LTS for every edge in `gdf_edges` and write `data/{region}_4_all_lts.csv`.

    Returns the resulting GeoDataFrame (loaded from cache when available).
    Each step is delegated to `lts_functions`; see that module for the
    rule-by-rule docstrings.
    '''
    global OVERWRITE
    filepathAll = f"{dataFolder}/{region}_4_all_lts.csv"

    if os.path.exists(filepathAll) and not OVERWRITE:
        print(f"Loading LTS for {region}")
        return read_lts_csv(filepathAll)

    OVERWRITE = True

    rating_dict = lts.read_rating()
    tables = lts.read_tables()

    # Side-of-street features (parking) feed everything downstream.
    gdf_edges = lts.parking_present(gdf_edges, rating_dict)
    # Collapse `*:both` tags into `*:left`/`*:right`.
    gdf_edges = lts.convert_both_tag(gdf_edges)
    # Bike lane + direction parsing.
    gdf_edges = lts.parse_lanes(gdf_edges)
    # Non-directional features.
    gdf_edges = lts.get_prevailing_speed(gdf_edges, rating_dict)
    gdf_edges = lts.get_lanes(gdf_edges, default_lanes=2)
    gdf_edges = lts.get_centerlines(gdf_edges, rating_dict)
    gdf_edges = lts.width_ft(gdf_edges)
    gdf_edges = lts.define_narrow_wide(gdf_edges)
    gdf_edges = lts.define_adt(gdf_edges, rating_dict)
    gdf_edges = lts.LTS_separation(gdf_edges)

    lts.column_value_counts(gdf_edges)  # debug log
    all_lts = lts.calculate_lts(gdf_edges, tables)
    gdf_edges = lts.define_zoom(gdf_edges, rating_dict)

    all_lts.to_csv(filepathAll)
    return all_lts


def lts_nodes(region, gdf_nodes, all_lts):
    '''
    Compute intersection (node) LTS from edge LTS + traffic control type.

    Rules (matching the Bonsma-Fisher node-LTS extension):
    - Default: node LTS = max LTS of intersecting edges.
    - Stop sign on an LTS≤2 node drops it to 1.
    - Traffic signal on an LTS≤2 node drops it to 1.
    - Traffic signal on an LTS≥3 node drops it to 2.

    Saves `data/{region}_6_gdf_nodes.csv`. Heavy: iterates every node.
    '''
    global OVERWRITE
    filepath = f"{dataFolder}/{region}_6_gdf_nodes.csv"

    if os.path.exists(filepath) and not OVERWRITE:
        print(f'Loading {filepath}')
        gdf_nodes = read_gdf_nodes_csv(filepath)
        gdf_nodes.set_index('osmid', inplace=True)
        return gdf_nodes

    OVERWRITE = True
    gdf_nodes['LTS'] = np.nan
    gdf_nodes['message'] = ''

    for node in tqdm(gdf_nodes.index):
        try:
            edges = all_lts.loc[node]
        except KeyError:
            gdf_nodes.loc[node, 'message'] = "Node not found in edges"
            continue

        control = gdf_nodes.loc[node, 'highway']
        max_lts = edges['LTS'].astype(float).dropna().max(skipna=True, numeric_only=True)
        if np.isnan(max_lts):
            max_lts = 0
        node_lts = int(max_lts)
        message = "Node LTS is max intersecting LTS"

        if node_lts > 2 and control == 'traffic_signals':
            node_lts = 2
            message = "LTS 3-4 with traffic signals"
        elif node_lts <= 2 and control in ('traffic_signals', 'stop'):
            node_lts = 1
            message = "LTS 1-2 with traffic signals or stop"

        gdf_nodes.loc[node, 'message'] = message
        gdf_nodes.loc[node, 'LTS'] = node_lts

    gdf_nodes.to_csv(filepath)
    print(f'Saved LTS nodes for {region}')
    return gdf_nodes


def combine_data(fullRegion, regionList):
    '''
    Concatenate per-city edge LTS CSVs into a single
    `data/{fullRegion}_4_all_lts.csv` for region-wide rendering.
    '''
    print('All LTS - 4')
    combinedPath = f'{dataFolder}/{fullRegion}_4_all_lts.csv'
    allLTS = pd.DataFrame()
    for region in regionList:
        print(f'\t{region}')
        print(f'\t\tBefore: {allLTS.shape=}')
        allLTS = pd.concat([allLTS, read_lts_csv(f'{dataFolder}/{region}_4_all_lts.csv')])
        print(f'\t\tAfter:  {allLTS.shape=}')
    allLTS.to_csv(combinedPath)


def main(region, key, value, rebuild=False):
    '''
    Run the full pipeline for one region:
    build_query → download_osm → extract_tags → download_data → lts_edges.

    `rebuild=True` forces every stage to re-run, even if intermediate files
    already exist. `lts_nodes` is intentionally not called here; it's slow
    and downstream consumers currently only need edge LTS.
    '''
    global OVERWRITE
    OVERWRITE = rebuild
    Path(dataFolder).mkdir(exist_ok=True)

    build_query(region, key, value)
    download_osm(region)
    extract_tags(region)
    _gdf_nodes, gdf_edges = download_data(region)
    lts_edges(region, gdf_edges)


if __name__ == '__main__':
    city = ['Boston', 'wikipedia', 'en:Boston']
    main(*city, True)
