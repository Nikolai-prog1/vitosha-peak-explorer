import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { publicConfig, readConfig } from "./config.js";
import { createWeatherService, ServiceError } from "./weather.js";
import { inspectRelease, inspectRuntime, releaseContentId } from "../scripts/check_release.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".geojson": "application/geo+json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm", ".ktx2": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
};
const CSP = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'", "font-src 'self'", "img-src 'self' data: blob: https://*.cesium.com https://*.virtualearth.net https://*.bing.com",
  "connect-src 'self' https://*.cesium.com https://*.virtualearth.net https://*.bing.com",
  "upgrade-insecure-requests",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");

function json(response, status, value, head = false) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  response.end(head ? undefined : body);
}

export function createLimiter({ limit = 120, intervalMs = 60000, maxClients = 1000, now = Date.now } = {}) {
  const clients = new Map();
  return (key) => {
    const time = now();
    if (clients.size >= maxClients) for (const [id, item] of clients) if (item.until <= time) clients.delete(id);
    let item = clients.get(key);
    if (!item || item.until <= time) {
      if (!item && clients.size >= maxClients) return false;
      item = { until: time + intervalMs, count: 0 };
      clients.set(key, item);
    }
    item.count += 1;
    return item.count <= limit;
  };
}

function requestPath(raw) {
  if (!raw?.startsWith("/") || raw.startsWith("//") || raw.length > 2048) throw new ServiceError(400, "INVALID_PATH");
  let path;
  try { path = decodeURIComponent(raw.split("?")[0]); }
  catch { throw new ServiceError(400, "INVALID_PATH"); }
  if (/[\\:\u0000-\u001f]/.test(path)) throw new ServiceError(400, "INVALID_PATH");
  if (path.split("/").some(segment => segment.startsWith("."))) throw new ServiceError(404, "NOT_FOUND");
  return path;
}

function acceptsEncoding(header, encoding) {
  return (header || "").split(",").some(item => {
    const [name, ...parameters] = item.trim().split(";");
    const quality = parameters.find(value => value.trim().startsWith("q="));
    return name === encoding && (!quality || Number(quality.trim().slice(2)) > 0);
  });
}

export async function createExplorerServer({ root, config = readConfig(), fetchImpl = fetch, now = Date.now, rateLimit = 120 } = {}) {
  const directory = await realpath(resolve(root || "dist"));
  const index = await readFile(resolve(directory, "index.html"));
  let verifiedRelease;
  if (config.production) {
    const expected = JSON.parse(await readFile(resolve(directory, "release-manifest.json"), "utf8"));
    const [client, host] = await Promise.all([inspectRelease(directory), inspectRuntime()]);
    verifiedRelease = { contentId: releaseContentId(client.contentId, host.contentId) };
    if (expected.schemaVersion !== 2 || expected.clientContentId !== client.contentId || expected.hostContentId !== host.contentId
      || expected.contentId !== verifiedRelease.contentId) throw new Error("Release integrity check failed; rebuild or restore the release artifact");
  }
  const peaksFile = JSON.parse(await readFile(resolve(directory, "data/peaks.geojson"), "utf8"));
  if (!Array.isArray(peaksFile.features) || !peaksFile.features.length) throw new Error("Release has no summit data");
  const weather = createWeatherService({ peaks: peaksFile.features, mode: config.weatherMode, apiKey: config.weatherApiKey, fetchImpl, now });
  const limitWeather = createLimiter({ limit: rateLimit, now });
  const started = now();
  const releaseId = (verifiedRelease?.contentId || createHash("sha256").update(index).digest("hex")).slice(0, 16);
  const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (config.publicOrigin) allowedHosts.add(new URL(config.publicOrigin).hostname);
  let draining = false;

  const server = createServer({ maxHeaderSize: 16384 }, async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", CSP);
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (config.publicOrigin?.startsWith("https:")) response.setHeader("Strict-Transport-Security", "max-age=31536000");
    const head = request.method === "HEAD";
    try {
      let host;
      try {
        const address = new URL(`http://${request.headers.host}`);
        if (address.username || address.password || address.pathname !== "/" || address.search || address.hash) throw new Error();
        host = address.hostname;
      } catch { throw new ServiceError(400, "INVALID_HOST"); }
      if (!allowedHosts.has(host)) throw new ServiceError(421, "INVALID_HOST");
      if (!head && request.method !== "GET") { response.setHeader("Allow", "GET, HEAD"); throw new ServiceError(405, "METHOD_NOT_ALLOWED"); }
      if (request.headers["transfer-encoding"] || Number(request.headers["content-length"] || 0) !== 0) {
        response.setHeader("Connection", "close");
        throw new ServiceError(400, "REQUEST_BODY_NOT_ALLOWED");
      }
      const path = requestPath(request.url);
      if (path === "/api/health") return json(response, draining ? 503 : 200, {
        ok: !draining, releaseId, uptimeSeconds: Math.max(0, Math.floor((now() - started) / 1000)),
        summitCount: peaksFile.features.length, weather: weather.status().mode,
      }, head);
      if (draining) throw new ServiceError(503, "SHUTTING_DOWN");
      if (path === "/api/config") return json(response, 200, publicConfig(config), head);
      if (path === "/runtime-config.js") {
        const body = `window.__VITOSHA_CONFIG__ = ${JSON.stringify(publicConfig(config))};\n`;
        response.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
        return response.end(head ? undefined : body);
      }
      if (path.startsWith("/api/weather/")) {
        if (request.url.includes("?") || !/^\/api\/weather\/peak-\d+$/.test(path)) throw new ServiceError(400, "INVALID_PEAK_REQUEST");
        if (request.headers["sec-fetch-site"] === "cross-site") throw new ServiceError(403, "CROSS_SITE_REQUEST");
        // Do not trust forwarded headers from an arbitrary client. The edge proxy
        // must also enforce a per-client limit when all users share its socket IP.
        if (!limitWeather(request.socket.remoteAddress || "unknown")) {
          response.setHeader("Retry-After", "60");
          throw new ServiceError(429, "RATE_LIMITED");
        }
        const forecast = await weather.getForecast(path.slice("/api/weather/".length));
        return json(response, 200, forecast, head);
      }
      if (path.startsWith("/api/")) throw new ServiceError(404, "NOT_FOUND");

      const relative = path === "/" ? "index.html" : path.slice(1);
      const target = resolve(directory, relative);
      if (!target.startsWith(directory + sep)) throw new ServiceError(404, "NOT_FOUND");
      const canonical = await realpath(target);
      if (!canonical.startsWith(directory + sep)) throw new ServiceError(404, "NOT_FOUND");
      const contentType = MIME[extname(canonical).toLowerCase()];
      if (!contentType) throw new ServiceError(404, "NOT_FOUND");
      const original = await stat(canonical);
      if (!original.isFile()) throw new ServiceError(404, "NOT_FOUND");
      const etag = `W/"${original.size.toString(16)}-${Math.trunc(original.mtimeMs).toString(16)}"`;
      const immutable = /^assets\/.+-[\w-]{8,}\.(js|css|woff2?)$/.test(relative);
      response.setHeader("Cache-Control", ["index.html", "offline-worker.js", "offline-pack.json"].includes(relative) ? "no-cache" : immutable ? "public, max-age=31536000, immutable" : "public, max-age=300, must-revalidate");
      response.setHeader("ETag", etag);
      response.setHeader("Vary", "Accept-Encoding");
      response.setHeader("Content-Type", contentType);
      if ((request.headers["if-none-match"] || "").split(",").map(item => item.trim()).some(item => item === etag || item === "*")) {
        response.writeHead(304);
        return response.end();
      }
      let file = canonical;
      let size = original.size;
      for (const [encoding, suffix] of [["br", ".br"], ["gzip", ".gz"]]) {
        if (!acceptsEncoding(request.headers["accept-encoding"], encoding)) continue;
        try {
          const compressed = await realpath(canonical + suffix);
          if (!compressed.startsWith(directory + sep)) continue;
          const compressedStat = await stat(compressed);
          if (!compressedStat.isFile() || compressedStat.mtimeMs < original.mtimeMs) continue;
          file = compressed; size = compressedStat.size;
          response.setHeader("Content-Encoding", encoding);
          break;
        } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      response.setHeader("Content-Length", size);
      response.writeHead(200);
      if (head) return response.end();
      await pipeline(createReadStream(file), response);
    } catch (error) {
      if (response.headersSent || response.destroyed) { response.destroy(); return; }
      const missing = ["ENOENT", "ENOTDIR", "EACCES"].includes(error.code);
      const status = error instanceof ServiceError ? error.status : missing ? 404 : 500;
      json(response, status, { error: error instanceof ServiceError ? error.code : missing ? "NOT_FOUND" : "INTERNAL_ERROR" }, head);
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 80;
  server.maxRequestsPerSocket = 100;

  let closePromise;
  return {
    server,
    async listen(port = config.port, host = config.host) {
      await new Promise((resolveListen, reject) => {
        const failed = (error) => { server.off("listening", ready); reject(error); };
        const ready = () => { server.off("error", failed); resolveListen(); };
        server.once("error", failed); server.once("listening", ready); server.listen(port, host);
      });
      return server.address();
    },
    close() {
      if (closePromise) return closePromise;
      draining = true;
      closePromise = new Promise((resolveClose, reject) => {
        const deadline = setTimeout(() => server.closeAllConnections(), 15000);
        deadline.unref();
        server.close((error) => { clearTimeout(deadline); error ? reject(error) : resolveClose(); });
        server.closeIdleConnections();
      });
      return closePromise;
    },
  };
}
