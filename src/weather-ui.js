import React, { useEffect, useState } from "react";
import htm from "htm";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, CircleHelp, Droplets, ExternalLink, Moon, RotateCcw, Sun, Wind } from "@vitosha/icons";
import { fetchForecast, weatherDescription, weatherNumber, upcomingHours, sofiaDateTime, WEATHER_TTL_MS } from "./weather.js?v=vitosha-planning-20261005";
import { translate, placeName, formatDate, formatNumber } from "./i18n.js?v=explorer-v2-3";

const html = htm.bind(React.createElement);
function WeatherIcon({ code, isDay = 1, size = 22, language }) {
  const { label, icon } = weatherDescription(code, language);
  const icons = { sun: isDay === 0 ? Moon : Sun, partly: isDay === 0 ? Moon : CloudSun, cloud: Cloud, rain: CloudRain, snow: CloudSnow, storm: CloudLightning, fog: CloudFog, unknown: CircleHelp };
  const Component = icons[icon];
  return html`<span className="weather-icon" title=${label}><${Component} size=${size} strokeWidth=${1.9} aria-hidden="true" /></span>`;
}
export const SummitWeather = React.memo(function SummitWeather({ peak, active, offline, configurationUnavailable, language, evaluation }) {
  const [forecast, setForecast] = useState(null);
  const [state, setState] = useState("loading");
  const [error, setError] = useState("weatherUnavailable");
  const [revision, setRevision] = useState(0);
  const [period, setPeriod] = useState("days");
  const t = (key, values) => translate(language, key, values);
  const number = (value, unit = "", digits = 0) => weatherNumber(value, unit, digits, language);
  useEffect(() => {
    if (!active || offline || configurationUnavailable) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState("loading");
      try {
        const result = await fetchForecast(peak, { signal: controller.signal, refresh: revision > 0 });
        if (!controller.signal.aborted) { setForecast(result); setState("ready"); }
      } catch (reason) {
        if (!controller.signal.aborted) { setError(reason.code || "weatherUnavailable"); setState("error"); }
      }
    }, 250);
    const refreshTimer = window.setInterval(() => setRevision(value => value + 1), WEATHER_TTL_MS);
    return () => { window.clearTimeout(timer); window.clearInterval(refreshTimer); controller.abort(); };
  }, [peak, active, offline, configurationUnavailable, revision]);
  if (!active) return null;
  if (configurationUnavailable) return html`<div className="weather-state" role="status"><p>${t("configurationUnavailableHint")}</p></div>`;
  if (offline) return html`<div className="weather-state" role="status"><p>${t("offlineWeather")}</p></div>`;
  if (state === "loading") return html`<div className="weather-state" role="status"><${CloudSun} size=${26} aria-hidden="true" />${t("weatherLoading")}</div>`;
  if (state === "error") return html`<div className="weather-state" role="status"><p>${t(error)}</p><button type="button" className="route-show-button" onClick=${() => setRevision(value => value + 1)}><${RotateCcw} size=${15} aria-hidden="true" />${t("retry")}</button></div>`;
  if (!forecast) return null;
  const { current, days } = forecast, hours = upcomingHours(forecast.hours), today = sofiaDateTime().slice(0, 10);
  const dayLabel = date => date === today ? t("today") : new Intl.DateTimeFormat(language === "en" ? "en-GB" : "bg-BG", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  return html`<div className="weather-content">
    ${forecast.stale ? html`<p className="weather-warning" role="status">${t("weatherStale")}</p>` : null}
    <div className="weather-current"><${WeatherIcon} code=${current.code} isDay=${current.isDay} size=${34} language=${language} /><div><strong>${number(current.temperature, "°")}</strong><span>${weatherDescription(current.code, language).label}</span></div><div className="weather-feels"><span>${t("feelsLike")}</span><b>${number(current.feels, "°")}</b><small>${t("weatherAt", { time: current.time.slice(11) })}</small></div></div>
    <div className="weather-metrics"><span><${Wind} size=${16} aria-hidden="true" /><span>${t("wind")}<strong>${number(current.wind, ` ${t("windUnit")}`)}</strong></span></span><span><${Wind} size=${16} aria-hidden="true" /><span>${t("gusts")}<strong>${number(current.gusts, ` ${t("windUnit")}`)}</strong></span></span><span><${Droplets} size=${16} aria-hidden="true" /><span>${t("precipitationNow")}<strong>${number(hours[0]?.probability, "%")}</strong></span></span></div>
    <div className="weather-period" role="group" aria-label=${t("forecastPeriod")}><button type="button" aria-pressed=${period === "days"} onClick=${() => setPeriod("days")}>${t("threeDays")}</button><button type="button" aria-pressed=${period === "hours"} onClick=${() => setPeriod("hours")}>${t("twentyFourHours")}</button></div>
    <div className="weather-table-wrap" tabIndex="0" role="region" aria-label=${t("forecastPeriod")}><table className="weather-table"><thead><tr><th scope="col">${period === "days" ? t("day") : t("hour")}</th><th scope="col">°C</th><th scope="col">${t("precipitation")}</th><th scope="col">${t("gusts")}</th></tr></thead><tbody>${period === "days" ? days.map(day => html`<tr key=${day.time}><th scope="row"><span>${dayLabel(day.time)}</span><${WeatherIcon} code=${day.code} language=${language} /></th><td>${number(day.min, "°")} / ${number(day.max, "°")}</td><td>${number(day.probability, "%")}<small>${number(day.precipitation, ` ${t("mmUnit")}`, 1)}</small></td><td>${number(day.gusts, ` ${t("windUnit")}`)}</td></tr>`) : hours.map(hour => html`<tr key=${hour.time}><th scope="row"><span>${hour.time.slice(11)}<small>${dayLabel(hour.time.slice(0, 10))}</small></span><${WeatherIcon} code=${hour.code} isDay=${hour.isDay} size=${18} language=${language} /></th><td>${number(hour.temperature, "°")}</td><td>${number(hour.probability, "%")}<small>${number(hour.precipitation, ` ${t("mmUnit")}`, 1)}</small></td><td>${number(hour.gusts, ` ${t("windUnit")}`)}</td></tr>`)}</tbody></table></div>
    <p className="weather-note">${t("weatherNote", { name: placeName(peak, language), height: `${formatNumber(peak.properties.elevation_m, language, 0)} ${t("metreUnit")}` })} ${evaluation ? t("evaluationMode") : ""}</p>
    <div className="weather-credit"><a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">${t("weatherCredit")}<${ExternalLink} size=${12} aria-hidden="true" /></a><span>${t("weatherReceived", { time: formatDate(forecast.fetchedAt, language) })}</span></div>
  </div>`;
});
