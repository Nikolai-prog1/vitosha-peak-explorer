import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadExplorerData, validateExplorerData } from "../src/explorer-data.js";
import { jsonResponse } from "./fixtures.js";

const names = { peaks: "peaks.geojson", huts: "huts.geojson", hutRoutes: "hut-routes.geojson", quality: "data-quality.json" };
const dataset = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, file]) => [key, JSON.parse(await readFile(new URL(`../public/data/${file}`, import.meta.url)))])));

test("the generated real dataset satisfies the client contract", () => {
  const result = validateExplorerData(dataset);
  assert.equal(result.peaks.length, 17);
  assert.equal(result.huts.length, 16);
  assert.equal(result.hutRoutes.length, 51);
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

test("data loader requests the correct static root with bounded parallel requests", async () => {
  const requested = [];
  const result = await loadExplorerData({ base: "/public/data", fetchImpl: async url => {
    requested.push(url);
    const key = Object.keys(names).find(key => url.endsWith(names[key]));
    return jsonResponse(dataset[key]);
  } });
  assert.equal(result.hutRoutes.length, 51);
  assert.equal(requested.length, 4);
  assert.equal(requested.every(url => url.startsWith("/public/data/")), true);
});

test("data loading fails predictably and cancels siblings when one file is unavailable", async () => {
  const signals = [];
  await assert.rejects(loadExplorerData({ fetchImpl: async (url, options) => {
    signals.push(options.signal);
    return url.endsWith("peaks.geojson") ? jsonResponse({}, 404) : new Promise(() => {});
  } }), error => error.status === 404);
  assert.equal(signals.length, 4);
  assert.equal(signals.slice(1).every(signal => signal.aborted), true);
  await assert.rejects(loadExplorerData({ timeoutMs: 15, fetchImpl: () => new Promise(() => {}) }), error => error.name === "TimeoutError");
});

test("retry/unmount cancellation does not let an old data request win", async () => {
  const controller = new AbortController();
  const pending = loadExplorerData({ signal: controller.signal, fetchImpl: () => new Promise(() => {}) });
  controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
});
