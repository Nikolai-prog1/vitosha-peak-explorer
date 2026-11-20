import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildHutIndex, hutClosed, hutsSorted, hutKindKey, HUT_APPROACH, PEAK_APPROACH, summitApproaches } from "../src/huts.js";

const load = async name => JSON.parse(await readFile(new URL(`../public/data/${name}.geojson`, import.meta.url), "utf8")).features;
const [huts, routes] = await Promise.all([load("huts"), load("hut-routes")]);

test("every approach resolves to a known hut and the hut index is deterministic", () => {
  const index = buildHutIndex(huts, routes);
  assert.equal(index.size, huts.length);
  assert.deepEqual(index, buildHutIndex(huts, [...routes].reverse()));
  assert.equal([...index.values()].flatMap(entry => entry.approaches).length, routes.length);
  for (const { properties: route } of routes) {
    const entry = index.get(route.hut_id);
    assert.ok(entry);
    assert.ok(entry.approaches.some(approach => approach.routeId === route.id && approach.peakId === route.peak_id));
  }
});

test("every open hut starts an approach and only closed huts have none", () => {
  const index = buildHutIndex(huts, routes);
  const closed = huts.filter(hutClosed).map(hut => hut.properties.id).sort();
  assert.deepEqual(closed, ["hut-432984797", "hut-474190455", "hut-56057967"]);
  for (const [id, entry] of index) assert.equal(entry.approaches.length === 0, closed.includes(id), id);
});

test("a summit lists three approaches; a hut-only approach joins last while its hut is chosen", () => {
  const extra = routes.find(route => route.properties.ranking_mode === HUT_APPROACH).properties;
  const own = summitApproaches(routes, extra.peak_id, null);
  assert.equal(own.length, 3);
  assert.ok(own.every(route => route.properties.ranking_mode === PEAK_APPROACH));
  const chosen = summitApproaches(routes, extra.peak_id, extra.hut_id);
  assert.deepEqual(chosen.slice(0, 3), own);
  assert.equal(chosen[3].properties.id, extra.id);
  assert.deepEqual(summitApproaches(routes, extra.peak_id, own[0].properties.hut_id), own);
});

test("the real huts can be sorted consistently", () => {
  assert.ok(huts.some(hut => hutKindKey(hut) === "hutKindShelter"));
  for (const language of ["bg", "en"]) {
    for (const mode of ["elevation-desc", "name"]) {
      assert.deepEqual(hutsSorted(huts, mode, language), hutsSorted([...huts].reverse(), mode, language));
    }
  }
});
