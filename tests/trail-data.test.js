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
assert {osm_id for kind, osm_id in keys if kind == "node"} == {2885252059, 274090337}
assert "out body geom" in overpass_query("routes", keys)
print(len(keys))
`), "16");
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
