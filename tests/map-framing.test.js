import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BoundingSphere, Cartesian2, Cartesian3, Cartesian4, Ellipsoid, FixedFrameTransforms, GeographicProjection, Matrix4 } from "@cesium/core";
import { Camera, SceneMode } from "@cesium/engine";
import { availableMapViewport, cameraFramePose, createFrameScheduler, placeFramePoint, routeFramePoints } from "../src/map-framing.js";

const Cesium = { BoundingSphere, Cartesian3, FixedFrameTransforms, Matrix4 };
const near = (actual, expected, tolerance = 0.0001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const desktopPanels = [{ left: 18, top: 18, right: 328, bottom: 702 }, { left: 890, top: 18, right: 1262, bottom: 702 }, { left: 390, top: 674, right: 875, bottom: 707 }];
const mobilePanels = [{ left: 10, top: 10, right: 380, bottom: 72 }, { left: 0, top: 456, right: 390, bottom: 844 }, { left: 6, top: 432, right: 380, bottom: 452 }];

function realCamera(width, height) {
  const scene = { canvas: { clientWidth: width, clientHeight: height }, drawingBufferWidth: width, drawingBufferHeight: height,
    mapProjection: new GeographicProjection(Ellipsoid.WGS84), ellipsoid: Ellipsoid.WGS84,
    mode: SceneMode.SCENE3D, _frameState: { mode: SceneMode.SCENE3D }, screenSpaceCameraController: { minimumZoomDistance: 100, maximumZoomDistance: 400000 } };
  const camera = new Camera(scene); scene.camera = camera;
  return camera;
}

function project(camera, point, width, height) {
  const view = Matrix4.multiplyByPoint(camera.viewMatrix, point, new Cartesian3());
  const clip = Matrix4.multiplyByVector(camera.frustum.projectionMatrix, new Cartesian4(view.x, view.y, view.z, 1), new Cartesian4());
  return { x: (clip.x / clip.w + 1) * width / 2, y: (1 - clip.y / clip.w) * height / 2, depth: -view.z };
}

function apply(camera, pose) {
  camera.setView({ destination: pose.destination, orientation: { direction: pose.direction, up: pose.up }, endTransform: Matrix4.IDENTITY });
}

test("available map area excludes real panels, footer, mobile header and attribution", () => {
  for (const [width, height, panels] of [[1280, 720, desktopPanels], [390, 844, mobilePanels], [1024, 768, [{ left: 18, top: 18, right: 304, bottom: 750 }, { left: 664, top: 18, right: 1006, bottom: 750 }]]]) {
    const viewport = availableMapViewport(width, height, panels);
    assert.ok(viewport);
    assert.equal(viewport.width, width); assert.equal(viewport.height, height);
    assert.ok(viewport.right - viewport.left >= 160 && viewport.bottom - viewport.top >= 80);
    panels.forEach(panel => assert.equal(intersects(viewport, panel), false));
  }
  assert.equal(availableMapViewport(390, 844, [{ left: 0, top: 0, right: 390, bottom: 844 }]), null);
  assert.equal(availableMapViewport(0, 844), null);
  assert.equal(availableMapViewport(Infinity, 844), null);
  const empty = availableMapViewport(390, 844, [null, { left: NaN }, { left: -100, top: -100, right: -10, bottom: -10 }]);
  assert.deepEqual(empty, { left: 12, right: 378, top: 12, bottom: 832, width: 390, height: 844 });
});

test("route framing retains modelled profile heights and includes actual hut/summit beyond endpoint gaps", () => {
  const hut = { geometry: { coordinates: [23.292, 42.582] }, properties: { elevation_m: 1810 } };
  const summit = { geometry: { coordinates: [23.279, 42.563] }, properties: { elevation_m: 2290 } };
  const entry = { feature: hut, path: [[23.29, 42.58], [23.28, 42.564]], routeFeature: { properties: { profile_elevations_m: [1820, 2250] } } };
  assert.deepEqual(routeFramePoints([entry], summit), [[23.29, 42.58, 1820], [23.28, 42.564, 2250], [23.292, 42.582, 1824], [23.279, 42.563, 2304]]);
  const sketch = routeFramePoints([{ ...entry, routeFeature: null }], summit);
  assert.equal(sketch.length, 4); assert.ok(sketch.every(point => point.every(Number.isFinite)));
  assert.deepEqual(routeFramePoints([{ path: [] }, null], summit), []);
  assert.equal(placeFramePoint({ geometry: { coordinates: [23, 100] } }), null);
});

test("real Cesium projection and picking agree with off-center free-area framing without changing the frustum", () => {
  for (const [width, height, panels] of [[1280, 720, desktopPanels], [390, 844, mobilePanels]]) {
    const viewport = availableMapViewport(width, height, panels), camera = realCamera(width, height);
    const pose = cameraFramePose(Cesium, [[23.279, 42.563, 2304]], viewport, camera.frustum, { minimumRange: 2800, pitch: -28 });
    apply(camera, pose);
    const pixel = project(camera, pose.center, width, height);
    near(pixel.x, pose.centerX); near(pixel.y, pose.centerY);
    near(Cartesian3.dot(camera.directionWC, camera.upWC), 0);
    near(Cartesian3.magnitude(camera.directionWC), 1);
    assert.equal(camera.frustum.xOffset, 0); assert.equal(camera.frustum.yOffset, 0);
    const ray = camera.getPickRay(new Cartesian2(pixel.x, pixel.y));
    const toPoint = Cartesian3.normalize(Cartesian3.subtract(pose.center, ray.origin, new Cartesian3()), new Cartesian3());
    assert.ok(Cartesian3.distance(toPoint, ray.direction) < 1e-9);
  }
});

test("all 51 real lines plus markers and the 17-summit overview fit the free area in the pinned SDK", async () => {
  const load = async name => JSON.parse(await readFile(new URL(`../public/data/${name}.geojson`, import.meta.url), "utf8")).features;
  const [peaks, huts, routes] = await Promise.all([load("peaks"), load("huts"), load("hut-routes")]);
  const entries = routes.map(route => ({ path: route.geometry.coordinates[0], routeFeature: route, feature: huts.find(hut => hut.properties.id === route.properties.hut_id) }));
  const scenarios = [[1280, 720, desktopPanels], [390, 844, mobilePanels], [390, 844, [{ left: 10, top: 10, right: 380, bottom: 72 }, { left: 10, top: 776, right: 220, bottom: 834 }, { left: 6, top: 748, right: 380, bottom: 772 }]]];
  for (const [width, height, panels] of scenarios) {
    const camera = realCamera(width, height), viewport = availableMapViewport(width, height, panels);
    const check = points => {
      const pose = cameraFramePose(Cesium, points, viewport, camera.frustum);
      assert.ok(pose && Number.isFinite(pose.range) && pose.range < 200000);
      apply(camera, pose);
      for (const point of points) {
        const pixel = project(camera, Cartesian3.fromDegrees(...point), width, height);
        assert.ok(pixel.depth > 0);
        assert.ok(pixel.x >= pose.fit.left - 0.001 && pixel.x <= pose.fit.right + 0.001 && pixel.y >= pose.fit.top - 0.001 && pixel.y <= pose.fit.bottom + 0.001,
          `${width}×${height}: ${point} projects outside ${JSON.stringify(pose.fit)}: ${JSON.stringify(pixel)}`);
      }
    };
    check(peaks.map(placeFramePoint));
    entries.forEach(entry => check(routeFramePoints([entry], peaks.find(peak => peak.properties.id === entry.routeFeature.properties.peak_id))));
    peaks.forEach(peak => check(routeFramePoints(entries.filter(entry => entry.routeFeature.properties.peak_id === peak.properties.id), peak)));
  }
});

function schedulerHarness() {
  let viewport = availableMapViewport(1280, 720, desktopPanels), nextId = 0;
  const pending = new Map(), applied = [];
  const scheduler = createFrameScheduler({ readViewport: () => viewport, applyFrame: frame => applied.push(frame),
    requestFrame: callback => { const id = nextId++; pending.set(id, callback); return id; }, cancelFrame: id => pending.delete(id) });
  return { scheduler, applied, pending, setViewport(next) { viewport = next; }, tick() { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback()); } };
}

test("framing coalesces selection/layout changes after the UI commit and never replays stale selections", () => {
  const h = schedulerHarness();
  h.scheduler.request([[23, 42, 1000]], {}, 1.2);
  h.scheduler.request([[23.1, 42.1, 2000]], {}, 1.2);
  for (let index = 0; index < 50; index++) h.scheduler.layoutChanged();
  assert.equal(h.pending.size, 1); h.tick();
  assert.equal(h.applied.length, 1); assert.equal(h.applied[0].points[0][0], 23.1);
  for (let index = 0; index < 50; index++) { h.scheduler.layoutChanged(); h.tick(); }
  assert.equal(h.applied.length, 1);
  h.setViewport(availableMapViewport(390, 844, mobilePanels)); h.scheduler.layoutChanged(); h.tick();
  assert.equal(h.applied.length, 2); assert.equal(h.applied[1].duration, 0.4);
});

test("manual gestures and destruction cancel queued framing; resizing does not reset a manually explored view", () => {
  const h = schedulerHarness();
  h.scheduler.request([[23, 42]]); h.scheduler.interrupt(); h.tick();
  assert.equal(h.applied.length, 0); assert.equal(h.pending.size, 0);
  h.setViewport(availableMapViewport(390, 844, mobilePanels)); h.scheduler.layoutChanged(); h.tick();
  assert.equal(h.applied.length, 0);
  h.scheduler.request([[23.2, 42.2]]); h.tick(); assert.equal(h.applied.length, 1);
  h.scheduler.request([[23.3, 42.3]]); h.scheduler.destroy(); h.tick();
  h.scheduler.request([[23.4, 42.4]]); h.scheduler.layoutChanged(); h.tick();
  assert.equal(h.applied.length, 1); assert.equal(h.pending.size, 0);
});

test("a covering chooser defers an explicit frame until a usable map area reappears", () => {
  const h = schedulerHarness(); h.setViewport(null);
  h.scheduler.request([[23, 42]]); h.tick(); assert.equal(h.applied.length, 0);
  h.setViewport(availableMapViewport(390, 844, mobilePanels)); h.scheduler.layoutChanged(); h.tick();
  assert.equal(h.applied.length, 1); assert.equal(h.applied[0].duration, 1.2);
});
