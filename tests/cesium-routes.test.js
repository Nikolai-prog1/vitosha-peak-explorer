import test from "node:test";
import assert from "node:assert/strict";
import { Cartesian3, Color, JulianDate } from "@cesium/core";
import { EntityCollection, PolylineDashMaterialProperty } from "@cesium/engine";
import { createRouteLayer } from "../src/cesium-map.js";

function harness() {
  const added = [];
  const removed = [];
  const writes = [];
  let geometryBuilds = 0;
  const Cesium = {
    Cartesian3: { fromDegreesArray(coordinates) {
      geometryBuilds += 1;
      return [...coordinates];
    } },
    Color: { fromCssColorString: (color) => color },
    PolylineDashMaterialProperty: class { constructor(options) { Object.assign(this, options); } },
  };
  const entities = {
    add(options) {
      const entity = { ...options, polyline: new Proxy(options.polyline, {
        set(target, property, value) {
          writes.push({ id: options.id, property });
          target[property] = value;
          return true;
        },
      }) };
      added.push(entity);
      return entity;
    },
    remove(entity) { removed.push(entity); },
  };
  return { setRoutes: createRouteLayer(Cesium, entities), added, removed, writes,
    get geometryBuilds() { return geometryBuilds; } };
}

function route(id = "cherni--aleko", overrides = {}) {
  return { id, path: [[23.292, 42.582], [23.279, 42.563]], active: true, color: "#ff405f", ...overrides };
}

test("repeated equivalent updates never remove, recreate, or rewrite a route", () => {
  const layer = harness();
  layer.setRoutes([route()]);
  for (let index = 0; index < 100; index += 1) layer.setRoutes([route()]);
  assert.equal(layer.added.length, 1);
  assert.equal(layer.geometryBuilds, 1);
  assert.deepEqual(layer.removed, []);
  assert.deepEqual(layer.writes, []);
  assert.deepEqual(layer.added[0].polyline.positions, [23.292, 42.582, 23.279, 42.563]);
  assert.equal(layer.added[0].polyline.clampToGround, true);
});

test("the real Cesium SDK emits no entity or geometry changes for equivalent UI updates", () => {
  const entities = new EntityCollection();
  const setRoutes = createRouteLayer({ Cartesian3, Color, PolylineDashMaterialProperty }, entities);
  const changes = [];
  entities.collectionChanged.addEventListener((collection, added, removed, changed) => {
    changes.push({ added: added.length, removed: removed.length, changed: changed.length });
  });
  for (const approximate of [false, true]) {
    const candidate = route(approximate ? "rezen--aleko" : "cherni--aleko", { approximate });
    setRoutes([candidate]);
    const entity = entities.getById(`route:${candidate.id}`);
    const positions = entity.polyline.positions;
    const material = entity.polyline.material;
    const definitions = [];
    entity.definitionChanged.addEventListener((changedEntity, property) => definitions.push(property));
    const changeCount = changes.length;
    for (let update = 0; update < 100; update++) {
      // React state updates may produce fresh candidate and coordinate objects.
      setRoutes([structuredClone(candidate)]);
    }
    assert.equal(entities.values.length, 1);
    assert.equal(entities.getById(entity.id), entity);
    assert.equal(entity.polyline.positions, positions);
    assert.equal(entity.polyline.material, material);
    assert.equal(positions.isConstant, true);
    assert.equal(entity.polyline.clampToGround.getValue(JulianDate.now()), true);
    assert.equal(changes.length, changeCount);
    assert.deepEqual(definitions, []);
  }
});

test("active width and color update in place without rebuilding coordinates", () => {
  const layer = harness();
  layer.setRoutes([route()]);
  const entity = layer.added[0];
  layer.setRoutes([route(undefined, { active: false, color: "#ffd166" })]);
  assert.equal(layer.added.length, 1);
  assert.equal(layer.geometryBuilds, 1);
  assert.deepEqual(layer.removed, []);
  assert.equal(entity.polyline.width, 4.5);
  assert.equal(entity.polyline.material, "#ffd166");
  assert.deepEqual(layer.writes.map((write) => write.property), ["width", "material"]);
});

test("approximate sketches are dashed and equivalent updates keep both entity and material stable", () => {
  const layer = harness(); layer.setRoutes([route(undefined, { approximate: true })]);
  const entity = layer.added[0], material = entity.polyline.material;
  assert.equal(material.dashLength, 18);
  for (let index = 0; index < 100; index++) layer.setRoutes([route(undefined, { approximate: true })]);
  assert.equal(entity.polyline.material, material); assert.deepEqual(layer.writes, []);
  layer.setRoutes([route(undefined, { approximate: false })]);
  assert.equal(layer.geometryBuilds, 1); assert.equal(layer.added.length, 1);
  assert.equal(entity.polyline.material, "#ff405f");
});

test("only a changed path gets new positions; its entity stays stable", () => {
  const layer = harness();
  const candidate = route();
  layer.setRoutes([candidate]);
  candidate.path[1][0] = 23.280;
  layer.setRoutes([candidate]);
  assert.equal(layer.added.length, 1);
  assert.equal(layer.geometryBuilds, 2);
  assert.deepEqual(layer.removed, []);
  assert.deepEqual(layer.writes.map((write) => write.property), ["positions"]);
  assert.equal(layer.added[0].polyline.positions[2], 23.280);
});

test("single/all/single transitions preserve retained routes and remove only hidden ones", () => {
  const layer = harness();
  layer.setRoutes([route()]);
  const alekoEntity = layer.added[0];
  layer.setRoutes([route(undefined, { active: false }), route("cherni--pogledets", { active: false })]);
  const pogledetsEntity = layer.added[1];
  layer.setRoutes([route()]);
  assert.equal(layer.added.length, 2);
  assert.equal(layer.geometryBuilds, 2);
  assert.deepEqual(layer.removed, [pogledetsEntity]);
  assert.equal(alekoEntity.polyline.width, 6);
  layer.setRoutes([]);
  assert.deepEqual(layer.removed, [pogledetsEntity, alekoEntity]);
  layer.setRoutes([]);
  assert.equal(layer.removed.length, 2);
});

test("invalid short paths cannot leave an old route visible", () => {
  const layer = harness();
  layer.setRoutes([route()]);
  layer.setRoutes([route(undefined, { path: [[23.292, 42.582]] })]);
  assert.equal(layer.added.length, 1);
  assert.deepEqual(layer.removed, [layer.added[0]]);
});

test("switching summits cannot reuse a route with the same hut but a different route ID", () => {
  const layer = harness();
  layer.setRoutes([route()]);
  layer.setRoutes([route("rezen--aleko")]);
  assert.equal(layer.added.length, 2);
  assert.notEqual(layer.added[0].id, layer.added[1].id);
  assert.deepEqual(layer.removed, [layer.added[0]]);
});
