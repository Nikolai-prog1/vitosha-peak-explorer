import { requestJson } from "./requests.js?v=vitosha-planning-20261005";
import { distanceMeters } from "./planning.js?v=vitosha-camera-20261005-2";
import { TRAIL_COLORS, VIA_MARKED_TRAILS } from "./trail-display.js?v=vitosha-polish-20261120";

export const EMPTY_EXPLORER_DATA = { peaks: [], huts: [], hutRoutes: [], markedTrails: [], quality: null };
const FILES = ["peaks.geojson", "huts.geojson", "hut-routes.geojson", "marked-trails.geojson", "data-quality.json"];
const COLOURS = new Set(Object.keys(TRAIL_COLORS));
const NETWORKS = new Set(["lwn", "rwn", "nwn", "iwn"]);
const snapshotSources = new Set(["overpass", "geofabrik bulgaria-latest"]);

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
function record(value) { return value && typeof value === "object" && !Array.isArray(value); }
function text(value, limit = 3000) { return typeof value === "string" && value.trim().length > 0 && value.length <= limit; }
function dateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}
function validHutDetails(props) {
  if (!["hut", "shelter"].includes(props.kind) || !["node", "way"].includes(props.osm_type)
    || props.osm_url !== `https://www.openstreetmap.org/${props.osm_type}/${props.osm_id}` || !record(props.details)) fail();
  for (const detail of Object.values(props.details)) {
    if (!record(detail) || !["osm", "manual"].includes(detail.source) || (detail.checked !== null && !dateOnly(detail.checked))) fail();
    const value = detail.value;
    if (!text(value) && typeof value !== "boolean" && !(Number.isSafeInteger(value) && value > 0)
      && !(Array.isArray(value) && value.length > 0 && value.length <= 80 && value.every(item => text(item, 250)))) fail();
  }
}
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
    else validHutDetails(props);
    ids.add(props.id);
  }
  return { features, ids };
}

function trailsById(trails) {
  const byId = new Map();
  if (trails.length < 5) fail();
  for (const trail of trails) {
    const props = trail?.properties, lines = trail?.geometry?.coordinates, relation = props?.osm_relation_id;
    if (trail?.type !== "Feature" || trail.geometry?.type !== "MultiLineString"
      || !Number.isSafeInteger(relation) || relation < 1 || props.id !== `trail-${relation}` || byId.has(props.id)
      || props.osm_url !== `https://www.openstreetmap.org/relation/${relation}`
      || props.wmt_url !== `https://hiking.waymarkedtrails.org/#route?id=${relation}&type=relation`
      || (props.colour !== null && !COLOURS.has(props.colour)) || (props.network !== null && !NETWORKS.has(props.network))
      || !Array.isArray(lines) || !lines.length || lines.length > 20000
      || !Number.isSafeInteger(props.piece_count) || props.piece_count < 1 || props.piece_count > lines.length || typeof props.clipped !== "boolean") fail();
    for (const field of ["name_bg", "name_en", "ref", "operator", "from", "to", "osmc_symbol"]) {
      if (props[field] !== null && !text(props[field], 800)) fail();
    }
    finite(props.length_km, 0.001, 1000);
    for (const line of lines) {
      if (!Array.isArray(line) || line.length < 2 || line.length > 20000) fail();
      for (const point of line) {
        coordinate(point);
        if (point[0] < 23.05 || point[0] > 23.60 || point[1] < 42.40 || point[1] > 42.76) fail();
      }
      if (!line.some(point => point[0] !== line[0][0] || point[1] !== line[0][1])) fail();
    }
    byId.set(props.id, props);
  }
  return byId;
}

function validateTrailShares(props, byId) {
  finite(props.marked_share, 0, 1);
  if (!Array.isArray(props.marked_trails) || props.marked_trails.length > byId.size) fail();
  const seen = new Set();
  let previous = props.marked_share;
  for (const annotation of props.marked_trails) {
    const trail = byId.get(annotation?.trail_id);
    if (!trail || seen.has(annotation.trail_id) || annotation.colour !== trail.colour || annotation.ref !== trail.ref) fail();
    finite(annotation.share, 0, previous);
    seen.add(annotation.trail_id);
    previous = annotation.share;
  }
}

export function validateExplorerData({ peaks, huts, hutRoutes, markedTrails, quality }) {
  const summits = places(peaks, "peak");
  const shelters = places(huts, "hut");
  const routes = collection(hutRoutes, 5000);
  const trails = collection(markedTrails, 1000);
  const trailProperties = trailsById(trails);
  const ids = new Set();
  const peakById = new Map(summits.features.map(peak => [peak.properties.id, peak]));
  const hutById = new Map(shelters.features.map(hut => [hut.properties.id, hut]));
  const perPeak = new Map(summits.features.map(peak => [peak.properties.id, 0]));
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
    if (props.ranking_mode !== "nearest-routable-huts" || "popularity_score" in props || "hiking_relation_count" in props) fail();
    finite(props.start_gap_m, 0, 100000); finite(props.summit_gap_m, 0, 100000);
    if (Math.abs(props.start_gap_m - distanceMeters(paths[0][0], hutById.get(props.hut_id).geometry.coordinates)) > 1
      || Math.abs(props.summit_gap_m - distanceMeters(paths[0].at(-1), peakById.get(props.peak_id).geometry.coordinates)) > 1) fail();
    const elevations = props.profile_elevations_m;
    if (elevations === null) { if (props.profile_source !== null || props.source === VIA_MARKED_TRAILS) fail(); }
    else {
      if (props.geometry_kind !== "routed" || !Array.isArray(elevations) || elevations.length !== paths[0].length || props.profile_source !== "BRouter elevation samples") fail();
      elevations.forEach(height => finite(height, 500, 3000));
    }
    validateTrailShares(props, trailProperties);
    ids.add(props.id);
    perPeak.set(props.peak_id, perPeak.get(props.peak_id) + 1);
  }
  if ([...perPeak.values()].some(count => count !== 3)) fail();
  if (quality?.mountain !== "Vitosha" || quality.schema_version !== 3 || quality.peak_count !== summits.features.length
    || quality.hut_count !== shelters.features.length || quality.hut_route_count !== routes.length || quality.marked_trail_count !== trails.length
    || typeof quality.license !== "string" || !quality.license.includes("ODbL 1.0")) fail();
  if (quality.route_counts?.routed !== routes.filter(route => route.properties.geometry_kind === "routed").length
      || quality.route_counts?.approximate !== routes.filter(route => route.properties.geometry_kind === "approximate").length
      || quality.route_counts?.with_elevation_profile !== routes.filter(route => route.properties.profile_elevations_m !== null).length
      || quality.route_counts?.via_marked_trails !== routes.filter(route => route.properties.source === VIA_MARKED_TRAILS).length) fail();
  const detailCounts = new Map();
  for (const hut of shelters.features) for (const field of Object.keys(hut.properties.details)) detailCounts.set(field, (detailCounts.get(field) ?? 0) + 1);
  if (!record(quality.hut_detail_field_counts) || Object.keys(quality.hut_detail_field_counts).length !== detailCounts.size
    || [...detailCounts].some(([field, count]) => quality.hut_detail_field_counts[field] !== count)) fail();
  for (const key of ["peaks", "huts", "hut_details", "marked_trails"]) {
    const timestamp = quality.source_timestamps?.[key];
    const newCapture = key === "hut_details" || key === "marked_trails";
    if (newCapture && (!timestamp || !snapshotSources.has(quality.capture_sources?.[key]))) fail();
    if (timestamp !== null && (typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp)))) fail();
  }
  return { peaks: summits.features, huts: shelters.features, hutRoutes: routes, markedTrails: trails, quality };
}

export async function loadExplorerData({ base = "/data", signal, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const relay = () => controller.abort(signal.reason);
  if (signal?.aborted) relay();
  else signal?.addEventListener("abort", relay, { once: true });
  try {
    const [peaks, huts, hutRoutes, markedTrails, quality] = await Promise.all(FILES.map(file => requestJson(`${base}/${file}`, {
      signal: controller.signal, fetchImpl, timeoutMs, maxBytes: 2 * 1024 * 1024,
    })));
    return validateExplorerData({ peaks, huts, hutRoutes, markedTrails, quality });
  } finally {
    controller.abort();
    signal?.removeEventListener("abort", relay);
  }
}
