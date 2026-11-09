// Assembles the source preview for a static sub-path host such as GitHub Pages.
// GitHub Pages has no forecast proxy or runtime-config endpoint, so it serves the
// explicitly identified source preview (evaluation forecast, public Cesium token)
// instead of the compiled production client, which fails closed without a host.
// Usage: node scripts/build_pages.mjs /<repository>/ [output directory]
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function rebaseSourceHtml(html, base) {
  if (!/^(?:\/[\w.-]+)*\/$/.test(base) || base.split("/").some(segment => segment.startsWith("."))) throw new Error("Base must be an absolute path ending in /");
  return html.replace(/(["'])\/(public|src)\//g, `$1${base}$2/`);
}

export async function buildPages(base, output = join(project, "_site")) {
  await stat(join(project, "public/vendor/cesium/Cesium.js")).catch(() => { throw new Error("Run npm ci first: public/vendor is generated during installation"); });
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const html = rebaseSourceHtml(await readFile(join(project, "index.html"), "utf8"), base);
  await writeFile(join(output, "index.html"), html);
  await cp(join(project, "src"), join(output, "src"), { recursive: true });
  await cp(join(project, "public"), join(output, "public"), { recursive: true });
  // Serve files as-is; Jekyll would otherwise skip some generated vendor files.
  await writeFile(join(output, ".nojekyll"), "");
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base = "/", output] = process.argv.slice(2);
  console.log(`Pages site written to ${await buildPages(base, output && resolve(output))}`);
}
