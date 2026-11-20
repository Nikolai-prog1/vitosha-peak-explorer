"""Explicitly refresh the public OSM source snapshots used by the builder."""

import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import venv
from pathlib import Path

from build_vitosha_data import HUT_IDS, PARK_SOURCE, POI_SOURCE, ROOT, WORK, read_json
from park_boundary import ParkBoundary, is_vitosha_park, select_park_relation
from trail_geometry import CAPTURE_BOUNDS, clip_segment

OVERPASS = "https://overpass-api.de/api/interpreter"
GEOFABRIK = "https://download.geofabrik.de/europe"
USER_AGENT = "VitoshaPeakExplorer/1.0 (+https://github.com/Nikolai-prog1/vitosha-peak-explorer)"
OSMIUM_VERSION = "4.3.2"
FILES = {
    "park": PARK_SOURCE,
    "huts": WORK / "vitosha-huts-details-overpass.json",
    "routes": WORK / "vitosha-hiking-routes-overpass.json",
}


def hut_osm_keys():
    # Read the configured huts from the POI capture so a newly added hut can be fetched before the first build.
    keys = {(element["type"], element["id"]) for element in read_json(POI_SOURCE)["elements"]
            if element["id"] in HUT_IDS and element["type"] in {"node", "way"}}
    if len(keys) != len(HUT_IDS) or {osm_id for _, osm_id in keys} != HUT_IDS:
        raise ValueError("The POI capture does not contain exactly one node or way for each configured hut ID")
    return keys


def overpass_query(kind, hut_keys):
    if kind == "huts":
        selectors = "".join(f"{osm_type}(id:{','.join(map(str, ids))});"
                            for osm_type in ("node", "way")
                            if (ids := sorted(osm_id for key_type, osm_id in hut_keys if key_type == osm_type)))
        return f"[out:json][timeout:60];({selectors});out tags center;"
    if kind == "park":
        # Body output retains the outer and inner member ways for ring assembly.
        return '[out:json][timeout:120];relation["boundary"="protected_area"]["name"~"Витоша"];out body geom;'
    west, south, east, north = CAPTURE_BOUNDS
    # `out tags geom` omits relation members, including their way geometries.
    return f'[out:json][timeout:180];relation["type"="route"]["route"~"^(hiking|foot)$"]({south},{west},{north},{east});out body geom;'


def capture_timestamp(value):
    timestamp = dt.datetime.fromisoformat(value)
    if timestamp.utcoffset() != dt.timedelta(0):
        raise ValueError("Capture timestamp must be in UTC")
    return timestamp.isoformat().replace("+00:00", "Z")


def snapshot(elements, timestamp, source):
    return {
        "capture_source": source,
        "osm3s": {"timestamp_osm_base": capture_timestamp(timestamp)},
        "elements": sorted(elements, key=lambda obj: (obj["type"], obj["id"])),
    }


def retry_request(label, fetch):
    for attempt in range(1, 4):
        try:
            return fetch()
        except (OSError, ValueError, KeyError) as error:
            print(f"{label} attempt {attempt}/3: {error}", file=sys.stderr, flush=True)
            if attempt == 3:
                raise RuntimeError(f"{label} unavailable after 3 attempts") from error
            time.sleep(60)


def from_overpass(kinds, hut_keys):
    captures = {}
    for kind in kinds:
        if captures:
            time.sleep(5)
        request = urllib.request.Request(
            OVERPASS,
            data=urllib.parse.urlencode({"data": overpass_query(kind, hut_keys)}).encode("utf-8"),
            headers={"User-Agent": USER_AGENT},
            method="POST",
        )

        def fetch():
            with urllib.request.urlopen(request, timeout=205) as response:
                result = json.load(response)
            if result.get("remark"):
                raise ValueError(result["remark"])
            return snapshot(result["elements"], result["osm3s"]["timestamp_osm_base"], "overpass")

        capture = retry_request(f"Overpass {kind}", fetch)
        if kind == "park":
            capture["elements"] = [select_park_relation(capture["elements"])]
        captures[kind] = capture
    return captures


def geofabrik_download(run_dir):
    directory = run_dir / "osm"
    directory.mkdir(parents=True, exist_ok=True)
    pbf = directory / "bulgaria-latest.osm.pbf"

    def download():
        request = urllib.request.Request(f"{GEOFABRIK}/{pbf.name}", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=90) as response:
            with tempfile.NamedTemporaryFile(dir=directory, delete=False) as output:
                pending = Path(output.name)
                try:
                    shutil.copyfileobj(response, output, length=1024 * 1024)
                    output.close()
                    pending.replace(pbf)
                finally:
                    output.close()
                    pending.unlink(missing_ok=True)

    def state():
        request = urllib.request.Request(f"{GEOFABRIK}/bulgaria-updates/state.txt", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=30) as response:
            text = response.read(8192).decode("utf-8")
        line = next((line for line in text.splitlines() if line.startswith("timestamp=")), "")
        return capture_timestamp(line.removeprefix("timestamp=").replace("\\:", ":"))

    retry_request("Geofabrik Bulgaria PBF", download)
    return pbf, retry_request("Geofabrik replication state", state)


def extract_geofabrik(pbf, timestamp, kinds, hut_keys):
    import osmium

    relations = []
    parks = []
    member_ids = set()
    ways = {}
    huts = []

    class Relations(osmium.SimpleHandler):
        def relation(self, relation):
            tags = dict(relation.tags)
            is_park = "park" in kinds and is_vitosha_park(tags)
            is_route = "routes" in kinds and tags.get("type") == "route" and tags.get("route") in {"hiking", "foot"}
            if not (is_park or is_route):
                return
            members = [{"type": "way", "ref": member.ref, "role": member.role}
                       for member in relation.members if member.type == "w"]
            member_ids.update(member["ref"] for member in members)
            (parks if is_park else relations).append({"type": "relation", "id": relation.id, "tags": tags, "members": members})

    class Geometry(osmium.SimpleHandler):
        def node(self, node):
            if ("node", node.id) in hut_keys:
                huts.append({"type": "node", "id": node.id, "lat": node.location.lat,
                             "lon": node.location.lon, "tags": dict(node.tags)})

        def way(self, way):
            hut = ("way", way.id) in hut_keys
            if not hut and way.id not in member_ids:
                return
            points = [{"lat": node.lat, "lon": node.lon} if node.location.valid() else None for node in way.nodes]
            if way.id in member_ids:
                ways[way.id] = points
            if hut and (valid := [point for point in points if point is not None]):
                center = {axis: round((min(p[axis] for p in valid) + max(p[axis] for p in valid)) / 2, 7)
                          for axis in ("lat", "lon")}
                huts.append({"type": "way", "id": way.id, "center": center, "tags": dict(way.tags)})

    if "routes" in kinds or "park" in kinds:
        Relations().apply_file(pbf)
    Geometry().apply_file(pbf, locations=True)
    intersecting = {
        way_id for way_id, points in ways.items()
        if any(left and right and clip_segment((left["lon"], left["lat"]), (right["lon"], right["lat"]), CAPTURE_BOUNDS)
               for left, right in zip(points, points[1:]))
    }
    selected = []
    for relation in relations:
        if any(member["ref"] in intersecting for member in relation["members"]):
            selected.append(relation)
    for relation in [*parks, *selected]:
        for member in relation["members"]:
            member["geometry"] = ways.get(member["ref"], [])
    results = {"huts": huts, "routes": selected, "park": [select_park_relation(parks)] if "park" in kinds else []}
    return {kind: snapshot(results[kind], timestamp, "geofabrik bulgaria-latest") for kind in kinds}


def save_capture(path, capture):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, encoding="utf-8", newline="\n", delete=False) as output:
        pending = Path(output.name)
        try:
            json.dump(capture, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.write("\n")
            output.close()
            pending.replace(path)
        finally:
            output.close()
            pending.unlink(missing_ok=True)


def verify_and_save(captures, hut_keys):
    if "park" in captures:
        ParkBoundary(select_park_relation(captures["park"]["elements"]))
    if "huts" in captures:
        elements = captures["huts"]["elements"]
        if len(elements) != len(hut_keys) or {(obj["type"], obj["id"]) for obj in elements} != hut_keys:
            raise ValueError(f"The OSM detail capture does not contain the exact {len(hut_keys)} configured hut objects")
    if "routes" in captures:
        with_geometry = sum(any(member["type"] == "way" and member.get("geometry") for member in relation.get("members", []))
                            for relation in captures["routes"]["elements"])
        if with_geometry < 5:
            raise ValueError("Fewer than five hiking relations with way geometry in the Vitosha bounds. Review the OSM capture.")
    for kind, capture in captures.items():
        save_capture(FILES[kind], capture)
        print(f"{kind}: {len(capture['elements'])} OSM elements via {capture['capture_source']}; "
              f"snapshot {capture['osm3s']['timestamp_osm_base']}")


def run_geofabrik(kinds, hut_keys, run_dir):
    environment = run_dir / "venv-osm"
    if Path(sys.prefix).resolve() == environment:
        pbf, timestamp = geofabrik_download(run_dir)
        verify_and_save(extract_geofabrik(pbf, timestamp, kinds, hut_keys), hut_keys)
        return
    executable = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if not executable.exists():
        venv.create(environment, with_pip=True)
    version = subprocess.run([executable, "-c", "from importlib.metadata import version; print(version('osmium'))"],
                             capture_output=True, text=True)
    if version.returncode or version.stdout.strip() != OSMIUM_VERSION:
        subprocess.run([executable, "-m", "pip", "install", "--only-binary=:all:", f"osmium=={OSMIUM_VERSION}"], check=True)
    subprocess.run([executable, __file__, "--source", "geofabrik", "--run-dir", run_dir,
                    *(f"--{kind}" for kind in kinds)], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=("overpass", "geofabrik"), default="overpass")
    parser.add_argument("--huts", action="store_true")
    parser.add_argument("--routes", action="store_true")
    parser.add_argument("--park", action="store_true", help="Capture the OSM boundary of Vitosha Nature Park")
    parser.add_argument("--run-dir", type=Path, default=ROOT.parent / "_codex", help="Geofabrik downloads and venv, outside the repository")
    args = parser.parse_args()
    kinds = [kind for kind in FILES if getattr(args, kind)]
    if not kinds:
        parser.error("Choose at least one of --huts, --routes, and --park")
    run_dir = args.run_dir.resolve()
    if run_dir.is_relative_to(ROOT):
        parser.error("--run-dir must be outside the repository")
    try:
        hut_keys = hut_osm_keys() if args.huts else set()
        if args.source == "overpass":
            try:
                captures = from_overpass(kinds, hut_keys)
            except RuntimeError:
                print("Switching to the Geofabrik Bulgaria extract.", file=sys.stderr, flush=True)
            else:
                verify_and_save(captures, hut_keys)
                return
        run_geofabrik(kinds, hut_keys, run_dir)
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
