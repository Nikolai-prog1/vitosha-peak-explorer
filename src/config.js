// Public, browser-scoped project token, retained for the local prototype only.
export const DEVELOPMENT_ION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5MTlmNTk4Mi02ZmI1LTRkMzItYTcxZC1mNGQ0YjA1MzU5ZjEiLCJpZCI6NDMzMTE0LCJpc3MiOiJodHRwczovL2lvbi5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3NzkxMTU0NzR9.jhswSBvYIiVV23V3xzKIVIp6-NqcXZcX5kpNy6EBglE";

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

export function getAppConfig() {
  const sourcePreview = typeof document !== "undefined" && document.querySelector("[data-cesium-base]")?.getAttribute("data-cesium-base")?.startsWith("/public/vendor/cesium/") === true;
  return resolveAppConfig(window.__VITOSHA_CONFIG__, { sourcePreview, legacyToken: window.__CESIUM_ION_ACCESS_TOKEN__ });
}
