import test from "node:test";
import assert from "node:assert/strict";
import { Cartesian3, Color, ColorGeometryInstanceAttribute, Event, GeometryInstance, ShowGeometryInstanceAttribute } from "@cesium/core";
import { ClassificationType, GroundPolylineGeometry, PolylineColorAppearance } from "@cesium/engine";
import { createMarkedTrailLayer } from "../src/marked-trail-layer.js";
import { contextualTrailIds, trailColor } from "../src/trail-display.js";

test("marked trail halos and colours share one pickable batch across visibility and emphasis changes", () => {
  class GroundPolylinePrimitive {
    constructor(options) { Object.assign(this, options); this.show = true; this.ready = false; }
    getGeometryInstanceAttributes(id) {
      const { color, show } = this.geometryInstances.find(item => item.id === id).attributes;
      return {
        get color() { return color.value; }, set color(next) { color.value.set(next); },
        get show() { return show.value; }, set show(next) { show.value.set(next); },
      };
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
  const Cesium = { Cartesian3, ClassificationType, Color, ColorGeometryInstanceAttribute, GeometryInstance, ShowGeometryInstanceAttribute,
    GroundPolylineGeometry, GroundPolylinePrimitive, PolylineColorAppearance };
  const layer = createMarkedTrailLayer(Cesium, scene);
  const feature = { properties: { id: "trail-1", colour: "red" }, geometry: {
    coordinates: [[[23.2, 42.5], [23.21, 42.51]], [[23.22, 42.52], [23.23, 42.53]]],
  } };
  const otherFeature = { ...feature, properties: { id: "trail-2", colour: "green" } };
  const data = [feature, otherFeature];
  layer.setFeatures(data);
  const [batch] = batches;
  assert.equal(batch, lowered);
  assert.equal(batch.geometryInstances.length, 8);
  const marking = batch.geometryInstances[4];
  const other = batch.geometryInstances[6];
  picked = marking.id;
  assert.equal(layer.pick({}), null);
  assert.ok(batch.geometryInstances.every(item => item.attributes.show.value[0] === 0));
  batch.ready = true;
  scene.postRender.raiseEvent();
  assert.equal(batch.show, false);
  assert.equal(layer.pick({}), null);
  layer.setStyle(new Set(["trail-1"]), false);
  assert.equal(layer.pick({}), feature);
  assert.equal(marking.attributes.show.value[0], 1);
  assert.equal(other.attributes.show.value[0], 0);
  assert.equal(marking.attributes.color.value[3], 255);
  picked = other.id;
  assert.equal(layer.pick({}), null);
  layer.setStyle(null, true);
  assert.equal(layer.pick({}), otherFeature);
  assert.ok(batch.geometryInstances.every(item => item.attributes.show.value[0] === 1));
  assert.ok(Math.abs(marking.attributes.color.value[3] - 255 * 0.35) <= 1);
  layer.setStyle(new Set(), false);
  assert.equal(layer.pick({}), null);
  assert.equal(batch.show, false);
  layer.setFeatures(data);
  assert.deepEqual([...batches], [batch]);
  layer.destroy();
  assert.equal(batches.size, 0);
});

test("visibility follows the open hut, selected approach or summit and discards shares below fifteen percent", () => {
  const route = (...pairs) => ({ properties: { marked_trails: pairs.map(([trail_id, share]) => ({ trail_id, share })) } });
  const activeRoute = route(["trail-1", 0.95], ["trail-2", 0.149]);
  const summitRoutes = [activeRoute, route(["trail-1", 0.2], ["trail-3", 0.15])];
  const hutRoutes = [route(["trail-4", 0.25], ["trail-2", 0.01])];
  assert.deepEqual([...contextualTrailIds({ summitRoutes: [] })], []);
  assert.deepEqual([...contextualTrailIds({ summitRoutes })], ["trail-1", "trail-3"]);
  assert.deepEqual([...contextualTrailIds({ activeRoute, summitRoutes })], ["trail-1"]);
  assert.deepEqual([...contextualTrailIds({ hutRoutes, activeRoute, summitRoutes })], ["trail-4"]);
  assert.deepEqual([...contextualTrailIds({ hutRoutes: [], activeRoute, summitRoutes })], []);
});

test("trails without a known OSM colour fall back to a neutral grey", () => {
  for (const colour of [null, undefined, "", "magenta", "RED"]) assert.equal(trailColor(colour), "#bac2cb");
  assert.equal(trailColor("red"), "#db4249");
});
