export const TRAIL_COLORS = Object.freeze({
  red: "#db4249", blue: "#4c9eef", green: "#5ba86a", yellow: "#f3cf62", white: "#fff8e5",
  black: "#111827", orange: "#ed884c", purple: "#b692e8",
});

export const VIA_MARKED_TRAILS = "BRouter hiking-beta via OSM marked trails";
export function trailColor(colour) { return TRAIL_COLORS[colour] ?? "#bac2cb"; }
