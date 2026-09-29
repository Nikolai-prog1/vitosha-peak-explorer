export const WEATHER_TTL_MS = 15 * 60 * 1000;
const weatherCache = new Map();

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

export function weatherDescription(code) {
  const [label, icon] = WEATHER_CODES[code] || ["Няма данни за облачността", "unknown"];
  return { label, icon };
}

export function weatherNumber(value, unit = "", digits = 0) {
  return Number.isFinite(value)
    ? `${new Intl.NumberFormat("bg-BG", { maximumFractionDigits: digits }).format(Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value)}${unit}`
    : "няма данни";
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
  const { current, hourly, daily } = payload;
  const timePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (payload.error || !timePattern.test(current?.time || "") || !Array.isArray(hourly?.time) ||
      !Array.isArray(daily?.time) || !hourly.time.length || !daily.time.length ||
      !hourly.time.every(time => timePattern.test(time)) || !daily.time.every(time => /^\d{4}-\d{2}-\d{2}$/.test(time))) {
    throw new Error("Непълни данни от прогнозата.");
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

export async function fetchForecast(peak, { signal, refresh = false } = {}) {
  const url = forecastUrl(peak);
  const cached = weatherCache.get(url);
  if (!refresh && cached && Date.now() - cached.fetchedAt < WEATHER_TTL_MS) return cached;
  let response;
  try { response = await fetch(url, { signal }); }
  catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Няма връзка с прогнозата. Проверете интернет връзката и опитайте отново.");
  }
  if (!response.ok) throw new Error(response.status === 429 ? "Временно е достигнат лимитът на прогнозата. Опитайте по-късно." : "Прогнозата временно не е достъпна.");
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error("Невалиден отговор от прогнозата. Опитайте отново."); }
  const result = { ...normalizeForecast(payload), fetchedAt: Date.now() };
  weatherCache.set(url, result);
  return result;
}
