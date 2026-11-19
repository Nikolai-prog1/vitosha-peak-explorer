export function peakMarkerSvg(selected, gradientId = "map-active-peak") {
  if (!selected) return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3.5 26.5 16 4.5l12.5 22H3.5Z" fill="rgba(238,241,232,.82)" stroke="#173f34" stroke-width="2.2" stroke-linejoin="round"/><path d="m16 4.5 4.4 7.8-3.1-1.4-3 1.4L16 4.5Z" fill="#173f34" fill-opacity=".92"/></svg>`;
  return `<svg viewBox="0 0 36 36" aria-hidden="true">
    <defs><linearGradient id="${gradientId}" x1="5" y1="30" x2="29" y2="5" gradientUnits="userSpaceOnUse"><stop stop-color="#1576ff"/><stop offset="1" stop-color="#79e7ff"/></linearGradient></defs>
    <path d="M2.8 29.2 12.7 11l4.1 6.1L22.4 5l10.8 24.2H2.8Z" fill="url(#${gradientId})" stroke="#e9fbff" stroke-width="2" stroke-linejoin="round"/>
    <path d="m12.7 11 2.8 4.2 1.3 1.9 2-4.3 3.6-7.8 3.5 7.9-3.2-1.5-2.6 1.8-2.6-1.4-2 1.2-2.8-2Z" fill="#f5fdff" fill-opacity=".92"/>
    <path d="m7.5 27 6.2-9.2 3.3 4.8 4.2-6.1 6.3 10.5" fill="none" stroke="#083d83" stroke-opacity=".55" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export function hutMarkerSvg(kind) {
  if (kind === "shelter") return `<svg viewBox="0 0 34 34" aria-hidden="true">
    <path d="M2.5 28.5 17 5.5l14.5 23Z" fill="var(--hut-ink)" stroke="var(--marker-color, var(--hut-fill))" stroke-width="2.8" stroke-linejoin="round"/>
    <path d="m10.7 24.5 6.3-10 6.3 10" fill="none" stroke="var(--hut-edge)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  return `<svg viewBox="0 0 34 34" aria-hidden="true">
    <path d="M4 15.5 17 5l13 10.5v13H4v-13Z" fill="var(--marker-color, var(--hut-fill))" stroke="var(--hut-ink)" stroke-width="2" stroke-linejoin="round"/>
    <path d="M12 28v-8h10v8" fill="var(--hut-ink)"/>
    <path d="M3 16 17 4l14 12" fill="none" stroke="var(--hut-edge)" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;
}

export const REPORT_MARKER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M6 17l5-6-2 1 3-7 3 7-2-1 5 6"/></svg>';
