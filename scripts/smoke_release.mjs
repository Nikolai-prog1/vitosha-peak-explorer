import assert from "node:assert/strict";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { RUNTIME_FILES } from "./check_release.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = await mkdtemp(join(tmpdir(), "vitosha-runtime-smoke-"));
let app;
try {
  for (const path of RUNTIME_FILES) {
    await mkdir(dirname(join(isolated, path)), { recursive: true });
    await cp(join(project, path), join(isolated, path));
  }
  await cp(join(project, "dist"), join(isolated, "dist"), { recursive: true });
  const root = join(isolated, "dist");
  const { createExplorerServer } = await import(pathToFileURL(join(isolated, "server/app.js")));
  const { readConfig } = await import(pathToFileURL(join(isolated, "server/config.js")));
  const config = readConfig({ NODE_ENV: "production", WEATHER_MODE: "disabled",
    CESIUM_ION_TOKEN: "release-smoke-fixture-not-a-credential", PUBLIC_ORIGIN: "https://example.invalid" });
  app = await createExplorerServer({ root, config, fetchImpl: () => { throw new Error("Release smoke must not contact a forecast provider"); } });
  const { port } = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;
  const get = path => fetch(`${base}${path}`, { signal: AbortSignal.timeout(3000), headers: { "Accept-Encoding": "identity" } });
  const index = await get("/");
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-security-policy"), /script-src 'self' 'wasm-unsafe-eval'/);
  const html = await index.text();
  for (const [, path] of html.matchAll(/(?:src|href)="(\/(?:assets|vendor)\/[^"?]+)(?:\?[^"']*)?"/g)) assert.equal((await get(path)).status, 200, path);
  const health = await (await get("/api/health")).json();
  const manifest = JSON.parse(await readFile(resolve(root, "release-manifest.json"), "utf8"));
  assert.equal(health.ok, true);
  assert.equal(health.releaseId, manifest.contentId.slice(0, 16));
  assert.equal(health.weather, "disabled");
  const settings = await (await get("/api/config")).json();
  assert.equal(settings.evaluation, false);
  assert.equal(settings.weatherMode, "disabled");
  assert.equal("weatherApiKey" in settings, false);
  const peaks = await (await get("/data/peaks.geojson")).json();
  assert.equal(peaks.features.length, health.summitCount);
  assert.equal((await get("/.env")).status, 404);
  assert.equal((await get("/server/config.js")).status, 404);
  assert.equal((await get(`/api/weather/${peaks.features[0].properties.id}`)).status, 503);
  console.log(`Isolated production runtime smoke passed without node_modules: release ${health.releaseId}; ${health.summitCount} summits. Provider entitlements and browser rendering are separate checks.`);
} finally { await app?.close(); await rm(isolated, { recursive: true, force: true }); }
