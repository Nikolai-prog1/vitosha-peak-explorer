import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/atlas.css", import.meta.url), "utf8");
function color(value) {
  if (/^#[a-f\d]{6}$/i.test(value)) return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16)).concat(1);
  const match = value.match(/^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/);
  assert.ok(match, `Supported tested CSS color: ${value}`);
  return match.slice(1, 4).map(Number).concat(Number(match[4] ?? 1));
}
const variable = name => color(css.match(new RegExp(`--${name}:\\s*([^;]+)`))[1].trim());
const composite = (foreground, background) => foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3])).concat(1);
// W3C G18 relative luminance, including alpha compositing in sRGB before gamma.
const luminance = rgb => rgb.slice(0, 3).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (foreground, background) => {
  const first = luminance(composite(foreground, background)), second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};
const imageryCorners = Array.from({length: 8}, (_, value) => [0, 1, 2].map(bit => value & (1 << bit) ? 255 : 0).concat(1));
function atLeast(foreground, background, minimum, name) {
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= minimum, `${name}: ${ratio.toFixed(3)} must be at least ${minimum}:1`);
}

test("owned small text retains 4.5:1 on selected/soft panels and worst-case translucent imagery", () => {
  const backgrounds = ["panel-strong", "panel-soft", "selected"].map(variable).concat(imageryCorners.map(image => composite(variable("panel"), image)));
  for (const name of ["text", "soft", "muted"]) for (const background of backgrounds) atLeast(variable(name), background, 4.5, name);
  atLeast(variable("panel"), variable("accent"), 4.5, "inverse action text");
});

test("summit captions have a 4.5:1 palette bound over any imagery without relying on a text shadow", () => {
  for (const selector of [".map-peak-label", ".map-peak-marker.selected .map-peak-label"]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = css.match(new RegExp(`${escaped} \\{([^}]+)\\}`))[1];
    const background = color(rule.match(/background:\s*([^;]+)/)[1].trim()), foreground = color(rule.match(/(?:^|;)\s*color:\s*([^;]+)/)[1].trim());
    for (const image of imageryCorners) atLeast(foreground, composite(background, image), 4.5, selector);
  }
});

test("input boundaries retain 3:1 against their field and worst-case panel backgrounds", () => {
  const backgrounds = [color("#f7f9f2"), ...imageryCorners.map(image => composite(variable("panel"), image))];
  for (const background of backgrounds) atLeast(variable("control-line"), background, 3, "field boundary");
});
