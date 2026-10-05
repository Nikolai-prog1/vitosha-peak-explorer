import { forecastUrl, normalizeForecast, WEATHER_TTL_MS } from "../src/weather.js";
import { requestJson } from "../src/requests.js";

export class ServiceError extends Error {
  constructor(status, code) { super(code); this.name = "ServiceError"; this.status = status; this.code = code; }
}

export function createWeatherService({ peaks, mode = "disabled", apiKey = "", fetchImpl = fetch, now = Date.now, timeoutMs = 8000, ttlMs = WEATHER_TTL_MS, maxStaleMs = 60 * 60 * 1000, maxConcurrent = 4 }) {
  if (!["disabled", "evaluation", "commercial"].includes(mode)) throw new Error("Invalid weather mode");
  for (const peak of peaks) forecastUrl(peak);
  const peakIndex = new Map(peaks.map(peak => [peak.properties.id, peak]));
  const cache = new Map();
  const pending = new Map();
  const failures = new Map();
  if (mode === "commercial" && !apiKey) throw new Error("Commercial weather requires an API key");

  async function getForecast(id) {
    const peak = peakIndex.get(id);
    if (!peak) throw new ServiceError(404, "UNKNOWN_PEAK");
    if (mode === "disabled") throw new ServiceError(503, "WEATHER_DISABLED");
    const cached = cache.get(id);
    if (cached && now() - cached.fetchedAt < ttlMs) return { ...cached, stale: false };
    const stale = () => cached && now() - cached.fetchedAt <= maxStaleMs ? { ...cached, stale: true } : null;
    if (pending.has(id)) return pending.get(id);
    if (failures.get(id) > now()) {
      if (stale()) return stale();
      throw new ServiceError(503, "WEATHER_UNAVAILABLE");
    }
    if (pending.size >= maxConcurrent) {
      if (stale()) return stale();
      throw new ServiceError(503, "WEATHER_BUSY");
    }

    const operation = (async () => {
      try {
        const url = new URL(forecastUrl(peak));
        if (mode === "commercial") { url.hostname = "customer-api.open-meteo.com"; url.searchParams.set("apikey", apiKey); }
        const payload = await requestJson(url.href, { fetchImpl, timeoutMs, maxBytes: 256 * 1024 });
        const forecast = { schemaVersion: 1, ...normalizeForecast(payload), fetchedAt: now(), provider: "Open-Meteo" };
        cache.set(id, forecast);
        failures.delete(id);
        return { ...forecast, stale: false };
      } catch {
        // Never expose provider URLs, keys, response bodies or stack traces.
        failures.set(id, now() + 20000);
        if (stale()) return stale();
        throw new ServiceError(503, "WEATHER_UNAVAILABLE");
      } finally { pending.delete(id); }
    })();
    pending.set(id, operation);
    return operation;
  }
  return { getForecast, status: () => ({ mode, cachedPeaks: cache.size, pending: pending.size }) };
}
