import test from "node:test";
import assert from "node:assert/strict";
import { createWeatherService } from "../server/weather.js";
import { createWeatherClient, forecastUrl, normalizeForecast, validateForecast, WEATHER_TTL_MS } from "../src/weather.js";
import { requestJson } from "../src/requests.js";
import { publicConfig, readConfig } from "../server/config.js";
import { forecastPayload, jsonResponse, peak, secondPeak } from "./fixtures.js";

test("forecast coordinates remain longitude/latitude and values preserve zero", () => {
  const url = new URL(forecastUrl(peak));
  assert.equal(url.searchParams.get("latitude"), "42.56309");
  assert.equal(url.searchParams.get("longitude"), "23.27934");
  assert.equal(url.searchParams.get("elevation"), "2290");
  const result = normalizeForecast(forecastPayload());
  assert.equal(result.current.temperature, 0);
  assert.equal(result.hours[0].precipitation, 0);
  assert.throws(() => normalizeForecast({ ...forecastPayload(), daily: { time: ["2026-10-05"] } }));
  assert.throws(() => normalizeForecast(null));
});

test("server rejects unknown peaks and disabled mode without contacting a provider", async () => {
  const weather = createWeatherService({ peaks: [peak], fetchImpl: () => { throw new Error("Unexpected provider call"); } });
  await assert.rejects(weather.getForecast("peak-999"), error => error.status === 404);
  await assert.rejects(weather.getForecast(peak.properties.id), error => error.code === "WEATHER_DISABLED");
});

test("server coalesces concurrent requests and caches a valid result", async () => {
  let calls = 0;
  let finish;
  const weather = createWeatherService({ peaks: [peak], mode: "evaluation", now: () => 1000, fetchImpl: () => {
    calls += 1;
    return new Promise(resolve => { finish = resolve; });
  } });
  const first = weather.getForecast(peak.properties.id);
  const second = weather.getForecast(peak.properties.id);
  assert.equal(calls, 1);
  finish(jsonResponse(forecastPayload()));
  const [left, right] = await Promise.all([first, second]);
  assert.deepEqual(left, right);
  assert.deepEqual(await weather.getForecast(peak.properties.id), left);
  assert.equal(calls, 1);
  assert.equal(weather.status().pending, 0);
});

test("server limits simultaneous upstream calls across different peaks", async () => {
  let finish;
  const weather = createWeatherService({ peaks: [peak, secondPeak], mode: "evaluation", maxConcurrent: 1,
    fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const first = weather.getForecast(peak.properties.id);
  await assert.rejects(weather.getForecast(secondPeak.properties.id), error => error.code === "WEATHER_BUSY");
  finish(jsonResponse(forecastPayload()));
  await first;
});

test("stale forecasts retain their real timestamp and expire after the bounded stale window", async () => {
  let time = 1000;
  let fail = false;
  let calls = 0;
  const weather = createWeatherService({ peaks: [peak], mode: "evaluation", now: () => time, fetchImpl: async () => {
    calls += 1;
    if (fail) throw new Error("Provider failure");
    return jsonResponse(forecastPayload());
  } });
  await weather.getForecast(peak.properties.id);
  time += WEATHER_TTL_MS + 1; fail = true;
  const cached = await weather.getForecast(peak.properties.id);
  assert.equal(cached.stale, true);
  assert.equal(cached.fetchedAt, 1000);
  await weather.getForecast(peak.properties.id);
  assert.equal(calls, 2, "failure backoff prevents repeated provider calls");
  time = 1000 + 60 * 60 * 1000 + 1;
  await assert.rejects(weather.getForecast(peak.properties.id), error => error.code === "WEATHER_UNAVAILABLE");
});

test("commercial endpoint gets the private key but public configuration never does", async () => {
  let requested;
  const key = "test-private-key-not-real";
  const weather = createWeatherService({ peaks: [peak], mode: "commercial", apiKey: key, fetchImpl: async url => {
    requested = new URL(url); return jsonResponse(forecastPayload());
  } });
  await weather.getForecast(peak.properties.id);
  assert.equal(requested.hostname, "customer-api.open-meteo.com");
  assert.equal(requested.searchParams.get("apikey"), key);
  const config = readConfig({ WEATHER_MODE: "commercial", OPEN_METEO_API_KEY: key });
  assert.equal(JSON.stringify(publicConfig(config)).includes(key), false);
  assert.equal(publicConfig(config).weatherMode, "proxy");
  assert.throws(() => readConfig({ NODE_ENV: "production", WEATHER_MODE: "evaluation" }));
  assert.throws(() => readConfig({ WEATHER_MODE: "commercial" }));
  assert.throws(() => readConfig({ PUBLIC_ORIGIN: "http://public.example" }));
  assert.throws(() => readConfig({ NODE_ENV: "production", CESIUM_ION_TOKEN: "fixture" }), /PUBLIC_ORIGIN/);
  assert.throws(() => readConfig({ NODE_ENV: "production", CESIUM_ION_TOKEN: "REPLACE_TOKEN", PUBLIC_ORIGIN: "https://vitosha.example" }), /Replace/);
});

test("upstream timeouts and errors do not expose private provider information", async () => {
  const key = "test-private-key-not-real";
  const weather = createWeatherService({ peaks: [peak], mode: "commercial", apiKey: key, timeoutMs: 15,
    fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(weather.getForecast(peak.properties.id), error => error.code === "WEATHER_UNAVAILABLE" && !error.message.includes(key));
  assert.equal(weather.status().pending, 0);
});

test("JSON requests have bounded sizes, complete-body deadlines and cancellation", async () => {
  await assert.rejects(requestJson("http://fixture", { timeoutMs: 15, fetchImpl: () => new Promise(() => {}) }), error => error.name === "TimeoutError");
  await assert.rejects(requestJson("http://fixture", { maxBytes: 5, fetchImpl: async () => jsonResponse({ oversized: true }) }), /too large/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestJson("http://fixture", { signal: controller.signal, fetchImpl: async () => jsonResponse({}) }), error => error.name === "AbortError");
  const hangingBody = new Response(new ReadableStream({ start() {} }));
  await assert.rejects(requestJson("http://fixture", { timeoutMs: 15, fetchImpl: async () => hangingBody }), error => error.name === "TimeoutError");
});

test("client subscribers share a request; cancelling one does not cancel another", async () => {
  let finish;
  let calls = 0;
  const fetchForecast = createWeatherClient({ getConfig: () => ({ weatherMode: "direct" }), now: () => 1000,
    fetchImpl: () => { calls += 1; return new Promise(resolve => { finish = resolve; }); } });
  const cancelled = new AbortController();
  const first = fetchForecast(peak, { signal: cancelled.signal });
  const second = fetchForecast(peak);
  cancelled.abort();
  await assert.rejects(first, error => error.name === "AbortError");
  finish(jsonResponse(forecastPayload()));
  const result = await second;
  assert.equal(result.current.temperature, 0);
  assert.deepEqual(await fetchForecast(peak), result);
  assert.equal(calls, 1);
});

test("client uses only a stable summit ID at the proxy and validates its schema", async () => {
  let requested;
  const payload = { schemaVersion: 1, ...normalizeForecast(forecastPayload()), fetchedAt: 1000, stale: false };
  const fetchForecast = createWeatherClient({ getConfig: () => ({ weatherMode: "proxy" }), now: () => 1000,
    fetchImpl: async url => { requested = url; return jsonResponse(payload); } });
  assert.equal((await fetchForecast(peak)).days.length, 3);
  assert.equal(requested, "/api/weather/peak-26862677");
  assert.throws(() => validateForecast({ ...payload, hours: [{ time: "bad" }] }));
  assert.throws(() => validateForecast({ ...payload, current: { ...payload.current, wind: "10" } }));
});
