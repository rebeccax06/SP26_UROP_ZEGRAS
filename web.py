import http.server
import socketserver
import argparse
import sys
import os
import json
import subprocess
import shutil

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))


def build_gopro_geojson(folder_path, repo_root=REPO_ROOT):
    """Run ExifTool on folder_path (recursive), build GeoJSON, write to plots/gopro_photos.json and copy images to plots/gopro_photos/."""
    folder_path = os.path.abspath(os.path.expanduser(folder_path))
    if not os.path.isdir(folder_path):
        raise FileNotFoundError(f"GoPro folder not found: {folder_path}")

    try:
        result = subprocess.run(
            [
                "exiftool", "-r", "-n", "-json",
                "-GPSLatitude", "-GPSLongitude", "-DateTimeOriginal",
                "-FileName", "-SourceFile", "-Altitude",
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

    raw = result.stdout.strip()
    if not raw:
        entries = []
    else:
        try:
            entries = json.loads(raw)
        except json.JSONDecodeError:
            entries = []
        if isinstance(entries, dict):
            entries = [entries]

    features = []
    photos_dir = os.path.join(repo_root, "plots", "gopro_photos")
    os.makedirs(photos_dir, exist_ok=True)

    for i, e in enumerate(entries):
        lat = e.get("GPSLatitude")
        lon = e.get("GPSLongitude")
        if lat is None or lon is None:
            continue
        source = e.get("SourceFile", "")
        fname = e.get("FileName", os.path.basename(source))
        dt = e.get("DateTimeOriginal") or e.get("CreateDate") or ""
        alt = e.get("GPSAltitude")

        if source and os.path.isfile(source):
            dest = os.path.join(photos_dir, fname)
            if os.path.normpath(source) != os.path.normpath(dest):
                try:
                    shutil.copy2(source, dest)
                except OSError:
                    pass

        features.append({
            "type": "Feature",
            "id": len(features),
            "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
            "properties": {
                "filename": fname,
                "datetime": dt,
                "altitude": alt,
            },
        })

    features.sort(key=lambda f: (f["properties"].get("datetime") or ""))

    geojson = {"type": "FeatureCollection", "features": features}
    out_json = os.path.join(repo_root, "plots", "gopro_photos.json")
    os.makedirs(os.path.dirname(out_json), exist_ok=True)
    with open(out_json, "w") as f:
        json.dump(geojson, f, indent=2)

    print(f"Wrote {len(features)} points to {out_json}")
    return len(features)


parser = argparse.ArgumentParser(
    description='Fetch and process OSM data into LTS')
parser.add_argument("-plot", type=str,
                    help="Local filepath of html file")
parser.add_argument("-plot-go-pro", dest="plot_gopro", type=str, default=None,
                    help="Folder (or folder of folders) of GoPro JPGs; serves GoPro map with LTS below")
parser.add_argument("-port", type=int,
                    help="Port to serve plot at")

args = parser.parse_args(sys.argv[1:])
if args.plot:
    PLOT = args.plot
else:
    PLOT = 'index.html'
if args.port:
    PORT = args.port
else:
    PORT = 8000

if args.plot_gopro is not None:
    build_gopro_geojson(args.plot_gopro, repo_root=REPO_ROOT)
    PLOT = "map/gopro_photos.html"

class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if self.path == "/":
            print(f'{PLOT=}')
            return PLOT
        if self.path.startswith("/plots"):
            return path.lstrip("/")
        return http.server.SimpleHTTPRequestHandler.translate_path(self, path)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO_ROOT, **kwargs)


with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving at http://localhost:{PORT}/")
    httpd.serve_forever()
