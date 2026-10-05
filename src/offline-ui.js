import React, { useCallback, useEffect, useRef, useState } from "react";
import htm from "htm";
import { translate, formatDate, formatNumber } from "./i18n.js?v=vitosha-accessibility-20261005-2";
import { ownedWorker, offlineWorkerStatus, prepareOfflinePack } from "./offline.js?v=vitosha-offline-20261005-2";
const html = htm.bind(React.createElement);
export function useOfflineFacts(offlineLaunch) {
  const [offline, setOffline] = useState(() => offlineLaunch || navigator.onLine === false);
  const [pack, setPack] = useState({ phase: "idle" });
  const aliveRef = useRef(false), preparationRef = useRef(false);
  const version = document.querySelector('meta[name="vitosha-offline-version"]')?.content;
  const supported = Boolean(version && "serviceWorker" in navigator && window.isSecureContext);
  useEffect(() => {
    const online = () => { if (!offlineLaunch) setOffline(false); }, lost = () => setOffline(true);
    window.addEventListener("online", online); window.addEventListener("offline", lost);
    aliveRef.current = true;
    if (supported) navigator.serviceWorker.getRegistration("/").then(async registration => {
      if (ownedWorker(registration?.active, location.origin)) {
        const status = await offlineWorkerStatus(registration.active);
        if (aliveRef.current && !preparationRef.current && status.ready) setPack({ phase: "ready", ...status });
      }
    }).catch(() => { /* The online app stays usable when CacheStorage is unavailable. */ });
    return () => { aliveRef.current = false; window.removeEventListener("online", online); window.removeEventListener("offline", lost); };
  }, [offlineLaunch, supported]);
  const prepare = useCallback(async () => {
    if (!supported || preparationRef.current) return;
    preparationRef.current = true;
    setPack(current => ({ ...current, phase: "preparing" }));
    try { const status = await prepareOfflinePack(navigator.serviceWorker, location.origin, { expectedId: version }); if (aliveRef.current) setPack({ phase: "ready", ...status }); }
    catch {
      let previous;
      try { const registration = await navigator.serviceWorker.getRegistration("/"); if (ownedWorker(registration?.active, location.origin)) previous = await offlineWorkerStatus(registration.active); } catch { /* Keep failure honest. */ }
      if (aliveRef.current) setPack({ phase: "error", ...(previous?.ready ? previous : {}) });
    } finally { preparationRef.current = false; }
  }, [supported, version]);
  return { offline, pack, prepare, supported, version };
}
export function OfflineFactsPanel({ language, state, quality }) {
  const t = (key, values) => translate(language, key, values), { pack, supported, prepare, version } = state;
  return html`<section className="offline-facts" aria-label=${t("offlineFacts")}><h3>${t("offlineFacts")}</h3><p>${t("offlinePackDescription")}</p>
    <p role="status">${pack.phase === "ready" ? t(pack.id === version ? "offlinePackReady" : "offlinePackOlder", { date: formatDate(pack.preparedAt, language), size: formatNumber(pack.bytes / 1024 / 1024, language, 1) }) : t(pack.phase === "preparing" ? "offlinePackPreparing" : pack.phase === "error" ? "offlinePackFailed" : supported ? "offlinePackNotReady" : "offlinePackPreview")}</p>
    ${pack.phase === "error" && pack.ready ? html`<p>${t("offlinePackPrevious", { date: formatDate(pack.preparedAt, language) })}</p>` : null}
    ${quality ? html`<p className="offline-snapshot">${t("offlineSourceSnapshots", { peaks: formatDate(quality.source_timestamps.peaks, language), huts: formatDate(quality.source_timestamps.huts, language) })}</p>` : null}
    ${supported ? html`<button type="button" className="route-show-button" disabled=${pack.phase === "preparing"} onClick=${prepare}>${t(pack.phase === "ready" ? "offlinePackRefresh" : "offlinePackPrepare")}</button>` : null}
    <small>${t("offlinePackLimits")}</small></section>`;
}
