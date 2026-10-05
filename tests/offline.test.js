import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import { prepareOfflineBundle } from "../scripts/prepare_offline.mjs";
import { ownedWorker, prepareOfflinePack, offlineWorkerStatus } from "../src/offline.js";

const origin = "https://vitosha.example", hash = body => createHash("sha256").update(body).digest("hex");
const source = await readFile(new URL("../src/offline-worker.js", import.meta.url), "utf8");
const bodies = { "/index.html": "<!doctype html><head></head><body>Vitosha</body>", "/assets/app-abcdefgh.js": "const app = true;",
  "/data/peaks.geojson": "{\"peaks\":17}", "/data/huts.geojson": "{\"huts\":16}", "/data/hut-routes.geojson": "{\"routes\":51}", "/data/data-quality.json": "{}" };
const makePack = id => ({ schemaVersion: 1, id: id.repeat(64), files: Object.entries(bodies).map(([path, body]) => ({ path, bytes: Buffer.byteLength(body), sha256: hash(body) })), bytes: Object.values(bodies).reduce((sum, body) => sum + Buffer.byteLength(body), 0) });
function harness(pack = makePack("a"), store = new Map(), { shortDeadlines = false } = {}) {
  const handlers = new Map(), calls = []; let network = true, badPath = "", quotaPath = "", streamPath = "", errorPath = "", claimed = 0, cancelled = 0;
  const caches = { async keys() { return [...store.keys()]; }, async delete(name) { return store.delete(name); }, async open(name) {
    if (!store.has(name)) store.set(name, new Map()); const entries = store.get(name);
    return { async match(path) { return entries.get(typeof path === "string" ? path : new URL(path.url).pathname)?.clone(); }, async put(path, response) { if (path === quotaPath) throw new DOMException("Fixture storage full", "QuotaExceededError"); entries.set(path, response.clone()); } };
  } };
  const self = { location: { origin }, registration: { active: null }, clients: { async claim() { claimed++; } }, async skipWaiting() {}, addEventListener(type, handler) { handlers.set(type, handler); } };
  const context = vm.createContext({ self, caches, URL, Response, Headers, Uint8Array, AbortController, crypto: webcrypto, setTimeout: (fn, ms) => setTimeout(fn, shortDeadlines ? Math.min(ms, 20) : ms), clearTimeout, console,
    fetch: async request => { const path = typeof request === "string" ? request : new URL(request.url).pathname; calls.push(path); if (!network) throw new Error("fixture offline");
      if (path === streamPath) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([123])); }, cancel() { cancelled++; } }));
      if (path === errorPath) return new Response(new ReadableStream({ pull(controller) { controller.error(new Error("Fixture broken response body")); } }));
      return new Response(path === badPath ? "modified" : path === "/runtime-config.js" ? "window.__VITOSHA_CONFIG__={ionAccessToken:'public-test-token'}" : bodies[path] || "{}", { headers: { "Content-Type": path.endsWith(".js") ? "application/javascript" : "application/json" } }); } });
  vm.runInContext(`const OFFLINE_PACK = ${JSON.stringify(pack)};\n${source}`, context);
  return { store, calls, setNetwork(value) { network = value; }, setBadPath(value) { badPath = value; }, setQuotaPath(value) { quotaPath = value; }, setStreamPath(value) { streamPath = value; }, setErrorPath(value) { errorPath = value; }, get claimed() { return claimed; }, get cancelled() { return cancelled; },
    async lifecycle(type) { let result; handlers.get(type)({ waitUntil(promise) { result = promise; } }); return await result; },
    async status(repair = false) { let result, wait; handlers.get("message")({ data: { type: repair ? "VITOSHA_OFFLINE_PREPARE" : "VITOSHA_OFFLINE_STATUS" }, ports: [{ postMessage(value) { result = value; } }], waitUntil(promise) { wait = promise; } }); await wait; return result; },
    async request(path, options = {}) { let result; handlers.get("fetch")({ request: { url: path.startsWith("http") ? path : origin + path, method: "GET", mode: "cors", ...options }, respondWith(promise) { result = promise; } }); return result ? await result : null; } };
}

test("worker prepares a verified complete pack and serves public facts when the app host is unavailable", async () => {
  const h = harness(); await h.lifecycle("install"); await h.lifecycle("activate");
  assert.equal(h.claimed, 1); assert.equal((await h.status()).ready, true);
  h.setNetwork(false);
  assert.equal(await (await h.request("/", { mode: "navigate" })).text(), bodies["/index.html"]);
  assert.equal(await (await h.request("/data/hut-routes.geojson")).text(), bodies["/data/hut-routes.geojson"]);
  assert.equal(await (await h.request("/assets/app-abcdefgh.js")).text(), bodies["/assets/app-abcdefgh.js"]);
  const config = await (await h.request("/runtime-config.js")).text();
  assert.match(config, /offlineLaunch:true/); assert.match(config, /weatherMode:"disabled"/); assert.doesNotMatch(config, /public-test-token/);
  assert.equal([...h.store.values()][0].has("/runtime-config.js"), false);
});

test("worker never intercepts providers, private/API paths, writes, unknown navigation or arbitrary query assets", async () => {
  const h = harness();
  for (const path of ["https://api.cesium.com/terrain", "https://api.mapbox.com/tiles", "/api/weather/peak-1", "/api/config", "/private-backup.json", "/notes", "/assets/app-abcdefgh.js?private=1"]) assert.equal(await h.request(path), null);
  assert.equal(await h.request("/data/peaks.geojson", { method: "POST" }), null);
  assert.equal(await h.request("/other-app", { mode: "navigate" }), null);
  assert.deepEqual(h.calls, []);
});

test("failed, modified or quota-limited preparation cannot replace a previous complete pack", async () => {
  const store = new Map(), old = harness(makePack("a"), store); await old.lifecycle("install");
  const failed = harness(makePack("b"), store); failed.setBadPath("/data/hut-routes.geojson");
  await assert.rejects(failed.lifecycle("install"), /integrity|large/);
  assert.equal(store.has("vitosha-offline-v1-" + "b".repeat(64)), false);
  assert.equal((await old.status()).ready, true);
  const lost = harness(makePack("c"), store); lost.setNetwork(false); await assert.rejects(lost.lifecycle("install"));
  assert.equal((await old.status()).ready, true);
  const full = harness(makePack("d"), store); full.setQuotaPath("/data/peaks.geojson");
  await assert.rejects(full.lifecycle("install"), /storage full/);
  assert.equal(store.has("vitosha-offline-v1-" + "d".repeat(64)), false);
  assert.equal((await old.status()).ready, true);
  const oldCache = store.get("vitosha-offline-v1-" + "a".repeat(64)); oldCache.delete("/data/peaks.geojson");
  assert.equal((await old.status()).ready, false, "evicted resources must not claim readiness");
});

test("evicted public resources can be explicitly repaired and concurrent repairs share one preparation", async () => {
  const h = harness(); await h.lifecycle("install");
  const cache = h.store.get("vitosha-offline-v1-" + "a".repeat(64)); cache.delete("/data/peaks.geojson");
  assert.equal((await h.status()).ready, false);
  const before = h.calls.length, results = await Promise.all([h.status(true), h.status(true)]);
  assert.equal(results.every(result => result.ready), true);
  assert.equal(h.calls.length - before, makePack("a").files.length);
});

test("header-success/body-timeout and broken bodies never become ready or block cached recovery", async () => {
  const h = harness(makePack("a"), new Map(), { shortDeadlines: true }); h.setStreamPath("/data/peaks.geojson");
  await assert.rejects(h.lifecycle("install"), /timed out/); assert.equal(h.cancelled, 1); assert.equal((await h.status()).ready, false);
  h.setStreamPath(""); await h.lifecycle("install");
  h.setStreamPath("/runtime-config.js");
  assert.match(await (await h.request("/runtime-config.js")).text(), /offlineLaunch:true/);
  h.setStreamPath("/"); assert.equal(await (await h.request("/", { mode: "navigate" })).text(), bodies["/index.html"]);
  h.setStreamPath(""); h.setErrorPath("/data/peaks.geojson");
  assert.equal(await (await h.request("/data/peaks.geojson")).text(), bodies["/data/peaks.geojson"]);
});

test("activation retains only the current and previous owned public pack, never unrelated caches", async () => {
  const store = new Map([["other-application", new Map()]]);
  for (const id of ["a", "b", "c"]) { const h = harness(makePack(id), store); await h.lifecycle("install"); await h.lifecycle("activate"); }
  assert.equal(store.has("other-application"), true); assert.equal(store.size, 3);
  assert.equal(store.has("vitosha-offline-v1-" + "c".repeat(64)), true);
});

test("untrusted pack paths, duplicates and invalid sizes are rejected before any network/cache work", () => {
  for (const path of ["https://example.invalid/private", "/api/weather/peak-1", "/runtime-config.js", "/vendor/cesium/Cesium.js", "/data/../private"]) {
    const pack = makePack("a"); pack.files[0].path = path; assert.throws(() => harness(pack), /Invalid offline/);
  }
  const pack = makePack("a"); pack.files.push(pack.files[0]); assert.throws(() => harness(pack), /Invalid offline/);
  assert.throws(() => harness({ ...makePack("a"), files: [], bytes: 0 }), /Invalid offline/);
});

test("offline bundle is deterministic and excludes provider SDKs, configs, APIs and compressed duplicates", async t => {
  const directory = await mkdtemp(join(tmpdir(), "vitosha-offline-build-")); t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [path, body] of Object.entries({ ...Object.fromEntries(Object.entries(bodies).map(([path, value]) => [path.slice(1), value])), "assets/app-abcdefgh.js.gz": "compressed", "vendor/fonts/fonts.css": "@font-face{}", "vendor/fonts/manrope.woff2": "font", "vendor/cesium/Widgets/widgets.css": ".cesium-widget{}", "vendor/cesium/Cesium.js": "SDK", "runtime-config.js": "private-dynamic-config" })) {
    await mkdir(join(directory, path, ".."), { recursive: true }); await writeFile(join(directory, path), body);
  }
  const first = await prepareOfflineBundle(directory), second = await prepareOfflineBundle(directory);
  assert.deepEqual(second, first); assert.ok(first.files.every(file => !/runtime-config|Cesium\.js|\.gz|\/api\//.test(file.path)));
  for (const file of first.files) assert.equal(hash(await readFile(join(directory, file.path.slice(1)))), file.sha256);
  assert.match(await readFile(join(directory, "index.html"), "utf8"), /vitosha-offline-version/);
});

test("offline client refuses to replace another service worker's scope", async () => {
  let registered = false;
  await assert.rejects(prepareOfflinePack({ getRegistration: async () => ({ active: { scriptURL: origin + "/another-worker.js" } }), register: async () => { registered = true; } }, origin), /Another service/);
  assert.equal(registered, false); assert.equal(ownedWorker({ scriptURL: "https://other.example/offline-worker.js" }, origin), false);
});

test("offline client reports readiness only after a valid bounded worker response", async () => {
  const worker = { postMessage(_message, ports) { ports[0].postMessage({ type: "VITOSHA_OFFLINE_STATUS", ready: true, id: "a".repeat(64), bytes: 1000, preparedAt: "2026-10-05T10:00:00Z" }); ports[0].close(); } };
  assert.equal((await offlineWorkerStatus(worker)).ready, true);
  await assert.rejects(offlineWorkerStatus({ postMessage(_message, ports) { ports[0].postMessage({ ready: true }); ports[0].close(); } }), /Invalid offline status/);
  await assert.rejects(offlineWorkerStatus({ postMessage() {} }, { timeoutMs: 10 }), /timed out/);
});

function clientWorker(id = "a", ready = true) {
  const worker = new EventTarget(); Object.assign(worker, { state: "activated", scriptURL: origin + "/offline-worker.js", repairs: 0, activations: 0,
    postMessage(message, ports) {
      if (message.type === "VITOSHA_OFFLINE_ACTIVATE") { worker.activations++; return; }
      if (message.type === "VITOSHA_OFFLINE_PREPARE") { worker.repairs++; ready = true; }
      ports[0].postMessage({ type: "VITOSHA_OFFLINE_STATUS", ready, id: id.repeat(64), bytes: 1000, preparedAt: ready ? "2026-10-05T10:00:00Z" : null }); ports[0].close();
    } }); return worker;
}
test("explicit refresh checks the new worker, waits for installation and activates only its complete expected pack", async () => {
  const old = clientWorker("a"), next = clientWorker("b"), registration = { active: old, waiting: null, installing: null,
    async update() {
      registration.installing = next; next.state = "installing";
      setTimeout(() => { next.state = "installed"; registration.installing = null; registration.waiting = next; next.dispatchEvent(new Event("statechange")); }, 10);
    } };
  const container = { getRegistration: async () => registration, register: async () => registration };
  assert.equal((await prepareOfflinePack(container, origin, { expectedId: "b".repeat(64) })).id, "b".repeat(64));
  assert.equal(next.activations, 1); assert.equal(old.activations, 0);
  registration.waiting = null;
  registration.update = async () => {};
  await assert.rejects(prepareOfflinePack(container, origin, { expectedId: "c".repeat(64) }), /does not match/);
});
test("client repairs an evicted current pack and bounds stalled update or failed installation", async () => {
  const worker = clientWorker("a", false), registration = { active: worker, update: async () => {} };
  const container = { getRegistration: async () => registration, register: async () => registration };
  assert.equal((await prepareOfflinePack(container, origin, { expectedId: "a".repeat(64) })).ready, true);
  assert.equal(worker.repairs, 1);
  registration.update = async () => new Promise(() => {});
  await assert.rejects(prepareOfflinePack(container, origin, { timeoutMs: 10 }), /timed out/);
  registration.installing = Object.assign(clientWorker(), { state: "redundant" });
  await assert.rejects(prepareOfflinePack(container, origin), /installation failed/);
});
