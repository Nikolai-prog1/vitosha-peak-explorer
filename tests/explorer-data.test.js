import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadExplorerData, validateExplorerData } from "../src/explorer-data.js";
import { jsonResponse } from "./fixtures.js";

const names = { peaks: "peaks.geojson", huts: "huts.geojson", hutRoutes: "hut-routes.geojson", markedTrails: "marked-trails.geojson", quality: "data-quality.json" };
const dataset = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, file]) => [key, JSON.parse(await readFile(new URL(`../public/data/${file}`, import.meta.url)))])));

test("the generated real dataset satisfies the client contract", () => {
  const result = validateExplorerData(dataset);
  assert.equal(result.peaks.length, 17);
  assert.equal(result.huts.length, 24);
  assert.equal(result.hutRoutes.length, 61);
  assert.ok(result.markedTrails.length >= 5);
});

test("client rejects swapped coordinates, malformed places and dangling or duplicate route IDs", () => {
  const mutations = [
    data => data.peaks.features[0].geometry.coordinates.reverse(),
    data => data.peaks.features[0].properties.name_en = "",
    data => data.huts.features[0].properties.elevation_m = "1000",
    data => data.peaks.features.push(data.peaks.features[0]),
    data => data.hutRoutes.features[0].properties.hut_id = "hut-999",
    data => data.hutRoutes.features.push(data.hutRoutes.features[0]),
    data => data.hutRoutes.features[0].geometry.coordinates[0] = [],
    data => data.hutRoutes.features[0].properties.distance_km = -1,
    data => data.hutRoutes.features[0].properties.geometry_kind = "verified-safe",
    data => data.hutRoutes.features[0].properties.start_gap_m += 100,
    data => data.hutRoutes.features[0].properties.trail_node_count = 999,
    data => data.hutRoutes.features[0].properties.profile_elevations_m = [NaN],
    data => data.quality.route_counts.routed = 0,
    data => data.quality.hut_route_count = 0,
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(dataset); mutate(copy);
    assert.throws(() => validateExplorerData(copy), /Invalid Vitosha dataset/);
  }
  assert.throws(() => validateExplorerData({}), /Invalid/);
});

test("schema 3 requires trail geometries, correct provenance and bounded data shares", () => {
  const mutations = [
    data => data.quality.schema_version = 2,
    data => data.quality.license = "",
    data => data.markedTrails.features[0].properties.colour = "invalid",
    data => data.markedTrails.features[0].geometry.coordinates[0][0] = [23.0, 42.5],
    data => data.markedTrails.features.push(data.markedTrails.features[0]),
    data => data.markedTrails.features[0].properties.clipped = "yes",
    data => delete data.markedTrails.features[0].properties.clipped,
    data => data.huts.features[0].properties.details.website = { value: "https://example.test/", source: "unsourced", checked: null },
    data => data.hutRoutes.features[0].properties.marked_share = 2,
    data => data.hutRoutes.features[0].properties.marked_trails = [{ trail_id: "trail-0", colour: null, ref: null, share: 0.1 }],
    data => data.hutRoutes.features[0].properties.ranking_mode = "route-relation-count",
  ];
  const closed = { value: "closed", source: "manual", ref: "park", checked: "2026-11-20" };
  const lodge = data => data.huts.features.find(hut => hut.properties.kind === "lodge");
  const startHut = data => data.huts.features.find(hut => hut.properties.id === data.hutRoutes.features[0].properties.hut_id);
  mutations.push(
    data => startHut(data).properties.details.status = closed,
    data => data.huts.features[0].properties.details.status = { ...closed, value: "renovating" },
    data => data.huts.features[0].properties.details.status = { ...closed, checked: null },
    data => data.huts.features[0].properties.details.status = { ...closed, source: "osm" },
    // Every manual fact names its source; an OSM fact does not.
    data => data.huts.features[0].properties.details.status = { ...closed, ref: undefined },
    data => data.huts.features[0].properties.details.status = { ...closed, ref: "blog" },
    data => data.huts.features[0].properties.details.website = { value: "https://example.test/", source: "osm", ref: "park", checked: null },
    // A lodge is a sourced manual kind, never an unsourced label.
    data => delete lodge(data).properties.details.kind,
    data => lodge(data).properties.details.kind.value = "hut",
    data => data.huts.features[0].properties.kind = "hotel",
    // A summit's own approach relabelled as hut-only leaves the summit with two.
    data => data.hutRoutes.features.find(route => route.properties.ranking_mode === "nearest-routable-huts").properties.ranking_mode = "hut-nearest-summit",
  );
  for (const mutate of mutations) {
    const copy = structuredClone(dataset);
    mutate(copy);
    assert.throws(() => validateExplorerData(copy), /Invalid Vitosha dataset/);
  }
});

test("data loader requests the correct static root with bounded parallel requests", async () => {
  const requested = [];
  const result = await loadExplorerData({ base: "/public/data", fetchImpl: async url => {
    requested.push(url);
    const key = Object.keys(names).find(key => url.endsWith(names[key]));
    return jsonResponse(dataset[key]);
  } });
  assert.equal(result.hutRoutes.length, 61);
  assert.equal(requested.length, 5);
  assert.equal(requested.every(url => url.startsWith("/public/data/")), true);
});

test("data loading fails predictably and cancels siblings when one file is unavailable", async () => {
  const signals = [];
  await assert.rejects(loadExplorerData({ fetchImpl: async (url, options) => {
    signals.push(options.signal);
    return url.endsWith("peaks.geojson") ? jsonResponse({}, 404) : new Promise(() => {});
  } }), error => error.status === 404);
  assert.equal(signals.length, 5);
  assert.equal(signals.slice(1).every(signal => signal.aborted), true);
  await assert.rejects(loadExplorerData({ timeoutMs: 15, fetchImpl: () => new Promise(() => {}) }), error => error.name === "TimeoutError");
});

test("retry/unmount cancellation does not let an old data request win", async () => {
  const controller = new AbortController();
  const pending = loadExplorerData({ signal: controller.signal, fetchImpl: () => new Promise(() => {}) });
  controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
});
