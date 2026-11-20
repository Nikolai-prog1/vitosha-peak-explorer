import React, { useState } from "react";
import htm from "htm";
import { ChevronDown, CircleHelp } from "@vitosha/icons";
import { hutMarkerSvg, peakMarkerSvg, REPORT_MARKER_SVG } from "./map-markers.js?v=vitosha-trails-20261119-4";

const html = htm.bind(React.createElement);
function Icon({ component: Component, size }) { return html`<${Component} size=${size} strokeWidth=${1.9} aria-hidden="true" />`; }

// Summits and huts explain themselves; every other legend entry has a short explanation.
const LEGEND_INFO = {
  selectedSummit: "legendInfoSelectedSummit", hutKindShelter: "legendInfoShelter", modelledApproach: "legendInfoRouted",
  approximate: "legendInfoSketch", markedTrail: "legendInfoMarked", personalNote: "legendInfoNote", allMarkedTrailsLayer: "legendInfoAllTrails",
};
function LegendInfo({ t, item, openInfo, onInfo }) {
  const expanded = openInfo === item, id = `legend-info-${item}`;
  return html`<button type="button" className="legend-info-button" aria-expanded=${expanded} aria-controls=${id}
      aria-label=${t("legendInfoAbout", { item: t(item) })} title=${t("legendInfoAbout", { item: t(item) })}
      onClick=${() => onInfo(expanded ? null : item)}><${Icon} component=${CircleHelp} size=${15}/></button>
    <p id=${id} className="legend-info" hidden=${!expanded}>${t(LEGEND_INFO[item])}</p>`;
}
export function MapLegend({ t, open, onToggle, showHuts, onShowHuts, showAllTrails, onShowAllTrails, mapReady, inert }) {
  const [openInfo, setOpenInfo] = useState(null);
  const info = item => LEGEND_INFO[item] ? html`<${LegendInfo} t=${t} item=${item} openInfo=${openInfo} onInfo=${setOpenInfo}/>` : null;
  const rows = [
    ["summit", peakMarkerSvg(false)],
    ["selectedSummit", peakMarkerSvg(true, "legend-active-peak")],
    ["hutKindHut", hutMarkerSvg("hut")],
    ["hutKindShelter", hutMarkerSvg("shelter")],
    ["modelledApproach", null, "routed"],
    ["approximate", null, "sketch"],
    ["markedTrail", null, "marked"],
    ["personalNote", REPORT_MARKER_SVG, "note"],
  ];
  return html`<details className="v2-legend" inert=${inert} data-map-occluder open=${open} onToggle=${event => onToggle(event.currentTarget.open)}>
    <summary>${t("mapLegend")}<${Icon} component=${ChevronDown} size=${15}/></summary>
    <ul>${rows.map(([key, svg, style]) => html`<li key=${key}><span className=${`legend-symbol ${style || ""}`} aria-hidden="true" dangerouslySetInnerHTML=${svg ? { __html: svg } : undefined}></span><span className="legend-label">${t(key)}</span>${info(key)}</li>`)}</ul>
    <div className="v2-layer-options">
      <div className="v2-layer-option"><label><input type="checkbox" checked=${showHuts} disabled=${!mapReady} onChange=${event => onShowHuts(event.target.checked)}/>${t("hutLayer")}</label></div>
      <div className="v2-layer-option"><label><input type="checkbox" checked=${showAllTrails} disabled=${!mapReady} onChange=${event => onShowAllTrails(event.target.checked)}/>${t("allMarkedTrailsLayer")}</label>${info("allMarkedTrailsLayer")}</div>
    </div>
  </details>`;
}
