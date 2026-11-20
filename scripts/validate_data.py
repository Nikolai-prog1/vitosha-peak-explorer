import json
import math
from pathlib import Path
from build_vitosha_data import (HUT_APPROACH_MODE, OSM_LICENSE, PARK_SOURCE, PEAK_APPROACH_MODE, ROUTES_PER_PEAK, START_CLUSTER_M,
                                VIA_TRAIL_SOURCE, haversine_km, read_json)
from hut_data import HUT_STATUSES, checked_date, valid_detail_value
from marked_trails import MIN_PARK_KM, MIN_PARK_SHARE, OTHER_WAY_ROLES, TRAIL_COLOURS, TRAIL_NETWORKS
from park_boundary import PARK_BUFFER_M, ParkBoundary, select_park_relation
from trail_geometry import VITOSHA_BOUNDS


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"


def load(name):
    with (DATA / name).open(encoding="utf-8") as handle:
        return json.load(handle)


def validate_coordinate_pair(coordinates, label):
    assert len(coordinates) == 2 and all(type(value) in (int, float) and math.isfinite(value) for value in coordinates), f"{label}: invalid coordinates"


def validate_coordinates(coordinates, label):
    validate_coordinate_pair(coordinates, label)
    lon, lat = coordinates
    west, south, east, north = VITOSHA_BOUNDS
    assert west <= lon <= east and south <= lat <= north, f"{label}: outside Vitosha bounds"


def validate_point(feature, label):
    assert feature.get("type") == "Feature", f"{label}: not a Feature"
    assert feature.get("geometry", {}).get("type") == "Point", f"{label}: expected Point"
    validate_coordinates(feature["geometry"]["coordinates"], label)


def fraction(value):
    return type(value) in (int, float) and 0 <= value <= 1


peaks = load("peaks.geojson")["features"]
huts = load("huts.geojson")["features"]
routes = load("hut-routes.geojson")["features"]
quality = load("data-quality.json")
marked_trails = load("marked-trails.geojson")["features"]
park_capture = read_json(PARK_SOURCE)
park = ParkBoundary(select_park_relation(park_capture["elements"]))

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
    assert props["kind"] in {"hut", "shelter"}, f"{props['id']}: invalid hut kind"
    assert props["osm_type"] in {"node", "way"} and props["osm_url"] == f"https://www.openstreetmap.org/{props['osm_type']}/{props['osm_id']}"
    assert props["elevation_m"] is None or (type(props["elevation_m"]) in (int, float) and 500 <= props["elevation_m"] <= 3000), f"{props['id']}: invalid hut elevation"
    assert isinstance(props["details"], dict)
    for field, detail in props["details"].items():
        assert detail["source"] in {"osm", "manual"} and valid_detail_value(detail["value"]), f"{props['id']}: missing source or invalid value for {field}"
        assert detail["checked"] is None or checked_date(detail["checked"]) == detail["checked"], f"{props['id']}: invalid checked date for {field}"
    status = props["details"].get("status")
    assert status is None or (status["value"] in HUT_STATUSES and status["source"] == "manual" and status["checked"]), f"{props['id']}: unsourced status"
    hut_ids.add(props["id"])
closed_huts = {hut["properties"]["id"] for hut in huts if "status" in hut["properties"]["details"]}

trails_by_id = {}
for trail in marked_trails:
    props = trail["properties"]
    trail_id = props["id"]
    relation = props["osm_relation_id"]
    assert type(relation) is int and relation > 0 and trail_id == f"trail-{relation}" and trail_id not in trails_by_id, f"{trail_id}: invalid or duplicate trail id"
    assert props["osm_url"] == f"https://www.openstreetmap.org/relation/{relation}"
    assert props["wmt_url"] == f"https://hiking.waymarkedtrails.org/#route?id={relation}&type=relation"
    assert props["colour"] is None or props["colour"] in TRAIL_COLOURS, f"{trail_id}: invalid marking colour"
    assert props["network"] is None or props["network"] in TRAIL_NETWORKS, f"{trail_id}: invalid network"
    assert type(props["clipped"]) is bool and 0 < props["length_km"] <= 1000
    assert MIN_PARK_KM <= props["park_length_km"] <= props["relation_length_km"] + 0.000001, f"{trail_id}: invalid park length"
    assert fraction(props["park_share"]) and props["park_share"] >= MIN_PARK_SHARE, f"{trail_id}: invalid park share"
    assert all(role["role"] in OTHER_WAY_ROLES and type(role["osm_way_id"]) is int and role["osm_way_id"] > 0 for role in props["way_roles"])
    assert props["alternative_way_count"] == sum(role["role"] == "alternative" for role in props["way_roles"])
    assert trail["type"] == "Feature" and trail["geometry"]["type"] == "MultiLineString"
    paths = trail["geometry"]["coordinates"]
    assert type(props["piece_count"]) is int and 1 <= props["piece_count"] <= len(paths)
    for line in paths:
        assert len(line) >= 2 and any(point != line[0] for point in line[1:]), f"{trail_id}: invalid line"
        for point in line:
            validate_coordinate_pair(point, trail_id)
            assert park.contains(point), f"{trail_id}: point outside Vitosha Nature Park + {PARK_BUFFER_M} m: {point}"
        for start, end in zip(line, line[1:]):
            assert park.contains_segment(start, end), f"{trail_id}: segment leaves Vitosha Nature Park + {PARK_BUFFER_M} m: {start}–{end}"
    trails_by_id[trail_id] = props

route_ids = set()
per_peak = {peak_id: [] for peak_id in peak_ids}
routed_huts = set()
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
        validate_coordinates(point, props["id"])
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
    assert props["source"] != VIA_TRAIL_SOURCE or elevations is not None, f"{props['id']}: via-trails route without elevations"
    assert "popularity_score" not in props and "hiking_relation_count" not in props, f"{props['id']}: unsupported ranking claims"
    assert props["ranking_mode"] in {PEAK_APPROACH_MODE, HUT_APPROACH_MODE}, f"{props['id']}: unexpected approach selection mode"
    assert props["hut_id"] not in closed_huts, f"{props['id']}: approach starts at a closed hut"
    assert fraction(props["marked_share"]), f"{props['id']}: invalid marked share"
    seen = set()
    previous = props["marked_share"]
    for annotation in props["marked_trails"]:
        trail_id, share = annotation["trail_id"], annotation["share"]
        assert trail_id in trails_by_id and trail_id not in seen, f"{props['id']}: dangling or duplicate trail {trail_id}"
        assert fraction(share) and share <= previous, f"{props['id']}: invalid or unsorted share"
        assert all(annotation[field] == trails_by_id[trail_id][field] for field in ("ref", "colour")), f"{props['id']}: wrong trail metadata"
        seen.add(trail_id)
        previous = share
    route_ids.add(props["id"])
    if props["ranking_mode"] == PEAK_APPROACH_MODE:
        per_peak[props["peak_id"]].append(hut_point)
    else:
        assert props["hut_id"] not in routed_huts, f"{props['id']}: a hut-only approach for a hut that already has one"
    routed_huts.add(props["hut_id"])

assert all(len(starts) == ROUTES_PER_PEAK for starts in per_peak.values()), f"every peak needs {ROUTES_PER_PEAK} approaches"
for peak_id, starts in per_peak.items():
    assert all(haversine_km(left, right) * 1000 >= START_CLUSTER_M for index, left in enumerate(starts) for right in starts[index + 1:]), f"{peak_id}: two approaches share a trailhead"
assert routed_huts == hut_ids - closed_huts, f"open huts without an approach: {sorted(hut_ids - closed_huts - routed_huts)}"
assert quality["approach_selection"] == {"per_peak": ROUTES_PER_PEAK, "start_cluster_m": START_CLUSTER_M, "closed_huts_excluded": True}
assert quality["peak_count"] == len(peaks)
assert quality["hut_count"] == len(huts)
assert quality["hut_route_count"] == len(routes)
assert quality["schema_version"] == 3
assert quality["license"] == OSM_LICENSE
assert quality["marked_trail_count"] == len(marked_trails) >= 5
for key in ("marked_trails", "hut_details", "park_boundary"):
    assert quality["capture_sources"][key] in {"overpass", "geofabrik bulgaria-latest"}
    assert quality["source_timestamps"][key].endswith("Z")
assert quality["source_timestamps"]["park_boundary"] == park_capture["osm3s"]["timestamp_osm_base"]
assert quality["capture_sources"]["park_boundary"] == park_capture["capture_source"]
trail_filter = quality["marked_trail_filter"]
assert (trail_filter["park_relation_id"], trail_filter["buffer_m"]) == (park.relation_id, PARK_BUFFER_M)
assert (trail_filter["min_park_length_km"], trail_filter["min_park_share"]) == (MIN_PARK_KM, MIN_PARK_SHARE)
excluded = [entry["id"] for entry in trail_filter["excluded"]]
assert len(excluded) == len(set(excluded)) and not set(excluded) & trails_by_id.keys(), "Excluded trail IDs overlap or repeat"
expected_detail_counts = {}
for hut in huts:
    for field in hut["properties"]["details"]:
        expected_detail_counts[field] = expected_detail_counts.get(field, 0) + 1
assert quality["hut_detail_field_counts"] == expected_detail_counts
assert quality["route_counts"]["routed"] == sum(route["properties"]["geometry_kind"] == "routed" for route in routes)
assert quality["route_counts"]["approximate"] == sum(route["properties"]["geometry_kind"] == "approximate" for route in routes)
assert quality["route_counts"]["with_elevation_profile"] == sum(route["properties"]["profile_elevations_m"] is not None for route in routes)
assert quality["route_counts"]["via_marked_trails"] == sum(route["properties"]["source"] == VIA_TRAIL_SOURCE for route in routes)

print(f"Validated {len(peaks)} peaks, {len(huts)} huts, {len(routes)} approaches and {len(marked_trails)} marked trails within the park + {PARK_BUFFER_M} m.")
