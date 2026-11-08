import React, { useEffect, useRef, useState } from "react";
import htm from "htm";
import { loadCesium } from "./cesium-map.js?v=explorer-v2-3";
import { withAbort } from "./requests.js?v=vitosha-planning-20261005";
import { translate, formatNumber } from "./i18n.js?v=explorer-v2-4";

const html = htm.bind(React.createElement);

// The start page's 3D view, after the X-Alto home page: one summit on Cesium World Terrain at
// true height, turning slowly around itself. Dragging turns it by hand and the wheel or a pinch
// moves closer; a few seconds after the last touch it carries on turning. With reduced motion it
// stands still, and without WebGL, a token or the network the page shows the cover photo instead.
export const COVER_SUMMIT = Object.freeze({
  id: "peak-26862677", name: ["Черни връх", "Cherni vrah"], longitude: 23.2793407, latitude: 42.5630927, elevation: 2290,
});
const TURN_SECONDS = 150;
const RESUME_AFTER_MS = 4000;
const START = { heading: 205, pitch: -16, range: 5200 };
// Keep the camera above the slopes and off the zenith, whatever the hand does.
const PITCH_LIMITS = [-58, -6];

export function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

// Heading, pitch and range of a camera that looks at the origin of its own east-north-up frame.
export function orbitPose(position) {
  const range = Math.hypot(position.x, position.y, position.z);
  const heading = Math.atan2(-position.x, -position.y);
  const pitch = -Math.asin(Math.max(-1, Math.min(1, position.z / (range || 1))));
  return { heading, pitch, range };
}

export async function createCoverScene(container, { accessToken, summit = COVER_SUMMIT, label, signal }) {
  const deadline = new AbortController();
  const relay = () => deadline.abort(signal.reason);
  if (signal?.aborted) relay(); else signal?.addEventListener("abort", relay, { once: true });
  const timer = window.setTimeout(() => deadline.abort(new DOMException("Cover scene timed out", "TimeoutError")), 20000);
  let Cesium, imagery, terrain;
  try {
    Cesium = await withAbort(loadCesium(), deadline.signal);
    Cesium.Ion.defaultAccessToken = accessToken;
    [imagery, terrain] = await withAbort(Promise.all([
      Cesium.IonImageryProvider.fromAssetId(2),
      Cesium.createWorldTerrainAsync({ requestVertexNormals: true }),
    ]), deadline.signal);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
  const radians = Cesium.Math.toRadians;
  const viewer = new Cesium.CesiumWidget(container, {
    baseLayer: new Cesium.ImageryLayer(imagery),
    terrainProvider: terrain,
    shouldAnimate: false,
    scene3DOnly: true,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });
  const { scene, camera } = viewer;
  scene.backgroundColor = Cesium.Color.fromCssColorString("#0a1220");
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.enableLighting = true;
  scene.globe.maximumScreenSpaceError = 1.5;
  scene.globe.lambertDiffuseMultiplier = 0.6;
  scene.globe.vertexShadowDarkness = 0.5;
  scene.skyAtmosphere.show = true;
  const target = Cesium.Cartesian3.fromDegrees(summit.longitude, summit.latitude, summit.elevation);
  const frame = Cesium.FixedFrameTransforms.eastNorthUpToFixedFrame(target);
  // The same low morning light as the explorer, so the cover and the map look alike.
  const light = Cesium.Matrix4.multiplyByPointAsVector(frame, new Cesium.Cartesian3(0.35, 0.55, -0.76), new Cesium.Cartesian3());
  scene.light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(light, light), intensity: 1.05 });

  const controls = scene.screenSpaceCameraController;
  controls.enableTranslate = false;
  controls.enableLook = false;
  controls.enableTilt = false;
  controls.enableCollisionDetection = true;
  controls.minimumZoomDistance = 1600;
  controls.maximumZoomDistance = 14000;
  const look = (heading, pitch, range) => camera.lookAtTransform(frame, new Cesium.HeadingPitchRange(heading, pitch, range));
  look(radians(START.heading), radians(START.pitch), START.range);

  // The summit's place on screen drives the label's leader line.
  const placeLabel = () => {
    if (!label) return;
    const ahead = Cesium.Cartesian3.dot(Cesium.Cartesian3.subtract(target, camera.positionWC, new Cesium.Cartesian3()), camera.directionWC) > 0;
    const point = ahead ? Cesium.SceneTransforms.worldToWindowCoordinates(scene, target) : null;
    label.style.visibility = point ? "visible" : "hidden";
    if (point) label.style.transform = `translate(${point.x}px, ${point.y}px)`;
  };
  scene.postRender.addEventListener(placeLabel);

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dragging = false, lastInput = 0, frameId = 0, last = 0, visible = true;
  const canvas = scene.canvas;
  const touch = () => { lastInput = performance.now(); };
  const press = () => { dragging = true; touch(); };
  const release = () => { if (dragging) { dragging = false; touch(); } };
  canvas.addEventListener("pointerdown", press);
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  canvas.addEventListener("wheel", touch, { passive: true });

  const turn = (time) => {
    frameId = window.requestAnimationFrame(turn);
    const step = last ? Math.min(time - last, 100) : 0;
    last = time;
    if (!visible) return;
    const pose = orbitPose(camera.position);
    const pitch = Math.max(radians(PITCH_LIMITS[0]), Math.min(radians(PITCH_LIMITS[1]), pose.pitch));
    const idle = !reduced && !dragging && time - lastInput > RESUME_AFTER_MS;
    if (!idle && pitch === pose.pitch) return;
    look(pose.heading + (idle ? (2 * Math.PI * step) / (TURN_SECONDS * 1000) : 0), pitch, pose.range);
    scene.requestRender();
  };
  frameId = window.requestAnimationFrame(turn);

  const watch = typeof IntersectionObserver === "undefined" ? null
    : new IntersectionObserver(([entry]) => { visible = entry.isIntersecting && !document.hidden; });
  watch?.observe(container);
  const onVisibility = () => { visible = !document.hidden; };
  document.addEventListener("visibilitychange", onVisibility);

  // Ready once the first terrain and imagery around the summit have arrived (or after a short
  // wait on a slow connection), so the scene fades in whole instead of tile by tile.
  const ready = new Promise((resolve) => {
    const settle = window.setTimeout(resolve, 7000);
    const progress = (queued) => { if (queued === 0 && scene.globe.tilesLoaded) { window.clearTimeout(settle); scene.globe.tileLoadProgressEvent.removeEventListener(progress); resolve(); } };
    scene.globe.tileLoadProgressEvent.addEventListener(progress);
  });
  scene.requestRender();

  return {
    ready,
    destroy() {
      window.cancelAnimationFrame(frameId);
      watch?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      canvas.removeEventListener("wheel", touch);
      scene.postRender.removeEventListener(placeLabel);
      viewer.destroy();
    },
  };
}

export function CoverScene({ language, accessToken, enabled, onOpen, onFail }) {
  const t = (key, values) => translate(language, key, values);
  const root = useRef(null), label = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    if (!webglAvailable()) { onFail(); return undefined; }
    const controller = new AbortController();
    let scene = null, cancelled = false;
    createCoverScene(root.current, { accessToken, label: label.current, signal: controller.signal })
      .then((created) => {
        if (cancelled) { created.destroy(); return; }
        scene = created;
        return created.ready.then(() => { if (!cancelled) setReady(true); });
      })
      .catch(() => { if (!cancelled) onFail(); });
    return () => { cancelled = true; controller.abort(); scene?.destroy(); };
  }, [enabled, accessToken]);
  const lang = language === "en" ? 1 : 0;
  const name = COVER_SUMMIT.name[lang];
  const height = `${formatNumber(COVER_SUMMIT.elevation, language, 0)} ${t("metreUnit")}`;
  return html`<div className=${`x-scene ${ready ? "is-ready" : ""}`}>
    <div ref=${root} className="x-scene-map" aria-hidden="true"></div>
    <div ref=${label} className="x-scene-label">
      <button type="button" onClick=${onOpen} tabIndex=${ready ? 0 : -1} aria-hidden=${!ready} aria-label=${t("coverSceneOpen", { peak: name, height })}>
        <small>${name} · ${t("brandName")}</small>
        <strong>${height}</strong>
      </button>
    </div>
    <p className="x-scene-caption" aria-hidden="true"><i></i>${t("coverSceneCaption", { peak: name })}</p>
  </div>`;
}
