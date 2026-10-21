import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import htm from "htm";
import { ChevronDown, ChevronUp, CircleHelp, CloudSun, ExternalLink, LocateFixed, MapPinned, Mountain, Navigation, RotateCcw, Search, TreePine, X } from "@vitosha/icons";
import { createCesiumMap } from "./cesium-map.js?v=explorer-v2-1";
import { appLocation, getAppConfig } from "./config.js?v=vitosha-pages-20261021-1";
import { EMPTY_EXPLORER_DATA, loadExplorerData } from "./explorer-data.js?v=vitosha-planning-20261005-2";
import { translate, placeName, formatNumber } from "./i18n.js?v=explorer-v2-3";
import { routeFacts, parsePlanHash, sharedPlanUrl, createGpx, resolveSavedPlan } from "./planning.js?v=vitosha-camera-20261005-2";
import { WORKSPACE_KEY, LEGACY_REPORTS_KEY, PREFERENCES_KEY, MAX_BACKUP_BYTES, readWorkspace, commitWorkspace, createBackup, parseBackup, mergeWorkspaces, readLanguage, writeLanguage, parseNoteCoordinates } from "./local-workspace.js?v=vitosha-accessibility-20261005-2";
import { ApproachPlanner, PersonalLibrary, PlanningDialog, ReportDialog } from "./planning-ui.js?v=vitosha-accessibility-20261005-3";
import { SummitWeather } from "./weather-ui.js?v=vitosha-accessibility-20261005-2";
import { useOfflineFacts, OfflineFactsPanel } from "./offline-ui.js?v=vitosha-accessibility-20261005-2";
import { FileExportDialog } from "./file-export-ui.js?v=vitosha-accessibility-20261005-3";
import { SafetyDisclaimer } from "./safety-disclaimer.js?v=vitosha-safety-20261021-2";

const html = htm.bind(React.createElement);
const APP_CONFIG = getAppConfig();
const COVER_BASE = `${appLocation().publicBase}assets`;
const ROUTE_COLORS = ["#ff6b2c", "#2f80ed", "#a259ff"];
const BOOKING_LINKS = {
  "hut-55188093": "https://www.btsbg.org/hizhi/hizha-aleko",
  "hut-266281250": "https://www.btsbg.org/hizhi/hizha-kumata",
  "hut-430238361": "https://www.btsbg.org/hizhi/hizha-zvezdica",
  "hut-430238360": "https://www.btsbg.org/hizhi/hizha-edelvays-vitosha",
  "hut-392680123": "https://www.btsbg.org/hizhi/hizha-selimica",
  "hut-432984797": "https://www.btsbg.org/hizhi/hizha-boerica",
  "hut-175034034": "https://www.btsbg.org/hizhi/hizha-momina-skala",
};
function Icon({ component: Component, size = 17 }) { return html`<${Component} size=${size} strokeWidth=${1.9} aria-hidden="true" />`; }
function browserStorage() { try { return window.localStorage; } catch { return null; } }
function formatCoord(value) { return Number(value).toFixed(5); }
// DAV/Swiss rule of thumb: the larger of horizontal and vertical time plus half the smaller.
function climbMinutes(km, ascent) { const horizontal = km / 4 * 60, vertical = Math.max(0, ascent) / 300 * 60; return Math.round((Math.max(horizontal, vertical) + Math.min(horizontal, vertical) / 2) / 5) * 5; }
function hutUrl(props, language) { return BOOKING_LINKS[props.id] || `https://www.google.com/search?q=${encodeURIComponent(props[language === "en" ? "name_en" : "name_bg"] + " hut official website")}`; }

function useExplorerData() {
  const [state, setState] = useState({ phase: "loading", data: EMPTY_EXPLORER_DATA });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState(current => ({ ...current, phase: "loading", error: null }));
    const base = `${appLocation().publicBase}data`;
    loadExplorerData({ base, signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ phase: "ready", data }); })
      .catch(() => { if (!controller.signal.aborted) setState(current => ({ ...current, phase: "error" })); });
    return () => controller.abort();
  }, [revision]);
  return { ...state, retry };
}

function makePeakMarkerElement(selected, label) {
  const element = document.createElement("button");
  element.type = "button";
  element.tabIndex = -1; // The summit list is the complete, unobscured keyboard equivalent.
  element.className = `map-peak-marker${selected ? " selected" : ""}`;
  element.innerHTML = selected
    ? `<svg viewBox="0 0 36 36" aria-hidden="true">
        <defs><linearGradient id="active-peak-blue" x1="5" y1="30" x2="29" y2="5" gradientUnits="userSpaceOnUse"><stop stop-color="#1576ff"/><stop offset="1" stop-color="#79e7ff"/></linearGradient></defs>
        <path d="M2.8 29.2 12.7 11l4.1 6.1L22.4 5l10.8 24.2H2.8Z" fill="url(#active-peak-blue)" stroke="#e9fbff" stroke-width="2" stroke-linejoin="round"/>
        <path d="m12.7 11 2.8 4.2 1.3 1.9 2-4.3 3.6-7.8 3.5 7.9-3.2-1.5-2.6 1.8-2.6-1.4-2 1.2-2.8-2Z" fill="#f5fdff" fill-opacity=".92"/>
        <path d="m7.5 27 6.2-9.2 3.3 4.8 4.2-6.1 6.3 10.5" fill="none" stroke="#083d83" stroke-opacity=".55" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`
    : `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3.5 26.5 16 4.5l12.5 22H3.5Z" fill="rgba(238,241,232,.82)" stroke="#173f34" stroke-width="2.2" stroke-linejoin="round"/><path d="m16 4.5 4.4 7.8-3.1-1.4-3 1.4L16 4.5Z" fill="#173f34" fill-opacity=".92"/></svg>`;
  const caption = document.createElement("span"); caption.className = "map-peak-label"; caption.textContent = label; element.append(caption);
  return element;
}
function makeHutMarkerElement(color, active) {
  const element = document.createElement("button");
  element.tabIndex = -1; // Approach controls provide the same action outside the moving map.
  element.type = "button"; element.className = `map-hut-marker${active ? " active" : ""}`; element.style.setProperty("--marker-color", color);
  element.innerHTML = `<svg viewBox="0 0 34 34" aria-hidden="true"><path d="M4 15.5 17 5l13 10.5v13H4v-13Z" fill="${color}" stroke="#061016" stroke-width="2" stroke-linejoin="round"/><path d="M12 28v-8h10v8" fill="#071218"/><path d="M3 16 17 4l14 12" fill="none" stroke="#fff4c8" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  return element;
}
function ConnectionStatus({ mapPhase, dataPhase, onRetryData, onRetryMap, offline, language }) {
  if (mapPhase === "ready" && dataPhase === "ready" && !offline) return null;
  const t = (key, values) => translate(language, key, values), failed = mapPhase === "error" || dataPhase === "error";
  if (mapPhase === "config-error") return html`<section className="connection-status surface" role="status" aria-label=${t("connectionStatus")}><div><strong>${t("configurationUnavailable")}</strong><p>${t("configurationUnavailableHint")}</p><button type="button" className="route-show-button" onClick=${() => window.location.reload()}>${t("reloadConfiguration")}</button></div></section>`;
  if (offline || mapPhase === "offline") return html`<section className="connection-status surface" role="status" aria-label=${t("connectionStatus")}><div><strong>${t("offlinePlanning")}</strong><p>${t(dataPhase === "error" ? "offlineDataUnavailable" : dataPhase === "loading" ? "offlineDataLoading" : mapPhase === "ready" ? "offlineMapPartial" : "offlinePlanningLimits")}</p>${dataPhase === "error" ? html`<button type="button" className="route-show-button" onClick=${onRetryData}>${t("retryData")}</button>` : null}<button type="button" className="route-show-button" onClick=${() => window.location.reload()}>${t("offlineReconnect")}</button></div></section>`;
  return html`<section className="connection-status surface" role="status" aria-live="polite" aria-label=${t("connectionStatus")}><${Icon} component=${failed ? CircleHelp : Mountain} size=${24} /><div><strong>${t(dataPhase === "error" ? "dataUnavailable" : mapPhase === "error" ? "mapUnavailable" : "loadingExplorer")}</strong><p>${t(failed ? "connectionRetry" : "loadingExplanation")}</p>${dataPhase === "error" ? html`<button type="button" className="route-show-button" onClick=${onRetryData}>${t("retryData")}</button>` : null}${mapPhase === "error" ? html`<button type="button" className="route-show-button" onClick=${onRetryMap}>${t("reloadMap")}</button>` : null}</div></section>`;
}

function App() {
  const offlineState = useOfflineFacts(APP_CONFIG.offlineLaunch);
  const [mapRevision, setMapRevision] = useState(0);
  const retryMap = useCallback(() => setMapRevision(value => value + 1), []);
  const mapNode = useRef(null), mapRef = useRef(null), summitPanelRef = useRef(null), importInputRef = useRef(null);
  const searchRef = useRef(null), comboRef = useRef(null), summitHeadingRef = useRef(null);
  const noteButtonRef = useRef(null), placementCancelRef = useRef(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const [pendingFocus, setPendingFocus] = useState(null);
  const reportPlacementActiveRef = useRef(false), initialLinkChecked = useRef(false), initialCameraFramed = useRef(false), importRevision = useRef(0);
  const peakMarkersRef = useRef([]), hutMarkersRef = useRef([]), reportMarkersRef = useRef([]);
  const { data, phase: dataPhase, retry: retryData } = useExplorerData();
  const [language, setLanguage] = useState(() => parsePlanHash(window.location.hash).language || readLanguage(browserStorage()));
  const [selectedPeakId, setSelectedPeakId] = useState(() => parsePlanHash(window.location.hash).peakId || null);
  const [selectedHutId, setSelectedHutId] = useState(null), [query, setQuery] = useState(""), [sortMode, setSortMode] = useState("elevation-desc");
  const [comboOpen, setComboOpen] = useState(false), [activeIndex, setActiveIndex] = useState(0);
  const [routeViewMode, setRouteViewMode] = useState("none"), [sheet, setSheet] = useState("half");
  const [detailsPanelCollapsed, setDetailsPanelCollapsed] = useState(false), [weatherExpanded, setWeatherExpanded] = useState(true);
  const [mapPhase, setMapPhase] = useState("loading"), [mapStatus, setMapStatus] = useState("map3d"), [coords, setCoords] = useState(null);
  const [workspaceState, setWorkspaceState] = useState(() => readWorkspace(browserStorage()));
  const [reportPlacementActive, setReportPlacementActive] = useState(false), [reportDraft, setReportDraft] = useState(null), [activeReportId, setActiveReportId] = useState(null);
  const [notice, setNotice] = useState(""), [actionError, setActionError] = useState(""), [shareUrl, setShareUrl] = useState(""), [importPreview, setImportPreview] = useState(null);
  const [fileExport, setFileExport] = useState(null), [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [showCover, setShowCover] = useState(() => !parsePlanHash(window.location.hash).peakId);
  const coverEnterRef = useRef(null), brandRef = useRef(null);
  const t = useCallback((key, values) => translate(language, key, values), [language]);
  const workspace = workspaceState.workspace, trailReports = workspace.reports;
  const selectedPeak = useMemo(() => data.peaks.find(peak => peak.properties.id === selectedPeakId) || null, [data.peaks, selectedPeakId]);
  const filteredPeaks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(language);
    const list = needle ? data.peaks.filter(peak => `${peak.properties.name_bg} ${peak.properties.name_en}`.toLocaleLowerCase(language).includes(needle)) : [...data.peaks];
    return list.sort((left, right) => sortMode === "name" ? placeName(left, language).localeCompare(placeName(right, language), language) : right.properties.elevation_m - left.properties.elevation_m);
  }, [data.peaks, query, sortMode, language]);
  const routeOptions = useMemo(() => {
    if (!selectedPeak) return [];
    return data.hutRoutes.filter(route => route.properties.peak_id === selectedPeak.properties.id)
      .sort((left, right) => left.properties.distance_km - right.properties.distance_km)
      .map((route, rank) => {
        const hut = data.huts.find(item => item.properties.id === route.properties.hut_id);
        return hut ? { id: route.properties.id, feature: hut, routeFeature: route, rank, path: route.geometry.coordinates[0], routeKm: route.properties.distance_km, trailNodeCount: route.properties.trail_node_count, source: route.properties.source, facts: routeFacts(route) } : null;
      }).filter(Boolean);
  }, [data.hutRoutes, data.huts, selectedPeak]);
  const activeHutId = routeOptions.some(entry => entry.feature.properties.id === selectedHutId) ? selectedHutId : null;
  const routeCandidates = useMemo(() => routeOptions.map(entry => ({ ...entry, visible: routeViewMode === "all" || (routeViewMode === "single" && entry.feature.properties.id === activeHutId), active: routeViewMode === "single" && entry.feature.properties.id === activeHutId })), [activeHutId, routeOptions, routeViewMode]);
  const visibleRouteCandidates = useMemo(() => routeCandidates.filter(candidate => candidate.visible), [routeCandidates]);
  const activeRoute = routeCandidates.find(candidate => candidate.active) || null;
  const activeTrailReport = trailReports.find(report => report.id === activeReportId) || null;
  const clearMarkers = ref => { ref.current.forEach(marker => marker.remove()); ref.current = []; };
  const resetView = useCallback(() => { mapRef.current?.resetView(); setMapStatus("map3d"); }, []);
  const focusPeak = useCallback((peak, close = false) => { if (!mapRef.current || !peak) return; mapRef.current.focusPeak(peak, close); setMapStatus(close ? "summitFocused" : "selectedSummit"); }, []);
  const focusRouteCandidates = useCallback((candidates, summit = selectedPeak) => { const entries = Array.isArray(candidates) ? candidates : [candidates]; mapRef.current?.focusRoutes(entries, summit); setMapStatus(entries.length > 1 ? "routesAll" : "routeShown"); }, [selectedPeak]);
  const selectPeak = useCallback(peak => { setSelectedPeakId(peak.properties.id); setSelectedHutId(null); setRouteViewMode("none"); setDetailsPanelCollapsed(false); setSheet(current => current === "peek" ? "half" : current); if (summitPanelRef.current) summitPanelRef.current.scrollTop = 0; focusPeak(peak); }, [focusPeak]);
  const selectRoute = useCallback(candidate => { setSelectedHutId(candidate.feature.properties.id); setRouteViewMode("single"); focusRouteCandidates(candidate); }, [focusRouteCandidates]);
  const pickFromCombo = peak => { selectPeak(peak); setQuery(""); setComboOpen(false); searchRef.current?.blur(); };
  const comboKey = event => {
    if (event.key === "ArrowDown") { event.preventDefault(); setComboOpen(true); setActiveIndex(index => Math.min(index + 1, filteredPeaks.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(index => Math.max(index - 1, 0)); }
    else if (event.key === "Enter" && filteredPeaks[activeIndex]) { event.preventDefault(); pickFromCombo(filteredPeaks[activeIndex]); }
    else if (event.key === "Escape" && comboOpen) { event.preventDefault(); setComboOpen(false); }
  };
  const openChooser = () => { setComboOpen(true); setPendingFocus("search"); };
  const skipToDetails = event => { event.preventDefault(); setDetailsPanelCollapsed(false); setSheet(current => current === "peek" ? "half" : current); setPendingFocus("details"); };
  const cancelNotePlacement = useCallback(() => { reportPlacementActiveRef.current = false; setReportPlacementActive(false); setDetailsPanelCollapsed(false); setSheet("half"); setPendingFocus("note"); }, []);
  const clearSelection = useCallback(() => { setSelectedPeakId(null); setSelectedHutId(null); setRouteViewMode("none"); setDetailsPanelCollapsed(false); if (summitPanelRef.current) summitPanelRef.current.scrollTop = 0; resetView(); }, [resetView]);
  const enterExplorer = (peak = null) => { setShowCover(false); setPendingFocus("details"); if (peak) selectPeak(peak); else if (!selectedPeak) setSheet("half"); };
  const cycleSheet = () => setSheet(current => current === "peek" ? "half" : current === "half" ? "full" : "peek");

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const changed = () => setIsMobile(media.matches);
    changed(); media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (!comboOpen) return undefined;
    const outside = event => { if (!comboRef.current?.contains(event.target)) setComboOpen(false); };
    document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside);
  }, [comboOpen]);
  useEffect(() => { document.getElementById(`peak-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" }); }, [activeIndex, comboOpen]);
  useLayoutEffect(() => { if (showCover) coverEnterRef.current?.focus(); }, [showCover]);
  useEffect(() => {
    if (!showCover) return undefined;
    const leave = event => { if (event.key === "Escape") { event.preventDefault(); setShowCover(false); setPendingFocus("details"); } };
    window.addEventListener("keydown", leave); return () => window.removeEventListener("keydown", leave);
  }, [showCover]);
  useLayoutEffect(() => {
    if (!pendingFocus) return;
    const target = pendingFocus === "details" ? summitHeadingRef.current || summitPanelRef.current : pendingFocus === "note" ? noteButtonRef.current : searchRef.current;
    target?.focus(); setPendingFocus(null);
  }, [pendingFocus, detailsPanelCollapsed, sheet, isMobile]);

  useEffect(() => {
    document.documentElement.lang = language; document.title = t("appTitle"); document.querySelector('meta[name="description"]')?.setAttribute("content", t("appDescription"));
  }, [language, t]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 8000); return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const onStorage = event => {
      if ([WORKSPACE_KEY, LEGACY_REPORTS_KEY, null].includes(event.key)) setWorkspaceState(readWorkspace(browserStorage()));
      if ([PREFERENCES_KEY, null].includes(event.key)) setLanguage(readLanguage(browserStorage()));
    };
    window.addEventListener("storage", onStorage); return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    if (dataPhase !== "ready") return undefined;
    const applyLink = () => {
      const plan = parsePlanHash(window.location.hash);
      const peak = data.peaks.find(item => item.properties.id === plan.peakId);
      const route = data.hutRoutes.find(item => item.properties.id === plan.routeId);
      if (plan.invalid || (plan.peakId && !peak) || (plan.routeId && !route)) setNotice("invalidSharedPlan");
      setSelectedPeakId(peak?.properties.id || null);
      setSelectedHutId(route && peak ? route.properties.hut_id : null); setRouteViewMode(route && peak ? "single" : "none");
      if (plan.language) setLanguage(plan.language);
      if (mapRef.current && route && peak) focusRouteCandidates({ path: route.geometry.coordinates[0], routeFeature: route, feature: data.huts.find(hut => hut.properties.id === route.properties.hut_id) }, peak);
      else if (mapRef.current && peak) focusPeak(peak);
    };
    if (!initialLinkChecked.current) { applyLink(); initialLinkChecked.current = true; }
    window.addEventListener("hashchange", applyLink); return () => window.removeEventListener("hashchange", applyLink);
  }, [dataPhase, data.peaks, data.huts, data.hutRoutes, focusPeak, focusRouteCandidates]);
  useEffect(() => {
    if (dataPhase !== "ready" || !initialLinkChecked.current) return;
    if (!selectedPeak) { window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`); return; }
    const url = sharedPlanUrl(window.location.href, selectedPeak.properties.id, activeRoute?.id, language);
    window.history.replaceState(null, "", url);
  }, [dataPhase, selectedPeak, activeRoute?.id, language]);
  useEffect(() => {
    if (!mapNode.current || !disclaimerAccepted) return undefined;
    if (APP_CONFIG.configurationUnavailable) { setMapPhase("config-error"); setMapStatus("configurationUnavailable"); return undefined; }
    if (APP_CONFIG.offlineLaunch || (navigator.onLine === false && mapRevision === 0)) { setMapPhase("offline"); setMapStatus("offlinePlanning"); return undefined; }
    initialCameraFramed.current = false; setMapPhase("loading");
    let cancelled = false; const controller = new AbortController();
    createCesiumMap(mapNode.current, APP_CONFIG.ionAccessToken, { signal: controller.signal, onMove: setCoords, onClick: point => {
      if (!reportPlacementActiveRef.current) return;
      reportPlacementActiveRef.current = false; setReportPlacementActive(false); setDetailsPanelCollapsed(false); setSheet("half"); setActionError("");
      setReportDraft({ longitude: point.lon, latitude: point.lat, severity: "blocked", note: "" }); setMapStatus("reportDescribe");
    } }).then(map => { if (cancelled) { map.destroy(); return; } mapRef.current = map; setMapPhase("ready"); setMapStatus("map3d"); })
      .catch(() => { if (!cancelled) { setMapPhase("error"); setMapStatus("mapUnavailable"); } });
    return () => { cancelled = true; controller.abort(); clearMarkers(peakMarkersRef); clearMarkers(hutMarkersRef); clearMarkers(reportMarkersRef); mapRef.current?.destroy(); mapRef.current = null; };
  }, [mapRevision, disclaimerAccepted]);
  useEffect(() => {
    if (mapPhase !== "ready" || dataPhase !== "ready" || initialCameraFramed.current) return;
    initialCameraFramed.current = true;
    mapRef.current.setOverview(data.peaks);
    if (activeRoute) focusRouteCandidates(activeRoute);
    else if (selectedPeak) focusPeak(selectedPeak);
    else mapRef.current.resetView(0);
  }, [mapPhase, dataPhase, activeRoute, selectedPeak, data.peaks, focusPeak, focusRouteCandidates]);
  useEffect(() => { if (mapPhase === "ready") mapRef.current?.refreshLayout(); }, [mapPhase, detailsPanelCollapsed, sheet, language]);
  useEffect(() => {
    const map = mapRef.current; if (!map || mapPhase !== "ready") return;
    clearMarkers(peakMarkersRef);
    data.peaks.forEach(peak => {
      const element = makePeakMarkerElement(peak.properties.id === selectedPeak?.properties.id, placeName(peak, language));
      element.title = placeName(peak, language); element.setAttribute("aria-label", `${placeName(peak, language)} · ${peak.properties.elevation_m} ${t("metreUnit")}`);
      element.addEventListener("click", event => { event.stopPropagation(); selectPeak(peak); });
      peakMarkersRef.current.push(map.addMarker(element, peak.geometry.coordinates, peak.properties.elevation_m));
    });
  }, [data.peaks, mapPhase, selectedPeak, language, selectPeak, t]);
  useEffect(() => {
    const map = mapRef.current; if (!map || mapPhase !== "ready") return;
    map.setRoutes(visibleRouteCandidates.map(candidate => ({ ...candidate, color: ROUTE_COLORS[candidate.rank] || ROUTE_COLORS[0], approximate: candidate.routeFeature.properties.geometry_kind === "approximate" })));
    // Route geometry is independent of labels, language, pointer coordinates and
    // forecasts. Keep it mounted until the actual route selection changes.
  }, [mapPhase, visibleRouteCandidates]);
  useEffect(() => {
    const map = mapRef.current; if (!map || mapPhase !== "ready") return;
    clearMarkers(hutMarkersRef);
    visibleRouteCandidates.forEach(candidate => {
      const props = candidate.feature.properties, element = makeHutMarkerElement(ROUTE_COLORS[candidate.rank], candidate.active);
      element.title = placeName(candidate.feature, language); element.setAttribute("aria-label", element.title);
      element.addEventListener("click", event => { event.stopPropagation(); selectRoute(candidate); });
      hutMarkersRef.current.push(map.addMarker(element, candidate.feature.geometry.coordinates, props.elevation_m ?? candidate.routeFeature.properties.profile_elevations_m?.[0] ?? 1900));
    });
  }, [mapPhase, visibleRouteCandidates, language, selectRoute]);
  useEffect(() => {
    const map = mapRef.current; if (!map || mapPhase !== "ready") return;
    clearMarkers(reportMarkersRef);
    trailReports.filter(report => !report.resolvedAt).forEach(report => {
      const element = document.createElement("button"); element.type = "button"; element.className = `map-report-marker${report.id === activeReportId ? " active" : ""}`;
      element.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M6 17l5-6-2 1 3-7 3 7-2-1 5 6"/></svg>';
      element.tabIndex = -1; // Every note has a keyboard-accessible personal-library entry.
      element.title = `${t("reportHeading")} · ${t(report.severity)}`; element.setAttribute("aria-label", element.title);
      element.addEventListener("click", event => { event.stopPropagation(); setActionError(""); setActiveReportId(report.id); });
      reportMarkersRef.current.push(map.addMarker(element, [report.longitude, report.latitude]));
    });
  }, [activeReportId, mapPhase, trailReports, t]);
  useEffect(() => {
    if (!activeRoute?.id) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    summitPanelRef.current?.querySelector(".v2-plan")?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [activeRoute?.id]);
  useLayoutEffect(() => { if (reportPlacementActive) placementCancelRef.current?.focus(); }, [reportPlacementActive]);
  useEffect(() => {
    reportPlacementActiveRef.current = reportPlacementActive;
    if (!reportPlacementActive) return undefined;
    const cancel = event => { if (event.key === "Escape") { event.preventDefault(); cancelNotePlacement(); } };
    window.addEventListener("keydown", cancel); return () => window.removeEventListener("keydown", cancel);
  }, [reportPlacementActive, cancelNotePlacement]);

  const persistWorkspace = useCallback((next, recover = false) => {
    try { setWorkspaceState(commitWorkspace(browserStorage(), next, workspaceState, { recover })); setActionError(""); return true; }
    catch (error) { const code = error.code || "storageUnavailable"; setNotice(code); setActionError(code); return false; }
  }, [workspaceState]);
  const switchLanguage = () => { const next = language === "bg" ? "en" : "bg"; setLanguage(next); if (!writeLanguage(browserStorage(), next)) setNotice("storageUnavailable"); };
  const savePlan = useCallback(() => {
    if (!activeRoute || !selectedPeak || workspace.plans.some(plan => plan.routeId === activeRoute.id)) return;
    const plan = { routeId: activeRoute.id, peakId: selectedPeak.properties.id, hutId: activeRoute.feature.properties.id, savedAt: new Date().toISOString() };
    if (persistWorkspace({ ...workspace, plans: [...workspace.plans, plan] })) setNotice("planSaved");
  }, [activeRoute, selectedPeak, workspace, persistWorkspace]);
  const openPlan = useCallback(plan => {
    const selection = resolveSavedPlan(data, plan); if (!selection) { setNotice("invalidSharedPlan"); return; }
    setSelectedPeakId(selection.peak.properties.id); setSelectedHutId(selection.candidate.feature.properties.id); setRouteViewMode("single"); setDetailsPanelCollapsed(false);
    focusRouteCandidates(selection.candidate, selection.peak);
  }, [data.hutRoutes, data.peaks, data.huts, focusRouteCandidates]);
  const removePlan = useCallback(id => { if (persistWorkspace({ ...workspace, plans: workspace.plans.filter(plan => plan.routeId !== id) })) setNotice("planRemoved"); }, [workspace, persistWorkspace]);
  const sharePlan = useCallback(() => { if (selectedPeak) { setActionError(""); setShareUrl(sharedPlanUrl(window.location.href, selectedPeak.properties.id, activeRoute?.id, language)); } }, [selectedPeak, activeRoute?.id, language]);
  const exportGpx = useCallback(() => {
    if (!activeRoute || !selectedPeak) return;
    try { setFileExport({ kind: "gpx", content: createGpx(activeRoute.routeFeature, selectedPeak, activeRoute.feature, language), filename: `${activeRoute.id}.gpx`, type: "application/gpx+xml" }); }
    catch { setNotice("gpxUnavailable"); }
  }, [activeRoute, selectedPeak, language]);
  const exportBackup = useCallback(() => {
    try { setFileExport({ kind: "backup", content: createBackup(workspace), filename: `vitosha-backup-${new Date().toISOString().slice(0, 10)}.json`, type: "application/json" }); }
    catch { setNotice("invalidBackup"); }
  }, [workspace]);
  const exportOriginal = useCallback(() => setFileExport({ kind: "original", content: workspaceState.raw ?? workspaceState.legacyRaw ?? "", filename: "vitosha-unreadable-original.json", type: "text/plain" }), [workspaceState]);
  const startImport = useCallback(() => importInputRef.current?.click(), []);
  const reloadLocal = useCallback(() => { setWorkspaceState(readWorkspace(browserStorage())); setActionError(""); setNotice(""); }, []);
  const addNote = useCallback(() => { if (mapPhase !== "ready") { setNotice("mapRequiredForNote"); return; } setDetailsPanelCollapsed(true); setSheet("peek"); setActionError(""); reportPlacementActiveRef.current = true; setReportPlacementActive(true); }, [mapPhase]);
  const addCoordinateNote = useCallback(() => { reportPlacementActiveRef.current = false; setReportPlacementActive(false); setActionError(""); setReportDraft({ manualCoordinates: true, longitude: "", latitude: "", severity: "blocked", note: "" }); }, []);
  const openNote = useCallback(id => { setActionError(""); setActiveReportId(id); }, []);
  const saveNote = event => {
    event.preventDefault(); if (!reportDraft) return;
    const coordinates = parseNoteCoordinates(reportDraft.longitude, reportDraft.latitude);
    if (!coordinates) { setActionError("invalidNoteCoordinates"); return; }
    const report = { ...coordinates, severity: reportDraft.severity, note: reportDraft.note, id: `fallen-tree-${crypto.randomUUID()}`, createdAt: new Date().toISOString(), reviewedAt: null, resolvedAt: null };
    if (persistWorkspace({ ...workspace, reports: [...trailReports, report] })) { setReportDraft(null); setActiveReportId(report.id); setNotice("noteSaved"); }
  };
  const updateNote = (id, changes) => { if (persistWorkspace({ ...workspace, reports: trailReports.map(report => report.id === id ? { ...report, ...changes } : report) })) setNotice("noteUpdated"); };
  const closeNote = () => { setReportDraft(null); setActiveReportId(null); setActionError(""); };
  const importFile = async event => {
    const file = event.target.files?.[0], revision = ++importRevision.current; event.target.value = ""; if (!file) return;
    try { if (file.size > MAX_BACKUP_BYTES) throw new Error(); const imported = parseBackup(await file.text()); if (revision === importRevision.current) { setActionError(""); setImportPreview(imported); } }
    catch { if (revision === importRevision.current) setNotice("invalidBackup"); }
  };
  const finishImport = () => {
    try { if (persistWorkspace(mergeWorkspaces(workspace, importPreview), workspaceState.error === "storageInvalid")) { setImportPreview(null); setNotice("importComplete"); } }
    catch { setActionError("invalidBackup"); }
  };
  const metre = value => Number.isFinite(value) ? `${formatNumber(value, language, 0)} ${t("metreUnit")}` : "—";
  const km = value => `${formatNumber(value, language)} ${t("kilometreUnit")}`;
  const duration = minutes => minutes >= 60 ? t("durationHm", { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, "0") }) : t("durationM", { m: minutes });
  const status = t(dataPhase === "ready" ? "dataReady" : dataPhase === "error" ? "dataError" : "dataLoading");
  const nearest = routeOptions[0];
  const panelOpen = isMobile || !detailsPanelCollapsed;
  const toggleAllRoutes = () => { if (routeViewMode === "all") { setRouteViewMode("none"); setSelectedHutId(null); } else { setSelectedHutId(null); setRouteViewMode("all"); focusRouteCandidates(routeCandidates); } };

  const approachRows = routeCandidates.map(candidate => {
    const props = candidate.feature.properties, approximate = candidate.routeFeature.properties.geometry_kind === "approximate", facts = candidate.facts;
    return html`<li key=${props.id} className=${`approach-row ${candidate.active ? "active" : ""} ${approximate ? "approximate" : ""}`} style=${{ "--route": ROUTE_COLORS[candidate.rank] }}>
      <button type="button" className="approach-select" aria-pressed=${candidate.active} onClick=${() => selectRoute(candidate)}>
        <span className="approach-name"><strong>${placeName(candidate.feature, language)}</strong><small>${metre(props.elevation_m)} · ${t(approximate ? "sketchShort" : "routedShort")}</small></span>
        <span className="approach-stats">
          <span><b>${km(candidate.routeKm)}</b><small>${t("distanceShort")}</small></span>
          <span><b>${facts ? `↑ ${metre(facts.ascent)}` : "—"}</b><small>${t("climbShort")}</small></span>
          <span><b>${facts ? duration(climbMinutes(candidate.routeKm, facts.ascent)) : "—"}</b><small>${t("timeShort")}</small></span>
        </span>
      </button>
      <a className="approach-link" href=${hutUrl(props, language)} target="_blank" rel="noopener noreferrer">${t(BOOKING_LINKS[props.id] ? "hutWebsite" : "hutSearch")}<${Icon} component=${ExternalLink} size=${12}/></a>
    </li>`;
  });

  return html`<main className="app-shell v2"><div className="app-content">
    <nav className="skip-navigation surface" inert=${showCover} aria-label=${t("quickNavigation")}><a href="#peak-search" onClick=${event => { event.preventDefault(); openChooser(); }}>${t("skipToSummits")}</a><a href="#summit-details" onClick=${skipToDetails}>${t("skipToDetails")}</a></nav>
    <p className="sr-only" role="status" aria-atomic="true">${selectedPeak ? activeRoute ? t("approachAnnouncement", { hut: placeName(activeRoute.feature, language), peak: placeName(selectedPeak, language) }) : t("selectionAnnouncement", { peak: placeName(selectedPeak, language) }) : ""}</p>
    <div ref=${mapNode} className=${`map-canvas ${reportPlacementActive ? "is-reporting" : ""}`} role="region" aria-label=${t("mapRegion")} aria-busy=${mapPhase === "loading"}></div>
    <${ConnectionStatus} mapPhase=${mapPhase} dataPhase=${dataPhase} onRetryData=${retryData} onRetryMap=${retryMap} offline=${offlineState.offline} language=${language} />
    ${notice ? html`<div className="action-notice surface" role="status" aria-live="polite"><span>${t(notice)}</span><button type="button" className="icon-button" aria-label=${t("close")} onClick=${() => setNotice("")}><${Icon} component=${X} size=${16}/></button></div>` : null}
    ${reportPlacementActive ? html`<div className="trail-report-placement" role="status"><${Icon} component=${TreePine} size=${20}/><span><strong>${t("reportPlacement")}</strong><small>${t("reportPlacementHint")}</small></span><button ref=${placementCancelRef} type="button" onClick=${cancelNotePlacement} aria-label=${t("cancel")}><${Icon} component=${X} size=${18}/></button></div>` : null}
    ${reportDraft || activeTrailReport ? html`<${ReportDialog} language=${language} draft=${reportDraft} report=${activeTrailReport} onClose=${closeNote} returnFocus=${() => noteButtonRef.current} onDraftChange=${setReportDraft} onSave=${saveNote} onUpdate=${updateNote} error=${actionError}/>` : null}
    ${disclaimerAccepted || showCover ? null : html`<${SafetyDisclaimer} onAccept=${() => setDisclaimerAccepted(true)} returnFocus=${() => summitPanelRef.current}/>`}
    ${fileExport ? html`<${FileExportDialog} language=${language} file=${fileExport} onClose=${() => setFileExport(null)}/>` : null}
    ${shareUrl ? html`<${PlanningDialog} titleId="share-title" onClose=${() => setShareUrl("")}><header className="dialog-header"><h2 id="share-title">${t("shareHeading")}</h2><button type="button" className="icon-button" onClick=${() => setShareUrl("")} aria-label=${t("close")}><${Icon} component=${X}/></button></header><p>${t("shareNote")}</p><label className="share-field"><span>${t("shareHeading")}</span><input data-initial-focus value=${shareUrl} readOnly onFocus=${event => event.target.select()}/></label><button type="button" className="route-show-button" onClick=${async () => { try { await navigator.clipboard.writeText(shareUrl); setActionError("linkCopied"); } catch { setActionError("manualCopy"); } }}>${t("copyLink")}</button>${actionError ? html`<p role="status">${t(actionError)}</p>` : null}</${PlanningDialog}>` : null}
    ${importPreview ? html`<${PlanningDialog} titleId="import-title" onClose=${() => setImportPreview(null)}><header className="dialog-header"><h2 id="import-title">${t("importHeading")}</h2><button type="button" className="icon-button" onClick=${() => setImportPreview(null)} aria-label=${t("close")}><${Icon} component=${X}/></button></header><p>${t("importPreview", { plans: importPreview.plans.length, reports: importPreview.reports.length })}</p>${workspaceState.error ? html`<p className="storage-state">${t(workspaceState.error)}</p>` : null}<div className="plan-actions"><button type="button" className="route-show-button" onClick=${() => setImportPreview(null)}>${t("cancel")}</button><button type="button" className="route-show-button active" onClick=${finishImport}>${t(workspaceState.error === "storageInvalid" ? "recoveryConfirm" : "importConfirm")}</button></div>${actionError ? html`<p className="storage-state" role="alert">${t(actionError)}</p>` : null}</${PlanningDialog}>` : null}
    ${showCover ? html`<section className="v2-cover" aria-labelledby="cover-title">
      <img className="v2-cover-photo" src=${`${COVER_BASE}/vitosha-cover-1800.webp`} srcSet=${`${COVER_BASE}/vitosha-cover-1000.webp 1000w, ${COVER_BASE}/vitosha-cover-1800.webp 1800w`} sizes="100vw" alt=${t("coverPhotoAlt")} decoding="async" fetchpriority="high"/>
      <div className="v2-cover-top"><span className="v2-cover-brand"><span className="v2-brand-mark"><${Icon} component=${Mountain} size=${18}/></span>${t("brandTagline")}</span><button type="button" className="v2-chip-button" title=${t("languageSwitch")} aria-label=${t("languageSwitch")} onClick=${switchLanguage}>${language === "bg" ? "EN" : "БГ"}</button></div>
      <div className="v2-cover-body">
        <h1 id="cover-title">${t("brandName")}</h1>
        <p className="v2-cover-lead">${t("coverLead")}</p>
        ${dataPhase === "ready" ? html`<p className="v2-cover-stats">${t("coverStats", { peaks: data.peaks.length, huts: data.huts.length, routes: data.hutRoutes.length })}</p>` : null}
        <button ref=${coverEnterRef} type="button" className="v2-cover-enter" onClick=${() => enterExplorer()}>${t("coverEnter")} →</button>
        ${dataPhase === "ready" ? html`<div className="v2-cover-peaks"><span>${t("coverStartFrom")}</span>${[...data.peaks].sort((left, right) => right.properties.elevation_m - left.properties.elevation_m).slice(0, 3).map(peak => html`<button type="button" key=${peak.properties.id} onClick=${() => enterExplorer(peak)}>${placeName(peak, language)} <b>${metre(peak.properties.elevation_m)}</b></button>`)}</div>` : null}
      </div>
    </section>` : null}
    <input ref=${importInputRef} type="file" accept=".json,application/json" hidden onChange=${importFile} aria-label=${t("importBackup")}/>

    <header className="v2-topbar" inert=${showCover} data-map-occluder>
      <button ref=${brandRef} type="button" className="v2-brand" title=${t("backToCover")} aria-label=${t("backToCover")} onClick=${() => setShowCover(true)}><span className="v2-brand-mark"><${Icon} component=${Mountain} size=${18}/></span><span><strong>${t("brandName")}</strong><small>${t("brandTagline")}</small></span></button>
      <div ref=${comboRef} className=${`v2-search ${comboOpen ? "open" : ""}`}>
        <label className="v2-search-field"><${Icon} component=${Search} size=${17}/><input ref=${searchRef} id="peak-search" role="combobox" aria-expanded=${comboOpen} aria-controls="peak-options" aria-autocomplete="list" aria-activedescendant=${comboOpen && filteredPeaks[activeIndex] ? `peak-option-${activeIndex}` : undefined} value=${query} placeholder=${t("findSummit")} aria-label=${t("searchSummit")} onFocus=${() => setComboOpen(true)} onInput=${event => { setQuery(event.target.value); setActiveIndex(0); setComboOpen(true); }} onKeyDown=${comboKey}/><span className="v2-search-count">${t("summitCount", { count: data.peaks.length })}</span><button type="button" className="v2-search-toggle" tabIndex="-1" aria-label=${t("toggleSummitList")} aria-expanded=${comboOpen} aria-controls="peak-options" onPointerDown=${event => event.preventDefault()} onClick=${() => { setComboOpen(open => !open); searchRef.current?.focus(); }}><${Icon} component=${ChevronDown} size=${18}/></button></label>
        ${comboOpen ? html`<div className="v2-search-menu">
          <div className="v2-sort" role="group" aria-label=${t("sortSummits")}><button type="button" aria-pressed=${sortMode === "elevation-desc"} onClick=${() => setSortMode("elevation-desc")}>${t("elevation")}</button><button type="button" aria-pressed=${sortMode === "name"} onClick=${() => setSortMode("name")}>${t("alphabetical")}</button></div>
          <ul id="peak-options" role="listbox" aria-label=${t("chooseSummit")}>${filteredPeaks.length ? filteredPeaks.map((peak, index) => html`<li key=${peak.properties.id} id=${`peak-option-${index}`} role="option" aria-selected=${index === activeIndex} className=${`${index === activeIndex ? "active" : ""} ${peak.properties.id === selectedPeak?.properties.id ? "current" : ""}`} onPointerDown=${event => event.preventDefault()} onClick=${() => pickFromCombo(peak)} onPointerMove=${() => setActiveIndex(index)}><${Icon} component=${Mountain} size=${15}/><span>${placeName(peak, language)}<small>${peak.properties[language === "bg" ? "name_en" : "name_bg"]}</small></span><b>${metre(peak.properties.elevation_m)}</b></li>`) : html`<li className="v2-empty" role="presentation">${t("noSummits")} ${t("searchHint")}</li>`}</ul>
        </div>` : null}
        <p className="sr-only" role="status" aria-atomic="true">${comboOpen && dataPhase === "ready" ? t("matchingSummits", { count: filteredPeaks.length }) : ""}</p>
      </div>
      <button type="button" className="v2-chip-button" title=${t("languageSwitch")} aria-label=${t("languageSwitch")} onClick=${switchLanguage}>${language === "bg" ? "EN" : "БГ"}</button>
    </header>

    <aside ref=${summitPanelRef} id="summit-details" tabIndex="-1" className=${`v2-panel sheet-${sheet} ${detailsPanelCollapsed ? "collapsed" : ""}`} inert=${showCover} aria-label=${t("details")} data-map-occluder>
      ${isMobile ? html`<button type="button" className="v2-sheet-handle" aria-label=${t(sheet === "full" ? "collapsePanel" : "expandPanel")} onClick=${cycleSheet}><span></span></button>` : null}
      ${selectedPeak ? html`<header className="v2-hero">
        <div><small>${t("summitEyebrow")}</small><h1 ref=${summitHeadingRef} tabIndex="-1">${placeName(selectedPeak, language)}</h1>${nearest ? html`<p>${t("nearestStart", { hut: placeName(nearest.feature, language), distance: km(nearest.routeKm) })}</p>` : null}</div>
        <div className="v2-hero-side"><strong>${formatNumber(selectedPeak.properties.elevation_m, language, 0)}<small> ${t("metreUnit")}</small></strong><div className="v2-hero-actions"><button type="button" className="v2-icon" title=${t("clearSelection")} aria-label=${t("clearSelection")} onClick=${clearSelection}><${Icon} component=${X}/></button>${isMobile ? null : html`<button type="button" className="v2-icon" title=${t(detailsPanelCollapsed ? "expandPanel" : "collapsePanel")} aria-label=${t(detailsPanelCollapsed ? "expandPanel" : "collapsePanel")} aria-expanded=${!detailsPanelCollapsed} aria-controls="summit-content" onClick=${() => setDetailsPanelCollapsed(value => !value)}><${Icon} component=${detailsPanelCollapsed ? ChevronDown : ChevronUp}/></button>`}</div></div>
      </header>` : html`<header className="v2-hero"><div><small>${t("overviewEyebrow")}</small><h1 ref=${summitHeadingRef} tabIndex="-1">${t("brandName")}</h1><p>${t("overviewLead")}</p></div></header>`}
      <div id="summit-content" className="v2-content" hidden=${!panelOpen}>
      ${selectedPeak ? null : html`<section className="v2-section" aria-labelledby="all-summits-heading"><div className="v2-section-head"><h2 id="all-summits-heading">${t("allSummits")}</h2><span className="v2-muted">${t("summitCount", { count: data.peaks.length })}</span></div><ul className="v2-summit-list">${[...data.peaks].sort((left, right) => right.properties.elevation_m - left.properties.elevation_m).map(peak => html`<li key=${peak.properties.id}><button type="button" onClick=${() => selectPeak(peak)}><${Icon} component=${Mountain} size=${15}/><span>${placeName(peak, language)}</span><b>${metre(peak.properties.elevation_m)}</b></button></li>`)}</ul></section>`}
      ${selectedPeak ? html`
        <section className="v2-section" aria-labelledby="approaches-heading">
          <div className="v2-section-head"><h2 id="approaches-heading">${t("whereToStart")}</h2><button type="button" className="v2-link" aria-pressed=${routeViewMode === "all"} disabled=${!routeCandidates.length || mapPhase !== "ready"} onClick=${toggleAllRoutes}>${t(routeViewMode === "all" ? "hideFromMap" : "showOnMapAll")}</button></div>
          ${routeCandidates.length ? html`<ul className="v2-approaches">${approachRows}</ul><p className="v2-fineprint">${t("timeEstimateNote")} ${t("routeSelectionNote")}</p>` : html`<p className="v2-fineprint">${t("noApproaches")}</p>`}
        </section>
        ${activeRoute ? html`<section className="v2-section v2-plan" style=${{ "--route": ROUTE_COLORS[activeRoute.rank] }}><${ApproachPlanner} language=${language} peak=${selectedPeak} route=${activeRoute} saved=${workspace.plans.some(plan => plan.routeId === activeRoute.id)} onSave=${savePlan} onShare=${sharePlan} onGpx=${exportGpx}/></section>` : null}
        <details className="v2-drawer" open=${weatherExpanded} onToggle=${event => setWeatherExpanded(event.currentTarget.open)}><summary><${Icon} component=${CloudSun} size=${18}/><span>${t("weather")}</span><${Icon} component=${ChevronDown} size=${16}/></summary><div className="v2-drawer-body" id="summit-weather"><${SummitWeather} key=${selectedPeak.properties.id} peak=${selectedPeak} active=${weatherExpanded && panelOpen} offline=${offlineState.offline} configurationUnavailable=${APP_CONFIG.configurationUnavailable} language=${language} evaluation=${APP_CONFIG.evaluation}/></div></details>` : null}
        <details className="v2-drawer"><summary><${Icon} component=${MapPinned} size=${18}/><span>${t("myPlansNotes")}</span><b className="v2-count">${workspace.plans.length + workspace.reports.length}</b><${Icon} component=${ChevronDown} size=${16}/></summary><div className="v2-drawer-body"><${PersonalLibrary} language=${language} workspaceState=${workspaceState} data=${data} mapReady=${mapPhase === "ready"} noteButtonRef=${noteButtonRef} onOpenPlan=${openPlan} onRemovePlan=${removePlan} onExport=${exportBackup} onImport=${startImport} onReload=${reloadLocal} onOriginal=${exportOriginal} onAddNote=${addNote} onCoordinateNote=${addCoordinateNote} onOpenNote=${openNote}/></div></details>
        <details className="v2-drawer"><summary><${Icon} component=${CircleHelp} size=${18}/><span>${t("aboutData")}</span><${Icon} component=${ChevronDown} size=${16}/></summary><div className="v2-drawer-body">
          ${selectedPeak ? html`<h3 className="v2-subhead">${t("summitData")}</h3><dl className="v2-facts"><div><dt>${t("altitude")}</dt><dd>${metre(selectedPeak.properties.elevation_m)}</dd></div><div><dt>${t("latitude")}</dt><dd>${formatCoord(selectedPeak.geometry.coordinates[1])}</dd></div><div><dt>${t("longitude")}</dt><dd>${formatCoord(selectedPeak.geometry.coordinates[0])}</dd></div><div><dt>${t("source")}</dt><dd>${t("osmNode", { id: selectedPeak.properties.osm_id })}</dd></div></dl><p className="v2-fineprint">${t("peakSourceNote")}</p><h3 className="v2-subhead">${t("routeHelpTitle")}</h3><p className="v2-fineprint">${t("routeHelpText")} ${t("planningWarning")}</p>` : null}
          <${OfflineFactsPanel} language=${language} state=${offlineState} quality=${data.quality}/>
        </div></details>
      </div>
    </aside>

    <div className="v2-map-controls" inert=${showCover} role="group" aria-label=${t("mapControls")} data-map-occluder>
      <button type="button" className="v2-icon" title=${t("zoomSummit")} aria-label=${t("zoomSummit")} disabled=${mapPhase !== "ready" || !selectedPeak} onClick=${() => focusPeak(selectedPeak, true)}><${Icon} component=${LocateFixed}/></button>
      <button type="button" className="v2-home-button" title=${t("homeView")} disabled=${mapPhase !== "ready" && !selectedPeak} onClick=${clearSelection}><${Icon} component=${RotateCcw}/><span>${t("homeView")}</span></button>
    </div>
    <p className="v2-readout" aria-live="off"><${Icon} component=${Navigation} size=${13}/> ${t(mapPhase === "offline" ? "offlinePlanning" : mapPhase === "config-error" ? "configurationUnavailable" : mapPhase === "error" ? "mapUnavailable" : mapStatus)}${coords ? ` · ${formatCoord(coords.lat)}, ${formatCoord(coords.lon)}` : ""} · ${status}</p>
  </div></main>`;
}
document.getElementById("boot-loader")?.remove();
createRoot(document.getElementById("root")).render(html`<${App}/>`);
