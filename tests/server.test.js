import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, brotliCompressSync, gunzipSync, brotliDecompressSync } from "node:zlib";
import { createExplorerServer, createLimiter } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { inspectRelease, inspectRuntime, releaseContentId } from "../scripts/check_release.mjs";
import { prepareOfflineBundle } from "../scripts/prepare_offline.mjs";
import { forecastPayload, jsonResponse, peak } from "./fixtures.js";

const asset = "/assets/test-abcdefgh.js";
const assetText = "/* self-contained fixture */\n" + "const local = true;\n".repeat(80);

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "vitosha-server-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    "index.html": '<!doctype html><html><head><script src="/runtime-config.js"></script><script type="module" src="/assets/test-abcdefgh.js"></script></head><body></body></html>',
    "data/peaks.geojson": JSON.stringify({ type: "FeatureCollection", features: [peak] }),
    "data/huts.geojson": '{"type":"FeatureCollection","features":[]}',
    "data/hut-routes.geojson": '{"type":"FeatureCollection","features":[]}',
    "data/data-quality.json": '{}', "runtime-config.js": 'window.__VITOSHA_CONFIG__ = {};',
    "vendor/cesium/Cesium.js": 'var Cesium = {};', "vendor/cesium/Widgets/widgets.css": '.cesium-widget{}',
    "vendor/fonts/fonts.css": '@font-face{font-family:fixture}',
    "assets/test-abcdefgh.js": assetText,
  };
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), body);
  }
  await writeFile(join(root, asset.slice(1) + ".gz"), gzipSync(assetText));
  await writeFile(join(root, asset.slice(1) + ".br"), brotliCompressSync(assetText));
  const config = readConfig({ WEATHER_MODE: "evaluation", ...overrides.env });
  const app = await createExplorerServer({ root, config, fetchImpl: async () => jsonResponse(forecastPayload()), ...overrides });
  t.after(() => app.close());
  const address = await app.listen(0, "127.0.0.1");
  const request = (path, options = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port: address.port, path, method: "GET", ...options }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(2000, () => req.destroy(new Error("Fixture HTTP deadline exceeded")));
    req.end(options.body);
  });
  return { app, root, request };
}

test("server serves a usable release with strict headers and safe public configuration", async t => {
  const key = "fixture-private-key";
  const { request } = await fixture(t, { env: { WEATHER_MODE: "commercial", OPEN_METEO_API_KEY: key, PUBLIC_ORIGIN: "https://vitosha.example" } });
  const index = await request("/");
  assert.equal(index.status, 200);
  assert.match(index.headers["content-type"], /^text\/html/);
  assert.equal(index.headers["cache-control"], "no-cache");
  assert.equal(index.headers["x-content-type-options"], "nosniff");
  assert.equal(index.headers["x-frame-options"], "DENY");
  assert.match(index.headers["strict-transport-security"], /max-age=31536000/);
  const csp = index.headers["content-security-policy"];
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.equal(csp.includes("'unsafe-eval'"), false);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.match(csp, /frame-ancestors 'none'/);
  for (const path of ["/api/config", "/runtime-config.js", "/api/health"]) {
    const result = await request(path);
    assert.equal(result.status, 200);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.equal(result.body.includes(key), false);
    assert.equal(result.body.includes("customer-api.open-meteo.com"), false);
  }
  const health = JSON.parse((await request("/api/health")).body);
  assert.equal(health.ok, true);
  assert.equal(health.summitCount, 1);
  assert.match(health.releaseId, /^[a-f0-9]{16}$/);
});

test("static files support HEAD, conditional responses, MIME types and immutable hashed assets", async t => {
  const { request } = await fixture(t);
  const get = await request(asset);
  assert.equal(get.status, 200);
  assert.equal(get.body.toString(), assetText);
  assert.match(get.headers["cache-control"], /immutable/);
  const head = await request(asset, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers["content-length"]), get.body.length);
  const unchanged = await request(asset, { headers: { "If-None-Match": get.headers.etag } });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.body.length, 0);
  const data = await request("/data/peaks.geojson");
  assert.match(data.headers["content-type"], /^application\/geo\+json/);
  assert.equal(data.headers["cache-control"].includes("immutable"), false);
});

test("precompressed files respect acceptable encodings and keep the original content type", async t => {
  const { request } = await fixture(t);
  for (const [encoding, decode] of [["br", brotliDecompressSync], ["gzip", gunzipSync]]) {
    const result = await request(asset, { headers: { "Accept-Encoding": encoding } });
    assert.equal(result.headers["content-encoding"], encoding);
    assert.match(result.headers["content-type"], /^application\/javascript/);
    assert.equal(result.headers.vary, "Accept-Encoding");
    assert.equal(decode(result.body).toString(), assetText);
  }
  const disabled = await request(asset, { headers: { "Accept-Encoding": "br;q=0, gzip;q=0" } });
  assert.equal(disabled.headers["content-encoding"], undefined);
  assert.equal(disabled.body.toString(), assetText);
});

test("paths cannot traverse, list directories, access dotfiles or Windows stream names", async t => {
  const { request, root } = await fixture(t);
  await writeFile(join(root, ".env"), "PRIVATE_FIXTURE_VALUE");
  await writeFile(join(root, "not-public.toml"), "PRIVATE_FIXTURE_VALUE");
  for (const path of ["/.env", "/%2e%2e/package.json", "/data/../index.html", "/data", "/not-public.toml", "/api/missing"]) {
    const result = await request(path);
    assert.equal(result.status, 404, path);
    assert.equal(result.body.includes("PRIVATE_FIXTURE_VALUE"), false);
  }
  for (const path of ["//index.html", "/%ZZ", "/index.html:stream", "/data%5cpeaks.geojson", "/%00", "/" + "a".repeat(2048)]) {
    assert.equal((await request(path)).status, 400, path);
  }
});

test("unrecognized or malformed hosts, write methods and request bodies are rejected", async t => {
  const { request } = await fixture(t);
  assert.equal((await request("/", { headers: { Host: "untrusted.example" } })).status, 421);
  for (const host of ["127.0.0.1/private", "127.0.0.1?x=1", "user@127.0.0.1"]) {
    assert.equal((await request("/", { headers: { Host: host } })).status, 400);
  }
  const post = await request("/", { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET, HEAD");
  const body = await request("/", { headers: { "Content-Length": "1" }, body: "x" });
  assert.equal(body.status, 400);
  assert.equal(body.headers.connection, "close");
});

test("weather endpoint accepts only registered summit IDs, with no arbitrary URLs or cross-site callers", async t => {
  let calls = 0;
  const { request } = await fixture(t, { fetchImpl: async () => { calls += 1; return jsonResponse(forecastPayload()); } });
  for (const path of ["/api/weather/anything", "/api/weather/peak-26862677?latitude=0", "/api/weather/https://other.example"]) {
    assert.ok([400, 404].includes((await request(path)).status));
  }
  assert.equal((await request("/api/weather/peak-999")).status, 404);
  assert.equal((await request(`/api/weather/${peak.properties.id}`, { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal(calls, 0);
  const result = await request(`/api/weather/${peak.properties.id}`);
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).schemaVersion, 1);
  assert.equal(calls, 1);
});

test("weather HTTP requests coalesce, cache and return sanitized provider failures", async t => {
  let calls = 0;
  let fail = false;
  let time = 1000;
  const { request } = await fixture(t, { now: () => time, env: { WEATHER_MODE: "commercial", OPEN_METEO_API_KEY: "private-http-fixture" },
    fetchImpl: async () => { calls += 1; if (fail) throw new Error("private-http-fixture https://provider.example/secret"); return jsonResponse(forecastPayload()); } });
  const path = `/api/weather/${peak.properties.id}`;
  const results = await Promise.all([request(path), request(path)]);
  assert.equal(results.every(result => result.status === 200), true);
  assert.equal(calls, 1);
  fail = true; time += 61 * 60 * 1000;
  const failure = await request(path);
  assert.equal(failure.status, 503);
  assert.deepEqual(JSON.parse(failure.body), { error: "WEATHER_UNAVAILABLE" });
  assert.equal(failure.body.includes("private-http-fixture"), false);
});

test("weather rate limiting is bounded and does not trust spoofed forwarded client IPs", async t => {
  const { request } = await fixture(t, { rateLimit: 1 });
  assert.equal((await request(`/api/weather/${peak.properties.id}`)).status, 200);
  const limited = await request(`/api/weather/${peak.properties.id}`, { headers: { "X-Forwarded-For": "192.0.2.55" } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "60");
  let time = 0;
  const limit = createLimiter({ limit: 1, intervalMs: 100, maxClients: 2, now: () => time });
  assert.equal(limit("a"), true);
  assert.equal(limit("a"), false);
  assert.equal(limit("b"), true);
  assert.equal(limit("c"), false);
  time = 101;
  assert.equal(limit("c"), true);
});

test("production startup rejects a missing or modified release manifest", async t => {
  const { root } = await fixture(t);
  const config = readConfig({ NODE_ENV: "production", CESIUM_ION_TOKEN: "fixture-browser-token", WEATHER_MODE: "disabled", PUBLIC_ORIGIN: "https://vitosha.example" });
  await assert.rejects(createExplorerServer({ root, config }), /ENOENT/);
  const release = await inspectRelease(root);
  const host = await inspectRuntime();
  const manifest = { schemaVersion: 2, clientContentId: release.contentId, hostContentId: host.contentId, contentId: releaseContentId(release.contentId, host.contentId) };
  await writeFile(join(root, "release-manifest.json"), JSON.stringify(manifest));
  const app = await createExplorerServer({ root, config });
  await app.listen(0, "127.0.0.1");
  await app.close();
  await writeFile(join(root, "release-manifest.json"), JSON.stringify({ ...manifest, hostContentId: "changed-host-artifact" }));
  await assert.rejects(createExplorerServer({ root, config }), /integrity/);
  await writeFile(join(root, "release-manifest.json"), JSON.stringify(manifest));
  await writeFile(join(root, asset.slice(1)), "modified artifact");
  await assert.rejects(createExplorerServer({ root, config }), /integrity/);
});

test("release inspection rejects executable CDNs, source import maps and environment files", async t => {
  const { root } = await fixture(t);
  await writeFile(join(root, "index.html"), '<script src="https://cdn.example/library.js"></script>');
  await assert.rejects(inspectRelease(root), /External/);
  await writeFile(join(root, "index.html"), '<script type="importmap">{}</script>');
  await assert.rejects(inspectRelease(root), /import maps/);
  await writeFile(join(root, "index.html"), '<script src="/runtime-config.js"></script>');
  await writeFile(join(root, ".env"), "PRIVATE_FIXTURE_VALUE");
  await assert.rejects(inspectRelease(root), /Environment/);
});

test("advertised offline release is complete and revalidated, with updateable worker/catalog headers", async t => {
  const { root, request } = await fixture(t);
  await prepareOfflineBundle(root);
  await inspectRelease(root);
  for (const path of ["/offline-worker.js", "/offline-pack.json"]) {
    const response = await request(path); assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "no-cache");
  }
  const original = await readFile(join(root, "offline-worker.js"), "utf8");
  await writeFile(join(root, "offline-worker.js"), original.replace(/const OFFLINE_PACK/, "const STALE_PACK"));
  await assert.rejects(inspectRelease(root), /Offline worker catalog/);
  await writeFile(join(root, "offline-worker.js"), original);
  await writeFile(join(root, "data/peaks.geojson"), "changed public data");
  await assert.rejects(inspectRelease(root), /Offline release integrity/);
});

test("shutdown is idempotent and completes active bounded requests before closing", async t => {
  let started;
  let finish;
  const upstreamStarted = new Promise(resolve => { started = resolve; });
  const { request, app } = await fixture(t, { fetchImpl: () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  const response = request(`/api/weather/${peak.properties.id}`);
  await upstreamStarted;
  const closing = app.close();
  assert.equal(app.close(), closing);
  finish(jsonResponse(forecastPayload()));
  assert.equal((await response).status, 200);
  await closing;
  assert.equal(app.server.listening, false);
});
