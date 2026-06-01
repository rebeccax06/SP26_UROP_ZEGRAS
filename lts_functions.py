'''
Rule engine and helpers for calculating cycling Level of Traffic Stress
(LTS) from OSMnx edge GeoDataFrames.

The YAML files under `config/` define what counts as an LTS-affecting
feature (rating_dict.yml), how to translate OSM lane tagging into
direction-specific bike lane info (lane_parse.yml), and the
speed/lane/parking lookup tables themselves (tables.yml).

This module is a library: every function returns a (possibly modified)
GeoDataFrame; no IO besides reading the YAML files and writing a few
`data/log_*.csv` debug files.
'''

import re

import numpy as np
import pandas as pd
import yaml

# Side-of-street suffixes (parking, sidewalks, etc.) and direction-of-bike-
# travel suffixes (fwd/rev), used as iteration variables throughout.
SIDES = ['left', 'right']
DIRS = ['fwd', 'rev']


# ---------------------------------------------------------------------------
# Configuration loaders
# ---------------------------------------------------------------------------

def read_tables():
    """Load `config/tables.yml` — the LTS lookup tables from LTS-Tables-v2.2.pdf."""
    with open('config/tables.yml', 'r') as yml_file:
        return yaml.safe_load(yml_file)


def read_rating():
    """Load `config/rating_dict.yml` — assumed values when OSM tags are missing."""
    with open('config/rating_dict.yml', 'r') as yml_file:
        return yaml.safe_load(yml_file)


def read_parse():
    """Load `config/lane_parse.yml` — rules turning OSM tags into bike-lane facts."""
    with open('config/lane_parse.yml', 'r') as yml_file:
        return yaml.safe_load(yml_file)

# ---------------------------------------------------------------------------
# Generic rule application
# ---------------------------------------------------------------------------

# Prefixes whose rules are intrinsically per-side (no symmetric form).
_SIDED_PREFIXES = ('bike_lane', 'biking_allowed', 'separation')


def _category_cols(prefix, symmetric):
    """Names of the bookkeeping columns set by `apply_rules` for one prefix."""
    if symmetric:
        return [f'{prefix}_rule_num', f'{prefix}_condition', f'{prefix}_rule']
    return [
        f'{prefix}_rule_num_left',
        f'{prefix}_condition_left',
        f'{prefix}_rule_left',
        f'{prefix}_rule_num_right',
        f'{prefix}_condition_right',
        f'{prefix}_rule_right',
    ]


def apply_rules(gdf_edges, rating_dict, prefix):
    '''
    Run every rule in `rating_dict` whose key contains `prefix` against
    `gdf_edges`, recording the matched value and bookkeeping rule metadata.

    A rule's `condition` may contain a `[both,left,right]`-style namespace,
    in which case it is exploded into per-side conditions. Rules for any
    prefix in `_SIDED_PREFIXES` (bike_lane / biking_allowed / separation)
    are always applied per-side. Everything else is treated as symmetric.
    '''
    rules = {k: v for k, v in rating_dict.items() if prefix in k}

    # Whether *this prefix* is symmetric is a property of the prefix, not of
    # the last rule iterated — pre-compute it so we know which bookkeeping
    # columns exist after the loop.
    symmetric = prefix not in _SIDED_PREFIXES

    def apply_rule(condition, sym, left, right):
        sides = set()
        if sym:
            sides.add('')
        if left:
            sides.add('_left')
        if right:
            sides.add('_right')

        for side in sides:
            try:
                gdf_filter = gdf_edges.eval(
                    f"{condition} & (`{prefix}_condition{side}` == 'default')"
                )
                gdf_edges.loc[gdf_filter, f'{prefix}{side}'] = value[prefix]
                gdf_edges.loc[gdf_filter, f'{prefix}_rule_num{side}'] = key
                gdf_edges.loc[gdf_filter, f'{prefix}_rule{side}'] = value['rule_message']
                gdf_edges.loc[gdf_filter, f'{prefix}_condition{side}'] = condition
                if 'LTS' in value:
                    gdf_edges.loc[gdf_filter, f'LTS_{prefix}{side}'] = value['LTS']
            except pd.errors.UndefinedVariableError as e:
                print(f'Column used in condition does not exist in this region:\n\t{e}')

    for key, value in rules.items():
        condition = value['condition']
        namespace = re.findall(r'\[(.*)\]', condition)

        if namespace:
            for ns_val in namespace[0].split(','):
                concrete = value['condition'].replace('[' + namespace[0] + ']', ns_val)
                if ns_val == 'both':
                    apply_rule(concrete, sym=False, left=True, right=True)
                elif ns_val == 'left':
                    apply_rule(concrete, sym=False, left=True, right=False)
                elif ns_val == 'right':
                    apply_rule(concrete, sym=False, left=False, right=True)
                else:
                    print(f'Unknown namespace value: {ns_val}')
        elif not symmetric:
            apply_rule(condition, sym=False, left=True, right=True)
        else:
            apply_rule(condition, sym=True, left=False, right=False)

    # Pin the bookkeeping columns to `category` dtype to save memory.
    for col in _category_cols(prefix, symmetric):
        try:
            gdf_edges[col] = gdf_edges[col].astype('category')
        except KeyError as e:
            print(f'Key error attempting to set column as category: {e}')

    return gdf_edges

def convert_feet_with_quotes(series):
    '''
    Convert an OSM length series to decimal feet.

    OSM convention: a value with a quote mark (`'` for feet, `"` for inches)
    is already in feet/inches; any other numeric value is assumed to be in
    meters and converted to feet. Multi-value strings like `"5;6"` collapse
    to the maximum. Returns `(values_in_feet, source_note_series)`.
    '''
    series = series.copy()

    quoteValues = series.str.contains('\'')
    meterValues = quoteValues == False  # noqa: E712

    quoteValues[quoteValues.isna()] = False
    quoteValues = quoteValues.astype(bool)

    feetinch = series[quoteValues].str.strip('"').str.split('\'', expand=True)
    if feetinch.shape[0] > 0:
        feetinch.loc[feetinch[1] == '', 1] = 0
        feetinch = feetinch.apply(lambda x: np.array(x, dtype='int'))
        series[quoteValues] = feetinch[0] + feetinch[1] / 12

    multiWidth = series.str.contains(';', na=False)
    maxWidth = (
        series[multiWidth]
        .str.split(';', expand=True)
        .fillna(value=np.nan)
        .astype(float)
        .max(axis=1)
    )
    series[multiWidth] = maxWidth

    series = pd.to_numeric(series, errors='coerce')

    # Meter values → feet (1 m = 3.28084 ft).
    series[meterValues] = series[meterValues].astype(float) * 3.28084
    series[meterValues] = series[meterValues].round(2)

    series_notes = pd.Series('No Width', index=series.index)
    series_notes[quoteValues] = 'Converted ft-in to decimal feet'
    series_notes[meterValues] = 'Converted to feet'

    return series, series_notes

# ---------------------------------------------------------------------------
# Lane direction parsing
# ---------------------------------------------------------------------------

def convert_both_tag(gdf_edges):
    '''
    For all columns that have a *:both suffix, set the value of the *:left and *:right columns to
    both equal the value of the *:both column. 

    This allows all further processing to ignore the *:both suffix and only use the sided suffixes.
    
    If there is a way that has both *:both and *:left/*:right columns, the side columns will be 
    overwritten. In this case, it is indeterminate which is correct and should be fixed in OSM. This 
    choice is due to programming ease.

    FUTURE: Create a report of ways where there is overlapping *:both and *:left/*:right columns
    '''

    # Move tags with *:both suffix to both *:left/*:right suffix columns
    tags = gdf_edges.columns[gdf_edges.columns.str.contains('both')]
    for tag in tags:
        tag_left = tag.replace('both', 'left')
        tag_right = tag.replace('both', 'right')

        gdf_filter = gdf_edges.loc[~gdf_edges[tag].isna()]
        gdf_edges.loc[gdf_filter.index, tag_left] = gdf_filter[tag]
        gdf_edges.loc[gdf_filter.index, tag_right] = gdf_filter[tag]
    # Remove *:both columns to prevent accidental usage
    gdf_edges = gdf_edges.drop(columns=tags)

    # Convert tags implicit with *:both suffix to both *:left/*:right suffix columns
    tags = ['cycleway', 'cycleway:buffer', 'cycleway:separation', 'cycleway:width']
    for tag in tags:
        tag_left = tag + ':left'
        tag_right = tag + ':right'

        try:
            gdf_filter = gdf_edges.loc[~gdf_edges[tag].isna()]
            gdf_edges.loc[gdf_filter.index, tag_left] = gdf_filter[tag]
            gdf_edges.loc[gdf_filter.index, tag_right] = gdf_filter[tag]

            # Remove column to prevent accidental usage
            gdf_edges = gdf_edges.drop(columns=[tag])
        except KeyError:
            print(f'No {tag} column')
    

    # Merge direction suffixes
    tagsPairs = [
        ['cycleway:left:buffer',  'cycleway:buffer:left'],
        ['cycleway:right:buffer', 'cycleway:buffer:right'],
        ['cycleway:left:separation',  'cycleway:separation:left'],
        ['cycleway:right:separation', 'cycleway:separation:right'],
        ['cycleway:left:width',  'cycleway:width:left'],
        ['cycleway:right:width', 'cycleway:width:right'],
        ]
    for pairs in tagsPairs:
        if pairs[1] in gdf_edges.columns:
            if pairs[0] in gdf_edges.columns:
                gdf_filter = gdf_edges.loc[gdf_edges[pairs[0]].isna()]
                gdf_edges.loc[gdf_filter.index, pairs[0]] = gdf_filter[pairs[1]]
            else:
                gdf_edges.loc[gdf_edges.index, pairs[0]] = gdf_edges[pairs[1]]
            # Remove columns to prevent accidental usage
            gdf_edges = gdf_edges.drop(columns=pairs[1])

    return gdf_edges

def parse_lanes(gdf_edges):
    '''
    Parse which side of the street bike lanes are based on OSM tags and which direction they travel.
    Then coorelate street features to the respective direction of bike travel. 
    '''
    parse_dict = read_parse()

    gdf_edges['parse'] = ''
    gdf_edges['LTS_bike_access'] = np.nan
    gdf_edges['LTS_bike_access_fwd'] = np.nan
    gdf_edges['LTS_bike_access_rev'] = np.nan

    # This prevents conditions from failing if they call a column not used within a given city
    # This may be better moved earlier in process for things like filter testing
    mandatoryCols = ['cycleway:right:oneway', 'cycleway', 
                     'cycleway:right:width', 'cycleway:left:width', 
                     'cycleway:right:separation', 'cycleway:left:separation']
    for col in mandatoryCols:
        if col not in gdf_edges:
            gdf_edges[col] = np.nan

    cols = [
        'bike_allowed_fwd', 'bike_allowed_rev',
        'bike_lane_fwd', 'bike_lane_rev', 
        'parking_fwd', 'parking_rev',
        'parking_width_fwd', 'parking_width_rev',
        'buffer_fwd', 'buffer_rev',
        'bike_width_fwd', 'bike_width_rev',
        'separation_fwd', 'separation_rev'
            ]
    for key in cols:
        # gdf_edges[key] = 'not evaluated'
        gdf_edges[key] = np.nan
        gdf_edges[key] = gdf_edges[key].astype(object)

    logdf = pd.DataFrame(columns=['condition'] + cols)
    for key, value in parse_dict.items():
        condition = value['condition']
        print(f'Processing condition {key}: {condition}')
        logdf.loc[key, 'condition'] = condition
        try:
            # gdf_filter = gdf_edges.eval(f"{condition} & (`parse` == 'not evaluated')")
            gdf_filter = gdf_edges.eval(condition)
            gdf_edges.loc[gdf_filter, 'parse'] = gdf_edges.loc[gdf_filter, 'parse'].astype(str) + key + ': ' + condition + '\n'
            if 'LTS' in value:
                gdf_edges.loc[gdf_edges['LTS_bike_access_fwd'].isna() & gdf_filter, 'LTS_bike_access_fwd'] = value['LTS']
                gdf_edges.loc[gdf_edges['LTS_bike_access_rev'].isna() & gdf_filter, 'LTS_bike_access_rev'] = value['LTS']
            if 'LTS_fwd' in value:
                gdf_edges.loc[gdf_edges['LTS_bike_access_fwd'].isna() & gdf_filter, 'LTS_bike_access_fwd'] = value['LTS_fwd']
            if 'LTS_rev' in value:
                gdf_edges.loc[gdf_edges['LTS_bike_access_rev'].isna() & gdf_filter, 'LTS_bike_access_rev'] = value['LTS_rev']
            for col in cols:
                # print(f'\t{col}')
                if col in value:
                    gdf_uneval = gdf_filter & gdf_edges[col].isna()
                    logdf.loc[key, col] = gdf_uneval.values.sum()
                    if isinstance(value[col], bool):
                        gdf_edges.loc[gdf_uneval[gdf_uneval].index, col] = value[col]
                    else:
                        gdf_edges.loc[gdf_uneval[gdf_uneval].index, col] = gdf_edges.loc[gdf_uneval[gdf_uneval].index, value[col]]
        except pd.errors.UndefinedVariableError as e:
            print(f'\tColumn used in condition does not exist in this region:\n\t\t{e}')
        except KeyError as e:
            print(f'\tColumn does not exist in this region: {e}')

    logdf.to_csv('data/log_parse.csv')
    print('Completed lane parsing')
    return gdf_edges


# ---------------------------------------------------------------------------
# Pre-processing rules (parking, speed, lanes, centerlines, ...)
# ---------------------------------------------------------------------------

def parking_present(gdf_edges, rating_dict):
    '''Apply rating_dict parking rules; default to "yes" (parking present, 8.5 ft).'''
    prefix = 'parking'
    defaultRule = f'{prefix}_'

    for side in SIDES:
        gdf_edges[f'{prefix}_{side}'] = 'yes'
        gdf_edges[f'{prefix}_rule_num_{side}'] = defaultRule
        gdf_edges[f'{prefix}_rule_{side}'] = 'Assumed'
        gdf_edges[f'{prefix}_condition_{side}'] = 'default'

    gdf_edges = apply_rules(gdf_edges, rating_dict, prefix)

    for side in SIDES:
        gdf_edges[f'parking_width_{side}'] = 0.0
        is_yes = gdf_edges[f'{prefix}_{side}'] == 'yes'
        gdf_edges.loc[is_yes, f'parking_width_{side}'] = 8.5  # ft (assumed)
        gdf_edges.loc[is_yes, f'parking_width_rule_{side}'] = 'Assumed'

    return gdf_edges


def get_prevailing_speed(gdf_edges, rating_dict):
    '''
    Resolve a numeric speed limit (mph) for each way.

    Uses `maxspeed` from OSM when present, otherwise falls back to
    rating_dict's road-type-based assumptions. Designed to err on the high
    side, since LTS treats higher speeds as more stressful.
    '''
    prefix = 'speed'
    speedRules = {k: v for k, v in rating_dict.items() if prefix in k}
    defaultRule = f'{prefix}_'

    gdf_edges['speed'] = gdf_edges['maxspeed'].fillna(0)
    gdf_edges.loc[gdf_edges['speed'] == 'signals', 'speed'] = 0
    gdf_edges['speed_rule_num'] = defaultRule
    gdf_edges['speed_rule'] = 'Signed speed limit'
    gdf_edges['speed_condition'] = 'default'

    for key, value in speedRules.items():
        gdf_filter = gdf_edges.eval(f"{value['condition']} & (`speed` == 0)")
        gdf_edges.loc[gdf_filter, 'speed'] = value['speed']
        gdf_edges.loc[gdf_filter, 'speed_rule_num'] = key
        gdf_edges.loc[gdf_filter, 'speed_rule'] = value['rule_message']
        gdf_edges.loc[gdf_filter, 'speed_condition'] = value['condition']

    # Strip "mph" suffix if it survived from OSM.
    if gdf_edges[gdf_edges['speed'].astype(str).str.contains('mph')].shape[0] > 0:
        mph = gdf_edges['speed'].astype(str).str.contains('mph', na=False)
        gdf_edges.loc[mph, 'speed'] = (
            gdf_edges['speed'][mph]
            .str.split(' ', expand=True)[0]
            .apply(lambda x: np.array(x, dtype='int'))
        )

    gdf_edges['speed'] = gdf_edges['speed'].astype(int)
    for col in ['speed_rule_num', 'speed_rule', 'speed_condition']:
        gdf_edges[col] = gdf_edges[col].astype('category')

    return gdf_edges


def get_lanes(gdf_edges, default_lanes=2):
    '''
    Parse OSM `lanes` tags into a clean integer `lane_count`.

    OSM lane tagging can be messy (`"2;3"`, `"2 lanes"`, ...). When several
    values appear (typically from osmnx merging adjacent ways with turn
    lanes), we use the maximum. Missing values fall back to `default_lanes`.

    FUTURE: default footways to 1 lane; consider road-type-specific defaults.
    '''
    gdf_edges['lane_count'] = (
        gdf_edges['lanes']
        .fillna(default_lanes)
        .apply(lambda x: np.array(re.split(r'; |, |\*|\n', str(x)), dtype='float'))
        .apply(lambda x: int(np.rint(np.max(x))))
    )

    gdf_edges['lane_rule'] = 'OSM'
    assumed = gdf_edges['lanes'].isna()
    gdf_edges.loc[assumed, 'lane_rule'] = 'Assumed'

    return gdf_edges


def get_centerlines(gdf_edges, rating_dict):
    '''
    Decide whether a way has a centerline / lane markings.

    Lane markings imply a higher-volume road in the LTS rules and are also
    used elsewhere to estimate ADT. Defaults to "yes"; rating_dict
    `centerline_*` rules carve out exceptions.
    '''
    prefix = 'centerline'
    defaultRule = f'{prefix}_'

    gdf_edges[f'{prefix}'] = 'yes'
    gdf_edges[f'{prefix}_rule_num'] = defaultRule
    gdf_edges[f'{prefix}_rule'] = 'Assumed'
    gdf_edges[f'{prefix}_condition'] = 'default'

    return apply_rules(gdf_edges, rating_dict, prefix)

def width_ft(gdf_edges):
    '''
    Convert OSM width tags (street, bike lane, buffer) into decimal feet and
    populate per-direction `bike_reach_{dir}` columns.

    `bike_reach_*` = bike_width + parking_width + buffer, which the LTS
    tables use to decide if there's enough sideways space to dodge a
    car door.
    '''
    gdf_edges['width_street'], gdf_edges['width_street_rule'] = convert_feet_with_quotes(gdf_edges['width'])

    for dir in DIRS:
        try:
            bike_width, bike_width_rule = convert_feet_with_quotes(gdf_edges[f'bike_width_{dir}'])
            mask = bike_width.notna()
            gdf_edges.loc[mask, f'bike_width_{dir}'] = bike_width
            gdf_edges.loc[mask, f'bike_width_rule_{dir}'] = bike_width_rule
        except KeyError:
            print(f'No bike_width_{dir} column')

    for dir in DIRS:
        missing = gdf_edges[f'bike_width_{dir}'].isna()
        gdf_edges.loc[missing, f'bike_width_{dir}'] = 5.0
        gdf_edges.loc[missing, f'bike_width_rule_{dir}'] = 'Assumed'
        gdf_edges.loc[missing, f'buffer_{dir}'] = 0.0
        gdf_edges.loc[missing, f'buffer_rule_{dir}'] = 'Assumed'

    for dir in DIRS:
        try:
            buffer_col = gdf_edges[f'buffer_{dir}']
            if 'yes' in buffer_col.values:
                gdf_edges.loc[buffer_col == 'yes', f'buffer_{dir}'] = "2'"
            if 'no' in buffer_col.values:
                gdf_edges.loc[buffer_col == 'no', f'buffer_{dir}'] = "0.0"
            buffer_width, buffer_rule = convert_feet_with_quotes(gdf_edges[f'buffer_{dir}'])
            mask = buffer_width.notna()
            gdf_edges.loc[mask, f'buffer_{dir}'] = buffer_width
            gdf_edges.loc[mask, f'buffer_rule_{dir}'] = buffer_rule
        except KeyError:
            print(f'No buffer_{dir} column')

    for dir in DIRS:
        gdf_edges[f'bike_reach_{dir}'] = (
            gdf_edges[f'bike_width_{dir}'].fillna(0)
            + gdf_edges[f'parking_width_{dir}'].fillna(0)
            + gdf_edges[f'buffer_{dir}'].fillna(0)
        )

    return gdf_edges


def define_narrow_wide(gdf_edges):
    '''
    Classify oneway streets as "narrow" or "wide" for the LTS lookup tables.

    Streets that aren't oneway get the literal label `"not oneway"`. Among
    oneway streets, "narrow" is anything where the available width is small
    relative to how much parking is present (<30 ft with both-side parking,
    <22 ft with one-side, <15 ft with no parking).
    '''
    gdf_edges['street_narrow_wide'] = 'not oneway'
    oneway = gdf_edges['oneway']
    width = gdf_edges['width_street']

    gdf_edges.loc[oneway, 'street_narrow_wide'] = 'wide'

    both_parking = (gdf_edges['parking_fwd'] == 'yes') & (gdf_edges['parking_rev'] == 'yes')
    no_parking = (gdf_edges['parking_fwd'] == 'no') & (gdf_edges['parking_rev'] == 'no')

    gdf_edges.loc[oneway & (width < 30) & both_parking, 'street_narrow_wide'] = 'narrow'
    for dir in DIRS:
        gdf_edges.loc[
            oneway & (width < 22) & (gdf_edges[f'parking_{dir}'] == 'yes'),
            'street_narrow_wide',
        ] = 'narrow'
    gdf_edges.loc[oneway & (width < 15) & no_parking, 'street_narrow_wide'] = 'narrow'

    return gdf_edges


def define_adt(gdf_edges, rating_dict):
    '''
    Assign an Average Daily Traffic value to each segment.

    OSM almost never tags ADT directly so the default is 1500 and
    rating_dict's `ADT_*` rules carve up roadway types from there.

    FUTURE: replace assumptions with measurements from cities or Streetlight.
    '''
    prefix = 'ADT'
    defaultRule = f'{prefix}_'

    gdf_edges[f'{prefix}'] = 1500
    gdf_edges[f'{prefix}_rule_num'] = defaultRule
    gdf_edges[f'{prefix}_rule'] = 'Assumed'
    gdf_edges[f'{prefix}_condition'] = 'default'

    return apply_rules(gdf_edges, rating_dict, prefix)


def define_zoom(gdf_edges, rating_dict):
    '''
    Set the minimum Mapbox zoom level at which each way begins to render.

    Affects display only, not LTS values. Used so Mapbox doesn't try to
    paint every alley at z10.
    '''
    prefix = 'zoom'
    defaultRule = f'{prefix}_'

    gdf_edges[f'{prefix}'] = 16
    gdf_edges[f'{prefix}_rule_num'] = defaultRule
    gdf_edges[f'{prefix}_rule'] = 'Assumed'
    gdf_edges[f'{prefix}_condition'] = 'default'

    return apply_rules(gdf_edges, rating_dict, prefix)


# ---------------------------------------------------------------------------
# LTS calculations
# ---------------------------------------------------------------------------

# OSM `separation` tag values that effectively turn a bike lane into
# LTS-1-quality protection.
_LTS1_SEPARATIONS = ('yes', 'kerb', 'bump')


def LTS_separation(gdf_edges):
    '''
    Cap LTS at 1 (or 2 for flex posts) where there's a separated bike lane.

    Sets `LTS_separation_{fwd,rev}`; downstream `calculate_lts` takes
    the per-direction min against the table-based LTS so this caps the
    final value rather than replacing it.
    '''
    prefix = 'separation'

    for dir in DIRS:
        col = f'LTS_separation_{dir}'
        gdf_edges[col] = np.nan
        sep = gdf_edges[f'{prefix}_{dir}']
        gdf_edges.loc[sep == True, col] = 1  # noqa: E712
        for value in _LTS1_SEPARATIONS:
            gdf_edges.loc[sep == value, col] = 1
        gdf_edges.loc[sep == 'flex_post', col] = 2

    return gdf_edges


def column_value_counts(gdf_edges):
    '''
    Dump value counts for every filter column to `data/log_filter_column_counts.csv`.

    Pure debugging helper — useful for quickly seeing whether parsing
    populated each direction column as expected.
    '''
    base_cols = [
        'bike_allowed_dir', 'centerline', 'lane_count', 'oneway',
        'street_narrow_wide', 'bike_lane_dir', 'parking_dir', 'ADT',
        'bike_width_dir', 'bike_reach_dir',
    ]
    cols_vc = []
    for col in base_cols:
        if 'dir' in col:
            cols_vc += [col.replace('dir', 'fwd'), col.replace('dir', 'rev')]
        else:
            cols_vc.append(col)

    vc_df = pd.DataFrame()
    for col in cols_vc:
        vc = gdf_edges[col].value_counts(dropna=False)
        if len(vc_df) > len(vc):
            pad = len(vc_df) - len(vc)
            vc = pd.concat([vc, pd.Series(['_'] * pad)])
        elif len(vc_df) < len(vc):
            pad = len(vc) - len(vc_df)
            vc_df = pd.concat(
                [vc_df, pd.DataFrame([['_'] * vc_df.shape[1]] * pad, columns=vc_df.columns)],
                ignore_index=True,
            )
        vc_df[f'{col}_values'] = vc.index
        vc_df[f'{col}_counts'] = vc.values

    vc_df.to_csv('data/log_filter_column_counts.csv')
    print('Saved columns values and counts of filters')

def _evaluate_lts_subtable(gdf_edges, table, subTable, dir, speedMin, speedMax, logdf):
    '''
    Inner loop of `evaluate_lts_table`: apply one (subTable, dir) combination
    and append per-bucket / per-speed-band rows to `logdf`.
    '''
    baseName = subTable.split('_', 1)[1] if '_' in subTable else subTable
    bucketColumnTemplate = table['bucketColumn']
    bucketTable = table[subTable][f'table_{bucketColumnTemplate}'.replace('_dir', '')]
    ltsSpeeds = table[subTable]['table_speed']
    bucketColumn = bucketColumnTemplate.replace('dir', dir)

    for conditionTableName, conditionTableStr in table['conditions'].items():
        conditionTable = conditionTableStr.replace('dir', dir)
        for conditionName, conditionTemplate in table[subTable]['conditions'].items():
            base_condition = conditionTemplate.replace('dir', dir)
            for bucket, ltsSpeed in zip(bucketTable, ltsSpeeds):
                conditionBucket = (
                    f'(`{bucketColumn}` >= {bucket[0]}) & (`{bucketColumn}` < {bucket[1]})'
                )
                for sMin, sMax, lts in zip(speedMin, speedMax, ltsSpeed):
                    conditionSpeed = f'(`speed` > {sMin}) & (`speed` < {sMax})'
                    condition = (
                        f'{base_condition} & {conditionSpeed} '
                        f'& {conditionBucket} & {conditionTable}'
                    )
                    gdf_filter = gdf_edges.eval(condition)
                    gdf_edges.loc[gdf_filter, f'LTS_{baseName}_{dir}'] = lts
                    logdf.loc[len(logdf)] = [
                        subTable,
                        conditionTableStr,
                        conditionName,
                        dir,
                        condition,
                        lts,
                        gdf_filter.values.sum(),
                    ]


def evaluate_lts_table(gdf_edges, tables, tableName):
    '''
    Apply one of the lookup tables from `config/tables.yml` to `gdf_edges`,
    writing `LTS_{baseName}_{fwd,rev}` columns.

    Each table is split into sub-tables by lane classification; within each
    sub-table conditions are evaluated per direction, per bucket of the
    relevant feature column, and per speed band. Every matched (sub-table,
    direction, condition, bucket, speed band) is logged to
    `data/log_lts_{baseName}.csv` for debugging.
    '''
    baseName = tableName[6:]
    table = tables[tableName]
    print(f'Evaluating LTS using {baseName} table...')

    subTables = [key for key in table.keys() if tableName in key]
    speedMin = tables['cols_speeds']['min']
    speedMax = tables['cols_speeds']['max']

    for dir in DIRS:
        gdf_edges[f'LTS_{baseName}_{dir}'] = np.nan

    logdf = pd.DataFrame(
        columns=['subTable', 'conditionTableStr', 'conditionName', 'dir', 'condition', 'lts', 'count']
    )

    for subTable in subTables:
        for dir in DIRS:
            _evaluate_lts_subtable(gdf_edges, table, subTable, dir, speedMin, speedMax, logdf)

    logdf.to_csv(f'data/log_lts_{baseName}.csv')
    return gdf_edges


def calculate_lts(gdf_edges, tables):
    '''
    Run every `table_*` in `tables`, then combine the resulting `LTS_*_{dir}`
    columns into a final `LTS` value per edge.

    Per direction: lowest LTS across all tables (the most-protected
    configuration wins, e.g. a bike lane beats a mixed-traffic estimate).
    Combined: maximum of fwd/rev (so a single bad direction doesn't get
    hidden by a good one).
    '''
    tablesList = [key for key in tables.keys() if 'table_' in key]
    for tableName in tablesList:
        gdf_edges = evaluate_lts_table(gdf_edges, tables, tableName)

    for dir in DIRS:
        dir_cols = (
            gdf_edges.columns.str.startswith('LTS')
            & gdf_edges.columns.str.endswith(dir)
        )
        gdf_edges[f'LTS_{dir}'] = gdf_edges.loc[:, dir_cols].min(
            axis=1, skipna=True, numeric_only=True
        )

    gdf_edges['LTS'] = gdf_edges[['LTS_fwd', 'LTS_rev']].max(axis=1)
    return gdf_edges


