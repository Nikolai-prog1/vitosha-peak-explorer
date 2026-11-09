import { getAppConfig } from "./config.js?v=vitosha-pages-20261024-1";
import { requestJson, withAbort } from "./requests.js?v=vitosha-planning-20261005";

export const WEATHER_TTL_MS = 15 * 60 * 1000;

const WEATHER_CODES = {
  0: ["Ясно", "sun"], 1: ["Предимно ясно", "sun"],
  2: ["Разкъсана облачност", "partly"], 3: ["Облачно", "cloud"],
  45: ["Мъгла", "fog"], 48: ["Мъгла със скреж", "fog"],
  51: ["Слаб ръмеж", "rain"], 53: ["Ръмеж", "rain"], 55: ["Силен ръмеж", "rain"],
  56: ["Слаб преохладен ръмеж", "snow"], 57: ["Преохладен ръмеж", "snow"],
  61: ["Слаб дъжд", "rain"], 63: ["Дъжд", "rain"], 65: ["Силен дъжд", "rain"],
  66: ["Слаб преохладен дъжд", "snow"], 67: ["Силен преохладен дъжд", "snow"],
  71: ["Слаб снеговалеж", "snow"], 73: ["Снеговалеж", "snow"], 75: ["Силен снеговалеж", "snow"],
  77: ["Снежни зърна", "snow"], 80: ["Слаби краткотрайни валежи", "rain"],
  81: ["Краткотрайни валежи", "rain"], 82: ["Силни краткотрайни валежи", "rain"],
  85: ["Слаби снежни превалявания", "snow"], 86: ["Силни снежни превалявания", "snow"],
  95: ["Гръмотевична буря", "storm"], 96: ["Буря със слаба градушка", "storm"],
  99: ["Буря със силна градушка", "storm"],
};
const WEATHER_ENGLISH = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Depositing rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle", 56: "Light freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Light freezing rain", 67: "Heavy freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Light rain showers", 81: "Rain showers",
  82: "Heavy rain showers", 85: "Light snow showers", 86: "Heavy snow showers", 95: "Thunderstorm",
  96: "Thunderstorm with light hail", 99: "Thunderstorm with heavy hail",
};

export function weatherDescription(code, language = "bg") {
  const [label, icon] = WEATHER_CODES[code] || ["Няма данни за облачността", "unknown"];
  return { label: language === "en" ? WEATHER_ENGLISH[code] || "Cloud cover unavailable" : label, icon };
}

export function weatherNumber(value, unit = "", digits = 0, language = "bg") {
  return Number.isFinite(value)
    ? `${new Intl.NumberFormat(language === "en" ? "en-GB" : "bg-BG", { maximumFractionDigits: digits }).format(Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value)}${unit}`
    : language === "en" ? "no data" : "няма данни";
}

export function sofiaDateTime(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function forecastUrl(peak) {
  const [longitude, latitude] = peak.geometry.coordinates;
  const elevation = peak.properties.elevation_m;
  if (![longitude, latitude, elevation].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error("Невалидни координати за прогнозата.");
  }
  const query = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), elevation: String(elevation),
    timezone: "Europe/Sofia", forecast_days: "3", temperature_unit: "celsius",
    wind_speed_unit: "kmh", precipitation_unit: "mm",
    current: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_gusts_10m",
    hourly: "temperature_2m,weather_code,is_day,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max",
  });
  return `https://api.open-meteo.com/v1/forecast?${query}`;
}

export function normalizeForecast(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Непълни данни от прогнозата.");
  const { current, hourly, daily } = payload;
  const timePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (payload.error || !timePattern.test(current?.time || "") || !Array.isArray(hourly?.time) ||
      !Array.isArray(daily?.time) || !hourly.time.length || hourly.time.length > 120 || !daily.time.length || daily.time.length > 7 ||
      !hourly.time.every(time => timePattern.test(time)) || !daily.time.every(time => /^\d{4}-\d{2}-\d{2}$/.test(time))) {
    throw new Error("Непълни данни от прогнозата.");
  }
  for (const [group, field] of [[hourly, "temperature_2m"], [daily, "temperature_2m_min"], [daily, "temperature_2m_max"]]) {
    if (!Array.isArray(group[field]) || group[field].length !== group.time.length ||
        !group[field].every(number => number === null || Number.isFinite(number))) throw new Error("Непълни температурни данни.");
  }
  const value = (group, field, index) => {
    const number = index === undefined ? group[field] : group[field]?.[index];
    return Number.isFinite(number) ? number : null;
  };
  const hours = hourly.time.map((time, index) => ({
    time, temperature: value(hourly, "temperature_2m", index), code: value(hourly, "weather_code", index),
    isDay: value(hourly, "is_day", index), probability: value(hourly, "precipitation_probability", index),
    precipitation: value(hourly, "precipitation", index), wind: value(hourly, "wind_speed_10m", index),
    gusts: value(hourly, "wind_gusts_10m", index),
  }));
  const days = daily.time.map((time, index) => ({
    time, code: value(daily, "weather_code", index), min: value(daily, "temperature_2m_min", index),
    max: value(daily, "temperature_2m_max", index), probability: value(daily, "precipitation_probability_max", index),
    precipitation: value(daily, "precipitation_sum", index), wind: value(daily, "wind_speed_10m_max", index),
    gusts: value(daily, "wind_gusts_10m_max", index),
  }));
  if (!Number.isFinite(current.temperature_2m) && !hours.some(hour => Number.isFinite(hour.temperature))) {
    throw new Error("Липсват метеорологични стойности.");
  }
  return {
    current: { time: current.time, temperature: value(current, "temperature_2m"), feels: value(current, "apparent_temperature"),
      code: value(current, "weather_code"), isDay: value(current, "is_day"), wind: value(current, "wind_speed_10m"), gusts: value(current, "wind_gusts_10m") },
    hours, days,
  };
}

export function upcomingHours(hours, date = new Date()) {
  const hourStart = `${sofiaDateTime(date).slice(0, 13)}:00`;
  return hours.filter(hour => hour.time >= hourStart).slice(0, 24);
}

export function validateForecast(payload) {
  const timePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (!payload || payload.schemaVersion !== 1 || !Number.isFinite(payload.fetchedAt) || payload.fetchedAt < 0 ||
      !timePattern.test(payload.current?.time || "") || !Array.isArray(payload.hours) || !payload.hours.length || payload.hours.length > 120 ||
      !Array.isArray(payload.days) || !payload.days.length || payload.days.length > 7) throw new Error("Невалидна прогноза / Invalid forecast");
  const numbers = (entry, fields) => Object.fromEntries(fields.map(field => {
    const value = entry[field];
    if (value !== null && !Number.isFinite(value)) throw new Error("Невалидна прогноза / Invalid forecast");
    return [field, value];
  }));
  const current = { time: payload.current.time, ...numbers(payload.current, ["temperature", "feels", "code", "isDay", "wind", "gusts"]) };
  const hours = payload.hours.map(hour => {
    if (!timePattern.test(hour?.time || "")) throw new Error("Невалидна прогноза / Invalid forecast");
    return { time: hour.time, ...numbers(hour, ["temperature", "code", "isDay", "probability", "precipitation", "wind", "gusts"]) };
  });
  const days = payload.days.map(day => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day?.time || "")) throw new Error("Невалидна прогноза / Invalid forecast");
    return { time: day.time, ...numbers(day, ["code", "min", "max", "probability", "precipitation", "wind", "gusts"]) };
  });
  return { schemaVersion: 1, current, hours, days, fetchedAt: payload.fetchedAt, stale: payload.stale === true, provider: "Open-Meteo" };
}

export function createWeatherClient({ fetchImpl = fetch, getConfig = getAppConfig, now = Date.now, timeoutMs = 10000, capacity = 32 } = {}) {
  const cache = new Map();
  const pending = new Map();
  const remember = (key, result) => {
    cache.delete(key);
    cache.set(key, result);
    if (cache.size > capacity) cache.delete(cache.keys().next().value);
    return result;
  };
  return async function fetchForecast(peak, { signal, refresh = false } = {}) {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    const config = getConfig();
    if (config.weatherMode === "disabled") throw Object.assign(new Error("Прогнозата не е активирана от оператора / Forecast is not enabled by the operator"), { code: "weatherDisabled" });
    // Validate coordinates even when the server endpoint takes only a stable peak ID.
    const directUrl = forecastUrl(peak);
    const url = config.weatherMode === "proxy" ? `/api/weather/${encodeURIComponent(peak.properties.id)}` : directUrl;
    const cached = cache.get(url);
    if (!refresh && cached && !cached.stale && now() - cached.fetchedAt < WEATHER_TTL_MS) return cached;
    if (!pending.has(url)) {
      const operation = (async () => {
        try {
          const payload = await requestJson(url, { fetchImpl, timeoutMs, maxBytes: 256 * 1024 });
          const result = config.weatherMode === "proxy" ? validateForecast(payload)
            : { schemaVersion: 1, ...normalizeForecast(payload), fetchedAt: now(), stale: false, provider: "Open-Meteo" };
          return remember(url, result);
        } catch (error) {
          if (cached && now() - cached.fetchedAt <= 60 * 60 * 1000) return { ...cached, stale: true };
          if (error.name === "TimeoutError") throw Object.assign(new Error("Прогнозата се забави. Опитайте отново. / Forecast timed out. Try again."), { code: "weatherTimedOut" });
          if (error.status === 429) throw Object.assign(new Error("Достигнат е временният лимит на прогнозата. / Forecast temporarily rate limited."), { code: "weatherLimited" });
          throw Object.assign(new Error("Прогнозата временно не е достъпна. Опитайте отново. / Forecast unavailable. Try again."), { code: "weatherUnavailable" });
        } finally { pending.delete(url); }
      })();
      pending.set(url, operation);
    }
    // Cancelling one component must not cancel another subscriber's shared request.
    return withAbort(pending.get(url), signal);
  };
}

export const fetchForecast = createWeatherClient();
