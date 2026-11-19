import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export function sourcePreviewCachePlugin() {
  return {
    name: "source-preview-cache-versions", apply: "build", enforce: "pre",
    resolveId(source, importer) {
      // Cache versions belong to the Python preview, not module identity in a
      // hashed production bundle. Keep one copy of translations and utilities.
      if (!/^(?:\.{1,2}\/|\/src\/).+\.js\?v=vitosha-[a-z0-9-]+$/i.test(source)) return null;
      return this.resolve(source.slice(0, source.indexOf("?")), importer, { skipSelf: true });
    },
  };
}

export default defineConfig(({ command }) => ({
  resolve: {
    alias: { "@vitosha/icons": fileURLToPath(new URL("./src/icons.js", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  // Include the aliased icon entry in the first scan so its React consumers and
  // the renderer share one optimized graph on a cold development start.
  optimizeDeps: { entries: ["index.html", "src/icons.js"], include: ["react", "react-dom/client", "htm"] },
  plugins: [sourcePreviewCachePlugin(), {
    name: "static-python-compatibility",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        // Python serves public/ as a folder; Vite exposes its contents at the root.
        const normalized = html.replaceAll("/public/vendor/", "/vendor/").replaceAll("/public/runtime-config.js", "/runtime-config.js");
        return command === "build" ? normalized.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, "") : normalized;
      },
    },
  }],
  build: { target: "es2022", sourcemap: false },
}));
