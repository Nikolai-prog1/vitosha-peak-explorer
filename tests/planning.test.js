import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { routeFacts, profileGeometry, distanceMeters, parsePlanHash, sharedPlanUrl, createGpx, createTextFile, resolveSavedPlan } from "../src/planning.js";
import { MESSAGES, translate, placeName } from "../src/i18n.js";
import { weatherDescription, weatherNumber } from "../src/weather.js";

const read = async file => JSON.parse(await readFile(new URL(`../public/data/${file}`, import.meta.url)));
const routes = (await read("hut-routes.geojson")).features, peaks = (await read("peaks.geojson")).features, huts = (await read("huts.geojson")).features;

test("saved-plan selection resolves its own summit, hut and profile before camera/state updates", () => {
  const data = { peaks, huts, hutRoutes: routes };
  for (const route of routes) {
    const plan = { routeId: route.properties.id, peakId: route.properties.peak_id, hutId: route.properties.hut_id };
    const selection = resolveSavedPlan(data, plan);
    assert.equal(selection.peak, peaks.find(peak => peak.properties.id === plan.peakId));
    assert.equal(selection.candidate.feature, huts.find(hut => hut.properties.id === plan.hutId));
    assert.equal(selection.candidate.id, plan.routeId);
    assert.equal(selection.candidate.path, route.geometry.coordinates[0]);
    assert.equal(selection.candidate.routeFeature, route);
    assert.equal(resolveSavedPlan(data, { ...plan, peakId: "peak-999999999" }), null);
    assert.equal(resolveSavedPlan(data, { ...plan, hutId: "hut-999999999" }), null);
  }
  const route = routes[0], plan = { routeId: route.properties.id, peakId: route.properties.peak_id, hutId: route.properties.hut_id };
  assert.equal(resolveSavedPlan({ ...data, huts: [] }, plan), null);
  assert.equal(resolveSavedPlan({ ...data, peaks: [] }, plan), null);
  assert.equal(resolveSavedPlan(data, { ...plan, routeId: "peak-999--hut-999" }), null);
  assert.equal(resolveSavedPlan(data, null), null);
  assert.equal(resolveSavedPlan(null, plan), null);
});

test("file exports preserve UTF-8 and MIME type, retaining their URL until explicit disposal", async () => {
  const allocated = [], revoked = [];
  const urlApi = { createObjectURL(blob) { allocated.push(blob); return `blob:export-${allocated.length}`; }, revokeObjectURL(url) { revoked.push(url); } };
  for (const type of ["application/json", "application/gpx+xml", "text/plain"]) {
    const content = "Витоша → Черни връх\n<&>";
    const file = createTextFile(content, "vitosha-file.json", type, { urlApi });
    assert.equal(file.type, type); assert.equal(allocated.at(-1).type, type);
    assert.equal(file.size, Buffer.byteLength(content, "utf8"));
    assert.equal(await allocated.at(-1).text(), content);
    assert.equal(revoked.includes(file.url), false);
    file.dispose(); file.dispose();
    assert.equal(revoked.filter(url => url === file.url).length, 1);
  }
});

test("invalid export names, MIME types and non-text contents cannot allocate a URL", () => {
  let allocated = 0;
  const options = { urlApi: { createObjectURL() { allocated++; }, revokeObjectURL() {} } };
  for (const filename of [undefined, "", "../backup.json", "a/b.gpx", "a\\b.gpx", "a\n.json", "a".repeat(161)]) {
    assert.throws(() => createTextFile("body", filename, "application/json", options), TypeError);
  }
  assert.throws(() => createTextFile({}, "backup.json", "application/json", options), TypeError);
  assert.throws(() => createTextFile("body", "backup.json", "text/html", options), TypeError);
  assert.equal(allocated, 0);
});

test("modelled profile samples align with route geometry and unfiltered ascent/descent are consistent", () => {
  for (const route of routes) {
    const facts = routeFacts(route);
    if (route.properties.geometry_kind === "approximate") { assert.equal(facts, null); continue; }
    assert.equal(facts.samples.length, route.geometry.coordinates[0].length);
    assert.equal(facts.samples[0].distance, 0);
    assert.equal(facts.distance > 0, true);
    assert.equal(Math.abs(facts.ascent - facts.descent - (facts.samples.at(-1).height - facts.samples[0].height)) <= 1, true);
    const chart = profileGeometry(facts);
    assert.equal(/NaN|Infinity/.test(chart.line), false);
    assert.equal(chart.start[0], 8); assert.equal(chart.end[0], 312);
  }
  assert.equal(distanceMeters([23.28, 42.56], [23.28, 42.56]), 0);
  const flat = profileGeometry({ min: 1800, max: 1800, distance: 0, samples: [{ distance: 0, height: 1800 }] });
  assert.equal(/NaN|Infinity/.test(flat.line), false);
});

test("shared links round-trip stable IDs and language, rejecting ambiguity and arbitrary routes", () => {
  const url = sharedPlanUrl("https://example.invalid/vitosha/", peaks[0].properties.id, routes.find(route => route.properties.peak_id === peaks[0].properties.id).properties.id, "en");
  const parsed = parsePlanHash(new URL(url).hash); assert.equal(parsed.language, "en"); assert.equal(parsed.peakId, peaks[0].properties.id); assert.equal(parsed.invalid, false);
  for (const hash of ["#peak=other", "#peak=peak-1&peak=peak-2", "#peak=peak-1&route=peak-2--hut-1", "#route=peak-1--hut-1", "#lang=javascript", "x".repeat(513)]) assert.equal(parsePlanHash(hash).invalid, true);
  assert.throws(() => sharedPlanUrl("javascript:alert(1)", "peak-1", null));
  assert.throws(() => sharedPlanUrl("https://example.invalid/", "peak-1", "peak-2--hut-1"));
});

test("GPX is real parseable 1.1 XML with longitude/latitude, complete track points and honest attribution", () => {
  const route = routes.find(item => item.properties.geometry_kind === "routed"), peak = peaks.find(item => item.properties.id === route.properties.peak_id), hut = huts.find(item => item.properties.id === route.properties.hut_id);
  const xml = createGpx(route, { ...peak, properties: { ...peak.properties, name_en: "Peak <&\"'>" } }, hut, "en");
  const script = "import sys,json,xml.etree.ElementTree as E; r=E.fromstring(sys.stdin.read()); n={'g':'http://www.topografix.com/GPX/1/1'}; p=r.findall('g:trk/g:trkseg/g:trkpt',n); print(json.dumps({'version':r.get('version'),'creator':r.get('creator'),'count':len(p),'first':p[0].attrib,'elevation':p[0].find('g:ele',n).text,'name':r.find('g:metadata/g:name',n).text,'description':r.find('g:metadata/g:desc',n).text,'license':r.find('g:metadata/g:copyright/g:license',n).text}))";
  const parsed = JSON.parse(execFileSync("python", ["-c", script], { input: xml, encoding: "utf8" }));
  assert.equal(parsed.version, "1.1"); assert.equal(parsed.count, route.geometry.coordinates[0].length);
  assert.equal(Number(parsed.first.lon), route.geometry.coordinates[0][0][0]); assert.equal(Number(parsed.first.lat), route.geometry.coordinates[0][0][1]);
  assert.equal(Number(parsed.elevation), route.properties.profile_elevations_m[0]); assert.equal(parsed.name.endsWith('Peak <&"\'>'), true);
  assert.match(parsed.description, /not safety|not a recorded/i); assert.match(parsed.license, /odbl/);
});

test("a geometric fallback or mismatched approach cannot be exported as a GPX track", () => {
  for (const route of routes.filter(item => item.properties.geometry_kind === "approximate")) {
    assert.throws(() => createGpx(route, peaks.find(item => item.properties.id === route.properties.peak_id), huts.find(item => item.properties.id === route.properties.hut_id)), /routed approach/);
  }
  const route = routes.find(item => item.properties.geometry_kind === "routed");
  assert.throws(() => createGpx(route, { properties: { id: "peak-999" } }, huts[0]), /matching places/);
});

test("every UI translation has both languages and identical placeholders", () => {
  for (const [key, pair] of Object.entries(MESSAGES)) {
    assert.equal(pair.length, 2); assert.equal(pair.every(text => typeof text === "string" && text.trim()), true);
    const slots = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(slots(pair[0]), slots(pair[1]), key);
    const values = Object.fromEntries(slots(pair[0]).map(slot => [slot, "value"]));
    assert.equal(/\{\w+\}/.test(translate("bg", key, values)), false); assert.equal(/\{\w+\}/.test(translate("en", key, values)), false);
  }
  assert.throws(() => translate("en", "doesNotExist"));
  assert.throws(() => translate("en", "osmNode"));
});

test("all named places and weather descriptions support an English rendered experience", () => {
  for (const feature of [...peaks, ...huts]) { assert.equal(/[А-Яа-я]/.test(placeName(feature, "en")), false, feature.properties.id); assert.equal(placeName(feature, "bg").length > 0, true); }
  for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99, 1000]) assert.equal(/[А-Яа-я]/.test(weatherDescription(code, "en").label), false);
  assert.equal(weatherNumber(null, "", 0, "en"), "no data"); assert.equal(weatherNumber(0, "°", 0, "en"), "0°");
});
