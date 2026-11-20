import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFile } from "node:fs/promises";

// The browser resolves the icon entry through the import map or a Vite alias.
const icons = new URL("../src/icons.js", import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier, context, next) {
  return next(specifier === "@vitosha/icons" ? ${JSON.stringify(icons)} : specifier, context);
}`)}`);
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { MapPopup } = await import("../src/map-popup.js");

const load = async name => JSON.parse(await readFile(new URL(`../public/data/${name}.geojson`, import.meta.url), "utf8")).features;
const [trails, huts] = await Promise.all([load("marked-trails"), load("huts")]);

function render(popup, extra = {}) {
  return renderToStaticMarkup(React.createElement(MapPopup, {
    popup, embedded: false, popupRef: null, onClose() {}, onApproach() {}, language: "bg",
    hutIndex: new Map(), peaks: new Map(), routes: new Map(), ...extra,
  }));
}

test("hut and trail cards both credit OpenStreetMap under ODbL", () => {
  for (const popup of [{ kind: "trail", feature: trails[0] }, { kind: "hut", feature: huts[0] }]) {
    const markup = render(popup);
    assert.match(markup, /<footer[^>]*>.*href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>Данни · © OpenStreetMap contributors \(ODbL\)/s, popup.kind);
  }
});

test("every external card link opens without an opener or referrer", () => {
  const markup = render({ kind: "trail", feature: trails[0] }) + render({ kind: "hut", feature: huts.find(hut => hut.properties.details.website) });
  const blank = [...markup.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map(match => match[0]);
  assert.ok(blank.length >= 4);
  for (const anchor of blank) assert.match(anchor, /rel="noopener noreferrer"/);
  assert.doesNotMatch(markup, /href="(?:javascript|data):/i);
});

test("an approach's marking dots name the trails for assistive technology", async () => {
  const routes = await load("hut-routes");
  const route = routes.find(item => item.properties.marked_trails.filter(mark => mark.share >= 0.15).length >= 2);
  const { hut_id: hutId, peak_id: peakId, id: routeId, distance_km: distanceKm } = route.properties;
  const peak = (await load("peaks")).find(item => item.properties.id === peakId);
  const markup = render({ kind: "hut", feature: huts.find(hut => hut.properties.id === hutId) }, {
    hutIndex: new Map([[hutId, { approaches: [{ peakId, routeId, distanceKm, approximate: false }] }]]),
    peaks: new Map([[peakId, peak]]), routes: new Map([[routeId, route]]),
  });
  const label = markup.match(/class="map-popup-marks" role="img" aria-label="([^"]+)"/)?.[1];
  const expected = route.properties.marked_trails.filter(mark => mark.share >= 0.15).map(mark => mark.ref || "Маркирана пътека");
  assert.equal(label, `Маркирани пътеки: ${expected.join(", ")}`);
});

test("trail cards explain loose ends from the park cut and from gaps in the OSM relation", () => {
  const notes = feature => [...render({ kind: "trail", feature }).matchAll(/<ul class="map-popup-notes">(.*?)<\/ul>/gs)].flatMap(match => [...match[1].matchAll(/<li>(.*?)<\/li>/g)].map(item => item[1]));
  const base = trails.find(trail => !trail.properties.clipped && trail.properties.piece_count === 1);
  const variant = (clipped, pieceCount) => ({ ...base, properties: { ...base.properties, clipped, piece_count: pieceCount } });
  assert.deepEqual(notes(variant(false, 1)), []);
  assert.equal(notes(variant(true, 1)).length, 1);
  assert.match(notes(variant(true, 1))[0], /300 m/);
  assert.deepEqual(notes(variant(false, 3)), ["Релацията в OpenStreetMap е от 3 несвързани части, затова линията има прекъсвания."]);
  assert.equal(notes(variant(true, 2)).length, 2);
  for (const trail of trails) {
    assert.equal(notes(trail).length, Number(trail.properties.clipped) + Number(trail.properties.piece_count > 1), trail.properties.id);
  }
});
