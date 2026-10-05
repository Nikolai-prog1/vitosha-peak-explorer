import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { brotliCompress, gzip, constants } from "node:zlib";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
export const RUNTIME_FILES = Object.freeze([
  "server/app.js", "server/config.js", "server/index.js", "server/weather.js",
  "src/config.js", "src/weather.js", "src/requests.js", "scripts/check_release.mjs",
  "package.json", "package-lock.json",
]);

export function releaseContentId(clientContentId, hostContentId) {
  return createHash("sha256").update(`${clientContentId}:${hostContentId}`).digest("hex");
}

export async function inspectRuntime(directory = project) {
  const files = [];
  const digest = createHash("sha256");
  for (const path of [...RUNTIME_FILES].sort()) {
    const buffer = await readFile(join(directory, path));
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    files.push({ path, bytes: buffer.length, sha256 });
    digest.update(`${path}\0${sha256}\n`);
  }
  return { contentId: digest.digest("hex"), files };
}

async function walk(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Release symlink is not allowed: ${path}`);
    if (entry.isDirectory()) files.push(...await walk(join(directory, entry.name), `${path}/`));
    else if (entry.isFile() && path !== "release-manifest.json") files.push(path);
  }
  return files.sort();
}

export async function inspectRelease(directory) {
  const html = await readFile(join(directory, "index.html"), "utf8");
  if (/<script\b[^>]*type=["']importmap["']/i.test(html)) throw new Error("Production HTML must use the bundled application, not source import maps");
  const critical = ["data/peaks.geojson", "data/huts.geojson", "data/hut-routes.geojson", "data/data-quality.json", "vendor/cesium/Cesium.js", "vendor/cesium/Widgets/widgets.css", "vendor/fonts/fonts.css", "runtime-config.js"];
  for (const [, tag, attributes] of html.matchAll(/<(script|link)\b([^>]+)>/gi)) {
    if (tag.toLowerCase() === "link" && !/rel=["']stylesheet["']/i.test(attributes)) continue;
    const url = attributes.match(/(?:src|href)=["']([^"']+)["']/i)?.[1];
    if (!url || !url.startsWith("/") || url.startsWith("//")) throw new Error("External or missing executable/style URL in release HTML");
    const path = url.split("?")[0].slice(1);
    if (path.split("/").some(segment => segment.startsWith(".")) || path.includes("\\")) throw new Error("Unsafe release asset path");
    critical.push(path);
  }
  for (const file of critical) if (!(await stat(join(directory, file))).isFile()) throw new Error(`Missing release asset: ${file}`);

  // Old rollback releases have no offline marker. A release advertising a pack
  // must include one complete, bounded catalog matching both HTML and worker.
  if (/name=["']vitosha-offline-version["']/i.test(html)) {
    const versions = [...html.matchAll(/<meta name="vitosha-offline-version" content="([a-f0-9]{64})">/g)];
    const pack = JSON.parse(await readFile(join(directory, "offline-pack.json"), "utf8"));
    const allowed = path => path === "/index.html" || /^\/data\/(?:peaks|huts|hut-routes)\.geojson$/.test(path) || path === "/data/data-quality.json"
      || /^\/assets\/[\w.-]+\.(?:js|css)$/.test(path) || /^\/vendor\/fonts\/[\w.-]+\.(?:css|woff2)$/.test(path) || path === "/vendor/cesium/Widgets/widgets.css";
    if (versions.length !== 1 || pack.schemaVersion !== 1 || pack.id !== versions[0][1] || !Array.isArray(pack.files) || pack.files.length > 80
      || new Set(pack.files.map(file => file.path)).size !== pack.files.length
      || !Number.isSafeInteger(pack.bytes) || pack.bytes > 8 * 1024 * 1024
      || pack.files.some(file => !allowed(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 2 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(file.sha256))
      || pack.bytes !== pack.files.reduce((sum, file) => sum + file.bytes, 0)
      || ["index.html", ...critical.filter(path => path !== "runtime-config.js" && path !== "vendor/cesium/Cesium.js")].some(path => !pack.files.some(file => file.path === `/${path}`))) throw new Error("Invalid offline release catalog");
    for (const file of pack.files) {
      const buffer = await readFile(join(directory, file.path.slice(1)));
      if (buffer.length !== file.bytes || createHash("sha256").update(buffer).digest("hex") !== file.sha256) throw new Error(`Offline release integrity failed: ${file.path}`);
    }
    const worker = await readFile(join(directory, "offline-worker.js"), "utf8");
    if (!worker.startsWith(`const OFFLINE_PACK = ${JSON.stringify(pack)};\n`)) throw new Error("Offline worker catalog does not match this release");
  }

  const files = [];
  const digest = createHash("sha256");
  for (const path of await walk(directory)) {
    const buffer = await readFile(join(directory, path));
    if (/(?:^|\/)\.env(?:\.|$)/i.test(path)) throw new Error("Environment files must never be part of the client release");
    if (/\.(?:m?js)$/.test(path) && /\b(?:from|import)\s*["']https?:\/\//.test(buffer.toString("utf8"))) throw new Error(`External executable import in ${path}`);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    files.push({ path, bytes: buffer.length, sha256 });
    digest.update(`${path}\0${sha256}\n`);
  }
  return { contentId: digest.digest("hex"), files };
}

async function prepareRelease() {
  const directory = join(project, "dist");
  const initial = await inspectRelease(directory);
  for (const file of initial.files) {
    if (file.bytes < 1024 || !/\.(?:js|mjs|css|json|geojson|svg|html|txt)$/.test(file.path)) continue;
    const buffer = await readFile(join(directory, file.path));
    const [br, gz] = await Promise.all([brotli(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }), gzipAsync(buffer, { level: 9 })]);
    await Promise.all([writeFile(join(directory, `${file.path}.br`), br), writeFile(join(directory, `${file.path}.gz`), gz)]);
  }
  const report = await inspectRelease(directory);
  const host = await inspectRuntime();
  const manifest = JSON.parse(await readFile(join(project, "package.json"), "utf8"));
  const contentId = releaseContentId(report.contentId, host.contentId);
  await writeFile(join(directory, "release-manifest.json"), JSON.stringify({ schemaVersion: 2, version: manifest.version, builtAt: new Date().toISOString(),
    contentId, clientContentId: report.contentId, hostContentId: host.contentId, files: report.files, runtimeFiles: host.files }, null, 2) + "\n");
  console.log(`Release ${contentId.slice(0, 16)} verified: ${report.files.length} local client files and ${host.files.length} host files, no executable CDN dependencies.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { prepareOfflineBundle } = await import("./prepare_offline.mjs");
  await prepareOfflineBundle(join(project, "dist"));
  await prepareRelease();
}
