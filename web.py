"""
Local HTTP server for the LTS Mapbox viewer.

By default it serves `index.html` from the repo root on port 8000. Pass
`-plot-go-pro /path/to/folder` to also walk a directory of GoPro JPEGs,
extract their GPS data via ExifTool, and serve the dedicated GoPro overlay
page (`map/gopro_photos.html`).
"""
import argparse
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PLOT = 'index.html'
DEFAULT_PORT = 8000


def build_gopro_geojson(folder_path, repo_root=REPO_ROOT):
    """
    Walk `folder_path` recursively, extract GPS metadata from each JPG with
    ExifTool, and write `plots/gopro_photos.json` (GeoJSON FeatureCollection).
    Each photo is also copied into `plots/gopro_photos/` so the served page
    can show them as map popups.

    Returns the number of points written. Raises `SystemExit` if ExifTool
    isn't installed.
    """
    folder_path = os.path.abspath(os.path.expanduser(folder_path))
    if not os.path.isdir(folder_path):
        raise FileNotFoundError(f"GoPro folder not found: {folder_path}")

    try:
        result = subprocess.run(
            [
                "exiftool", "-r", "-n", "-json",
                "-GPSLatitude", "-GPSLongitude", "-DateTimeOriginal",
                "-FileName", "-SourceFile", "-Altitude",
                "-Make", "-Model",
                "-ext", "jpg", "-ext", "jpeg", "-ext", "JPG", "-ext", "JPEG",
                folder_path,
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )
    except FileNotFoundError:
        raise SystemExit("ExifTool not found. Install from https://exiftool.org/")

    if result.returncode != 0 and result.stderr:
        print(result.stderr, file=sys.stderr)

    entries = _parse_exiftool_output(result.stdout)
    photos_dir = os.path.join(repo_root, "plots", "gopro_photos")
    os.makedirs(photos_dir, exist_ok=True)

    features = []
    for entry in entries:
        feature = _build_feature(entry, photos_dir, len(features))
        if feature is not None:
            features.append(feature)

    features.sort(key=lambda f: (f["properties"].get("datetime") or ""))

    out_json = os.path.join(repo_root, "plots", "gopro_photos.json")
    os.makedirs(os.path.dirname(out_json), exist_ok=True)
    with open(out_json, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, indent=2)

    print(f"Wrote {len(features)} points to {out_json}")
    return len(features)


def _parse_exiftool_output(raw):
    """Parse ExifTool's JSON stdout, tolerating empty / malformed payloads."""
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        entries = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if isinstance(entries, dict):
        return [entries]
    return entries


def _build_feature(entry, photos_dir, next_id):
    """Convert one ExifTool entry into a GeoJSON Point feature, or None if no GPS."""
    lat = entry.get("GPSLatitude")
    lon = entry.get("GPSLongitude")
    if lat is None or lon is None:
        return None

    source = entry.get("SourceFile", "")
    fname = entry.get("FileName", os.path.basename(source))
    dt = entry.get("DateTimeOriginal") or entry.get("CreateDate") or ""
    alt = entry.get("GPSAltitude")
    make = entry.get("Make", "")
    model = entry.get("Model", "")

    if source and os.path.isfile(source):
        dest = os.path.join(photos_dir, fname)
        if os.path.normpath(source) != os.path.normpath(dest):
            try:
                shutil.copy2(source, dest)
            except OSError:
                pass

    return {
        "type": "Feature",
        "id": next_id,
        "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
        "properties": {
            "filename": fname,
            "datetime": dt,
            "altitude": alt,
            "make": make,
            "model": model,
        },
    }


def make_handler(plot_path):
    """Build a SimpleHTTPRequestHandler subclass that serves `plot_path` at `/`."""

    class Handler(http.server.SimpleHTTPRequestHandler):
        def translate_path(self, path):
            if self.path == "/":
                return plot_path
            if self.path.startswith("/plots"):
                return path.lstrip("/")
            return http.server.SimpleHTTPRequestHandler.translate_path(self, path)

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=REPO_ROOT, **kwargs)

    return Handler


def parse_args(argv):
    """Parse CLI flags for the server."""
    parser = argparse.ArgumentParser(description='Serve the LTS viewer locally')
    parser.add_argument("-plot", type=str, default=None,
                        help="Local filepath of html file to serve as root")
    parser.add_argument("-plot-go-pro", dest="plot_gopro", type=str, default=None,
                        help="Folder (or folder of folders) of GoPro JPGs; "
                             "serves the GoPro map page with LTS below")
    parser.add_argument("-port", type=int, default=DEFAULT_PORT,
                        help="Port to serve plot at")
    return parser.parse_args(argv)


def main(argv=None):
    """Build the GoPro overlay (if requested) and start the HTTP server."""
    args = parse_args(argv if argv is not None else sys.argv[1:])

    plot = args.plot or DEFAULT_PLOT
    if args.plot_gopro is not None:
        build_gopro_geojson(args.plot_gopro, repo_root=REPO_ROOT)
        plot = "map/gopro_photos.html"

    with socketserver.TCPServer(("", args.port), make_handler(plot)) as httpd:
        print(f"Serving at http://localhost:{args.port}/")
        httpd.serve_forever()


if __name__ == '__main__':
    main()
