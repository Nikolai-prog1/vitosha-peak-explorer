import test from "node:test";
import assert from "node:assert/strict";
import { appLocation, resolveAppConfig, DEVELOPMENT_ION_TOKEN } from "../src/config.js";
import { rebaseSourceHtml } from "../scripts/build_pages.mjs";

test("compiled clients fail closed when runtime configuration is absent, malformed or evaluation-direct", () => {
  for (const supplied of [undefined, null, "bad", {}, { weatherMode: "direct", evaluation: true, ionAccessToken: "public-token" },
    { weatherMode: "proxy", evaluation: true }, { weatherMode: "proxy", ionAccessToken: "public-token" },
    { weatherMode: "proxy", evaluation: false, ionAccessToken: "bad token" }]) {
    const config = resolveAppConfig(supplied);
    assert.equal(config.configurationUnavailable, true); assert.equal(config.ionAccessToken, "");
    assert.equal(config.weatherMode, "disabled"); assert.equal(config.evaluation, false);
  }
});
test("complete runtime configuration preserves same-origin proxy and explicit evaluation/commercial state", () => {
  for (const weatherMode of ["proxy", "disabled"]) for (const evaluation of [true, false]) {
    const config = resolveAppConfig({ ionAccessToken: "public-browser-token", weatherMode, evaluation });
    assert.equal(config.configurationUnavailable, false); assert.equal(config.ionAccessToken, "public-browser-token");
    assert.equal(config.weatherMode, weatherMode); assert.equal(config.evaluation, evaluation); assert.ok(Object.isFrozen(config));
  }
});
test("token-free offline bootstrap never falls back to any provider token or evaluation forecast", () => {
  const config = resolveAppConfig({ offlineLaunch: true, weatherMode: "disabled", evaluation: false }, { legacyToken: "legacy-browser-token" });
  assert.equal(config.offlineLaunch, true); assert.equal(config.configurationUnavailable, false);
  assert.equal(config.ionAccessToken, ""); assert.equal(config.weatherMode, "disabled"); assert.equal(config.evaluation, false);
});
test("evaluation defaults remain limited to the explicitly identified source preview", () => {
  const config = resolveAppConfig(undefined, { sourcePreview: true });
  assert.equal(config.configurationUnavailable, false); assert.equal(config.ionAccessToken, DEVELOPMENT_ION_TOKEN);
  assert.equal(config.weatherMode, "direct"); assert.equal(config.evaluation, true);
  assert.equal(resolveAppConfig({}, { sourcePreview: true, legacyToken: "legacy-browser-token" }).ionAccessToken, "legacy-browser-token");
});
test("app location identifies the source preview at the root or below a static sub-path", () => {
  assert.deepEqual(appLocation("/vendor/cesium/"), { sourcePreview: false, publicBase: "/" });
  assert.deepEqual(appLocation("/public/vendor/cesium/"), { sourcePreview: true, publicBase: "/public/" });
  assert.deepEqual(appLocation("/vitosha-peak-explorer/public/vendor/cesium/"), { sourcePreview: true, publicBase: "/vitosha-peak-explorer/public/" });
  for (const base of [undefined, "", "https://cdn.example/public/vendor/cesium/", "//cdn.example/public/vendor/cesium/", "/../public/vendor/cesium/", "/public/vendor/cesium"])
    assert.deepEqual(appLocation(base), { sourcePreview: false, publicBase: "/" });
});
test("pages build rebases only source-preview URLs onto the repository path", () => {
  const html = rebaseSourceHtml('<link data-cesium-base="/public/vendor/cesium/" href="/public/a.css"><script src="/src/app.js?v=1"></script><a href="https://x.test/src/">', "/repo/");
  assert.equal(html, '<link data-cesium-base="/repo/public/vendor/cesium/" href="/repo/public/a.css"><script src="/repo/src/app.js?v=1"></script><a href="https://x.test/src/">');
  assert.throws(() => rebaseSourceHtml("", "/../"));
  assert.throws(() => rebaseSourceHtml("", "repo/"));
});
