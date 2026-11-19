"""Build the local Vitosha datasets from cached OpenStreetMap exports.

The source captures live under work/ and are intentionally not fetched by the
browser.  Route geometry is requested from BRouter's hiking profile when the
script is run with --refresh-routes; a conservative local fallback keeps the
app buildable without network access.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import tempfile
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from hut_data import enrich_huts
from marked_trails import MIN_PARK_KM, MIN_PARK_SHARE, annotate_approaches, build_marked_trails
from park_boundary import PARK_BUFFER_M, ParkBoundary, select_park_relation
from trail_geometry import VITOSHA_BOUNDS, haversine_km, sample_line, shortest_path, trail_graph

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
DATA = ROOT / "public" / "data"
PEAK_SOURCE = WORK / "vitosha-peaks-overpass.json"
POI_SOURCE = WORK / "vitosha-pois-overpass.json"
HUT_DETAIL_SOURCE = WORK / "vitosha-huts-details-overpass.json"
MARKED_TRAIL_SOURCE = WORK / "vitosha-hiking-routes-overpass.json"
PARK_SOURCE = WORK / "vitosha-park-boundary-overpass.json"
CURATED_HUTS = WORK / "hut-details.curated.json"
ROUTE_CACHE = WORK / "brouter-cache"
ROUTE_WORKERS = 2
VIA_TRAIL_SOURCE = "BRouter hiking-beta via OSM marked trails"
PROFILE_SOURCE = "BRouter elevation samples"
OSM_LICENSE = "Contains OpenStreetMap data © OpenStreetMap contributors, available under ODbL 1.0; public/data derived from it is offered under ODbL 1.0."
UPGRADE_SKETCHES_VIA_TRAILS = True

PEAK_LIMIT = 17
ROUTES_PER_PEAK = 3
PEAK_MIN_ELEVATION = 1900
VITOSHA_CORE = (23.20, 42.50, 23.35, 42.62)

PEAK_ENGLISH = {
    "Черни връх": "Cherni Vrah",
    "Голям Резен": "Golyam Rezen",
    "Скопарника": "Skoparnika",
    "Кара чаир": "Kara Chair",
    "Купена": "Kupena",
    "Малък Резен": "Malak Rezen",
    "Ярловски Купен": "Yarlovski Kupen",
    "Голям Котор (Сиврикая)": "Golyam Kotor (Sivrikaya)",
    "Самара": "Samara",
    "Лъвчето": "Lavcheto",
    "Селимица": "Selimitsa",
    "Стената": "Stenata",
    "Сива Грамада": "Siva Gramada",
    "Средец": "Sredets",
    "Голям Купен": "Golyam Kupen",
    "Меча дупка": "Mecha Dupka",
    "Ушите": "Ushite",
}

HUT_IDS = {
    55188093,
    266281250,
    430238361,
    430238360,
    392680123,
    432984797,
    326138927,
    175034034,
    296397022,
    56057967,
    2885252059,
    489835045,
    278783212,
    487390004,
    274090337,
    266281246,
}

HUT_ENGLISH = {
    "х. Трендафила": "Trendafila Hut",
    "хижа Алеко": "Aleko Hut",
    "з. Конярника": "Konyarnika Shelter",
    "х. Кумата": "Kumata Hut",
    "х. Еделвайс": "Edelweiss Hut",
    "х. Звездица": "Zvezditsa Hut",
    "хижа Селимица": "Selimitsa Hut",
    "х. Борова гора": "Borova Gora Hut",
    "х. Боерица": "Boeritsa Hut",
    "х. Планинец": "Planinets Hut",
    "х. Момина скала": "Momina Skala Hut",
    "х. Камен дел": "Kamen Del Hut",
    "х. Есперанто": "Esperanto Hut",
    "х. Физкултурник": "Fizkulturnik Hut",
    "х. Погледец": "Pogledets Hut",
    "х. Средец": "Sredets Hut",
    "х. Септември": "Septemvri Hut",
    "Проф. Ив. Стайков": "Prof. Iv. Staykov Hut",
}


def read_json(path: Path):
    with path.open(encoding="utf-8-sig") as handle:
        return json.load(handle)


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, encoding="utf-8", newline="\n", delete=False) as handle:
        pending = Path(handle.name)
        try:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
            handle.close()
            pending.replace(path)
        finally:
            handle.close()
            pending.unlink(missing_ok=True)


def clean_name(value: str) -> str:
    return value.split(";")[0].strip()


def slug(value: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    ascii_name = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_name).strip("-").lower()
    return ascii_name or "osm-feature"


def element_coord(element):
    if element["type"] == "node":
        return [float(element["lon"]), float(element["lat"])]
    center = element.get("center") or {}
    return [float(center["lon"]), float(center["lat"])]


def build_peaks(osm):
    west, south, east, north = VITOSHA_CORE
    candidates = []
    for element in osm["elements"]:
        tags = element.get("tags", {})
        raw_name = tags.get("name:bg") or tags.get("name")
        if not raw_name or "ele" not in tags or element.get("type") != "node":
            continue
        try:
            elevation = round(float(str(tags["ele"]).replace(",", ".")))
        except ValueError:
            continue
        lon, lat = element_coord(element)
        if elevation < PEAK_MIN_ELEVATION or not (west <= lon <= east and south <= lat <= north):
            continue
        name_bg = clean_name(raw_name)
        name_en = tags.get("name:en") or PEAK_ENGLISH.get(name_bg) or name_bg
        candidates.append(
            {
                "type": "Feature",
                "properties": {
                    "id": f"peak-{element['id']}",
                    "name_bg": name_bg,
                    "name_en": clean_name(name_en),
                    "elevation_m": elevation,
                    "confidence": 0.96 if tags.get("name") and tags.get("ele") else 0.86,
                    "source_names": f"OpenStreetMap node {element['id']}",
                    "notes": "OSM natural=peak node with an explicit summit position and elevation.",
                    "osm_id": element["id"],
                },
                "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
            }
        )
    return sorted(candidates, key=lambda feature: feature["properties"]["elevation_m"], reverse=True)[:PEAK_LIMIT]


def build_huts(osm):
    huts = []
    for element in osm["elements"]:
        if element["id"] not in HUT_IDS:
            continue
        tags = element.get("tags", {})
        raw_name = tags.get("name:bg") or tags.get("name") or f"OSM {element['id']}"
        name_bg = clean_name(raw_name)
        name_en = tags.get("name:en") or HUT_ENGLISH.get(name_bg) or name_bg
        lon, lat = element_coord(element)
        elevation = tags.get("ele")
        try:
            elevation = round(float(str(elevation).replace(",", "."))) if elevation is not None else None
        except ValueError:
            elevation = None
        kind = "shelter" if tags.get("amenity") == "shelter" or "з." in name_bg.lower() else "hut"
        huts.append(
            {
                "type": "Feature",
                "properties": {
                    "id": f"hut-{element['id']}",
                    "name_bg": name_bg,
                    "name_en": clean_name(name_en),
                    "elevation_m": elevation,
                    "kind": kind,
                    "source_names": f"OpenStreetMap {element['type']} {element['id']}",
                    "osm_id": element["id"],
                },
                "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
            }
        )
    return sorted(huts, key=lambda feature: feature["properties"]["name_bg"])


def fallback_path(start, end, rank):
    lon1, lat1 = start
    lon2, lat2 = end
    bend = (rank - 1) * 0.0015
    return [
        start,
        [lon1 * 0.72 + lon2 * 0.28 + bend, lat1 * 0.72 + lat2 * 0.28 - bend],
        [lon1 * 0.35 + lon2 * 0.65 - bend, lat1 * 0.35 + lat2 * 0.65 + bend],
        end,
    ]


def route_cache_path(peak, hut):
    return ROUTE_CACHE / f"{peak['properties']['id']}--{hut['properties']['id']}.geojson"


class MissingRouteCache(Exception):
    pass


def request_route(points):
    params = urllib.parse.urlencode({
        "lonlats": "|".join(f"{lon},{lat}" for lon, lat in points),
        "profile": "hiking-beta",
        "alternativeidx": 0,
        "format": "geojson",
    })
    request = urllib.request.Request(
        f"https://brouter.de/brouter?{params}",
        headers={"User-Agent": "VitoshaPeakExplorer/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 400:
            with error:
                message = error.read(1024).decode("utf-8", errors="replace").strip()
            return {"no_route_http": 400, "message": message}
        raise


def route_geometry(payload):
    if payload.get("no_route_http") == 400 or "refresh_error" in payload:
        return None
    feature = payload["features"][0]
    points = feature["geometry"]["coordinates"]
    if feature["geometry"]["type"] != "LineString" or len(points) < 2:
        raise ValueError("Invalid BRouter LineString")
    coordinates = [[round(point[0], 7), round(point[1], 7)] for point in points]
    west, south, east, north = VITOSHA_BOUNDS
    if any(not (west <= lon <= east and south <= lat <= north) for lon, lat in coordinates):
        raise ValueError("BRouter returned a coordinate outside Vitosha")
    props = feature.get("properties", {})
    elevations = [round(point[2], 1) for point in points] if all(
        len(point) >= 3 and isinstance(point[2], (int, float)) and math.isfinite(point[2])
        and 500 <= point[2] <= 3000 for point in points
    ) else None
    return coordinates, round(float(props["track-length"]) / 1000, 1), elevations


def make_route(peak, hut, rank, refresh):
    start, end = hut["geometry"]["coordinates"], peak["geometry"]["coordinates"]
    cache = route_cache_path(peak, hut)
    if refresh:
        try:
            payload = request_route([start, end])
        except OSError as error:
            # A failed refresh must not erase a previously obtained routed line.
            print(f"BRouter refresh failed for {cache.stem}: {error}", flush=True)
            if cache.exists():
                payload = read_json(cache)
            else:
                payload = {"refresh_error": type(error).__name__, "http_status": getattr(error, "code", None)}
                write_json(cache, payload)
            if isinstance(error, urllib.error.HTTPError):
                error.close()
        else:
            route_geometry(payload)
            write_json(cache, payload)
    else:
        try:
            payload = read_json(cache)
        except FileNotFoundError as error:
            raise MissingRouteCache(f"No cached route for {cache.stem}. Run with --refresh-routes.") from error
    geometry = route_geometry(payload)
    if geometry is None:
        failure = payload.get("refresh_error", "HTTPError")
        coordinates = fallback_path(start, end, rank)
        distance_km = round(sum(haversine_km(coordinates[index - 1], coordinates[index]) for index in range(1, len(coordinates))), 1)
        source = f"Approximate fallback; BRouter unavailable ({failure})"
        elevations = None
    else:
        coordinates, distance_km, elevations = geometry
        source = "BRouter hiking-beta over OSM trails"
    direct_km = round(haversine_km(start, end), 1)
    return {
        "type": "Feature",
        "properties": {
            "id": f"{peak['properties']['id']}--{hut['properties']['id']}",
            "peak_id": peak["properties"]["id"],
            "hut_id": hut["properties"]["id"],
            "distance_km": distance_km,
            "direct_km": direct_km,
            "trail_node_count": len(coordinates),
            "confidence": 0.92 if source.startswith("BRouter") else 0.58,
            "ranking_mode": "nearest-routable-huts",
            "source": source,
            "geometry_kind": "routed" if source.startswith("BRouter") else "approximate",
            "start_gap_m": round(haversine_km(coordinates[0], start) * 1000),
            "summit_gap_m": round(haversine_km(coordinates[-1], end) * 1000),
            "profile_elevations_m": elevations,
            "profile_source": PROFILE_SOURCE if elevations else None,
        },
        "geometry": {"type": "MultiLineString", "coordinates": [coordinates]},
    }


def build_routes(peaks, huts, refresh):
    jobs = []
    for peak in peaks:
        nearest = sorted(huts, key=lambda hut: haversine_km(peak["geometry"]["coordinates"], hut["geometry"]["coordinates"]))[:ROUTES_PER_PEAK]
        for rank, hut in enumerate(nearest):
            jobs.append((peak, hut, rank, refresh))
    with ThreadPoolExecutor(max_workers=ROUTE_WORKERS) as pool:
        routes = list(pool.map(lambda job: make_route(*job), jobs))
    return sorted(routes, key=lambda feature: (feature["properties"]["peak_id"], feature["properties"]["distance_km"], feature["properties"]["id"]))


def via_waypoints(graph, start, end):
    path = shortest_path(graph, start, end)
    if not path:
        return None
    waypoints = [start]
    for point in sample_line(path, 250):
        coordinate = [round(value, 7) for value in point]
        if coordinate != waypoints[-1] and coordinate != end:
            waypoints.append(coordinate)
    return [*waypoints, end] if len(waypoints) > 1 else None


def upgrade_approach(route, start, end, graph, refresh):
    props = route["properties"]
    waypoints = via_waypoints(graph, start, end)
    if not waypoints:
        return
    cache = ROUTE_CACHE / f"{props['id']}--via-trails.geojson"
    cached = read_json(cache) if cache.exists() else None
    if refresh:
        try:
            payload = request_route(waypoints)
        except OSError as error:
            print(f"BRouter via-trails refresh failed for {props['id']}: {error}", flush=True)
            if isinstance(error, urllib.error.HTTPError):
                error.close()
        else:
            route_geometry(payload)
            cached = {"waypoints": waypoints, "response": payload}
            write_json(cache, cached)
    if not cached or cached["waypoints"] != waypoints:
        return
    geometry = route_geometry(cached["response"])
    if geometry is None:
        return
    coordinates, distance_km, elevations = geometry
    start_gap = round(haversine_km(coordinates[0], start) * 1000)
    summit_gap = round(haversine_km(coordinates[-1], end) * 1000)
    if not elevations or not distance_km or start_gap > props["start_gap_m"] or summit_gap > props["summit_gap_m"]:
        return
    route["geometry"]["coordinates"] = [coordinates]
    props.update(
        geometry_kind="routed", source=VIA_TRAIL_SOURCE, confidence=0.92, distance_km=distance_km,
        trail_node_count=len(coordinates), start_gap_m=start_gap, summit_gap_m=summit_gap,
        profile_elevations_m=elevations, profile_source=PROFILE_SOURCE,
    )


def upgrade_sketches(routes, peaks, huts, raw_lines, refresh):
    sketches = [route for route in routes if route["properties"]["geometry_kind"] == "approximate"]
    if not sketches:
        return
    places = {place["properties"]["id"]: place["geometry"]["coordinates"] for place in [*peaks, *huts]}
    graph = trail_graph(line for lines in raw_lines.values() for line in lines)
    with ThreadPoolExecutor(max_workers=ROUTE_WORKERS) as pool:
        jobs = [pool.submit(upgrade_approach, route, places[route["properties"]["hut_id"]],
                            places[route["properties"]["peak_id"]], graph, refresh) for route in sketches]
        for job in jobs:
            job.result()


def feature_collection(features):
    return {"type": "FeatureCollection", "features": features}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh-routes", action="store_true", help="Refresh BRouter route geometry")
    args = parser.parse_args()
    peak_capture = read_json(PEAK_SOURCE)
    hut_capture = read_json(POI_SOURCE)
    hut_details = read_json(HUT_DETAIL_SOURCE)
    trail_capture = read_json(MARKED_TRAIL_SOURCE)
    park_capture = read_json(PARK_SOURCE)
    curated = read_json(CURATED_HUTS)
    peaks = build_peaks(peak_capture)
    huts = build_huts(hut_capture)
    enrich_huts(huts, hut_details, curated)
    boundary = ParkBoundary(select_park_relation(park_capture["elements"]))
    trails, raw_lines, excluded = build_marked_trails(trail_capture, boundary)
    collection = feature_collection(trails)
    if len(json.dumps(collection, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 1 > 600_000:
        print("Marked trails exceed 600 KB at 3 m; using 5 m simplification.")
        trails, raw_lines, excluded = build_marked_trails(trail_capture, boundary, tolerance=5)
        collection = feature_collection(trails)
    try:
        routes = build_routes(peaks, huts, args.refresh_routes)
    except MissingRouteCache as error:
        parser.exit(1, f"{error}\n")
    if UPGRADE_SKETCHES_VIA_TRAILS:
        upgrade_sketches(routes, peaks, huts, raw_lines, args.refresh_routes)
    annotate_approaches(routes, trails, raw_lines)
    write_json(DATA / "peaks.geojson", feature_collection(peaks))
    write_json(DATA / "huts.geojson", feature_collection(huts))
    write_json(DATA / "hut-routes.geojson", feature_collection(routes))
    write_json(DATA / "marked-trails.geojson", collection)
    write_json(
        DATA / "data-quality.json",
        {
            "mountain": "Vitosha",
            "schema_version": 3,
            "generated_from": ["OpenStreetMap Overpass", "BRouter hiking-beta", "OpenStreetMap route relations", "OpenStreetMap Vitosha Nature Park boundary"],
            "license": OSM_LICENSE,
            "peak_count": len(peaks),
            "hut_count": len(huts),
            "hut_route_count": len(routes),
            "marked_trail_count": len(trails),
            "marked_trail_filter": {
                "park_relation_id": boundary.relation_id,
                "buffer_m": PARK_BUFFER_M,
                "min_park_length_km": MIN_PARK_KM,
                "min_park_share": MIN_PARK_SHARE,
                "excluded": excluded,
            },
            "hut_detail_field_counts": {
                field: sum(field in hut["properties"]["details"] for hut in huts)
                for field in sorted({field for hut in huts for field in hut["properties"]["details"]})
            },
            "peak_min_elevation_m": PEAK_MIN_ELEVATION,
            "source_timestamps": {
                "peaks": peak_capture.get("osm3s", {}).get("timestamp_osm_base"),
                "huts": hut_capture.get("osm3s", {}).get("timestamp_osm_base"),
                "hut_details": hut_details["osm3s"]["timestamp_osm_base"],
                "marked_trails": trail_capture["osm3s"]["timestamp_osm_base"],
                "park_boundary": park_capture["osm3s"]["timestamp_osm_base"],
            },
            "capture_sources": {
                "hut_details": hut_details["capture_source"],
                "marked_trails": trail_capture["capture_source"],
                "park_boundary": park_capture["capture_source"],
            },
            "route_counts": {
                "routed": sum(route["properties"]["geometry_kind"] == "routed" for route in routes),
                "approximate": sum(route["properties"]["geometry_kind"] == "approximate" for route in routes),
                "with_elevation_profile": sum(route["properties"]["profile_elevations_m"] is not None for route in routes),
                "via_marked_trails": sum(route["properties"]["source"] == VIA_TRAIL_SOURCE for route in routes),
            },
            "limitations": [
                "Routes are planning context, not turn-by-turn or safety navigation.",
                "Trail conditions can change faster than the local dataset.",
                "Approximate lines are geometric planning sketches, not verified trails; GPX export is not available for them.",
                "Elevation samples are modelled BRouter values, not measurements; derived ascent is an unfiltered sum.",
                "Confidence values are metadata heuristics, not a field-verified accuracy or safety assessment.",
                "Marked trails come from OpenStreetMap route relations; marking presence and condition are not field-verified.",
            ],
        },
    )
    print(f"Built {len(peaks)} peaks, {len(huts)} huts, {len(routes)} route candidates and {len(trails)} marked trails.")


if __name__ == "__main__":
    main()
