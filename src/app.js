import React, { useCallback, useEffect, useMemo, useRef, useState } from "https://esm.sh/react@19.0.0";
import { createRoot } from "https://esm.sh/react-dom@19.0.0/client";
import htm from "https://esm.sh/htm@3.1.1";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  CircleHelp,
  Compass,
  ExternalLink,
  LocateFixed,
  MapPinned,
  Moon,
  Mountain,
  Navigation,
  RotateCcw,
  Search,
  Sun,
  Target,
  TreePine,
  Wind,
  Droplets,
  X,
} from "https://esm.sh/lucide-react@0.469.0";
import { fetchForecast, weatherDescription, weatherNumber, upcomingHours, sofiaDateTime, WEATHER_TTL_MS } from "./weather.js";
import { createCesiumMap } from "./cesium-map.js";

const html = htm.bind(React.createElement);

const CESIUM_ION_TOKEN =
  window.__CESIUM_ION_ACCESS_TOKEN__ ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5MTlmNTk4Mi02ZmI1LTRkMzItYTcxZC1mNGQ0YjA1MzU5ZjEiLCJpZCI6NDMzMTE0LCJpc3MiOiJodHRwczovL2lvbi5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3NzkxMTU0NzR9.jhswSBvYIiVV23V3xzKIVIp6-NqcXZcX5kpNy6EBglE";
const ROUTE_COLORS = ["#ff405f", "#ffd166", "#8ae6bf"];
const INTRO_MINIMUM_MS = 3000;
const STARTUP_TIMEOUT_MS = 22000;
const TRAIL_REPORTS_STORAGE_KEY = "vitosha-peak-explorer:trail-reports:v1";

const BOOKING_LINKS = {
  "hut-55188093": "https://www.btsbg.org/hizhi/hizha-aleko",
  "hut-266281250": "https://www.btsbg.org/hizhi/hizha-kumata",
  "hut-430238361": "https://www.btsbg.org/hizhi/hizha-zvezdica",
  "hut-430238360": "https://www.btsbg.org/hizhi/hizha-edelvays-vitosha",
  "hut-392680123": "https://www.btsbg.org/hizhi/hizha-selimica",
  "hut-432984797": "https://www.btsbg.org/hizhi/hizha-boerica",
  "hut-175034034": "https://www.btsbg.org/hizhi/hizha-momina-skala",
};

function Icon({ component: Component, size = 17 }) {
  return html`<${Component} size=${size} strokeWidth=${1.9} aria-hidden="true" />`;
}

function fetchJson(file) {
  return fetch(`/data/${file}`).then((response) => {
    if (response.ok) return response.json();
    return fetch(`/public/data/${file}`).then((fallback) => {
      if (!fallback.ok) throw new Error(`Unable to load ${file}`);
      return fallback.json();
    });
  });
}

function useExplorerData() {
  const [state, setState] = useState({ phase: "loading", data: { peaks: [], huts: [], hutRoutes: [], quality: null }, error: null });
  const retry = useCallback(() => {
    setState((current) => ({ ...current, phase: "loading", error: null }));
    Promise.all([fetchJson("peaks.geojson"), fetchJson("huts.geojson"), fetchJson("hut-routes.geojson"), fetchJson("data-quality.json")])
      .then(([peaks, huts, hutRoutes, quality]) => {
        setState({ phase: "ready", data: { peaks: peaks.features, huts: huts.features, hutRoutes: hutRoutes.features, quality }, error: null });
      })
      .catch((error) => setState((current) => ({ ...current, phase: "error", error })));
  }, []);
  useEffect(() => retry(), [retry]);
  return { ...state, retry };
}

function formatCoord(value) {
  return Number(value).toFixed(5);
}

function formatElevation(value) {
  return Number.isFinite(value) ? `${value} м` : "—";
}

function formatReportTime(value) {
  try {
    return new Intl.DateTimeFormat("bg-BG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function confidenceLabel(value) {
  if (value >= 0.9) return "High / Висока";
  if (value >= 0.75) return "Medium / Средна";
  return "Limited / Ограничена";
}

function peakSourceLabel(props) {
  return props.osm_id ? `Точка в OSM ${props.osm_id}` : props.source_names;
}

function popularityLabel(candidate) {
  if (candidate.popularityScore >= 70) return "Много популярен / Very popular";
  if (candidate.popularityScore >= 48) return "Популярен / Popular";
  return "По-тих маршрут / Quieter route";
}

function severityLabel(value) {
  return value === "blocked" ? "Пътеката е блокирана / Trail blocked" : "Минава се трудно / Difficult passage";
}

function bookingUrlForHut(props) {
  if (BOOKING_LINKS[props.id]) return BOOKING_LINKS[props.id];
  return `https://www.google.com/search?q=${encodeURIComponent(`${props.name_bg} ${props.name_en} резервации`)}`;
}

function WeatherIcon({ code, isDay = 1, size = 22 }) {
  const { label, icon } = weatherDescription(code);
  const icons = { sun: isDay === 0 ? Moon : Sun, partly: isDay === 0 ? Moon : CloudSun, cloud: Cloud, rain: CloudRain, snow: CloudSnow, storm: CloudLightning, fog: CloudFog, unknown: CircleHelp };
  return html`<span className="weather-icon" title=${label}><${Icon} component=${icons[icon]} size=${size} /></span>`;
}

function SummitWeather({ peak, active }) {
  const [forecast, setForecast] = useState(null);
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [period, setPeriod] = useState("days");

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setState("loading");
      try {
        const result = await fetchForecast(peak, { signal: controller.signal });
        if (!cancelled) { setForecast(result); setState("ready"); }
      } catch (reason) {
        if (!cancelled) { setError(reason.name === "AbortError" ? "Връзката с прогнозата се забави. Опитайте отново." : reason.message); setState("error"); }
      }
    }, 250);
    const refreshTimer = window.setInterval(() => setRevision((value) => value + 1), WEATHER_TTL_MS);
    return () => { cancelled = true; window.clearTimeout(timer); window.clearInterval(refreshTimer); controller.abort(); };
  }, [peak, active, revision]);

  if (!active) return null;
  if (state === "loading") return html`<div className="weather-state" role="status"><${Icon} component=${CloudSun} size=${26} />Зареждане на прогнозата…</div>`;
  if (state === "error") return html`<div className="weather-state" role="status"><p>${error}</p><button type="button" className="route-show-button" onClick=${() => setRevision((value) => value + 1)}><${Icon} component=${RotateCcw} size=${15} />Опитай отново</button></div>`;
  if (!forecast) return null;
  const { current, days } = forecast;
  const hours = upcomingHours(forecast.hours);
  const today = sofiaDateTime().slice(0, 10);
  const dayLabel = (date) => date === today ? "Днес" : new Intl.DateTimeFormat("bg-BG", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  return html`<div className="weather-content">
    <div className="weather-current"><${WeatherIcon} code=${current.code} isDay=${current.isDay} size=${34} /><div><strong>${weatherNumber(current.temperature, "°")}</strong><span>${weatherDescription(current.code).label}</span></div><div className="weather-feels"><span>Усеща се</span><b>${weatherNumber(current.feels, "°")}</b><small>към ${current.time.slice(11)} ч.</small></div></div>
    <div className="weather-metrics"><span><${Icon} component=${Wind} size=${16} /><span>Вятър<strong>${weatherNumber(current.wind, " км/ч")}</strong></span></span><span><${Icon} component=${Wind} size=${16} /><span>Пориви<strong>${weatherNumber(current.gusts, " км/ч")}</strong></span></span><span><${Icon} component=${Droplets} size=${16} /><span>Валежи сега<strong>${weatherNumber(hours[0]?.probability, "%")}</strong></span></span></div>
    <div className="weather-period" role="group" aria-label="Период на прогнозата"><button type="button" aria-pressed=${period === "days"} onClick=${() => setPeriod("days")}>3 дни</button><button type="button" aria-pressed=${period === "hours"} onClick=${() => setPeriod("hours")}>24 часа</button></div>
    <div className="weather-table-wrap" tabIndex="0"><table className="weather-table"><thead><tr><th>${period === "days" ? "Ден" : "Час"}</th><th>°C</th><th>Валежи</th><th>Пориви</th></tr></thead><tbody>${period === "days" ? days.map((day) => html`<tr key=${day.time}><th><span>${dayLabel(day.time)}</span><${WeatherIcon} code=${day.code} /></th><td>${weatherNumber(day.min, "°")} / ${weatherNumber(day.max, "°")}</td><td>${weatherNumber(day.probability, "%")}<small>${weatherNumber(day.precipitation, " мм", 1)}</small></td><td>${weatherNumber(day.gusts, " км/ч")}</td></tr>`) : hours.map((hour) => html`<tr key=${hour.time}><th><span>${hour.time.slice(11)}<small>${dayLabel(hour.time.slice(0, 10))}</small></span><${WeatherIcon} code=${hour.code} isDay=${hour.isDay} size=${18} /></th><td>${weatherNumber(hour.temperature, "°")}</td><td>${weatherNumber(hour.probability, "%")}<small>${weatherNumber(hour.precipitation, " мм", 1)}</small></td><td>${weatherNumber(hour.gusts, " км/ч")}</td></tr>`)}</tbody></table></div>
    <p className="weather-note">За ${peak.properties.name_bg}, ${peak.properties.elevation_m} м. Моделна прогноза, не измерване на върха. Часовете са за България.</p>
    <div className="weather-credit"><a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Прогноза: Open-Meteo<${Icon} component=${ExternalLink} size=${12} /></a><span>Получена ${sofiaDateTime(new Date(forecast.fetchedAt)).slice(11)} ч.</span></div>
  </div>`;
}

function loadTrailReports() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRAIL_REPORTS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function makePeakMarkerElement(selected, label) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `map-peak-marker${selected ? " selected" : ""}`;
  element.innerHTML = selected
    ? `<svg viewBox="0 0 36 36" aria-hidden="true">
        <defs><linearGradient id="active-peak-blue" x1="5" y1="30" x2="29" y2="5" gradientUnits="userSpaceOnUse"><stop stop-color="#1576ff"/><stop offset="1" stop-color="#79e7ff"/></linearGradient></defs>
        <path d="M2.8 29.2 12.7 11l4.1 6.1L22.4 5l10.8 24.2H2.8Z" fill="url(#active-peak-blue)" stroke="#e9fbff" stroke-width="2" stroke-linejoin="round"/>
        <path d="m12.7 11 2.8 4.2 1.3 1.9 2-4.3 3.6-7.8 3.5 7.9-3.2-1.5-2.6 1.8-2.6-1.4-2 1.2-2.8-2Z" fill="#f5fdff" fill-opacity=".92"/>
        <path d="m7.5 27 6.2-9.2 3.3 4.8 4.2-6.1 6.3 10.5" fill="none" stroke="#083d83" stroke-opacity=".55" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`
    : `<svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M3.5 26.5 16 4.5l12.5 22H3.5Z" fill="rgba(238,241,232,.82)" stroke="#173f34" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="m16 4.5 4.4 7.8-3.1-1.4-3 1.4L16 4.5Z" fill="#173f34" fill-opacity=".92"/>
      </svg>`;
  const caption = document.createElement("span");
  caption.className = "map-peak-label";
  caption.textContent = label;
  element.append(caption);
  return element;
}

function makeHutMarkerElement(color, active) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `map-hut-marker${active ? " active" : ""}`;
  element.style.setProperty("--marker-color", color);
  element.innerHTML = `
    <svg viewBox="0 0 34 34" aria-hidden="true">
      <path d="M4 15.5 17 5l13 10.5v13H4v-13Z" fill="${color}" stroke="#061016" stroke-width="2" stroke-linejoin="round"/>
      <path d="M12 28v-8h10v8" fill="#071218"/><path d="M3 16 17 4l14 12" fill="none" stroke="#fff4c8" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;
  return element;
}

function LoadingIntro({ phase, error, timedOut, onRetry }) {
  const hasError = phase === "error" || timedOut;
  return html`
    <section className=${`loading-intro ${phase === "leaving" ? "is-exiting" : ""} ${hasError ? "is-error" : ""}`} role="status" aria-live="polite">
      <img className="loading-background" src="/assets/loading/vitosha-dawn.webp" onError=${(event) => (event.currentTarget.src = "/public/assets/loading/vitosha-dawn.webp")} alt="" />
      <div className="loading-mist" aria-hidden="true"></div>
      <svg className="loading-route-line" viewBox="0 0 1000 180" preserveAspectRatio="none" aria-hidden="true"><path d="M0 96 C150 60 265 70 385 94 S620 136 1000 154"></path></svg>
      <div className="loading-bear-stage" aria-hidden="true"><div className="loading-bear-frame"><img className="loading-bear-sprite" src="/assets/loading/bear-walk.png" onError=${(event) => (event.currentTarget.src = "/public/assets/loading/bear-walk.png")} alt="" /></div></div>
      ${hasError
        ? html`<div className="loading-error"><h1>Vitosha Peak Explorer</h1><p>${error?.message || "Картата се зарежда по-бавно / The map is taking longer"}</p><button type="button" onClick=${onRetry}>Опитай отново / Retry</button></div>`
        : html`<h1 className="loading-title">Vitosha Peak Explorer</h1>`}
    </section>
  `;
}

function App() {
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const reportPlacementActiveRef = useRef(false);
  const summitPanelRef = useRef(null);
  const peakMarkersRef = useRef([]);
  const hutMarkersRef = useRef([]);
  const reportMarkersRef = useRef([]);
  const { data, phase: dataPhase, error: dataError, retry: retryData } = useExplorerData();
  const [selectedPeakId, setSelectedPeakId] = useState(null);
  const [selectedHutId, setSelectedHutId] = useState(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState("elevation-desc");
  const [routeViewMode, setRouteViewMode] = useState("none");
  const [peakPanelCollapsed, setPeakPanelCollapsed] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [detailsPanelCollapsed, setDetailsPanelCollapsed] = useState(false);
  const [weatherExpanded, setWeatherExpanded] = useState(false);
  const [osmHelpOpen, setOsmHelpOpen] = useState(false);
  const [mapPhase, setMapPhase] = useState("loading");
  const [mapError, setMapError] = useState(null);
  const [mapStatus, setMapStatus] = useState("3D карта");
  const [coords, setCoords] = useState(null);
  const [introPhase, setIntroPhase] = useState("hidden");
  const [startupTimedOut, setStartupTimedOut] = useState(false);
  const [trailReports, setTrailReports] = useState(loadTrailReports);
  const [reportPlacementActive, setReportPlacementActive] = useState(false);
  const [reportDraft, setReportDraft] = useState(null);
  const [activeReportId, setActiveReportId] = useState(null);
  const [reportStorageError, setReportStorageError] = useState(false);

  const selectedPeak = useMemo(
    () => data.peaks.find((peak) => peak.properties.id === selectedPeakId) || data.peaks[0] || null,
    [data.peaks, selectedPeakId],
  );

  useEffect(() => {
    if (!selectedPeakId && data.peaks.length) setSelectedPeakId(data.peaks[0].properties.id);
  }, [data.peaks, selectedPeakId]);

  const filteredPeaks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("bg");
    const list = needle
      ? data.peaks.filter((peak) => `${peak.properties.name_bg} ${peak.properties.name_en}`.toLocaleLowerCase("bg").includes(needle))
      : [...data.peaks];
    return list.sort((left, right) =>
      sortMode === "name"
        ? left.properties.name_bg.localeCompare(right.properties.name_bg, "bg")
        : right.properties.elevation_m - left.properties.elevation_m,
    );
  }, [data.peaks, query, sortMode]);

  const routeOptions = useMemo(() => {
    if (!selectedPeak) return [];
    return data.hutRoutes
      .filter((route) => route.properties.peak_id === selectedPeak.properties.id)
      .sort((left, right) => left.properties.distance_km - right.properties.distance_km)
      .map((route, rank) => {
        const hut = data.huts.find((item) => item.properties.id === route.properties.hut_id);
        if (!hut) return null;
        return {
          feature: hut,
          routeFeature: route,
          rank,
          path: route.geometry.coordinates[0] || [],
          routeKm: route.properties.distance_km,
          directKm: route.properties.direct_km,
          confidence: route.properties.confidence,
          trailNodeCount: route.properties.trail_node_count,
          popularityScore: route.properties.popularity_score,
          hikingRelationCount: route.properties.hiking_relation_count,
          source: route.properties.source,
        };
      })
      .filter(Boolean);
  }, [data.hutRoutes, data.huts, selectedPeak]);

  const activeHutId = routeOptions.some((entry) => entry.feature.properties.id === selectedHutId) ? selectedHutId : null;
  const routeCandidates = useMemo(
    () =>
      routeOptions.map((entry) => ({
        ...entry,
        visible: routeViewMode === "all" || (routeViewMode === "single" && entry.feature.properties.id === activeHutId),
        active: routeViewMode === "single" && entry.feature.properties.id === activeHutId,
      })),
    [activeHutId, routeOptions, routeViewMode],
  );
  const visibleRouteCandidates = useMemo(
    () => routeCandidates.filter((candidate) => candidate.visible),
    [routeCandidates],
  );
  const activeRoute = routeCandidates.find((candidate) => candidate.active) || (routeViewMode === "all" ? routeCandidates[0] : null);
  const activeTrailReport = trailReports.find((report) => report.id === activeReportId) || null;

  const clearMarkers = (ref) => {
    ref.current.forEach((marker) => marker.remove());
    ref.current = [];
  };

  const resetView = useCallback(() => {
    mapRef.current?.resetView();
    setMapStatus("3D карта");
  }, []);

  const focusPeak = useCallback((peak, close = false) => {
    const map = mapRef.current;
    if (!map || !peak) return;
    map.focusPeak(peak, close);
    setMapStatus(close ? "Приближен връх" : "Избран връх");
  }, []);

  const focusRouteCandidates = useCallback((candidates) => {
    const map = mapRef.current;
    if (!map) return;
    const entries = Array.isArray(candidates) ? candidates : [candidates];
    map.focusRoutes(entries);
    setMapStatus(entries.length > 1 ? "Показани са всички маршрути" : "Показан е избраният маршрут");
  }, []);

  const retryStartup = useCallback(() => {
    setStartupTimedOut(false);
    setMapError(null);
    retryData();
    if (mapPhase === "error") window.location.reload();
  }, [mapPhase, retryData]);

  useEffect(() => { reportPlacementActiveRef.current = reportPlacementActive; }, [reportPlacementActive]);

  useEffect(() => {
    if (!mapNode.current) return undefined;
    let cancelled = false;
    createCesiumMap(mapNode.current, CESIUM_ION_TOKEN, {
      onMove: setCoords,
      onClick: (point) => {
        if (!reportPlacementActiveRef.current) return;
        setReportDraft({ longitude: point.lon, latitude: point.lat, severity: "blocked", note: "" });
        setReportPlacementActive(false);
        setMapStatus("Describe the fallen tree / Опиши падналото дърво");
      },
    }).then((map) => {
      if (cancelled) { map.destroy(); return; }
      mapRef.current = map;
      setMapPhase("ready");
      setMapStatus("3D карта · Cesium ion");
    }).catch((error) => {
      if (cancelled) return;
      setMapError(error);
      setMapPhase("error");
      setMapStatus("Грешка при зареждане на Cesium ion");
    });
    return () => {
      cancelled = true;
      clearMarkers(peakMarkersRef);
      clearMarkers(hutMarkersRef);
      clearMarkers(reportMarkersRef);
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapPhase !== "ready") return;
    clearMarkers(peakMarkersRef);
    data.peaks.forEach((peak) => {
      const selected = peak.properties.id === selectedPeak?.properties.id;
      const element = makePeakMarkerElement(selected, peak.properties.name_bg);
      element.title = `${peak.properties.name_bg} / ${peak.properties.name_en}`;
      element.setAttribute("aria-label", element.title);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelectedPeakId(peak.properties.id);
        setSelectedHutId(null);
        setRouteViewMode("none");
        focusPeak(peak);
      });
      const marker = map.addMarker(element, peak.geometry.coordinates, peak.properties.elevation_m);
      peakMarkersRef.current.push(marker);
    });
  }, [data.peaks, focusPeak, mapPhase, selectedPeak]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapPhase !== "ready") return;
    map.setRoutes(visibleRouteCandidates.map((candidate) => ({ ...candidate, color: ROUTE_COLORS[candidate.rank] || ROUTE_COLORS[0] })));
    clearMarkers(hutMarkersRef);
    visibleRouteCandidates.forEach((candidate) => {
      const props = candidate.feature.properties;
      const element = makeHutMarkerElement(ROUTE_COLORS[candidate.rank], candidate.active);
      element.title = `${props.name_bg} / ${props.name_en}`;
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelectedHutId(props.id);
        setRouteViewMode("single");
        focusRouteCandidates(candidate);
      });
      const marker = map.addMarker(element, candidate.feature.geometry.coordinates, props.elevation_m);
      hutMarkersRef.current.push(marker);
    });
  }, [focusRouteCandidates, mapPhase, visibleRouteCandidates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapPhase !== "ready") return;
    clearMarkers(reportMarkersRef);
    trailReports.forEach((report) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `map-report-marker${report.id === activeReportId ? " active" : ""}`;
      element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M6 17l5-6-2 1 3-7 3 7-2-1 5 6"/></svg>`;
      element.title = "Паднало дърво / Fallen tree";
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        setActiveReportId(report.id);
      });
      reportMarkersRef.current.push(map.addMarker(element, [report.longitude, report.latitude]));
    });
  }, [activeReportId, mapPhase, trailReports]);

  useEffect(() => {
    if (introPhase === "hidden") return undefined;
    const started = performance.now();
    const timeout = window.setTimeout(() => setStartupTimedOut(true), STARTUP_TIMEOUT_MS);
    if (dataPhase === "ready" && mapPhase === "ready") {
      const remaining = Math.max(0, INTRO_MINIMUM_MS - (performance.now() - started));
      const leave = window.setTimeout(() => {
        setIntroPhase("leaving");
        window.setTimeout(() => setIntroPhase("hidden"), 650);
      }, remaining);
      return () => {
        window.clearTimeout(timeout);
        window.clearTimeout(leave);
      };
    }
    return () => window.clearTimeout(timeout);
  }, [dataPhase, introPhase, mapPhase]);

  useEffect(() => {
    if (selectedPeak) {
      setSelectedHutId(null);
      setRouteViewMode("none");
      if (summitPanelRef.current) summitPanelRef.current.scrollTop = 0;
    }
  }, [selectedPeakId]);

  function persistReports(nextReports) {
    setTrailReports(nextReports);
    try {
      localStorage.setItem(TRAIL_REPORTS_STORAGE_KEY, JSON.stringify(nextReports));
      setReportStorageError(false);
    } catch {
      setReportStorageError(true);
    }
  }

  function saveTrailReport(event) {
    event.preventDefault();
    const report = {
      ...reportDraft,
      id: `fallen-tree-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      confirmations: 1,
      confirmedByDevice: true,
    };
    persistReports([...trailReports, report]);
    setReportDraft(null);
    setActiveReportId(report.id);
    setMapStatus("Fallen tree saved locally / Падналото дърво е запазено локално");
  }

  function confirmTrailReport(id) {
    persistReports(trailReports.map((report) => (report.id === id ? { ...report, confirmations: report.confirmations + 1, confirmedByDevice: true } : report)));
  }

  function resolveTrailReport(id) {
    persistReports(trailReports.filter((report) => report.id !== id));
    setActiveReportId(null);
    setMapStatus("Report cleared locally / Сигналът е премахнат локално");
  }

  const status = dataPhase === "ready" ? "Данните са заредени" : "Зареждане на данните";
  const sourceCandidate = activeRoute || routeCandidates[0];
  const routeTitle = "Начални точки";
  const routeSourceText = sourceCandidate?.source?.startsWith("BRouter")
    ? "BRouter hiking + OSM trails / BRouter + OSM пътеки"
    : "Approximate approach preview / Приблизителен подход";

  return html`
    <main className="app-shell" aria-busy=${introPhase !== "hidden"}>
      <div className="app-content" inert=${introPhase !== "hidden" ? "" : null} aria-hidden=${introPhase !== "hidden" ? "true" : null}>
        <div ref=${mapNode} className=${`map-canvas ${reportPlacementActive ? "is-reporting" : ""}`} aria-label="3D Vitosha Cesium ion map"></div>

        ${reportPlacementActive
          ? html`<div className="trail-report-placement" role="status"><${Icon} component=${TreePine} size=${20} /><span><strong>Посочи мястото</strong><small>Кликни върху 3D картата / Click the 3D map</small></span><button type="button" onClick=${() => setReportPlacementActive(false)} aria-label="Cancel"><${Icon} component=${X} size=${18} /></button></div>`
          : null}

        ${reportDraft
          ? html`<section className="trail-report-card surface" role="dialog" aria-labelledby="trail-report-form-title">
              <header><div><span>Нов сигнал / New report</span><h2 id="trail-report-form-title">Паднало дърво / Fallen tree</h2></div><button type="button" className="icon-button" onClick=${() => setReportDraft(null)} aria-label="Close"><${Icon} component=${X} size=${18} /></button></header>
              <form onSubmit=${saveTrailReport}>
                <div className="trail-report-coordinates">${formatCoord(reportDraft.latitude)}, ${formatCoord(reportDraft.longitude)}</div>
                <label><span>Състояние на пътеката / Trail condition</span><select value=${reportDraft.severity} onChange=${(event) => setReportDraft((draft) => ({ ...draft, severity: event.target.value }))}><option value="blocked">Пътеката е блокирана / Trail blocked</option><option value="difficult">Минава се трудно / Difficult passage</option></select></label>
                <label><span>Кратка бележка / Short note</span><textarea autoFocus rows="3" maxLength="280" value=${reportDraft.note} placeholder="Напр. след разклона / e.g. after the junction" onInput=${(event) => setReportDraft((draft) => ({ ...draft, note: event.target.value }))}></textarea></label>
                <div className="trail-report-actions"><button type="button" className="secondary" onClick=${() => setReportDraft(null)}>Откажи / Cancel</button><button type="submit" className="primary"><${Icon} component=${CheckCircle2} size=${17} /> Запази / Save</button></div>
                <small className=${reportStorageError ? "storage-warning" : ""}>${reportStorageError ? "Локалното запазване е недостъпно / Local storage unavailable" : "Само на това устройство / This device only"}</small>
              </form>
            </section>`
          : null}

        ${activeTrailReport
          ? html`<section className="trail-report-card trail-report-detail surface" role="dialog" aria-labelledby="trail-report-detail-title">
              <header><div><span>Активен сигнал / Active report</span><h2 id="trail-report-detail-title">Паднало дърво / Fallen tree</h2></div><button type="button" className="icon-button" onClick=${() => setActiveReportId(null)} aria-label="Close"><${Icon} component=${X} size=${18} /></button></header>
              <div className="trail-report-status"><${Icon} component=${TreePine} size=${18} /> ${severityLabel(activeTrailReport.severity)}</div>
              <dl><div><dt>Добавено / Added</dt><dd>${formatReportTime(activeTrailReport.createdAt)}</dd></div><div><dt>Координати / Coordinates</dt><dd>${formatCoord(activeTrailReport.latitude)}, ${formatCoord(activeTrailReport.longitude)}</dd></div><div><dt>Потвърждения / Confirmations</dt><dd>${activeTrailReport.confirmations}</dd></div></dl>
              <p>${activeTrailReport.note || "Няма добавена бележка / No note added"}</p>
              <div className="trail-report-actions"><button type="button" className="secondary" disabled=${activeTrailReport.confirmedByDevice} onClick=${() => confirmTrailReport(activeTrailReport.id)}><${Icon} component=${CheckCircle2} size=${17} /> ${activeTrailReport.confirmedByDevice ? "Потвърдено / Confirmed" : "Още е там / Still there"}</button><button type="button" className="primary" onClick=${() => resolveTrailReport(activeTrailReport.id)}>Вече го няма / Gone</button></div>
              <small>Само на това устройство / This device only</small>
            </section>`
          : null}

        <div className="mobile-command surface">
          <button type="button" className="summit-picker" onClick=${() => setChooserOpen(true)} aria-label="Избери връх / Choose a summit"><${Icon} component=${Mountain} size=${20} /><span><small>Избран връх</small><strong>${selectedPeak?.properties.name_bg || "Избери връх"}</strong></span>${selectedPeak ? html`<b>${selectedPeak.properties.elevation_m} м</b>` : null}<${Icon} component=${ChevronDown} size=${17} /></button>
          <button type="button" className="icon-button" title="Начална гледка / Reset view" onClick=${resetView}><${Icon} component=${RotateCcw} /></button>
        </div>
        ${chooserOpen ? html`<button type="button" className="chooser-backdrop" aria-label="Затвори избора на връх / Close summit chooser" onClick=${() => setChooserOpen(false)}></button>` : null}

        <section className=${`peak-panel surface ${peakPanelCollapsed ? "collapsed" : ""} ${chooserOpen ? "chooser-open" : ""}`}>
          ${peakPanelCollapsed
            ? html`<button type="button" className="minimized-chip" onClick=${() => setPeakPanelCollapsed(false)} title="Open summit chooser"><${Icon} component=${Mountain} size=${16} /><span>Връх / Summit</span><${Icon} component=${ChevronDown} size=${16} /></button>`
            : html`<header className="panel-header"><div><span>Витоша · Върхове и маршрути</span><strong>Избери връх</strong></div><div className="panel-actions"><button type="button" className="icon-button" title="Свий избора на връх / Minimize" onClick=${() => { if (window.matchMedia("(max-width: 900px)").matches) setChooserOpen(false); else setPeakPanelCollapsed(true); }}><${Icon} component=${ChevronUp} /></button><button type="button" className="icon-button" title="Начална гледка / Reset view" onClick=${resetView}><${Icon} component=${RotateCcw} /></button></div></header>
                <label className="search-box"><${Icon} component=${Search} size=${16} /><input value=${query} onInput=${(event) => setQuery(event.target.value)} placeholder="Намери връх" aria-label="Търси връх / Search peak" /></label>
                <div className="sort-row" aria-label="Подредба на върховете / Sort peaks"><button type="button" className=${sortMode === "elevation-desc" ? "active" : ""} onClick=${() => setSortMode("elevation-desc")}>Височина</button><button type="button" className=${sortMode === "name" ? "active" : ""} onClick=${() => setSortMode("name")}>А–Я</button></div>
                <div className="peak-list">${filteredPeaks.map((peak) => {
                  const props = peak.properties;
                  const active = props.id === selectedPeak?.properties.id;
                  return html`<button type="button" className=${`peak-row ${active ? "selected" : ""}`} key=${props.id} onClick=${() => {
                    setSelectedPeakId(props.id);
                    setChooserOpen(false);
                    focusPeak(peak);
                  }} title=${props.name_en}><span className="summit-mark"><${Icon} component=${Mountain} size=${14} /></span><span className="peak-copy"><strong>${props.name_bg}</strong><small>${props.name_en}</small></span><span className="height">${props.elevation_m} м</span></button>`;
                })}</div>`}
        </section>

        <section ref=${summitPanelRef} className=${`summit-panel surface ${detailsPanelCollapsed ? "collapsed" : ""}`}>
          ${selectedPeak
            ? html`<div className="summit-head"><span><${Icon} component=${Target} size=${15} /> ПОДРОБНА ИНФОРМАЦИЯ</span><div className="panel-actions"><button type="button" className="icon-button" title="Свий информацията / Minimize details" onClick=${() => setDetailsPanelCollapsed((value) => !value)}><${Icon} component=${detailsPanelCollapsed ? ChevronUp : ChevronDown} /></button><i></i></div></div>
                <h1>${selectedPeak.properties.name_bg}</h1><h2>Витоша · България</h2>
                <div className="metric-grid"><div><span>Надморска височина</span><strong>${selectedPeak.properties.elevation_m} м</strong></div><div><span>Надеждност на данните</span><strong>${confidenceLabel(selectedPeak.properties.confidence).split(" / ").at(-1)}</strong></div><div><span>Геогр. ширина</span><strong>${formatCoord(selectedPeak.geometry.coordinates[1])}</strong></div><div><span>Геогр. дължина</span><strong>${formatCoord(selectedPeak.geometry.coordinates[0])}</strong></div></div>
                <button type="button" className="fly-button" onClick=${() => focusPeak(selectedPeak, true)}><${Icon} component=${LocateFixed} size=${19} /> Приближи върха</button>
                <div className="source-block"><span>Източник</span><strong>${peakSourceLabel(selectedPeak.properties)}</strong><small>Координатите и височината са от именувана точка за връх в OpenStreetMap.</small></div>
                <section className="weather-section" aria-label="Времето на върха"><button type="button" className="weather-toggle" aria-expanded=${weatherExpanded} aria-controls="summit-weather" onClick=${() => setWeatherExpanded((open) => !open)}><span><${Icon} component=${CloudSun} size=${18} />Времето на върха</span><${Icon} component=${weatherExpanded ? ChevronUp : ChevronDown} size=${16} /></button><div id="summit-weather"><${SummitWeather} key=${selectedPeak.properties.id} peak=${selectedPeak} active=${weatherExpanded && !detailsPanelCollapsed} /></div></section>
                <div className="hut-block">
                  <div className="hut-title"><span><${Icon} component=${MapPinned} size=${15} /> ${routeTitle}</span><div className="hut-title-actions"><strong>${routeViewMode === "all" ? `${routeCandidates.length} маршрута` : activeRoute ? `~${activeRoute.routeKm} км` : "скрити"}</strong><button type="button" className=${`route-show-button ${routeViewMode === "all" ? "active" : ""}`} onClick=${() => {
                    setSelectedHutId(null);
                    setRouteViewMode("all");
                    focusRouteCandidates(routeCandidates);
                  }}>Покажи всички</button></div></div>
                  <div className="hut-list">${routeCandidates.map((candidate) => {
                    const props = candidate.feature.properties;
                    const active = candidate.active;
                    return html`<div key=${props.id} className=${`hut-row ${active ? "active" : ""}`}>
                      <button type="button" className="hut-select" onClick=${() => {
                        setSelectedHutId(props.id);
                        setRouteViewMode("single");
                        focusRouteCandidates(candidate);
                      }}><span className="route-color" style=${{ background: ROUTE_COLORS[candidate.rank] }}></span><span className="hut-copy"><strong>${props.name_bg}</strong><small>${formatElevation(props.elevation_m)} · ${candidate.trailNodeCount} точки в OSM</small></span><span className="route-meta"><small>До върха</small><b>${candidate.routeKm} км</b><small>${popularityLabel(candidate).split(" / ")[0]}</small></span></button>
                      <button type="button" className=${`route-show-button ${active ? "active" : ""}`} onClick=${() => {
                        setSelectedHutId(props.id);
                        setRouteViewMode("single");
                        focusRouteCandidates(candidate);
                      }}>${active ? "Показан" : "Покажи"}</button>
                      <a className="booking-link" href=${bookingUrlForHut(props)} target="_blank" rel="noopener noreferrer" aria-label="Запази нощувка / Book accommodation">Запази нощувка <${Icon} component=${ExternalLink} size=${12} /></a>
                    </div>`;
                  })}</div>
                  ${osmHelpOpen ? html`<div className="osm-help"><strong>OSM точките показват детайла на маршрута</strong><span>Това са точките в OpenStreetMap, които оформят линията по завоите и терена.</span><small>Маршрутите са ориентировъчни и не заместват безопасната планинска навигация.</small></div>` : null}
                  <div className="route-source"><span><${Icon} component=${Navigation} size=${14} /> Най-близки свързани начални точки по пътеките в OSM</span><button type="button" className="osm-help-button" aria-expanded=${osmHelpOpen} onClick=${() => setOsmHelpOpen((open) => !open)}><${Icon} component=${CircleHelp} size=${13} /> Защо са важни OSM точките?</button></div>
                </div>`
            : html`<p>Select a peak / Избери връх</p>`}
        </section>

        <footer className="map-readout"><span><${Icon} component=${Activity} size=${15} /> ${mapStatus}</span><span><${Icon} component=${Compass} size=${15} /> ${coords ? `${formatCoord(coords.lat)}, ${formatCoord(coords.lon)}` : "Координати"}</span><span>${status}</span></footer>
      </div>
      ${introPhase !== "hidden" ? html`<${LoadingIntro} phase=${introPhase} error=${dataError || mapError} timedOut=${startupTimedOut} onRetry=${retryStartup} />` : null}
    </main>
  `;
}

document.getElementById("boot-loader")?.remove();
createRoot(document.getElementById("root")).render(html`<${App} />`);
