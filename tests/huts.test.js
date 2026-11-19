import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildHutIndex, hutsSorted, hutKindKey } from "../src/huts.js";

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

test("the real huts include places with no approaches and can be sorted consistently", () => {
  const emptyHut = [...buildHutIndex(huts, routes).values()].find(entry => entry.approaches.length === 0);
  assert.ok(emptyHut);
  assert.deepEqual(emptyHut.approaches, []);
  assert.ok(huts.some(hut => hutKindKey(hut) === "hutKindShelter"));
  for (const language of ["bg", "en"]) {
    for (const mode of ["elevation-desc", "name"]) {
      assert.deepEqual(hutsSorted(huts, mode, language), hutsSorted([...huts].reverse(), mode, language));
    }
  }
});
