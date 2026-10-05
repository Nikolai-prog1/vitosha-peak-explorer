import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const digest = body => createHash("sha256").update(body).digest("hex");
export async function prepareOfflineBundle(directory, workerSource = new URL("../src/offline-worker.js", import.meta.url)) {
  const paths = ["index.html", "data/peaks.geojson", "data/huts.geojson", "data/hut-routes.geojson", "data/data-quality.json", "vendor/fonts/fonts.css", "vendor/cesium/Widgets/widgets.css"];
  for (const file of await readdir(join(directory, "assets"))) if (/^[\w.-]+\.(?:js|css)$/.test(file)) paths.push(`assets/${file}`);
  for (const file of await readdir(join(directory, "vendor/fonts"))) if (/^[\w.-]+\.woff2$/.test(file)) paths.push(`vendor/fonts/${file}`);
  paths.sort();
  const index = (await readFile(join(directory, "index.html"), "utf8")).replace(/<meta name="vitosha-offline-version" content="[a-f0-9]+">\s*/g, "");
  if (!index.includes("</head>")) throw new Error("Offline pack requires a complete HTML head");
  const files = await Promise.all(paths.map(async path => { const body = path === "index.html" ? Buffer.from(index) : await readFile(join(directory, path)); return { path: `/${path}`, bytes: body.length, sha256: digest(body) }; }));
  const id = digest(JSON.stringify(files));
  const html = index.replace("</head>", `<meta name="vitosha-offline-version" content="${id}">\n</head>`);
  await writeFile(join(directory, "index.html"), html);
  const entry = files.find(file => file.path === "/index.html"); entry.bytes = Buffer.byteLength(html); entry.sha256 = digest(html);
  const pack = { schemaVersion: 1, id, files, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
  if (pack.files.length > 80 || pack.bytes > 8 * 1024 * 1024 || pack.files.some(file => file.bytes < 1 || file.bytes > 2 * 1024 * 1024)) throw new Error("Offline planning pack exceeds its budget");
  await writeFile(join(directory, "offline-pack.json"), JSON.stringify(pack, null, 2) + "\n");
  const source = await readFile(workerSource, "utf8");
  await writeFile(join(directory, "offline-worker.js"), `const OFFLINE_PACK = ${JSON.stringify(pack)};\n${source}`);
  console.log(`Prepared opt-in offline facts: ${files.length} owned files, ${pack.bytes} bytes; no imagery, terrain, weather or personal data.`);
  return pack;
}
