export const peak = { type: "Feature", properties: { id: "peak-26862677", elevation_m: 2290 }, geometry: { type: "Point", coordinates: [23.27934, 42.56309] } };
export const secondPeak = { ...peak, properties: { ...peak.properties, id: "peak-499996634" }, geometry: { type: "Point", coordinates: [23.29005, 42.56486] } };
export function forecastPayload() {
  return {
    current: { time: "2026-10-05T12:00", temperature_2m: 0, apparent_temperature: -2, weather_code: 0, is_day: 1, wind_speed_10m: 10, wind_gusts_10m: 16 },
    hourly: { time: ["2026-10-05T12:00", "2026-10-05T13:00"], temperature_2m: [0, 1], weather_code: [0, 2], is_day: [1, 1], precipitation_probability: [0, 20], precipitation: [0, 0.1], wind_speed_10m: [10, 12], wind_gusts_10m: [16, 20] },
    daily: { time: ["2026-10-05", "2026-10-06", "2026-10-07"], weather_code: [0, 3, 61], temperature_2m_min: [-2, -1, 0], temperature_2m_max: [4, 3, 2], precipitation_probability_max: [0, 10, 90], precipitation_sum: [0, 0, 5], wind_speed_10m_max: [12, 15, 20], wind_gusts_10m_max: [20, 30, 40] },
  };
}
export function jsonResponse(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
