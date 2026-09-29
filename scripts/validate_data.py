import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"


def load(name):
    with (DATA / name).open(encoding="utf-8") as handle:
        return json.load(handle)


def validate_point(feature, label):
    assert feature.get("type") == "Feature", f"{label}: not a Feature"
    assert feature.get("geometry", {}).get("type") == "Point", f"{label}: expected Point"
    coordinates = feature["geometry"]["coordinates"]
    assert len(coordinates) == 2 and all(isinstance(value, (int, float)) and math.isfinite(value) for value in coordinates), f"{label}: invalid coordinates"
    lon, lat = coordinates
    assert 23.05 <= lon <= 23.60 and 42.40 <= lat <= 42.76, f"{label}: outside Vitosha bounds"


peaks = load("peaks.geojson")["features"]
huts = load("huts.geojson")["features"]
routes = load("hut-routes.geojson")["features"]
quality = load("data-quality.json")

peak_ids = set()
for peak in peaks:
    props = peak["properties"]
    validate_point(peak, props.get("id", "peak"))
    assert props["id"] not in peak_ids, f"duplicate peak id {props['id']}"
    assert props.get("name_bg") and props.get("name_en"), f"{props['id']}: missing bilingual name"
    assert props.get("elevation_m", 0) >= 1900, f"{props['id']}: elevation threshold"
    peak_ids.add(props["id"])

hut_ids = set()
for hut in huts:
    props = hut["properties"]
    validate_point(hut, props.get("id", "hut"))
    assert props["id"] not in hut_ids, f"duplicate hut id {props['id']}"
    assert props.get("name_bg") and props.get("name_en"), f"{props['id']}: missing bilingual name"
    hut_ids.add(props["id"])

route_ids = set()
per_peak = {peak_id: 0 for peak_id in peak_ids}
for route in routes:
    props = route["properties"]
    assert props["id"] not in route_ids, f"duplicate route id {props['id']}"
    assert props["peak_id"] in peak_ids, f"{props['id']}: unknown peak"
    assert props["hut_id"] in hut_ids, f"{props['id']}: unknown hut"
    assert route["geometry"]["type"] == "MultiLineString", f"{props['id']}: expected MultiLineString"
    line = route["geometry"]["coordinates"][0]
    assert len(line) >= 2, f"{props['id']}: route too short"
    assert props["distance_km"] > 0, f"{props['id']}: invalid distance"
    route_ids.add(props["id"])
    per_peak[props["peak_id"]] += 1

assert all(count == 3 for count in per_peak.values()), f"every peak needs three routes: {per_peak}"
assert quality["peak_count"] == len(peaks)
assert quality["hut_count"] == len(huts)
assert quality["hut_route_count"] == len(routes)

print(f"Validated {len(peaks)} peaks, {len(huts)} huts and {len(routes)} routes.")
