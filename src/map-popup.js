import React from "react";
import htm from "htm";
import { House, Tent, X } from "@vitosha/icons";
import { formatNumber, placeName, translate } from "./i18n.js?v=vitosha-trails-20261119-3";
import { hutKindKey } from "./huts.js?v=vitosha-trails-20261119-3";
import { formatCheckedDate, formatEmailHref, formatPhoneHref, formatWebsiteHref, latestCheckedDate, visibleDetailRows } from "./hut-details.js?v=vitosha-trails-20261119-3";
import { trailColor } from "./trail-display.js?v=vitosha-trails-20261119-3";

const html = htm.bind(React.createElement);
export const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";
const networks = { lwn: "trailNetworkLwn", rwn: "trailNetworkRwn", nwn: "trailNetworkNwn", iwn: "trailNetworkIwn" };

function Source({ record, language, t }) {
  const source = t(record.source === "manual" ? "hutSourceManual" : "hutSourceOsm");
  return html`<small className="map-popup-source" title=${record.checked ? `${source} · ${formatCheckedDate(record.checked, language)}` : source}>${source}</small>`;
}

function HutFacts({ hut, language, t, approaches, peaks, routes, onApproach }) {
  const { details, osm_url: osm } = hut.properties;
  const rows = visibleDetailRows(details, language);
  const actions = [
    ["website", formatWebsiteHref, "hutActionWebsite"],
    ["phone", formatPhoneHref, "hutActionPhone"],
    ["email", formatEmailHref, "hutActionEmail"],
  ];
  const note = details[language === "bg" ? "notes_bg" : "notes_en"] || details.description;
  return html`<div className="map-popup-body">
    ${rows.length ? html`<dl className="map-popup-facts">${rows.map(row => html`
      <div key=${row.field}><dt>${row.label}</dt><dd>${row.display} <${Source} record=${row} language=${language} t=${t}/></dd></div>`)}</dl>` : null}
    <div className="map-popup-actions">${actions.map(([field, safeHref, label]) => {
      const record = details[field], href = safeHref(record?.value);
      if (!href) return null;
      return html`<a key=${field} href=${href} target=${field === "website" ? "_blank" : undefined} rel=${field === "website" ? "noopener noreferrer" : undefined} title=${record.value}>
        ${t(label)} <${Source} record=${record} language=${language} t=${t}/></a>`;
    })}<a href=${osm} target="_blank" rel="noopener noreferrer">${t("showInOsm")}</a></div>
    ${approaches.length ? html`<section className="map-popup-approaches" aria-labelledby="popup-approaches-title">
      <h3 id="popup-approaches-title">${t("summitsFromHere")}</h3>
      <ul>${approaches.map(approach => {
        const peak = peaks.get(approach.peakId), route = routes.get(approach.routeId);
        if (!peak || !route) return null;
        const markings = route.properties.marked_trails.filter(item => item.share >= 0.15);
        return html`<li key=${approach.routeId}><button type="button" onClick=${() => onApproach(approach, hut)}>
          <strong>${placeName(peak, language)}</strong>
          <span>${formatNumber(approach.distanceKm, language)} ${t("kilometreUnit")} · ${t(approach.approximate ? "approximate" : "modelledApproach")}</span>
          ${markings.length ? html`<span className="map-popup-marks" role="img" aria-label=${t("markedTrailLayer")}>${markings.map(item => html`<i key=${item.trail_id} aria-hidden="true" title=${item.ref || undefined} style=${{ "--trail-color": trailColor(item.colour) }}></i>`)}</span>` : null}
        </button></li>`;
      })}</ul>
    </section>` : null}
    ${note ? html`<p className="map-popup-blurb">${note.value} <${Source} record=${note} language=${language} t=${t}/></p>` : null}
  </div>`;
}

function TrailFacts({ feature, language, t }) {
  const props = feature.properties;
  const rows = [
    ["trailFrom", props.from], ["trailTo", props.to],
    ["markedTrailDistance", `${formatNumber(props.length_km, language, 2)} ${t("kilometreUnit")}`],
    ["markedTrailNetwork", props.network ? t(networks[props.network]) : null],
    ["hutOperator", props.operator],
  ];
  return html`<div className="map-popup-body">
    <dl className="map-popup-facts">${rows.filter(([, value]) => value).map(([label, value]) => html`<div key=${label}><dt>${t(label)}</dt><dd>${value}</dd></div>`)}</dl>
    <div className="map-popup-actions">
      <a href=${props.wmt_url} target="_blank" rel="noopener noreferrer">${t("showInWaymarked")}</a>
      <a href=${props.osm_url} target="_blank" rel="noopener noreferrer">OpenStreetMap</a>
    </div>
  </div>`;
}

export function MapPopup({ popup, embedded, popupRef, onClose, onApproach, language, hutIndex, peaks, routes }) {
  const t = (key, values) => translate(language, key, values);
  const { feature, kind } = popup, props = feature.properties, isHut = kind === "hut";
  const title = placeName(feature, language) || props.ref || t("markedTrail");
  const otherLanguage = language === "bg" ? "en" : "bg";
  const alternateName = props[`name_${otherLanguage}`];
  const date = isHut ? latestCheckedDate(props.details) : null;
  const Icon = props.kind === "shelter" ? Tent : House;
  return html`<section ref=${popupRef}
    className=${`map-popup ${embedded ? "map-popup--embedded" : "map-popup--anchored"}`}
    data-kind=${kind}
    role="dialog" aria-modal="false" aria-labelledby="map-popup-title"
    style=${isHut ? undefined : { "--trail-color": trailColor(props.colour) }}>
    <div className="map-popup-card">
      <header className="map-popup-header">
        ${isHut ? html`<span className="map-popup-kind-icon"><${Icon} size=${22} aria-hidden="true"/></span>` : null}
        <div className="map-popup-titles">
          <span className="map-popup-kind">${t(isHut ? hutKindKey(feature) : "markedTrail")}${!isHut && props.ref && props.ref !== title ? ` · ${props.ref}` : ""}</span>
          <h2 id="map-popup-title" tabIndex="-1">${title}</h2>
          ${alternateName && alternateName !== title ? html`<p lang=${otherLanguage}>${alternateName}</p>` : null}
        </div>
        ${isHut && Number.isFinite(props.elevation_m) ? html`<span className="map-popup-elevation">${formatNumber(props.elevation_m, language, 0)} ${t("metreUnit")}</span>` : null}
        <button className="map-popup-close" type="button" onClick=${onClose} aria-label=${t("close")}><${X} size=${19} aria-hidden="true"/></button>
      </header>
      ${isHut ? html`<${HutFacts} hut=${feature} language=${language} t=${t} approaches=${hutIndex.get(props.id)?.approaches || []}
        peaks=${peaks} routes=${routes} onApproach=${onApproach}/>` : html`<${TrailFacts} feature=${feature} language=${language} t=${t}/>`}
      <footer className="map-popup-footer">
        ${isHut ? html`<a href=${OSM_COPYRIGHT} target="_blank" rel="noopener noreferrer">${t("dataOsmCredit")}</a>` : null}
        ${date ? html`<span>${t("hutManualDate", { date: formatCheckedDate(date, language) })}</span>` : null}
        <span>${t(isHut ? "hutConditions" : "markedTrailNote")}</span>
      </footer>
    </div>
  </section>`;
}
