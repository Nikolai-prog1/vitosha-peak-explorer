import { DEVELOPMENT_ION_TOKEN } from "../src/config.js";

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const weatherMode = env.WEATHER_MODE || (production ? "disabled" : "evaluation");
  if (!["evaluation", "commercial", "disabled"].includes(weatherMode)) throw new Error("WEATHER_MODE must be evaluation, commercial or disabled");
  if (production && weatherMode === "evaluation") throw new Error("The free forecast API is for evaluation, not a commercial production release");
  if (weatherMode === "commercial" && !env.OPEN_METEO_API_KEY) throw new Error("Commercial weather requires OPEN_METEO_API_KEY on the server");
  if (production && !env.CESIUM_ION_TOKEN) throw new Error("Set an explicitly scoped CESIUM_ION_TOKEN before production startup");
  if (production && /^REPLACE/i.test(env.CESIUM_ION_TOKEN)) throw new Error("Replace the example Cesium token before production startup");
  if (production && !env.PUBLIC_ORIGIN) throw new Error("Set the HTTPS PUBLIC_ORIGIN before production startup");
  const port = Number(env.PORT || 4175);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
  let publicOrigin = "";
  if (env.PUBLIC_ORIGIN) {
    const origin = new URL(env.PUBLIC_ORIGIN);
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("PUBLIC_ORIGIN must be an origin without credentials, paths or query strings");
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) throw new Error("PUBLIC_ORIGIN must use HTTPS outside localhost");
    if (production && origin.protocol !== "https:") throw new Error("Production PUBLIC_ORIGIN must use HTTPS");
    publicOrigin = origin.origin;
  }
  return Object.freeze({
    production, host: env.HOST || "127.0.0.1", port, publicOrigin, weatherMode,
    ionAccessToken: env.CESIUM_ION_TOKEN || DEVELOPMENT_ION_TOKEN,
    weatherApiKey: env.OPEN_METEO_API_KEY || "",
  });
}

export function publicConfig(config) {
  return { schemaVersion: 1, ionAccessToken: config.ionAccessToken,
    weatherMode: config.weatherMode === "disabled" ? "disabled" : "proxy",
    evaluation: config.weatherMode === "evaluation" };
}
