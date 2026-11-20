import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateExplorerData } from "../src/explorer-data.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const names = { peaks: "peaks.geojson", huts: "huts.geojson", hutRoutes: "hut-routes.geojson", markedTrails: "marked-trails.geojson", quality: "data-quality.json" };
const dataset = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, file]) => [key, JSON.parse(await readFile(new URL(`../public/data/${file}`, import.meta.url)))])));

const values = [
  "x".repeat(3000), "x".repeat(3001), "😀".repeat(1500), "😀".repeat(1501), "  ", "",
  0, 5, -1, 2.5, true, false, [], ["cash=yes"], Array(80).fill("a"), Array(81).fill("a"), ["x".repeat(250)], ["x".repeat(251)], [" "], [1],
];

function clientAccepts(value) {
  const data = structuredClone(dataset);
  const hut = data.huts.features.find(item => item.properties.details.website);
  hut.properties.details.website.value = value;
  try {
    validateExplorerData(data);
    return true;
  } catch {
    return false;
  }
}

test("the Python builder and validator accept exactly the hut values the browser accepts", () => {
  const python = execFileSync("python", ["-c", `
import json, sys
sys.path.insert(0, "scripts")
from hut_data import valid_detail_value
print(json.dumps([valid_detail_value(value) for value in json.load(sys.stdin)]))
`], { cwd: root, encoding: "utf8", input: JSON.stringify(values), env: { ...process.env, PYTHONUTF8: "1" } });
  assert.deepEqual(JSON.parse(python), values.map(clientAccepts));
  assert.deepEqual(values.map(clientAccepts).slice(0, 4), [true, false, true, false]);
});
