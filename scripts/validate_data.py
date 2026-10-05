import json
import math
from pathlib import Path
from build_vitosha_data import haversine_km


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
    for point in line:
        assert len(point) == 2 and all(type(value) in (int, float) and math.isfinite(value) for value in point), f"{props['id']}: invalid route coordinate"
        assert 23.05 <= point[0] <= 23.60 and 42.40 <= point[1] <= 42.76, f"{props['id']}: route outside Vitosha"
    assert props["trail_node_count"] == len(line), f"{props['id']}: point count mismatch"
    assert props["geometry_kind"] in ("routed", "approximate"), f"{props['id']}: unknown geometry kind"
    assert (props["geometry_kind"] == "routed") == props["source"].startswith("BRouter"), f"{props['id']}: misleading provenance"
    peak_point = next(peak for peak in peaks if peak["properties"]["id"] == props["peak_id"])["geometry"]["coordinates"]
    hut_point = next(hut for hut in huts if hut["properties"]["id"] == props["hut_id"])["geometry"]["coordinates"]
    assert abs(props["start_gap_m"] - haversine_km(line[0], hut_point) * 1000) <= 1, f"{props['id']}: start gap mismatch"
    assert abs(props["summit_gap_m"] - haversine_km(line[-1], peak_point) * 1000) <= 1, f"{props['id']}: summit gap mismatch"
    elevations = props["profile_elevations_m"]
    if elevations is not None:
        assert props["geometry_kind"] == "routed" and props["profile_source"] == "BRouter elevation samples", f"{props['id']}: invalid profile source"
        assert len(elevations) == len(line) and all(type(height) in (int, float) and math.isfinite(height) and 500 <= height <= 3000 for height in elevations), f"{props['id']}: invalid profile"
    else:
        assert props["profile_source"] is None, f"{props['id']}: source without a profile"
    assert "popularity_score" not in props and "hiking_relation_count" not in props, f"{props['id']}: unsupported ranking claims"
    route_ids.add(props["id"])
    per_peak[props["peak_id"]] += 1

assert all(count == 3 for count in per_peak.values()), f"every peak needs three routes: {per_peak}"
assert quality["peak_count"] == len(peaks)
assert quality["hut_count"] == len(huts)
assert quality["hut_route_count"] == len(routes)
assert quality["schema_version"] == 2
assert quality["route_counts"]["routed"] == sum(route["properties"]["geometry_kind"] == "routed" for route in routes)
assert quality["route_counts"]["approximate"] == sum(route["properties"]["geometry_kind"] == "approximate" for route in routes)
assert quality["route_counts"]["with_elevation_profile"] == sum(route["properties"]["profile_elevations_m"] is not None for route in routes)

print(f"Validated {len(peaks)} peaks, {len(huts)} huts and {len(routes)} routes.")
