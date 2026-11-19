import test from "node:test";
import assert from "node:assert/strict";
import { Cartesian3, Color, ColorGeometryInstanceAttribute, Event, GeometryInstance } from "@cesium/core";
import { ClassificationType, GroundPolylineGeometry, PolylineColorAppearance } from "@cesium/engine";
import { createMarkedTrailLayer } from "../src/marked-trail-layer.js";

test("marked trail halos and colours share one pickable batch across visibility and emphasis changes", () => {
  class GroundPolylinePrimitive {
    constructor(options) { Object.assign(this, options); this.ready = true; }
    getGeometryInstanceAttributes(id) {
      const attributes = this.geometryInstances.find(item => item.id === id).attributes;
      const values = attributes.color.value;
      return { get color() { return values; }, set color(next) { values.set(next); } };
    }
  }
  const batches = new Set();
  let picked, lowered;
  const scene = {
    postRender: new Event(),
    requestRender() {},
    pick() { return { id: picked }; },
    groundPrimitives: {
      add(item) { batches.add(item); return item; },
      remove(item) { batches.delete(item); },
      lowerToBottom(item) { lowered = item; },
    },
  };
  const Cesium = { Cartesian3, ClassificationType, Color, ColorGeometryInstanceAttribute, GeometryInstance,
    GroundPolylineGeometry, GroundPolylinePrimitive, PolylineColorAppearance };
  const layer = createMarkedTrailLayer(Cesium, scene);
  const feature = { properties: { id: "trail-1", colour: "red" }, geometry: {
    coordinates: [[[23.2, 42.5], [23.21, 42.51]], [[23.22, 42.52], [23.23, 42.53]]],
  } };
  const data = [feature];
  layer.setFeatures(data);
  const [batch] = batches;
  assert.equal(batch, lowered);
  assert.equal(batch.geometryInstances.length, 4);
  const marking = batch.geometryInstances.at(-1);
  picked = marking.id;
  assert.equal(layer.pick({}), feature);
  assert.equal(marking.attributes.color.value[3], 255);
  layer.setStyle(true, true);
  assert.ok(Math.abs(marking.attributes.color.value[3] - 255 * 0.35) <= 1);
  layer.setStyle(false, false);
  assert.equal(layer.pick({}), null);
  assert.equal(batch.show, false);
  layer.setFeatures(data);
  assert.deepEqual([...batches], [batch]);
  layer.destroy();
  assert.equal(batches.size, 0);
});
