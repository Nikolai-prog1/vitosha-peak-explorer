import { withAbort } from "./requests.js?v=vitosha-planning-20261005";
import { availableMapViewport, cameraFramePose, createFrameScheduler, placeFramePoint, routeFramePoints } from "./map-framing.js?v=vitosha-camera-20261005-1";

const HOME = { longitude: 23.283, latitude: 42.5585, height: 2000, range: 11000, heading: -24, pitch: -43 };
let cesiumLoadPromise;

function loadCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (cesiumLoadPromise) return cesiumLoadPromise;
  const base = document.querySelector("[data-cesium-base]")?.getAttribute("data-cesium-base");
  if (!base) return Promise.reject(new Error("Липсва адресът на картния модул / Map module location is missing"));
  window.CESIUM_BASE_URL = base;
  cesiumLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      window.clearTimeout(timeout);
      script.remove();
      cesiumLoadPromise = null;
      reject(new Error("Картният модул не се зареди / Map module did not load"));
    };
    const timeout = window.setTimeout(fail, 20000);
    script.src = `${base}Cesium.js?v=1.146-engine-3`;
    script.async = true;
    script.onerror = fail;
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.Cesium) resolve(window.Cesium);
      else fail();
    };
    document.head.append(script);
  });
  return cesiumLoadPromise;
}

function radians(value) {
  return window.Cesium.Math.toRadians(value);
}

function viewTarget(viewer, { longitude, latitude, height = 1900, range, heading, pitch }, duration = 0) {
  const Cesium = window.Cesium;
  const target = Cesium.Cartesian3.fromDegrees(longitude, latitude, height);
  const sphere = new Cesium.BoundingSphere(target, 0);
  const offset = new Cesium.HeadingPitchRange(radians(heading), radians(pitch), range);
  if (duration) viewer.camera.flyToBoundingSphere(sphere, { offset, duration });
  else viewer.camera.viewBoundingSphere(sphere, offset);
}

function pickedCoordinates(viewer, movement) {
  const Cesium = window.Cesium;
  const ray = viewer.camera.getPickRay(movement);
  const position = ray && viewer.scene.globe.pick(ray, viewer.scene);
  if (!position) return null;
  const point = Cesium.Cartographic.fromCartesian(position);
  return { lon: Cesium.Math.toDegrees(point.longitude), lat: Cesium.Math.toDegrees(point.latitude) };
}

export function createRouteLayer(Cesium, entities) {
  const routes = new Map();
  const material = candidate => candidate.approximate
    ? new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString(candidate.color), dashLength: 18 })
    : Cesium.Color.fromCssColorString(candidate.color);

  return (candidates) => {
    const visibleIds = new Set();
    for (const candidate of candidates) {
      if (candidate.path.length < 2) continue;
      const id = candidate.id;
      const coordinates = candidate.path.flatMap((point) => [point[0], point[1]]);
      const width = candidate.active ? 6 : 4.5;
      const approximate = candidate.approximate === true;
      visibleIds.add(id);
      const current = routes.get(id);

      if (!current) {
        const entity = entities.add({ id: `route:${id}`, polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(coordinates),
          width,
          material: material(candidate),
          clampToGround: true,
        } });
        routes.set(id, { entity, coordinates, width, color: candidate.color, approximate });
        continue;
      }

      // Recreating a ground-clamped entity restarts its asynchronous geometry build.
      // Leave unchanged geometry alone, even if React supplies new array objects.
      const sameCoordinates = current.coordinates.length === coordinates.length
        && current.coordinates.every((value, index) => value === coordinates[index]);
      if (!sameCoordinates) {
        current.entity.polyline.positions = Cesium.Cartesian3.fromDegreesArray(coordinates);
        current.coordinates = coordinates;
      }
      if (current.width !== width) {
        current.entity.polyline.width = width;
        current.width = width;
      }
      if (current.color !== candidate.color || current.approximate !== approximate) {
        current.entity.polyline.material = material(candidate);
        current.color = candidate.color;
        current.approximate = approximate;
      }
    }

    for (const [id, route] of routes) {
      if (visibleIds.has(id)) continue;
      entities.remove(route.entity);
      routes.delete(id);
    }
  };
}

export async function createCesiumMap(container, accessToken, callbacks) {
  const controller = new AbortController();
  const relay = () => controller.abort(callbacks.signal.reason);
  if (callbacks.signal?.aborted) relay();
  else callbacks.signal?.addEventListener("abort", relay, { once: true });
  const deadline = window.setTimeout(() => controller.abort(new DOMException("Map startup timed out", "TimeoutError")), 20000);
  let Cesium, imagery, terrain;
  try {
    Cesium = await withAbort(loadCesium(), controller.signal);
    Cesium.Ion.defaultAccessToken = accessToken;
    // Aerial imagery has no city, road or country names baked into its tiles.
    [imagery, terrain] = await withAbort(Promise.all([
      Cesium.IonImageryProvider.fromAssetId(2),
      Cesium.createWorldTerrainAsync({ requestVertexNormals: true }),
    ]), controller.signal);
  } finally {
    window.clearTimeout(deadline);
    callbacks.signal?.removeEventListener("abort", relay);
  }
  const viewer = new Cesium.CesiumWidget(container, {
    baseLayer: new Cesium.ImageryLayer(imagery),
    terrainProvider: terrain,
    shouldAnimate: false,
    scene3DOnly: true,
    // Render only when the camera, tiles or our own changes need a new frame,
    // instead of 60 frames per second while nothing moves.
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.maximumScreenSpaceError = 1.25;
  viewer.scene.globe.lambertDiffuseMultiplier = 0.6;
  viewer.scene.globe.vertexShadowDarkness = 0.5;
  const lightTransform = Cesium.FixedFrameTransforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(HOME.longitude, HOME.latitude));
  const lightDirection = Cesium.Matrix4.multiplyByPointAsVector(lightTransform, new Cesium.Cartesian3(0.35, 0.55, -0.76), new Cesium.Cartesian3());
  viewer.scene.light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(lightDirection, lightDirection), intensity: 1.05 });
  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 100;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 400000;
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
  viewTarget(viewer, HOME);

  const panelElements = [...container.parentElement.querySelectorAll(".peak-panel, .summit-panel, .mobile-command, .map-readout, [data-map-occluder]"), ...container.querySelectorAll(".cesium-widget-credits")];
  const readViewport = () => {
    const bounds = container.getBoundingClientRect();
    const occluders = panelElements.filter(element => element.getClientRects().length).map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left - bounds.left, top: rect.top - bounds.top, right: rect.right - bounds.left, bottom: rect.bottom - bounds.top };
    });
    return availableMapViewport(container.clientWidth, container.clientHeight, occluders);
  };
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const framing = createFrameScheduler({ readViewport, requestFrame: callback => window.requestAnimationFrame(callback), cancelFrame: id => window.cancelAnimationFrame(id),
    applyFrame({ points, options, viewport, duration }) {
      viewer.resize();
      const pose = cameraFramePose(Cesium, points, viewport, viewer.camera.frustum, options);
      if (!pose) return;
      viewer.camera.cancelFlight();
      const view = { destination: pose.destination, orientation: { direction: pose.direction, up: pose.up }, endTransform: Cesium.Matrix4.IDENTITY };
      if (duration && !reducedMotion()) viewer.camera.flyTo({ ...view, duration });
      else viewer.camera.setView(view);
      viewer.scene.requestRender();
    },
  });
  let overviewPoints = [[HOME.longitude, HOME.latitude, HOME.height]];
  framing.request(overviewPoints, { heading: HOME.heading, pitch: HOME.pitch, minimumRange: HOME.range }, 0);
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => framing.layoutChanged());
  [container, ...panelElements].forEach(element => resizeObserver?.observe(element));
  window.addEventListener("resize", framing.layoutChanged);

  const overlay = document.createElement("div");
  overlay.className = "cesium-marker-overlay";
  container.append(overlay);
  const markers = new Set();
  const setRouteLayer = createRouteLayer(Cesium, viewer.entities);
  // Ground-clamped routes build over several frames, so keep rendering briefly
  // after a change; afterwards the scene goes back to rendering on demand.
  let settleUntil = 0;
  const keepRendering = () => { if (performance.now() < settleUntil) viewer.scene.requestRender(); };
  viewer.scene.preUpdate.addEventListener(keepRendering);
  const updateMarkers = () => {
    const camera = viewer.camera;
    const labelBounds = [];
    const orderedMarkers = [...markers].sort((left, right) => Number(right.element.classList.contains("selected")) - Number(left.element.classList.contains("selected")));
    for (const marker of orderedMarkers) {
      const direction = Cesium.Cartesian3.subtract(marker.position, camera.positionWC, new Cesium.Cartesian3());
      const ahead = Cesium.Cartesian3.dot(direction, camera.directionWC) > 0;
      const pixel = ahead ? Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, marker.position) : null;
      const visible = pixel && pixel.x >= -40 && pixel.y >= -40 && pixel.x <= container.clientWidth + 40 && pixel.y <= container.clientHeight + 40;
      marker.element.style.display = visible ? "grid" : "none";
      if (!visible) continue;
      marker.element.style.transform = `translate3d(${pixel.x}px, ${pixel.y}px, 0) translate(-50%, -100%)`;
      const label = marker.label;
      if (!label) continue;
      const selected = marker.element.classList.contains("selected");
      const width = Math.min(145, label.textContent.length * 6.5 + 12);
      const bounds = { left: pixel.x - width / 2, right: pixel.x + width / 2, top: pixel.y + 1, bottom: pixel.y + 19 };
      const overlaps = labelBounds.some((other) => bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top);
      const show = selected || (container.clientWidth >= 760 && !overlaps);
      label.style.display = show ? "block" : "none";
      if (show) labelBounds.push(bounds);
    }
  };
  viewer.scene.postRender.addEventListener(updateMarkers);

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  let pendingMove, moveFrame = 0;
  const interruptFraming = () => { framing.interrupt(); viewer.camera.cancelFlight(); };
  [Cesium.ScreenSpaceEventType.LEFT_DOWN, Cesium.ScreenSpaceEventType.RIGHT_DOWN, Cesium.ScreenSpaceEventType.MIDDLE_DOWN, Cesium.ScreenSpaceEventType.WHEEL, Cesium.ScreenSpaceEventType.PINCH_START]
    .forEach(event => handler.setInputAction(interruptFraming, event));
  handler.setInputAction((event) => {
    // Picking the globe is costly: handle at most one pointer position per frame.
    pendingMove = event.endPosition;
    if (moveFrame) return;
    moveFrame = window.requestAnimationFrame(() => {
      moveFrame = 0;
      const point = pickedCoordinates(viewer, pendingMove);
      if (point) callbacks.onMove?.(point);
    });
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction((event) => {
    const point = pickedCoordinates(viewer, event.position);
    if (point) callbacks.onClick?.(point);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  return {
    viewer,
    refreshLayout: framing.layoutChanged,
    setOverview(peaks) { const points = peaks.map(placeFramePoint).filter(Boolean); if (points.length) overviewPoints = points; },
    resetView(duration = 1.2) { framing.request(overviewPoints, { heading: HOME.heading, pitch: HOME.pitch, minimumRange: 8000 }, duration); },
    focusPeak(peak, close) {
      const point = placeFramePoint(peak);
      if (point) framing.request([point], { heading: close ? -12 : -26, pitch: close ? -28 : -42, minimumRange: close ? 2800 : 6800 });
    },
    focusRoutes(entries, summit) {
      const points = routeFramePoints(entries, summit);
      if (points.length) framing.request(points);
    },
    addMarker(element, coordinates, height = 1900) {
      const position = Cesium.Cartesian3.fromDegrees(coordinates[0], coordinates[1], height + 14);
      const marker = { element, position, label: element.querySelector(".map-peak-label"), remove() { markers.delete(marker); element.remove(); } };
      markers.add(marker);
      overlay.append(element);
      updateMarkers();
      return marker;
    },
    setRoutes(candidates) {
      setRouteLayer(candidates);
      settleUntil = performance.now() + 3000;
      viewer.scene.requestRender();
    },
    destroy() {
      framing.destroy(); resizeObserver?.disconnect(); window.removeEventListener("resize", framing.layoutChanged);
      handler.destroy();
      window.cancelAnimationFrame(moveFrame);
      viewer.scene.preUpdate.removeEventListener(keepRendering);
      viewer.scene.postRender.removeEventListener(updateMarkers);
      markers.forEach((marker) => marker.remove());
      viewer.destroy();
    },
  };
}
