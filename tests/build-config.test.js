import test from "node:test";
import assert from "node:assert/strict";
import { sourcePreviewCachePlugin } from "../vite.config.js";

test("source preview cache versions do not duplicate production modules or strip semantic queries", async () => {
  const plugin = sourcePreviewCachePlugin();
  assert.equal(plugin.apply, "build"); assert.equal(plugin.enforce, "pre");
  const calls = [], context = { resolve(source, importer, options) { calls.push({ source, importer, options }); return { id: `/resolved/${source}` }; } };
  for (const source of ["./planning.js?v=vitosha-file-exports-20261005-1", "../src/i18n.js?v=vitosha-planning-20261005-2", "/src/app.js?v=vitosha-file-exports-20261005-1"]) {
    const result = await plugin.resolveId.call(context, source, "/src/explorer-app.js");
    assert.equal(result.id, `/resolved/${source.split("?")[0]}`);
    assert.equal(calls.at(-1).options.skipSelf, true);
  }
  for (const source of ["react", "./planning.js", "./text.js?raw", "./text.js?url", "./planning.js?v=other", "./planning.js?v=vitosha-export&raw"]) {
    assert.equal(plugin.resolveId.call(context, source, "/src/explorer-app.js"), null);
  }
  assert.equal(calls.length, 3);
});
