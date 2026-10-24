import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import htm from "htm";
import { CheckCircle2, ChevronDown, ChevronUp, ExternalLink, MapPinned, Mountain, TreePine, X } from "@vitosha/icons";
import { translate, placeName, formatDate, formatNumber } from "./i18n.js?v=explorer-v2-3";
import { profileGeometry } from "./planning.js?v=vitosha-camera-20261005-2";
import { openModalDialog } from "./focus-management.js?v=vitosha-accessibility-20261005-2";
import { NOTE_COORDINATE_BOUNDS } from "./local-workspace.js?v=vitosha-accessibility-20261005-2";

const html = htm.bind(React.createElement);
export function PlanningDialog({ titleId, onClose, returnFocus, children }) {
  const root = useRef(null), closeRef = useRef(onClose), returnRef = useRef(returnFocus);
  useLayoutEffect(() => { closeRef.current = onClose; returnRef.current = returnFocus; }, [onClose, returnFocus]);
  useLayoutEffect(() => openModalDialog(root.current, { onClose: () => closeRef.current(), returnFocus: () => returnRef.current?.() || document.querySelector('.summit-head button[aria-expanded]') }), []);
  return html`<dialog ref=${root} className="planning-dialog-backdrop" aria-labelledby=${titleId} tabIndex="-1"><section className="planning-dialog surface">${children}</section></dialog>`;
}

export const ApproachPlanner = React.memo(function ApproachPlanner({ language, peak, route, saved, onSave, onShare, onGpx }) {
  const t = (key, values) => translate(language, key, values);
  const [expanded, setExpanded] = useState(true);
  const facts = route?.facts;
  const chart = useMemo(() => profileGeometry(facts), [facts]);
  const metres = value => `${formatNumber(value, language, 0)} ${t("metreUnit")}`;
  if (!route) return html`<section className="approach-planner"><h3>${t("planHeading")}</h3><p>${t("chooseApproach")}</p></section>`;
  const props = route.routeFeature.properties, routed = props.geometry_kind === "routed";
  return html`<section className="approach-planner" aria-labelledby="approach-heading">
    <h3 id="approach-heading">${placeName(route.feature, language)} → ${placeName(peak, language)}</h3>
    <p className=${routed ? "provenance-note" : "provenance-note approximate-note"}>${t(routed ? "routedNote" : "approximateNote")}</p>
    <div className="endpoint-gaps"><span>${t("startGap", { distance: metres(props.start_gap_m) })}</span><span>${t("summitGap", { distance: metres(props.summit_gap_m) })}</span>${props.start_gap_m > 50 || props.summit_gap_m > 50 ? html`<strong>${t("gapWarning")}</strong>` : null}</div>
    ${facts && chart ? html`<section className="elevation-profile">
      <button type="button" className="profile-toggle" aria-expanded=${expanded} aria-controls="approach-profile" onClick=${() => setExpanded(value => !value)}><span><${Mountain} size=${16} aria-hidden="true" />${t("profile")}</span><${expanded ? ChevronUp : ChevronDown} size=${16} aria-hidden="true" /></button>
      <div id="approach-profile" hidden=${!expanded}><figure className="profile-chart"><svg viewBox="0 0 320 116" role="img" aria-label=${t("profileDescription", { min: metres(facts.min), max: metres(facts.max), ascent: metres(facts.ascent), descent: metres(facts.descent) })}><path className="profile-grid-line" d="M8 108H312 M8 58H312 M8 8H312"/><path className="profile-area" d=${chart.area}/><path className="profile-line" d=${chart.line}/><circle className="profile-start" cx=${chart.start[0]} cy=${chart.start[1]} r="3"/><circle className="profile-end" cx=${chart.end[0]} cy=${chart.end[1]} r="3"/></svg><figcaption className="profile-labels"><span>0 ${t("kilometreUnit")}</span><span>${formatNumber(facts.distance / 1000, language)} ${t("kilometreUnit")}</span></figcaption></figure><div className="profile-stats"><span><small>${t("modelAscent")}</small><strong>↑ ${metres(facts.ascent)}</strong></span><span><small>${t("modelDescent")}</small><strong>↓ ${metres(facts.descent)}</strong></span><span><small>${t("profileRange")}</small><strong>${metres(facts.min)}–${metres(facts.max)}</strong></span></div><p className="profile-note">${t("profileNote")}</p></div>
    </section>` : html`<p className="profile-note">${t("noProfile")}</p>`}
    <div className="plan-actions"><button type="button" className=${`route-show-button ${saved ? "active" : ""}`} onClick=${onSave} disabled=${saved}><${CheckCircle2} size=${15} aria-hidden="true" />${t(saved ? "savedPlan" : "savePlan")}</button><button type="button" className="route-show-button" onClick=${onShare}><${ExternalLink} size=${15} aria-hidden="true" />${t("sharePlan")}</button><button type="button" className="route-show-button" onClick=${onGpx} disabled=${!routed} title=${!routed ? t("gpxUnavailable") : undefined}>${t("exportGpx")} ↓</button></div>
    <p className="planning-warning">${t("planningWarning")}</p>
  </section>`;
});

export const PersonalLibrary = React.memo(function PersonalLibrary({ language, workspaceState, data, mapReady, noteButtonRef, onOpenPlan, onRemovePlan, onExport, onImport, onReload, onOriginal, onAddNote, onCoordinateNote, onOpenNote }) {
  const t = (key, values) => translate(language, key, values), { workspace, error } = workspaceState;
  return html`<section className="personal-library" aria-label=${t("localOnly")}>
    ${error ? html`<div className="storage-state" role="alert"><p>${t(error)}</p><button type="button" className="route-show-button" onClick=${onReload}>${t("reloadLocal")}</button>${workspaceState.raw !== null || workspaceState.legacyRaw !== null ? html`<button type="button" className="route-show-button" onClick=${onOriginal}>${t("exportOriginal")}</button>` : null}</div>` : null}
    <details><summary><${MapPinned} size=${16} aria-hidden="true" /><span>${t("savedPlans")}</span><b>${workspace.plans.length}</b></summary><div className="library-content"><p className="local-disclosure">${t("localOnly")}</p>${workspace.plans.length ? workspace.plans.map(plan => {
      const route = data.hutRoutes.find(item => item.properties.id === plan.routeId), peak = data.peaks.find(item => item.properties.id === plan.peakId), hut = data.huts.find(item => item.properties.id === plan.hutId);
      return html`<div className="saved-plan-row" key=${plan.routeId}><strong>${route && peak && hut ? `${placeName(hut, language)} → ${placeName(peak, language)}` : t("unavailablePlan", { id: plan.routeId })}</strong><small>${t("savedOn", { date: formatDate(plan.savedAt, language) })}</small><div><button type="button" className="route-show-button" disabled=${!route || !peak || !hut} onClick=${() => onOpenPlan(plan)}>${t("openPlan")}</button><button type="button" className="route-show-button" onClick=${() => onRemovePlan(plan.routeId)}>${t("removePlan")}</button></div></div>`;
    }) : html`<p>${t("noSavedPlans")}</p>`}</div></details>
    <details><summary><${TreePine} size=${16} aria-hidden="true" /><span>${t("localNotes")}</span><b>${workspace.reports.length}</b></summary><div className="library-content"><p className="local-disclosure">${t("reportPrivacy")}</p><div className="note-create-actions"><button ref=${noteButtonRef} type="button" className="route-show-button" disabled=${!mapReady || Boolean(error)} title=${!mapReady ? t("mapRequiredForNote") : undefined} onClick=${onAddNote}>${t("addNote")}</button><button type="button" className="route-show-button" disabled=${Boolean(error)} onClick=${onCoordinateNote}>${t("noteCoordinatesAction")}</button></div>${workspace.reports.length ? workspace.reports.map(note => html`<button type="button" className="note-list-row" key=${note.id} onClick=${() => onOpenNote(note.id)}><strong>${t("reportHeading")} · ${t(note.resolvedAt ? "resolvedNote" : note.severity)}</strong><span>${note.note || t("noNoteText")}</span><small>${formatDate(note.createdAt, language)}</small></button>`) : html`<p>${t("noNotes")}</p>`}</div></details>
    <div className="backup-actions"><button type="button" className="route-show-button" onClick=${onExport} disabled=${Boolean(error)}>${t("exportBackup")}</button><button type="button" className="route-show-button" onClick=${onImport}>${t("importBackup")}</button></div><p className="backup-note">${t("backupNote")}</p>
  </section>`;
});

export function ReportDialog({ language, draft, report, onClose, returnFocus, onDraftChange, onSave, onUpdate, error }) {
  const t = (key, values) => translate(language, key, values);
  const heading = useRef(null), isDraft = Boolean(draft), resolved = Boolean(report?.resolvedAt);
  useLayoutEffect(() => { if (!isDraft) heading.current?.focus(); }, [isDraft, report?.id, resolved]);
  return html`<${PlanningDialog} titleId="report-title" onClose=${onClose} returnFocus=${returnFocus}>
    <header className="dialog-header">
      <div><small>${t(draft ? "newReport" : "reportDetail")}</small><h2 ref=${heading} tabIndex="-1" id="report-title">${t("reportHeading")}</h2></div>
      <button type="button" className="icon-button" onClick=${onClose} aria-label=${t("close")}><${X} size=${18} aria-hidden="true" /></button>
    </header>
    ${draft ? html`<form className="note-form" onSubmit=${onSave}>
      ${draft.manualCoordinates ? html`<fieldset className="note-coordinates">
        <legend>${t("noteCoordinatesHeading")}</legend>
        <p id="note-coordinate-hint">${t("noteCoordinatesHint", { south: formatNumber(NOTE_COORDINATE_BOUNDS.south, language, 2), north: formatNumber(NOTE_COORDINATE_BOUNDS.north, language, 2), west: formatNumber(NOTE_COORDINATE_BOUNDS.west, language, 2), east: formatNumber(NOTE_COORDINATE_BOUNDS.east, language, 2) })}</p>
        <div className="note-coordinate-grid">
          <label><span>${t("latitude")}</span><input data-initial-focus type="number" inputMode="decimal" required step="any" min=${NOTE_COORDINATE_BOUNDS.south} max=${NOTE_COORDINATE_BOUNDS.north} value=${draft.latitude} aria-describedby="note-coordinate-hint" onInput=${event => onDraftChange({ ...draft, latitude: event.target.value })}/></label>
          <label><span>${t("longitude")}</span><input type="number" inputMode="decimal" required step="any" min=${NOTE_COORDINATE_BOUNDS.west} max=${NOTE_COORDINATE_BOUNDS.east} value=${draft.longitude} aria-describedby="note-coordinate-hint" onInput=${event => onDraftChange({ ...draft, longitude: event.target.value })}/></label>
        </div>
      </fieldset>` : html`<div className="trail-report-coordinates">${t("latitude")}: ${draft.latitude.toFixed(5)} · ${t("longitude")}: ${draft.longitude.toFixed(5)}</div>`}
      <label><span>${t("trailCondition")}</span><select value=${draft.severity} onChange=${event => onDraftChange({ ...draft, severity: event.target.value })}><option value="blocked">${t("blocked")}</option><option value="difficult">${t("difficult")}</option></select></label>
      <label><span>${t("shortNote")}</span><textarea data-initial-focus=${!draft.manualCoordinates || undefined} rows="3" maxLength="280" value=${draft.note} placeholder=${t("notePlaceholder")} onInput=${event => onDraftChange({ ...draft, note: event.target.value })}></textarea></label>
      <div className="trail-report-actions"><button type="button" className="secondary" onClick=${onClose}>${t("cancel")}</button><button type="submit" className="primary">${t("save")}</button></div>
    </form>` : html`<div className="note-detail">
      <p className="trail-report-status" role="status" aria-atomic="true">${t(report.resolvedAt ? "resolvedNote" : report.severity)}</p>
      <dl>
        <div><dt>${t("added")}</dt><dd>${formatDate(report.createdAt, language)}</dd></div>
        <div><dt>${t("coordinates")}</dt><dd>${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}</dd></div>
        ${report.reviewedAt ? html`<div><dt>${t("reviewed")}</dt><dd><span role="status" aria-label=${t("reviewed")} aria-atomic="true">${formatDate(report.reviewedAt, language)}</span></dd></div>` : null}
      </dl>
      <p>${report.note || t("noNoteText")}</p>
      <div className="trail-report-actions">
        ${report.resolvedAt ? html`<button type="button" className="primary" onClick=${() => onUpdate(report.id, { resolvedAt: null })}>${t("restoreNote")}</button>` : html`<button type="button" className="secondary" onClick=${() => onUpdate(report.id, { reviewedAt: new Date().toISOString() })}>${t("stillThere")}</button><button type="button" className="primary" onClick=${() => onUpdate(report.id, { resolvedAt: new Date().toISOString() })}>${t("gone")}</button>`}
      </div>
    </div>`}
    ${error ? html`<p className="storage-state" role="alert">${t(error)}</p>` : null}
    <p className="local-disclosure">${t("localOnly")}. ${t("reportPrivacy")}</p>
  </${PlanningDialog}>`;
}
