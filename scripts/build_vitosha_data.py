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
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
DATA = ROOT / "public" / "data"
PEAK_SOURCE = WORK / "vitosha-peaks-overpass.json"
POI_SOURCE = WORK / "vitosha-pois-overpass.json"
ROUTE_CACHE = WORK / "brouter-cache"

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
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")


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


def haversine_km(left, right):
    lon1, lat1 = left[:2]
    lon2, lat2 = right[:2]
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


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


def fetch_route(peak, hut, refresh):
    cache = route_cache_path(peak, hut)
    if cache.exists() and not refresh:
        payload = read_json(cache)
    elif refresh:
        start = hut["geometry"]["coordinates"]
        end = peak["geometry"]["coordinates"]
        params = urllib.parse.urlencode(
            {
                "lonlats": f"{start[0]},{start[1]}|{end[0]},{end[1]}",
                "profile": "hiking-beta",
                "alternativeidx": 0,
                "format": "geojson",
            }
        )
        request = urllib.request.Request(
            f"https://brouter.de/brouter?{params}",
            headers={"User-Agent": "VitoshaPeakExplorer/1.0"},
        )
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
        cache.parent.mkdir(parents=True, exist_ok=True)
        write_json(cache, payload)
    else:
        raise FileNotFoundError("No cached route; use --refresh-routes for an explicit network refresh")
    feature = payload["features"][0]
    coordinates = [[round(point[0], 7), round(point[1], 7)] for point in feature["geometry"]["coordinates"]]
    props = feature.get("properties", {})
    elevations = [round(point[2], 1) for point in feature["geometry"]["coordinates"]] if all(
        len(point) >= 3 and isinstance(point[2], (int, float)) and math.isfinite(point[2])
        and 500 <= point[2] <= 3000 for point in feature["geometry"]["coordinates"]
    ) else None
    return coordinates, round(float(props.get("track-length", 0)) / 1000, 1), "BRouter hiking-beta over OSM trails", elevations


def make_route(peak, hut, rank, refresh):
    try:
        coordinates, distance_km, source, elevations = fetch_route(peak, hut, refresh)
    except Exception as error:  # Network failure must not make local generation impossible.
        coordinates = fallback_path(hut["geometry"]["coordinates"], peak["geometry"]["coordinates"], rank)
        distance_km = round(sum(haversine_km(coordinates[index - 1], coordinates[index]) for index in range(1, len(coordinates))), 1)
        source = f"Approximate fallback; BRouter unavailable ({type(error).__name__})"
        elevations = None
    direct_km = round(haversine_km(hut["geometry"]["coordinates"], peak["geometry"]["coordinates"]), 1)
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
            "start_gap_m": round(haversine_km(coordinates[0], hut["geometry"]["coordinates"]) * 1000),
            "summit_gap_m": round(haversine_km(coordinates[-1], peak["geometry"]["coordinates"]) * 1000),
            "profile_elevations_m": elevations,
            "profile_source": "BRouter elevation samples" if elevations else None,
        },
        "geometry": {"type": "MultiLineString", "coordinates": [coordinates]},
    }


def build_routes(peaks, huts, refresh):
    jobs = []
    for peak in peaks:
        nearest = sorted(huts, key=lambda hut: haversine_km(peak["geometry"]["coordinates"], hut["geometry"]["coordinates"]))[:ROUTES_PER_PEAK]
        for rank, hut in enumerate(nearest):
            jobs.append((peak, hut, rank))
    routes = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(make_route, peak, hut, rank, refresh): (peak, hut) for peak, hut, rank in jobs}
        for future in as_completed(futures):
            routes.append(future.result())
    return sorted(routes, key=lambda feature: (feature["properties"]["peak_id"], feature["properties"]["distance_km"]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh-routes", action="store_true", help="Refresh BRouter route geometry")
    args = parser.parse_args()
    peak_capture = read_json(PEAK_SOURCE)
    hut_capture = read_json(POI_SOURCE)
    peaks = build_peaks(peak_capture)
    huts = build_huts(hut_capture)
    routes = build_routes(peaks, huts, args.refresh_routes)
    write_json(DATA / "peaks.geojson", {"type": "FeatureCollection", "features": peaks})
    write_json(DATA / "huts.geojson", {"type": "FeatureCollection", "features": huts})
    write_json(DATA / "hut-routes.geojson", {"type": "FeatureCollection", "features": routes})
    write_json(
        DATA / "data-quality.json",
        {
            "mountain": "Vitosha",
            "schema_version": 2,
            "generated_from": ["OpenStreetMap Overpass", "BRouter hiking-beta"],
            "peak_count": len(peaks),
            "hut_count": len(huts),
            "hut_route_count": len(routes),
            "peak_min_elevation_m": PEAK_MIN_ELEVATION,
            "source_timestamps": {
                "peaks": peak_capture.get("osm3s", {}).get("timestamp_osm_base"),
                "huts": hut_capture.get("osm3s", {}).get("timestamp_osm_base"),
            },
            "route_counts": {
                "routed": sum(route["properties"]["geometry_kind"] == "routed" for route in routes),
                "approximate": sum(route["properties"]["geometry_kind"] == "approximate" for route in routes),
                "with_elevation_profile": sum(route["properties"]["profile_elevations_m"] is not None for route in routes),
            },
            "limitations": [
                "Routes are planning context, not turn-by-turn or safety navigation.",
                "Trail conditions can change faster than the local dataset.",
                "Approximate lines are geometric planning sketches, not verified trails; GPX export is not available for them.",
                "Elevation samples are modelled BRouter values, not measurements; derived ascent is an unfiltered sum.",
                "Confidence values are metadata heuristics, not a field-verified accuracy or safety assessment.",
            ],
        },
    )
    print(f"Built {len(peaks)} peaks, {len(huts)} huts and {len(routes)} route candidates.")


if __name__ == "__main__":
    main()
