'''
Isochrone analysis over LTS-filtered street networks.

Given a starting point and a trip time budget, draws which nodes of the
network are reachable at each LTS threshold (1 = lowest stress, 4 =
highest). Optionally samples a grid of points inside the city's alpha-shape
boundary so the same isochrone calc can drive a heatmap.

Plotting code adapted from
    https://github.com/gboeing/osmnx-examples/blob/v0.13.0/notebooks/13-isolines-isochrones.ipynb

Note: requires `data/{city}_7_lts.graphml` and `data/{city}_6_gdf_nodes.csv`,
which are NOT produced by the default `main.py process` flow. Generate them
manually before running this script.
'''

import alphashape
import cartopy.crs as ccrs
import matplotlib
import networkx as nx
import numpy as np
import osmnx as ox
from matplotlib import pyplot as plt
from mpl_toolkits.axes_grid1 import make_axes_locatable
from shapely.geometry import Point
from shapely.prepared import prep

import LTS_OSM
import LTS_plot

# Default: whether to remove nodes (in addition to edges) when filtering by LTS.
REMOVE_NODES = True

# Hex colors for LTS 1-4 from the plasma palette.
ISO_COLORS = ox.plot.get_colors(n=4, cmap='plasma', start=0, return_hex=True)


def load_files(city):
    """Load the node CSV, edge LTS CSV, and `_7_lts.graphml` graph for `city`."""
    gdf_nodes = LTS_OSM.read_gdf_nodes_csv(f"data/{city}_6_gdf_nodes.csv")
    all_lts = LTS_plot.load_data(city)
    lts_graphml = ox.load_graphml(f"data/{city}_7_lts.graphml")
    return gdf_nodes, all_lts, lts_graphml


def lts_map_graphs(G_lts, all_lts, gdf_nodes, remove_nodes=True):
    """
    Build four subgraphs, one per LTS threshold.

    G1 keeps only edges/nodes at LTS≤1, G2 at LTS≤2, etc. After filtering,
    each graph is collapsed to its largest weakly-connected component to
    avoid isochrones that "teleport" between disconnected pieces.

    Returns the four base graphs plus their projected versions (suitable for
    distance-based routing).
    """
    G_base = G_lts.copy()
    largest = max(nx.weakly_connected_components(G_base), key=len)
    G_base = G_base.subgraph(largest).copy()

    Gs = [G_base.copy() for _ in range(4)]

    # The CSV column name is 'LTS' (LTS_plot.load_data preserves the
    # uppercase from data/*_4_all_lts.csv); same for gdf_nodes.
    lts_thresholds = (1, 2, 3, 4)
    for G, threshold in zip(Gs, lts_thresholds):
        # Remove edges whose LTS exceeds this graph's threshold, or is unrated (0).
        edges_to_drop = all_lts[(all_lts['LTS'] > threshold) | (all_lts['LTS'] == 0)]
        G.remove_edges_from(zip(edges_to_drop['u'].values, edges_to_drop['v'].values))

        if remove_nodes:
            bad_nodes = gdf_nodes[(gdf_nodes['LTS'] > threshold) | (gdf_nodes['LTS'] == 0)]['osmid']
            G.remove_nodes_from(bad_nodes)

    # Keep only the largest connected component per graph + drop isolates.
    for i, G in enumerate(Gs):
        largest_cc = max(nx.weakly_connected_components(G), key=len, default=set())
        Gs[i] = G.subgraph(largest_cc).copy()
        Gs[i].remove_nodes_from(list(nx.isolates(Gs[i])))

    G1, G2, G3, G4 = Gs
    G1b, G2b, G3b, G4b = (ox.project_graph(G) for G in (G1, G2, G3, G4))
    return G1, G2, G3, G4, G1b, G2b, G3b, G4b


def edge_travel_times(travel_speed, *graphs):
    """Annotate every edge in each projected graph with `time = length / (speed → m/min)`."""
    meters_per_minute = travel_speed * 1000 / 60
    for G in graphs:
        for _, _, _, data in G.edges(data=True, keys=True):
            data['time'] = data['length'] / meters_per_minute
    return graphs


def point_isochrone(nodeID, trip_time, G1b, G2b, G3b, G4b):
    """
    Compute reachable nodes from `nodeID` within `trip_time` minutes at each
    LTS threshold. Iterates from highest (G4b) to lowest LTS so the lowest
    reachable LTS wins where they overlap.
    """
    graphs = [G4b, G3b, G2b, G1b]
    node_colors = {}
    node_count = []
    for i, G in enumerate(graphs):
        subgraph = nx.ego_graph(G, nodeID, radius=trip_time, distance='time')
        for node in subgraph.nodes():
            node_colors[node] = ISO_COLORS[i]
        node_count.append(list(node_colors.values()).count(ISO_COLORS[i]))
        print(f'LTS {4 - i}: {node_count[-1]} nodes')
    return node_colors, node_count


def point_isochrone_plot(city, point, node_colors, trip_time, G4b):
    """Render the point isochrone over the full network and save it as PNG."""
    point_geom_proj, _ = ox.projection.project_geometry(point, to_crs=G4b.graph['crs'])

    nc = [node_colors[node] if node in node_colors else 'none' for node in G4b.nodes()]
    ns = [5 if node in node_colors else 0 for node in G4b.nodes()]
    fig, ax = ox.plot_graph(
        G4b, node_color=nc, node_size=ns, node_alpha=0.4, node_zorder=0,
        bgcolor='w', edge_linewidth=0.05, edge_color='#999999',
        figsize=(15, 15), show=False, close=False,
    )

    ax.scatter([point_geom_proj.x], [point_geom_proj.y],
               marker='*', s=50, color='k', zorder=2)

    divider = make_axes_locatable(ax)
    cax = divider.append_axes('right', size='3%', pad=0.05)

    cmap = matplotlib.colors.ListedColormap(ISO_COLORS[::-1]).with_extremes(over='0.25', under='0.75')
    bounds = np.arange(5)
    norm = matplotlib.colors.BoundaryNorm(bounds, cmap.N)

    cbar = fig.colorbar(
        matplotlib.cm.ScalarMappable(norm=norm, cmap=cmap),
        cax=cax, orientation='vertical', label="LTS",
    )
    labels = np.arange(1, 5)
    cbar.set_ticks(labels - 0.5)
    cbar.set_ticklabels(labels)

    plot_path = f'plots/{city}_isochrone_times_lts_remove_nodes_{REMOVE_NODES}_time_{trip_time}'
    plt.savefig(plot_path + '.png', dpi=300)


def nearest_node(x, y, G):
    """Return (Point, node_id) for the graph node nearest the given lon/lat."""
    node_id = ox.distance.nearest_nodes(G, x, y)
    return Point(G.nodes[node_id]['x'], G.nodes[node_id]['y']), node_id


def boundary_polygon(gdf_nodes, alpha=200):
    """Return the alpha-shape polygon enclosing all nodes."""
    return alphashape.alphashape(gdf_nodes, alpha=alpha)


def grid_points(alpha_shape, grid_count=25):
    """Sample `grid_count` × `grid_count` evenly spaced points inside `alpha_shape`."""
    alpha_polygon = alpha_shape.iloc[0, 0]
    lat_min, lon_min, lat_max, lon_max = alpha_polygon.bounds
    lat_res = (lat_max - lat_min) / (grid_count + 1)
    lon_res = (lon_max - lon_min) / (grid_count + 1)

    prep_polygon = prep(alpha_polygon)
    points = [
        Point((round(lat, 4), round(lon, 4)))
        for lat in np.arange(lat_min, lat_max, lat_res)
        for lon in np.arange(lon_min, lon_max, lon_res)
    ]
    valid_points = list(filter(prep_polygon.contains, points))

    print(f'{len(valid_points)} grid points in boundary region.')
    return valid_points


def plot_grid_boundary(gdf_nodes, alpha_shape, valid_points):
    """Visualize the alpha-shape boundary and the sample grid for debugging."""
    ax = plt.axes(projection=ccrs.PlateCarree())

    gdf_proj = gdf_nodes.to_crs(ccrs.Robinson().proj4_init)
    ax.scatter(
        [p.x for p in gdf_proj['geometry']],
        [p.y for p in gdf_proj['geometry']],
        transform=ccrs.Robinson(),
        marker='.', s=1,
    )
    ax.scatter(
        [p.x for p in valid_points],
        [p.y for p in valid_points],
        marker='.', s=10, c='r',
    )
    ax.add_geometries(
        alpha_shape.to_crs(ccrs.Robinson().proj4_init)['geometry'],
        crs=ccrs.Robinson(), alpha=.2,
    )
    plt.show()


def main(city, trip_time, travel_speed, x, y):
    """Render a point isochrone for `city` from (x, y) at the given trip time and speed."""
    gdf_nodes, all_lts, G_lts = load_files(city)
    G1, G2, G3, G4, G1b, G2b, G3b, G4b = lts_map_graphs(G_lts, all_lts, gdf_nodes)
    G1b, G2b, G3b, G4b = edge_travel_times(travel_speed, G1b, G2b, G3b, G4b)

    point, node_id = nearest_node(x, y, G1)
    node_colors, _ = point_isochrone(node_id, trip_time, G1b, G2b, G3b, G4b)
    point_isochrone_plot(city, point, node_colors, trip_time, G4b)

    # Sample grid points for an eventual heatmap-style isochrone.
    alpha_shape = boundary_polygon(gdf_nodes, 200)
    valid_points = grid_points(alpha_shape, 25)
    plot_grid_boundary(gdf_nodes, alpha_shape, valid_points)


if __name__ == '__main__':
    main(
        city="Cambridge",
        trip_time=15,   # minutes
        travel_speed=15,  # biking, km/hour
        x=-71.1108,
        y=42.3732,
    )
