// Build injects OFFLINE_PACK. No provider requests, forecasts or private state
// are intercepted or archived by this worker.
const PREFIX = "vitosha-offline-v1-", CACHE = PREFIX + OFFLINE_PACK.id;
const META = "/__vitosha_offline_ready__";
const allowed = path => path === "/index.html" || /^\/data\/(?:peaks|huts|hut-routes)\.geojson$/.test(path) || path === "/data/data-quality.json"
  || /^\/assets\/[\w.-]+\.(?:js|css)$/.test(path) || /^\/vendor\/fonts\/[\w.-]+\.(?:css|woff2)$/.test(path) || path === "/vendor/cesium/Widgets/widgets.css";
if (OFFLINE_PACK.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(OFFLINE_PACK.id) || !Array.isArray(OFFLINE_PACK.files)
  || OFFLINE_PACK.files.length > 80 || OFFLINE_PACK.bytes > 8 * 1024 * 1024
  || OFFLINE_PACK.files.some(file => !allowed(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 2 * 1024 * 1024)
  || new Set(OFFLINE_PACK.files.map(file => file.path)).size !== OFFLINE_PACK.files.length
  || !Number.isSafeInteger(OFFLINE_PACK.bytes) || OFFLINE_PACK.bytes !== OFFLINE_PACK.files.reduce((sum, file) => sum + file.bytes, 0)
  || !["/index.html", "/data/peaks.geojson", "/data/huts.geojson", "/data/hut-routes.geojson", "/data/data-quality.json"].every(path => OFFLINE_PACK.files.some(file => file.path === path))
  || !OFFLINE_PACK.files.some(file => /^\/assets\/.+\.js$/.test(file.path))) throw new Error("Invalid offline facts pack");
const files = new Set(OFFLINE_PACK.files.map(file => file.path));
async function completeFetch(request, timeout = 10000, maxBytes = 2 * 1024 * 1024) {
  const controller = new AbortController(); let reader;
  const timer = setTimeout(() => { controller.abort(); reader?.cancel().catch(() => {}); }, timeout);
  try {
    const response = await fetch(request, { signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error" });
    if (response.type === "opaque") throw new Error("Offline asset unavailable");
    const chunks = []; let size = 0;
    if (response.body) {
      reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new Error("Offline asset too large"); }
        chunks.push(value);
      }
    }
    if (controller.signal.aborted) throw new Error("Offline asset timed out");
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    // Fetch has already decoded HTTP compression. Do not attach the original
    // encoding/length to the reconstructed, complete response.
    const headers = new Headers(response.headers); headers.delete("Content-Encoding"); headers.delete("Content-Length");
    return { body, response: new Response([204, 205, 304].includes(response.status) ? null : body, { headers, status: response.status, statusText: response.statusText }) };
  } finally { clearTimeout(timer); reader?.releaseLock(); }
}
async function ready() {
  const cache = await caches.open(CACHE), response = await cache.match(META);
  if (!response) return null;
  const meta = await response.json().catch(() => null);
  if (meta?.id !== OFFLINE_PACK.id || meta.bytes !== OFFLINE_PACK.bytes || !Number.isFinite(Date.parse(meta.preparedAt))) return null;
  for (const file of OFFLINE_PACK.files) if (!await cache.match(file.path)) return null;
  return meta;
}
async function prepare() {
  if (await ready()) return;
  const cache = await caches.open(CACHE);
  try {
    let next = 0, failure;
    await Promise.all(Array.from({ length: Math.min(4, OFFLINE_PACK.files.length) }, async () => {
      try {
      while (next < OFFLINE_PACK.files.length) {
        if (failure) return;
        const file = OFFLINE_PACK.files[next++], { response, body } = await completeFetch(file.path, 10000, file.bytes);
        if (!response.ok) throw new Error("Offline asset unavailable");
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))].map(byte => byte.toString(16).padStart(2, "0")).join("");
        if (body.byteLength !== file.bytes || hash !== file.sha256) throw new Error("Offline asset integrity failed");
        await cache.put(file.path, response);
      }
      } catch (error) { failure ||= error; }
    }));
    if (failure) throw failure;
    await cache.put(META, new Response(JSON.stringify({ id: OFFLINE_PACK.id, preparedAt: new Date().toISOString(), bytes: OFFLINE_PACK.bytes }), { headers: { "Content-Type": "application/json" } }));
  } catch (error) { await caches.delete(CACHE); throw error; }
}
let preparation;
function ensurePrepared() {
  if (!preparation) preparation = prepare().finally(() => { preparation = null; });
  return preparation;
}
self.addEventListener("install", event => event.waitUntil(ensurePrepared().then(() => { if (!self.registration.active) return self.skipWaiting(); })));
self.addEventListener("activate", event => event.waitUntil((async () => {
  const previous = [];
  for (const name of await caches.keys()) if (name !== CACHE && /^vitosha-offline-v1-[a-f0-9]{64}$/.test(name)) {
    const response = await (await caches.open(name)).match(META);
    const meta = response ? await response.json().catch(() => null) : null;
    previous.push({ name, time: Date.parse(meta?.preparedAt) || 0 });
  }
  previous.sort((a, b) => b.time - a.time);
  await Promise.all(previous.slice(1).map(item => caches.delete(item.name)));
  await self.clients.claim();
})()));
self.addEventListener("message", event => {
  if (["VITOSHA_OFFLINE_STATUS", "VITOSHA_OFFLINE_PREPARE"].includes(event.data?.type)) event.waitUntil((async () => {
    try {
      if (event.data.type === "VITOSHA_OFFLINE_PREPARE") await ensurePrepared();
      const meta = await ready();
      event.ports[0]?.postMessage({ type: "VITOSHA_OFFLINE_STATUS", ready: Boolean(meta), id: OFFLINE_PACK.id, preparedAt: meta?.preparedAt || null, bytes: OFFLINE_PACK.bytes });
    } catch { event.ports[0]?.postMessage({ type: "VITOSHA_OFFLINE_STATUS", ready: false, id: OFFLINE_PACK.id, preparedAt: null, bytes: OFFLINE_PACK.bytes }); }
  })());
  if (event.data?.type === "VITOSHA_OFFLINE_ACTIVATE") event.waitUntil(self.skipWaiting());
});
async function networkOrCached(request, path) {
  try {
    const { response } = await completeFetch(request, 3500);
    if (response.ok || response.status < 500) return response;
  } catch { /* A local, versioned fallback is deliberately limited below. */ }
  const cached = await (await caches.open(CACHE)).match(path);
  if (!cached) return new Response("Offline facts unavailable / Офлайн данните липсват", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return cached;
}
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/runtime-config.js") {
    event.respondWith(completeFetch(request, 3500, 64 * 1024).then(({ response }) => { if (!response.ok) throw new Error(); return response; }).catch(() => new Response('window.__VITOSHA_CONFIG__ = {offlineLaunch:true, weatherMode:"disabled", evaluation:false};\n', { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" } })));
  } else if (request.mode === "navigate" && ["/", "/index.html"].includes(url.pathname)) event.respondWith(networkOrCached(request, "/index.html"));
  else if (files.has(url.pathname) && !url.search) {
    // Public data is network-first: an old worker must not silently pin newer
    // online clients to an earlier dataset. Hashed code/fonts are immutable.
    event.respondWith(url.pathname.startsWith("/data/") ? networkOrCached(request, url.pathname)
      : caches.open(CACHE).then(async cache => await cache.match(url.pathname) || (await completeFetch(request)).response));
  }
});
