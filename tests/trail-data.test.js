import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const python = (script) => execFileSync("python", ["-c", script], { cwd: root, encoding: "utf8" }).trim();

test("capture selection preserves hut node/way IDs from the generated data", () => {
  assert.equal(python(`
import sys
sys.path.insert(0, "scripts")
from build_vitosha_data import HUT_IDS
from fetch_osm_captures import hut_osm_keys, overpass_query
keys = hut_osm_keys()
assert {osm_id for _, osm_id in keys} == HUT_IDS
assert {osm_id for kind, osm_id in keys if kind == "node"} == {2885252059, 274090337, 4641743876}
import json
huts = json.load(open("public/data/huts.geojson", encoding="utf-8"))["features"]
assert keys == {(hut["properties"]["osm_type"], hut["properties"]["osm_id"]) for hut in huts}
assert "out body geom" in overpass_query("routes", keys)
assert '[timeout:120]' in overpass_query("park", keys)
assert 'relation["boundary"="protected_area"]["name"~"\\u0412\\u0438\\u0442\\u043e\\u0448\\u0430"]' in overpass_query("park", keys)
print(len(keys))
`), "24");
});

test("park clipping keeps split rings, interior holes and rounded 300-metre corners", () => {
  assert.equal(python(`
import sys
from unittest import TestCase
sys.path.insert(0, "scripts")
from marked_trails import way_in_park
from park_boundary import ParkBoundary, select_park_relation
from trail_geometry import LON_SCALE, METRES_PER_DEGREE

def coordinate(x, y):
    return (23.30 + x / LON_SCALE, 42.58 + y / METRES_PER_DEGREE)

def fixture_geometry(*points):
    return [{"lon": lon, "lat": lat} for lon, lat in (coordinate(*point) for point in points)]

def way(ref, role, *points):
    return {"type": "way", "ref": ref, "role": role, "geometry": fixture_geometry(*points)}

tags = {"boundary": "protected_area", "name": "Vitosha"}
park = {"id": 1, "type": "relation", "tags": {**tags, "protect_class": "5"}, "members": [
    way(1, "outer", (0, 0), (2000, 0), (2000, 2000)),
    way(2, "outer", (0, 0), (0, 2000), (2000, 2000)),
    way(3, "inner", (800, 500), (1600, 500), (1600, 1500), (800, 1500), (800, 500)),
]}
fallback = {"id": 2, "type": "relation", "tags": {**tags, "leisure": "nature_reserve"}}
assert select_park_relation([fallback, park]) is park
with TestCase().assertRaises(ValueError):
    select_park_relation([])
with TestCase().assertRaises(ValueError):
    ParkBoundary({**park, "members": [park["members"][0]]})

boundary = ParkBoundary(park)
from_west, to_east = coordinate(-500, 1000), coordinate(2500, 1000)
inside, buffered = boundary.intervals(from_west, to_east)
for parts, expected in ((inside, [(0, 800), (1600, 2000)]), (buffered, [(-300, 1100), (1300, 2300)])):
    assert len(parts) == len(expected)
    for actual, target in zip(parts, expected):
        assert all(abs(-500 + t * 3000 - x) < 0.01 for t, x in zip(actual, target))
assert boundary.contains(coordinate(-210, -210))
assert not boundary.contains(coordinate(-220, -220))
assert not boundary.contains_segment(coordinate(500, 1000), coordinate(1700, 1000))
lines, within, full, clipped = way_in_park(fixture_geometry((-500, 1000), (2500, 1000)), boundary)
assert clipped and len(lines) == 2 and 0.39 < within / full < 0.41
assert all(boundary.contains_segment(*line) for line in lines)
print("ok")
`), "ok");
});

test("trail geometry keeps gaps and rough sketches are only upgraded with real elevations and acceptable endpoints", () => {
  assert.equal(python(`
import sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, "scripts")
from build_vitosha_data import upgrade_approach, via_waypoints
from trail_geometry import TrailProximity, VITOSHA_BOUNDS, clip_segment, connected_pieces, shortest_path, stitch_lines, trail_graph
a, mid, b = (23.22, 42.55), (23.229, 42.55), (23.24, 42.55)
c, d = (23.25, 42.55), (23.26, 42.55)
assert clip_segment((23.04, 42.55), a, VITOSHA_BOUNDS)[0] == (23.05, 42.55)
lines = [[a, mid], [b, mid], [c, d]]
assert connected_pieces(lines) == 2
assert {tuple(line) for line in stitch_lines(lines)} == {(a, mid, b), (c, d)}
assert TrailProximity({"a": [lines[0]], "b": [lines[0]]}).shares(lines[0]) == ({"a": 1.0, "b": 1.0}, 1.0)
graph = trail_graph(lines)
assert shortest_path(graph, a, b) == [a, mid, b] and shortest_path(graph, a, d) is None
assert len(via_waypoints(graph, list(a), list(b))) > 2
route = {"geometry": {"coordinates": [[a,b]]}, "properties": {"id": "peak-1--hut-2", "geometry_kind": "approximate", "start_gap_m": 0, "summit_gap_m": 0}}
def payload(points):
    return {"features": [{"geometry": {"type": "LineString", "coordinates": points}, "properties": {"track-length": "1900"}}]}
with tempfile.TemporaryDirectory() as temp, patch("build_vitosha_data.ROUTE_CACHE", Path(temp)):
    with patch("build_vitosha_data.request_route", return_value=payload([a, b])):
        upgrade_approach(route, list(a), list(b), graph, True)
        assert route["properties"]["geometry_kind"] == "approximate"
    with patch("build_vitosha_data.request_route", return_value=payload([(*a, 1850), (*mid, 1960), (*b, 2060)])):
        upgrade_approach(route, list(a), list(b), graph, True)
        assert route["properties"]["geometry_kind"] == "routed"
        assert route["properties"]["profile_elevations_m"] == [1850, 1960, 2060]
print("ok")
`), "ok");
});
