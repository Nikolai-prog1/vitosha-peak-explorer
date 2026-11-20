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
