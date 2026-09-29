const HOME = { longitude: 23.283, latitude: 42.5585, height: 2000, range: 11000, heading: -24, pitch: -43 };

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

export async function createCesiumMap(container, accessToken, callbacks) {
  const Cesium = window.Cesium;
  if (!Cesium) throw new Error("CesiumJS не се зареди / CesiumJS did not load");
  Cesium.Ion.defaultAccessToken = accessToken;

  // Aerial imagery has no city, road or country names baked into its tiles.
  const [imagery, terrain] = await Promise.all([
    Cesium.IonImageryProvider.fromAssetId(2),
    Cesium.createWorldTerrainAsync(),
  ]);
  const viewer = new Cesium.Viewer(container, {
    baseLayer: new Cesium.ImageryLayer(imagery),
    terrainProvider: terrain,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    fullscreenButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: false,
  });
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.globe.enableLighting = false;
  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 100;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 400000;
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
  viewTarget(viewer, HOME);

  const overlay = document.createElement("div");
  overlay.className = "cesium-marker-overlay";
  container.append(overlay);
  const markers = new Set();
  const routes = [];
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
      const label = marker.element.querySelector(".map-peak-label");
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
  handler.setInputAction((event) => {
    const point = pickedCoordinates(viewer, event.endPosition);
    if (point) callbacks.onMove?.(point);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction((event) => {
    const point = pickedCoordinates(viewer, event.position);
    if (point) callbacks.onClick?.(point);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  return {
    viewer,
    resetView() { viewTarget(viewer, HOME, 1.4); },
    focusPeak(peak, close) {
      viewTarget(viewer, {
        longitude: peak.geometry.coordinates[0], latitude: peak.geometry.coordinates[1],
        height: peak.properties.elevation_m, range: close ? 2800 : 6800,
        heading: close ? -12 : -26, pitch: close ? -28 : -42,
      }, 1.5);
    },
    focusRoutes(entries) {
      const coordinates = entries.flatMap((entry) => entry?.path || []);
      if (!coordinates.length) return;
      const longitudes = coordinates.map((point) => point[0]);
      const latitudes = coordinates.map((point) => point[1]);
      const center = {
        longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
        latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
        range: Math.max(4200, Math.max(Math.max(...longitudes) - Math.min(...longitudes), Math.max(...latitudes) - Math.min(...latitudes)) * 180000),
        heading: -24, pitch: -48,
      };
      viewTarget(viewer, center, 1.4);
    },
    addMarker(element, coordinates, height = 1900) {
      const position = Cesium.Cartesian3.fromDegrees(coordinates[0], coordinates[1], height + 14);
      const marker = { element, position, remove() { markers.delete(marker); element.remove(); } };
      markers.add(marker);
      overlay.append(element);
      updateMarkers();
      return marker;
    },
    setRoutes(candidates) {
      for (const route of routes) viewer.entities.remove(route);
      routes.length = 0;
      for (const candidate of candidates) {
        const positions = Cesium.Cartesian3.fromDegreesArray(candidate.path.flatMap((point) => [point[0], point[1]]));
        if (positions.length < 2) continue;
        routes.push(viewer.entities.add({ polyline: {
          positions,
          width: candidate.active ? 6 : 4.5,
          material: Cesium.Color.fromCssColorString(candidate.color),
          clampToGround: true,
        } }));
      }
    },
    destroy() {
      handler.destroy();
      viewer.scene.postRender.removeEventListener(updateMarkers);
      markers.forEach((marker) => marker.remove());
      viewer.destroy();
    },
  };
}
