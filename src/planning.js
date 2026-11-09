const PEAK_ID = /^peak-\d+$/;
const ROUTE_ID = /^peak-\d+--hut-\d+$/;

export function distanceMeters(left, right) {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(right[1] - left[1]);
  const dLon = radians(right[0] - left[0]);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(left[1])) * Math.cos(radians(right[1])) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function routeFacts(route) {
  const path = route.geometry.coordinates[0];
  const elevations = route.properties.profile_elevations_m;
  if (!Array.isArray(elevations) || elevations.length !== path.length || !elevations.every(Number.isFinite)) return null;
  let distance = 0, ascent = 0, descent = 0;
  const samples = elevations.map((height, index) => {
    if (index) {
      distance += distanceMeters(path[index - 1], path[index]);
      const change = height - elevations[index - 1];
      ascent += Math.max(0, change);
      descent += Math.max(0, -change);
    }
    return { distance, height };
  });
  return { samples, distance, ascent: Math.round(ascent), descent: Math.round(descent), min: Math.min(...elevations), max: Math.max(...elevations) };
}

// Difficulty 1–5 for routed approaches. Effort is measured in "effort kilometres"
// (horizontal km + 1 km per 100 m of ascent); the steepest sustained 300 m stretch
// adds one level when it reaches 35 % grade. Approximate sketches have no facts → null.
export const DIFFICULTY_EFFORT_STEPS = [6, 9, 12, 15];
export const DIFFICULTY_STEEP_GRADE = 0.35;
export function steepestGrade(facts, window = 300) {
  const samples = facts?.samples ?? [];
  let steepest = 0;
  for (let start = 0, end = 0; start < samples.length; start++) {
    while (end < samples.length && samples[end].distance - samples[start].distance < window) end++;
    if (end >= samples.length) break;
    steepest = Math.max(steepest, Math.abs(samples[end].height - samples[start].height) / (samples[end].distance - samples[start].distance));
  }
  return steepest;
}
export function routeDifficulty(facts) {
  if (!facts || !(facts.distance > 0)) return null;
  const effortKm = facts.distance / 1000 + Math.max(0, facts.ascent) / 100, grade = steepestGrade(facts);
  const base = 1 + DIFFICULTY_EFFORT_STEPS.filter(step => effortKm >= step).length;
  return { level: Math.min(5, base + (grade >= DIFFICULTY_STEEP_GRADE ? 1 : 0)), effortKm: Math.round(effortKm * 10) / 10, steepestGrade: Math.round(grade * 100) };
}

export function profileGeometry(facts, width = 320, height = 116) {
  if (!facts || !facts.samples.length) return null;
  const inset = 8, usableWidth = width - 2 * inset, usableHeight = height - 2 * inset;
  const span = Math.max(40, facts.max - facts.min);
  const base = facts.min - Math.max(0, 40 - (facts.max - facts.min)) / 2;
  const points = facts.samples.map(sample => [
    inset + sample.distance / Math.max(1, facts.distance) * usableWidth,
    height - inset - (sample.height - base) / span * usableHeight,
  ]);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return { line, area: `${line} L${width - inset},${height - inset} L${inset},${height - inset} Z`, start: points[0], end: points.at(-1) };
}

// Resolve from the saved IDs, never from the summit currently in React state.
// An explicit summit also keeps camera fitting correct before setState commits.
export function resolveSavedPlan(data, plan) {
  if (!plan || ![data?.hutRoutes, data?.peaks, data?.huts].every(Array.isArray)) return null;
  const route = data.hutRoutes.find(item => item.properties.id === plan.routeId);
  if (!route || route.properties.peak_id !== plan.peakId || route.properties.hut_id !== plan.hutId) return null;
  const peak = data.peaks.find(item => item.properties.id === route.properties.peak_id);
  const hut = data.huts.find(item => item.properties.id === route.properties.hut_id);
  if (!peak || !hut) return null;
  return { peak, candidate: { id: route.properties.id, path: route.geometry.coordinates[0], routeFeature: route, feature: hut } };
}

export function parsePlanHash(hash) {
  if (typeof hash !== "string" || hash.length > 512) return { invalid: true };
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const peakId = params.get("peak"), routeId = params.get("route"), language = params.get("lang");
  if ((peakId && !PEAK_ID.test(peakId)) || (routeId && !ROUTE_ID.test(routeId))
      || (language && !["bg", "en"].includes(language)) || ["peak", "route", "lang"].some(key => params.getAll(key).length > 1)) return { invalid: true };
  if (routeId && (!peakId || !routeId.startsWith(`${peakId}--`))) return { invalid: true };
  return { peakId, routeId, language, invalid: false };
}

export function sharedPlanUrl(baseUrl, peakId, routeId, language = "bg") {
  if (!PEAK_ID.test(peakId) || (routeId && (!ROUTE_ID.test(routeId) || !routeId.startsWith(`${peakId}--`)))) throw new Error("Invalid shared plan");
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid share origin");
  url.search = ""; url.username = ""; url.password = "";
  const params = new URLSearchParams({ peak: peakId, lang: language === "en" ? "en" : "bg" });
  if (routeId) params.set("route", routeId);
  url.hash = params.toString();
  return url.href;
}

function escapeXml(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}

export function createGpx(route, peak, hut, language = "bg") {
  // A geometric fallback must never become a seemingly navigable GPX track.
  if (route.properties.geometry_kind !== "routed" || route.properties.peak_id !== peak.properties.id
      || route.properties.hut_id !== hut.properties.id) throw new Error("GPX requires a routed approach with matching places");
  const path = route.geometry.coordinates[0];
  if (path.length < 2 || path.length > 20000 || path.some(point => point.length !== 2 || !point.every(Number.isFinite)
      || point[0] < 22.9 || point[0] > 23.7 || point[1] < 42.2 || point[1] > 42.85)) throw new Error("Invalid GPX coordinates");
  const names = language === "en" ? "name_en" : "name_bg";
  const title = `${hut.properties[names]} → ${peak.properties[names]}`;
  const description = "Planning preview only; not safety or turn-by-turn navigation. Modelled BRouter hiking-beta geometry over OpenStreetMap; not a recorded or field-verified track. Endpoints may stop short of the named places. © OpenStreetMap contributors, ODbL. Check current conditions independently.";
  const elevations = route.properties.profile_elevations_m;
  const hasElevations = Array.isArray(elevations) && elevations.length === path.length && elevations.every(Number.isFinite);
  const track = path.map(([longitude, latitude], index) => `<trkpt lat="${latitude}" lon="${longitude}">${hasElevations ? `<ele>${elevations[index]}</ele>` : ""}</trkpt>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Vitosha Peak Explorer" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${escapeXml(title)}</name><desc>${escapeXml(description)}</desc><copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/1-0/</license></copyright><link href="https://www.openstreetmap.org/copyright"><text>OpenStreetMap attribution</text></link></metadata>
<trk><name>${escapeXml(title)}</name><desc>${escapeXml(description)}</desc><src>BRouter hiking-beta / OpenStreetMap</src><type>planning-preview</type><trkseg>${track}</trkseg></trk>
</gpx>\n`;
}

export function createTextFile(content, filename, type = "application/json", { urlApi = URL, BlobClass = Blob } = {}) {
  if (typeof content !== "string" || typeof filename !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,159}$/i.test(filename)
      || !["application/json", "application/gpx+xml", "text/plain"].includes(type)) throw new TypeError("Invalid file export");
  const blob = new BlobClass([content], { type });
  const url = urlApi.createObjectURL(blob);
  let disposed = false;
  // The file stays alive while its visible download link exists, including
  // during a slow save dialog. There is no arbitrary ten-second expiry.
  return { url, filename, type, size: blob.size, dispose() {
    if (!disposed) { urlApi.revokeObjectURL(url); disposed = true; }
  } };
}
