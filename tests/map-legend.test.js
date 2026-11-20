import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const icons = new URL("../src/icons.js", import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier, context, next) {
  return next(specifier === "@vitosha/icons" ? ${JSON.stringify(icons)} : specifier, context);
}`)}`);
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { MapLegend } = await import("../src/map-legend.js");
const { translate } = await import("../src/i18n.js");

const render = language => renderToStaticMarkup(React.createElement(MapLegend, {
  t: (key, values) => translate(language, key, values), open: true, onToggle() {}, showHuts: true, onShowHuts() {},
  showAllTrails: false, onShowAllTrails() {}, mapReady: true, inert: false,
}));

test("every legend entry except summits and huts has a collapsed, labelled explanation", () => {
  for (const language of ["bg", "en"]) {
    const markup = render(language);
    const buttons = [...markup.matchAll(/<button[^>]*class="legend-info-button"[^>]*>/g)].map(match => match[0]);
    const labels = buttons.map(button => button.match(/aria-label="([^"]+)"/)[1]);
    const items = ["selectedSummit", "hutKindShelter", "modelledApproach", "approximate", "markedTrail", "personalNote", "allMarkedTrailsLayer"];
    assert.deepEqual(labels, items.map(item => translate(language, "legendInfoAbout", { item: translate(language, item) }).replaceAll("\"", "&quot;")));
    for (const button of buttons) {
      assert.match(button, /aria-expanded="false"/);
      const id = button.match(/aria-controls="([^"]+)"/)[1];
      assert.match(markup, new RegExp(`<p id="${id}" class="legend-info" hidden="">[^<]+</p>`));
    }
    for (const plain of ["summit", "hutKindHut", "hutLayer"]) {
      assert.ok(!labels.some(label => label.includes(`„${translate(language, plain)}“`) || label.includes(`“${translate(language, plain)}”`)), plain);
    }
  }
});
