// Public browser token for GitHub Pages and local previews. It can only read
// assets and Cesium ion accepts it only from nikolai-prog1.github.io and
// 127.0.0.1 / localhost, so it is safe to ship. Production sets CESIUM_ION_TOKEN.
export const DEVELOPMENT_ION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImxHQWdIclBXQ0xNRkhHUHMiLCJqdGkiOiI5NjliYzU4MS0yZDY3LTQzODgtOTIwZi1kMGI2ODEwM2ZkYzQiLCJpZCI6NDMzMTE0LCJzdWIiOiJOaWtvbGFpLXByb2cxIiwiaXNzIjoiaHR0cHM6Ly9hcGkuY2VzaXVtLmNvbSIsImF1ZCI6InZpdG9zaGEtcGVhay1leHBsb3Jlci13ZWIiLCJpYXQiOjE3OTI4ODM5NTd9.ZEi26lmSC2LegUZ_XLO09NAE6k3v-uoCJSLGaZFaOgA";

export function resolveAppConfig(supplied, { sourcePreview = false, legacyToken } = {}) {
  const config = supplied && typeof supplied === "object" ? supplied : {};
  const offlineLaunch = config.offlineLaunch === true;
  const token = typeof config.ionAccessToken === "string" && /^[\w.-]{8,4096}$/.test(config.ionAccessToken) ? config.ionAccessToken : "";
  // Only the explicitly identified source preview can fall back to evaluation
  // defaults. A compiled client must never silently use the free direct API.
  const configurationUnavailable = !sourcePreview && !offlineLaunch && (!token || !["proxy", "disabled"].includes(config.weatherMode) || typeof config.evaluation !== "boolean");
  const weatherMode = offlineLaunch || configurationUnavailable ? "disabled"
    : sourcePreview ? ["direct", "proxy", "disabled"].includes(config.weatherMode) ? config.weatherMode : "direct" : config.weatherMode;
  return Object.freeze({
    ionAccessToken: offlineLaunch || configurationUnavailable ? "" : token || legacyToken || DEVELOPMENT_ION_TOKEN,
    weatherMode,
    evaluation: !offlineLaunch && !configurationUnavailable && (sourcePreview ? config.evaluation !== false : config.evaluation),
    offlineLaunch,
    configurationUnavailable,
  });
}

// The Cesium base marks where the app is served: "/vendor/cesium/" for a build,
// "/public/vendor/cesium/" for the source preview, optionally below a sub-path
// such as GitHub Pages' "/<repository>/".
export function appLocation(cesiumBase = typeof document !== "undefined" ? document.querySelector("[data-cesium-base]")?.getAttribute("data-cesium-base") : undefined) {
  const match = typeof cesiumBase === "string" ? cesiumBase.match(/^((?:\/[\w.-]+)*?\/)(public\/)?vendor\/cesium\/$/) : null;
  if (!match || match[1].split("/").some(segment => segment.startsWith("."))) return { sourcePreview: false, publicBase: "/" };
  return { sourcePreview: Boolean(match[2]), publicBase: `${match[1]}${match[2] || ""}` };
}

export function getAppConfig() {
  // The Vite dev server rewrites /public/vendor/ to /vendor/, so its Cesium base
  // looks like a build. It still serves the source preview's runtime config.
  const sourcePreview = appLocation().sourcePreview || import.meta.env?.DEV === true;
  return resolveAppConfig(window.__VITOSHA_CONFIG__, { sourcePreview, legacyToken: window.__CESIUM_ION_ACCESS_TOKEN__ });
}
