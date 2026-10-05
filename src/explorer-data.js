import { requestJson } from "./requests.js?v=vitosha-planning-20261005";
import { distanceMeters } from "./planning.js";

export const EMPTY_EXPLORER_DATA = { peaks: [], huts: [], hutRoutes: [], quality: null };
const FILES = ["peaks.geojson", "huts.geojson", "hut-routes.geojson", "data-quality.json"];

function fail() { throw new Error("Invalid Vitosha dataset"); }
function collection(value, maxCount) {
  if (value?.type !== "FeatureCollection" || !Array.isArray(value.features) || !value.features.length || value.features.length > maxCount) fail();
  return value.features;
}
function coordinate(value) {
  // Bounds also catch accidentally reversed [latitude, longitude] coordinates.
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)
    || value[0] < 22.9 || value[0] > 23.7 || value[1] < 42.2 || value[1] > 42.85) fail();
}
function finite(value, min, max) { if (!Number.isFinite(value) || value < min || value > max) fail(); }
function places(value, prefix) {
  const features = collection(value, 1000);
  const ids = new Set();
  for (const item of features) {
    const props = item?.properties;
    if (item?.type !== "Feature" || item.geometry?.type !== "Point" || !props || !new RegExp(`^${prefix}-\\d+$`).test(props.id) || ids.has(props.id)) fail();
    for (const name of [props.name_bg, props.name_en]) if (typeof name !== "string" || !name.trim() || name.length > 140) fail();
    if (!Number.isSafeInteger(props.osm_id) || props.osm_id < 1 || props.id !== `${prefix}-${props.osm_id}`) fail();
    coordinate(item.geometry.coordinates);
    if (prefix === "peak" || props.elevation_m !== null) finite(props.elevation_m, prefix === "peak" ? 1900 : 500, 3000);
    if (prefix === "peak") finite(props.confidence, 0, 1);
    ids.add(props.id);
  }
  return { features, ids };
}

export function validateExplorerData({ peaks, huts, hutRoutes, quality }) {
  const summits = places(peaks, "peak");
  const shelters = places(huts, "hut");
  const routes = collection(hutRoutes, 5000);
  const ids = new Set();
  const peakById = new Map(summits.features.map(peak => [peak.properties.id, peak]));
  const hutById = new Map(shelters.features.map(hut => [hut.properties.id, hut]));
  for (const route of routes) {
    const props = route?.properties;
    if (route?.type !== "Feature" || route.geometry?.type !== "MultiLineString" || !props
      || !summits.ids.has(props.peak_id) || !shelters.ids.has(props.hut_id)
      || props.id !== `${props.peak_id}--${props.hut_id}` || ids.has(props.id)) fail();
    const paths = route.geometry.coordinates;
    if (!Array.isArray(paths) || paths.length !== 1 || !Array.isArray(paths[0]) || paths[0].length < 2 || paths[0].length > 20000) fail();
    paths[0].forEach(coordinate);
    finite(props.distance_km, 0.01, 100);
    finite(props.direct_km, 0, 100);
    finite(props.confidence, 0, 1);
    if (props.trail_node_count !== paths[0].length) fail();
    if (typeof props.source !== "string" || !props.source.trim()) fail();
    if (!["routed", "approximate"].includes(props.geometry_kind) || (props.geometry_kind === "routed") !== props.source.startsWith("BRouter")) fail();
    finite(props.start_gap_m, 0, 100000); finite(props.summit_gap_m, 0, 100000);
    if (Math.abs(props.start_gap_m - distanceMeters(paths[0][0], hutById.get(props.hut_id).geometry.coordinates)) > 1
      || Math.abs(props.summit_gap_m - distanceMeters(paths[0].at(-1), peakById.get(props.peak_id).geometry.coordinates)) > 1) fail();
    const elevations = props.profile_elevations_m;
    if (elevations === null) { if (props.profile_source !== null) fail(); }
    else {
      if (props.geometry_kind !== "routed" || !Array.isArray(elevations) || elevations.length !== paths[0].length || props.profile_source !== "BRouter elevation samples") fail();
      elevations.forEach(height => finite(height, 500, 3000));
    }
    ids.add(props.id);
  }
  if (quality?.mountain !== "Vitosha" || quality.schema_version !== 2 || quality.peak_count !== summits.features.length
    || quality.hut_count !== shelters.features.length || quality.hut_route_count !== routes.length) fail();
  if (quality.route_counts?.routed !== routes.filter(route => route.properties.geometry_kind === "routed").length
      || quality.route_counts?.approximate !== routes.filter(route => route.properties.geometry_kind === "approximate").length
      || quality.route_counts?.with_elevation_profile !== routes.filter(route => route.properties.profile_elevations_m !== null).length) fail();
  for (const timestamp of [quality.source_timestamps?.peaks, quality.source_timestamps?.huts]) {
    if (timestamp !== null && (typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp)))) fail();
  }
  return { peaks: summits.features, huts: shelters.features, hutRoutes: routes, quality };
}

export async function loadExplorerData({ base = "/data", signal, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const relay = () => controller.abort(signal.reason);
  if (signal?.aborted) relay();
  else signal?.addEventListener("abort", relay, { once: true });
  try {
    const [peaks, huts, hutRoutes, quality] = await Promise.all(FILES.map(file => requestJson(`${base}/${file}`, {
      signal: controller.signal, fetchImpl, timeoutMs, maxBytes: 2 * 1024 * 1024,
    })));
    return validateExplorerData({ peaks, huts, hutRoutes, quality });
  } finally {
    controller.abort();
    signal?.removeEventListener("abort", relay);
  }
}
